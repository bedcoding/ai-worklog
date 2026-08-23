import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { DayDigest } from '@shared/types'
import { dayDigestPath, initCache, writeJsonAtomic } from '../src/main/cache'
import { ensureDayDigest } from '../src/main/pipeline/summarizer'

/** 소스 파일 하나를 가진 최소 다이제스트 */
function digestWith(
  date: string,
  builtAt: string,
  sources?: { path: string; mtimeMs: number }[]
): DayDigest {
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
    builtAt,
    ...(sources ? { sources } : {})
  }
}

let logFile = ''

/** 로그 파일을 하나 만들고 mtime 을 지정한 시각으로 맞춘다 */
function makeLog(mtimeMs: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'worklog-src-'))
  const f = join(dir, 'sess.jsonl')
  mkdirSync(join(f, '..'), { recursive: true })
  writeFileSync(f, '{}\n')
  utimesSync(f, mtimeMs / 1000, mtimeMs / 1000)
  return f
}

beforeEach(() => {
  initCache(mkdtempSync(join(tmpdir(), 'worklog-prov-')))
  logFile = makeLog(Date.parse('2026-07-15T09:00:00.000Z'))
})

/**
 * '하루가 끝난 뒤에 만들었으면 확정'은 사실이 아니었다. 8/22 다이제스트를 8/23 00:30
 * 에 만들었는데도 프롬프트 16개가 빠졌다. 긴 세션의 로그 파일에 옛 날짜 레코드가
 * 나중에 덧붙기 때문이다. 그래서 시각이 아니라 소스 파일의 mtime 을 본다.
 */
describe('원본 내역의 상태 판정', () => {
  it('소스 파일이 그대로면 캐시를 쓴다', async () => {
    await writeJsonAtomic(
      dayDigestPath('2026-07-15'),
      digestWith('2026-07-15', '2026-07-16T01:00:00.000Z', [
        { path: logFile, mtimeMs: Date.parse('2026-07-15T09:00:00.000Z') }
      ])
    )
    const r = await ensureDayDigest('2026-07-15', { preferCache: true })
    expect(r.state).toBe('cached')
  })

  it('소스 파일이 바뀌었으면 낡음이다. 하루가 지났더라도', async () => {
    // 8/22 가 정확히 이 경우였다. builtAt 은 하루 끝난 뒤인데 소스가 그 뒤에 바뀌었다
    await writeJsonAtomic(
      dayDigestPath('2026-07-15'),
      digestWith('2026-07-15', '2026-07-16T01:00:00.000Z', [
        { path: logFile, mtimeMs: Date.parse('2026-07-15T09:00:00.000Z') }
      ])
    )
    utimesSync(logFile, Date.parse('2026-07-17T00:00:00.000Z') / 1000, Date.parse('2026-07-17T00:00:00.000Z') / 1000)

    const r = await ensureDayDigest('2026-07-15', { preferCache: true })
    expect(r.state).toBe('stale')
  })

  it('소스 파일이 사라진 것은 낡음으로 보지 않는다', async () => {
    // 다시 훑어도 결과가 오히려 줄어든다. Claude Code 가 옛 로그를 지운 경우다
    await writeJsonAtomic(
      dayDigestPath('2026-07-15'),
      digestWith('2026-07-15', '2026-07-16T01:00:00.000Z', [
        { path: join(logFile, '..', '없는파일.jsonl'), mtimeMs: 1 }
      ])
    )
    const r = await ensureDayDigest('2026-07-15', { preferCache: true })
    expect(r.state).toBe('cached')
  })

  it('sources 가 없는 옛 캐시는 예전 규칙으로 판정한다', async () => {
    // 낡았다고 단정하면 옛 날짜를 열 때마다 2.5초 재스캔이 터진다
    await writeJsonAtomic(
      dayDigestPath('2026-07-15'),
      digestWith('2026-07-15', '2026-07-16T01:00:00.000Z')
    )
    expect((await ensureDayDigest('2026-07-15', { preferCache: true })).state).toBe('cached')

    // 그 날 도중(KST 18시)에 만든 옛 캐시는 낡음
    await writeJsonAtomic(
      dayDigestPath('2026-07-16'),
      digestWith('2026-07-16', '2026-07-16T09:00:00.000Z')
    )
    expect((await ensureDayDigest('2026-07-16', { preferCache: true })).state).toBe('stale')
  })

  // 요약 경로(preferCache 없음)가 판정 불가를 낡음으로 보는 것은 여기서 시험하지
  // 않는다. 낡음으로 보면 곧바로 재스캔에 들어가는데 ensureDayDigest 는 claudeDir 를
  // 받지 않아 실제 ~/.claude 를 읽는다. 테스트가 각자의 로그에 매달린다.
})
