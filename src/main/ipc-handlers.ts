import { ipcMain, BrowserWindow } from 'electron'
import { SessionWatcher } from './session-watcher'
import { ClaudeManager } from './claude-manager'
import { readClaudeConfig, writeClaudeConfig, readConfigFile, writeConfigFile, listProfiles, saveProfile, deleteProfile } from './config-manager'
import { sanitizePath } from './path-utils'
import type { ClaudeConfig, ProfileData } from '../shared/types'

export function registerIpcHandlers(
  sessionWatcher: SessionWatcher,
  claudeManager: ClaudeManager,
  homeDir: string,
  mainWindow: BrowserWindow
): void {
  // ===== Claude process management =====

  ipcMain.handle(
    'spawn-claude',
    async (_, projectSanitizedName: string, cols: number, rows: number) => {
      return claudeManager.spawnNew(projectSanitizedName, cols, rows)
    }
  )

  ipcMain.handle(
    'resume-session',
    async (
      _,
      projectSanitizedName: string,
      sessionId: string,
      cols: number,
      rows: number
    ) => {
      return claudeManager.resume(projectSanitizedName, sessionId, cols, rows)
    }
  )

  ipcMain.handle('kill-claude', async (_, processKey: string) => {
    return claudeManager.killProcess(processKey)
  })

  ipcMain.on('pty-write', (_, processKey: string, data: string) => {
    claudeManager.write(processKey, data)
  })

  ipcMain.on('pty-resize', (_, processKey: string, cols: number, rows: number) => {
    claudeManager.resize(processKey, cols, rows)
  })

  ipcMain.on('permission-respond', (_, processKey: string, response: string) => {
    claudeManager.respondPermission(processKey, response)
  })

  // ===== Session data queries =====

  ipcMain.handle(
    'get-session-details',
    (_, projectSanitizedName: string, sessionId: string) => {
      return sessionWatcher.getSessionDetails(projectSanitizedName, sessionId)
    }
  )

  ipcMain.handle('is-process-running', (_, processKey: string) => {
    return claudeManager.isRunning(processKey)
  })

  ipcMain.handle('get-active-processes', () => {
    return claudeManager.getActiveProcesses()
  })

  // ===== Config & Profile management =====

  ipcMain.handle('read-config', () => {
    return readClaudeConfig(homeDir)
  })

  ipcMain.handle('save-config', (_, config: ClaudeConfig) => {
    writeClaudeConfig(homeDir, config)
  })

  ipcMain.handle('read-config-file', () => {
    return readConfigFile(homeDir)
  })

  ipcMain.handle('write-config-file', (_, content: string) => {
    writeConfigFile(homeDir, content)
  })

  ipcMain.handle('list-profiles', () => {
    return listProfiles(homeDir)
  })

  ipcMain.handle('save-profile', (_, profile: ProfileData) => {
    saveProfile(homeDir, profile)
  })

  ipcMain.handle('delete-profile', (_, profileId: string) => {
    deleteProfile(homeDir, profileId)
  })

  // ===== Session management =====

  ipcMain.handle('delete-session', async (_, projectSanitizedName: string, sessionId: string) => {
    await claudeManager.killBySessionId(sessionId)
    sessionWatcher.deleteSession(projectSanitizedName, sessionId)
  })

  ipcMain.handle('rename-session', (_, projectSanitizedName: string, sessionId: string, title: string) => {
    sessionWatcher.updateSessionTitle(projectSanitizedName, sessionId, title)
  })

  // ===== Project management =====

  ipcMain.handle('add-project', async () => {
    const { dialog } = await import('electron')
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null

    const selectedPath = result.filePaths[0]
    const sanitizedName = sanitizePath(selectedPath)

    sessionWatcher.addProject(sanitizedName, selectedPath)
    return { sanitizedName, realPath: selectedPath }
  })

  ipcMain.handle('delete-project', async (_, projectSanitizedName: string) => {
    await claudeManager.killByProject(projectSanitizedName)
    sessionWatcher.deleteProject(projectSanitizedName)
  })
}
