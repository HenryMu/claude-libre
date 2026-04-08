import React from 'react'
import type { SessionMeta, ActiveProcess, JsonlLine, SessionDetailsPayload } from '../../../shared/types'

interface ProjectData {
  sanitizedName: string
  realPath: string
  sessions: SessionMeta[]
}

interface SessionState {
  projects: ProjectData[]
  selectedProject: string | null
  selectedSession: string | null
  selectProject: (name: string) => void
  selectSession: (project: string, sessionId: string) => void
  sessionDetails: SessionDetailsPayload | null
}

interface ClaudeState {
  activeProcesses: ActiveProcess[]
  spawn: (project: string) => void
  resume: (project: string, sessionId: string) => void
  kill: (project: string) => void
  isRunning: (project: string) => boolean
  activeTerminalProject: string | null
  setActiveTerminalProject: (project: string | null) => void
}

interface MainContentProps {
  sessionState: SessionState
  claudeState: ClaudeState
}

export default function MainContent({ sessionState, claudeState }: MainContentProps) {
  const { selectedProject, selectedSession, sessionDetails, projects } = sessionState
  const { activeTerminalProject } = claudeState

  const project = projects.find((p) => p.sanitizedName === selectedProject)

  // Determine what to show
  const showSession = selectedSession && sessionDetails
  const showTerminal = activeTerminalProject === selectedProject

  if (!selectedProject || !project) {
    return (
      <div className="main-content">
        <div className="empty-state">Select a project to view sessions</div>
      </div>
    )
  }

  if (showTerminal && showSession) {
    return (
      <div className="main-content">
        <div className="split-pane" style={{ height: '100%' }}>
          <div className="pane" style={{ flex: 1, overflow: 'hidden' }}>
            <SessionView details={sessionDetails!} />
          </div>
          <div className="split-divider" />
          <div className="pane" style={{ flex: 1, overflow: 'hidden' }}>
            <TerminalPane project={selectedProject} realPath={project.realPath} />
          </div>
        </div>
      </div>
    )
  }

  if (showTerminal) {
    return (
      <div className="main-content">
        <TerminalPane project={selectedProject} realPath={project.realPath} />
      </div>
    )
  }

  if (showSession) {
    return (
      <div className="main-content">
        <SessionView details={sessionDetails!} />
      </div>
    )
  }

  return (
    <div className="main-content">
      <div className="empty-state">
        Select a session to view, or start a new one
      </div>
    </div>
  )
}

function SessionView({ details }: { details: SessionDetailsPayload }) {
  const messages = details.lines.filter(
    (line) => line.type === 'user' || line.type === 'assistant'
  )

  return (
    <div className="session-view">
      {messages.map((msg, i) => (
        <MessageItem key={msg.uuid || i} line={msg} />
      ))}
    </div>
  )
}

function MessageItem({ line }: { line: JsonlLine }) {
  const role = line.message?.role || line.type
  const content = line.message?.content

  let textContent: string = ''
  if (typeof content === 'string') {
    textContent = content
  } else if (Array.isArray(content)) {
    textContent = content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n')
  }

  return (
    <div className={`message message-${role}`}>
      <div className="message-role">{role}</div>
      <div className="message-content">
        <pre style={{ whiteSpace: 'pre-wrap', wordWrap: 'break-word' }}>{textContent}</pre>
        {Array.isArray(content) &&
          content
            .filter((b: any) => b.type === 'thinking' || b.type === 'tool_use')
            .map((block: any, i: number) => (
              <ContentBlock key={i} block={block} />
            ))}
      </div>
    </div>
  )
}

function ContentBlock({ block }: { block: any }) {
  if (block.type === 'thinking') {
    return (
      <details className="thinking-block">
        <summary className="thinking-header">Thinking...</summary>
        <div className="thinking-content">{block.thinking}</div>
      </details>
    )
  }
  if (block.type === 'tool_use') {
    return (
      <details className="tool-block">
        <summary className="tool-header">Tool: {block.name}</summary>
        <div className="tool-content">
          <pre>{JSON.stringify(block.input, null, 2)}</pre>
        </div>
      </details>
    )
  }
  return null
}

function TerminalPane({ project, realPath }: { project: string; realPath: string }) {
  const terminalRef = React.useRef<HTMLDivElement>(null)
  const xtermRef = React.useRef<any>(null)

  React.useEffect(() => {
    let term: any = null
    let fitAddon: any = null
    let cleanupData: (() => void) | null = null
    let cleanupExited: (() => void) | null = null

    const init = async () => {
      const { Terminal } = await import('@xterm/xterm')
      const { FitAddon } = await import('@xterm/addon-fit')
      await import('@xterm/xterm/css/xterm.css')

      term = new Terminal({
        theme: {
          background: '#11111b',
          foreground: '#cdd6f4',
          cursor: '#f5e0dc',
          selectionBackground: '#45475a'
        },
        fontSize: 14,
        fontFamily: 'Consolas, Monaco, monospace',
        cursorBlink: true
      })

      fitAddon = new FitAddon()
      term.loadAddon(fitAddon)

      if (terminalRef.current) {
        term.open(terminalRef.current)
        fitAddon.fit()
      }

      xtermRef.current = term

      // Write incoming PTY data
      cleanupData = window.electronAPI.onPtyData((payload) => {
        if (payload.projectSanitizedName === project) {
          term?.write(payload.data)
        }
      })

      cleanupExited = window.electronAPI.onPtyExited((payload) => {
        if (payload.projectSanitizedName === project) {
          term?.write('\r\n\x1b[90m[Process exited]\x1b[0m\r\n')
        }
      })

      // Send user input
      term.onData((data: string) => {
        window.electronAPI.ptyWrite(project, data)
      })

      // Handle resize
      const observer = new ResizeObserver(() => {
        if (fitAddon) {
          try { fitAddon.fit() } catch {}
          const cols = term?.cols || 80
          const rows = term?.rows || 24
          window.electronAPI.ptyResize(project, cols, rows)
        }
      })
      if (terminalRef.current) {
        observer.observe(terminalRef.current)
      }
    }

    init()

    return () => {
      cleanupData?.()
      cleanupExited?.()
      term?.dispose()
    }
  }, [project])

  return (
    <div className="terminal-pane">
      <div className="terminal-header">
        <span>Terminal — {realPath}</span>
      </div>
      <div className="terminal-container" ref={terminalRef} />
    </div>
  )
}
