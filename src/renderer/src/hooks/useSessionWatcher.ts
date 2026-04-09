import { useState, useEffect, useCallback } from 'react'
import type { SessionMeta, InitialDataPayload, SessionCreatedPayload, SessionUpdatedPayload, SessionDeletedPayload, SessionDetailsPayload } from '../../../shared/types'

interface ProjectData {
  sanitizedName: string
  realPath: string
  sessions: SessionMeta[]
}

export function useSessionWatcher() {
  const [projects, setProjects] = useState<ProjectData[]>([])
  const [selectedProject, setSelectedProject] = useState<string | null>(null)
  const [selectedSession, setSelectedSession] = useState<string | null>(null)
  const [sessionDetails, setSessionDetails] = useState<SessionDetailsPayload | null>(null)
  // Pending sessions: tempId → SessionMeta (for "New Session" before JSONL exists)
  const [pendingSessions, setPendingSessions] = useState<Map<string, SessionMeta>>(new Map())

  // Initial data
  useEffect(() => {
    const cleanup = window.electronAPI.onInitialData((data: InitialDataPayload) => {
      setProjects(data.projects)
    })
    return cleanup
  }, [])

  // Session created (from JSONL file) — replace pending if applicable
  useEffect(() => {
    const cleanup = window.electronAPI.onSessionCreated((data: SessionCreatedPayload) => {
      setProjects((prev) =>
        prev.map((p) =>
          p.sanitizedName === data.projectSanitizedName
            ? { ...p, sessions: [...p.sessions, data.meta] }
            : p
        )
      )
      // If we had a pending session for this project, replace selection
      setPendingSessions((prev) => {
        const next = new Map(prev)
        // Find and remove the pending session for this project
        for (const [tempId, meta] of next) {
          if (meta.projectSanitizedName === data.projectSanitizedName) {
            next.delete(tempId)
            // Update selection from pending tempId to real sessionId
            setSelectedSession((cur) => cur === tempId ? data.meta.sessionId : cur)
            // Load details for the real session
            refreshDetails(data.projectSanitizedName, data.meta.sessionId)
            break
          }
        }
        return next
      })
    })
    return cleanup
  }, [])

  // Session updated
  useEffect(() => {
    const cleanup = window.electronAPI.onSessionUpdated((data: SessionUpdatedPayload) => {
      setProjects((prev) =>
        prev.map((p) =>
          p.sanitizedName === data.projectSanitizedName
            ? { ...p, sessions: p.sessions.map((s) => s.sessionId === data.sessionId ? data.updatedMeta : s) }
            : p
        )
      )
      if (selectedSession === data.sessionId) {
        refreshDetails(data.projectSanitizedName, data.sessionId)
      }
    })
    return cleanup
  }, [selectedSession])

  // Session deleted
  useEffect(() => {
    const cleanup = window.electronAPI.onSessionDeleted((data: SessionDeletedPayload) => {
      setProjects((prev) =>
        prev.map((p) =>
          p.sanitizedName === data.projectSanitizedName
            ? { ...p, sessions: p.sessions.filter((s) => s.sessionId !== data.sessionId) }
            : p
        )
      )
      if (selectedSession === data.sessionId) {
        setSelectedSession(null)
        setSessionDetails(null)
      }
    })
    return cleanup
  }, [selectedSession])

  const refreshDetails = useCallback(async (project: string, sessionId: string) => {
    // Don't try to load details for pending sessions
    if (sessionId.startsWith('__pending_')) {
      setSessionDetails({ lines: [], meta: pendingSessions.get(sessionId) || null as any })
      return
    }
    try {
      const details = await window.electronAPI.getSessionDetails(project, sessionId)
      setSessionDetails(details)
    } catch (err) {
      console.error('Failed to load session details:', err)
    }
  }, [pendingSessions])

  const selectProject = useCallback((name: string) => {
    setSelectedProject((prev) => (prev === name ? null : name))
    setSelectedSession(null)
    setSessionDetails(null)
  }, [])

  const selectSession = useCallback(
    (project: string, sessionId: string) => {
      setSelectedProject(project)
      setSelectedSession(sessionId)
      refreshDetails(project, sessionId)
    },
    [refreshDetails]
  )

  const addPendingSession = useCallback((project: string, meta: SessionMeta) => {
    setPendingSessions((prev) => {
      const next = new Map(prev)
      next.set(meta.sessionId, meta)
      return next
    })
  }, [])

  return {
    projects,
    pendingSessions,
    selectedProject,
    selectedSession,
    sessionDetails,
    selectProject,
    selectSession,
    addPendingSession
  }
}
