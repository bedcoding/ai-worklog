import type { RangeStatus } from './types'

/**
 * 지금 보고 있는 구간으로 무엇을 할 수 있는지.
 *
 * '미요약 0일' 하나로 판단하면 서로 다른 세 상태가 같은 값이 된다. 아직 세지 못한
 * 것과, 셀 것이 애초에 없던 것과, 다 끝낸 것이다. 화면에서는 셋을 달리 말해야 한다.
 * 뭉쳐 놓으면 기록을 읽는 중에도 버튼이 '전체 정리 완료'라고 말한다.
 */
export type RangeState =
  /** 아직 세지 못했다. 약속도 완료도 말할 수 없다 */
  | { kind: 'loading' }
  /** 활동한 날이 없다. 정리할 것 자체가 없다 */
  | { kind: 'empty' }
  /** 요약이 없는 활동일이 count일 남았다. 이 숫자가 곧 claude 호출 횟수다 */
  | { kind: 'pending'; count: number }
  /** 활동일이 모두 요약돼 있다. 구간 전체 요약을 만들 수 있다 */
  | { kind: 'ready' }

/**
 * @param status 지금 보고 있는 구간의 것만 넘긴다. 다른 구간의 응답은 null로 준다.
 *   구간을 옮기는 동안 이전 구간의 개수가 새 라벨 아래 남으면 화면이 거짓말을 한다.
 */
export function rangeStateOf(status: RangeStatus | null): RangeState {
  if (!status) return { kind: 'loading' }
  if (status.activeDays.length === 0) return { kind: 'empty' }
  const done = new Set(status.summarizedDays)
  const count = status.activeDays.filter((d) => !done.has(d)).length
  return count > 0 ? { kind: 'pending', count } : { kind: 'ready' }
}
