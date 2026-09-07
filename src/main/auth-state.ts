import { isAuthFailure } from '@shared/claude-error'

/**
 * claude 로그인이 풀렸는지를 앱이 기억한다.
 *
 * 능동으로 확인하지 않는다. 확인하려면 claude를 실제로 한 번 불러야 하고 그것은
 * 토큰을 쓴다. 대신 어차피 나가는 호출의 결과를 보고 판정한다. 실패하면 켜고
 * 다음 성공에 끈다.
 *
 * 파일에 남기지 않는 것은 의도한 것이다. 로그인은 앱 밖의 상태라서, 앱이 꺼진
 * 사이에 사용자가 터미널에서 로그인했을 수 있다. 저장해 두면 이미 풀린 문제를
 * 계속 띄우게 된다. 앱을 켠 뒤 첫 호출에서 다시 알게 되고, 그 전이라면 지난
 * 자동 실행 기록으로 초기값을 잡는다.
 */
let failed = false
let listener: ((v: boolean) => void) | null = null

/** 변경을 렌더러로 밀어 줄 창구. main이 창을 만든 뒤 한 번 건다 */
export function onAuthStateChange(cb: (failed: boolean) => void): void {
  listener = cb
}

export function isAuthFailed(): boolean {
  return failed
}

function set(next: boolean): void {
  if (failed === next) return
  failed = next
  listener?.(next)
}

/**
 * claude 실행 결과를 반영한다.
 *
 * 성공이면 해제한다. 인증 말고 다른 이유로 실패한 것은 건드리지 않는다.
 * 타임아웃이 로그인 상태를 말해 주지는 않기 때문이다.
 */
export function noteRunSuccess(): void {
  set(false)
}

export function noteRunFailure(message: string): void {
  if (isAuthFailure(message)) set(true)
}

/** 지난 자동 실행이 인증 실패로 끝났다면 앱을 켤 때부터 알린다 */
export function primeFromHistory(lastError: string | null | undefined): void {
  if (isAuthFailure(lastError)) set(true)
}
