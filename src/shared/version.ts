/**
 * 버전 문자열 비교. a 가 크면 1, 작으면 -1, 같으면 0.
 *
 * 문자열로 그냥 비교하면 "0.9.0" > "0.11.0" 이 되어 새 버전을 놓친다.
 * 자리마다 숫자로 본다. 앞의 "v" 는 있어도 없어도 된다(태그는 v0.1.2, app.getVersion 은 0.1.2).
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] =>
    v
      .trim()
      .replace(/^v/i, '')
      .split('.')
      .map((n) => parseInt(n, 10) || 0)
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}
