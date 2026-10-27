import { sha256 } from '../cache'
import { kstHHMM } from '@shared/dates'
import { renderPromptLine } from '@shared/digest-text'
import type { DayDigest, DigestPrompt, ProjectDigest } from '@shared/types'

/** 프롬프트 1개 최대 길이 */
export const PROMPT_MAX_CHARS = 280
/** 하루 다이제스트에 담는 최대 프롬프트 수 */
export const MAX_PROMPTS_PER_DAY = 80
/** 하루 프롬프트 줄 총량 캡 (claude 호출 비용/지연 제어, 프로젝트 머리줄은 세지 않음) */
export const PROMPT_LINES_MAX_CHARS = 16_000
/** 유사 프롬프트 병합 기준: 앞 N자가 같으면 반복으로 취급 */
const DEDUP_PREFIX = 80

export interface PromptEntry {
  tsMs: number
  text: string
  /** 세션의 첫 프롬프트. 맥락 대표성이 높아 절단 시 우선 보존 */
  isSessionFirst: boolean
}

export interface ProjectAcc {
  cwd: string
  branches: Set<string>
  sessions: Set<string>
  toolCallCount: number
  tokensIn: number
  tokensOut: number
  prompts: PromptEntry[]
}

export interface DayAcc {
  date: string
  /** key: 대화를 시작한 폴더의 cwdKey (collector의 sessionCwd) */
  projects: Map<string, ProjectAcc>
  /**
   * 이 날짜의 레코드가 나온 로그 파일 경로 → 읽던 시점의 mtime.
   * 이 날짜에 기여하지 않은 파일은 담지 않는다. 담으면 지난달 다이제스트가
   * 새 세션이 생길 때마다 낡은 것으로 잡힌다.
   */
  sources: Map<string, number>
}

export function newProjectAcc(cwd: string): ProjectAcc {
  return {
    cwd,
    branches: new Set(),
    sessions: new Set(),
    toolCallCount: 0,
    tokensIn: 0,
    tokensOut: 0,
    prompts: []
  }
}

/**
 * cwd에서 프로젝트명(마지막 경로 조각)을 뽑는다.
 *
 * 윈도우 로그의 cwd는 'D:\dev\proj' 형태여서 '/'로만 자르면 경로 전체가 프로젝트명이
 * 되고, 그 값이 AI 요약과 사내 제출 증빙까지 흘러가 로컬 디렉토리 구조가 노출된다.
 * 그렇다고 항상 백슬래시로도 자르면 안 된다. POSIX에서 백슬래시는 파일명에 쓸 수 있는
 * 정상 문자이므로 맥의 'my\weird dir' 같은 디렉토리명이 잘려 버린다.
 * 윈도우는 '/'도 구분자로 받아들이므로 플랫폼별로 규칙을 나눈다.
 *
 * path.basename()은 호스트 OS 규칙만 따라 테스트에서 양쪽을 검증할 수 없으므로 쓰지 않는다.
 */
export function projectNameOf(cwd: string, platform: string = process.platform): string {
  const parts = cwd.split(platform === 'win32' ? /[\\/]/ : /\//).filter(Boolean)
  const last = parts[parts.length - 1]
  if (!last) return cwd
  // 드라이브 루트만 있는 cwd('D:\')는 'D:'가 되므로 원문을 쓴다
  if (parts.length === 1 && /^[A-Za-z]:$/.test(last)) return cwd
  return last
}

export function buildDigest(acc: DayAcc, skippedLines: number): DayDigest {
  const projects: ProjectDigest[] = []
  for (const p of acc.projects.values()) {
    const sorted = [...p.prompts].sort((a, b) => a.tsMs - b.tsMs)
    // 앞부분이 같은 반복 프롬프트 병합
    const merged: { entry: PromptEntry; repeat: number }[] = []
    const seen = new Map<string, number>() // prefix → merged index
    for (const e of sorted) {
      const key = e.text.slice(0, DEDUP_PREFIX)
      const idx = seen.get(key)
      if (idx === undefined) {
        seen.set(key, merged.length)
        merged.push({ entry: e, repeat: 1 })
      } else {
        merged[idx].repeat++
        merged[idx].entry.isSessionFirst ||= e.isSessionFirst
      }
    }
    projects.push({
      name: projectNameOf(p.cwd),
      cwd: p.cwd,
      branches: [...p.branches].filter(Boolean).sort(),
      sessionCount: p.sessions.size,
      promptCount: p.prompts.length,
      toolCallCount: p.toolCallCount,
      tokens: { input: p.tokensIn, output: p.tokensOut },
      prompts: merged.map(({ entry, repeat }) => {
        const dp: DigestPrompt & { isSessionFirst?: boolean } = {
          hhmm: kstHHMM(entry.tsMs),
          text: truncate(entry.text, PROMPT_MAX_CHARS)
        }
        if (repeat > 1) dp.repeat = repeat
        if (entry.isSessionFirst) dp.isSessionFirst = true
        return dp
      })
    })
  }
  projects.sort((a, b) => b.promptCount - a.promptCount)

  applyDayBudget(projects)

  const totals = projects.reduce(
    (t, p) => ({
      sessionCount: t.sessionCount + p.sessionCount,
      promptCount: t.promptCount + p.promptCount,
      toolCallCount: t.toolCallCount + p.toolCallCount,
      tokens: {
        input: t.tokens.input + p.tokens.input,
        output: t.tokens.output + p.tokens.output
      }
    }),
    { sessionCount: 0, promptCount: 0, toolCallCount: 0, tokens: { input: 0, output: 0 } }
  )

  // isSessionFirst는 내부 선별용. 최종 산출물에서는 제거
  for (const p of projects) {
    for (const dp of p.prompts) delete (dp as { isSessionFirst?: boolean }).isSessionFirst
  }

  return {
    date: acc.date,
    projects,
    totals,
    skippedLines,
    builtAt: new Date().toISOString(),
    sources: [...acc.sources].map(([path, mtimeMs]) => ({ path, mtimeMs }))
  }
}

/** 하루 총 프롬프트 수 캡 + 프롬프트 줄 총량 캡 적용 (overflow 기록) */
function applyDayBudget(projects: ProjectDigest[]): void {
  const total = (): number => projects.reduce((n, p) => n + p.prompts.length, 0)

  if (total() > MAX_PROMPTS_PER_DAY) {
    // 전체 풀에서 세션 첫 프롬프트 우선, 그다음 긴 순으로 선별
    type Dp = DigestPrompt & { isSessionFirst?: boolean }
    const all: Dp[] = projects.flatMap((p) => p.prompts as Dp[])
    const rank = (dp: Dp): number =>
      (dp.isSessionFirst ? 1_000_000 : 0) + dp.text.length + (dp.repeat ?? 0) * 100
    const keep = new Set<Dp>([...all].sort((a, b) => rank(b) - rank(a)).slice(0, MAX_PROMPTS_PER_DAY))
    for (const p of projects) {
      const kept = p.prompts.filter((dp) => keep.has(dp as Dp))
      p.overflow = (p.overflow ?? 0) + (p.prompts.length - kept.length)
      p.prompts = kept
    }
  }

  while (promptLinesSize(projects) > PROMPT_LINES_MAX_CHARS) {
    const target = projects.reduce((a, b) => (a.prompts.length >= b.prompts.length ? a : b))
    if (target.prompts.length === 0) break
    target.prompts.pop()
    target.overflow = (target.overflow ?? 0) + 1
  }
}

/**
 * claude에 실제로 들어가는 프롬프트 줄의 총량이다.
 * 줄마다 줄바꿈 하나를 더한다.
 *
 * 예전에는 projects 전체를 JSON으로 직렬화해 쟀다.
 * 그러면 claude에 보내지도 않는 cwd 전체 경로까지 예산을 먹는다.
 * 프로젝트 머리줄도 함께 셌는데, 머리줄은 프롬프트를 덜어 내도 줄지 않아서 세션이 여러 폴더를 옮겨 다녀 폴더가 수십 개로 갈린 날은 프롬프트를 다 덜어 내고도 예산을 넘었다.
 * 실측: 폴더가 60개로 갈린 날 프롬프트 101개가 하나도 남지 않았고, AI 요약은 머리줄만 보고 만들어졌다.
 */
function promptLinesSize(projects: ProjectDigest[]): number {
  let n = 0
  for (const p of projects) for (const dp of p.prompts) n += renderPromptLine(dp).length + 1
  return n
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`
}

/** 활동 여부: 사용자가 실제로 프롬프트를 입력한 날만 활동일로 본다 */
export function isActiveDigest(d: DayDigest): boolean {
  return d.totals.promptCount > 0
}

/** 캐시 무효화 키. builtAt/skippedLines 등 비본질 필드는 제외 */
export function digestHash(d: DayDigest): string {
  return sha256(JSON.stringify({ date: d.date, projects: d.projects }))
}
