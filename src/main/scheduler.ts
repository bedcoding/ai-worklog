import { Notification, dialog, powerMonitor } from 'electron'
import { kstHHMM, kstStartOfDayMs, todayKst } from '@shared/dates'
import { readJson, schedulerStatePath, writeJsonAtomic } from './cache'
import {
  nextSchedulerState,
  type SchedulerState
} from './scheduler-history'
import { ensureDaySummary } from './pipeline/summarizer'
import { getSettings } from './settings'
import type { DaySummary, PipelineError, SchedulerRun } from '@shared/types'

/**
 * 매일 자동실행 스케줄러.
 * - dailyAuto: 'off' | 'confirm'(실행 전 확인 창) | 'silent'(조용히 실행)
 * - dailyTime: KST 기준 "HH:mm". 실행 기록(lastAutoRunDate)이 KST 날짜이므로
 *   발화 판정도 KST로 통일해야 KST 밖 타임존에서 하루가 어긋나지 않는다.
 * - 슬립/재부팅으로 시각을 놓친 경우, 깨어날 때 그날 몫을 따라잡는다.
 */
/**
 * 실행 결과를 남긴다. 상태 파일을 통째로 덮어쓰면 이력이 날아가므로 기존 것을 읽어 합친다.
 */
async function recordRun(run: SchedulerRun, markDone: boolean): Promise<void> {
  try {
    const prev = (await readJson<SchedulerState>(schedulerStatePath())) ?? {}
    await writeJsonAtomic(schedulerStatePath(), nextSchedulerState(prev, run, markDone))
  } catch {
    // 이력을 남기지 못한 것이 요약 자체를 실패로 만들면 안 된다
  }
}

/** 설정 화면이 읽는다 */
export async function getSchedulerHistory(): Promise<SchedulerRun[]> {
  const state = await readJson<SchedulerState>(schedulerStatePath())
  return state?.recent ?? []
}

let timer: ReturnType<typeof setTimeout> | null = null
let running = false
let onSummaryDone: ((s: DaySummary) => void) | null = null
let onError: ((e: PipelineError) => void) | null = null

/** 시계 점프·타이머 지연·놓친 발화를 회수하는 주기 점검 간격 */
const CATCHUP_INTERVAL_MS = 15 * 60_000
/**
 * catch-up이 fire()를 다시 시도하기까지의 최소 간격.
 * fire()는 실패해도 lastAutoRunDate를 남기지 않으므로, 이 제한이 없으면
 * 실패한 자동 요약을 자정까지 15분마다 무한 재시도한다.
 */
const CATCHUP_MIN_GAP_MS = 60 * 60_000
let lastCatchUpFireMs = 0

/** dailyTime이 비었거나 형식이 깨진 경우의 대체값 (DEFAULT_SETTINGS.dailyTime과 같다) */
const FALLBACK_MINUTES = 18 * 60

export function initScheduler(
  notify: (s: DaySummary) => void,
  reportError: (e: PipelineError) => void
): void {
  onSummaryDone = notify
  onError = reportError
  // 'resume'만으로는 부족하다. 윈도우 11의 Modern Standby(S0)는 화면만 꺼진 채
  // 유지되어 resume이 발화하지 않는 기기가 많고, 실사용의 대부분은 '슬립'이 아니라 '화면 잠금'이다.
  powerMonitor.on('resume', () => {
    void catchUpThenReschedule()
  })
  powerMonitor.on('unlock-screen', () => {
    void catchUpThenReschedule()
  })
  // 최후 수단. catchUpThenReschedule은 lastAutoRunDate로, fire()는 running 플래그로
  // 멱등하므로 중복 호출이 안전하다.
  setInterval(() => {
    void catchUpThenReschedule()
  }, CATCHUP_INTERVAL_MS)
  void catchUpThenReschedule()
}

/**
 * 알림 표시. dailyAuto='silent'에서는 이 알림이 유일한 피드백이므로
 * 표시 자체가 불가능하거나 실패한 경우를 조용히 넘기지 않고 창으로 알린다.
 */
function showNotification(body: string): void {
  if (!Notification.isSupported()) {
    onError?.({ scope: 'day', message: body, retryable: false })
    return
  }
  const n = new Notification({ title: 'WorkLog', body })
  n.on('failed', (_e, err) => {
    onError?.({ scope: 'day', message: `알림 표시 실패: ${err}`, retryable: false })
  })
  n.show()
}

export async function reschedule(): Promise<void> {
  if (timer) clearTimeout(timer)
  timer = null
  const s = await getSettings()
  if (s.dailyAuto === 'off') return
  const delay = nextFireMs(s.dailyTime) - Date.now()
  // 재예약은 이 콜백과 catchUpThenReschedule 두 곳에서만. fire() 자신은 하지 않는다
  timer = setTimeout(() => {
    void fire().finally(() => void reschedule())
  }, delay)
}

async function catchUpThenReschedule(): Promise<void> {
  const s = await getSettings()
  if (s.dailyAuto !== 'off' && timePassedToday(s.dailyTime)) {
    const state = await readJson<SchedulerState>(schedulerStatePath())
    if (
      state?.lastAutoRunDate !== todayKst() &&
      Date.now() - lastCatchUpFireMs >= CATCHUP_MIN_GAP_MS
    ) {
      lastCatchUpFireMs = Date.now()
      await fire()
    }
  }
  await reschedule()
}

function minutesOf(hhmm: string): number {
  // 빈 문자열이면 NaN이 되어 nextFireMs가 NaN을 반환하고, setTimeout(NaN)이 즉시
  // 발화해 fire()→reschedule()이 무한 재예약 루프로 돈다
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  if (!m) return FALLBACK_MINUTES
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return FALLBACK_MINUTES
  return h * 60 + min
}

function timePassedToday(hhmm: string): boolean {
  return minutesOf(kstHHMM(Date.now())) >= minutesOf(hhmm)
}

function nextFireMs(hhmm: string): number {
  const target = kstStartOfDayMs(todayKst()) + minutesOf(hhmm) * 60_000
  return target <= Date.now() ? target + 86400_000 : target
}

async function fire(): Promise<void> {
  if (running) return
  running = true
  // catch-up 경로로 들어온 경우 예약돼 있던 타이머를 확실히 해제한다
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  const startedMs = Date.now()
  const startedAt = new Date(startedMs).toISOString()
  // 이력을 남길 대상 날짜. 발화 전에 빠져나간 경우(off, 이미 실행함)는 비워 둔다
  let target = ''
  try {
    const s = await getSettings()
    if (s.dailyAuto === 'off') return
    const today = todayKst()
    const state = await readJson<SchedulerState>(schedulerStatePath())
    if (state?.lastAutoRunDate === today) return
    target = today

    if (s.dailyAuto === 'confirm') {
      const { response } = await dialog.showMessageBox({
        type: 'question',
        title: 'WorkLog',
        message: '오늘 업무 요약을 생성하시겠습니까?',
        detail: 'Claude Code 사용 기록으로 오늘 하루 업무 요약을 만듭니다.',
        buttons: ['지금 생성', '오늘은 건너뛰기'],
        defaultId: 0,
        cancelId: 1
      })
      if (response !== 0) {
        // 건너뛰기도 실행으로 기록해 같은 날 반복해서 묻지 않는다
        await recordRun(
          { at: startedAt, date: today, outcome: 'skipped', ms: Date.now() - startedMs },
          true
        )
        return
      }
    }

    const summary = await ensureDaySummary(today)
    await recordRun(
      {
        at: startedAt,
        date: today,
        outcome: summary.empty ? 'empty' : 'ok',
        ms: Date.now() - startedMs
      },
      true
    )
    showNotification(
      summary.empty
        ? '오늘은 Claude Code 활동 기록이 없습니다'
        : `오늘 업무 요약 완료. ${summary.headline ?? '일일보기 탭에서 확인하세요'}`
    )
    onSummaryDone?.(summary)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    // markDone=false. 실패한 날은 catch-up 이 다시 시도해야 한다
    if (target) {
      await recordRun(
        { at: startedAt, date: target, outcome: 'error', ms: Date.now() - startedMs, error: message },
        false
      )
    }
    showNotification(`자동 요약 실패: ${message}`)
  } finally {
    running = false
  }
}
