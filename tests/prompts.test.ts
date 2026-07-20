import { describe, expect, it } from 'vitest'
import { DEFAULT_PROMPTS, renderTemplate } from '../src/main/prompts'
import { extractJson } from '../src/main/claude/run'

describe('renderTemplate', () => {
  it('플레이스홀더를 치환하고 JSON 예시는 보존한다', () => {
    const out = renderTemplate(DEFAULT_PROMPTS.day, {
      date: '2026-07-19',
      weekday: '일',
      digest: '[프로젝트: test] ...'
    })
    expect(out).toContain('2026-07-19(일, KST)')
    expect(out).toContain('[프로젝트: test]')
    // JSON 스키마 예시의 "headline"은 치환 대상이 아니어야 한다
    expect(out).toContain('{"headline"')
    expect(out).not.toContain('{date}')
    expect(out).not.toContain('{digest}')
  })

  it('정의되지 않은 플레이스홀더는 그대로 둔다', () => {
    expect(renderTemplate('a {known} b {unknown}', { known: 'X' })).toBe('a X b {unknown}')
  })
})

describe('extractJson', () => {
  it('일반 JSON, 코드펜스, 앞뒤 잡음을 모두 처리한다', () => {
    expect(extractJson<{ a: number }>('{"a": 1}')).toEqual({ a: 1 })
    expect(extractJson<{ a: number }>('```json\n{"a": 1}\n```')).toEqual({ a: 1 })
    expect(extractJson<{ a: number }>('네, 결과입니다:\n{"a": 1}\n감사합니다')).toEqual({ a: 1 })
    expect(extractJson('JSON이 전혀 없는 텍스트')).toBeNull()
  })
})
