import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectDigests } from '../src/main/pipeline/collector'
import { digestHash } from '../src/main/pipeline/digest'

function makeFixture(files: Record<string, string[]>): string {
  const base = mkdtempSync(join(tmpdir(), 'worklog-collector-'))
  for (const [rel, lines] of Object.entries(files)) {
    const filePath = join(base, 'projects', rel)
    mkdirSync(join(filePath, '..'), { recursive: true })
    writeFileSync(filePath, lines.join('\n') + '\n')
  }
  return base
}

const CWD = '/Users/test/proj-a'

function user(ts: string, text: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'user',
    timestamp: ts,
    cwd: CWD,
    gitBranch: 'main',
    sessionId: 's1',
    message: { role: 'user', content: [{ type: 'text', text }] },
    ...extra
  })
}

function assistant(ts: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: ts,
    cwd: CWD,
    gitBranch: 'main',
    sessionId: 's1',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', name: 'Bash' }, { type: 'text', text: 'ok' }],
      usage: { input_tokens: 100, output_tokens: 50 }
    },
    ...extra
  })
}

describe('collectDigests', () => {
  it('자정을 넘는 세션은 레코드 단위 KST 날짜로 분리된다', async () => {
    // UTC 14:50 = KST 7/19 23:50, UTC 15:10 = KST 7/20 00:10
    const base = makeFixture({
      'p1/s1.jsonl': [
        user('2026-07-19T14:50:00.000Z', '어제 밤 작업'),
        user('2026-07-19T15:10:00.000Z', '자정 넘긴 작업')
      ]
    })
    const { digests } = await collectDigests('2026-07-19', '2026-07-20', { claudeDir: base })
    expect(digests.get('2026-07-19')?.totals.promptCount).toBe(1)
    expect(digests.get('2026-07-20')?.totals.promptCount).toBe(1)
    expect(digests.get('2026-07-19')?.projects[0].prompts[0].hhmm).toBe('23:50')
  })

  it('범위 밖 레코드는 제외된다', async () => {
    const base = makeFixture({
      'p1/s1.jsonl': [
        user('2026-07-18T10:00:00.000Z', '범위 이전'),
        user('2026-07-19T10:00:00.000Z', '범위 안'),
        user('2026-07-20T20:00:00.000Z', '범위 이후')
      ]
    })
    const { digests } = await collectDigests('2026-07-19', '2026-07-19', { claudeDir: base })
    expect([...digests.keys()]).toEqual(['2026-07-19'])
    expect(digests.get('2026-07-19')?.totals.promptCount).toBe(1)
  })

  it('깨진 라인은 건너뛰고 skippedLines에 집계된다', async () => {
    const base = makeFixture({
      'p1/s1.jsonl': ['{corrupt json!!!', user('2026-07-19T10:00:00.000Z', '정상')]
    })
    const { digests, skippedLines } = await collectDigests('2026-07-19', '2026-07-19', {
      claudeDir: base
    })
    expect(skippedLines).toBe(1)
    expect(digests.get('2026-07-19')?.totals.promptCount).toBe(1)
  })

  it('sidechain·tool_result·합성 프롬프트·비대상 타입은 제외한다', async () => {
    const base = makeFixture({
      'p1/s1.jsonl': [
        user('2026-07-19T10:00:00.000Z', '진짜 프롬프트'),
        user('2026-07-19T10:01:00.000Z', '서브에이전트', { isSidechain: true }),
        JSON.stringify({
          type: 'user',
          timestamp: '2026-07-19T10:02:00.000Z',
          cwd: CWD,
          sessionId: 's1',
          message: { role: 'user', content: [{ type: 'tool_result', content: '결과' }] }
        }),
        user('2026-07-19T10:03:00.000Z', '<command-name>/model</command-name>'),
        JSON.stringify({ type: 'queue-operation', timestamp: '2026-07-19T10:04:00.000Z' }),
        JSON.stringify({ type: 'file-history-snapshot', timestamp: '2026-07-19T10:05:00.000Z' })
      ]
    })
    const { digests } = await collectDigests('2026-07-19', '2026-07-19', { claudeDir: base })
    expect(digests.get('2026-07-19')?.totals.promptCount).toBe(1)
    expect(digests.get('2026-07-19')?.projects[0].prompts[0].text).toBe('진짜 프롬프트')
  })

  it('isMeta 레코드는 프롬프트에서 제외한다', async () => {
    const base = makeFixture({
      'p1/s1.jsonl': [
        user('2026-07-19T10:00:00.000Z', '진짜 프롬프트'),
        // 이미지를 붙이면 Claude Code가 넣는 안내문
        user('2026-07-19T10:01:00.000Z', '[Image: original 4064x2324, displayed at 2000x1144.]', {
          isMeta: true
        }),
        // 스킬 본문이 통째로 주입된 것
        user('2026-07-19T10:02:00.000Z', 'Approach this as the design lead at a small studio', {
          isMeta: true,
          sourceToolUseID: 'toolu_abc'
        }),
        // 슬래시 커맨드가 펼쳐진 내용
        user('2026-07-19T10:03:00.000Z', '# /plugin:setup 한 번만 실행하는 셋업 커맨드입니다', {
          isMeta: true
        })
      ]
    })
    const { digests } = await collectDigests('2026-07-19', '2026-07-19', { claudeDir: base })
    const day = digests.get('2026-07-19')
    expect(day?.totals.promptCount).toBe(1)
    expect(day?.projects[0].prompts[0].text).toBe('진짜 프롬프트')
    // 프롬프트에서만 빠질 뿐 그 세션에 속한 레코드인 것은 맞다
    expect(day?.totals.sessionCount).toBe(1)
  })

  it('excludeCwds의 프로젝트는 수집하지 않는다', async () => {
    const base = makeFixture({
      'p1/s1.jsonl': [user('2026-07-19T10:00:00.000Z', '앱 자체 실행', { cwd: '/app/workdir' })]
    })
    const { digests } = await collectDigests('2026-07-19', '2026-07-19', {
      claudeDir: base,
      excludeCwds: ['/app/workdir']
    })
    expect(digests.size).toBe(0)
  })

  it('assistant 레코드에서 토큰·도구 호출 수를 집계한다', async () => {
    const base = makeFixture({
      'p1/s1.jsonl': [
        user('2026-07-19T10:00:00.000Z', '작업 지시'),
        assistant('2026-07-19T10:00:10.000Z'),
        assistant('2026-07-19T10:00:20.000Z')
      ]
    })
    const { digests } = await collectDigests('2026-07-19', '2026-07-19', { claudeDir: base })
    const proj = digests.get('2026-07-19')!.projects[0]
    expect(proj.toolCallCount).toBe(2)
    expect(proj.tokens).toEqual({ input: 200, output: 100 })
  })

  it('문자열 content와 세션 카운트를 처리한다', async () => {
    const base = makeFixture({
      'p1/s1.jsonl': [
        JSON.stringify({
          type: 'user',
          timestamp: '2026-07-19T10:00:00.000Z',
          cwd: CWD,
          sessionId: 's1',
          message: { role: 'user', content: '문자열 프롬프트' }
        })
      ],
      'p1/s2.jsonl': [user('2026-07-19T11:00:00.000Z', '두 번째 세션', { sessionId: 's2' })]
    })
    const { digests } = await collectDigests('2026-07-19', '2026-07-19', { claudeDir: base })
    const proj = digests.get('2026-07-19')!.projects[0]
    expect(proj.sessionCount).toBe(2)
    expect(proj.promptCount).toBe(2)
  })

  it('한 대화가 여러 폴더를 드나들어도 대화를 시작한 프로젝트 하나로 묶는다', async () => {
    // Claude가 프로젝트 안쪽 폴더나 임시 작업 폴더로 옮겨 가 일하면 그 뒤 레코드의 cwd가 바뀐다
    const wt = '/private/tmp/scratchpad/fix-wt'
    const base = makeFixture({
      'p1/s1.jsonl': [
        user('2026-07-19T10:00:00.000Z', '버그 고쳐 줘'),
        assistant('2026-07-19T10:00:10.000Z', { cwd: `${CWD}/src` }),
        assistant('2026-07-19T10:00:20.000Z', { cwd: wt }),
        user('2026-07-19T10:05:00.000Z', '테스트도 돌려 줘', { cwd: wt })
      ]
    })
    const { digests } = await collectDigests('2026-07-19', '2026-07-19', { claudeDir: base })
    const day = digests.get('2026-07-19')!
    expect(day.projects.map((p) => p.cwd)).toEqual([CWD])
    expect(day.projects[0].promptCount).toBe(2)
    expect(day.projects[0].toolCallCount).toBe(2)
    expect(day.totals.sessionCount).toBe(1)
  })

  it('자정을 넘긴 대화는 다음 날만 스캔해도 시작한 프로젝트로 묶는다', async () => {
    // 스캔 범위에 따라 묶이는 프로젝트가 달라지면 같은 날의 digestHash가 흔들린다
    const wt = '/private/tmp/scratchpad/fix-wt'
    const base = makeFixture({
      'p1/s1.jsonl': [
        user('2026-07-19T14:50:00.000Z', '어제 밤 작업'),
        assistant('2026-07-19T15:05:00.000Z', { cwd: wt }),
        user('2026-07-19T15:10:00.000Z', '자정 넘긴 작업', { cwd: wt })
      ]
    })
    const oneDay = (await collectDigests('2026-07-20', '2026-07-20', { claudeDir: base })).digests
    const twoDays = (await collectDigests('2026-07-19', '2026-07-20', { claudeDir: base })).digests
    expect(oneDay.get('2026-07-20')!.projects.map((p) => p.cwd)).toEqual([CWD])
    expect(digestHash(oneDay.get('2026-07-20')!)).toBe(digestHash(twoDays.get('2026-07-20')!))
  })

  it('서로 다른 폴더에서 시작한 대화는 따로 잡는다', async () => {
    const other = '/Users/test/proj-b'
    const base = makeFixture({
      'p1/s1.jsonl': [user('2026-07-19T10:00:00.000Z', 'A 작업')],
      'p2/s2.jsonl': [user('2026-07-19T11:00:00.000Z', 'B 작업', { sessionId: 's2', cwd: other })]
    })
    const { digests } = await collectDigests('2026-07-19', '2026-07-19', { claudeDir: base })
    expect(digests.get('2026-07-19')!.projects.map((p) => p.cwd).sort()).toEqual([CWD, other])
  })
})
