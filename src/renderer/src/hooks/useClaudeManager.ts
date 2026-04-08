import { useState, useCallback, useEffect } from 'react'
import type { ActiveProcess, PtySpawnedPayload, PtyExitedPayload } from '../../../shared/types'

export function useClaudeManager() {
  const [activeProcesses, setActiveProcesses] = useState<ActiveProcess[]>([])
  const [activeTerminalProject, setActiveTerminalProject] = useState<string | null>(null)

  useEffect(() => {
    const unsubSpawned = window.electronAPI.onPtySpawned((data: PtySpawnedPayload) => {
      setActiveProcesses((prev) => {
        const filtered = prev.filter((p) => p.projectSanitizedName !== data.projectSanitizedName)
        return [
          ...filtered,
          {
            projectSanitizedName: data.projectSanitizedName,
            pid: data.pid,
            sessionId: null,
            status: 'running' as const,
            cwd: data.cwd
          }
        ]
      })
    })

    const unsubExited = window.electronAPI.onPtyExited((data: PtyExitedPayload) => {
      setActiveProcesses((prev) =>
        prev.filter((p) => p.projectSanitizedName !== data.projectSanitizedName)
      )
      setActiveTerminalProject((prev) =>
        prev === data.projectSanitizedName ? null : prev
      )
    })

    return () => {
      unsubSpawned()
      unsubExited()
    }
  }, [])

  const spawn = useCallback(async (project: string) => {
    try {
      await window.electronAPI.spawnClaude(project, 80, 24)
      setActiveTerminalProject(project)
    } catch (err) {
      console.error('Failed to spawn claude:', err)
    }
  }, [])

  const resume = useCallback(async (project: string, sessionId: string) => {
    try {
      await window.electronAPI.resumeSession(project, sessionId, 80, 24)
      setActiveTerminalProject(project)
    } catch (err) {
      console.error('Failed to resume session:', err)
    }
  }, [])

  const kill = useCallback(async (project: string) => {
    try {
      await window.electronAPI.killClaude(project)
    } catch (err) {
      console.error('Failed to kill claude:', err)
    }
  }, [])

  const isRunning = useCallback(
    (project: string) => activeProcesses.some((p) => p.projectSanitizedName === project),
    [activeProcesses]
  )

  return {
    activeProcesses,
    spawn,
    resume,
    kill,
    isRunning,
    activeTerminalProject,
    setActiveTerminalProject
  }
}
