import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { todayKst } from '@shared/dates'
import type { DayDigest } from '@shared/types'
import { dayDigestPath, initCache, writeJsonAtomic } from '../src/main/cache'
import { ensureDayDigest } from '../src/main/pipeline/summarizer'

/** 프롬프트 하나만 있는 최소 다이제스트 */
function digestAt(date: string, builtAt: string): DayDigest {
  return {
    date,
    projects: [
      {
        name: 'proj',
        cwd: '/proj',
        branches: ['main'],
        sessionCount: 1,
        promptCount: 1,
        toolCallCount: 0,
        tokens: { input: 1, output: 1 },
        prompts: [{ hhmm: '13:54', text: '작업' }]
      }
    ],
    totals: { sessionCount: 1, promptCount: 1, toolCallCount: 0, tokens: { input: 1, output: 1 } },
    skippedLines: 0,
    builtAt
  }
}

beforeEach(() => {
  initCache(mkdtempSync(join(tmpdir(), 'worklog-prov-')))
})

/**
 * cached 와 final 은 다른 것을 말한다. 이것을 하나로 묶어 '캐싱됨'만 적었더니
 * 오늘치가 몇 시간 낡은 채로 확정본처럼 보였다.
 */
describe('원본 내역의 출처', () => {
  it('그 날이 끝난 뒤 만든 캐시는 확정본이다', async () => {
    // 7/15 의 다이제스트를 7/16 에 만들었다
    await writeJsonAtomic(
      dayDigestPath('2026-07-15'),
      digestAt('2026-07-15', '2026-07-16T01:00:00.000Z')
    )
    const r = await ensureDayDigest('2026-07-15', { preferCache: true })
    expect(r.cached).toBe(true)
    expect(r.final).toBe(true)
  })

  it('그 날 도중에 만든 캐시는 확정본이 아니다', async () => {
    // 7/15 의 다이제스트를 7/15 낮(KST 18시)에 만들었다. 그 뒤 기록이 빠져 있다
    await writeJsonAtomic(
      dayDigestPath('2026-07-15'),
      digestAt('2026-07-15', '2026-07-15T09:00:00.000Z')
    )
    const r = await ensureDayDigest('2026-07-15', { preferCache: true })
    expect(r.cached).toBe(true)
    // preferCache 는 완결성을 안 보고 캐시를 쓴다. 그래서 낡은 것이 나올 수 있고,
    // 화면은 그 사실을 적어야 한다
    expect(r.final).toBe(false)
  })

  it('오늘치는 캐시에서 와도 확정본이 아니다', async () => {
    // 사용자가 발견한 바로 그 경우다. 행에는 '기록 읽는 중'이 뜨는데
    // 상세에는 '캐싱됨'이 떠서 서로 어긋나 보였다
    const today = todayKst()
    await writeJsonAtomic(dayDigestPath(today), digestAt(today, `${today}T12:35:00.000Z`))
    const r = await ensureDayDigest(today, { preferCache: true })
    expect(r.cached).toBe(true)
    expect(r.final).toBe(false)
  })

  // 스캔 경로(force)는 여기서 시험하지 않는다. ensureDayDigest 는 claudeDir 를
  // 받지 않아 실제 ~/.claude 를 읽게 되고, 테스트가 각자의 로그에 매달린다.
})
