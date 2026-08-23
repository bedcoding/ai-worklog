import { describe, expect, it } from 'vitest'
import { modelOf, wantedModel } from '../src/main/claude/run'

/**
 * 실제 CLI 응답에서 그대로 옮긴 modelUsage.
 * `--model sonnet` 으로 '숫자 7만 출력해라' 를 돌린 결과다.
 * 보조 호출이 haiku 로 나가고, 그 키가 먼저 온다.
 */
const SONNET_RUN = {
  modelUsage: {
    'claude-haiku-4-5-20251001': { inputTokens: 1282, outputTokens: 16, costUSD: 0.001362 },
    'claude-sonnet-5': { inputTokens: 2, outputTokens: 3, costUSD: 0.0735123 }
  }
}

describe('modelOf', () => {
  it('보조 호출이 첫 키여도 요청한 모델을 고른다', () => {
    // 첫 키를 그냥 쓰던 탓에 소넷으로 만든 요약에 haiku-4.5 가 찍혔다
    expect(Object.keys(SONNET_RUN.modelUsage)[0]).toBe('claude-haiku-4-5-20251001')
    expect(modelOf(SONNET_RUN, 'sonnet')).toBe('claude-sonnet-5')
  })

  it('출력 토큰이 많은 쪽을 고르면 안 된다는 것을 이 데이터가 보여준다', () => {
    // haiku 16 > sonnet 3. '토큰 최대'로 골랐다면 여기서도 틀렸다
    const u = SONNET_RUN.modelUsage
    expect(u['claude-haiku-4-5-20251001'].outputTokens).toBeGreaterThan(
      u['claude-sonnet-5'].outputTokens
    )
  })

  it('기본으로 뒀으면 CLI 설정의 모델명으로 찾는다', () => {
    const run = {
      modelUsage: {
        'claude-haiku-4-5-20251001': {},
        'claude-fable-5': {}
      }
    }
    expect(modelOf(run, wantedModel('default', 'claude-fable-5[1m]'))).toBe('claude-fable-5')
  })

  it('키가 하나면 보조 호출이 없었다는 뜻이라 그것을 쓴다', () => {
    expect(modelOf({ modelUsage: { 'claude-opus-5': {} } })).toBe('claude-opus-5')
  })

  it('여러 개인데 단서가 없으면 아무것도 적지 않는다', () => {
    // 틀린 이름을 적는 것은 이름을 비우는 것보다 나쁘다
    expect(modelOf(SONNET_RUN, null)).toBeNull()
  })

  it('단서가 어느 키와도 안 맞으면 비운다', () => {
    expect(modelOf(SONNET_RUN, 'claude-gpt-9')).toBeNull()
  })

  it('modelUsage 가 없으면 null', () => {
    expect(modelOf({})).toBeNull()
    expect(modelOf({ modelUsage: {} })).toBeNull()
  })
})

describe('wantedModel', () => {
  it('별칭을 고른 경우 그 별칭이 단서다', () => {
    expect(wantedModel('sonnet')).toBe('sonnet')
    expect(wantedModel('opus')).toBe('opus')
  })

  it('기본은 CLI 설정 모델명에서 꼬리표를 뗀 것이 단서다', () => {
    expect(wantedModel('default', 'claude-fable-5[1m]')).toBe('claude-fable-5')
    expect(wantedModel('default', 'claude-sonnet-5')).toBe('claude-sonnet-5')
  })

  it('기본인데 CLI 설정을 읽지 못했으면 단서가 없다', () => {
    expect(wantedModel('default')).toBeNull()
    expect(wantedModel('default', null)).toBeNull()
    expect(wantedModel('default', '   ')).toBeNull()
  })
})
