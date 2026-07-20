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
import type { DayDigest, DaySummary, PeriodRequest, PeriodSummary } from '@shared/types'
import { renderDigestText } from '@shared/digest-text'
import { activityInRange } from './activity'
import { collectDigests } from './collector'
import { buildDigest, digestHash, isActiveDigest } from './digest'
import { throwIfCancelled, type ProgressFn } from './queue'

/** 기간(raw) 요약에서 claude에 넘기는 데이터 총량 캡 */
const RAW_PERIOD_MAX_CHARS = 48_000

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

/**
 * 날짜의 다이제스트를 확보한다.
 * 하루가 끝난 뒤 만들어진 캐시만 재사용하고, 그 외(오늘 / 하루 도중에 만들어진
 * 부분 캐시)는 재수집한다. 자동 실행이 18시에 만든 오늘치 다이제스트가
 * 다음날 확정본으로 굳어 이후 활동이 누락되는 것을 막는다.
 */
export async function ensureDayDigest(date: string): Promise<DayDigest> {
  if (date < todayKst()) {
    const cachedDigest = await readJson<DayDigest>(dayDigestPath(date))
    if (cachedDigest && isComplete(cachedDigest)) return cachedDigest
  }
  const { digests } = await collectDigests(date, date, { excludeCwds: [claudeWorkdir()] })
  const digest = digests.get(date) ?? emptyDigest(date)
  await writeJsonAtomic(dayDigestPath(date), digest)
  return digest
}

export async function getCachedDaySummary(date: string): Promise<DaySummary | null> {
  return readJson<DaySummary>(daySummaryPath(date))
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

/** 일별 요약을 사람이 읽는 한 줄들로 조립 (기간 daily 소스, 기안 데이터 공용) */
export function renderDailyLines(summaries: DaySummary[]): string {
  const lines: string[] = []
  for (const s of summaries) {
    if (s.empty) continue
    if (s.fallbackText) {
      lines.push(`${shortDateKo(s.date)} — ${s.fallbackText.replace(/\s+/g, ' ').slice(0, 300)}`)
      continue
    }
    lines.push(`${shortDateKo(s.date)} — ${s.headline ?? ''}`)
    for (const item of s.items ?? []) {
      lines.push(`  - [${item.project}] ${item.work}`)
    }
  }
  return lines.join('\n')
}

/**
 * 캐시된 기간 요약. 기간이 끝나기 전에 만들어져 일부만 반영된 요약은
 * stale=true로 표시해 UI가 "N일까지만 반영됨"을 알릴 수 있게 한다.
 */
export async function getCachedPeriod(key: string): Promise<PeriodSummary | null> {
  const cached = await readJson<PeriodSummary>(periodPath(key))
  if (!cached) return null
  const { end } = periodRangeOf({ kind: cached.kind, key, source: cached.source })
  return { ...cached, stale: cached.end < end }
}

/**
 * 주간/월간 요약 생성.
 * source=daily: 미요약 활동일을 먼저 백필한 뒤 일별 요약을 조합해 요약.
 * source=raw: 기간의 원본 다이제스트를 통째로 넘겨 요약.
 */
export async function ensurePeriodSummary(
  req: PeriodRequest,
  onProgress?: ProgressFn
): Promise<PeriodSummary> {
  const { start, end } = periodRangeOf(req)
  const today = todayKst()
  if (start > today) throw new Error('아직 시작되지 않은 기간입니다')
  const endClamped = end > today ? today : end

  onProgress?.({ done: 0, total: 0, currentDate: null, phase: 'scan' })
  const { dates: activeDates, digests } = await activityInRange(start, endClamped)
  if (activeDates.length === 0) throw new Error('이 기간에는 Claude Code 활동 기록이 없습니다')

  const settings = await getSettings()
  let data: string

  if (req.source === 'daily') {
    const summaries: DaySummary[] = []
    for (let i = 0; i < activeDates.length; i++) {
      throwIfCancelled()
      const date = activeDates[i]
      onProgress?.({ done: i, total: activeDates.length, currentDate: date, phase: 'summarize' })
      const digest = digests.get(date)
      if (digest) {
        summaries.push(await ensureDaySummary(date, { preCollected: digest }))
      } else {
        // 원본 로그가 이미 정리된 날짜 — 남아 있는 요약 캐시를 그대로 쓴다
        const cached = await getCachedDaySummary(date)
        if (cached) summaries.push(cached)
      }
    }
    onProgress?.({
      done: activeDates.length,
      total: activeDates.length,
      currentDate: null,
      phase: 'summarize'
    })
    data = renderDailyLines(summaries)
  } else {
    const withLogs = activeDates.filter((d) => digests.has(d))
    if (withLogs.length === 0) {
      throw new Error('이 기간의 원본 대화 기록이 남아 있지 않습니다. 일일 요약 조합을 사용하세요.')
    }
    const perDayCap = Math.floor(RAW_PERIOD_MAX_CHARS / withLogs.length)
    data = withLogs
      .map((d) => {
        const text = renderDigestText(digests.get(d)!)
        const cut = text.length > perDayCap ? `${text.slice(0, perDayCap)}\n(이후 생략)` : text
        return `### ${shortDateKo(d)}\n${cut}`
      })
      .join('\n\n')
  }

  throwIfCancelled()
  const label = periodLabelOf(req, start, endClamped)
  const prompt = renderTemplate(settings.prompts.period, { label, data })
  const text = await runClaude(prompt, await claudeOpts())

  const period: PeriodSummary = {
    key: req.key,
    kind: req.kind,
    start,
    end: endClamped,
    source: req.source,
    text: text.trim(),
    model: settings.model,
    generatedAt: new Date().toISOString()
  }
  await writeJsonAtomic(periodPath(req.key), period)
  return period
}
