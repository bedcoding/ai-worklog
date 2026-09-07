import { describe, expect, it } from 'vitest'
import { weekdayIndex, weekdayKo } from '../src/shared/dates'

describe('weekdayIndex', () => {
  it('0이 일요일이고 6이 토요일이다', () => {
    // 2026-09-06은 일요일, 2026-09-05는 토요일 (앱 로그로 확인한 실제 날짜)
    expect(weekdayIndex('2026-09-06')).toBe(0)
    expect(weekdayIndex('2026-09-05')).toBe(6)
    expect(weekdayIndex('2026-09-07')).toBe(1)
  })

  it('weekdayKo와 같은 날을 가리킨다', () => {
    const ko = ['일', '월', '화', '수', '목', '금', '토']
    for (const d of ['2026-01-01', '2026-06-15', '2026-09-05', '2026-12-31']) {
      expect(ko[weekdayIndex(d)]).toBe(weekdayKo(d))
    }
  })

  it('월 경계와 연 경계에서 어긋나지 않는다', () => {
    expect(weekdayIndex('2026-02-28')).toBe(weekdayIndex('2026-02-21'))
    expect(weekdayIndex('2027-01-01')).toBe((weekdayIndex('2026-12-31') + 1) % 7)
  })
})

describe('제외 요일 필터', () => {
  // activity.ts의 dropExcludedWeekdays와 같은 규칙. 그쪽은 설정을 읽어야 해서
  // electron 없이 부를 수 없으므로 판정 규칙만 여기서 고정한다
  const drop = (dates: string[], excluded: number[]): string[] => {
    const skip = new Set(excluded)
    return dates.filter((d) => !skip.has(weekdayIndex(d)))
  }

  const week = [
    '2026-08-31', // 월
    '2026-09-01', // 화
    '2026-09-02', // 수
    '2026-09-03', // 목
    '2026-09-04', // 금
    '2026-09-05', // 토
    '2026-09-06' // 일
  ]

  it('주말을 빼면 평일 5일이 남는다', () => {
    expect(drop(week, [0, 6])).toEqual([
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04'
    ])
  })

  it('빈 목록이면 아무것도 빼지 않는다', () => {
    expect(drop(week, [])).toEqual(week)
  })

  it('모든 요일을 빼면 비어 있다', () => {
    expect(drop(week, [0, 1, 2, 3, 4, 5, 6])).toEqual([])
  })
})
