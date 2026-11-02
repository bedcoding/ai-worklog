import { describe, expect, it } from 'vitest'
import {
  isAuthFailed,
  noteRunFailure,
  noteRunSuccess,
  onAuthStateChange,
  primeFromHistory
} from '../src/main/auth-state'
import { AUTH_FAILURE_MESSAGE } from '../src/shared/claude-error'

/** 상태를 끈 뒤 화면으로 가는 알림을 모은다 */
function track(): boolean[] {
  noteRunSuccess()
  const pushed: boolean[] = []
  onAuthStateChange((v) => pushed.push(v))
  return pushed
}

describe('auth-state', () => {
  it('로그인 문제로 실패할 때마다 화면에 알린다', () => {
    // 사용자가 안내를 닫은 뒤 다시 실패하면 화면은 이 알림으로 안내를 다시 연다
    const pushed = track()
    noteRunFailure(AUTH_FAILURE_MESSAGE)
    noteRunFailure(AUTH_FAILURE_MESSAGE)
    expect(pushed).toEqual([true, true])
    expect(isAuthFailed()).toBe(true)
  })

  it('인증과 무관한 실패는 알리지도 상태를 바꾸지도 않는다', () => {
    const pushed = track()
    noteRunFailure('claude 실행이 120초를 초과했습니다')
    expect(pushed).toEqual([])
    expect(isAuthFailed()).toBe(false)
  })

  it('성공은 상태가 바뀔 때만 알린다', () => {
    const pushed = track()
    noteRunFailure(AUTH_FAILURE_MESSAGE)
    noteRunSuccess()
    noteRunSuccess()
    expect(pushed).toEqual([true, false])
    expect(isAuthFailed()).toBe(false)
  })

  it('지난 자동 실행이 로그인 문제로 끝났으면 앱을 켤 때부터 켠다', () => {
    // 자동 실행 기록에는 앱이 바꿔 쓴 안내 문장이 남는다
    const pushed = track()
    primeFromHistory(AUTH_FAILURE_MESSAGE)
    expect(pushed).toEqual([true])
    expect(isAuthFailed()).toBe(true)
  })
})
