import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DayDigest, DaySummary } from '@shared/types'

// claude를 실제로 부르지 않는다.
// 부를 때마다 이 헤드라인으로 답한다.
const reply = { headline: '새로 쓴 요약' }
vi.mock('../src/main/claude/run', async (orig) => ({
  ...(await orig<typeof import('../src/main/claude/run')>()),
  runClaude: vi.fn(async () => ({
    text: JSON.stringify({ headline: reply.headline, items: [], keywords: [] }),
    model: 'test-model'
  }))
}))
vi.mock('../src/main/claude/locate', () => ({
  locateClaude: async () => '/bin/claude',
  claudeDefaultModel: async () => null,
  claudeVersion: async () => 'test'
}))

const {
  activityPath,
  dayCandidatePath,
  dayDigestPath,
  daySummaryPath,
  initCache,
  readJson,
  writeJsonAtomic
} = await import('../src/main/cache')
const { digestHash } = await import('../src/main/pipeline/digest')
const { ensureDaySummary, ensurePeriodPart, getRangeStatus, resolveCandidate } = await import(
  '../src/main/pipeline/summarizer'
)

const DATE = '2026-08-03'

function digest(date: string, promptCount: number): DayDigest {
  return {
    date,
    projects:
      promptCount === 0
        ? []
        : [
            {
              cwd: '/proj',
              name: 'proj',
              branches: ['main'],
              sessionCount: 1,
              promptCount,
              toolCallCount: 0,
              tokens: { input: 0, output: 0 },
              prompts: Array.from({ length: promptCount }, (_, i) => ({ hhmm: '10:00', text: `p${i}` }))
            }
          ],
    totals: { sessionCount: 1, promptCount, toolCallCount: 0, tokens: { input: 0, output: 0 } },
    skippedLines: 0,
    builtAt: '2026-08-24T00:00:00.000Z'
  }
}

function summary(date: string, d: DayDigest, extra: Partial<DaySummary> = {}): DaySummary {
  return {
    date,
    digestHash: digestHash(d),
    model: 'default',
    generatedAt: '2026-08-24T00:00:00.000Z',
    headline: '처음 쓴 요약',
    items: [],
    promptCount: d.totals.promptCount,
    ...extra
  }
}

describe('이미 있는 요약을 덮지 않는다', () => {
  beforeEach(() => {
    initCache(mkdtempSync(join(tmpdir(), 'worklog-candidate-')))
  })

  it('지난 날짜를 다시 만들면 기존 요약은 그대로고 새 것은 비교 대기로 간다', async () => {
    const d = digest(DATE, 5)
    await writeJsonAtomic(daySummaryPath(DATE), summary(DATE, d))

    const got = await ensureDaySummary(DATE, { preCollected: d, force: true })
    expect(got.headline).toBe('처음 쓴 요약')
    expect((await readJson<DaySummary>(daySummaryPath(DATE)))?.headline).toBe('처음 쓴 요약')
    expect((await readJson<DaySummary>(dayCandidatePath(DATE)))?.headline).toBe('새로 쓴 요약')
  })

  it('새 요약을 고르면 바뀌고, 기존을 고르면 그 원본으로는 다시 밀린 날짜가 되지 않는다', async () => {
    const old = digest(DATE, 5)
    const grown = digest(DATE, 7)
    await writeJsonAtomic(daySummaryPath(DATE), summary(DATE, old))
    await ensureDaySummary(DATE, { preCollected: grown })

    const kept = await resolveCandidate(DATE, 'keep')
    expect(kept.headline).toBe('처음 쓴 요약')
    expect(existsSync(dayCandidatePath(DATE))).toBe(false)

    await writeJsonAtomic(activityPath('2026-08'), {
      version: 1,
      builtAt: '2026-08-24T00:00:00.000Z',
      days: { [DATE]: true }
    })
    const { status } = await getRangeStatus(DATE, DATE, { indexOnly: true })
    expect(status.summarizedDays).toEqual([DATE])
  })

  it('원본이 통째로 사라졌으면 활동 없음으로 덮지 않는다', async () => {
    await writeJsonAtomic(daySummaryPath(DATE), summary(DATE, digest(DATE, 5)))
    const got = await ensureDaySummary(DATE, { preCollected: digest(DATE, 0) })
    expect(got.empty).toBeUndefined()
    expect(got.headline).toBe('처음 쓴 요약')
  })
})

describe('밀린 날짜 판정', () => {
  beforeEach(async () => {
    initCache(mkdtempSync(join(tmpdir(), 'worklog-candidate-')))
    await writeJsonAtomic(activityPath('2026-08'), {
      version: 1,
      builtAt: '2026-08-24T00:00:00.000Z',
      days: { [DATE]: true }
    })
  })

  it('원본이 요약을 만들 때보다 줄었으면 밀린 날짜로 세지 않는다', async () => {
    // Claude Code가 보존 기간이 지난 세션 로그를 지운 경우다
    await writeJsonAtomic(daySummaryPath(DATE), summary(DATE, digest(DATE, 9)))
    await writeJsonAtomic(dayDigestPath(DATE), digest(DATE, 4))
    const { status } = await getRangeStatus(DATE, DATE, { indexOnly: true })
    expect(status.summarizedDays).toEqual([DATE])
  })

  it('원본이 늘었으면 밀린 날짜다', async () => {
    await writeJsonAtomic(daySummaryPath(DATE), summary(DATE, digest(DATE, 4)))
    await writeJsonAtomic(dayDigestPath(DATE), digest(DATE, 9))
    const { status } = await getRangeStatus(DATE, DATE, { indexOnly: true })
    expect(status.summarizedDays).toEqual([])
  })

  it('지금 원본으로 만든 새 요약이 비교를 기다리면 밀린 것이 아니라 고를 차례다', async () => {
    const grown = digest(DATE, 9)
    await writeJsonAtomic(daySummaryPath(DATE), summary(DATE, digest(DATE, 4)))
    await writeJsonAtomic(dayDigestPath(DATE), grown)
    await writeJsonAtomic(dayCandidatePath(DATE), summary(DATE, grown, { headline: '새 것' }))
    const { status } = await getRangeStatus(DATE, DATE, { indexOnly: true })
    expect(status.summarizedDays).toEqual([DATE])
    expect(status.candidateDays).toEqual([DATE])
  })
})

describe('기간 요약은 요약된 날짜만으로 만든다', () => {
  beforeEach(() => {
    initCache(mkdtempSync(join(tmpdir(), 'worklog-candidate-')))
  })

  it('요약이 없는 날짜가 섞여 있어도 거부하지 않고, 묶은 날짜를 남긴다', async () => {
    await writeJsonAtomic(activityPath('2026-08'), {
      version: 1,
      builtAt: '2026-08-24T00:00:00.000Z',
      // 주 전체를 인덱스에 넣는다.
      // 하나라도 비면 실제 ~/.claude를 훑는다.
      days: {
        '2026-08-03': true,
        '2026-08-04': true,
        '2026-08-05': false,
        '2026-08-06': false,
        '2026-08-07': false,
        '2026-08-08': false,
        '2026-08-09': false
      }
    })
    await writeJsonAtomic(daySummaryPath('2026-08-03'), summary('2026-08-03', digest('2026-08-03', 2)))
    const p = await ensurePeriodPart({ kind: 'week', key: '2026-W32' }, 'overview')
    expect(p.overview?.days).toEqual(['2026-08-03'])
  })
})
