import type { DaySummaryItem } from './types'

export interface ProjectGroup {
  project: string
  works: string[]
}

/**
 * 항목을 프로젝트로 묶는다. 같은 프로젝트가 열 줄이면 [프로젝트]도 열 번 찍혀,
 * 정작 다른 부분인 업무 내용이 반복되는 태그에 밀린다.
 *
 * 처음 나온 순서를 지킨다. 이름순으로 정렬하면 요약이 만든 흐름이 흐트러진다.
 * 떨어져 있던 같은 프로젝트는 처음 나온 자리로 모인다.
 */
export function groupByProject(items: DaySummaryItem[]): ProjectGroup[] {
  const groups: ProjectGroup[] = []
  const at = new Map<string, ProjectGroup>()
  for (const item of items) {
    let g = at.get(item.project)
    if (!g) {
      g = { project: item.project, works: [] }
      at.set(item.project, g)
      groups.push(g)
    }
    g.works.push(item.work)
  }
  return groups
}

/**
 * 묶은 항목을 텍스트로 옮긴다. 화면에 보이는 것과 복사되는 것이 같아야 한다.
 * 업무 줄에는 [프로젝트]를 다시 붙이지 않는다. 위에 이미 있다.
 */
export function renderGroupedItems(items: DaySummaryItem[]): string {
  return groupByProject(items)
    .map((g) => [`[${g.project}]`, ...g.works].join('\n'))
    .join('\n\n')
}
