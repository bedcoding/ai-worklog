import { sha256 } from '../cache'
import { kstHHMM } from '@shared/dates'
import type { DayDigest, DigestPrompt, ProjectDigest } from '@shared/types'

/** 프롬프트 1개 최대 길이 */
export const PROMPT_MAX_CHARS = 280
/** 하루 다이제스트에 담는 최대 프롬프트 수 */
export const MAX_PROMPTS_PER_DAY = 80
/** 직렬화된 다이제스트 총량 캡 (claude 호출 비용/지연 제어) */
export const DIGEST_MAX_CHARS = 16_000
/** 유사 프롬프트 병합 기준: 앞 N자가 같으면 반복으로 취급 */
const DEDUP_PREFIX = 80

export interface PromptEntry {
  tsMs: number
  text: string
  /** 세션의 첫 프롬프트 — 맥락 대표성이 높아 절단 시 우선 보존 */
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
  /** key: cwd */
  projects: Map<string, ProjectAcc>
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

function basenameOf(cwd: string): string {
  const parts = cwd.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? cwd
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
      name: basenameOf(p.cwd),
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

  // isSessionFirst는 내부 선별용 — 최종 산출물에서는 제거
  for (const p of projects) {
    for (const dp of p.prompts) delete (dp as { isSessionFirst?: boolean }).isSessionFirst
  }

  return {
    date: acc.date,
    projects,
    totals,
    skippedLines,
    builtAt: new Date().toISOString()
  }
}

/** 하루 총 프롬프트 수 캡 + 직렬화 총량 캡 적용 (overflow 기록) */
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

  while (serializedSize(projects) > DIGEST_MAX_CHARS) {
    const target = projects.reduce((a, b) => (a.prompts.length >= b.prompts.length ? a : b))
    if (target.prompts.length === 0) break
    target.prompts.pop()
    target.overflow = (target.overflow ?? 0) + 1
  }
}

function serializedSize(projects: ProjectDigest[]): number {
  return JSON.stringify(projects).length
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`
}

/** 활동 여부: 사용자가 실제로 프롬프트를 입력한 날만 활동일로 본다 */
export function isActiveDigest(d: DayDigest): boolean {
  return d.totals.promptCount > 0
}

/** 캐시 무효화 키 — builtAt/skippedLines 등 비본질 필드는 제외 */
export function digestHash(d: DayDigest): string {
  return sha256(JSON.stringify({ date: d.date, projects: d.projects }))
}
