import type { Settings } from '@shared/types'
import { readJson, settingsPath, writeJsonAtomic } from './cache'
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

export async function getSettings(): Promise<Settings> {
  if (cached) return cached
  const stored = await readJson<Partial<Settings>>(settingsPath())
  cached = {
    ...DEFAULT_SETTINGS,
    ...stored,
    profile: { ...DEFAULT_SETTINGS.profile, ...stored?.profile },
    prompts: { ...DEFAULT_PROMPTS, ...stored?.prompts }
  }
  return cached
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const cur = await getSettings()
  cached = {
    ...cur,
    ...patch,
    profile: { ...cur.profile, ...patch.profile },
    prompts: { ...cur.prompts, ...patch.prompts }
  }
  await writeJsonAtomic(settingsPath(), cached)
  return cached
}
