/**
 * KST(UTC+9) 고정 날짜 유틸.
 * 로그 timestamp는 UTC ISO 문자열이므로, +9h 이동 후 UTC getter로 읽으면
 * 실행 머신의 타임존과 무관하게 KST 달력 날짜가 나온다.
 */
const KST_OFFSET_MS = 9 * 3600 * 1000
const DAY_MS = 86400_000

function kstView(tsMs: number): Date {
  return new Date(tsMs + KST_OFFSET_MS)
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** epoch ms → KST 달력 날짜 'YYYY-MM-DD' */
export function kstDateOf(tsMs: number): string {
  const d = kstView(tsMs)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** epoch ms → KST 'HH:mm' */
export function kstHHMM(tsMs: number): string {
  const d = kstView(tsMs)
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

/** ISO 문자열 → KST 'YYYY-MM-DD HH:mm' 표기 (표시 전용) */
export function kstDateTimeKo(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  return `${kstDateOf(ms)} ${kstHHMM(ms)}`
}

/** KST 날짜 'YYYY-MM-DD'의 0시(epoch ms) */
export function kstStartOfDayMs(date: string): number {
  return Date.parse(`${date}T00:00:00+09:00`)
}

export function ymOf(date: string): string {
  return date.slice(0, 7)
}

/** 'YYYY-MM' → 그 달의 모든 날짜 */
export function daysOfMonth(ym: string): string[] {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return Array.from({ length: last }, (_, i) => `${ym}-${pad(i + 1)}`)
}

/** 오늘의 KST 날짜 */
export function todayKst(): string {
  return kstDateOf(Date.now())
}

export function addDays(date: string, n: number): string {
  return kstDateOf(kstStartOfDayMs(date) + n * DAY_MS)
}

/** ISO 8601 주차: 'YYYY-MM-DD' → 'YYYY-Www' */
export function weekKeyOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  const dayNum = (d.getUTCDay() + 6) % 7 // 월=0
  d.setUTCDate(d.getUTCDate() - dayNum + 3) // 그 주의 목요일
  const isoYear = d.getUTCFullYear()
  const jan4 = new Date(Date.UTC(isoYear, 0, 4))
  const week1Monday = Date.UTC(isoYear, 0, 4 - ((jan4.getUTCDay() + 6) % 7))
  const week = Math.floor((d.getTime() - week1Monday) / (7 * DAY_MS)) + 1
  return `${isoYear}-W${pad(week)}`
}

/** 'YYYY-Www' → 월요일~일요일 날짜 범위 */
export function weekRange(key: string): { start: string; end: string } {
  const [y, w] = key.split('-W').map(Number)
  const jan4 = new Date(Date.UTC(y, 0, 4))
  const week1Monday = Date.UTC(y, 0, 4 - ((jan4.getUTCDay() + 6) % 7))
  const mondayMs = week1Monday + (w - 1) * 7 * DAY_MS
  const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10)
  return { start: iso(mondayMs), end: iso(mondayMs + 6 * DAY_MS) }
}

export function monthRange(ym: string): { start: string; end: string } {
  const days = daysOfMonth(ym)
  return { start: days[0], end: days[days.length - 1] }
}

const WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토']

/** 'YYYY-MM-DD' → '월'/'화'/... */
export function weekdayKo(date: string): string {
  return WEEKDAYS_KO[weekdayIndex(date)]
}

/** 'YYYY-MM-DD' → 0(일) ~ 6(토). 날짜는 KST로 정규화돼 있으므로 UTC로 읽는다 */
export function weekdayIndex(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay()
}

/** 'YYYY-MM-DD' → '7/1(화)' */
export function shortDateKo(date: string): string {
  const [, m, d] = date.split('-').map(Number)
  return `${m}/${d}(${weekdayKo(date)})`
}
