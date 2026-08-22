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
import { getSettings, getSettingsForEdit, setSettings } from './settings'

/** 저장 다이얼로그가 열려 있는 동안 창의 blur→hide를 막기 위한 플래그 */
let dialogOpen = false
export const isDialogOpen = (): boolean => dialogOpen

/**
 * 창 고정. 고정 중에는 포커스를 잃어도 창을 숨기지 않는다.
 * 고정하면 항상 위에 두는 것까지 함께 해야 의미가 있다 — skipTaskbar 창이라
 * 다른 창에 가려지면 작업표시줄 버튼도 Alt+Tab도 없어 되찾을 방법이 없다.
 * 세션 한정 상태다(앱을 다시 켜면 해제) — 켜 둔 걸 잊은 채 재시작하면 혼란스럽기 때문.
 */
let windowPinned = false
export const isWindowPinned = (): boolean => windowPinned

export function setWindowPinned(win: BrowserWindow | null, pinned: boolean): boolean {
  windowPinned = pinned
  win?.setAlwaysOnTop(pinned)
  return windowPinned
}

/** 기간/기안 생성은 전역 취소 플래그를 공유하므로 한 번에 하나만 실행한다 */
let longRunning = false

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  const push = (channel: string, payload: unknown): void => {
    getWindow()?.webContents.send(channel, payload)
  }
  const progress: ProgressFn = (p: BackfillProgress) => push(IPC.backfillProgress, p)
  const progressIdle = (): void =>
    progress({ done: 0, total: 0, currentDate: null, phase: 'idle' })

  // 편집용 — 읽지 못하면 기본값 대신 실패한다 (기본값 스냅샷이 되돌아와 실제 설정을 덮는다)
  ipcMain.handle(IPC.settingsGet, () => getSettingsForEdit())
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
    // locateClaude를 거쳐야 셰임(.cmd/.ps1/확장자없음)이 실제 .exe로 해석된다.
    // 그러지 않으면 설정 탭 placeholder가 안내하는 claude.cmd로 '연결 테스트'를 누를 때
    // 항상 spawn EINVAL로 실패한다.
    const p = await locateClaude(path.trim() || null)
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
  // 화면 표시용 — 캐시가 있으면 스캔 없이 즉시 반환, force일 때만 원본 재스캔
  ipcMain.handle(IPC.dayGetDigest, (_e, date: string, force?: boolean) =>
    ensureDayDigest(date, { preferCache: !force, force })
  )

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
    const opts = {
      defaultPath: join(app.getPath('downloads'), `AI도구사용현황_${ym}.xlsx`),
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    }
    dialogOpen = true
    let res: Awaited<ReturnType<typeof dialog.showSaveDialog>>
    try {
      // 부모 창을 넘긴다 — skipTaskbar 창이라 다이얼로그가 뒤로 숨으면 사용자가 찾을 수단이 없다
      const parent = getWindow()
      res = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts)
    } finally {
      dialogOpen = false
    }
    if (res.canceled || !res.filePath) return null
    // 윈도우는 확장자로 연결 프로그램을 정한다 — 사용자가 .xlsx를 지우면 더블클릭해도 Excel이 열리지 않는다
    const target = res.filePath.toLowerCase().endsWith('.xlsx')
      ? res.filePath
      : `${res.filePath}.xlsx`
    try {
      await writeReportXlsx(s.profile, target)
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
        throw new Error(
          '파일이 다른 프로그램(Excel 등)에서 열려 있어 저장할 수 없습니다. 파일을 닫고 다시 시도해 주세요.'
        )
      }
      throw e
    }
    return target
  })

  ipcMain.handle(IPC.backfillCancel, () => cancelBackfill())
  // 윈도우 클립보드 텍스트 관례는 CRLF다. 캐시 JSON에 저장되는 값은 LF로 두고
  // (해시·비교 안정성) 클립보드 경계에서만 변환한다. 이미 CRLF인 문자열이 CRCRLF가 되지 않도록 /\r?\n/를 쓴다.
  ipcMain.handle(IPC.clipboardWrite, (_e, text: string) =>
    clipboard.writeText(process.platform === 'win32' ? text.replace(/\r?\n/g, '\r\n') : text)
  )
  ipcMain.handle(IPC.appSetAutoLaunch, (_e, enabled: boolean) =>
    app.setLoginItemSettings({ openAtLogin: enabled })
  )
  ipcMain.handle(IPC.windowPinGet, () => isWindowPinned())
  ipcMain.handle(IPC.windowPinSet, (_e, pinned: boolean) =>
    setWindowPinned(getWindow(), pinned)
  )
}
