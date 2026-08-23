import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type WorklogApi } from '../shared/types'

function subscribe<T>(channel: string) {
  return (cb: (payload: T) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

const api: WorklogApi = {
  platform: process.platform,
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  setSettings: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch),
  getDefaultPrompts: () => ipcRenderer.invoke(IPC.promptsDefaults),
  detectClaude: () => ipcRenderer.invoke(IPC.claudeDetect),
  testClaude: (path) => ipcRenderer.invoke(IPC.claudeTest, path),
  listRange: (start, end, opts) => ipcRenderer.invoke(IPC.rangeList, start, end, opts),
  backfillRange: (start, end) => ipcRenderer.invoke(IPC.rangeBackfill, start, end),
  generateDay: (date, force) => ipcRenderer.invoke(IPC.dayGenerate, date, force),
  getDayDigest: (date, force) => ipcRenderer.invoke(IPC.dayGetDigest, date, force),
  getPeriod: (key) => ipcRenderer.invoke(IPC.periodGet, key),
  generatePeriod: (req, part) => ipcRenderer.invoke(IPC.periodGenerate, req, part),
  onPeriodStream: subscribe(IPC.periodStream),
  cancelBackfill: () => ipcRenderer.invoke(IPC.backfillCancel),
  copyToClipboard: (text) => ipcRenderer.invoke(IPC.clipboardWrite, text),
  setAutoLaunch: (enabled) => ipcRenderer.invoke(IPC.appSetAutoLaunch, enabled),
  getWindowPinned: () => ipcRenderer.invoke(IPC.windowPinGet),
  setWindowPinned: (pinned) => ipcRenderer.invoke(IPC.windowPinSet, pinned),
  onBackfillProgress: subscribe(IPC.backfillProgress),
  onPipelineError: subscribe(IPC.pipelineError),
  onDayUpdated: subscribe(IPC.dayUpdated)
}

contextBridge.exposeInMainWorld('api', api)
