import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { ymOf } from '@shared/dates'

/**
 * userData 하위 캐시 레이아웃.
 * electron 의존 없이 baseDir 주입식으로 두어 vitest에서도 그대로 쓴다.
 */
let baseDir = ''

export function initCache(dir: string): void {
  baseDir = dir
  mkdirSync(join(baseDir, 'claude-workdir'), { recursive: true })
}

function resolvePath(...segs: string[]): string {
  if (!baseDir) throw new Error('initCache가 호출되지 않았습니다')
  return join(baseDir, ...segs)
}

/**
 * 경로가 되는 키는 형식을 고정 검증한다.
 * 렌더러가 IPC로 넘긴 문자열이 그대로 파일명이 되므로, 윈도우에서
 * 콜론이 섞이면 NTFS 대체 데이터 스트림(ADS)에 조용히 써지고 readdir에 보이지 않는다.
 * 정상 키(dates.ts가 만드는 고정 형식)는 전부 통과하므로 맥/리눅스 동작 변화는 없다.
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const YM_RE = /^\d{4}-\d{2}$/
const PERIOD_RE = /^\d{4}-(?:\d{2}|W\d{2})$/

function checked(seg: string, re: RegExp, label: string): string {
  if (!re.test(seg)) throw new Error(`${label} 형식이 올바르지 않습니다: ${JSON.stringify(seg)}`)
  return seg
}

export const settingsPath = (): string => resolvePath('settings.json')
export const schedulerStatePath = (): string => resolvePath('scheduler-state.json')
export const daysRoot = (): string => resolvePath('days')
export const cacheRoot = (): string => resolvePath()
export const dayDigestPath = (date: string): string =>
  resolvePath('days', ymOf(checked(date, DATE_RE, '날짜')), `${date}.digest.json`)
export const daySummaryPath = (date: string): string =>
  resolvePath('days', ymOf(checked(date, DATE_RE, '날짜')), `${date}.summary.json`)
export const periodPath = (key: string): string =>
  resolvePath('periods', `${checked(key, PERIOD_RE, '기간 키')}.json`)
export const reportPath = (ym: string): string =>
  resolvePath('reports', `${checked(ym, YM_RE, '연월')}.json`)
/** claude CLI 실행용 전용 cwd — collector가 이 경로를 수집에서 제외한다 */
export const claudeWorkdir = (): string => resolvePath('claude-workdir')

/**
 * 윈도우 전용 일시적 실패 코드.
 * - rename(MoveFileEx): 같은 대상 경로를 노리는 호출이 커널에서 겹치면 하나만 성공하고
 *   나머지는 ERROR_ACCESS_DENIED → EPERM. POSIX의 rename(2)은 원자적이라 발생하지 않는다.
 * - readFile/unlink: 백신·인덱서·탐색기 미리보기가 배타 핸들을 잡으면 EBUSY.
 * EINVAL/ENOENT는 영구적 실패이므로 절대 재시도 목록에 넣지 않는다.
 */
const TRANSIENT_FS_ERRORS = new Set(['EPERM', 'EACCES', 'EBUSY'])
const RENAME_ATTEMPTS = 10
const READ_ATTEMPTS = 5

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const errCode = (e: unknown): string | undefined => (e as NodeJS.ErrnoException).code

async function renameWithRetry(tmp: string, file: string): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await rename(tmp, file)
      return
    } catch (e) {
      const code = errCode(e)
      if (i >= RENAME_ATTEMPTS - 1 || !code || !TRANSIENT_FS_ERRORS.has(code)) throw e
      await sleep(Math.min(2 ** i, 50) + Math.random() * 5)
    }
  }
}

/**
 * 같은 경로에 대한 쓰기만 호출 순서대로 직렬화한다. 다른 경로는 그대로 병렬.
 * 재시도만으로는 부족하다 — 동시 50건에서 재시도를 다 쓰고도 실패가 남는다.
 */
const writeQueue = new Map<string, Promise<void>>()

function serializeByPath<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prev = writeQueue.get(key) ?? Promise.resolve()
  // 두 번째 인자 필수 — 한 번 실패한 쓰기가 그 경로의 큐를 영구히 오염시키는 것을 막는다
  const run = prev.then(task, task)
  const tail = run.then(
    () => {},
    () => {}
  )
  writeQueue.set(key, tail)
  void tail.then(() => {
    // 자기가 아직 꼬리일 때만 정리 — 무조건 지우면 대기 중인 작업의 직렬화가 끊긴다
    if (writeQueue.get(key) === tail) writeQueue.delete(key)
  })
  return run
}

/** 읽기 결과 — '파일 없음'과 '지금 못 읽음'을 구분한다. 후자에서 기본값을 쓰면 설정이 소실된다. */
export type JsonRead<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'absent' }
  | { kind: 'corrupt' }
  | { kind: 'unreadable'; code?: string }

export async function readJsonState<T>(file: string): Promise<JsonRead<T>> {
  for (let i = 0; ; i++) {
    let text: string
    try {
      text = await readFile(file, 'utf8')
    } catch (e) {
      const code = errCode(e)
      if (code === 'ENOENT') return { kind: 'absent' }
      if (i >= READ_ATTEMPTS - 1 || !code || !TRANSIENT_FS_ERRORS.has(code)) {
        return { kind: 'unreadable', code }
      }
      await sleep(Math.min(2 ** i, 50))
      continue
    }
    try {
      return { kind: 'ok', value: JSON.parse(text) as T }
    } catch {
      return { kind: 'corrupt' }
    }
  }
}

/**
 * 캐시 읽기 — 없거나 읽을 수 없으면 null.
 * 설정처럼 '없음'과 '못 읽음'을 구분해야 하는 곳은 readJsonState를 직접 쓴다.
 */
export async function readJson<T>(file: string): Promise<T | null> {
  const r = await readJsonState<T>(file)
  return r.kind === 'ok' ? r.value : null
}

/**
 * tmp에 쓰고 rename — 쓰다 만 파일이 캐시로 읽히는 것을 방지.
 * tmp 이름은 호출마다 고유해야 같은 경로에 동시 쓰기가 겹쳐도 서로의 파일을 덮지 않는다.
 */
export async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  return serializeByPath(file, async () => {
    await mkdir(dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
    try {
      await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
      await renameWithRetry(tmp, file)
    } catch (e) {
      // 정리 실패를 반드시 삼킨다 — 그러지 않으면 rm의 EBUSY가 진짜 원인(rename 실패)을 덮는다
      await rm(tmp, { force: true, maxRetries: 3, retryDelay: 20 }).catch(() => {})
      throw e
    }
  })
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}
