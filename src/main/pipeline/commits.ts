import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { promisify } from 'node:util'
import { addDays, kstDateOf, kstHHMM, kstStartOfDayMs } from '@shared/dates'
import type { DayDigest, DigestCommit, RepoCommits } from '@shared/types'
import { cwdKey, sessionCwdsSince, type CollectOptions } from './collector'

const execFileP = promisify(execFile)

const DAY_MS = 86400_000

/**
 * 저장소 후보를 찾을 대화 로그의 범위다.
 * 대상 날짜보다 이만큼 앞서 쓰인 대화가 시작한 폴더까지 본다.
 * 여러 프로젝트를 오가다 한 프로젝트의 그날 대화를 지워도, 그 전에 같은 폴더에서 한 대화가 있으면 저장소를 찾는다.
 */
const REPO_LOOKBACK_DAYS = 60

/**
 * 하루에 담는 커밋 수 상한이다(저장소 전체).
 * 넘치면 이른 커밋부터 남긴다.
 */
export const MAX_COMMITS_PER_DAY = 30

/**
 * 커밋 본문은 앞부분만 담는다.
 * 무엇을 왜 바꿨는지는 대개 첫 몇 줄에 있다.
 */
export const COMMIT_BODY_MAX_CHARS = 300

/** git log를 대상 날짜보다 이만큼 앞서부터 읽는다 (logCommits의 --since 참고) */
const SINCE_SLACK_DAYS = 30

/**
 * 숫자만 다른 같은 꼴의 제목이 이만큼 서로 다른 날에 되풀이되면 자동으로 만든 커밋으로 보고 뺀다.
 * 배포나 갱신 작업이 매일 같은 제목으로 내 이름의 커밋을 남기는 저장소가 있다.
 * 작성자와 커미터가 모두 나여서 그것으로는 가릴 수 없다.
 * 사람이 쓴 커밋 중 이렇게 빠지는 것은 WIP나 버전 올리기처럼 업무 내용이 없는 것들이다.
 */
export const AUTOMATED_MIN_DAYS = 3

/** 제목에서 날짜, 시각, 번호를 지운 꼴 */
function shapeOf(subject: string): string {
  return subject.replace(/\d+/g, '#')
}

const GIT_TIMEOUT_MS = 15_000

/** git 출력에서 필드와 커밋을 가르는 제어 문자 (커밋 메시지에는 들어 있지 않다) */
const FIELD = '\x1f'
const RECORD = '\x1e'

export interface CommitOptions extends CollectOptions {
  /**
   * git 실행 파일이다.
   * 넘기지 않으면 찾고, null이면 커밋을 모으지 않는다.
   */
  git?: string | null
  /**
   * 전에 커밋을 읽어 본 저장소 폴더다.
   * 그 저장소의 대화를 모두 지웠어도 계속 본다.
   */
  knownRepos?: string[]
}

/**
 * 쓸 git을 고른다.
 * GUI로 실행된 앱은 셸 PATH를 물려받지 못해 'git'만으로는 못 찾을 수 있다.
 * 맥의 /usr/bin/git은 개발자 도구가 없으면 설치 창을 띄우므로, 실제 git이 깔려 있을 때만 쓴다.
 */
export function locateGit(platform: string = process.platform): string | null {
  if (platform === 'win32') return 'git'
  for (const p of ['/opt/homebrew/bin/git', '/usr/local/bin/git']) {
    if (existsSync(p)) return p
  }
  if (platform === 'darwin') {
    const developerGit = [
      '/Library/Developer/CommandLineTools/usr/bin/git',
      '/Applications/Xcode.app/Contents/Developer/usr/bin/git'
    ]
    return developerGit.some((p) => existsSync(p)) ? '/usr/bin/git' : null
  }
  return existsSync('/usr/bin/git') ? '/usr/bin/git' : null
}

interface Repo {
  /** 저장소 폴더 이름 */
  name: string
  /** git을 실행할 폴더 (워크트리에서 찾았어도 원래 저장소 폴더) */
  dir: string
  /** 이 저장소에서 쓰는 내 메일 */
  email: string
  /** 이 저장소에 속한 대화 시작 폴더 (cwdKey) */
  cwdKeys: Set<string>
}

/** git이 아예 없어서 저장소마다 다시 시도할 이유가 없다 */
class GitMissing extends Error {}

async function runGit(git: string, cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileP(git, args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true
    })
    return stdout
  } catch (e) {
    // cwd가 있는 것을 확인한 뒤에 부르므로 ENOENT는 실행 파일이 없다는 뜻이다
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new GitMissing()
    throw e
  }
}

/**
 * 폴더가 속한 저장소를 찾는다.
 * 저장소가 아니거나 이 저장소에 내 메일이 설정돼 있지 않으면 null이다.
 */
async function repoOf(git: string, cwd: string): Promise<Omit<Repo, 'cwdKeys'> | null> {
  if (!existsSync(cwd)) return null
  let common: string
  let email: string
  try {
    common = resolve(cwd, (await runGit(git, cwd, ['rev-parse', '--git-common-dir'])).trim())
    email = (await runGit(git, cwd, ['config', 'user.email'])).trim()
  } catch (e) {
    if (e instanceof GitMissing) throw e
    return null
  }
  if (!email) return null
  // 워크트리끼리 공유하는 이 폴더가 원래 저장소의 .git이다
  const dir = basename(common) === '.git' ? dirname(common) : common
  return { name: basename(dir).replace(/\.git$/, ''), dir, email }
}

interface RawCommit {
  authorMs: number
  subject: string
  body: string
}

/**
 * git --author는 정규식이다.
 * 메일에 든 점 같은 문자를 글자 그대로 맞추게 한다.
 */
function escapeRegex(s: string): string {
  return s.replace(/[\\.*^$[\]]/g, '\\$&')
}

/** 트레일러와 도구 서명은 업무 내용이 아니다 */
const TRAILER = /^(co-authored-by|signed-off-by|reviewed-by|change-id):/i
const GENERATED = /generated with \[?claude code/i

function cleanBody(body: string): string {
  const text = body
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() && !TRAILER.test(l.trim()) && !GENERATED.test(l))
    .join('\n')
  return text.length <= COMMIT_BODY_MAX_CHARS ? text : `${text.slice(0, COMMIT_BODY_MAX_CHARS)}…`
}

async function logCommits(
  git: string,
  repo: Omit<Repo, 'cwdKeys'>,
  startDate: string
): Promise<RawCommit[]> {
  const out = await runGit(git, repo.dir, [
    'log',
    // stash도 refs 아래의 커밋이라 --all에 딸려 온다.
    // 업무 기록이 아니므로 뺀다.
    '--exclude=refs/stash',
    '--all',
    '--no-merges',
    `--author=${escapeRegex(repo.email)}`,
    // --since는 커밋 시각으로 거르고, 그보다 오래된 커밋을 만나면 그 너머는 보지 않는다.
    // 커밋 시각이 거꾸로 된 히스토리에서는 그 너머에 있는 범위 안의 커밋을 놓친다.
    // 그래서 넉넉히 앞서부터 읽고 작성 시각으로 다시 거른다(attachCommits).
    `--since=${addDays(startDate, -SINCE_SLACK_DAYS)} 00:00:00 +0900`,
    `--format=%ae${FIELD}%aI${FIELD}%s${FIELD}%b${RECORD}`
  ])
  const me = repo.email.toLowerCase()
  const commits: RawCommit[] = []
  for (const rec of out.split(RECORD)) {
    const [email, date, subject, body] = rec.replace(/^\n/, '').split(FIELD)
    // --author는 이름까지 붙은 줄에서 찾으므로 메일이 정확히 같은 것만 남긴다
    if (!email || email.toLowerCase() !== me) continue
    const authorMs = Date.parse(date ?? '')
    if (!Number.isFinite(authorMs) || !subject?.trim()) continue
    commits.push({ authorMs, subject: subject.trim(), body: cleanBody(body ?? '') })
  }
  return commits
}

interface Entry {
  ms: number
  commit: DigestCommit
}

/**
 * 날짜별 원본에 그날 작성한 내 git 커밋을 붙인다.
 *
 * 저장소는 대화가 시작한 폴더에서 찾는다.
 * 대상 기간의 원본에 있는 폴더, 그보다 두 달 앞서부터 쓰인 대화의 폴더, 전에 기억해 둔 저장소를 모두 본다.
 * 같은 저장소의 폴더(하위 폴더, 워크트리)는 하나로 묶고 git log는 저장소마다 한 번만 돌린다.
 *
 * 커밋은 작성 시각으로 날짜를 나눈다.
 * 커밋 시각은 체리픽이나 리베이스를 하면 그날로 바뀌어서, 그날 하지 않은 작업이 그날 한 일로 잡힌다.
 * 체리픽으로 같은 제목의 커밋이 여럿이면 한 번만 담는다.
 *
 * 범위 안의 원본에는 커밋이 없어도 빈 배열을 남긴다.
 * 커밋을 모은 원본인지 가리는 표식이다.
 *
 * @returns 이번에 저장소로 확인한 폴더(기억해 둘 목록), git이 없어 확인하지 못했으면 null
 */
export async function attachCommits(
  digests: Map<string, DayDigest>,
  startDate: string,
  endDate: string,
  opts: CommitOptions = {}
): Promise<string[] | null> {
  for (const d of digests.values()) d.commits = []
  const git = opts.git === undefined ? locateGit() : opts.git
  if (!git || digests.size === 0) return null

  const cwds = new Map<string, string>()
  for (const cwd of opts.knownRepos ?? []) cwds.set(cwdKey(cwd), cwd)
  const lookbackMs = kstStartOfDayMs(startDate) - REPO_LOOKBACK_DAYS * DAY_MS
  for (const cwd of await sessionCwdsSince(lookbackMs, opts)) cwds.set(cwdKey(cwd), cwd)
  for (const d of digests.values()) for (const p of d.projects) cwds.set(cwdKey(p.cwd), p.cwd)

  const repos = new Map<string, Repo>()
  try {
    for (const [key, cwd] of cwds) {
      const found = await repoOf(git, cwd)
      if (!found) continue
      const id = cwdKey(found.dir)
      const repo = repos.get(id) ?? { ...found, cwdKeys: new Set<string>() }
      repo.cwdKeys.add(key)
      repos.set(id, repo)
    }
  } catch (e) {
    if (e instanceof GitMissing) return null
    throw e
  }

  const byDay = new Map<string, Map<Repo, Entry[]>>()
  for (const repo of repos.values()) {
    let raw: RawCommit[]
    try {
      raw = await logCommits(git, repo, startDate)
    } catch {
      continue
    }
    // 읽어 온 기간 전체에서 같은 꼴의 제목이 며칠에 걸쳐 나오는지 센다
    const daysByShape = new Map<string, Set<string>>()
    for (const c of raw) {
      const days = daysByShape.get(shapeOf(c.subject)) ?? new Set<string>()
      days.add(kstDateOf(c.authorMs))
      daysByShape.set(shapeOf(c.subject), days)
    }
    const seen = new Set<string>()
    for (const c of raw) {
      const date = kstDateOf(c.authorMs)
      if (date < startDate || date > endDate || !digests.has(date)) continue
      if ((daysByShape.get(shapeOf(c.subject))?.size ?? 0) >= AUTOMATED_MIN_DAYS) continue
      // 체리픽이나 리베이스로 생긴 같은 커밋이다
      const dupKey = `${date}\n${c.subject}`
      if (seen.has(dupKey)) continue
      seen.add(dupKey)
      const day = byDay.get(date) ?? new Map<Repo, Entry[]>()
      byDay.set(date, day)
      const entries = day.get(repo) ?? []
      day.set(repo, entries)
      entries.push({
        ms: c.authorMs,
        commit: { hhmm: kstHHMM(c.authorMs), subject: c.subject, ...(c.body ? { body: c.body } : {}) }
      })
    }
  }

  for (const [date, d] of digests) {
    const day = byDay.get(date)
    if (day) d.commits = toRepoCommits(d, day)
  }
  return [...repos.values()].map((r) => r.dir)
}

/**
 * 하루치 커밋을 저장소별로 정리한다.
 * 상한을 넘으면 이른 커밋부터 남긴다.
 * 그날 그 저장소에서 한 대화가 남아 있으면 그 프로젝트 옆에 보이도록 projectCwd를 단다.
 */
function toRepoCommits(d: DayDigest, day: Map<Repo, Entry[]>): RepoCommits[] {
  const kept = new Set(
    [...day.values()]
      .flat()
      .sort((a, b) => a.ms - b.ms)
      .slice(0, MAX_COMMITS_PER_DAY)
  )
  const result: RepoCommits[] = []
  for (const [repo, entries] of day) {
    entries.sort((a, b) => a.ms - b.ms)
    const commits = entries.filter((e) => kept.has(e)).map((e) => e.commit)
    const overflow = entries.length - commits.length
    const project = d.projects.find((p) => repo.cwdKeys.has(cwdKey(p.cwd)))
    result.push({
      name: repo.name,
      ...(project ? { projectCwd: project.cwd } : {}),
      commits,
      ...(overflow ? { overflow } : {})
    })
  }
  // 원본 프로젝트 순서를 따르고, 그날 대화가 없는 저장소는 뒤에 이름순으로 둔다
  const order = (rc: RepoCommits): number => {
    const i = rc.projectCwd === undefined ? -1 : d.projects.findIndex((p) => p.cwd === rc.projectCwd)
    return i === -1 ? Number.MAX_SAFE_INTEGER : i
  }
  return result.sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name))
}
