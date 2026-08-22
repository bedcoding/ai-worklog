import { addDays, monthRange, shortDateKo, weekKeyOf, weekRange, ymOf } from './dates'

/**
 * 보는 구간의 단위. 일일보고가 루틴이므로 주간이 기본이다.
 * 한 달 목록을 기본으로 두면 오늘 하나 정리하려고 스무 줄을 지나야 하고,
 * '전체 정리하기'가 스무 번짜리 버튼이 된다.
 */
export type Span = 'week' | 'month'

/**
 * 지금 보고 있는 구간.
 *
 * 구간 자체가 아니라 그 안의 기준 날짜를 들고 있는다. 구간의 시작 날짜를 기준으로
 * 삼으면 단위를 바꿀 때마다 뒤로 밀린다. 주는 이전 달에서 시작할 수 있기 때문이다.
 * (2026-07-01 은 수요일이므로 그 주는 06-29 에 시작하고, 그 날짜로 달을 다시 잡으면
 * 7월이 6월이 된다.)
 */
export interface Cursor {
  span: Span
  /** 구간 안의 아무 날짜. 단위를 바꿔도 유지된다. */
  anchor: string
}

export function cursorOf(span: Span, anchor: string): Cursor {
  return { span, anchor }
}

/** 단위만 바꾼다. 기준 날짜를 유지해 구간이 밀리지 않는다. */
export function withSpan(c: Cursor, span: Span): Cursor {
  return { span, anchor: c.anchor }
}

/** 기간 요약 캐시 키 (주 "2026-W34", 월 "2026-08") */
export function keyOf(c: Cursor): string {
  return c.span === 'week' ? weekKeyOf(c.anchor) : ymOf(c.anchor)
}

export function rangeOf(c: Cursor): { start: string; end: string } {
  return c.span === 'week' ? weekRange(keyOf(c)) : monthRange(keyOf(c))
}

export function labelOf(c: Cursor): string {
  if (c.span === 'month') {
    const [y, m] = keyOf(c).split('-').map(Number)
    return `${y}년 ${m}월`
  }
  const { start, end } = rangeOf(c)
  return `${shortDateKo(start)} ~ ${shortDateKo(end)}`
}

/**
 * 구간을 앞뒤로 옮긴다. 주간은 7일, 월간은 달 수로 옮긴다.
 * 월간을 30일 더하기로 처리하면 달 길이 차이 때문에 어긋나므로 UTC 날짜 연산을 쓴다.
 * 월간의 기준 날짜는 1일로 맞춘다. 31일에서 다음 달로 옮길 자리가 없기 때문이다.
 */
export function shift(c: Cursor, delta: number): Cursor {
  if (c.span === 'week') return { span: 'week', anchor: addDays(c.anchor, delta * 7) }
  const [y, m] = ymOf(c.anchor).split('-').map(Number)
  const moved = new Date(Date.UTC(y, m - 1 + delta, 1))
  const mm = String(moved.getUTCMonth() + 1).padStart(2, '0')
  return { span: 'month', anchor: `${moved.getUTCFullYear()}-${mm}-01` }
}
