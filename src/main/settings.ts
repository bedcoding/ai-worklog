import { rename } from 'node:fs/promises'
import type { Settings } from '@shared/types'
import { readJsonState, settingsPath, writeJsonAtomic } from './cache'
import { DEFAULT_PROMPTS } from './prompts'

export const DEFAULT_SETTINGS: Settings = {
  profile: {
    gianTitle: '',
    gianLink: '',
    gianApprovedDate: '',
    corp: '',
    dept: '',
    name: '',
    empNo: '',
    email: '',
    aiService: 'Claude',
    plan: '',
    billingCycle: '',
    amount: ''
  },
  claudePath: null,
  model: 'default',
  monthlySavedHours: null,
  autoLaunch: false,
  dailyAuto: 'off',
  dailyTime: '18:00',
  retentionMonths: 12,
  prompts: DEFAULT_PROMPTS
}

let cached: Settings | null = null
/**
 * 설정 파일이 존재하는데 지금 읽지 못한 상태.
 * 윈도우는 강제 파일 락이 있어 백신·인덱서·백업 에이전트가 settings.json을 잡으면
 * 읽기가 EBUSY로 실패한다. 그때 기본값을 캐시해 두면 이후 아무 저장 한 번으로
 * 사번·법인·이름·커스텀 프롬프트가 디스크에서 덮어써져 영구 소실된다.
 * 그래서 이 상태에서는 캐시를 세우지 않고 저장을 거부한다.
 */
let unreadable = false

function merge(stored: Partial<Settings> | null): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    profile: { ...DEFAULT_SETTINGS.profile, ...stored?.profile },
    prompts: { ...DEFAULT_PROMPTS, ...stored?.prompts }
  }
}

/** 파싱 불가 파일은 지우지 않고 옆으로 치워 보존한다 — 사용자가 손으로 복구할 수 있어야 한다 */
async function quarantine(file: string): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  try {
    await rename(file, `${file}.corrupt-${stamp}`)
  } catch {
    // 치워두기 실패는 치명적이지 않다 — 기본값으로 계속 진행한다
  }
}

export async function getSettings(): Promise<Settings> {
  if (cached) return cached
  const read = await readJsonState<Partial<Settings>>(settingsPath())
  if (read.kind === 'unreadable') {
    // 캐시하지 않는다 — 다음 호출에서 다시 읽어보고, 그 사이 저장은 거부한다
    unreadable = true
    return merge(null)
  }
  if (read.kind === 'corrupt') await quarantine(settingsPath())
  unreadable = false
  cached = merge(read.kind === 'ok' ? read.value : null)
  return cached
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const cur = await getSettings()
  if (unreadable) {
    throw new Error(
      '설정 파일을 읽을 수 없어 저장을 중단했습니다. ' +
        '백신·백업 프로그램이 파일을 사용 중일 수 있습니다. 잠시 후 다시 시도해 주세요.'
    )
  }
  cached = {
    ...cur,
    ...patch,
    profile: { ...cur.profile, ...patch.profile },
    prompts: { ...cur.prompts, ...patch.prompts }
  }
  await writeJsonAtomic(settingsPath(), cached)
  return cached
}
