/**
 * claude 실행 실패가 '로그인이 풀린 것'인지 가려낸다.
 *
 * 이것만 따로 보는 이유는 사용자가 직접 조치할 수 있는 유일한 실패이기 때문이다.
 * 타임아웃이나 파싱 오류는 앱이 재시도하면 되지만, 로그인은 터미널에서 사람이
 * 해야 하고 그때까지 모든 요약이 실패한다. 다른 오류와 같은 문장으로 보여주면
 * 무엇을 해야 하는지 알 수 없다.
 *
 * electron을 쓰지 않는 자리에 둔 것은 테스트에서 그대로 부르기 위해서다.
 */

/**
 * CLI가 인증 실패로 죽을 때 내놓는 문구들.
 *
 * 실측(2026-09-07, CLI 2.1.251): 'Failed to authenticate: OAuth session expired
 * and could not be refreshed'가 stdout으로 나오고 종료 코드는 1이었다.
 * 나머지는 API 키 방식과 옛 버전에서 쓰이던 표현이다.
 */
const AUTH_PATTERNS = [
  /failed to authenticate/i,
  /oauth (?:session|token)/i,
  /invalid api key/i,
  /authentication[_ ]error/i,
  /unauthorized/i,
  /please run .{0,20}\/?login/i,
  /run .{0,10}claude \/login/i
]

/** 사용자에게 보여줄 문장. 무엇을 해야 하는지까지 적는다 */
export const AUTH_FAILURE_MESSAGE =
  'Claude Code 로그인이 만료됐습니다. 터미널에서 claude를 실행해 다시 로그인하세요'

/** 상태바처럼 좁은 자리에 쓰는 짧은 형태 */
export const AUTH_FAILURE_SHORT = '로그인 필요. 터미널에서 claude 실행'

/**
 * claude가 남긴 출력이 인증 실패인가.
 *
 * 종료 코드가 0이 아닐 때의 출력에만 쓴다. 성공한 실행의 본문에는 요약 내용으로
 * 'OAuth'가 들어갈 수 있어서, 성공까지 검사하면 멀쩡한 요약을 오진한다.
 */
export function isAuthFailure(text: string | null | undefined): boolean {
  if (!text) return false
  return AUTH_PATTERNS.some((re) => re.test(text))
}
