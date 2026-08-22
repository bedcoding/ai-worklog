import { describe, expect, it } from 'vitest'
import { cursorOf, keyOf, labelOf, rangeOf, shift, withSpan } from '../src/shared/span'

describe('구간 커서', () => {
  it('주간은 그 날짜를 담는 월~일 구간을 만든다', () => {
    // 2026-08-23은 일요일이므로 8/17(월)~8/23(일) 주에 속한다
    const c = cursorOf('week', '2026-08-23')
    expect(rangeOf(c)).toEqual({ start: '2026-08-17', end: '2026-08-23' })
  })

  it('월간은 그 달 1일~말일 구간을 만든다', () => {
    const c = cursorOf('month', '2026-08-23')
    expect(rangeOf(c)).toEqual({ start: '2026-08-01', end: '2026-08-31' })
  })

  it('기간 요약 캐시 키를 만든다', () => {
    // key가 캐시 파일명이 되므로 형식이 바뀌면 기존 요약을 못 찾는다
    expect(keyOf(cursorOf('week', '2026-08-23'))).toBe('2026-W34')
    expect(keyOf(cursorOf('month', '2026-08-23'))).toBe('2026-08')
  })
})

describe('단위 전환', () => {
  it('단위를 바꿔도 구간이 밀리지 않는다', () => {
    // 회귀: 구간의 시작 날짜를 기준으로 삼으면 왕복할 때마다 한 달씩 뒤로 밀렸다.
    // 2026-07-01은 수요일이라 그 주가 06-29에 시작하고, 그 날짜로 달을 다시 잡으면
    // 7월이 6월이 됐다.
    const july = cursorOf('month', '2026-07-15')
    const week = withSpan(july, 'week')
    const back = withSpan(week, 'month')
    expect(keyOf(back)).toBe('2026-07')
  })

  it('달 첫날에서 왕복해도 그 달에 머문다', () => {
    // 가장 위험한 경우: 그 주가 이전 달에서 시작한다
    const c = cursorOf('month', '2026-07-01')
    expect(rangeOf(withSpan(c, 'week')).start).toBe('2026-06-29')
    expect(keyOf(withSpan(withSpan(c, 'week'), 'month'))).toBe('2026-07')
  })

  it('여러 번 왕복해도 그대로다', () => {
    let c = cursorOf('week', '2026-08-23')
    const before = keyOf(c)
    for (let i = 0; i < 5; i++) c = withSpan(withSpan(c, 'month'), 'week')
    expect(keyOf(c)).toBe(before)
  })
})

describe('구간 이동', () => {
  it('주간은 7일씩 움직인다', () => {
    const c = cursorOf('week', '2026-08-23')
    expect(rangeOf(shift(c, -1))).toEqual({ start: '2026-08-10', end: '2026-08-16' })
    expect(rangeOf(shift(c, 1))).toEqual({ start: '2026-08-24', end: '2026-08-30' })
  })

  it('월간은 달 수로 움직인다 (30일 더하기가 아니다)', () => {
    // 31일 달에서 30일을 더하면 같은 달에 머문다. 달 단위 연산이어야 한다.
    expect(keyOf(shift(cursorOf('month', '2026-01-15'), 1))).toBe('2026-02')
    expect(keyOf(shift(cursorOf('month', '2026-03-15'), -1))).toBe('2026-02')
  })

  it('말일에서 옮겨도 달을 건너뛰지 않는다', () => {
    // 1/31에 한 달을 더해 2/31을 만들면 3월로 넘어가 버린다
    expect(keyOf(shift(cursorOf('month', '2026-01-31'), 1))).toBe('2026-02')
  })

  it('연을 넘어가도 어긋나지 않는다', () => {
    expect(keyOf(shift(cursorOf('month', '2026-12-10'), 1))).toBe('2027-01')
    expect(keyOf(shift(cursorOf('month', '2026-01-10'), -1))).toBe('2025-12')
    const lastWeek = cursorOf('week', '2026-12-31')
    expect(rangeOf(shift(lastWeek, 1)).start > '2026-12-31').toBe(true)
  })

  it('여러 번 옮겨도 원래 자리로 돌아온다', () => {
    const w = cursorOf('week', '2026-08-23')
    expect(rangeOf(shift(shift(w, 5), -5))).toEqual(rangeOf(w))
    const m = cursorOf('month', '2026-08-15')
    expect(keyOf(shift(shift(m, 7), -7))).toBe(keyOf(m))
  })
})

describe('구간 표기', () => {
  it('월간은 연월로 적는다', () => {
    expect(labelOf(cursorOf('month', '2026-08-23'))).toBe('2026년 8월')
    // 한 자리 달에 0을 붙이지 않는다
    expect(labelOf(cursorOf('month', '2026-01-05'))).toBe('2026년 1월')
  })

  it('주간은 시작과 끝 날짜를 적는다', () => {
    expect(labelOf(cursorOf('week', '2026-08-23'))).toBe('8/17(월) ~ 8/23(일)')
  })
})
