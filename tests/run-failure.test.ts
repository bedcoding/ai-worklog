import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isAuthFailed, noteRunSuccess } from '../src/main/auth-state'
import { failureFrom, runClaude } from '../src/main/claude/run'
import { AUTH_FAILURE_MESSAGE } from '../src/shared/claude-error'

const AUTH_TEXT = 'Failed to authenticate: OAuth session expired and could not be refreshed'

// claude 2.1.310이 로그인 만료로 끝날 때 낸 json 봉투다 (2026-10-29 실측, 종료 코드 1, stderr 없음).
// usage까지는 실측 봉투의 앞부분을 옮겼고 session_id만 가렸다.
// 그 뒤는 같은 버전 성공 봉투의 키 순서를 따라 필요한 키만 실패 값으로 채웠다.
const AUTH_ENVELOPE = JSON.stringify({
  duration_api_ms: 0,
  stop_reason: 'stop_sequence',
  session_id: '00000000-0000-0000-0000-000000000000',
  total_cost_usd: 0,
  usage: {
    output_tokens_details: { thinking_tokens: 0 },
    input_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 0,
    server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
    service_tier: 'standard',
    cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
    inference_geo: '',
    iterations: [],
    speed: 'standard'
  },
  modelUsage: {},
  permission_denials: [],
  is_error: true,
  num_turns: 1,
  subtype: 'success',
  result: AUTH_TEXT,
  type: 'result',
  duration_ms: 98,
  uuid: '00000000-0000-0000-0000-000000000000'
})

// stream-json으로 같은 실패를 받으면 init, assistant, result 세 줄이 오고 종료 코드는 1이다 (2026-10-29 실측).
// 실측 init 줄은 도구와 플러그인 목록 때문에 1만 자가 넘는다.
// 여기서는 그 줄이 500자를 넘는다는 것만 살린다.
const STREAM_LINES =
  [
    JSON.stringify({
      type: 'system',
      subtype: 'init',
      cwd: '/tmp/claude-workdir',
      session_id: 's',
      tools: Array.from({ length: 80 }, (_, i) => `Tool${i}`),
      mcp_servers: [],
      model: 'claude-opus-5-5'
    }),
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: AUTH_TEXT }],
        stop_reason: 'stop_sequence'
      },
      session_id: 's'
    }),
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: true,
      duration_ms: 98,
      duration_api_ms: 0,
      num_turns: 1,
      result: AUTH_TEXT,
      session_id: 's'
    })
  ].join('\n') + '\n'

describe('failureFrom', () => {
  it('픽스처의 전제: 실패 문구가 stdout 앞 500자 밖에 있다', () => {
    expect(AUTH_ENVELOPE.indexOf(AUTH_TEXT)).toBeGreaterThan(500)
    expect(STREAM_LINES.indexOf(AUTH_TEXT)).toBeGreaterThan(500)
  })

  it('결과 봉투의 result로 로그인 만료를 알아본다', () => {
    const e = failureFrom(1, '', AUTH_ENVELOPE.slice(0, 500), AUTH_TEXT)
    expect(e.message).toBe(AUTH_FAILURE_MESSAGE)
    expect(e.authFailure).toBe(true)
  })

  it('평문 한 줄로 오던 옛 형태도 그대로 알아본다', () => {
    // 2026-09-07, claude 2.1.251은 이 문구만 stdout으로 냈다
    expect(failureFrom(1, '', AUTH_TEXT).authFailure).toBe(true)
  })

  it('인증과 무관한 실패는 봉투의 원인 문구를 보인다', () => {
    // 앞부분만 보던 때는 여기에 봉투의 숫자 필드가 찍혀 원인을 알 수 없었다
    const e = failureFrom(1, '', AUTH_ENVELOPE.slice(0, 500), 'API Error: 529 Overloaded')
    expect(e.message).toBe('claude 종료 코드 1: API Error: 529 Overloaded')
    expect(e.authFailure).toBeUndefined()
  })

  it('봉투가 없으면 stderr를 쓴다', () => {
    expect(failureFrom(1, 'boom\n', '').message).toBe('claude 종료 코드 1: boom')
  })
})

// 가짜 claude를 셸 스크립트로 만든다.
// 윈도우의 spawn은 .exe만 띄우므로 건너뛴다.
describe.skipIf(process.platform === 'win32')('runClaude: 로그인 만료로 끝난 실행', () => {
  afterEach(() => noteRunSuccess())

  /** 부를 때마다 한 줄씩 기록하고, 받은 인자에 맞는 출력을 낸 뒤 종료 코드 1로 끝나는 claude */
  function fakeClaude(): { path: string; calls: () => number } {
    const dir = mkdtempSync(join(tmpdir(), 'worklog-fake-claude-'))
    writeFileSync(join(dir, 'json.out'), AUTH_ENVELOPE)
    writeFileSync(join(dir, 'stream.out'), STREAM_LINES)
    const path = join(dir, 'claude')
    writeFileSync(
      path,
      [
        '#!/bin/sh',
        `echo x >> '${dir}/calls'`,
        'cat > /dev/null',
        'case "$*" in',
        `  *stream-json*) cat '${dir}/stream.out' ;;`,
        `  *) cat '${dir}/json.out' ;;`,
        'esac',
        'exit 1'
      ].join('\n')
    )
    chmodSync(path, 0o755)
    const calls = (): number =>
      readFileSync(join(dir, 'calls'), 'utf8').split('\n').filter(Boolean).length
    return { path, calls }
  }

  it.each([
    { mode: 'json', onStream: undefined },
    { mode: 'stream-json', onStream: (): void => {} }
  ])(
    '$mode: 다시 시도하지 않고 로그인 안내를 켠다',
    async ({ onStream }) => {
      const fake = fakeClaude()
      await expect(
        runClaude('요약해 줘', { claudePath: fake.path, model: 'default', cwd: tmpdir(), onStream })
      ).rejects.toThrow(AUTH_FAILURE_MESSAGE)
      // 일반 오류로 알면 2초와 8초를 기다리며 세 번 부른다
      expect(fake.calls()).toBe(1)
      expect(isAuthFailed()).toBe(true)
    },
    15_000
  )
})
