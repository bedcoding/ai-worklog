import { Notification, dialog, powerMonitor } from 'electron'
import { kstHHMM, kstStartOfDayMs } from '@shared/dates'
import { readJson, schedulerStatePath, writeJsonAtomic } from './cache'
import { ensureDaySummary, todayKst } from './pipeline/summarizer'
import { getSettings } from './settings'
import type { DaySummary } from '@shared/types'

/**
 * 매일 자동실행 스케줄러.
 * - dailyAuto: 'off' | 'confirm'(실행 전 확인 창) | 'silent'(조용히 실행)
 * - dailyTime: KST 기준 "HH:mm" — 실행 기록(lastAutoRunDate)이 KST 날짜이므로
 *   발화 판정도 KST로 통일해야 KST 밖 타임존에서 하루가 어긋나지 않는다.
 * - 슬립/재부팅으로 시각을 놓친 경우, 깨어날 때 그날 몫을 따라잡는다.
 */
interface SchedulerState {
  lastAutoRunDate?: string
}

let timer: ReturnType<typeof setTimeout> | null = null
let running = false
let onSummaryDone: ((s: DaySummary) => void) | null = null

export function initScheduler(notify: (s: DaySummary) => void): void {
  onSummaryDone = notify
  powerMonitor.on('resume', () => {
    void catchUpThenReschedule()
  })
  void catchUpThenReschedule()
}

export async function reschedule(): Promise<void> {
  if (timer) clearTimeout(timer)
  timer = null
  const s = await getSettings()
  if (s.dailyAuto === 'off') return
  const delay = nextFireMs(s.dailyTime) - Date.now()
  // 재예약은 이 콜백과 catchUpThenReschedule 두 곳에서만 — fire() 자신은 하지 않는다
  timer = setTimeout(() => {
    void fire().finally(() => void reschedule())
  }, delay)
}

async function catchUpThenReschedule(): Promise<void> {
  const s = await getSettings()
  if (s.dailyAuto !== 'off' && timePassedToday(s.dailyTime)) {
    const state = await readJson<SchedulerState>(schedulerStatePath())
    if (state?.lastAutoRunDate !== todayKst()) await fire()
  }
  await reschedule()
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
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
  try {
    const s = await getSettings()
    if (s.dailyAuto === 'off') return
    const today = todayKst()
    const state = await readJson<SchedulerState>(schedulerStatePath())
    if (state?.lastAutoRunDate === today) return

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
        await writeJsonAtomic(schedulerStatePath(), { lastAutoRunDate: today })
        return
      }
    }

    const summary = await ensureDaySummary(today)
    await writeJsonAtomic(schedulerStatePath(), { lastAutoRunDate: today })
    new Notification({
      title: 'WorkLog',
      body: summary.empty
        ? '오늘은 Claude Code 활동 기록이 없습니다'
        : `오늘 업무 요약 완료 — ${summary.headline ?? '일일보기 탭에서 확인하세요'}`
    }).show()
    onSummaryDone?.(summary)
  } catch (e) {
    new Notification({
      title: 'WorkLog',
      body: `자동 요약 실패: ${e instanceof Error ? e.message : String(e)}`
    }).show()
  } finally {
    running = false
  }
}
