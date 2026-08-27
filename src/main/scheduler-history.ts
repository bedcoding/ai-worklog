/**
 * 자동 실행 이력의 상태 전이.
 *
 * electron에 의존하지 않는 순수 함수로 분리해 vitest에서 그대로 검증한다.
 * 특히 markDone 분기가 중요하다. 실패한 실행까지 실행일을 올려 버리면 그날 catch-up이
 * 다시 시도하지 않아, 하루치 요약이 조용히 비게 된다.
 */
import type { SchedulerRun } from '@shared/types'

/** 남기는 이력 개수. 2주면 "요즘 잘 도는가"를 판단하기에 충분하다 */
export const MAX_RECENT = 14

export interface SchedulerState {
  lastAutoRunDate?: string
  /** 최신순. 오래된 실패는 이미 의미가 없어 앞쪽만 남긴다 */
  recent?: SchedulerRun[]
}

/**
 * 실행 결과를 반영한 다음 상태.
 *
 * @param markDone lastAutoRunDate를 이 실행의 날짜로 올릴지. 실패는 올리지 않는다.
 */
export function nextSchedulerState(
  prev: SchedulerState,
  run: SchedulerRun,
  markDone: boolean
): SchedulerState {
  return {
    ...prev,
    // 요약 대상이 아니라 실행한 날을 남긴다. 어제치를 요약했다고 어제를 남기면
    // '오늘은 아직 안 돌았다'로 판정되어 같은 날 계속 다시 돈다.
    // ranOn 이 없는 옛 기록은 둘이 같던 시절의 것이다
    ...(markDone ? { lastAutoRunDate: run.ranOn ?? run.date } : {}),
    recent: [run, ...(prev.recent ?? [])].slice(0, MAX_RECENT)
  }
}
