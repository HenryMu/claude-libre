import { ipcMain } from 'electron'
import { SessionWatcher } from './session-watcher'
import { ClaudeManager } from './claude-manager'

export function registerIpcHandlers(
  sessionWatcher: SessionWatcher,
  claudeManager: ClaudeManager
): void {
  // ===== Claude process management =====

  ipcMain.handle(
    'spawn-claude',
    async (_, projectSanitizedName: string, cols: number, rows: number) => {
      return claudeManager.spawn(projectSanitizedName, cols, rows)
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

  ipcMain.handle('kill-claude', async (_, projectSanitizedName: string) => {
    return claudeManager.killProcess(projectSanitizedName)
  })

  ipcMain.on(
    'pty-write',
    (_, projectSanitizedName: string, data: string) => {
      claudeManager.write(projectSanitizedName, data)
    }
  )

  ipcMain.on(
    'pty-resize',
    (_, projectSanitizedName: string, cols: number, rows: number) => {
      claudeManager.resize(projectSanitizedName, cols, rows)
    }
  )

  // ===== Session data queries =====

  ipcMain.handle(
    'get-session-details',
    (_, projectSanitizedName: string, sessionId: string) => {
      return sessionWatcher.getSessionDetails(projectSanitizedName, sessionId)
    }
  )

  ipcMain.handle('is-process-running', (_, projectSanitizedName: string) => {
    return claudeManager.isRunning(projectSanitizedName)
  })

  ipcMain.handle('get-active-processes', () => {
    return claudeManager.getActiveProcesses()
  })
}
