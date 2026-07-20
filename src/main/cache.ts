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

export const settingsPath = (): string => resolvePath('settings.json')
export const schedulerStatePath = (): string => resolvePath('scheduler-state.json')
export const daysRoot = (): string => resolvePath('days')
export const dayDigestPath = (date: string): string =>
  resolvePath('days', ymOf(date), `${date}.digest.json`)
export const daySummaryPath = (date: string): string =>
  resolvePath('days', ymOf(date), `${date}.summary.json`)
export const periodPath = (key: string): string => resolvePath('periods', `${key}.json`)
export const reportPath = (ym: string): string => resolvePath('reports', `${ym}.json`)
/** claude CLI 실행용 전용 cwd — collector가 이 경로를 수집에서 제외한다 */
export const claudeWorkdir = (): string => resolvePath('claude-workdir')

export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T
  } catch {
    return null
  }
}

/**
 * tmp에 쓰고 rename — 쓰다 만 파일이 캐시로 읽히는 것을 방지.
 * tmp 이름은 호출마다 고유해야 같은 경로에 동시 쓰기가 겹쳐도 서로의 파일을 덮지 않는다.
 */
export async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
    await rename(tmp, file)
  } catch (e) {
    await rm(tmp, { force: true })
    throw e
  }
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}
