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

  // Project events
  onProjectAdded: (callback) => {
    const handler = (_: unknown, data: unknown) => callback(data as any)
    ipcRenderer.on('project-added', handler)
    return () => ipcRenderer.removeListener('project-added', handler)
  },
  onProjectDeleted: (callback) => {
    const handler = (_: unknown, data: unknown) => callback(data as any)
    ipcRenderer.on('project-deleted', handler)
    return () => ipcRenderer.removeListener('project-deleted', handler)
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
    ipcRenderer.invoke('get-active-processes'),

  // Config & profiles
  readConfig: () => ipcRenderer.invoke('read-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  readConfigFile: () => ipcRenderer.invoke('read-config-file'),
  writeConfigFile: (content) => ipcRenderer.invoke('write-config-file', content),
  listProfiles: () => ipcRenderer.invoke('list-profiles'),
  saveProfile: (profile) => ipcRenderer.invoke('save-profile', profile),
  deleteProfile: (profileId) => ipcRenderer.invoke('delete-profile', profileId),

  // Session management
  deleteSession: (projectSanitizedName, sessionId) => ipcRenderer.invoke('delete-session', projectSanitizedName, sessionId),
  renameSession: (projectSanitizedName, sessionId, title) => ipcRenderer.invoke('rename-session', projectSanitizedName, sessionId, title),

  // Project management
  addProject: () => ipcRenderer.invoke('add-project'),
  deleteProject: (projectSanitizedName) => ipcRenderer.invoke('delete-project', projectSanitizedName),

  // File browsing
  readDir: (dirPath) => ipcRenderer.invoke('read-dir', dirPath),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath)
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
