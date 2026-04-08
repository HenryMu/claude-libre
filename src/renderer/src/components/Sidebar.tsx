import React from 'react'
import type { SessionMeta, ActiveProcess } from '../../../shared/types'

interface ProjectData {
  sanitizedName: string
  realPath: string
  sessions: SessionMeta[]
}

interface SidebarProps {
  projects: ProjectData[]
  selectedProject: string | null
  selectedSession: string | null
  activeProcesses: ActiveProcess[]
  onSelectProject: (name: string) => void
  onSelectSession: (project: string, sessionId: string) => void
  onNewSession: (project: string) => void
  onResumeSession: (project: string, sessionId: string) => void
}

export default function Sidebar({
  projects,
  selectedProject,
  selectedSession,
  activeProcesses,
  onSelectProject,
  onSelectSession,
  onNewSession,
  onResumeSession
}: SidebarProps) {
  const activeProjectNames = new Set(activeProcesses.map((p) => p.projectSanitizedName))
  const activeSessionIds = new Set(activeProcesses.map((p) => p.sessionId).filter(Boolean))

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h2>ClaudeDesk</h2>
      </div>
      <div className="sidebar-content">
        {projects.map((project) => (
          <div key={project.sanitizedName} className="project-item">
            <div
              className={`project-header ${selectedProject === project.sanitizedName ? 'selected' : ''}`}
              onClick={() => onSelectProject(project.sanitizedName)}
            >
              <span className={`project-arrow ${selectedProject === project.sanitizedName ? 'open' : ''}`}>
                ▶
              </span>
              {activeProjectNames.has(project.sanitizedName) && <span className="active-dot" />}
              <span className="project-name" title={project.realPath}>
                {project.realPath.split(/[/\\]/).pop() || project.realPath}
              </span>
              <span className="project-count">{project.sessions.length}</span>
            </div>
            {selectedProject === project.sanitizedName && (
              <div className="session-list">
                <div style={{ padding: '4px 16px 4px 28px' }}>
                  <button className="btn-new" onClick={() => onNewSession(project.sanitizedName)}>
                    + New Session
                  </button>
                </div>
                {project.sessions
                  .sort((a, b) => (b.lastTimestamp || '').localeCompare(a.lastTimestamp || ''))
                  .map((session) => (
                    <div
                      key={session.sessionId}
                      className={`session-item ${selectedSession === session.sessionId ? 'selected' : ''}`}
                      onClick={() => onSelectSession(project.sanitizedName, session.sessionId)}
                    >
                      {activeSessionIds.has(session.sessionId) && <span className="active-dot" />}
                      <div className="session-info">
                        <div className="session-preview">
                          {session.firstUserMessage || '(empty session)'}
                        </div>
                        <div className="session-meta">
                          <span>{session.lastTimestamp ? formatTime(session.lastTimestamp) : ''}</span>
                          <span>{session.userMessageCount + session.assistantMessageCount} msgs</span>
                          {session.model && <span>{session.model}</span>}
                        </div>
                      </div>
                      <div className="session-actions">
                        <button
                          className="btn-icon"
                          onClick={(e) => {
                            e.stopPropagation()
                            onResumeSession(project.sanitizedName, session.sessionId)
                          }}
                        >
                          Resume
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        ))}
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
