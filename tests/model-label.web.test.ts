import { describe, expect, it } from 'vitest'
import { madeByLabel, modelLabel, shortModel } from '../src/renderer/src/common'

describe('shortModel', () => {
  it('claude- 접두어를 뗀다', () => {
    expect(shortModel('claude-fable-5')).toBe('fable-5')
  })

  it('[1m] 같은 꼬리표를 뗀다', () => {
    // 실제 CLI 설정에 있던 값이다
    expect(shortModel('claude-fable-5[1m]')).toBe('fable-5')
  })

  it('날짜 꼬리를 떼고 버전을 점으로 되돌린다', () => {
    expect(shortModel('claude-haiku-4-5-20251001')).toBe('haiku-4.5')
  })

  it('모르는 모양은 그대로 둔다', () => {
    expect(shortModel('some-other-model')).toBe('some-other-model')
  })
})

describe('modelLabel', () => {
  it('고른 값을 사람이 읽는 이름으로', () => {
    expect(modelLabel('opus')).toBe('Opus 5')
    expect(modelLabel('fable')).toBe('Fable 5')
    expect(modelLabel('sonnet')).toBe('Sonnet 5')
    expect(modelLabel('haiku')).toBe('Haiku 4.5')
  })

  it('기본으로 두면 실제 모델명을 밝힌다', () => {
    // 이것이 없어서 Fable 5로 요약되는 줄 모르고 지냈다
    expect(modelLabel('default', 'claude-fable-5[1m]')).toBe('fable-5 (CLI 기본)')
  })

  it('실제 모델명을 모르면 아는 척하지 않는다', () => {
    expect(modelLabel('default')).toBe('CLI 기본 모델')
    expect(modelLabel('default', null)).toBe('CLI 기본 모델')
  })
})

describe('madeByLabel', () => {
  it('실제로 응답한 모델명을 쓴다', () => {
    expect(madeByLabel('sonnet', 'claude-sonnet-5')).toBe('sonnet-5')
  })

  it('기본으로 만든 것은 그 사실도 남긴다', () => {
    // 실제 이름만 적으면 그것이 CLI 설정을 따른 결과였다는 사실이 사라진다
    expect(madeByLabel('default', 'claude-fable-5')).toBe('fable-5 (CLI 기본)')
  })

  it('모델명이 없던 옛 요약은 고른 값으로 적는다', () => {
    expect(madeByLabel('default')).toBe('CLI 기본 모델')
    expect(madeByLabel('haiku')).toBe('Haiku 4.5')
  })
})
