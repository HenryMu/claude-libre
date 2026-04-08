import { contextBridge, ipcRenderer } from 'electron'
import type { ElectronAPI } from '../shared/types'

const electronAPI: ElectronAPI = {
  // Session data events
  onInitialData: (callback) => {
    const handler = (_: unknown, data: unknown) => callback(data as any)
    ipcRenderer.on('initial-data', handler)
    return () => ipcRenderer.removeListener('initial-data', handler)
  },
  onSessionCreated: (callback) => {
    const handler = (_: unknown, data: unknown) => callback(data as any)
    ipcRenderer.on('session-created', handler)
    return () => ipcRenderer.removeListener('session-created', handler)
  },
  onSessionUpdated: (callback) => {
    const handler = (_: unknown, data: unknown) => callback(data as any)
    ipcRenderer.on('session-updated', handler)
    return () => ipcRenderer.removeListener('session-updated', handler)
  },
  onSessionDeleted: (callback) => {
    const handler = (_: unknown, data: unknown) => callback(data as any)
    ipcRenderer.on('session-deleted', handler)
    return () => ipcRenderer.removeListener('session-deleted', handler)
  },

  // Terminal events
  onPtyData: (callback) => {
    const handler = (_: unknown, data: unknown) => callback(data as any)
    ipcRenderer.on('pty-data', handler)
    return () => ipcRenderer.removeListener('pty-data', handler)
  },
  onPtySpawned: (callback) => {
    const handler = (_: unknown, data: unknown) => callback(data as any)
    ipcRenderer.on('pty-spawned', handler)
    return () => ipcRenderer.removeListener('pty-spawned', handler)
  },
  onPtyExited: (callback) => {
    const handler = (_: unknown, data: unknown) => callback(data as any)
    ipcRenderer.on('pty-exited', handler)
    return () => ipcRenderer.removeListener('pty-exited', handler)
  },

  // Actions
  spawnClaude: (projectSanitizedName, cols, rows) =>
    ipcRenderer.invoke('spawn-claude', projectSanitizedName, cols, rows),
  resumeSession: (projectSanitizedName, sessionId, cols, rows) =>
    ipcRenderer.invoke('resume-session', projectSanitizedName, sessionId, cols, rows),
  killClaude: (projectSanitizedName) =>
    ipcRenderer.invoke('kill-claude', projectSanitizedName),
  ptyWrite: (projectSanitizedName, data) =>
    ipcRenderer.send('pty-write', projectSanitizedName, data),
  ptyResize: (projectSanitizedName, cols, rows) =>
    ipcRenderer.send('pty-resize', projectSanitizedName, cols, rows),

  // Queries
  getSessionDetails: (projectSanitizedName, sessionId) =>
    ipcRenderer.invoke('get-session-details', projectSanitizedName, sessionId),
  isProcessRunning: (projectSanitizedName) =>
    ipcRenderer.invoke('is-process-running', projectSanitizedName),
  getActiveProcesses: () =>
    ipcRenderer.invoke('get-active-processes')
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
