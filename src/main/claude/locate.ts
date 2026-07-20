import { execFile } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

/**
 * GUI로 실행된 Electron 앱은 셸 PATH를 상속받지 못하므로
 * 알려진 설치 경로를 순서대로 탐색하고, 마지막으로 로그인 셸에 물어본다.
 */
const CANDIDATES = (): string[] => [
  join(homedir(), '.local', 'bin', 'claude'),
  '/opt/homebrew/bin/claude',
  '/usr/local/bin/claude',
  join(homedir(), '.claude', 'local', 'claude')
]

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export async function locateClaude(override?: string | null): Promise<string> {
  if (override) {
    if (await isExecutable(override)) return override
    throw new Error(`설정된 claude 경로를 실행할 수 없습니다: ${override}`)
  }
  for (const p of CANDIDATES()) {
    if (await isExecutable(p)) return p
  }
  try {
    const { stdout } = await execFileP('/bin/zsh', ['-lc', 'command -v claude'], {
      timeout: 10_000
    })
    const found = stdout.trim().split('\n').pop()?.trim()
    if (found && (await isExecutable(found))) return found
  } catch {
    // 로그인 셸 실패는 아래 공통 에러로
  }
  throw new Error(
    'claude CLI를 찾지 못했습니다. 설정 탭에서 claude 실행 파일 경로를 직접 지정해 주세요.'
  )
}

export async function claudeVersion(path: string): Promise<string> {
  const { stdout } = await execFileP(path, ['--version'], { timeout: 15_000 })
  return stdout.trim()
}
