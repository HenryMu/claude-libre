import { ipcMain, BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import { SessionWatcher } from './session-watcher'
import { ClaudeManager } from './claude-manager'
import { readClaudeConfig, writeClaudeConfig, readConfigFile, writeConfigFile, listProfiles, saveProfile, deleteProfile } from './config-manager'
import { sanitizePath } from './path-utils'
import type { ClaudeConfig, ProfileData, FileNode, ImageAttachment, SubmitMessageRequest } from '../shared/types'

const SKIP_NAMES = new Set([
  'node_modules', '.git', '.svn', '__pycache__', '.next', 'dist', 'out', 'build',
  '.cache', 'coverage', '.DS_Store', '.idea', '.vscode', 'vendor', 'target'
])

function readDirRecursive(dir: string, depth: number, maxDepth: number): FileNode[] {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    const nodes: FileNode[] = []
    for (const entry of entries) {
      if (SKIP_NAMES.has(entry.name)) continue
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        const node: FileNode = { name: entry.name, path: fullPath, isDir: true }
        if (depth < maxDepth) node.children = readDirRecursive(fullPath, depth + 1, maxDepth)
        nodes.push(node)
      } else {
        nodes.push({ name: entry.name, path: fullPath, isDir: false })
      }
    }
    return nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  } catch {
    return []
  }
}

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
      const realPath = sessionWatcher.getRealPath(projectSanitizedName)
      return claudeManager.spawnNew(projectSanitizedName, cols, rows, realPath)
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
      const realPath = sessionWatcher.getRealPath(projectSanitizedName)
      return claudeManager.resume(projectSanitizedName, sessionId, cols, rows, realPath)
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

  ipcMain.handle('submit-message', async (_, request: SubmitMessageRequest) => {
    await claudeManager.submitMessage(request)
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

  // ===== File browsing =====

  ipcMain.handle('read-dir', (_, dirPath: string): FileNode[] => {
    return readDirRecursive(dirPath, 0, 4)
  })

  ipcMain.handle('read-file', (_, filePath: string): string => {
    try {
      return fs.readFileSync(filePath, 'utf-8')
    } catch (e: any) {
      return `[Error reading file: ${e.message}]`
    }
  })

  // ===== Image upload =====

  ipcMain.handle('select-images', async (): Promise<ImageAttachment[]> => {
    const { dialog } = await import('electron')
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return []

    return result.filePaths.map(filePath => {
      const data = fs.readFileSync(filePath)
      const ext = path.extname(filePath).slice(1).toLowerCase()
      const mime = ext === 'jpg' ? 'jpeg' : ext
      return {
        path: filePath,
        name: path.basename(filePath),
        dataUrl: `data:image/${mime};base64,${data.toString('base64')}`
      }
    })
  })
}
