import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { SessionMeta, ActiveProcess } from '../../../shared/types'
import type { ConnectionInfo } from '../hooks/useClaudeManager'
import LangSwitch from './LangSwitch'
import ThemeSwitch from './ThemeSwitch'

interface ProjectData {
  sanitizedName: string
  realPath: string
  sessions: SessionMeta[]
}

interface ContextMenuState {
  x: number
  y: number
  project: string
  sessionId: string
}

interface ProjectContextMenuState {
  x: number
  y: number
  sanitizedName: string
}

interface RenamingState {
  project: string
  sessionId: string
}

interface SidebarProps {
  projects: ProjectData[]
  pendingSessions: Map<string, SessionMeta>
  selectedProject: string | null
  selectedSession: string | null
  activeProcesses: ActiveProcess[]
  connections: Map<string, ConnectionInfo>
  onSelectProject: (name: string) => void
  onSelectSession: (project: string, sessionId: string) => void
  onNewSession: (project: string) => void
  onOpenSettings: () => void
  onAddProject: () => void
  onDeleteProject: (projectSanitizedName: string) => void
}

export default function Sidebar({
  projects,
  pendingSessions,
  selectedProject,
  selectedSession,
  activeProcesses,
  connections,
  onSelectProject,
  onSelectSession,
  onNewSession,
  onOpenSettings,
  onAddProject,
  onDeleteProject
}: SidebarProps) {
  const { t } = useTranslation()
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null)
  const [projectCtxMenu, setProjectCtxMenu] = useState<ProjectContextMenuState | null>(null)
  const [renaming, setRenaming] = useState<RenamingState | null>(null)
  const renameRef = useRef<HTMLInputElement>(null)
  const ctxRef = useRef<HTMLDivElement>(null)
  const projectCtxRef = useRef<HTMLDivElement>(null)

  const connectedSessionIds = new Set<string>()
  for (const conn of connections.values()) {
    if (conn.sessionId) connectedSessionIds.add(conn.sessionId)
  }

  // Close context menu on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ctxRef.current?.contains(e.target as Node)) return
      if (projectCtxRef.current?.contains(e.target as Node)) return
      setCtxMenu(null)
      setProjectCtxMenu(null)
    }
    if (ctxMenu || projectCtxMenu) {
      document.addEventListener('click', handler)
      return () => document.removeEventListener('click', handler)
    }
  }, [ctxMenu, projectCtxMenu])

  const handleContextMenu = useCallback((e: React.MouseEvent, project: string, sessionId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ x: e.clientX, y: e.clientY, project, sessionId })
  }, [])

  const handleDelete = useCallback(async () => {
    if (!ctxMenu) return
    const { project, sessionId } = ctxMenu
    const msg = t('sidebar.confirmDelete')
    if (window.confirm(msg)) {
      try {
        await window.electronAPI.deleteSession(project, sessionId)
      } catch (err) {
        console.error('Failed to delete session:', err)
      }
    }
    setCtxMenu(null)
  }, [ctxMenu, t])

  const handleRename = useCallback(() => {
    if (!ctxMenu) return
    setRenaming({ project: ctxMenu.project, sessionId: ctxMenu.sessionId })
    setCtxMenu(null)
  }, [ctxMenu])

  const commitRename = useCallback(async (newTitle: string) => {
    if (!renaming || !newTitle.trim()) {
      setRenaming(null)
      return
    }
    try {
      await window.electronAPI.renameSession(renaming.project, renaming.sessionId, newTitle.trim())
    } catch (err) {
      console.error('Failed to rename session:', err)
    }
    setRenaming(null)
  }, [renaming])

  // Auto-focus rename input
  useEffect(() => {
    if (renaming) {
      renameRef.current?.focus()
      renameRef.current?.select()
    }
  }, [renaming])

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h2>CC-Desktop</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ThemeSwitch />
          <LangSwitch />
          <button className="settings-btn" onClick={onAddProject} title={t('sidebar.addProject')}>+</button>
          <button className="settings-btn" onClick={onOpenSettings}>⚙</button>
        </div>
      </div>
      <div className="sidebar-content">
        {projects.map((project) => {
          const projectPending = Array.from(pendingSessions.values())
            .filter(s => s.projectSanitizedName === project.sanitizedName)

          const allSessions = [...projectPending, ...project.sessions]
            .sort((a, b) => (b.lastTimestamp || '').localeCompare(a.lastTimestamp || ''))

          return (
            <div key={project.sanitizedName} className="project-item">
              <div
                className={`project-header ${selectedProject === project.sanitizedName ? 'selected' : ''}`}
                onClick={() => onSelectProject(project.sanitizedName)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setProjectCtxMenu({ x: e.clientX, y: e.clientY, sanitizedName: project.sanitizedName })
                }}
              >
                <span className={`project-arrow ${selectedProject === project.sanitizedName ? 'open' : ''}`}>
                  ▶
                </span>
                <span className="project-name" title={project.realPath}>
                  {project.realPath.split(/[/\\]/).pop() || project.realPath}
                </span>
                <span className="project-count">{allSessions.length}</span>
              </div>
              {selectedProject === project.sanitizedName && (
                <div className="session-list">
                  <div style={{ padding: '4px 16px 4px 28px' }}>
                    <button className="btn-new" onClick={() => onNewSession(project.sanitizedName)}>
                      + {t('sidebar.newSession')}
                    </button>
                  </div>
                  {allSessions.map((session) => {
                    const isPending = session.sessionId.startsWith('__pending_')
                    const isConnected = connectedSessionIds.has(session.sessionId)

                    return (
                      <div
                        key={session.sessionId}
                        className={`session-item ${selectedSession === session.sessionId ? 'selected' : ''}`}
                        onClick={() => onSelectSession(project.sanitizedName, session.sessionId)}
                        onContextMenu={(e) => !isPending && handleContextMenu(e, project.sanitizedName, session.sessionId)}
                      >
                        <span className={`status-dot ${isConnected ? 'dot-connected' : isPending ? 'dot-pending' : 'dot-offline'}`} />
                        <div className="session-info">
                          {renaming?.sessionId === session.sessionId ? (
                            <input
                              ref={renameRef}
                              className="rename-input"
                              defaultValue={session.title || session.firstUserMessage || ''}
                              onBlur={(e) => commitRename(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') commitRename(e.target.value)
                                if (e.key === 'Escape') setRenaming(null)
                                e.stopPropagation()
                              }}
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : (
                          <div className="session-preview">
                            {isPending ? t('sidebar.pendingSession') : (session.title || session.firstUserMessage || t('sidebar.emptySession'))}
                          </div>
                          )}
                          <div className="session-meta">
                            {!isPending && <span>{session.lastTimestamp ? formatTime(session.lastTimestamp) : ''}</span>}
                            {!isPending && <span>{session.userMessageCount + session.assistantMessageCount} {t('sidebar.msgs')}</span>}
                            {session.model && <span>{session.model}</span>}
                            {isPending && <span className="pending-label">{t('sidebar.pendingLabel')}</span>}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Session context menu */}
      {ctxMenu && (
        <div
          ref={ctxRef}
          className="context-menu"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button className="context-menu-item" onClick={handleRename}>
            {t('sidebar.rename')}
          </button>
          <button className="context-menu-item danger" onClick={handleDelete}>
            {t('sidebar.delete')}
          </button>
        </div>
      )}

      {/* Project context menu */}
      {projectCtxMenu && (
        <div
          ref={projectCtxRef}
          className="context-menu"
          style={{ top: projectCtxMenu.y, left: projectCtxMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="context-menu-item danger"
            onClick={() => {
              const project = projects.find(p => p.sanitizedName === projectCtxMenu.sanitizedName)
              const path = project?.realPath || projectCtxMenu.sanitizedName
              if (window.confirm(t('sidebar.confirmDeleteProject', { path }))) {
                onDeleteProject(projectCtxMenu.sanitizedName)
              }
              setProjectCtxMenu(null)
            }}
          >
            {t('sidebar.deleteProject')}
          </button>
        </div>
      )}
    </div>
  )
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    if (diffMins < 1) return 'just now'
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    return d.toLocaleDateString()
  } catch {
    return ''
  }
}
