import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { claudeWorkdir, daysRoot, readJson } from '../cache'
import { ymOf } from '@shared/dates'
import type { DayDigest, DaySummary } from '@shared/types'
import { collectDigests } from './collector'
import { isActiveDigest } from './digest'

export interface Activity {
  /** 활동이 있는 KST 날짜 (오름차순) */
  dates: string[]
  /** 원본 로그가 남아 있는 날짜의 다이제스트 — 없는 날짜는 요약 캐시만 존재 */
  digests: Map<string, DayDigest>
}

/**
 * 기간의 활동일을 구한다. 원본 로그 스캔 결과와 캐시된 요약의 합집합이다.
 * Claude Code가 오래된 세션 로그를 자체 보존 기간에 따라 삭제해도, 이미 요약해 둔
 * 날짜는 계속 보고에 남는다.
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
