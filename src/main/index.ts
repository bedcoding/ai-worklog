import { join } from 'node:path'
import { BrowserWindow, Menu, Tray, app, nativeImage, screen } from 'electron'
import { IPC } from '@shared/types'
import trayIconMac from '../../resources/iconTemplate.png?asset'
import trayIconWin from '../../resources/trayIcon.png?asset'
import { initCache } from './cache'
import { isWindowPinned, registerIpc, setWindowPinned } from './ipc'
import { POPUP_HEIGHT, POPUP_WIDTH, anchorOf, popupBounds } from './popup-bounds'
import { cleanupOldDigests } from './retention'
import { initScheduler } from './scheduler'

const IS_MAC = process.platform === 'darwin'
const IS_WIN = process.platform === 'win32'

/** electron-builder.yml 의 appId와 반드시 같아야 한다. 윈도우 토스트 알림 귀속에 쓰인다 */
const APP_ID = 'dev.bedcoding.ai-worklog'

// 맥은 메뉴바가 라이트/다크에 맞춰 반전시키는 단색 template 이미지를 쓰고,
// 윈도우는 template을 지원하지 않아 브랜드 컬러 아이콘을 쓴다.
const trayIconAsset = IS_MAC ? trayIconMac : trayIconWin

let tray: Tray | null = null
let win: BrowserWindow | null = null
let quitting = false
/** blur로 방금 닫힌 직후의 트레이 클릭을 무시하기 위한 시각 */
let lastHideMs = 0

// dev 전용: 기동 즉시 창을 띄우고 고정해 둔다 (트레이 상주 앱은 창을 띄우려면 아이콘을
// 찾아야 하는데, 윈도우 11은 새 트레이 아이콘을 오버플로에 숨기므로 디버깅이 번거롭다).
// 고정은 사용자용 핀 기능과 같은 경로를 쓴다. dev 전용 우회로를 따로 두지 않는다.
const showOnStart =
  !!process.env['ELECTRON_RENDERER_URL'] && process.env['WORKLOG_SHOW_ON_START'] === '1'

// ESM 최상위에서는 return이 불가하므로 플래그로 이후 초기화를 가드한다
const gotLock = app.requestSingleInstanceLock()
// 두 번째 인스턴스가 initCache/스케줄러를 건드릴 여지를 원천 차단한다
if (!gotLock) app.exit(0)

// 윈도우 토스트 알림은 AppUserModelID로 앱을 식별한다. 선언하지 않으면
// 알림이 'Electron'으로 표시되거나 알림 센터 그룹핑이 어긋난다. whenReady 이전에 호출해야 한다.
if (IS_WIN) app.setAppUserModelId(APP_ID)

function createWindow(): void {
  win = new BrowserWindow({
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT,
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
    // 사용자가 창을 고정했으면 닫지 않는다
    if (isWindowPinned()) return
    if (win?.webContents.isDevToolsOpened()) return
    lastHideMs = Date.now()
    win?.hide()
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

/** 트레이 아이콘 기준으로 창을 작업영역 안에 배치한다. resizable:false 창은 setSize가 무시되므로 setBounds를 쓴다. */
function placeWindow(): void {
  if (!win || !tray) return
  const trayBounds = tray.getBounds()
  const cursor = screen.getCursorScreenPoint()
  const workArea = screen.getDisplayNearestPoint(anchorOf(trayBounds, cursor)).workArea
  win.setBounds(popupBounds(trayBounds, workArea, cursor))
}

function toggleWindow(): void {
  if (!win || !tray) return
  if (win.isVisible()) {
    lastHideMs = Date.now()
    win.hide()
    return
  }
  // 승격된 트레이 아이콘에서는 blur→hide가 먼저 일어나 같은 클릭이 창을 다시 여는 경합이 있다
  if (Date.now() - lastHideMs < 250) return
  placeWindow()
  win.show()
  win.focus()
}

/** 윈도우의 SetForegroundWindow 제약을 우회해 확실히 앞으로 끌어올린다 */
function revealWindow(): void {
  if (!win) return
  placeWindow()
  win.setAlwaysOnTop(true)
  win.show()
  win.focus()
  // 핀이 켜져 있으면 항상 위를 유지해야 한다. 무조건 false로 되돌리면 핀이 무력화된다
  win.setAlwaysOnTop(isWindowPinned())
}

void app.whenReady().then(() => {
  if (!gotLock) return
  initCache(app.getPath('userData'))
  // 맥: Dock 아이콘 숨김(LSUIElement와 병행). 윈도우는 app.dock이 undefined이고,
  // 작업표시줄 버튼 제거는 BrowserWindow의 skipTaskbar:true가 담당한다.
  app.dock?.hide()
  // 윈도우/리눅스는 기본 애플리케이션 메뉴가 자동 설치되어 프레임리스 창에서도
  // Ctrl+R / Ctrl+Shift+I 액셀러레이터가 살아 있다. 맥은 Cmd+C/V가 메뉴에 의존하므로 유지한다.
  if (!IS_MAC) Menu.setApplicationMenu(null)
  createWindow()
  registerIpc(() => win)

  const icon = nativeImage.createFromPath(trayIconAsset)
  if (IS_MAC) icon.setTemplateImage(true) // 메뉴바 라이트/다크 자동 대응 (맥 전용)
  tray = new Tray(icon)
  tray.setToolTip('WorkLog\nClaude Code 업무 기록')
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
  if (IS_WIN) {
    // 윈도우의 popUpContextMenu는 position 기본값이 (0,0)이라 프로그램적 호출이 제자리에 뜨지 않는다.
    // setContextMenu를 쓰면 셸이 위치와 키보드 호출을 알아서 처리하고 좌클릭 이벤트도 그대로 온다.
    tray.setContextMenu(contextMenu)
  } else {
    tray.on('right-click', () => tray?.popUpContextMenu(contextMenu))
  }

  if (showOnStart) {
    // 핀을 켜 둔다. 렌더러도 같은 상태를 읽으므로 핀 버튼이 켜진 것으로 표시된다
    setWindowPinned(win, true)
    toggleWindow()
  }

  initScheduler(
    (summary) => win?.webContents.send(IPC.dayUpdated, summary),
    (err) => win?.webContents.send(IPC.pipelineError, err)
  )
  void cleanupOldDigests()
})

// 이미 실행 중일 때 앱을 다시 켜면 기존 창을 띄운다
app.on('second-instance', () => {
  if (win?.isVisible()) win.focus()
  else revealWindow()
})

app.on('before-quit', () => {
  quitting = true
})

app.on('window-all-closed', () => {
  // 트레이 상주 앱. 창이 닫혀도 종료하지 않는다.
  // 윈도우에서는 이 빈 핸들러가 필수다 (없으면 창을 닫는 순간 앱이 종료된다).
})
