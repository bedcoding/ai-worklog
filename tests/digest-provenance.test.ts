import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { DayDigest } from '@shared/types'
import { dayDigestPath, initCache, writeJsonAtomic } from '../src/main/cache'
import { ensureDayDigest } from '../src/main/pipeline/summarizer'

/** 소스 파일 목록을 지정할 수 있는 최소 다이제스트 */
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

/** 픽스처 로그 파일의 mtime */
const AT = Date.parse('2026-07-15T09:00:00.000Z')
/** 그 날이 끝난 뒤 시각. 예전 규칙이라면 '확정'으로 봤을 값 */
const AFTER_DAY = '2026-07-16T01:00:00.000Z'
let logFile = ''
/** 스캔이 실제 ~/.claude 를 읽지 않도록 주는 빈 로그 디렉토리 */
let emptyDir = ''

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
  logFile = makeLog(AT)
  emptyDir = mkdtempSync(join(tmpdir(), 'worklog-empty-'))
})

/**
 * '하루가 끝난 뒤에 만들었으면 확정'은 사실이 아니었다. 8/22 다이제스트를 8/23 00:30
 * 에 만들었는데도 프롬프트 16개가 빠졌다. 긴 세션의 로그 파일에 옛 날짜 레코드가
 * 나중에 덧붙기 때문이다. 그래서 시각이 아니라 소스 파일의 mtime 을 본다.
 *
 * 낡았으면 곧바로 다시 읽는다. state 가 'scanned' 면 캐시를 쓰지 않기로 판정한 것이다.
 * 스캔 경로에는 빈 로그 디렉토리를 주입해 실제 ~/.claude(500MB)를 읽지 않게 한다.
 * 여기서 보는 것은 판정 결과다.
 */
describe('원본 내역 캐시를 쓸지 판정', () => {
  it('소스 파일이 그대로면 캐시를 쓴다', async () => {
    await writeJsonAtomic(
      dayDigestPath('2026-07-15'),
      digestWith('2026-07-15', AFTER_DAY, [{ path: logFile, mtimeMs: AT }])
    )
    expect((await ensureDayDigest('2026-07-15', { claudeDir: emptyDir })).state).toBe('cached')
  })

  it('하루가 끝난 뒤에 만들었어도 소스가 바뀌면 다시 읽는다', async () => {
    // 8/22 가 정확히 이 경우였다. builtAt 은 하루 끝난 뒤인데 소스가 그 뒤에 바뀌었다
    await writeJsonAtomic(
      dayDigestPath('2026-07-15'),
      digestWith('2026-07-15', AFTER_DAY, [{ path: logFile, mtimeMs: AT }])
    )
    const later = Date.parse('2026-07-17T00:00:00.000Z')
    utimesSync(logFile, later / 1000, later / 1000)

    expect((await ensureDayDigest('2026-07-15', { claudeDir: emptyDir })).state).toBe('scanned')
  })

  it('소스 파일이 사라진 것은 낡음으로 보지 않는다', async () => {
    // 다시 읽으면 결과가 오히려 줄어든다. Claude Code 가 옛 로그를 지운 경우다
    await writeJsonAtomic(
      dayDigestPath('2026-07-15'),
      digestWith('2026-07-15', AFTER_DAY, [
        { path: join(logFile, '..', '없는파일.jsonl'), mtimeMs: 1 }
      ])
    )
    expect((await ensureDayDigest('2026-07-15', { claudeDir: emptyDir })).state).toBe('cached')
  })

  it('sources 가 없는 옛 캐시는 쓰지 않는다', async () => {
    // 판정할 수 없으면 믿지 않는다. 한 번 다시 읽으면 sources 가 붙어
    // 그 뒤로는 stat 몇 번으로 끝난다
    await writeJsonAtomic(dayDigestPath('2026-07-15'), digestWith('2026-07-15', AFTER_DAY))
    expect((await ensureDayDigest('2026-07-15', { claudeDir: emptyDir })).state).toBe('scanned')
  })
})
