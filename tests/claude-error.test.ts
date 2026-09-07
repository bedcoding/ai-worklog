import { describe, expect, it } from 'vitest'
import { isAuthFailure } from '../src/shared/claude-error'

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
