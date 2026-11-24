import type { DayDigest, DigestCommit, DigestPrompt, RepoCommits } from './types'

/** 프롬프트 한 줄. 절단 예산(digest.ts)도 이 길이로 잰다 */
export function renderPromptLine(dp: DigestPrompt): string {
  const repeat = dp.repeat ? ` (x${dp.repeat})` : ''
  return `- ${dp.hhmm} ${dp.text}${repeat}`
}

/** 커밋 한 건 (본문은 제목 아래에 들여 쓴다) */
export function renderCommitLines(c: DigestCommit): string[] {
  const lines = [`- ${c.hhmm} ${c.subject}`]
  for (const l of c.body ? c.body.split('\n') : []) lines.push(`  ${l}`)
  return lines
}

function pushCommits(lines: string[], rc: RepoCommits): void {
  lines.push('git 커밋:')
  for (const c of rc.commits) lines.push(...renderCommitLines(c))
  if (rc.overflow) lines.push(`(외 ${rc.overflow}건 생략)`)
}

/**
 * 다이제스트를 사람이 읽는 텍스트로 렌더한다.
 * main(claude 프롬프트 데이터)과 renderer(원본 내역 복사)가 공유한다.
 */
export function renderDigestText(d: DayDigest): string {
  const lines: string[] = []
  const commits = d.commits ?? []
  const shown = new Set<RepoCommits>()
  for (const p of d.projects) {
    const branches = p.branches.length ? ` 브랜치: ${p.branches.join(', ')} ·` : ''
    lines.push(
      `[프로젝트: ${p.name}]${branches} 세션 ${p.sessionCount} · 프롬프트 ${p.promptCount} · 도구 호출 ${p.toolCallCount}`
    )
    for (const dp of p.prompts) lines.push(renderPromptLine(dp))
    if (p.overflow) lines.push(`(외 ${p.overflow}건 생략)`)
    const rc = commits.find((c) => c.projectCwd === p.cwd)
    if (rc) {
      pushCommits(lines, rc)
      shown.add(rc)
    }
    lines.push('')
  }
  // 그날 대화가 남아 있지 않은 저장소의 커밋이다
  for (const rc of commits) {
    if (shown.has(rc)) continue
    lines.push(`[프로젝트: ${rc.name}] 이날 대화 기록 없음`)
    pushCommits(lines, rc)
    lines.push('')
  }
  return lines.join('\n').trim()
}
