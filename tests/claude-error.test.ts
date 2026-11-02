import { describe, expect, it } from 'vitest'
import { AUTH_FAILURE_MESSAGE, isAuthFailure, isAuthFailureMessage } from '../src/shared/claude-error'

describe('isAuthFailure', () => {
  it('실측한 CLI 인증 만료 문구를 잡는다', () => {
    // 2026-09-07, claude 2.1.251. stdout으로 나오고 종료 코드는 1이었다
    expect(
      isAuthFailure('Failed to authenticate: OAuth session expired and could not be refreshed')
    ).toBe(true)
  })

  it('다른 표현의 인증 오류도 잡는다', () => {
    expect(isAuthFailure('Invalid API key · Please run /login')).toBe(true)
    expect(isAuthFailure('401 Unauthorized')).toBe(true)
    expect(isAuthFailure('{"type":"authentication_error"}')).toBe(true)
    expect(isAuthFailure('OAuth token has expired')).toBe(true)
  })

  it('앱이 바꿔 쓴 안내 문장도 인증 실패로 본다', () => {
    // runClaude는 이 문장을 던진 뒤 같은 문장으로 로그인 상태를 켠다.
    // 자동 실행 기록에도 이 문장이 남고, 앱을 켤 때 그 기록으로 로그인 상태를 되살린다.
    expect(isAuthFailure(AUTH_FAILURE_MESSAGE)).toBe(true)
    expect(isAuthFailure(`자동 요약 실패: ${AUTH_FAILURE_MESSAGE}`)).toBe(true)
  })

  it('빈 값은 인증 실패가 아니다', () => {
    expect(isAuthFailure('')).toBe(false)
    expect(isAuthFailure(null)).toBe(false)
    expect(isAuthFailure(undefined)).toBe(false)
  })

  it('인증과 무관한 실패를 잘못 잡지 않는다', () => {
    expect(isAuthFailure('claude 실행이 120초를 초과했습니다')).toBe(false)
    expect(isAuthFailure('ENOENT: no such file or directory')).toBe(false)
    expect(isAuthFailure('rate_limit_error')).toBe(false)
    expect(isAuthFailure('claude 응답을 파싱할 수 없습니다')).toBe(false)
  })

  it('업무 내용으로 등장하는 인증 관련 단어를 오진하지 않는다', () => {
    // 요약 본문에는 이런 문장이 실제로 들어온다. 'OAuth'만으로 잡으면 멀쩡한 요약이
    // 로그인 오류로 둔갑하므로, 뒤에 session/token이 따라올 때만 인증 실패로 본다.
    expect(isAuthFailure('OAuth 로그인 흐름 구현')).toBe(false)
    expect(isAuthFailure('API key 발급 화면 개편')).toBe(false)
    expect(isAuthFailure('사용자 인증 모듈 리팩터링')).toBe(false)
  })
})

describe('isAuthFailureMessage', () => {
  it('앱의 안내 문장만 잡고 CLI 원문 표현은 잡지 않는다', () => {
    // 화면은 이것으로 로그인 안내 배너와 겹치는 오류를 거른다.
    // 원문 표현까지 거르면 claude와 무관한 401 오류가 화면에서 사라진다.
    expect(isAuthFailureMessage(AUTH_FAILURE_MESSAGE)).toBe(true)
    expect(isAuthFailureMessage(`자동 요약 실패: ${AUTH_FAILURE_MESSAGE}`)).toBe(true)
    expect(isAuthFailureMessage('401 Unauthorized')).toBe(false)
    expect(isAuthFailureMessage(null)).toBe(false)
  })
})
