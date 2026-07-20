import { spawn } from 'node:child_process'
import type { ModelChoice } from '@shared/types'

export interface ClaudeRunOptions {
  claudePath: string
  model: ModelChoice
  /** claude 실행 cwd — 로그 자기오염 방지를 위해 전용 디렉토리를 쓴다 */
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

/**
 * 로컬 claude CLI를 headless로 실행해 응답 텍스트를 반환한다.
 * - 프롬프트는 stdin으로 전달 (ARG_MAX 회피)
 * - --no-session-persistence: 이 실행이 ~/.claude/projects 로그에 남지 않게 함
 * - 실패 시 2s/8s 백오프로 2회 재시도
 */
export async function runClaude(prompt: string, opts: ClaudeRunOptions): Promise<string> {
  let lastError: Error = new Error('claude 실행 실패')
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await runOnce(prompt, opts)
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e))
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
    const child = spawn(opts.claudePath, args, {
      cwd: opts.cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, opts.timeoutMs ?? 120_000)

    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`claude 실행 실패: ${e.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) {
        reject(new Error(`claude 실행이 ${(opts.timeoutMs ?? 120_000) / 1000}초를 초과했습니다`))
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

    child.stdin.on('error', () => {
      // EPIPE 등은 close 핸들러의 종료 코드 처리에 맡긴다
    })
    child.stdin.write(prompt)
    child.stdin.end()
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
