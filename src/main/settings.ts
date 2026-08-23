import { rename } from 'node:fs/promises'
import type { Settings } from '@shared/types'
import { readJsonState, settingsPath, writeJsonAtomic } from './cache'
import { DEFAULT_PROMPTS } from './prompts'

export const DEFAULT_SETTINGS: Settings = {
  claudePath: null,
  model: 'default',
  span: 'week',
  autoLaunch: false,
  dailyAuto: 'off',
  dailyTime: '18:00',
  retentionMonths: 12,
  prompts: DEFAULT_PROMPTS
}

export const SETTINGS_UNREADABLE =
  '설정 파일을 읽을 수 없습니다. 백신·백업 프로그램이 파일을 사용 중일 수 있습니다. ' +
  '잠시 후 다시 시도해 주세요.'

/**
 * 디스크에서 실제로 읽어낸 설정.
 * null이면 '아직 못 읽었다'는 뜻이고, 이 상태에서는 절대 저장하지 않는다.
 *
 * 윈도우는 강제 파일 락이 있어(맥은 없음) 백신·인덱서·백업 에이전트가 settings.json을
 * 잡으면 읽기가 EBUSY로 실패한다. 그때 기본값을 진실로 취급하면 이후 저장 한 번으로
 * 사번·법인·이름·커스텀 프롬프트가 디스크에서 덮어써져 영구 소실된다.
 */
let cached: Settings | null = null

/**
 * 진행 중인 읽기를 공유한다.
 * 동시 호출이 각자 읽으면 한쪽은 성공하고 한쪽은 EBUSY로 실패해 상태가 갈라진다
 * (콜드 스타트에 스케줄러·정리·IPC가 동시에 설정을 읽는다).
 */
let inflight: Promise<Settings> | null = null

function merge(stored: Partial<Settings> | null): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    prompts: { ...DEFAULT_PROMPTS, ...stored?.prompts }
  }
}

/** 파싱 불가 파일은 지우지 않고 옆으로 치워 보존한다. 사용자가 손으로 복구할 수 있어야 한다 */
async function quarantine(file: string): Promise<void> {
  // 콜론은 윈도우 파일명에 쓸 수 없다(NTFS 대체 데이터 스트림이 된다)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  try {
    await rename(file, `${file}.corrupt-${stamp}`)
  } catch {
    // 치워두기 실패는 치명적이지 않다. 기본값으로 계속 진행한다
  }
}

async function load(): Promise<Settings> {
  const read = await readJsonState<Partial<Settings>>(settingsPath())
  if (read.kind === 'unreadable') {
    // 이미 읽어둔 값이 있으면 그것이 진실이다 (일시적 락으로 저장을 영구 차단하지 않는다)
    if (cached) return cached
    // cached를 세우지 않는다. 다음 호출에서 다시 읽고, 그 사이 저장은 거부된다
    return merge(null)
  }
  if (read.kind === 'corrupt') await quarantine(settingsPath())
  cached = merge(read.kind === 'ok' ? read.value : null)
  return cached
}

/**
 * 설정을 읽는다. 읽지 못하면 기본값을 반환한다.
 * 스케줄러·정리처럼 '동작은 계속해야 하는' 소비자를 위한 것이다.
 * 사용자에게 보여주고 되돌려 저장받는 경로는 getSettingsForEdit을 써야 한다.
 */
export async function getSettings(): Promise<Settings> {
  if (cached) return cached
  if (!inflight) {
    inflight = load().finally(() => {
      inflight = null
    })
  }
  return inflight
}

/**
 * 설정 편집 UI용. 지금 읽을 수 없으면 기본값을 주지 않고 실패한다.
 *
 * 기본값을 폼에 채우면, 렌더러는 그 스냅샷 전체를 그대로 저장 요청으로 되돌려 보내므로
 * (SettingsView는 patch가 아니라 Settings 전체를 보낸다) 락이 풀린 뒤의 저장 한 번으로
 * 실제 설정이 기본값으로 덮어써진다. 그래서 기본값이 UI 경계를 넘지 못하게 막는다.
 */
export async function getSettingsForEdit(): Promise<Settings> {
  const s = await getSettings()
  if (!cached) throw new Error(SETTINGS_UNREADABLE)
  return s
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  await getSettings()
  // 디스크 내용을 확인하지 못한 상태에서는 무엇도 쓰지 않는다
  if (!cached) throw new Error(SETTINGS_UNREADABLE)
  cached = {
    ...cached,
    ...patch,
    prompts: { ...cached.prompts, ...patch.prompts }
  }
  await writeJsonAtomic(settingsPath(), cached)
  return cached
}

/** 테스트 전용. 모듈 상태를 초기화한다 */
export function __resetSettingsCache(): void {
  cached = null
  inflight = null
}
