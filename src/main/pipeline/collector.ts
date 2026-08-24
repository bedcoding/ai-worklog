import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { kstDateOf, kstStartOfDayMs } from '@shared/dates'
import type { DayDigest } from '@shared/types'
import { buildDigest, newProjectAcc, type DayAcc } from './digest'

export interface CollectOptions {
  /** 기본 ~/.claude. 테스트에서 픽스처 디렉토리 주입용 */
  claudeDir?: string
  /** 수집에서 제외할 cwd (앱 자체 claude-workdir 등) */
  excludeCwds?: string[]
}

export interface CollectResult {
  /** KST 날짜 → 다이제스트 (활동 없는 날짜는 키 없음) */
  digests: Map<string, DayDigest>
  skippedLines: number
}

interface ContentBlock {
  type?: string
  text?: string
}

interface LogRecord {
  type?: string
  isSidechain?: boolean
  /** Claude Code가 주입한 메시지 표식. 사람이 타이핑한 프롬프트에는 없다 */
  isMeta?: boolean
  timestamp?: string
  cwd?: string
  gitBranch?: string
  sessionId?: string
  message?: {
    role?: string
    content?: string | ContentBlock[]
    usage?: { input_tokens?: number; output_tokens?: number }
  }
}

const DAY_MS = 86400_000

/**
 * 프로젝트 그룹 키.
 * 윈도우는 spawn cwd의 케이싱을 정규화하지 않아 같은 디렉토리가 'd:\dev\foo'와
 * 'D:\dev\foo'로 로그에 남는다. 그대로 키로 쓰면 이름이 같은 프로젝트가 둘로 갈라져
 * 프로젝트 수·세션 수가 부풀고 digestHash도 흔들린다. 표시용 cwd 원문은 보존한다.
 */
export const cwdKey = (cwd: string, platform: string = process.platform): string =>
  platform === 'win32' ? cwd.toLowerCase() : cwd

/**
 * ~/.claude/projects/<프로젝트>/*.jsonl을 스트리밍 파싱해 [startDate, endDate](KST, inclusive)
 * 범위의 일별 다이제스트를 만든다.
 * 스캔 깊이는 정확히 2단계다. 그 아래(서브에이전트 워크플로 로그 등)는 보지 않는다.
 *
 * 성능: 레코드를 쓰면 파일 mtime이 그 시각 이후가 되므로, mtime이 범위 시작보다
 * 이전인 파일에는 범위 내 레코드가 있을 수 없다 → mtime 필터로 대부분을 건너뛴다.
 *
 * 다만 그 역은 성립하지 않는다. 파일 내용이 시간 순서로만 쌓이지는 않는다. 여러 날에
 * 걸치는 긴 세션의 파일에는 옛 날짜 타임스탬프를 가진 레코드가 나중에 덧붙는다
 * (실측: 8/23 레코드보다 뒤에 적힌 8/22 레코드 1380개). 그래서 '하루가 지나면 그 날
 * 다이제스트는 확정'이 아니고, 읽은 파일의 mtime을 남겨 두어야 낡음을 알 수 있다.
 * 날짜 분류는 세션이 아니라 레코드 단위(자정을 넘는 세션도 올바르게 분리).
 */
export async function collectDigests(
  startDate: string,
  endDate: string,
  opts: CollectOptions = {}
): Promise<CollectResult> {
  const claudeDir = opts.claudeDir ?? join(homedir(), '.claude')
  // map(cwdKey)로 쓰면 배열 인덱스가 platform 인자로 들어가 정규화가 조용히 꺼진다
  const excludeCwds = new Set((opts.excludeCwds ?? []).map((c) => cwdKey(c)))
  const startMs = kstStartOfDayMs(startDate)
  const endMs = kstStartOfDayMs(endDate) + DAY_MS

  const files = await listJsonlFiles(join(claudeDir, 'projects'), startMs)

  const days = new Map<string, DayAcc>()
  /** 프롬프트를 이미 본 세션. 세션 첫 프롬프트 판별용 */
  const sessionSeen = new Set<string>()
  let skippedLines = 0

  for (const file of files) {
    const rl = createInterface({
      input: createReadStream(file.path, 'utf8'),
      crlfDelay: Infinity
    })
    for await (const line of rl) {
      if (!line.trim()) continue
      let rec: LogRecord
      try {
        rec = JSON.parse(line) as LogRecord
      } catch {
        skippedLines++
        continue
      }
      if (rec.type !== 'user' && rec.type !== 'assistant') continue
      if (rec.isSidechain) continue
      const tsMs = rec.timestamp ? Date.parse(rec.timestamp) : NaN
      if (!Number.isFinite(tsMs) || tsMs < startMs || tsMs >= endMs) continue
      const cwd = rec.cwd ?? '(알 수 없음)'
      const key = cwdKey(cwd)
      if (excludeCwds.has(key)) continue

      const date = kstDateOf(tsMs)
      let day = days.get(date)
      if (!day) {
        day = { date, projects: new Map(), sources: new Map() }
        days.set(date, day)
      }
      // 이 날짜의 레코드가 이 파일에서 나왔다. 나중에 이 파일이 바뀌면 낡은 것이다
      day.sources.set(file.path, file.mtimeMs)
      let proj = day.projects.get(key)
      if (!proj) {
        proj = newProjectAcc(cwd)
        day.projects.set(key, proj)
      }
      if (rec.gitBranch) proj.branches.add(rec.gitBranch)
      if (rec.sessionId) proj.sessions.add(rec.sessionId)

      if (rec.type === 'user') {
        const text = extractUserText(rec)
        if (text) {
          // 날짜를 키에 포함해 "그 날 안에서의 첫 프롬프트"로 정의한다.
          // 스캔 범위(하루 vs 한 달)에 따라 판정이 뒤집혀 digestHash가 흔들리는 것을 막는다.
          const sessionKey = `${date}:${rec.sessionId ?? file.path}`
          const isSessionFirst = !sessionSeen.has(sessionKey)
          sessionSeen.add(sessionKey)
          proj.prompts.push({ tsMs, text, isSessionFirst })
        }
      } else {
        const usage = rec.message?.usage
        proj.tokensIn += usage?.input_tokens ?? 0
        proj.tokensOut += usage?.output_tokens ?? 0
        if (Array.isArray(rec.message?.content)) {
          proj.toolCallCount += rec.message.content.filter((b) => b?.type === 'tool_use').length
        }
      }
    }
  }

  const digests = new Map<string, DayDigest>()
  for (const [date, acc] of days) {
    digests.set(date, buildDigest(acc, skippedLines))
  }
  return { digests, skippedLines }
}

/** mtime도 함께 준다. 다이제스트에 남겨 두면 나중에 바뀌었는지 볼 수 있다 */
interface LogFile {
  path: string
  mtimeMs: number
}

async function listJsonlFiles(projectsDir: string, minMtimeMs: number): Promise<LogFile[]> {
  let dirs: string[]
  try {
    dirs = await readdir(projectsDir)
  } catch {
    return []
  }
  const files: LogFile[] = []
  for (const dir of dirs) {
    const dirPath = join(projectsDir, dir)
    let entries: string[]
    try {
      entries = await readdir(dirPath)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue
      const filePath = join(dirPath, entry)
      try {
        const s = await stat(filePath)
        if (s.isFile() && s.mtimeMs >= minMtimeMs) files.push({ path: filePath, mtimeMs: s.mtimeMs })
      } catch {
        // 삭제 경합 등은 무시
      }
    }
  }
  return files
}

/**
 * user 레코드에서 실제로 타이핑된 프롬프트만 추출한다.
 * - tool_result 블록(도구 출력 반환)은 제외
 * - "<command-name>..." 같은 슬래시 명령 부산물(< 로 시작)은 제외
 * - isMeta 레코드 제외. role이 user여도 사람이 친 것이 아니라 Claude Code가 넣은
 *   텍스트다. 이미지를 붙이면 생기는 "[Image: original ...]" 안내문, 스킬 본문 전체,
 *   슬래시 커맨드가 펼쳐진 내용이 여기 해당한다. 걸러내지 않으면 프롬프트 수가 부풀고
 *   (실측 11309건 중 1947건, 17%), 스킬 지침문이 그날 한 일처럼 요약에 섞인다.
 */
function extractUserText(rec: LogRecord): string | null {
  if (rec.message?.role !== 'user') return null
  if (rec.isMeta) return null
  const content = rec.message.content
  let text: string
  if (typeof content === 'string') {
    text = content
  } else if (Array.isArray(content)) {
    text = content
      .filter((b) => b?.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('\n')
  } else {
    return null
  }
  text = text.trim()
  if (!text || text.startsWith('<')) return null
  return text
}
