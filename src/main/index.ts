import { app, BrowserWindow } from 'electron'
import path from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { SessionWatcher } from './session-watcher'
import { ClaudeManager } from './claude-manager'
import { registerIpcHandlers } from './ipc-handlers'
import { getProjectsDir } from './path-utils'

let mainWindow: BrowserWindow | null = null
let sessionWatcher: SessionWatcher | null = null
let claudeManager: ClaudeManager | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: 'ClaudeDesk',
    backgroundColor: '#1e1e2e',
    show: false
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
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
  registerIpcHandlers(sessionWatcher, claudeManager)
  sessionWatcher.start()
}

app.whenReady().then(() => {
  // Single instance lock
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
    return
  }

  electronApp.setAppUserModelId('com.claudedesk.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  cleanup()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  cleanup()
})

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

function cleanup(): void {
  claudeManager?.cleanup()
  sessionWatcher?.stop()
  claudeManager = null
  sessionWatcher = null
}
