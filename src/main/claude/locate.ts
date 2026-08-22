import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { access, constants, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

const IS_WIN = process.platform === 'win32'

/** npm 글로벌 설치에서 실제 네이티브 바이너리가 놓이는 패키지 내부 경로 */
const NPM_PKG_BIN = join('node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')

/**
 * 실행 가능 판정.
 * 윈도우의 fs.access(X_OK)는 F_OK와 동일해서 순수 텍스트 파일도 통과한다.
 * CreateProcess가 직접 띄울 수 있는 것은 .exe뿐이므로(.cmd→EINVAL, .ps1→EFTYPE,
 * 확장자 없는 sh 셰임→ENOENT) 윈도우에서는 확장자로 판정한다.
 */
async function isRunnable(p: string): Promise<boolean> {
  try {
    const st = await stat(p)
    if (!st.isFile()) return false
    if (IS_WIN) return extname(p).toLowerCase() === '.exe'
    await access(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * GUI로 실행된 Electron 앱은 셸 PATH를 상속받지 못하므로
 * 알려진 설치 경로를 순서대로 탐색하고, 마지막으로 PATH를 직접 훑는다.
 */
const posixCandidates = (): string[] => [
  join(homedir(), '.local', 'bin', 'claude'),
  '/opt/homebrew/bin/claude',
  '/usr/local/bin/claude',
  join(homedir(), '.claude', 'local', 'claude')
]

function winCandidates(): string[] {
  const home = homedir()
  const LA = process.env['LOCALAPPDATA'] ?? join(home, 'AppData', 'Local')
  const RA = process.env['APPDATA'] ?? join(home, 'AppData', 'Roaming')
  const PF = process.env['ProgramFiles'] ?? 'C:\\Program Files'
  // nvm-windows의 활성 버전 심볼릭 링크를 최우선으로 본다.
  // realpath로 풀어 저장하면 특정 버전에 고정되므로 링크 경로를 그대로 쓴다.
  const prefixes = [
    process.env['NVM_SYMLINK'],
    join(PF, 'nodejs'),
    join(RA, 'npm'),
    join(LA, 'npm'),
    join(LA, 'Programs', 'nodejs')
  ].filter((d): d is string => Boolean(d))
  return [
    join(home, '.local', 'bin', 'claude.exe'),
    join(home, '.claude', 'local', 'claude.exe'),
    join(LA, 'Programs', 'claude', 'claude.exe'),
    // npm 글로벌: 셰임(.cmd)이 아니라 패키지 내부의 실제 .exe를 겨냥한다
    ...prefixes.flatMap((d) => [join(d, NPM_PKG_BIN), join(d, 'claude.exe')]),
    join(home, 'scoop', 'shims', 'claude.exe'),
    join(process.env['ChocolateyInstall'] ?? 'C:\\ProgramData\\chocolatey', 'bin', 'claude.exe'),
    join(LA, 'Microsoft', 'WinGet', 'Links', 'claude.exe')
  ]
}

/**
 * 윈도우 npm 셰임(claude.cmd / claude.ps1 / 확장자 없는 sh)을 네이티브 .exe로 해석한다.
 * `where claude`가 알려주는 경로는 전부 셰임이고 그대로 spawn하면 실패하므로,
 * 사용자가 설정 탭에 넣을 가장 자연스러운 값을 받아주기 위해 필요하다.
 * 셰임이 존재해도 타깃 .exe가 없는 깨진 설치가 실제로 존재하므로 최종 실존까지 확인한다.
 */
async function resolveShim(p: string): Promise<string | null> {
  if (!IS_WIN) return null
  // basename의 ext 비교는 대소문자를 구분하므로 소문자화한 값을 넘기면
  // 'CLAUDE.CMD' 같은 입력에서 확장자가 떨어지지 않아 'claude.CMD.exe'를 찾게 된다
  const rawExt = extname(p)
  const ext = rawExt.toLowerCase()
  if (ext === '.exe') return (await isRunnable(p)) ? p : null
  const dir = dirname(p)
  // 1) 형제 네이티브 바이너리
  const sibling = join(dir, `${basename(p, rawExt)}.exe`)
  if (await isRunnable(sibling)) return sibling
  // 2) 이 셰임이 속한 npm prefix의 패키지 내부 바이너리
  const npmLayout = join(dir, NPM_PKG_BIN)
  if (await isRunnable(npmLayout)) return npmLayout
  // 3) 최후: 셰임 본문에서 타깃 추출 (.cmd는 %dp0%, sh 셰임은 $basedir)
  try {
    const body = await readFile(p, 'utf8')
    const m =
      /"?%dp0%[\\/]?([^"\r\n]+\.exe)"?/i.exec(body) ?? /\$basedir\/([^"\r\n]+\.exe)/i.exec(body)
    if (m) {
      const target = resolve(dir, m[1].replace(/[\\/]/g, sep))
      if (await isRunnable(target)) return target
    }
  } catch {
    // 셰임을 읽을 수 없으면 해석 실패로 둔다
  }
  return null
}

/**
 * PATH 직접 스캔. 윈도우에서 where.exe를 쓰면 안 되는 이유:
 * 첫 줄이 확장자 없는 sh 셰임(spawn 시 ENOENT)이라 조용히 실행 불가 경로를 반환한다.
 */
async function scanPath(): Promise<string | null> {
  const dirs = (process.env['PATH'] ?? '')
    .split(IS_WIN ? ';' : ':')
    .filter(Boolean)
    .map((d) => d.replace(/^"|"$/g, ''))
  const exts = IS_WIN
    ? [
        ...new Set([
          '.exe',
          ...(process.env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD')
            .split(';')
            .filter(Boolean)
            .map((e) => e.toLowerCase())
        ])
      ]
    : ['']
  const shims: string[] = []
  for (const d of dirs) {
    const bare = join(d, 'claude')
    for (const e of exts) {
      const p = bare + e
      if (await isRunnable(p)) return p
      if (IS_WIN && e !== '.exe' && existsSync(p)) shims.push(p)
    }
    if (IS_WIN && existsSync(bare)) shims.push(bare)
  }
  for (const s of shims) {
    const r = await resolveShim(s)
    if (r) return r
  }
  return null
}

async function autoDetect(): Promise<string | null> {
  for (const p of IS_WIN ? winCandidates() : posixCandidates()) {
    if (await isRunnable(p)) return p
  }
  const scanned = await scanPath()
  if (scanned) return scanned
  if (!IS_WIN) {
    // 맥/리눅스는 로그인 셸에 물어보는 기존 폴백을 그대로 유지한다
    try {
      const { stdout } = await execFileP('/bin/zsh', ['-lc', 'command -v claude'], {
        timeout: 10_000
      })
      const found = stdout.trim().split('\n').pop()?.trim()
      if (found && (await isRunnable(found))) return found
    } catch {
      // 로그인 셸 실패는 아래 공통 에러로
    }
  }
  return null
}

/**
 * 윈도우 경로에 애초에 존재할 수 없는 문자들.
 * 셸을 전혀 쓰지 않으므로 인젝션 위험은 없지만, 이런 입력은 spawn 단계에서
 * ENOENT로 뭉개지는 대신 설정 탭에서 즉시 명확한 에러가 되는 게 낫다.
 * '&' '^' '%'는 정상 폴더명에 쓸 수 있으므로(예: "R&D", "100% done") 넣지 않는다.
 */
const WIN_INVALID_PATH_CHARS = /["<>|\r\n]/

export async function locateClaude(override?: string | null): Promise<string> {
  if (override) {
    if (IS_WIN && WIN_INVALID_PATH_CHARS.test(override)) {
      throw new Error('claude 경로에 사용할 수 없는 문자가 있습니다')
    }
    const direct = (await isRunnable(override)) ? override : await resolveShim(override)
    if (direct) return direct
    // 윈도우 한정으로 자동 복구한다. C:\Program Files\nodejs 가 nvm 심볼릭 링크라
    // 활성 버전이 바뀌면 저장된 경로가 조용히 무효가 되기 때문이다.
    // 맥에는 이런 무효화 요인이 없어, 사용자가 명시한 경로를 다른 바이너리로
    // 조용히 대체하는 쪽이 오히려 해롭다.
    if (IS_WIN) {
      const recovered = await autoDetect()
      if (recovered) return recovered
    }
    throw new Error(`설정된 claude 경로를 실행할 수 없습니다: ${override}`)
  }
  const found = await autoDetect()
  if (found) return found
  throw new Error(
    'claude CLI를 찾지 못했습니다. 설정 탭에서 claude 실행 파일 경로를 직접 지정해 주세요.'
  )
}

/**
 * 주의: execFileP는 promisify된 형태여야 한다.
 * 콜백형 execFile(path, args, cb)은 .cmd 경로에서 EINVAL을 동기 throw하며
 * 콜백을 호출하지 않아 프로세스를 죽인다. 절대 콜백형으로 되돌리지 말 것.
 */
export async function claudeVersion(path: string): Promise<string> {
  // 324MB 네이티브 바이너리의 최초 실행은 콜드 캐시에서 5.5초까지 걸린다(웜 ~200ms).
  // 실시간 검사가 붙은 환경을 감안해 넉넉히 둔다.
  const { stdout } = await execFileP(path, ['--version'], {
    timeout: 30_000,
    windowsHide: true
  })
  return stdout.trim()
}
