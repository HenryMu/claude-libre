import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { SessionMeta, ActiveProcess, JsonlLine, SessionDetailsPayload } from '../../../shared/types'
import type { TabType } from '../App'
import type { ConnectionInfo } from '../hooks/useClaudeManager'

// ===== Slash commands =====

interface SlashCommand {
  cmd: string
}

const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: '/model' }, { cmd: '/effort' }, { cmd: '/clear' }, { cmd: '/compact' },
  { cmd: '/cost' }, { cmd: '/status' }, { cmd: '/context' }, { cmd: '/diff' },
  { cmd: '/memory' }, { cmd: '/plan' }, { cmd: '/help' }, { cmd: '/skills' },
  { cmd: '/config' }, { cmd: '/permissions' }, { cmd: '/export' }, { cmd: '/fast' },
  { cmd: '/resume' }, { cmd: '/rename' }, { cmd: '/branch' }, { cmd: '/copy' },
  { cmd: '/mcp' }, { cmd: '/doctor' },
]

const MODEL_OPTIONS = [
  { label: 'Sonnet', value: 'sonnet' },
  { label: 'Opus', value: 'opus' },
  { label: 'Haiku', value: 'haiku' },
]

const EFFORT_OPTIONS = [
  { label: 'Auto', value: 'auto' },
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'Max', value: 'max' },
]

interface ProjectData {
  sanitizedName: string
  realPath: string
  sessions: SessionMeta[]
}

interface SessionState {
  projects: ProjectData[]
  pendingSessions: Map<string, SessionMeta>
  selectedProject: string | null
  selectedSession: string | null
  selectProject: (name: string) => void
  selectSession: (project: string, sessionId: string) => void
  sessionDetails: SessionDetailsPayload | null
}

interface ClaudeState {
  activeProcesses: ActiveProcess[]
  connections: Map<string, ConnectionInfo>
  connect: (project: string, sessionId: string) => Promise<string | null>
  connectNew: (project: string) => Promise<string | null>
  disconnect: (processKey: string) => Promise<void>
  isConnected: (sessionId: string | null) => boolean
  getProcessKey: (sessionId: string | null) => string | null
  activeCount: number
  maxConnections: number
}

interface MainContentProps {
  sessionState: SessionState
  claudeState: ClaudeState
  activeTab: TabType
  onTabChange: (tab: TabType) => void
  newSessionProcessKey: string | null
}

export default function MainContent({ sessionState, claudeState, activeTab, onTabChange, newSessionProcessKey }: MainContentProps) {
  const { t } = useTranslation()
  const { selectedProject, selectedSession, sessionDetails, projects } = sessionState
  const project = projects.find((p) => p.sanitizedName === selectedProject)

  // Determine connection state for the selected session
  const isSelectedConnected = claudeState.isConnected(selectedSession)
  const selectedProcessKey = claudeState.getProcessKey(selectedSession)
  const isPending = selectedSession?.startsWith('__pending_') || false

  // For new session, the terminal uses newSessionProcessKey
  const terminalProcessKey = newSessionProcessKey || selectedProcessKey
  const terminalConnected = !!newSessionProcessKey || isSelectedConnected

  if (!selectedProject || !project) {
    return (
      <div className="main-content">
        <div className="empty-state">{t('conversation.selectProject')}</div>
      </div>
    )
  }

  return (
    <div className="main-content">
      <div className="tab-bar">
        <button
          className={`tab-item ${activeTab === 'conversation' ? 'active' : ''}`}
          onClick={() => onTabChange('conversation')}
        >
          {t('tabs.conversation')}
        </button>
        <button
          className={`tab-item ${activeTab === 'terminal' ? 'active' : ''}`}
          onClick={() => onTabChange('terminal')}
        >
          {t('tabs.terminal')}
        </button>
      </div>

      <div className="tab-content">
        <div style={{ display: activeTab === 'conversation' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
          <ConversationTab
            project={selectedProject}
            realPath={project.realPath}
            selectedSession={selectedSession}
            sessionDetails={sessionDetails}
            isConnected={isSelectedConnected}
            processKey={selectedProcessKey}
            isPending={isPending}
            claudeState={claudeState}
          />
        </div>
        <div style={{ display: activeTab === 'terminal' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
          <TerminalTab
            project={selectedProject}
            realPath={project.realPath}
            isConnected={terminalConnected}
            processKey={terminalProcessKey}
            isPending={false}
            selectedSession={selectedSession}
            claudeState={claudeState}
          />
        </div>
      </div>
    </div>
  )
}

// ===== Conversation Tab =====

function ConversationTab({ project, realPath, selectedSession, sessionDetails, isConnected, processKey, isPending, claudeState }: {
  project: string
  realPath: string
  selectedSession: string | null
  sessionDetails: SessionDetailsPayload | null
  isConnected: boolean
  processKey: string | null
  isPending: boolean
  claudeState: ClaudeState
}) {
  const { t } = useTranslation()
  const [inputValue, setInputValue] = useState('')
  const [permissionPrompt, setPermissionPrompt] = useState<string | null>(null)
  const [permissionCountdown, setPermissionCountdown] = useState(0)
  const [permissionFailed, setPermissionFailed] = useState(false)
  const [manualInput, setManualInput] = useState('')
  const [isThinking, setIsThinking] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const prevAssistantCount = useRef(0)

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [sessionDetails, isThinking])

  // Reset on session change
  useEffect(() => {
    setIsThinking(false)
    setPermissionPrompt(null)
    setConnectError(null)
    prevAssistantCount.current = 0
  }, [selectedSession])

  // Detect new assistant message → stop thinking
  useEffect(() => {
    if (!sessionDetails) return
    const count = sessionDetails.lines.filter(l => l.type === 'assistant').length
    if (count > prevAssistantCount.current) setIsThinking(false)
    prevAssistantCount.current = count
  }, [sessionDetails])

  // Start thinking on new user message from any source
  useEffect(() => {
    const unsub = window.electronAPI.onSessionUpdated((data) => {
      if (data.sessionId !== selectedSession) return
      const hasUser = data.newLines.some(l => l.type === 'user')
      const hasAssistant = data.newLines.some(l => l.type === 'assistant')
      if (hasUser && !hasAssistant) setIsThinking(true)
    })
    return unsub
  }, [selectedSession])

  // Permission events — filtered by processKey
  useEffect(() => {
    const unsub1 = window.electronAPI.onPermissionPrompt((payload) => {
      if (payload.processKey !== processKey) return
      setPermissionPrompt(payload.prompt)
      setPermissionCountdown(Math.round(payload.timeout / 1000))
      setPermissionFailed(false)
      setManualInput('')
    })
    const unsub2 = window.electronAPI.onPermissionClear((payload) => {
      if (payload.processKey !== processKey) return
      setPermissionPrompt(null)
      setPermissionCountdown(0)
      setPermissionFailed(false)
      if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null }
    })
    const unsub3 = window.electronAPI.onPermissionFailed((payload) => {
      if (payload.processKey !== processKey) return
      setPermissionFailed(true)
    })
    return () => { unsub1(); unsub2(); unsub3() }
  }, [processKey])

  // Countdown
  useEffect(() => {
    if (permissionPrompt && permissionCountdown > 0) {
      countdownRef.current = setInterval(() => {
        setPermissionCountdown((prev) => {
          if (prev <= 1) { if (countdownRef.current) clearInterval(countdownRef.current); return 0 }
          return prev - 1
        })
      }, 1000)
      return () => { if (countdownRef.current) clearInterval(countdownRef.current) }
    }
  }, [permissionPrompt])

  const handlePermissionResponse = (response: string) => {
    if (!processKey) return
    window.electronAPI.respondPermission(processKey, response)
    setPermissionPrompt(null)
    setPermissionCountdown(0)
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null }
  }

  const handleManualSend = () => {
    const text = manualInput.trim()
    if (!text || !processKey) return
    window.electronAPI.ptyWrite(processKey, text + '\r')
    setManualInput('')
    setPermissionPrompt(null)
    setPermissionCountdown(0)
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null }
  }

  // Connect button
  const handleConnect = async () => {
    setConnectError(null)
    let pk: string | null = null
    if (isPending) {
      pk = await claudeState.connectNew(project)
    } else if (selectedSession) {
      pk = await claudeState.connect(project, selectedSession)
    }
    if (!pk) {
      setConnectError('Failed to connect. Check if max sessions (3) reached.')
    }
  }

  // Disconnect button
  const handleDisconnect = async () => {
    if (processKey) await claudeState.disconnect(processKey)
  }

  // Send message
  const handleSend = () => {
    const text = inputValue.trim()
    if (!text || !processKey) return
    window.electronAPI.ptyWrite(processKey, text + '\r')
    setInputValue('')
    setIsThinking(true)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
    if (e.key === 'Escape') { setShowCommands(false) }
  }

  // Slash command autocomplete
  const [showCommands, setShowCommands] = useState(false)
  const [filteredCommands, setFilteredCommands] = useState<SlashCommand[]>([])
  const [activeCmdIndex, setActiveCmdIndex] = useState(0)

  useEffect(() => {
    const trimmed = inputValue.trim()
    if (trimmed.startsWith('/')) {
      const query = trimmed.toLowerCase()
      const filtered = SLASH_COMMANDS.filter(c => c.cmd.toLowerCase().startsWith(query))
      setFilteredCommands(filtered)
      setActiveCmdIndex(0)
      setShowCommands(filtered.length > 0)
    } else {
      setShowCommands(false)
    }
  }, [inputValue])

  const selectCommand = useCallback((cmd: string) => {
    setInputValue(cmd + ' ')
    setShowCommands(false)
  }, [])

  useEffect(() => {
    if (!showCommands) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      // Don't close if clicking inside autocomplete
      if (cmdListRef.current?.contains(target)) return
      setShowCommands(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showCommands])

  const cmdListRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (inputValue) { setPermissionPrompt(null); setPermissionCountdown(0) } }, [inputValue])

  if (!selectedSession) {
    return (
      <div className="tab-pane">
        <div className="empty-state">{t('conversation.selectSession')}</div>
      </div>
    )
  }

  // Messages
  const allMessages = (sessionDetails?.lines || []).filter(l => l.type === 'user' || l.type === 'assistant')
  const messages = allMessages.filter((msg) => {
    if (msg.type === 'user') {
      const content = msg.message?.content
      if (typeof content === 'string') return content.trim().length > 0
      if (Array.isArray(content)) return content.some((b: any) => b.type === 'text' && b.text?.trim())
      return false
    }
    return true
  })

  return (
    <div className="tab-pane history-pane">
      <div className="history-messages">
        {isPending && !isConnected ? (
          <div className="empty-state" style={{ padding: 40 }}>
            <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>{t('conversation.newSessionNotConnected')}</p>
            <button className="btn btn-connect" onClick={handleConnect}>{t('conversation.connectStart')}</button>
            {connectError && <p style={{ color: 'var(--danger)', marginTop: 8, fontSize: 12 }}>{connectError}</p>}
          </div>
        ) : messages.length === 0 && !isConnected ? (
          <div className="empty-state" style={{ padding: 40 }}>
            <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>{t('conversation.noMessagesConnect')}</p>
            <button className="btn btn-connect" onClick={handleConnect}>{t('conversation.connect')}</button>
            {connectError && <p style={{ color: 'var(--danger)', marginTop: 8, fontSize: 12 }}>{connectError}</p>}
          </div>
        ) : (
          <>
            {messages.map((msg, i) => (
              <MessageItem key={msg.uuid || i} line={msg} project={project} />
            ))}

            {isThinking && (
              <div className="thinking-indicator">
                <div className="thinking-dots">
                  <span className="thinking-dot" /><span className="thinking-dot" /><span className="thinking-dot" />
                </div>
                <span className="thinking-label">{t('conversation.thinking')}</span>
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Connection control bar */}
      {!isConnected && !isPending && selectedSession && !selectedSession.startsWith('__pending_') && (
        <div className="connect-bar">
          <span className="connect-bar-text">{t('conversation.notConnected')}</span>
          <button className="btn btn-connect" onClick={handleConnect}>
            {t('conversation.connect')} ({claudeState.activeCount}/{claudeState.maxConnections})
          </button>
          {connectError && <span className="connect-error">{connectError}</span>}
        </div>
      )}
      {isConnected && processKey && (
        <div className="connect-bar connect-bar-active">
          <span className="connect-bar-text">{t('conversation.connected')}</span>
          <button className="btn btn-disconnect" onClick={handleDisconnect}>{t('conversation.disconnect')}</button>
        </div>
      )}

      {/* Permission prompt bar */}
      {permissionPrompt && processKey && (
        <div className={`permission-bar ${permissionFailed ? 'permission-bar-failed' : ''}`}>
          <div className="permission-bar-top">
            <span className="permission-text">{permissionPrompt}</span>
            {permissionFailed ? (
              <span className="permission-failed-badge">Auto-response failed</span>
            ) : (
              <span className="permission-countdown">{permissionCountdown}s</span>
            )}
          </div>
          <div className="permission-bar-actions">
            {!permissionFailed && (
              <div className="permission-actions">
                <button className="btn btn-allow" onClick={() => handlePermissionResponse('y')}>Allow (y)</button>
                <button className="btn btn-allow" onClick={() => handlePermissionResponse('a')}>Always (a)</button>
                <button className="btn btn-deny" onClick={() => handlePermissionResponse('n')}>Deny (n)</button>
              </div>
            )}
            <div className="permission-manual">
              <input type="text" className="permission-manual-input"
                placeholder={permissionFailed ? "Type y/n and Enter..." : "Manual input..."}
                value={manualInput} onChange={(e) => setManualInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleManualSend() }}
                autoFocus={permissionFailed} />
              <button className="btn btn-manual" onClick={handleManualSend}>Send</button>
            </div>
          </div>
          {permissionFailed && <div className="permission-hint">Auto-response failed. Type y/n above or switch to Terminal tab.</div>}
        </div>
      )}

      {/* Input bar */}
      <div className="input-bar">
        <InputToolbar processKey={processKey} isConnected={isConnected} t={t} />
        <div style={{ position: 'relative', flex: 1 }}>
          <input type="text" className="chat-input"
            placeholder={isConnected ? t('conversation.inputPlaceholder') : t('conversation.inputPlaceholderOffline')}
            value={inputValue} onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (showCommands && filteredCommands.length > 0) {
                if (e.key === 'ArrowDown') { e.preventDefault(); setActiveCmdIndex(i => (i + 1) % filteredCommands.length); return }
                if (e.key === 'ArrowUp') { e.preventDefault(); setActiveCmdIndex(i => (i - 1 + filteredCommands.length) % filteredCommands.length); return }
                if (e.key === 'Tab') { e.preventDefault(); selectCommand(filteredCommands[activeCmdIndex].cmd); return }
              }
              handleKeyDown(e)
            }}
            disabled={!isConnected} />
          {/* Command autocomplete */}
          {showCommands && filteredCommands.length > 0 && (
            <div ref={cmdListRef} className="command-autocomplete">
              {filteredCommands.map((cmd, i) => (
                <div
                  key={cmd.cmd}
                  className={`command-item ${i === activeCmdIndex ? 'command-item-active' : ''}`}
                  onMouseDown={(e) => { e.preventDefault(); selectCommand(cmd.cmd) }}
                  onMouseEnter={() => setActiveCmdIndex(i)}
                >
                  <span className="command-name">{cmd.cmd}</span>
                  <span className="command-desc">{t(`commands.${cmd.cmd}` as any, cmd.cmd)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <button className="btn" onClick={handleSend} disabled={!inputValue.trim() || !isConnected}>{t('conversation.send')}</button>
      </div>
    </div>
  )
}

// ===== Terminal Tab =====

function TerminalTab({ project, realPath, isConnected, processKey, isPending, selectedSession, claudeState }: {
  project: string
  realPath: string
  isConnected: boolean
  processKey: string | null
  isPending: boolean
  selectedSession: string | null
  claudeState: ClaudeState
}) {
  if (!isConnected || !processKey) {
    return (
      <div className="tab-pane">
        <div className="empty-state">
          <div>
            <p style={{ marginBottom: 16 }}>
              {isPending ? 'New session — not connected yet' : 'Session not connected'}
            </p>
            <button className="btn btn-connect" onClick={async () => {
              if (isPending) await claudeState.connectNew(project)
              else if (selectedSession) await claudeState.connect(project, selectedSession)
            }}>
              Connect
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="tab-pane">
      <TerminalPane processKey={processKey} project={project} />
    </div>
  )
}

// ===== xterm.js Terminal Pane =====

function TerminalPane({ processKey, project }: { processKey: string; project: string }) {
  const terminalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let term: any = null
    let fitAddon: any = null
    let cleanupData: (() => void) | null = null
    let cleanupExited: (() => void) | null = null

    const init = async () => {
      const { Terminal } = await import('@xterm/xterm')
      const { FitAddon } = await import('@xterm/addon-fit')
      await import('@xterm/xterm/css/xterm.css')

      term = new Terminal({
        theme: { background: '#11111b', foreground: '#cdd6f4', cursor: '#f5e0dc', selectionBackground: '#45475a' },
        fontSize: 14, fontFamily: 'Consolas, Monaco, monospace', cursorBlink: true
      })
      fitAddon = new FitAddon()
      term.loadAddon(fitAddon)

      if (terminalRef.current) { term.open(terminalRef.current); fitAddon.fit() }

      cleanupData = window.electronAPI.onPtyData((payload) => {
        if (payload.processKey === processKey) term?.write(payload.data)
      })

      cleanupExited = window.electronAPI.onPtyExited((payload) => {
        if (payload.processKey === processKey) term?.write('\r\n\x1b[90m[Process exited]\x1b[0m\r\n')
      })

      term.onData((data: string) => {
        window.electronAPI.ptyWrite(processKey, data)
      })

      const observer = new ResizeObserver(() => {
        if (fitAddon) {
          try { fitAddon.fit() } catch {}
          const cols = term?.cols || 80
          const rows = term?.rows || 24
          window.electronAPI.ptyResize(processKey, cols, rows)
        }
      })
      if (terminalRef.current) observer.observe(terminalRef.current)
    }

    init()
    return () => { cleanupData?.(); cleanupExited?.(); term?.dispose() }
  }, [processKey])

  return (
    <div className="terminal-pane">
      <div className="terminal-container" ref={terminalRef} />
    </div>
  )
}

// ===== Message rendering =====

function extractToolPairs(content: any[]): { toolUse: any; toolResult?: any }[] {
  const toolUseBlocks = content.filter((b: any) => b.type === 'tool_use')
  const toolResultBlocks = content.filter((b: any) => b.type === 'tool_result')
  const resultMap = new Map<string, any>()
  for (const r of toolResultBlocks) resultMap.set(r.tool_use_id, r)
  return toolUseBlocks.map((tu: any) => ({ toolUse: tu, toolResult: resultMap.get(tu.id) }))
}

function getToolSummary(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Bash': return `$ ${input.command || ''}`
    case 'Read': return `${input.file_path || ''}${input.offset ? `:${input.offset}-${input.limit ? Number(input.offset) + Number(input.limit) : ''}` : ''}`
    case 'Write': return `${input.file_path || ''}`
    case 'Edit': return `${input.file_path || ''}`
    case 'Glob': return `${input.pattern || ''}`
    case 'Grep': return `"${input.pattern || ''}" in ${input.glob || 'all files'}`
    case 'Agent': return `${input.description || ''}`
    case 'TaskCreate': case 'TaskUpdate': case 'TaskGet': case 'TaskList': return `${input.subject || input.taskId || ''}`
    default: return ''
  }
}

function getToolResultText(result: any): string {
  if (!result) return ''
  const content = result.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
  return ''
}

function getToolIcon(name: string): string {
  switch (name) {
    case 'Bash': return '⌨'; case 'Read': return '📄'; case 'Write': return '✏'; case 'Edit': return '✎'
    case 'Glob': return '🔍'; case 'Grep': return '🔍'; case 'Agent': return '⚙'; default: return '▸'
  }
}

function MessageItem({ line, project }: { line: JsonlLine; project: string }) {
  const role = line.message?.role || line.type
  const content = line.message?.content
  let textContent: string = ''
  if (typeof content === 'string') textContent = content
  else if (Array.isArray(content)) textContent = content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')

  const toolPairs = Array.isArray(content) ? extractToolPairs(content) : []
  const thinkingBlocks = Array.isArray(content) ? content.filter((b: any) => b.type === 'thinking') : []
  if (!textContent.trim() && toolPairs.length === 0 && thinkingBlocks.length === 0) return null

  return (
    <div className={`message message-${role}`}>
      <div className={`message-role ${role === 'user' ? 'role-user' : 'role-assistant'}`}>
        {role === 'user' ? 'You' : 'Claude'}
      </div>
      <div className="message-content">
        {textContent.trim() && <pre className="message-text">{textContent}</pre>}
        {thinkingBlocks.map((block: any, i: number) => (
          <details key={`think-${i}`} className="thinking-block">
            <summary className="thinking-header">Thinking...</summary>
            <div className="thinking-content">{block.thinking}</div>
          </details>
        ))}
        {toolPairs.map((pair, i) => (
          <ToolCall key={`tool-${i}`} name={pair.toolUse.name} input={pair.toolUse.input} result={pair.toolResult} project={project} />
        ))}
      </div>
    </div>
  )
}

function ToolCall({ name, input, result, project }: {
  name: string; input: Record<string, unknown>; result?: any; project: string
}) {
  const [expanded, setExpanded] = useState(false)
  const summary = getToolSummary(name, input)
  const resultText = getToolResultText(result)
  const icon = getToolIcon(name)
  const hasResult = resultText.length > 0
  const isError = result?.is_error

  return (
    <div className={`tool-call ${isError ? 'tool-error' : ''}`}>
      <div className="tool-call-header" onClick={() => setExpanded(!expanded)}>
        <span className="tool-icon">{icon}</span>
        <span className="tool-name">{name}</span>
        <span className="tool-summary">{summary}</span>
        <span className="tool-expand">{expanded ? '▾' : '▸'}</span>
      </div>
      {expanded && (
        <div className="tool-call-detail">
          {name === 'Bash' && input.command && <pre className="tool-command">{input.command as string}</pre>}
          {name === 'Edit' && input.old_string && (
            <div className="tool-edit">
              <div className="tool-edit-label">Replace:</div>
              <pre className="tool-code">{(input.old_string as string).slice(0, 500)}</pre>
              <div className="tool-edit-label">With:</div>
              <pre className="tool-code">{(input.new_string as string).slice(0, 500)}</pre>
            </div>
          )}
          {name === 'Write' && input.content && <pre className="tool-code">{(input.content as string).slice(0, 500)}</pre>}
        </div>
      )}
      {hasResult && (
        <div className={`tool-result ${expanded ? '' : 'tool-result-collapsed'}`}>
          <pre>{resultText.slice(0, expanded ? Infinity : 200)}</pre>
        </div>
      )}
    </div>
  )
}

// ===== Input Toolbar (Model + Effort selectors) =====

function InputToolbar({ processKey, isConnected, t }: {
  processKey: string | null
  isConnected: boolean
  t: (key: string) => string
}) {
  const [modelOpen, setModelOpen] = useState(false)
  const [effortOpen, setEffortOpen] = useState(false)
  const modelRef = useRef<HTMLDivElement>(null)
  const effortRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) setModelOpen(false)
      if (effortRef.current && !effortRef.current.contains(e.target as Node)) setEffortOpen(false)
    }
    if (modelOpen || effortOpen) {
      document.addEventListener('mousedown', handler)
      return () => document.removeEventListener('mousedown', handler)
    }
  }, [modelOpen, effortOpen])

  const sendCommand = (cmd: string) => {
    if (!processKey || !isConnected) return
    window.electronAPI.ptyWrite(processKey, cmd + '\r')
  }

  return (
    <div className="input-toolbar">
      <div ref={modelRef} className="toolbar-selector">
        <button
          className="toolbar-btn"
          onClick={() => { setModelOpen(!modelOpen); setEffortOpen(false) }}
          disabled={!isConnected}
          title={t('toolbar.model')}
        >
          <span className="toolbar-btn-icon">🧠</span>
          <span className="toolbar-btn-label">{t('toolbar.model')}</span>
          <span className="toolbar-btn-arrow">▾</span>
        </button>
        {modelOpen && (
          <div className="toolbar-dropdown">
            {MODEL_OPTIONS.map(opt => (
              <button
                key={opt.value}
                className="toolbar-dropdown-item"
                onMouseDown={(e) => { e.preventDefault(); sendCommand(`/model ${opt.value}`); setModelOpen(false) }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div ref={effortRef} className="toolbar-selector">
        <button
          className="toolbar-btn"
          onClick={() => { setEffortOpen(!effortOpen); setModelOpen(false) }}
          disabled={!isConnected}
          title={t('toolbar.effort')}
        >
          <span className="toolbar-btn-icon">💡</span>
          <span className="toolbar-btn-label">{t('toolbar.effort')}</span>
          <span className="toolbar-btn-arrow">▾</span>
        </button>
        {effortOpen && (
          <div className="toolbar-dropdown">
            {EFFORT_OPTIONS.map(opt => (
              <button
                key={opt.value}
                className="toolbar-dropdown-item"
                onMouseDown={(e) => { e.preventDefault(); sendCommand(`/effort ${opt.value}`); setEffortOpen(false) }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
