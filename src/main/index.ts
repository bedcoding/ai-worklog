import { join } from 'node:path'
import { BrowserWindow, Menu, Tray, app, nativeImage } from 'electron'
import { IPC } from '@shared/types'
import trayIconAsset from '../../resources/iconTemplate.png?asset'
import { initCache } from './cache'
import { isDialogOpen, registerIpc } from './ipc'
import { cleanupOldDigests } from './retention'
import { initScheduler } from './scheduler'

let tray: Tray | null = null
let win: BrowserWindow | null = null
let quitting = false

// ESM 최상위에서는 return이 불가하므로 플래그로 이후 초기화를 가드한다
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

function createWindow(): void {
  win = new BrowserWindow({
    width: 420,
    height: 620,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    fullscreenable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.on('blur', () => {
    // 저장 다이얼로그가 열려 있는 동안은 숨기지 않는다 (다이얼로그가 함께 사라진다)
    if (!isDialogOpen() && !win?.webContents.isDevToolsOpened()) win?.hide()
  })
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      win?.hide()
    }
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function toggleWindow(): void {
  if (!win || !tray) return
  if (win.isVisible()) {
    win.hide()
    return
  }
  const trayBounds = tray.getBounds()
  const { width } = win.getBounds()
  const x = Math.round(trayBounds.x + trayBounds.width / 2 - width / 2)
  const y = Math.round(trayBounds.y + trayBounds.height + 4)
  win.setPosition(x, y, false)
  win.show()
  win.focus()
}

void app.whenReady().then(() => {
  if (!gotLock) return
  initCache(app.getPath('userData'))
  app.dock?.hide()
  createWindow()
  registerIpc(() => win)

  const icon = nativeImage.createFromPath(trayIconAsset)
  icon.setTemplateImage(true) // 메뉴바 라이트/다크 자동 대응
  tray = new Tray(icon)
  tray.setToolTip('WorkLog — Claude Code 업무 기록')
  tray.on('click', toggleWindow)
  const contextMenu = Menu.buildFromTemplate([
    { label: '열기', click: toggleWindow },
    { type: 'separator' },
    {
      label: '종료',
      click: () => {
        quitting = true
        app.quit()
      }
    }
  ])
  tray.on('right-click', () => tray?.popUpContextMenu(contextMenu))

  initScheduler((summary) => win?.webContents.send(IPC.dayUpdated, summary))
  void cleanupOldDigests()
})

// 이미 실행 중일 때 앱을 다시 켜면 기존 창을 띄운다
app.on('second-instance', () => {
  if (win && !win.isVisible()) toggleWindow()
  else win?.focus()
})

app.on('before-quit', () => {
  quitting = true
})

app.on('window-all-closed', () => {
  // 트레이 상주 앱 — 창이 닫혀도 종료하지 않는다
})
