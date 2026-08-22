import {
  claudeWorkdir,
  dayDigestPath,
  daySummaryPath,
  periodPath,
  readJson,
  writeJsonAtomic
} from '../cache'
import { locateClaude } from '../claude/locate'
import { extractJson, runClaude, type ClaudeRunOptions } from '../claude/run'
import { renderTemplate } from '../prompts'
import { getSettings } from '../settings'
import {
  kstDateOf,
  kstStartOfDayMs,
  monthRange,
  shortDateKo,
  weekRange,
  weekdayKo
} from '@shared/dates'
import type {
  DayDigest,
  DaySummary,
  PeriodRequest,
  PeriodSummary,
  RangeStatus
} from '@shared/types'
import { renderDigestText } from '@shared/digest-text'
import { activityInRange } from './activity'
import { collectDigests } from './collector'
import { buildDigest, digestHash, isActiveDigest } from './digest'
import { throwIfCancelled, type ProgressFn } from './queue'

async function claudeOpts(): Promise<ClaudeRunOptions> {
  const s = await getSettings()
  return {
    claudePath: await locateClaude(s.claudePath),
    model: s.model,
    cwd: claudeWorkdir()
  }
}

function emptyDigest(date: string): DayDigest {
  return buildDigest({ date, projects: new Map() }, 0)
}

export function todayKst(): string {
  return kstDateOf(Date.now())
}

const DAY_MS = 86400_000

/** 그 날이 끝난 뒤에 만들어진 다이제스트만 확정본으로 신뢰한다 */
function isComplete(d: DayDigest): boolean {
  const builtMs = Date.parse(d.builtAt ?? '')
  return Number.isFinite(builtMs) && builtMs >= kstStartOfDayMs(d.date) + DAY_MS
}

export interface DigestOptions {
  /** 캐시를 무시하고 원본 로그를 다시 스캔한다 (사용자의 "새로고침") */
  force?: boolean
  /**
   * 화면 표시용 조회. 캐시가 있으면 완결성과 무관하게 즉시 반환해 스캔 비용을 없앤다.
   * 요약 생성 경로는 이 옵션을 쓰지 않으므로 정확성에는 영향이 없다.
   */
  preferCache?: boolean
}

/**
 * 날짜의 다이제스트를 확보한다.
 * 요약 생성 경로에서는 하루가 끝난 뒤 만들어진 캐시만 재사용한다. 자동 실행이
 * 18시에 만든 오늘치 다이제스트가 다음날 확정본으로 굳어 이후 활동이 누락되는 것을 막는다.
 */
export async function ensureDayDigest(
  date: string,
  opts: DigestOptions = {}
): Promise<DayDigest> {
  if (!opts.force) {
    const cachedDigest = await readJson<DayDigest>(dayDigestPath(date))
    if (cachedDigest && (opts.preferCache || (date < todayKst() && isComplete(cachedDigest)))) {
      return cachedDigest
    }
  }
  const { digests } = await collectDigests(date, date, { excludeCwds: [claudeWorkdir()] })
  const digest = digests.get(date) ?? emptyDigest(date)
  await writeJsonAtomic(dayDigestPath(date), digest)
  return digest
}

export async function getCachedDaySummary(date: string): Promise<DaySummary | null> {
  return readJson<DaySummary>(daySummaryPath(date))
}

/**
 * 구간의 활동일과, 그중 요약이 끝난 날짜.
 * end를 오늘로 잘라낸다. 아직 오지 않은 날을 "활동 없음"으로 보이면 안 된다.
 *
 * '요약이 끝났다'의 기준은 캐시 존재 여부다. 활동 없음(empty) 센티널도 끝난 것으로
 * 센다. 그러지 않으면 백필이 그 날짜를 건너뛰는데 상태는 미요약으로 남아, 밀린
 * 개수가 영원히 0이 되지 않고 기간 요약 버튼이 열리지 않는다.
 */
export async function getRangeStatus(start: string, end: string): Promise<RangeStatus> {
  const today = todayKst()
  const endClamped = end > today ? today : end
  if (start > endClamped) {
    return { start, end: endClamped, activeDays: [], summarizedDays: [] }
  }
  const { dates } = await activityInRange(start, endClamped)
  const summarizedDays: string[] = []
  for (const d of dates) {
    if (await getCachedDaySummary(d)) summarizedDays.push(d)
  }
  return { start, end: endClamped, activeDays: dates, summarizedDays }
}

/**
 * 구간의 미요약 활동일을 하나씩 순차 생성한다. 조합은 하지 않는다.
 *
 * 기간 요약과 분리한 이유: 예전에는 '주간 요약' 한 번이 조용히 claude를 N+1 번
 * 불렀다. 비싼 단계(날짜 수만큼)와 싼 단계(1번)를 갈라놓으면 누르기 전에 비용을
 * 볼 수 있고, 중간에 중단하는 것도 의미가 생긴다.
 *
 * 캐시가 있는 날짜는 건너뛴다. 오늘치가 낡았을 수 있지만 그건 '오늘 하루 정리하기'가
 * 강제 재생성으로 담당한다. 그래야 여기서 도는 횟수가 화면에 적힌 숫자와 일치한다.
 */
export async function backfillRange(
  start: string,
  end: string,
  onProgress?: ProgressFn
): Promise<RangeStatus> {
  const today = todayKst()
  const endClamped = end > today ? today : end
  if (start > endClamped) {
    return { start, end: endClamped, activeDays: [], summarizedDays: [] }
  }

  onProgress?.({ done: 0, total: 0, currentDate: null, phase: 'scan' })
  const { dates, digests } = await activityInRange(start, endClamped)

  const todo: string[] = []
  for (const d of dates) {
    if (!(await getCachedDaySummary(d))) todo.push(d)
  }

  for (let i = 0; i < todo.length; i++) {
    throwIfCancelled()
    const date = todo[i]
    onProgress?.({ done: i, total: todo.length, currentDate: date, phase: 'summarize' })
    const digest = digests.get(date)
    await ensureDaySummary(date, digest ? { preCollected: digest } : {})
  }
  onProgress?.({ done: todo.length, total: todo.length, currentDate: null, phase: 'summarize' })

  return getRangeStatus(start, end)
}

interface DayJson {
  headline?: string
  items?: { project?: string; work?: string }[]
  keywords?: string[]
}

/** 같은 날짜의 요약이 동시에 두 번 생성되지 않게 진행 중인 작업을 공유한다 */
const inflight = new Map<string, Promise<DaySummary>>()

/**
 * 일별 요약을 확보한다. digestHash가 같은 캐시가 있으면 claude를 호출하지 않는다.
 * @param preCollected 기간 스캔에서 이미 만든 다이제스트 (재수집 방지)
 */
export function ensureDaySummary(
  date: string,
  opts: { force?: boolean; preCollected?: DayDigest } = {}
): Promise<DaySummary> {
  const key = `${date}:${opts.force ? 'force' : ''}`
  const running = inflight.get(key)
  if (running) return running
  const p = generateDaySummary(date, opts).finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

async function generateDaySummary(
  date: string,
  opts: { force?: boolean; preCollected?: DayDigest }
): Promise<DaySummary> {
  const digest = opts.preCollected ?? (await ensureDayDigest(date))
  if (opts.preCollected) await writeJsonAtomic(dayDigestPath(date), digest)

  const hash = digestHash(digest)
  const cachedSummary = await getCachedDaySummary(date)
  if (cachedSummary && cachedSummary.digestHash === hash && !opts.force) return cachedSummary

  const settings = await getSettings()

  if (!isActiveDigest(digest)) {
    const summary: DaySummary = {
      date,
      digestHash: hash,
      model: settings.model,
      generatedAt: new Date().toISOString(),
      empty: true
    }
    await writeJsonAtomic(daySummaryPath(date), summary)
    return summary
  }

  const prompt = renderTemplate(settings.prompts.day, {
    date,
    weekday: weekdayKo(date),
    digest: renderDigestText(digest)
  })
  const result = await runClaude(prompt, await claudeOpts())
  const parsed = extractJson<DayJson>(result)

  const summary: DaySummary = {
    date,
    digestHash: hash,
    model: settings.model,
    generatedAt: new Date().toISOString(),
    ...(parsed
      ? {
          headline: parsed.headline ?? '',
          items: (parsed.items ?? [])
            .filter((i) => i && (i.project || i.work))
            .map((i) => ({ project: i.project ?? '', work: i.work ?? '' })),
          keywords: parsed.keywords ?? []
        }
      : { fallbackText: result.trim() })
  }
  await writeJsonAtomic(daySummaryPath(date), summary)
  return summary
}

export function periodRangeOf(req: PeriodRequest): { start: string; end: string } {
  return req.kind === 'week' ? weekRange(req.key) : monthRange(req.key)
}

function periodLabelOf(req: PeriodRequest, start: string, end: string): string {
  if (req.kind === 'month') {
    const [y, m] = req.key.split('-').map(Number)
    return `${y}년 ${m}월`
  }
  return `${shortDateKo(start)}~${shortDateKo(end)} 주간`
}

/**
 * 한 줄 요약에 넘기는 데이터. 날짜별 헤드라인만 모은다.
 * 항목까지 같이 넘기면 한 줄이 항목 나열로 흐른다.
 */
export function renderHeadlineLines(summaries: DaySummary[]): string {
  const lines: string[] = []
  for (const s of summaries) {
    if (s.empty) continue
    // JSON 파싱이 실패한 날은 헤드라인이 없다. 원문 앞머리로 대신한다
    const head = s.headline ?? s.fallbackText?.replace(/\s+/g, ' ').slice(0, 120) ?? ''
    if (head) lines.push(`${shortDateKo(s.date)}: ${head}`)
  }
  return lines.join('\n')
}

/**
 * 상세 요약에 넘기는 데이터. 날짜별 항목만 모은다.
 * 날짜로 묶어 둔다. 여러 날에 걸친 같은 작업을 하나로 합치려면 날짜가 보여야 한다.
 */
export function renderItemLines(summaries: DaySummary[]): string {
  const blocks: string[] = []
  for (const s of summaries) {
    if (s.empty) continue
    if (s.fallbackText) {
      blocks.push(`${shortDateKo(s.date)}\n  ${s.fallbackText.replace(/\s+/g, ' ').slice(0, 300)}`)
      continue
    }
    const items = s.items ?? []
    if (items.length === 0) continue
    blocks.push(
      [shortDateKo(s.date), ...items.map((i) => `  - [${i.project}] ${i.work}`)].join('\n')
    )
  }
  return blocks.join('\n')
}

/**
 * 캐시된 기간 요약. 기간이 끝나기 전에 만들어져 일부만 반영된 요약은
 * stale=true로 표시해 UI가 "N일까지만 반영됨"을 알릴 수 있게 한다.
 */
export async function getCachedPeriod(key: string): Promise<PeriodSummary | null> {
  // 한 줄/상세로 나누기 전 캐시는 text 하나만 갖고 있다. 그 글은 지금의 상세 요약과
  // 같은 자리이므로 detail로 읽는다. 버리면 이미 만들어 둔 요약이 빈칸으로 보인다.
  const cached = await readJson<PeriodSummary & { text?: string }>(periodPath(key))
  if (!cached) return null
  const { end } = periodRangeOf({ kind: cached.kind, key })
  return {
    ...cached,
    overview: cached.overview ?? '',
    detail: cached.detail ?? cached.text ?? '',
    stale: cached.end < end
  }
}

/**
 * 이미 만들어 둔 일별 요약을 묶어 주간/월간 요약을 만든다. claude는 1번만 부른다.
 *
 * 미요약 날짜가 남아 있으면 만들지 않고 거부한다. 예전에는 여기서 조용히 백필해
 * 한 번의 클릭이 N+1 번 호출이 됐다. 백필은 backfillRange로 따로 부른다.
 */
export async function ensurePeriodSummary(req: PeriodRequest): Promise<PeriodSummary> {
  const { start, end } = periodRangeOf(req)
  const today = todayKst()
  if (start > today) throw new Error('아직 시작되지 않은 기간입니다')
  const endClamped = end > today ? today : end

  const { dates: activeDates } = await activityInRange(start, endClamped)
  if (activeDates.length === 0) throw new Error('이 기간에는 Claude Code 활동 기록이 없습니다')

  const summaries: DaySummary[] = []
  for (const date of activeDates) {
    const cached = await getCachedDaySummary(date)
    if (!cached) {
      throw new Error('요약되지 않은 날짜가 남아 있습니다. 전체 정리를 먼저 끝내세요.')
    }
    summaries.push(cached)
  }
  const settings = await getSettings()
  const label = periodLabelOf(req, start, endClamped)
  const opts = await claudeOpts()

  // 두 번 부른다. 한 줄 요약은 날짜별 헤드라인만, 상세 요약은 날짜별 항목만 본다.
  // 한 번에 둘을 만들게 하면 한 줄 쪽이 항목을 압축한 문장이 되어 날짜별 헤드라인을
  // 묶은 것과 달라진다. 순서대로 부른다. 동시에 부르면 claude 두 개가 같이 돈다.
  const overview = await runClaude(
    renderTemplate(settings.prompts.periodOverview, {
      label,
      data: renderHeadlineLines(summaries)
    }),
    opts
  )
  const detail = await runClaude(
    renderTemplate(settings.prompts.periodDetail, { label, data: renderItemLines(summaries) }),
    opts
  )

  const period: PeriodSummary = {
    key: req.key,
    kind: req.kind,
    start,
    end: endClamped,
    overview: overview.trim(),
    detail: detail.trim(),
    model: settings.model,
    generatedAt: new Date().toISOString()
  }
  await writeJsonAtomic(periodPath(req.key), period)
  return period
}

