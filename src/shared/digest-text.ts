import type { DayDigest, DigestPrompt } from './types'

/** 프롬프트 한 줄. 절단 예산(digest.ts)도 이 길이로 잰다 */
export function renderPromptLine(dp: DigestPrompt): string {
  const repeat = dp.repeat ? ` (x${dp.repeat})` : ''
  return `- ${dp.hhmm} ${dp.text}${repeat}`
}

/**
 * 다이제스트를 사람이 읽는 텍스트로 렌더한다.
 * main(claude 프롬프트 데이터)과 renderer(원본 내역 복사)가 공유한다.
 */
export function renderDigestText(d: DayDigest): string {
  const lines: string[] = []
  for (const p of d.projects) {
    const branches = p.branches.length ? ` 브랜치: ${p.branches.join(', ')} ·` : ''
    lines.push(
      `[프로젝트: ${p.name}]${branches} 세션 ${p.sessionCount} · 프롬프트 ${p.promptCount} · 도구 호출 ${p.toolCallCount}`
    )
    for (const dp of p.prompts) lines.push(renderPromptLine(dp))
    if (p.overflow) lines.push(`(외 ${p.overflow}건 생략)`)
    lines.push('')
  }
  return lines.join('\n').trim()
}
