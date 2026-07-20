import { describe, expect, it } from 'vitest'
import {
  addDays,
  daysOfMonth,
  kstDateOf,
  kstHHMM,
  kstStartOfDayMs,
  shortDateKo,
  weekKeyOf,
  weekRange,
  weekdayKo
} from '@shared/dates'

describe('KST 날짜 유틸', () => {
  it('UTC 자정 직전/직후가 KST 날짜로 올바르게 갈린다', () => {
    // UTC 14:59 = KST 23:59 (같은 날), UTC 15:00 = KST 다음날 00:00
    expect(kstDateOf(Date.parse('2026-07-19T14:59:00.000Z'))).toBe('2026-07-19')
    expect(kstDateOf(Date.parse('2026-07-19T15:00:00.000Z'))).toBe('2026-07-20')
  })

  it('kstHHMM은 KST 시각을 준다', () => {
    expect(kstHHMM(Date.parse('2026-07-19T14:59:00.000Z'))).toBe('23:59')
    expect(kstHHMM(Date.parse('2026-07-19T15:10:00.000Z'))).toBe('00:10')
  })

  it('kstStartOfDayMs 라운드트립', () => {
    const ms = kstStartOfDayMs('2026-07-20')
    expect(kstDateOf(ms)).toBe('2026-07-20')
    expect(kstDateOf(ms - 1)).toBe('2026-07-19')
  })

  it('weekRange는 월~일이며 기준일을 포함한다', () => {
    for (const d of ['2026-07-20', '2026-07-26', '2026-01-01', '2025-12-31']) {
      const key = weekKeyOf(d)
      const { start, end } = weekRange(key)
      expect(weekdayKo(start)).toBe('월')
      expect(weekdayKo(end)).toBe('일')
      expect(start <= d && d <= end).toBe(true)
      expect(weekKeyOf(start)).toBe(key)
      expect(weekKeyOf(end)).toBe(key)
    }
  })

  it('addDays / daysOfMonth / shortDateKo', () => {
    expect(addDays('2026-07-31', 1)).toBe('2026-08-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    const feb = daysOfMonth('2024-02')
    expect(feb.length).toBe(29)
    expect(feb[0]).toBe('2024-02-01')
    expect(shortDateKo('2026-07-20')).toBe('7/20(월)')
  })
})
