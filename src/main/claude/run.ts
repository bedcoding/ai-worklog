import { spawn, type ChildProcess } from 'node:child_process'
import { AUTH_FAILURE_MESSAGE, isAuthFailure } from '@shared/claude-error'
import { noteRunFailure, noteRunSuccess } from '../auth-state'
import type { ModelChoice } from '@shared/types'

/**
 * 생성 중인 글을 조각으로 알린다.
 * reset은 재시도로 처음부터 다시 쓴다는 뜻이다. 받아둔 조각을 버려야 한다.
 */
export type StreamEvent =
  /** 재시도로 처음부터 다시 쓴다. 받아둔 조각을 버려야 한다 */
  | { kind: 'reset' }
  /**
   * 모델이 생각하는 중. 본문과 섞이면 안 되므로 따로 보낸다.
   * 본문 첫 글자까지 수십 초 걸릴 수 있어, 그 사이 유일하게 움직이는 신호다.
   */
  | { kind: 'thinking'; text: string }
  /** 생각 토큰 누계. 생각 글자가 나오기 전에도 이 숫자는 오른다 */
  | { kind: 'tokens'; count: number }
  | { kind: 'delta'; text: string }

export interface ClaudeRunOptions {
  claudePath: string
  model: ModelChoice
  /** claude 실행 cwd. 로그 자기오염 방지를 위해 전용 디렉토리를 쓴다 */
  cwd: string
  /**
   * CLI 설정에 박힌 기본 모델명 (예: claude-fable-5).
   * model이 'default' 면 --model을 주지 않으므로 응답에서 어느 것이 본 모델인지
   * 가릴 단서가 이것뿐이다. 읽지 못했으면 넘기지 않는다.
   */
  defaultModelName?: string | null
  timeoutMs?: number
  /**
   * 넘기면 stream-json으로 실행해 글이 만들어지는 대로 조각을 보낸다.
   * 넘기지 않으면 예전처럼 json 한 덩이로 받는다. 최종 결과는 두 경우 모두 같다.
   */
  onStream?: (e: StreamEvent) => void
}

interface ResultEnvelope {
  type?: string
  subtype?: string
  is_error?: boolean
  result?: string
  /** 실제로 응답한 모델. 키가 모델명이다 (예: claude-fable-5) */
  modelUsage?: Record<string, unknown>
}

/**
 * 실행 결과. 어떤 모델이 응답했는지 함께 준다.
 *
 * 'CLI 기본 모델'로 두면 앱은 무슨 모델이 쓰였는지 모른다. 사용자의 CLI 설정이
 * 바뀌면 요약 품질이 말없이 따라 바뀌는데 화면에는 그 흔적이 없다.
 * 그래서 요약마다 실제로 쓴 모델을 남긴다.
 */
export interface RunResult {
  text: string
  /** 봉투에서 못 읽으면 null */
  model: string | null
}

/**
 * 요약을 실제로 쓴 모델의 이름.
 *
 * modelUsage는 이 실행에서 쓴 '모든' 모델의 사용량이다. CLI가 보조 호출을 haiku로
 * 돌리므로 키가 둘 이상 오고, 첫 키가 그 보조 모델일 수 있다.
 * (--model sonnet 실측: claude-haiku-4-5-20251001과 claude-sonnet-5 두 개가 오고
 *  첫 키가 haiku 였다. 그래서 소넷으로 만든 요약에 haiku-4.5가 찍혔다.)
 *
 * 출력 토큰이 가장 많은 키를 고르는 방법은 쓸 수 없다. 짧은 답에서는 보조 호출이
 * 본 답보다 더 많이 낸다 (같은 실측에서 haiku 16, sonnet 3).
 *
 * 그래서 우리가 요청한 이름과 맞는 키를 고른다. 가릴 수 없으면 null을 준다.
 * 틀린 이름을 적는 것은 아무 이름도 적지 않는 것보다 나쁘다.
 *
 * @param want 요청한 모델명 조각. 별칭('sonnet') 이거나 CLI 기본 모델명('claude-fable-5')
 */
export function modelOf(
  envelope: { modelUsage?: Record<string, unknown> },
  want?: string | null
): string | null {
  const names = Object.keys(envelope.modelUsage ?? {})
  if (names.length === 0) return null
  // 하나뿐이면 보조 호출이 없었다는 뜻이므로 그것이 답이다
  if (names.length === 1) return names[0]
  if (!want) return null
  return names.find((n) => n.includes(want)) ?? null
}

/**
 * 응답의 modelUsage에서 본 모델을 가려낼 단서.
 * 별칭을 줬으면 그것으로, 기본으로 뒀으면 CLI 설정의 모델명으로 맞춘다.
 * 모델명 키에는 [1m] 같은 꼬리표가 없으므로 뗀다.
 */
export function wantedModel(model: ModelChoice, defaultModelName?: string | null): string | null {
  if (model !== 'default') return model
  const base = defaultModelName?.replace(/\[[^\]]*\]$/, '').trim()
  return base ? base : null
}

/** stream-json이 한 줄에 하나씩 내보내는 이벤트. 쓰는 것만 적는다 */
interface StreamLine {
  type?: string
  subtype?: string
  is_error?: boolean
  result?: string
  modelUsage?: Record<string, unknown>
  /** system/thinking_tokens가 실어 보내는 누적 토큰 수 */
  estimated_tokens?: number
  event?: {
    type?: string
    delta?: { type?: string; text?: string; thinking?: string }
  }
}

/**
 * 청크를 줄로 자른다. 마지막 미완성 줄은 carry로 돌려 다음 청크에 이어붙인다.
 *
 * stdout 청크는 줄 경계와 아무 상관 없이 끊긴다. 그대로 파싱하면 반쪽 JSON에서
 * 실패해 그 줄의 조각을 통째로 흘린다.
 */
export function splitLines(carry: string, chunk: string): { lines: string[]; carry: string } {
  const parts = (carry + chunk).split('\n')
  return { carry: parts.pop() ?? '', lines: parts }
}

export type StreamLineKind =
  /** 요약 본문 조각 */
  | { kind: 'text'; text: string }
  /**
   * 모델이 생각하는 중. 요약 본문이 아니므로 본문과 같은 자리에 두면 안 된다.
   * 그렇다고 버리면 본문이 나오기까지 수십 초간 화면이 죽은 것처럼 보인다.
   */
  | { kind: 'thinking'; text: string }
  /**
   * 생각 토큰 누계. 생각 글자보다 먼저, 더 자주 온다.
   * 첫 글자가 나오기 전 구간에서 유일하게 움직이는 숫자다.
   */
  | { kind: 'tokens'; count: number }
  | { kind: 'result'; envelope: StreamLine }
  | { kind: 'other' }

/**
 * stream-json 한 줄을 가른다. 모르는 줄과 깨진 줄은 other다.
 * 한 줄을 한 번만 파싱한다. 종류마다 따로 파싱하면 같은 줄을 세 번 읽는다.
 */
export function classifyLine(line: string): StreamLineKind {
  if (!line.trim()) return { kind: 'other' }
  let ev: StreamLine
  try {
    ev = JSON.parse(line) as StreamLine
  } catch {
    return { kind: 'other' }
  }
  if (ev.type === 'result') return { kind: 'result', envelope: ev }
  if (ev.type === 'system' && ev.subtype === 'thinking_tokens') {
    return { kind: 'tokens', count: ev.estimated_tokens ?? 0 }
  }
  if (ev.type !== 'stream_event' || ev.event?.type !== 'content_block_delta') {
    return { kind: 'other' }
  }
  const delta = ev.event.delta
  if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
    return { kind: 'text', text: delta.text }
  }
  if (delta?.type === 'thinking_delta') {
    return { kind: 'thinking', text: typeof delta.thinking === 'string' ? delta.thinking : '' }
  }
  return { kind: 'other' }
}

const RETRY_DELAYS_MS = [2_000, 8_000]

/** 재시도해도 절대 성공하지 않는 실행 오류. 즉시 중단해 사용자를 10초 기다리게 하지 않는다 */
const PERMANENT_ERRORS = new Set(['EINVAL', 'ENOENT', 'EFTYPE', 'EACCES'])

/** 로그인이 풀려서 죽은 실행. 재시도로는 풀리지 않으므로 표식을 달아 둔다 */
interface AuthError extends Error {
  authFailure?: true
}

/**
 * 종료 코드가 0이 아닐 때 원인 문구를 고른다.
 *
 * stderr만 보던 때가 있었는데, 인증 실패 문구는 stdout으로 나온다. 그래서 화면에는
 * 'claude 종료 코드 1: ' 뒤가 비어 있었고 무엇을 해야 하는지 알 수 없었다.
 */
function failureFrom(code: number | null, stderr: string, stdout: string): AuthError {
  const detail = (stderr.trim() || stdout.trim()).slice(0, 500)
  if (isAuthFailure(detail)) {
    const e: AuthError = new Error(AUTH_FAILURE_MESSAGE)
    e.authFailure = true
    return e
  }
  return new Error(`claude 종료 코드 ${code}: ${detail}`)
}

/** 강제 종료 후에도 close가 오지 않을 때 Promise를 반드시 settle시키는 유예 시간 */
const HARD_KILL_GRACE_MS = 5_000

/**
 * 프로세스 트리를 죽인다.
 * 윈도우의 child.kill()은 해당 PID만 TerminateProcess하는데, claude.exe는
 * 툴 실행 시 powershell.exe / bash.exe 손자를 띄우므로 손자가 고아로 남는다.
 * 고아가 stdout 파이프를 붙들면 'close'가 오지 않아 아래 Promise가 영구히 안 끝난다.
 */
function killTree(child: ChildProcess): void {
  if (process.platform === 'win32') {
    if (child.pid) {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true
      })
    }
    return
  }
  child.kill('SIGKILL')
}

/**
 * 로컬 claude CLI를 headless로 실행해 응답 텍스트를 반환한다.
 * - 프롬프트는 stdin으로 전달 (ARG_MAX 회피)
 * - --no-session-persistence: 이 실행이 ~/.claude/projects 로그에 남지 않게 함
 * - 실패 시 2s/8s 백오프로 2회 재시도 (영구 오류는 재시도하지 않음)
 */
export async function runClaude(prompt: string, opts: ClaudeRunOptions): Promise<RunResult> {
  let lastError: Error = new Error('claude 실행 실패')
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      // 재시도는 처음부터 다시 쓴다. 앞 시도의 조각을 남겨 두면 두 글이 이어붙는다
      if (attempt > 0) opts.onStream?.({ kind: 'reset' })
      const ok = await runOnce(prompt, opts)
      noteRunSuccess()
      return ok
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e))
      const code = (lastError as NodeJS.ErrnoException).code
      // 로그인이 풀린 것은 기다려도 풀리지 않는다. 10초를 버리고 같은 곳에서 죽는다
      if ((lastError as AuthError).authFailure) {
        noteRunFailure(lastError.message)
        throw lastError
      }
      if (code && PERMANENT_ERRORS.has(code)) throw lastError
      if (attempt < RETRY_DELAYS_MS.length) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]))
      }
    }
  }
  noteRunFailure(lastError.message)
  throw lastError
}

function runOnce(prompt: string, opts: ClaudeRunOptions): Promise<RunResult> {
  const streaming = !!opts.onStream
  // stream-json은 --verbose를 함께 주지 않으면 CLI가 실행을 거부한다
  const args = streaming
    ? [
        '-p',
        '--output-format',
        'stream-json',
        '--include-partial-messages',
        '--verbose',
        '--no-session-persistence'
      ]
    : ['-p', '--output-format', 'json', '--no-session-persistence']
  if (opts.model !== 'default') args.push('--model', opts.model)

  const want = wantedModel(opts.model, opts.defaultModelName)

  return new Promise((resolve, reject) => {
    let child: ChildProcess
    try {
      // shell 옵션은 절대 켜지 말 것. claudePath는 사용자 입력이라 셸을 거치면 커맨드 인젝션이
      // 되고, 윈도우에서는 shell:true가 공백 포함 경로(Program Files)를 인용조차 하지 않는다.
      child = spawn(opts.claudePath, args, {
        cwd: opts.cwd,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      })
    } catch (e) {
      // spawn은 .cmd/.ps1 경로에서 동기 throw한다. code를 보존해야 재시도 여부를 판단할 수 있다
      const err = new Error(`claude 실행 실패: ${(e as Error).message}`) as NodeJS.ErrnoException
      err.code = (e as NodeJS.ErrnoException).code
      reject(err)
      return
    }

    let stdout = ''
    let stderr = ''
    /**
     * stdout 앞부분. 실패 원인을 찾는 데만 쓴다.
     *
     * 스트리밍일 때 stdout은 JSON 줄로 쌓이므로 통째로 들고 있을 수 없다. 그런데
     * 인증 실패는 JSON이 아닌 평문 한 줄로 오고 그때는 그 줄이 출력의 전부다.
     * 앞 500자만 남겨 두면 어느 쪽이든 원인을 잃지 않는다.
     */
    let rawHead = ''
    const keepHead = (d: string): void => {
      if (rawHead.length < 500) rawHead += d.slice(0, 500 - rawHead.length)
    }
    /** 스트리밍일 때의 최종 결과 줄. 이것이 없으면 글이 끝까지 오지 않은 것이다 */
    let resultLine: StreamLine | null = null
    let timedOut = false
    let hardTimer: ReturnType<typeof setTimeout> | null = null
    const timeoutMs = opts.timeoutMs ?? 120_000

    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
      // close에만 의존하면 손자 프로세스가 파이프를 붙든 경우 영구 hang이 된다
      hardTimer = setTimeout(
        () => reject(new Error('claude 강제 종료 후에도 응답이 없습니다')),
        HARD_KILL_GRACE_MS
      )
    }, timeoutMs)

    const clearTimers = (): void => {
      clearTimeout(timer)
      if (hardTimer) clearTimeout(hardTimer)
    }

    // 한글 응답이 청크 경계에서 쪼개져도 깨지지 않도록 스트림 단위로 디코딩한다
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (d: string) => (stderr += d))

    if (!streaming) {
      child.stdout?.on('data', (d: string) => {
        stdout += d
        keepHead(d)
      })
    } else {
      let carry = ''
      const handle = (line: string): void => {
        const ev = classifyLine(line)
        if (ev.kind === 'result') resultLine = ev.envelope
        else if (ev.kind === 'text') opts.onStream?.({ kind: 'delta', text: ev.text })
        else if (ev.kind === 'thinking') opts.onStream?.({ kind: 'thinking', text: ev.text })
        else if (ev.kind === 'tokens') opts.onStream?.({ kind: 'tokens', count: ev.count })
      }
      child.stdout?.on('data', (d: string) => {
        keepHead(d)
        const split = splitLines(carry, d)
        carry = split.carry
        for (const line of split.lines) handle(line)
      })
      // 마지막 줄에 개행이 없을 수 있다. 그러면 result가 carry에 남아 영구히 실패한다
      child.stdout?.on('end', () => handle(carry))
    }

    child.on('error', (e) => {
      clearTimers()
      const err = new Error(`claude 실행 실패: ${e.message}`) as NodeJS.ErrnoException
      err.code = (e as NodeJS.ErrnoException).code
      reject(err)
    })

    child.on('close', (code) => {
      clearTimers()
      if (timedOut) {
        reject(new Error(`claude 실행이 ${timeoutMs / 1000}초를 초과했습니다`))
        return
      }
      if (code !== 0) {
        reject(failureFrom(code, stderr, rawHead))
        return
      }
      // 스트리밍이든 아니든 최종 결과는 같은 봉투에서 읽는다. 조각은 화면용이고
      // 저장하는 글은 result다. 조각을 이어붙여 쓰면 놓친 조각이 그대로 구멍이 된다.
      if (streaming) {
        if (!resultLine) {
          reject(new Error(`claude 응답이 끝까지 오지 않았습니다: ${stderr.slice(0, 300)}`))
          return
        }
        if (resultLine.is_error || typeof resultLine.result !== 'string') {
          reject(new Error(`claude 응답 오류 (${resultLine.subtype ?? 'unknown'})`))
          return
        }
        resolve({ text: resultLine.result, model: modelOf(resultLine, want) })
        return
      }
      try {
        const envelope = JSON.parse(stdout) as ResultEnvelope
        if (envelope.is_error || typeof envelope.result !== 'string') {
          reject(new Error(`claude 응답 오류 (${envelope.subtype ?? 'unknown'})`))
          return
        }
        resolve({ text: envelope.result, model: modelOf(envelope, want) })
      } catch {
        reject(new Error(`claude 응답을 파싱할 수 없습니다: ${stdout.slice(0, 300)}`))
      }
    })

    child.stdin?.on('error', () => {
      // EPIPE 등은 close 핸들러의 종료 코드 처리에 맡긴다
    })
    child.stdin?.write(prompt)
    child.stdin?.end()
  })
}

/**
 * 모델 응답에서 JSON 오브젝트를 최대한 관대하게 추출한다.
 * 사용자가 프롬프트를 수정해 JSON 계약이 깨질 수 있으므로 실패 시 null을 반환하고
 * 호출자가 fallbackText로 처리한다.
 */
export function extractJson<T>(text: string): T | null {
  const candidates = [text.trim()]
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  if (fenced) candidates.push(fenced[1].trim())
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1))
  for (const c of candidates) {
    try {
      return JSON.parse(c) as T
    } catch {
      // 다음 후보 시도
    }
  }
  return null
}
