import { describe, expect, it } from 'vitest'
import { rangeStateOf } from '@shared/range-state'
import type { RangeStatus } from '@shared/types'

function status(activeDays: string[], summarizedDays: string[]): RangeStatus {
  return { start: '2026-08-17', end: '2026-08-23', activeDays, summarizedDays }
}

describe('rangeStateOf', () => {
  it('응답이 없으면 loading 이다', () => {
    // 화면이 '완료'라고 말하면 안 되는 자리다. 아직 아무것도 세지 않았다
    expect(rangeStateOf(null)).toEqual({ kind: 'loading' })
  })

  it('활동일이 없으면 empty 다', () => {
    // 미요약 0일이라는 점은 ready 와 같지만, 정리한 것이 아니라 정리할 것이 없었다
    expect(rangeStateOf(status([], []))).toEqual({ kind: 'empty' })
  })

  it('요약이 없는 활동일 수를 센다', () => {
    expect(rangeStateOf(status(['2026-08-21', '2026-08-22', '2026-08-23'], ['2026-08-21']))).toEqual(
      { kind: 'pending', count: 2 }
    )
  })

  it('활동일이 모두 요약되면 ready 다', () => {
    expect(rangeStateOf(status(['2026-08-22', '2026-08-23'], ['2026-08-22', '2026-08-23']))).toEqual(
      { kind: 'ready' }
    )
  })

  it('활동일에 없는 요약은 개수에 영향을 주지 않는다', () => {
    // 구간을 좁히면 캐시에는 구간 밖 날짜가 남는다. 그것으로 pending 이 음수가 되면 안 된다
    const s = status(['2026-08-23'], ['2026-08-01', '2026-08-02', '2026-08-23'])
    expect(rangeStateOf(s)).toEqual({ kind: 'ready' })
  })

  it('세 상태가 미요약 0일로 뭉치지 않는다', () => {
    // 이 셋이 같은 값이 되면 버튼 라벨이 '전체 정리 완료' 하나로 합쳐진다
    const kinds = [
      rangeStateOf(null).kind,
      rangeStateOf(status([], [])).kind,
      rangeStateOf(status(['2026-08-23'], ['2026-08-23'])).kind
    ]
    expect(new Set(kinds).size).toBe(3)
  })
})
