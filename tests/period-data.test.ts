import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { DaySummary } from '@shared/types'
import { initCache, periodPath, writeJsonAtomic } from '../src/main/cache'
import {
  getCachedPeriod,
  renderHeadlineLines,
  renderItemLines
} from '../src/main/pipeline/summarizer'

function day(date: string, over: Partial<DaySummary> = {}): DaySummary {
  return {
    date,
    digestHash: 'h',
    model: 'default',
    generatedAt: '2026-08-23T00:00:00.000Z',
    ...over
  }
}

const WEEK: DaySummary[] = [
  day('2026-08-21', {
    headline: '고객 피드백 분류 운영',
    items: [{ project: 'ai-worklog', work: '피드백 분류 기준 정리' }],
    keywords: ['피드백']
  }),
  day('2026-08-22', { empty: true }),
  day('2026-08-23', {
    headline: '업무일지 앱 요약 기능 검증',
    items: [
      { project: 'ai-worklog', work: '일일 요약 생성 기능 실사용 테스트' },
      { project: 'todo-alarm', work: '버튼 배치 일관성 개선' }
    ]
  })
]

describe('한 줄 요약에 넘기는 데이터', () => {
  it('날짜별 헤드라인만 담는다', () => {
    const out = renderHeadlineLines(WEEK)
    expect(out).toBe(
      ['8/21(금): 고객 피드백 분류 운영', '8/23(일): 업무일지 앱 요약 기능 검증'].join('\n')
    )
  })

  it('항목이 섞여 들어가지 않는다', () => {
    // 항목까지 넘어가면 한 줄 요약이 항목을 압축한 문장이 되어 분리한 뜻이 없어진다
    const out = renderHeadlineLines(WEEK)
    expect(out).not.toContain('[ai-worklog]')
    expect(out).not.toContain('피드백 분류 기준 정리')
  })

  it('헤드라인이 없으면 원문 앞머리로 대신한다', () => {
    const out = renderHeadlineLines([day('2026-08-20', { fallbackText: 'JSON 파싱 실패 원문' })])
    expect(out).toBe('8/20(목): JSON 파싱 실패 원문')
  })
})

describe('상세 요약에 넘기는 데이터', () => {
  it('날짜로 묶은 항목만 담는다', () => {
    const out = renderItemLines(WEEK)
    expect(out).toBe(
      [
        '8/21(금)',
        '  - [ai-worklog] 피드백 분류 기준 정리',
        '8/23(일)',
        '  - [ai-worklog] 일일 요약 생성 기능 실사용 테스트',
        '  - [todo-alarm] 버튼 배치 일관성 개선'
      ].join('\n')
    )
  })

  it('헤드라인이 섞여 들어가지 않는다', () => {
    const out = renderItemLines(WEEK)
    expect(out).not.toContain('고객 피드백 분류 운영')
    expect(out).not.toContain('업무일지 앱 요약 기능 검증')
  })

  it('항목이 없는 날은 담지 않는다', () => {
    // 날짜만 있고 그 아래가 비면 claude 가 그 날 무언가 있었다고 읽는다
    expect(renderItemLines([day('2026-08-19', { headline: '헤드라인만' })])).toBe('')
  })
})

describe('두 데이터 모두', () => {
  it('활동 없는 날은 건너뛴다', () => {
    expect(renderHeadlineLines(WEEK)).not.toContain('8/22')
    expect(renderItemLines(WEEK)).not.toContain('8/22')
  })

  it('요약이 없으면 빈 문자열이다', () => {
    expect(renderHeadlineLines([])).toBe('')
    expect(renderItemLines([])).toBe('')
  })
})

describe('옛 캐시 읽기', () => {
  // 부분으로 나누기 전까지 디스크 형태가 두 번 바뀌었다. 이미 만들어 둔 요약이
  // 빈칸으로 보이면 안 되므로 세 형태 모두 읽어야 한다.
  const base = { key: '2026-W34', kind: 'week', start: '2026-08-17', end: '2026-08-23' }

  it('text 하나만 있던 요약을 내용으로 읽는다', async () => {
    initCache(mkdtempSync(join(tmpdir(), 'worklog-period-')))
    await writeJsonAtomic(periodPath('2026-W34'), {
      ...base,
      text: '# 주간 업무 보고\n- 요약 기능 검증',
      model: 'default',
      generatedAt: '2026-08-22T19:32:52.997Z'
    })

    const p = await getCachedPeriod('2026-W34')
    expect(p?.detail?.text).toBe('# 주간 업무 보고\n- 요약 기능 검증')
    // 최상위에 있던 메타데이터를 그 부분의 것으로 옮긴다
    expect(p?.detail?.generatedAt).toBe('2026-08-22T19:32:52.997Z')
    expect(p?.detail?.end).toBe('2026-08-23')
    expect(p?.overview).toBeNull()
  })

  it('부분이 문자열이던 형태도 읽는다', async () => {
    initCache(mkdtempSync(join(tmpdir(), 'worklog-period-')))
    await writeJsonAtomic(periodPath('2026-W34'), {
      ...base,
      overview: '업무일지 앱 요약 기능 검증',
      detail: '* [ai-worklog] 검증',
      model: 'haiku',
      generatedAt: '2026-08-22T19:53:48.708Z'
    })

    const p = await getCachedPeriod('2026-W34')
    expect(p?.overview?.text).toBe('업무일지 앱 요약 기능 검증')
    expect(p?.detail?.text).toBe('* [ai-worklog] 검증')
    expect(p?.overview?.model).toBe('haiku')
  })

  it('빈 문자열이던 부분은 없는 것으로 읽는다', async () => {
    // ''를 부분으로 만들면 화면이 빈 굵은 줄과 생성 시각만 그린다
    initCache(mkdtempSync(join(tmpdir(), 'worklog-period-')))
    await writeJsonAtomic(periodPath('2026-W34'), { ...base, overview: '', detail: '내용' })
    const p = await getCachedPeriod('2026-W34')
    expect(p?.overview).toBeNull()
    expect(p?.detail?.text).toBe('내용')
  })
})

describe('덜 반영된 부분 표시', () => {
  it('부분마다 따로 판정한다', async () => {
    // 제목은 수요일에, 내용은 일요일에 만들 수 있다. 하나로 판정하면 한쪽이 거짓이 된다
    initCache(mkdtempSync(join(tmpdir(), 'worklog-period-')))
    await writeJsonAtomic(periodPath('2026-W34'), {
      key: '2026-W34',
      kind: 'week',
      start: '2026-08-17',
      end: '2026-08-23',
      overview: { text: '제목', end: '2026-08-19', model: 'default', generatedAt: 'x' },
      detail: { text: '내용', end: '2026-08-23', model: 'default', generatedAt: 'x' }
    })

    const p = await getCachedPeriod('2026-W34')
    expect(p?.overview?.stale).toBe(true)
    expect(p?.detail?.stale).toBe(false)
  })
})
