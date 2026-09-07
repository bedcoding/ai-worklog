/**
 * 요약 화면의 잠금 판정.
 *
 * 화면이 든 플래그만으로 판정하다가 실제로 물렸다. 요약 탭은 설정 탭으로 옮기면
 * 언마운트되어 backfilling/composing 이 리셋되는데(설정 탭은 살려 두므로 그쪽만
 * 남는다), 돌아오면 잠겨 있어야 할 버튼이 풀려 있다. 그것을 누르면 main 이
 * '다른 요약이 생성 중입니다'로 거부한다.
 *
 * 그래서 세 갈래를 함께 본다.
 * - longRunning: main 이 보낸 것. 탭을 오가도 정확한 유일한 신호
 * - progress: App 이 들고 있어 언마운트를 견딘다. 전체 정리에만 온다
 * - 로컬 플래그: 클릭한 순간부터 위 신호가 도착하기 전까지의 틈을 메운다
 */
export interface BusyInput {
  /** 한 날짜를 만드는 중이면 그 날짜 */
  busyDate: string | null
  /** 이 화면이 시작한 전체 정리 */
  backfilling: boolean
  /** main 이 보내는 전체 정리 진행 상황. 없으면 돌지 않는 것이다 */
  hasProgress: boolean
  /** 이 화면이 시작한 기간 요약의 부분 */
  composing: string | null
  /** main 에서 긴 작업이 도는가 */
  longRunning: boolean
}

/** 전체 정리가 도는가. 진행 표시와 버튼 라벨이 이것을 쓴다 */
export function isBackfillRunning(i: Pick<BusyInput, 'backfilling' | 'hasProgress'>): boolean {
  return i.backfilling || i.hasProgress
}

/** 무엇이든 돌고 있는가. 하나라도 켜져 있으면 새 작업을 시작할 수 없다 */
export function isBusy(i: BusyInput): boolean {
  return (
    i.busyDate !== null ||
    isBackfillRunning(i) ||
    i.composing !== null ||
    i.longRunning
  )
}

/**
 * 잠겼는데 이 화면은 이유를 모르는 상태인가.
 *
 * 탭을 다녀와 로컬 플래그가 비었는데 main 은 계속 돌고 있는 경우다. 버튼만 회색이면
 * 왜 눌리지 않는지 알 수 없으므로 이때만 따로 말해 준다.
 */
export function isOtherRunning(i: BusyInput): boolean {
  return i.longRunning && i.composing === null && !isBackfillRunning(i)
}
