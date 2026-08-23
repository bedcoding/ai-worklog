import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { activityPath, claudeWorkdir, daysRoot, readJson, writeJsonAtomic } from '../cache'
import { addDays, todayKst, ymOf } from '@shared/dates'
import type { ActivityCache, DayDigest, DaySummary } from '@shared/types'
import { collectDigests } from './collector'
import { isActiveDigest } from './digest'

export interface Activity {
  /** 활동이 있는 KST 날짜 (오름차순) */
  dates: string[]
  /** 원본 로그가 남아 있는 날짜의 다이제스트. 없는 날짜는 요약 캐시만 존재 */
  digests: Map<string, DayDigest>
}

/**
 * 기간의 활동일을 구한다. 원본 로그 스캔 결과와 캐시된 요약의 합집합이다.
 * Claude Code가 오래된 세션 로그를 자체 보존 기간에 따라 삭제해도, 이미 요약해 둔
 * 날짜는 계속 보고에 남는다.
 *
 * 다이제스트까지 필요한 곳(전체 정리)만 이것을 쓴다. 날짜 목록만 필요하면
 * activeDatesInRange를 써야 한다. 원본 스캔은 500MB를 훑어 2초 넘게 걸린다.
 */
export async function activityInRange(start: string, end: string): Promise<Activity> {
  const { digests } = await collectDigests(start, end, { excludeCwds: [claudeWorkdir()] })
  const active = new Set<string>()
  for (const [date, d] of digests) {
    if (isActiveDigest(d)) active.add(date)
  }
  for (const ym of monthsBetween(start, end)) {
    for (const date of await summarizedDatesOf(ym)) {
      if (date >= start && date <= end) active.add(date)
    }
  }
  return { dates: [...active].sort(), digests }
}

/**
 * 활동 판정 로직의 버전.
 *
 * 인덱스에는 판정 결과(참/거짓)만 남으므로, isActiveDigest나 제외 경로가 바뀌면
 * 저장된 값이 조용히 틀려진다. 그때 이 숫자를 올리면 낡은 인덱스를 버린다.
 */
const INDEX_VERSION = 1

/** 한 달치 활동 인덱스. 지난 날짜만 담는다 */
interface ActivityIndex {
  version: number
  builtAt: string
  /**
   * "YYYY-MM-DD" → 활동 있음.
   * 키가 있는 날짜만 '아는 날짜'다. 없으면 스캔한 적이 없다는 뜻이고 거짓과 다르다.
   */
  days: Record<string, boolean>
}

async function readIndex(ym: string): Promise<ActivityIndex | null> {
  const idx = await readJson<ActivityIndex>(activityPath(ym))
  if (!idx || idx.version !== INDEX_VERSION || typeof idx.days !== 'object') return null
  return idx
}

/** start..end 를 하루씩 (양 끝 포함) */
function datesBetween(start: string, end: string): string[] {
  const out: string[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d)
  return out
}

export interface ActiveDates {
  /** 활동이 있는 KST 날짜 (오름차순) */
  dates: string[]
  cache: ActivityCache
}

/**
 * 기간의 활동일만 구한다. 다이제스트를 만들지 않아 훨씬 싸다.
 *
 * 지난 날짜의 활동 여부는 하루가 끝나면 다시 바뀌지 않는다. 로그 레코드는 항상
 * 그 시점의 타임스탬프로 쌓이므로, 날짜가 지나면 그 날짜의 레코드가 더 생기지 않는다.
 * 그래서 지난 날짜는 인덱스에서 읽고 오늘만 실제로 스캔한다.
 *
 * 실측(로그 546개 파일 530MB): 월간 조회가 2.4초였고 오늘만 스캔하면 280ms다.
 * 스캔 비용은 구간 길이가 아니라 '얼마나 과거를 보는지'에 비례한다. mtime으로
 * 파일을 걸러서, 7월을 보면 546개를 읽고 오늘만 보면 1개를 읽는다.
 *
 * @param opts.refresh 인덱스를 무시하고 원본 로그를 다시 훑는다
 * @param opts.claudeDir 원본 로그 위치. 테스트에서 실제 ~/.claude 를 읽지 않도록 둔다
 */
export async function activeDatesInRange(
  start: string,
  end: string,
  opts: { refresh?: boolean; claudeDir?: string } = {}
): Promise<ActiveDates> {
  const { refresh = false, claudeDir } = opts
  const scanOpts = { excludeCwds: [claudeWorkdir()], ...(claudeDir ? { claudeDir } : {}) }
  const today = todayKst()
  const active = new Set<string>()
  let fromCache = 0
  let builtAt: string | null = null

  // 아직 모르는 지난 날짜. 이것들 때문에 원본을 훑어야 한다
  const unknown: string[] = []

  for (const ym of monthsBetween(start, end)) {
    const idx = refresh ? null : await readIndex(ym)
    if (idx && (!builtAt || idx.builtAt < builtAt)) builtAt = idx.builtAt
    for (const d of datesBetween(maxOf(start, `${ym}-01`), minOf(end, lastDayOf(ym)))) {
      if (d >= today) continue
      const known = idx?.days[d]
      if (known === undefined) unknown.push(d)
      else {
        fromCache++
        if (known) active.add(d)
      }
    }
  }

  // 모르는 날짜가 하나라도 있으면 그 전체 구간을 한 번에 훑는다. 하루만 훑어도
  // 값이 같다(mtime 필터가 파일 단위라 구간을 좁혀도 읽는 파일이 줄지 않는다).
  let scanned = 0
  if (unknown.length > 0) {
    const from = unknown[0]
    const to = unknown[unknown.length - 1]
    const { digests } = await collectDigests(from, to, scanOpts)
    const flags = new Map<string, boolean>()
    for (const d of datesBetween(from, to)) {
      if (d >= today) continue
      const dg = digests.get(d)
      flags.set(d, !!dg && isActiveDigest(dg))
      scanned++
    }
    for (const [d, on] of flags) if (on) active.add(d)
    await saveFlags(flags)
    builtAt = new Date().toISOString()
  }

  // 오늘은 아직 끝나지 않았으므로 절대 저장하지 않고 매번 읽는다
  if (end >= today && start <= today) {
    const { digests } = await collectDigests(today, today, scanOpts)
    const dg = digests.get(today)
    if (dg && isActiveDigest(dg)) active.add(today)
    scanned++
  }

  // 요약 캐시는 언제든 생기고 지워지므로 인덱스에 담지 않고 매번 본다.
  // 원본 로그가 삭제된 옛 날짜도 이미 요약했다면 보고에 남아야 한다.
  for (const ym of monthsBetween(start, end)) {
    for (const date of await summarizedDatesOf(ym)) {
      if (date >= start && date <= end) active.add(date)
    }
  }

  return {
    dates: [...active].sort(),
    cache: { cachedDays: fromCache, scannedDays: scanned, builtAt }
  }
}

/**
 * 스캔으로 알아낸 지난 날짜의 활동 여부를 달별 인덱스에 합친다.
 * 이미 있는 날짜도 덮어쓴다. 방금 원본을 읽은 값이 더 정확하다.
 */
export async function saveFlags(flags: Map<string, boolean>): Promise<void> {
  const byMonth = new Map<string, Map<string, boolean>>()
  for (const [d, on] of flags) {
    const ym = ymOf(d)
    let m = byMonth.get(ym)
    if (!m) {
      m = new Map()
      byMonth.set(ym, m)
    }
    m.set(d, on)
  }
  for (const [ym, m] of byMonth) {
    const prev = await readIndex(ym)
    const days = { ...(prev?.days ?? {}) }
    for (const [d, on] of m) days[d] = on
    const idx: ActivityIndex = {
      version: INDEX_VERSION,
      builtAt: new Date().toISOString(),
      days
    }
    await writeJsonAtomic(activityPath(ym), idx)
  }
}

/**
 * 이미 훑은 다이제스트로 인덱스를 채운다.
 * 전체 정리는 어차피 원본을 훑으므로, 그 결과를 버리지 않고 남겨 두면
 * 정리가 끝난 직후의 목록 조회가 다시 2초를 쓰지 않는다.
 */
export async function recordScanned(
  digests: Map<string, DayDigest>,
  start: string,
  end: string
): Promise<void> {
  const today = todayKst()
  const flags = new Map<string, boolean>()
  for (const d of datesBetween(start, end)) {
    if (d >= today) continue
    const dg = digests.get(d)
    flags.set(d, !!dg && isActiveDigest(dg))
  }
  if (flags.size > 0) await saveFlags(flags)
}

const maxOf = (a: string, b: string): string => (a > b ? a : b)
const minOf = (a: string, b: string): string => (a < b ? a : b)

function lastDayOf(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  // 다음 달 0일 = 이번 달 말일
  const d = new Date(Date.UTC(y, m, 0))
  return `${ym}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function monthsBetween(start: string, end: string): string[] {
  const months: string[] = []
  let [y, m] = ymOf(start).split('-').map(Number)
  const endYm = ymOf(end)
  for (;;) {
    const ym = `${y}-${String(m).padStart(2, '0')}`
    months.push(ym)
    if (ym >= endYm) break
    m === 12 ? ((y += 1), (m = 1)) : (m += 1)
  }
  return months
}

/** 캐시에 "활동 있음" 요약이 남아 있는 날짜들 */
async function summarizedDatesOf(ym: string): Promise<string[]> {
  let files: string[]
  try {
    files = await readdir(join(daysRoot(), ym))
  } catch {
    return []
  }
  const dates: string[] = []
  for (const f of files) {
    const m = /^(\d{4}-\d{2}-\d{2})\.summary\.json$/.exec(f)
    if (!m) continue
    const s = await readJson<DaySummary>(join(daysRoot(), ym, f))
    if (s && !s.empty) dates.push(m[1])
  }
  return dates
}
