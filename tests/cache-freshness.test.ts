import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { kstStartOfDayMs } from '@shared/dates'
import { initCache, dayDigestPath, writeJsonAtomic, readJson } from '../src/main/cache'
import { collectDigests } from '../src/main/pipeline/collector'

const DAY_MS = 86400_000

function tmpBase(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('다이제스트 캐시 완결성 (하루 도중 캐시가 확정본으로 굳지 않아야 함)', () => {
  // ensureDayDigest의 isComplete와 동일한 판정 규칙
  const isComplete = (date: string, builtAt: string): boolean => {
    const ms = Date.parse(builtAt)
    return Number.isFinite(ms) && ms >= kstStartOfDayMs(date) + DAY_MS
  }

  it('하루 도중(18시)에 만들어진 캐시는 확정본이 아니다', () => {
    expect(isComplete('2026-07-15', '2026-07-15T09:00:00.000Z')).toBe(false) // KST 18:00
  })

  it('그 날이 끝난 뒤 만들어진 캐시만 확정본이다', () => {
    expect(isComplete('2026-07-15', '2026-07-16T01:00:00.000Z')).toBe(true) // KST 7/16 10:00
    expect(isComplete('2026-07-15', '2026-07-15T15:00:00.000Z')).toBe(true) // KST 7/16 00:00
  })

  it('builtAt이 없는 구버전 캐시는 확정본으로 보지 않는다', () => {
    expect(isComplete('2026-07-15', '')).toBe(false)
  })
})

describe('writeJsonAtomic', () => {
  it('같은 파일에 동시에 써도 tmp 파일이 충돌하지 않고 유효한 JSON이 남는다', async () => {
    const base = tmpBase('worklog-atomic-')
    initCache(base)
    const file = join(base, 'concurrent.json')
    await Promise.all(
      Array.from({ length: 50 }, (_, i) => writeJsonAtomic(file, { i, payload: 'x'.repeat(200) }))
    )
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { i: number }
    expect(typeof parsed.i).toBe('number')
    // 고아 tmp 파일이 남지 않아야 한다
    expect(readdirSync(base).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })
})

describe('isSessionFirst 판정이 스캔 범위에 의존하지 않는다', () => {
  it('자정을 넘긴 세션도 하루 단위 스캔과 기간 스캔의 다이제스트가 같다', async () => {
    const base = tmpBase('worklog-scope-')
    const dir = join(base, 'projects', 'p1')
    mkdirSync(dir, { recursive: true })
    const rec = (ts: string, text: string): string =>
      JSON.stringify({
        type: 'user',
        timestamp: ts,
        cwd: '/Users/test/proj',
        sessionId: 's1',
        message: { role: 'user', content: [{ type: 'text', text }] }
      })
    writeFileSync(
      join(dir, 's1.jsonl'),
      [
        rec('2026-07-14T14:30:00.000Z', '7/14 23:30 세션 시작'), // KST 7/14
        rec('2026-07-14T16:20:00.000Z', '7/15 01:20 자정 넘긴 작업'), // KST 7/15
        rec('2026-07-15T05:00:00.000Z', '7/15 14:00 낮 작업')
      ].join('\n')
    )

    const single = await collectDigests('2026-07-15', '2026-07-15', { claudeDir: base })
    const range = await collectDigests('2026-07-13', '2026-07-19', { claudeDir: base })

    expect(JSON.stringify(single.digests.get('2026-07-15')?.projects)).toBe(
      JSON.stringify(range.digests.get('2026-07-15')?.projects)
    )
  })
})

describe('cache 경로 유틸', () => {
  it('digest 경로는 월별 디렉토리로 나뉜다', async () => {
    const base = tmpBase('worklog-path-')
    initCache(base)
    expect(dayDigestPath('2026-07-20')).toBe(join(base, 'days', '2026-07', '2026-07-20.digest.json'))
    await writeJsonAtomic(dayDigestPath('2026-07-20'), { date: '2026-07-20' })
    expect(await readJson<{ date: string }>(dayDigestPath('2026-07-20'))).toEqual({
      date: '2026-07-20'
    })
  })
})
