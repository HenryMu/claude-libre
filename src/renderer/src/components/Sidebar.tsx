import React from 'react'
import type { SessionMeta, ActiveProcess } from '../../../shared/types'
import type { ConnectionInfo } from '../hooks/useClaudeManager'

interface ProjectData {
  sanitizedName: string
  realPath: string
  sessions: SessionMeta[]
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
  onNewSession
}: SidebarProps) {
  // Build a set of connected sessionIds for fast lookup
  const connectedSessionIds = new Set<string>()
  for (const conn of connections.values()) {
    if (conn.sessionId) connectedSessionIds.add(conn.sessionId)
  }
  // Pending sessions that haven't been replaced by real ones yet
  const connectedProcessKeys = new Set(connections.keys())

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h2>ClaudeDesk</h2>
        <span className="connection-counter">{connections.size}/3</span>
      </div>
      <div className="sidebar-content">
        {projects.map((project) => {
          // Collect pending sessions for this project
          const projectPending = Array.from(pendingSessions.values())
            .filter(s => s.projectSanitizedName === project.sanitizedName)

          // Combine real sessions with pending ones
          const allSessions = [...projectPending, ...project.sessions]
            .sort((a, b) => (b.lastTimestamp || '').localeCompare(a.lastTimestamp || ''))

          return (
            <div key={project.sanitizedName} className="project-item">
              <div
                className={`project-header ${selectedProject === project.sanitizedName ? 'selected' : ''}`}
                onClick={() => onSelectProject(project.sanitizedName)}
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
                      + New Session
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
                      >
                        <span className={`status-dot ${isConnected ? 'dot-connected' : isPending ? 'dot-pending' : 'dot-offline'}`} />
                        <div className="session-info">
                          <div className="session-preview">
                            {isPending ? 'New Session (not connected)' : session.firstUserMessage || '(empty session)'}
                          </div>
                          <div className="session-meta">
                            {!isPending && <span>{session.lastTimestamp ? formatTime(session.lastTimestamp) : ''}</span>}
                            {!isPending && <span>{session.userMessageCount + session.assistantMessageCount} msgs</span>}
                            {session.model && <span>{session.model}</span>}
                            {isPending && <span className="pending-label">Pending</span>}
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
