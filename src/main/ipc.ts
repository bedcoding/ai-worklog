import { join } from 'node:path'
import { app, clipboard, dialog, ipcMain, type BrowserWindow } from 'electron'
import {
  IPC,
  type BackfillProgress,
  type PeriodRequest,
  type Settings
} from '@shared/types'
import { claudeVersion, locateClaude } from './claude/locate'
import { writeReportXlsx } from './excel'
import {
  ensureDayDigest,
  ensureDaySummary,
  ensurePeriodSummary,
  getCachedDaySummary,
  getCachedPeriod
} from './pipeline/summarizer'
import {
  generateMonthReport,
  getCachedReport,
  getMonthStatus
} from './pipeline/report'
import { cancelBackfill, resetCancel, type ProgressFn } from './pipeline/queue'
import { DEFAULT_PROMPTS } from './prompts'
import { reschedule } from './scheduler'
import { getSettings, setSettings } from './settings'

/** 저장 다이얼로그가 열려 있는 동안 창의 blur→hide를 막기 위한 플래그 */
let dialogOpen = false
export const isDialogOpen = (): boolean => dialogOpen

/** 기간/기안 생성은 전역 취소 플래그를 공유하므로 한 번에 하나만 실행한다 */
let longRunning = false

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  const push = (channel: string, payload: unknown): void => {
    getWindow()?.webContents.send(channel, payload)
  }
  const progress: ProgressFn = (p: BackfillProgress) => push(IPC.backfillProgress, p)
  const progressIdle = (): void =>
    progress({ done: 0, total: 0, currentDate: null, phase: 'idle' })

  ipcMain.handle(IPC.settingsGet, () => getSettings())
  ipcMain.handle(IPC.settingsSet, async (_e, patch: Partial<Settings>) => {
    const s = await setSettings(patch)
    void reschedule()
    return s
  })
  ipcMain.handle(IPC.promptsDefaults, () => DEFAULT_PROMPTS)

  ipcMain.handle(IPC.claudeDetect, async () => {
    const s = await getSettings()
    const path = await locateClaude(s.claudePath)
    return { path, version: await claudeVersion(path) }
  })
  ipcMain.handle(IPC.claudeTest, async (_e, path: string) => {
    const p = path.trim() ? path.trim() : await locateClaude(null)
    return { path: p, version: await claudeVersion(p) }
  })

  ipcMain.handle(IPC.dayList, async (_e, ym: string) => {
    const status = await getMonthStatus(ym)
    const summaries = []
    for (const d of status.activeDays) {
      const s = await getCachedDaySummary(d)
      if (s) summaries.push(s)
    }
    return { status, summaries }
  })
  // 일별 생성은 취소 대상이 아니므로 전역 취소 플래그를 건드리지 않는다
  ipcMain.handle(IPC.dayGenerate, (_e, date: string, force?: boolean) =>
    ensureDaySummary(date, { force })
  )
  ipcMain.handle(IPC.dayGetDigest, (_e, date: string) => ensureDayDigest(date))

  ipcMain.handle(IPC.periodGet, (_e, key: string) => getCachedPeriod(key))
  ipcMain.handle(IPC.periodGenerate, async (_e, req: PeriodRequest) => {
    if (longRunning) throw new Error('다른 요약이 생성 중입니다. 완료 후 다시 시도하세요.')
    longRunning = true
    resetCancel()
    try {
      return await ensurePeriodSummary(req, progress)
    } finally {
      longRunning = false
      progressIdle()
    }
  })

  ipcMain.handle(IPC.monthGetStatus, (_e, ym: string) => getMonthStatus(ym))
  ipcMain.handle(IPC.monthGetReport, (_e, ym: string) => getCachedReport(ym))
  ipcMain.handle(IPC.monthGenerateReport, async (_e, ym: string) => {
    if (longRunning) throw new Error('다른 요약이 생성 중입니다. 완료 후 다시 시도하세요.')
    longRunning = true
    resetCancel()
    try {
      return await generateMonthReport(ym, progress)
    } finally {
      longRunning = false
      progressIdle()
    }
  })
  ipcMain.handle(IPC.monthSaveXlsx, async (_e, ym: string) => {
    const s = await getSettings()
    dialogOpen = true
    let filePath: string | undefined
    let canceled: boolean
    try {
      ;({ canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: join(app.getPath('downloads'), `AI도구사용현황_${ym}.xlsx`),
        filters: [{ name: 'Excel', extensions: ['xlsx'] }]
      }))
    } finally {
      dialogOpen = false
    }
    if (canceled || !filePath) return null
    await writeReportXlsx(s.profile, filePath)
    return filePath
  })

  ipcMain.handle(IPC.backfillCancel, () => cancelBackfill())
  ipcMain.handle(IPC.clipboardWrite, (_e, text: string) => clipboard.writeText(text))
  ipcMain.handle(IPC.appSetAutoLaunch, (_e, enabled: boolean) =>
    app.setLoginItemSettings({ openAtLogin: enabled })
  )
}
