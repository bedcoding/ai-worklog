import { describe, expect, it } from 'vitest'
import { groupByProject, renderGroupedItems } from '@shared/day-items'
import type { DaySummaryItem } from '@shared/types'

const item = (project: string, work: string): DaySummaryItem => ({ project, work })

describe('groupByProject', () => {
  it('같은 프로젝트를 한 덩이로 묶는다', () => {
    expect(
      groupByProject([
        item('total-claude', '문구 교정'),
        item('total-claude', 'UI 개편'),
        item('pipeline', '분류 기준 정의')
      ])
    ).toEqual([
      { project: 'total-claude', works: ['문구 교정', 'UI 개편'] },
      { project: 'pipeline', works: ['분류 기준 정의'] }
    ])
  })

  it('처음 나온 순서를 지킨다', () => {
    // 이름순으로 정렬하면 요약이 만든 흐름이 흐트러진다
    const groups = groupByProject([item('zebra', 'a'), item('alpha', 'b')])
    expect(groups.map((g) => g.project)).toEqual(['zebra', 'alpha'])
  })

  it('떨어져 있던 같은 프로젝트도 처음 나온 자리로 모은다', () => {
    const groups = groupByProject([
      item('ai-worklog', 'a'),
      item('pipeline', 'b'),
      item('ai-worklog', 'c')
    ])
    expect(groups).toEqual([
      { project: 'ai-worklog', works: ['a', 'c'] },
      { project: 'pipeline', works: ['b'] }
    ])
  })

  it('빈 목록은 빈 결과다', () => {
    expect(groupByProject([])).toEqual([])
  })
})

describe('renderGroupedItems', () => {
  it('프로젝트 줄 아래에 업무를 놓는다', () => {
    expect(
      renderGroupedItems([
        item('ai-worklog', '요약 기능 검증'),
        item('ai-worklog', 'UI 일관성 개선'),
        item('pipeline', '분류 기준 정의')
      ])
    ).toBe(
      ['[ai-worklog]', '요약 기능 검증', 'UI 일관성 개선', '', '[pipeline]', '분류 기준 정의'].join(
        '\n'
      )
    )
  })

  it('업무 줄에 프로젝트를 다시 붙이지 않는다', () => {
    const out = renderGroupedItems([item('ai-worklog', '요약 기능 검증')])
    expect(out.split('\n')[1]).toBe('요약 기능 검증')
  })
})
