/**
 * 트레이 팝업 창의 화면 위치 계산.
 *
 * electron에 의존하지 않는 순수 함수로 분리해 vitest에서 그대로 검증한다.
 * 원래 코드는 창을 항상 트레이 '아래'(trayBounds.y + height + 4)에 놓았는데,
 * 이는 메뉴바가 화면 상단에 있는 맥에서만 맞다. 윈도우 작업표시줄은 하단이라
 * 창 전체가 화면 밖으로 내려간다(실측: y=828, 화면 높이 823 → 628 DIP 초과).
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export const POPUP_WIDTH = 420
export const POPUP_HEIGHT = 620
/** 분수 배율(1.75x)에서 getBounds가 ±1~2 DIP 흔들리므로 2 이상 필요 */
const GAP = 6

const hasTray = (tray: Rect): boolean => tray.width > 0 && tray.height > 0

/**
 * 팝업이 매달릴 기준점.
 * 트레이 bounds가 비어 있으면(리눅스 등 일부 환경) 커서 위치로 대체한다.
 * 호출자가 이 값으로 대상 디스플레이를 고르므로 popupBounds와 같은 규칙을 써야 한다.
 */
export function anchorOf(tray: Rect, cursor: Point): Point {
  if (!hasTray(tray)) return cursor
  return {
    x: Math.round(tray.x + tray.width / 2),
    y: Math.round(tray.y + tray.height / 2)
  }
}

/** 작업표시줄(맥은 메뉴바)이 붙은 변. 트레이가 작업영역 밖 어느 쪽에 있는지로 판정 */
function edgeOf(tray: Rect, wa: Rect, anchor: Point): 'top' | 'bottom' | 'left' | 'right' {
  if (!hasTray(tray)) return 'bottom'
  if (tray.y + tray.height <= wa.y) return 'top' // 맥 메뉴바 / 윈도우 상단 배치
  if (tray.y >= wa.y + wa.height) return 'bottom' // 윈도우 기본(하단)
  if (tray.x + tray.width <= wa.x) return 'left'
  if (tray.x >= wa.x + wa.width) return 'right'
  // 자동 숨김 작업표시줄 등 작업영역과 겹치는 애매한 경우
  return anchor.y < wa.y + wa.height / 2 ? 'top' : 'bottom'
}

/**
 * 작업영역 안에 완전히 들어오는 창 사각형을 계산한다.
 * 크기 클램프가 위치 클램프보다 먼저 와야 한다. 작업영역보다 창이 큰 모니터에서
 * 위치만 클램프하면 하한이 상한을 넘어 다시 화면을 벗어난다.
 */
export function popupBounds(tray: Rect, workArea: Rect, cursor: Point): Rect {
  const anchor = anchorOf(tray, cursor)
  const wa = workArea

  // 1) 작업영역보다 창이 크면 먼저 줄인다.
  //    하한 1px. 작업영역이 GAP*2보다 좁으면 음수가 되어 setBounds에 잘못된 사각형이 간다.
  const width = Math.max(1, Math.min(POPUP_WIDTH, wa.width - GAP * 2))
  const height = Math.max(1, Math.min(POPUP_HEIGHT, wa.height - GAP * 2))

  // 2) 붙은 변 기준으로 배치
  const edge = edgeOf(tray, wa, anchor)
  let x: number
  let y: number
  if (edge === 'top') {
    x = anchor.x - width / 2
    y = wa.y + GAP
  } else if (edge === 'bottom') {
    x = anchor.x - width / 2
    y = wa.y + wa.height - height - GAP
  } else if (edge === 'left') {
    x = wa.x + GAP
    y = anchor.y - height / 2
  } else {
    x = wa.x + wa.width - width - GAP
    y = anchor.y - height / 2
  }

  // 3) 화면 경계 클램핑
  const clamp = (v: number, lo: number, hi: number): number =>
    Math.round(Math.max(lo, Math.min(v, hi)))
  return {
    x: clamp(x, wa.x + GAP, wa.x + wa.width - width - GAP),
    y: clamp(y, wa.y + GAP, wa.y + wa.height - height - GAP),
    width,
    height
  }
}
