import { describe, expect, it } from 'vitest'
import { renderDigestText } from '../src/shared/digest-text'
import {
  MAX_PROMPTS_PER_DAY,
  PROMPT_LINES_MAX_CHARS,
  PROMPT_MAX_CHARS,
  buildDigest,
  digestHash,
  isActiveDigest,
  newProjectAcc,
  type DayAcc
} from '../src/main/pipeline/digest'

function accWith(prompts: { tsMs: number; text: string; isSessionFirst?: boolean }[]): DayAcc {
  const proj = newProjectAcc('/Users/test/proj')
  proj.branches.add('main')
  proj.sessions.add('s1')
  proj.prompts = prompts.map((p) => ({ isSessionFirst: false, ...p }))
  return { date: '2026-07-19', projects: new Map([['/Users/test/proj', proj]]), sources: new Map() }
}

describe('buildDigest', () => {
  it('긴 프롬프트는 절단된다', () => {
    const d = buildDigest(accWith([{ tsMs: Date.parse('2026-07-19T01:00:00Z'), text: 'x'.repeat(500) }]), 0)
    expect(d.projects[0].prompts[0].text.length).toBeLessThanOrEqual(PROMPT_MAX_CHARS + 1)
  })

  it('앞부분이 같은 반복 프롬프트는 병합되고 repeat이 기록된다', () => {
    const t = Date.parse('2026-07-19T01:00:00Z')
    const base = '반복되는 아주 긴 프롬프트 접두어 '.repeat(5)
    const d = buildDigest(
      accWith([
        { tsMs: t, text: `${base} 1` },
        { tsMs: t + 1000, text: `${base} 2` },
        { tsMs: t + 2000, text: '완전히 다른 프롬프트' }
      ]),
      0
    )
    expect(d.projects[0].prompts.length).toBe(2)
    expect(d.projects[0].prompts[0].repeat).toBe(2)
    expect(d.totals.promptCount).toBe(3)
  })

  it('하루 프롬프트 수가 캡을 넘으면 잘리고 overflow가 기록된다', () => {
    const t = Date.parse('2026-07-19T01:00:00Z')
    const prompts = Array.from({ length: MAX_PROMPTS_PER_DAY + 20 }, (_, i) => ({
      tsMs: t + i * 60_000,
      text: `서로 다른 작업 지시 ${i} ${'내용'.repeat(i % 7)}`
    }))
    const d = buildDigest(accWith(prompts), 0)
    expect(d.projects[0].prompts.length).toBeLessThanOrEqual(MAX_PROMPTS_PER_DAY)
    expect(d.projects[0].overflow).toBeGreaterThan(0)
  })

  it('프롬프트 없는 폴더가 많아도 프롬프트를 남긴다', () => {
    // 세션 안에서 하위 폴더로 옮겨 다니면 폴더마다 프로젝트가 따로 잡힌다.
    // 머리줄과 cwd까지 예산으로 세던 때는 이런 날 프롬프트를 다 덜어 내도 예산을 넘어, 원본 내역에 프롬프트가 하나도 남지 않았다.
    const acc = accWith([{ tsMs: Date.parse('2026-07-19T01:00:00Z'), text: '정산 페이지 수정' }])
    for (let i = 0; i < 80; i++) {
      const cwd = `/private/tmp/scratchpad/${'sub/'.repeat(50)}wt-${i}`
      const p = newProjectAcc(cwd)
      p.sessions.add('s1')
      p.toolCallCount = 3
      acc.projects.set(cwd, p)
    }
    const d = buildDigest(acc, 0)
    expect(d.projects.find((p) => p.name === 'proj')?.prompts).toHaveLength(1)
  })

  it('예산은 claude에 들어가는 프롬프트 줄로 재고 넘는 만큼만 덜어 낸다', () => {
    const t = Date.parse('2026-07-19T01:00:00Z')
    // 하루 캡(80개)에는 걸리지 않고 예산만 넘는 양
    const prompts = Array.from({ length: 70 }, (_, i) => ({
      tsMs: t + i * 60_000,
      text: `${i} ${'가'.repeat(PROMPT_MAX_CHARS)}`
    }))
    const d = buildDigest(accWith(prompts), 0)
    const lines = renderDigestText(d).split('\n').filter((l) => l.startsWith('- '))
    const used = lines.reduce((n, l) => n + l.length + 1, 0)
    expect(used).toBeLessThanOrEqual(PROMPT_LINES_MAX_CHARS)
    // 한 줄만 더 담아도 예산을 넘는다.
    // 필요 이상 덜어 내지 않았다는 뜻이다.
    expect(used + lines[0].length + 1).toBeGreaterThan(PROMPT_LINES_MAX_CHARS)
    expect(d.projects[0].overflow).toBe(70 - lines.length)
  })

  it('digestHash는 builtAt과 무관하게 안정적이다', () => {
    const prompts = [{ tsMs: Date.parse('2026-07-19T01:00:00Z'), text: '작업' }]
    const a = buildDigest(accWith(prompts), 0)
    const b = buildDigest(accWith(prompts), 5)
    expect(a.builtAt).not.toBe('')
    expect(digestHash(a)).toBe(digestHash(b))
  })

  it('활동 판정과 빈 다이제스트', () => {
    const empty = buildDigest({ date: '2026-07-19', projects: new Map(), sources: new Map() }, 0)
    expect(isActiveDigest(empty)).toBe(false)
    const active = buildDigest(accWith([{ tsMs: Date.parse('2026-07-19T01:00:00Z'), text: '작업' }]), 0)
    expect(isActiveDigest(active)).toBe(true)
  })

  it('renderDigestText는 프로젝트/프롬프트를 사람이 읽는 형태로 렌더한다', () => {
    const d = buildDigest(accWith([{ tsMs: Date.parse('2026-07-19T01:00:00Z'), text: '정산 페이지 수정' }]), 0)
    const text = renderDigestText(d)
    expect(text).toContain('[프로젝트: proj]')
    expect(text).toContain('10:00 정산 페이지 수정')
    expect(text).toContain('브랜치: main')
  })
})
