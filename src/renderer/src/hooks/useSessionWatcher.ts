import { useState, useEffect, useCallback } from 'react'
import type { SessionMeta, InitialDataPayload, SessionCreatedPayload, SessionUpdatedPayload, SessionDeletedPayload, SessionDetailsPayload, ProjectAddedPayload, ProjectDeletedPayload } from '../../../shared/types'

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

  // Project added
  useEffect(() => {
    const cleanup = window.electronAPI.onProjectAdded((data: ProjectAddedPayload) => {
      setProjects((prev) => {
        if (prev.some(p => p.sanitizedName === data.sanitizedName)) return prev
        return [...prev, { sanitizedName: data.sanitizedName, realPath: data.realPath, sessions: [] }]
          .sort((a, b) => a.realPath.localeCompare(b.realPath))
      })
    })
    return cleanup
  }, [])

  // Project deleted
  useEffect(() => {
    const cleanup = window.electronAPI.onProjectDeleted((data: ProjectDeletedPayload) => {
      setProjects((prev) => prev.filter((p) => p.sanitizedName !== data.sanitizedName))
      setSelectedProject((cur) => cur === data.sanitizedName ? null : cur)
      setSelectedSession((cur) => {
        // If selected session belongs to deleted project, clear it
        setSessionDetails((prev) => {
          if (prev && prev.meta.projectSanitizedName === data.sanitizedName) return null
          return prev
        })
        // Return null to clear, or current value to keep
        // We need to check the selectedSession's project, but we already removed it from projects
        // Simplest: if the project was selected, clear session too
        return null
      })
      setSessionDetails(null)
    })
    return cleanup
  }, [])

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

  const openProject = useCallback((name: string) => {
    setSelectedProject(name)
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

  const removePendingSession = useCallback((sessionId: string) => {
    setPendingSessions((prev) => {
      if (!prev.has(sessionId)) return prev
      const next = new Map(prev)
      next.delete(sessionId)
      return next
    })
    setSelectedSession((cur) => cur === sessionId ? null : cur)
    setSessionDetails((prev) => prev?.meta?.sessionId === sessionId ? null : prev)
  }, [])

  return {
    projects,
    pendingSessions,
    selectedProject,
    selectedSession,
    sessionDetails,
    selectProject,
    openProject,
    selectSession,
    addPendingSession,
    removePendingSession
  }
}
