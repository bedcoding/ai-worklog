import { describe, expect, it } from 'vitest'
import type { DaySummary } from '@shared/types'

/**
 * SummaryView 의 검색 판정을 그대로 옮긴 것.
 * 컴포넌트는 electron/react 에 얽혀 있어 판정 규칙만 따로 검증한다.
 */
function hitItems(s: DaySummary | undefined, q: string): { project: string; work: string }[] {
  if (!s?.items || !q) return []
  const k = q.toLowerCase()
  return s.items
    .filter((i) => `${i.work ?? ''} ${i.project ?? ''}`.toLowerCase().includes(k))
    .map((i) => ({ project: i.project ?? '', work: i.work ?? '' }))
}

function matchesQuery(s: DaySummary | undefined, q: string): boolean {
  if (!q) return true
  if (!s) return false
  const k = q.toLowerCase()
  if ((s.headline ?? '').toLowerCase().includes(k)) return true
  if ((s.keywords ?? []).some((w) => w.toLowerCase().includes(k))) return true
  return hitItems(s, q).length > 0
}

const day = (over: Partial<DaySummary> = {}): DaySummary => ({
  date: '2026-08-26',
  digestHash: 'h',
  model: 'default',
  generatedAt: '2026-08-26T00:00:00.000Z',
  ...over
})

describe('요약 검색 판정', () => {
  it('제목에서 찾는다', () => {
    const s = day({ headline: '사전구매 기능 개발' })
    expect(matchesQuery(s, '사전구매')).toBe(true)
    expect(matchesQuery(s, '없는말')).toBe(false)
  })

  it('항목의 작업과 프로젝트에서도 찾는다', () => {
    const s = day({
      headline: '무관한 제목',
      items: [{ project: 'backoffice', work: '배너 정렬 수정' }]
    })
    expect(matchesQuery(s, '배너')).toBe(true)
    expect(matchesQuery(s, 'backoffice')).toBe(true)
  })

  it('키워드에서도 찾는다', () => {
    const s = day({ headline: '무관', keywords: ['라이브채팅'] })
    expect(matchesQuery(s, '라이브채팅')).toBe(true)
  })

  it('대소문자를 가리지 않는다', () => {
    const s = day({ headline: 'API 영향도 맵' })
    expect(matchesQuery(s, 'api')).toBe(true)
    expect(matchesQuery(s, 'API')).toBe(true)
  })

  it('검색어가 비면 모두 통과시킨다', () => {
    expect(matchesQuery(day({ headline: '아무거나' }), '')).toBe(true)
    // 요약이 없는 날짜도 빈 검색어에서는 걸러내지 않는다
    expect(matchesQuery(undefined, '')).toBe(true)
  })

  it('요약이 없는 날짜는 검색 중에 빠진다', () => {
    // 걸릴 내용 자체가 없다. 목록에 남으면 왜 걸렸는지 설명할 수 없다
    expect(matchesQuery(undefined, '사전구매')).toBe(false)
  })

  it('제목에 없고 항목에만 걸린 것을 골라낸다', () => {
    const s = day({
      headline: '무관한 제목',
      items: [
        { project: 'a', work: '배너 정렬 수정' },
        { project: 'b', work: '관계 없는 일' }
      ]
    })
    const hits = hitItems(s, '배너')
    expect(hits).toHaveLength(1)
    expect(hits[0].work).toBe('배너 정렬 수정')
  })
})
