import { app, clipboard, ipcMain, type BrowserWindow } from 'electron'
import {
  IPC,
  type BackfillProgress,
  type PeriodPartKind,
  type PeriodRequest,
  type Settings
} from '@shared/types'
import { claudeVersion, locateClaude } from './claude/locate'
import {
  backfillRange,
  ensureDayDigest,
  ensureDaySummary,
  ensurePeriodPart,
  getCachedDaySummary,
  getCachedPeriod,
  getRangeStatus
} from './pipeline/summarizer'
import { cancelBackfill, resetCancel, type ProgressFn } from './pipeline/queue'
import { DEFAULT_PROMPTS } from './prompts'
import { reschedule } from './scheduler'
import { getSettings, getSettingsForEdit, setSettings } from './settings'

/**
 * 창 고정. 고정 중에는 포커스를 잃어도 창을 숨기지 않는다.
 * 고정하면 항상 위에 두는 것까지 함께 해야 의미가 있다. skipTaskbar 창이라
 * 다른 창에 가려지면 작업표시줄 버튼도 Alt+Tab도 없어 되찾을 방법이 없다.
 * 세션 한정 상태다(앱을 다시 켜면 해제). 켜 둔 걸 잊은 채 재시작하면 혼란스럽기 때문.
 */
let windowPinned = false
export const isWindowPinned = (): boolean => windowPinned

export function setWindowPinned(win: BrowserWindow | null, pinned: boolean): boolean {
  windowPinned = pinned
  win?.setAlwaysOnTop(pinned)
  return windowPinned
}

/** 기간 생성은 전역 취소 플래그를 쓰므로 한 번에 하나만 실행한다 */
let longRunning = false

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  const push = (channel: string, payload: unknown): void => {
    getWindow()?.webContents.send(channel, payload)
  }
  const progress: ProgressFn = (p: BackfillProgress) => push(IPC.backfillProgress, p)
  const progressIdle = (): void =>
    progress({ done: 0, total: 0, currentDate: null, phase: 'idle' })

  // 편집용. 읽지 못하면 기본값 대신 실패한다 (기본값 스냅샷이 되돌아와 실제 설정을 덮는다)
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

  ipcMain.handle(IPC.rangeList, async (_e, start: string, end: string) => {
    const status = await getRangeStatus(start, end)
    const summaries = []
    for (const d of status.activeDays) {
      const s = await getCachedDaySummary(d)
      if (s) summaries.push(s)
    }
    return { status, summaries }
  })
  // 날짜 수만큼 claude를 부르는 유일한 경로다. 기간 요약과 취소 플래그를 공유한다.
  ipcMain.handle(IPC.rangeBackfill, async (_e, start: string, end: string) => {
    if (longRunning) throw new Error('다른 요약이 생성 중입니다. 완료 후 다시 시도하세요.')
    longRunning = true
    resetCancel()
    try {
      return await backfillRange(start, end, progress)
    } finally {
      longRunning = false
      progressIdle()
    }
  })
  // 일별 생성은 취소 대상이 아니므로 전역 취소 플래그를 건드리지 않는다
  ipcMain.handle(IPC.dayGenerate, (_e, date: string, force?: boolean) =>
    ensureDaySummary(date, { force })
  )
  // 화면 표시용. 캐시가 있으면 스캔 없이 즉시 반환, force일 때만 원본 재스캔
  ipcMain.handle(IPC.dayGetDigest, (_e, date: string, force?: boolean) =>
    ensureDayDigest(date, { preferCache: !force, force })
  )

  ipcMain.handle(IPC.periodGet, (_e, key: string) => getCachedPeriod(key))
  // 이미 만들어 둔 일별 요약을 묶기만 한다 (claude 1회). 미요약 날짜가 있으면 거부된다.
  ipcMain.handle(IPC.periodGenerate, async (_e, req: PeriodRequest, part: PeriodPartKind) => {
    if (longRunning) throw new Error('다른 요약이 생성 중입니다. 완료 후 다시 시도하세요.')
    longRunning = true
    try {
      return await ensurePeriodPart(req, part, (e) =>
        push(IPC.periodStream, {
          part,
          kind: e.kind,
          text: e.kind === 'reset' ? undefined : e.text
        })
      )
    } finally {
      longRunning = false
    }
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
