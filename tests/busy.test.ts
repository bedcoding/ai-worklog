import { describe, expect, it } from 'vitest'
import { isBackfillRunning, isBusy, isOtherRunning, type BusyInput } from '../src/shared/busy'

const idle: BusyInput = {
  busyDate: null,
  backfilling: false,
  hasProgress: false,
  composing: null,
  longRunning: false
}

describe('isBusy', () => {
  it('아무것도 돌지 않으면 잠그지 않는다', () => {
    expect(isBusy(idle)).toBe(false)
  })

  it('하루 생성, 전체 정리, 기간 요약 어느 것이든 잠근다', () => {
    expect(isBusy({ ...idle, busyDate: '2026-09-04' })).toBe(true)
    expect(isBusy({ ...idle, backfilling: true })).toBe(true)
    expect(isBusy({ ...idle, composing: 'overview' })).toBe(true)
  })

  /**
   * 실제로 물렸던 경로다. 전체 정리 중 설정 탭으로 갔다 오면 이 화면이 다시 마운트돼
   * 로컬 플래그가 비는데, main 은 계속 돌고 있어 버튼을 누르면 거부당했다.
   */
  it('로컬 플래그가 비어도 main이 돌고 있으면 잠근다', () => {
    expect(isBusy({ ...idle, longRunning: true })).toBe(true)
  })

  it('로컬 플래그가 비어도 진행 상황이 오고 있으면 잠근다', () => {
    expect(isBusy({ ...idle, hasProgress: true })).toBe(true)
  })
})

describe('isBackfillRunning', () => {
  it('내가 시작했든 진행 상황만 오든 도는 것으로 본다', () => {
    expect(isBackfillRunning({ backfilling: true, hasProgress: false })).toBe(true)
    expect(isBackfillRunning({ backfilling: false, hasProgress: true })).toBe(true)
    expect(isBackfillRunning({ backfilling: false, hasProgress: false })).toBe(false)
  })
})

describe('isOtherRunning', () => {
  it('탭을 다녀와 이유를 모르는 채 잠긴 상태만 골라낸다', () => {
    expect(isOtherRunning({ ...idle, longRunning: true })).toBe(true)
  })

  it('내가 시작한 것이면 화면이 이미 알고 있으므로 따로 알리지 않는다', () => {
    expect(isOtherRunning({ ...idle, longRunning: true, composing: 'detail' })).toBe(false)
    expect(isOtherRunning({ ...idle, longRunning: true, backfilling: true })).toBe(false)
  })

  it('전체 정리는 위 카드의 진행 표시가 말하므로 중복해서 알리지 않는다', () => {
    expect(isOtherRunning({ ...idle, longRunning: true, hasProgress: true })).toBe(false)
  })

  it('아무것도 돌지 않으면 알릴 것이 없다', () => {
    expect(isOtherRunning(idle)).toBe(false)
  })
})
