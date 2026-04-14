import { autoUpdater } from 'electron-updater'
import { BrowserWindow, ipcMain } from 'electron'
import log from 'electron-log'

// Let electron-updater use electron-log for logging
autoUpdater.logger = log

const CHECK_INTERVAL = 30 * 60 * 1000 // 30 minutes
let checkTimer: ReturnType<typeof setInterval> | null = null

export function initAutoUpdater(mainWindow: BrowserWindow): void {
  // Only enable auto-update in packaged builds
  if (!mainWindow || !mainWindow.isDestroyed()) {
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.autoDownload = false // Let user confirm before downloading
  }

  // ===== Event handlers =====

  autoUpdater.on('update-available', (info) => {
    log.info('Update available:', info.version)
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-available', {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: info.releaseNotes,
        currentVersion: autoUpdater.currentVersion.version
      })
    }
  })

  autoUpdater.on('download-progress', (progress) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-progress', {
        percent: Math.round(progress.percent),
        transferred: progress.transferred,
        total: progress.total,
        speed: progress.bytesPerSecond
      })
    }
  })

  autoUpdater.on('update-downloaded', (info) => {
    log.info('Update downloaded:', info.version)
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-downloaded', {
        version: info.version
      })
    }
  })

  autoUpdater.on('error', (err) => {
    log.error('AutoUpdater error:', err)
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-error', {
        message: err.message
      })
    }
  })

  // ===== IPC handlers =====

  ipcMain.handle('check-for-updates', async () => {
    try {
      const result = await autoUpdater.checkForUpdates()
      return {
        updateInfo: result?.updateInfo ?? null,
        cancellationToken: result?.cancellationToken ?? null
      }
    } catch (err: any) {
      return { updateInfo: null, error: err.message }
    }
  })

  ipcMain.handle('download-update', async () => {
    try {
      await autoUpdater.downloadUpdate()
    } catch (err: any) {
      log.error('Download update failed:', err)
    }
  })

  ipcMain.handle('quit-and-install', () => {
    autoUpdater.quitAndInstall()
  })

  // ===== Periodic check =====

  // Check once on startup (after a short delay to let the app fully load)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      log.error('Initial update check failed:', err)
    })
  }, 5000)

  // Then check periodically
  checkTimer = setInterval(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      log.error('Periodic update check failed:', err)
    })
  }, CHECK_INTERVAL)
}

export function stopAutoUpdater(): void {
  if (checkTimer) {
    clearInterval(checkTimer)
    checkTimer = null
  }
}
