import { app, BrowserWindow, Menu, Tray, shell, nativeImage } from 'electron'
import path from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { SessionWatcher } from './session-watcher'
import { ClaudeManager } from './claude-manager'
import { registerIpcHandlers } from './ipc-handlers'
import { getProjectsDir } from './path-utils'

let mainWindow: BrowserWindow | null = null
let sessionWatcher: SessionWatcher | null = null
let claudeManager: ClaudeManager | null = null
let tray: Tray | null = null

const REPO_URL = 'https://github.com/HenryMu/claude-code-desktop'

const trayI18n: Record<string, { toggle: string; about: string; quit: string }> = {
  en: { toggle: 'Show / Hide', about: 'About', quit: 'Quit' },
  zh: { toggle: '显示 / 隐藏', about: '关于', quit: '退出' },
  'zh-TW': { toggle: '顯示 / 隱藏', about: '關於', quit: '結束' },
  ja: { toggle: '表示 / 非表示', about: 'バージョン情報', quit: '終了' },
  ko: { toggle: '보이기 / 숨기기', about: '정보', quit: '종료' },
  hi: { toggle: 'दिखाएं / छिपाएं', about: 'परिचय', quit: 'बंद करें' },
  pt: { toggle: 'Mostrar / Ocultar', about: 'Sobre', quit: 'Sair' }
}

function getSysLang(): string {
  const lang = app.getLocale()
  if (lang.startsWith('zh-TW') || lang.startsWith('zh-Hant')) return 'zh-TW'
  if (lang.startsWith('zh')) return 'zh'
  if (lang.startsWith('ja')) return 'ja'
  if (lang.startsWith('ko')) return 'ko'
  if (lang.startsWith('hi')) return 'hi'
  if (lang.startsWith('pt')) return 'pt'
  return 'en'
}

function buildTrayMenu(): Menu {
  const t = trayI18n[getSysLang()] || trayI18n.en
  return Menu.buildFromTemplate([
    {
      label: t.toggle,
      click: () => {
        if (mainWindow?.isVisible()) {
          mainWindow.hide()
        } else {
          mainWindow?.show()
          mainWindow?.focus()
        }
      }
    },
    { type: 'separator' },
    {
      label: t.about,
      click: () => {
        shell.openExternal(REPO_URL)
      }
    },
    { type: 'separator' },
    {
      label: t.quit,
      click: () => {
        cleanup()
        app.quit()
      }
    }
  ])
}

function getIconPath(filename: string): string {
  // Dev: project root; Packaged: process.resourcesPath (extraResources)
  if (app.isPackaged) {
    return path.join(process.resourcesPath, filename)
  }
  return path.join(__dirname, '../../' + filename)
}

function createTray(): void {
  const iconPath = getIconPath('logo.png')
  const icon = nativeImage.createFromPath(iconPath)
  tray = new Tray(icon.resize({ width: 16, height: 16 }))
  tray.setToolTip('Claude Code Desktop')
  tray.setContextMenu(buildTrayMenu())

  // Double-click tray icon to toggle window
  tray.on('double-click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide()
    } else {
      mainWindow?.show()
      mainWindow?.focus()
    }
  })
}

function createWindow(): void {
  const iconPath = getIconPath('logo.png')
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: 'Claude Code Desktop',
    backgroundColor: '#1e1e2e',
    show: false
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // macOS: keep a minimal app menu so the menu bar shows the correct app name
  // Windows/Linux: remove menu bar entirely
  if (process.platform === 'darwin') {
    const appName = app.getName()
    const macMenu = Menu.buildFromTemplate([
      {
        label: appName,
        submenu: [
          { role: 'about', label: `About ${appName}` },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide', label: `Hide ${appName}` },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          {
            label: `Quit ${appName}`,
            accelerator: 'Cmd+Q',
            click: () => { cleanup(); app.quit() }
          }
        ]
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' }, { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
          { role: 'selectAll' }
        ]
      }
    ])
    Menu.setApplicationMenu(macMenu)
  } else {
    Menu.setApplicationMenu(null)
    mainWindow.setMenuBarVisibility(false)
  }

  // Close button hides to tray instead of quitting
  mainWindow.on('close', (e) => {
    if (tray) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Load the renderer
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  // Initialize core modules
  const projectsDir = getProjectsDir(app.getPath('home'))
  sessionWatcher = new SessionWatcher(projectsDir, mainWindow)
  claudeManager = new ClaudeManager(mainWindow)
  registerIpcHandlers(sessionWatcher, claudeManager, app.getPath('home'), mainWindow)
  sessionWatcher.start()
}

// Set app name before ready so macOS menu bar shows correct name in dev mode
app.setName('Claude Code Desktop')

app.whenReady().then(() => {
  // Single instance lock
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
    return
  }

  electronApp.setAppUserModelId('com.claudedesktop.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createTray()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  cleanup()
})

app.on('second-instance', () => {
  if (mainWindow) {
    mainWindow.show()
    mainWindow.focus()
  }
})

function cleanup(): void {
  claudeManager?.cleanup()
  sessionWatcher?.stop()
  claudeManager = null
  sessionWatcher = null
  tray?.destroy()
  tray = null
}
