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

  // Terminal events — routed by processKey
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

  // Permission events — routed by processKey
  onPermissionPrompt: (callback) => {
    const handler = (_: unknown, data: unknown) => callback(data as any)
    ipcRenderer.on('permission-prompt', handler)
    return () => ipcRenderer.removeListener('permission-prompt', handler)
  },
  onPermissionClear: (callback) => {
    const handler = (_: unknown, data: unknown) => callback(data as any)
    ipcRenderer.on('permission-clear', handler)
    return () => ipcRenderer.removeListener('permission-clear', handler)
  },
  onPermissionFailed: (callback) => {
    const handler = (_: unknown, data: unknown) => callback(data as any)
    ipcRenderer.on('permission-failed', handler)
    return () => ipcRenderer.removeListener('permission-failed', handler)
  },

  // Actions — all use processKey
  spawnClaude: (projectSanitizedName, cols, rows) =>
    ipcRenderer.invoke('spawn-claude', projectSanitizedName, cols, rows),
  resumeSession: (projectSanitizedName, sessionId, cols, rows) =>
    ipcRenderer.invoke('resume-session', projectSanitizedName, sessionId, cols, rows),
  killClaude: (processKey) =>
    ipcRenderer.invoke('kill-claude', processKey),
  ptyWrite: (processKey, data) =>
    ipcRenderer.send('pty-write', processKey, data),
  ptyResize: (processKey, cols, rows) =>
    ipcRenderer.send('pty-resize', processKey, cols, rows),
  respondPermission: (processKey, response) =>
    ipcRenderer.send('permission-respond', processKey, response),

  // Queries
  getSessionDetails: (projectSanitizedName, sessionId) =>
    ipcRenderer.invoke('get-session-details', projectSanitizedName, sessionId),
  isProcessRunning: (processKey) =>
    ipcRenderer.invoke('is-process-running', processKey),
  getActiveProcesses: () =>
    ipcRenderer.invoke('get-active-processes')
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
