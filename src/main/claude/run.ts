import { spawn, type ChildProcess } from 'node:child_process'
import type { ModelChoice } from '@shared/types'

export interface ClaudeRunOptions {
  claudePath: string
  model: ModelChoice
  /** claude 실행 cwd. 로그 자기오염 방지를 위해 전용 디렉토리를 쓴다 */
  cwd: string
  timeoutMs?: number
}

interface ResultEnvelope {
  type?: string
  subtype?: string
  is_error?: boolean
  result?: string
}

const RETRY_DELAYS_MS = [2_000, 8_000]

/** 재시도해도 절대 성공하지 않는 실행 오류. 즉시 중단해 사용자를 10초 기다리게 하지 않는다 */
const PERMANENT_ERRORS = new Set(['EINVAL', 'ENOENT', 'EFTYPE', 'EACCES'])

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
export async function runClaude(prompt: string, opts: ClaudeRunOptions): Promise<string> {
  let lastError: Error = new Error('claude 실행 실패')
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await runOnce(prompt, opts)
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e))
      const code = (lastError as NodeJS.ErrnoException).code
      if (code && PERMANENT_ERRORS.has(code)) throw lastError
      if (attempt < RETRY_DELAYS_MS.length) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]))
      }
    }
  }
  throw lastError
}

function runOnce(prompt: string, opts: ClaudeRunOptions): Promise<string> {
  const args = ['-p', '--output-format', 'json', '--no-session-persistence']
  if (opts.model !== 'default') args.push('--model', opts.model)

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
    child.stdout?.on('data', (d: string) => (stdout += d))
    child.stderr?.on('data', (d: string) => (stderr += d))

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
        reject(new Error(`claude 종료 코드 ${code}: ${stderr.slice(0, 500)}`))
        return
      }
      try {
        const envelope = JSON.parse(stdout) as ResultEnvelope
        if (envelope.is_error || typeof envelope.result !== 'string') {
          reject(new Error(`claude 응답 오류 (${envelope.subtype ?? 'unknown'})`))
          return
        }
        resolve(envelope.result)
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
