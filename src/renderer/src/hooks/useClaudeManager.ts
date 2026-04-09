import { useState, useCallback, useEffect } from 'react'
import type { ActiveProcess, PtySpawnedPayload, PtyExitedPayload } from '../../../shared/types'

export interface ConnectionInfo {
  processKey: string
  sessionId: string | null
  projectSanitizedName: string
  pid: number
}

export function useClaudeManager() {
  const [activeProcesses, setActiveProcesses] = useState<ActiveProcess[]>([])
  const [connections, setConnections] = useState<Map<string, ConnectionInfo>>(new Map())
  // key: processKey

  useEffect(() => {
    const unsubSpawned = window.electronAPI.onPtySpawned((data: PtySpawnedPayload) => {
      setActiveProcesses((prev) => {
        const filtered = prev.filter((p) => p.processKey !== data.processKey)
        return [...filtered, {
          processKey: data.processKey,
          projectSanitizedName: data.projectSanitizedName,
          pid: data.pid,
          sessionId: data.sessionId,
          status: 'running' as const,
          cwd: data.cwd
        }]
      })
      setConnections((prev) => {
        const next = new Map(prev)
        next.set(data.processKey, {
          processKey: data.processKey,
          sessionId: data.sessionId,
          projectSanitizedName: data.projectSanitizedName,
          pid: data.pid
        })
        return next
      })
    })

    const unsubExited = window.electronAPI.onPtyExited((data: PtyExitedPayload) => {
      setActiveProcesses((prev) => prev.filter((p) => p.processKey !== data.processKey))
      setConnections((prev) => {
        const next = new Map(prev)
        next.delete(data.processKey)
        return next
      })
    })

    return () => { unsubSpawned(); unsubExited() }
  }, [])

  /** Connect to an existing session (resume) */
  const connect = useCallback(async (project: string, sessionId: string) => {
    try {
      const result = await window.electronAPI.resumeSession(project, sessionId, 80, 24)
      return result.processKey
    } catch (err) {
      console.error('Failed to connect session:', err)
      return null
    }
  }, [])

  /** Start a brand new session */
  const connectNew = useCallback(async (project: string) => {
    try {
      const result = await window.electronAPI.spawnClaude(project, 80, 24)
      return result.processKey
    } catch (err) {
      console.error('Failed to start new session:', err)
      return null
    }
  }, [])

  /** Disconnect a specific process */
  const disconnect = useCallback(async (processKey: string) => {
    try {
      await window.electronAPI.killClaude(processKey)
    } catch (err) {
      console.error('Failed to disconnect:', err)
    }
  }, [])

  /** Check if a session (by sessionId) is currently connected */
  const isConnected = useCallback((sessionId: string | null) => {
    if (!sessionId) return false
    for (const conn of connections.values()) {
      if (conn.sessionId === sessionId) return true
    }
    return false
  }, [connections])

  /** Get processKey for a connected session */
  const getProcessKey = useCallback((sessionId: string | null) => {
    if (!sessionId) return null
    for (const conn of connections.values()) {
      if (conn.sessionId === sessionId) return conn.processKey
    }
    return null
  }, [connections])

  const activeCount = connections.size
  const maxConnections = 10

  return {
    activeProcesses,
    connections,
    connect,
    connectNew,
    disconnect,
    isConnected,
    getProcessKey,
    activeCount,
    maxConnections
  }
}
