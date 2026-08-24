import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { DayDigest, DaySummary } from '@shared/types'
import {
  activityPath,
  dayDigestPath,
  daySummaryPath,
  initCache,
  writeJsonAtomic
} from '../src/main/cache'
import { digestHash } from '../src/main/pipeline/digest'
import { getRangeStatus } from '../src/main/pipeline/summarizer'

function digest(date: string, promptCount: number): DayDigest {
  return {
    date,
    projects: [
      {
        cwd: '/proj',
        name: 'proj',
        branches: ['main'],
        sessionCount: 1,
        promptCount,
        toolCallCount: 0,
        tokens: { input: 0, output: 0 },
        prompts: Array.from({ length: promptCount }, (_, i) => ({
          hhmm: `10:0${i}`,
          text: `p${i}`
        }))
      }
    ],
    totals: {
      sessionCount: 1,
      promptCount,
      toolCallCount: 0,
      tokens: { input: 0, output: 0 }
    },
    skippedLines: 0,
    builtAt: '2026-08-24T00:00:00.000Z'
  }
}

function summary(date: string, hash: string): DaySummary {
  return {
    date,
    digestHash: hash,
    model: 'default',
    generatedAt: '2026-08-24T00:00:00.000Z',
    headline: '무언가 했다'
  }
}

describe('요약이 낡았는지 판정', () => {
  beforeEach(() => {
    initCache(mkdtempSync(join(tmpdir(), 'worklog-stale-')))
  })

  it('원본이 달라진 날짜는 요약 파일이 있어도 끝난 것으로 세지 않는다', async () => {
    // 두 날짜 모두 활동일로 인덱스에 넣는다. indexOnly 라 원본은 읽지 않는다
    await writeJsonAtomic(activityPath('2026-08'), {
      version: 1,
      builtAt: '2026-08-24T00:00:00.000Z',
      days: { '2026-08-01': true, '2026-08-02': true }
    })

    // 8/01: 요약의 해시가 지금 다이제스트와 같다 (그대로 쓸 수 있다)
    const fresh = digest('2026-08-01', 3)
    await writeJsonAtomic(dayDigestPath('2026-08-01'), fresh)
    await writeJsonAtomic(daySummaryPath('2026-08-01'), summary('2026-08-01', digestHash(fresh)))

    // 8/02: 요약을 만든 뒤 원본 파싱이 달라져 프롬프트가 줄었다
    const changed = digest('2026-08-02', 1)
    await writeJsonAtomic(dayDigestPath('2026-08-02'), changed)
    await writeJsonAtomic(daySummaryPath('2026-08-02'), summary('2026-08-02', 'oldhash'))

    const { status } = await getRangeStatus('2026-08-01', '2026-08-02', { indexOnly: true })
    expect(status.activeDays).toEqual(['2026-08-01', '2026-08-02'])
    expect(status.summarizedDays).toEqual(['2026-08-01'])
  })

  it('다이제스트 캐시가 없으면 판단 근거가 없으므로 끝난 것으로 둔다', async () => {
    await writeJsonAtomic(activityPath('2026-08'), {
      version: 1,
      builtAt: '2026-08-24T00:00:00.000Z',
      days: { '2026-08-01': true }
    })
    // 요약만 있고 다이제스트가 없다
    await writeJsonAtomic(daySummaryPath('2026-08-01'), summary('2026-08-01', 'anyhash'))

    const { status } = await getRangeStatus('2026-08-01', '2026-08-01', { indexOnly: true })
    expect(status.summarizedDays).toEqual(['2026-08-01'])
  })
})
