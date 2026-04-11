import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import { useTranslation } from 'react-i18next'
import type { SessionMeta, ActiveProcess, JsonlLine, SessionDetailsPayload, FileNode, CodeViewContext, ToolResultBlock, ToolUseBlock, ContentBlock, PermissionPromptPayload, ImageAttachment } from '../../../shared/types'
import type { TabType } from '../App'
import type { ConnectionInfo } from '../hooks/useClaudeManager'

// ===== Slash commands =====

interface SlashCommand {
  cmd: string
}

interface FileMentionItem {
  name: string
  relativePath: string
  fullPath: string
}

interface AutocompleteItem {
  key: string
  primary: string
  secondary: string
  kind: 'command' | 'file'
  value: string
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
  openProject: (name: string) => void
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
}

interface MainContentProps {
  sessionState: SessionState
  claudeState: ClaudeState
  activeTab: TabType
  onTabChange: (tab: TabType) => void
  newSessionProcessKey: string | null
  onStartConversation: (project: string, message: string, model: string) => Promise<void>
  onAddProject: () => Promise<{ sanitizedName: string; realPath: string } | null>
  codeViewContext: CodeViewContext | null
  onViewInCode: (filePath: string, oldContent: string, newContent: string) => void
  onClearCodeView: () => void
}

type TurnStatus = 'idle' | 'thinking' | 'running_tools' | 'planning'
type ConversationState = TurnStatus | 'waiting_permission'

interface TurnPiece {
  id: string
  kind: 'text' | 'thinking' | 'tool'
  text?: string
  toolId?: string
}

interface NormalizedToolCall {
  id: string
  name: string
  input: Record<string, unknown>
  result?: ToolResultBlock | null
  isPlanTool: boolean
}

interface NormalizedTurn {
  id: string
  userText: string
  pieces: TurnPiece[]
  toolCalls: NormalizedToolCall[]
  startedAt?: string
  durationMs?: number
  isUserInitiated: boolean
  status: TurnStatus
}

interface ExtractedLineContent {
  textSegments: string[]
  thinkingSegments: string[]
  toolUses: ToolUseBlock[]
  toolResults: ToolResultBlock[]
}

const PLAN_TOOL_NAMES = new Set([
  'ExitPlanMode',
  'AskUserQuestion',
  'TaskCreate',
  'TaskUpdate',
  'TaskGet',
  'TaskList',
])

const MARKDOWN_COMPONENTS = {
  a: ({ ...props }: any) => <a {...props} target="_blank" rel="noreferrer" />,
  code: ({ className, children, ...props }: any) => {
    const isBlock = Boolean(className)
    if (isBlock) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      )
    }

    return (
      <code className="inline-code" {...props}>
        {children}
      </code>
    )
  }
}

function flattenFileNodes(nodes: FileNode[], basePath: string): FileMentionItem[] {
  const result: FileMentionItem[] = []

  const walk = (items: FileNode[]) => {
    for (const item of items) {
      if (item.isDir) {
        if (item.children?.length) walk(item.children)
        continue
      }
      const relativePath = item.path
        .replace(basePath, '')
        .replace(/^[/\\]/, '')
      result.push({
        name: item.name,
        relativePath,
        fullPath: item.path,
      })
    }
  }

  walk(nodes)
  return result
}

function normalizePathForPrompt(filePath: string): string {
  return filePath.replace(/\\/g, '/')
}

function toMentionPath(filePath: string, projectRoot: string): string {
  const normalizedFile = normalizePathForPrompt(filePath)
  const normalizedRoot = normalizePathForPrompt(projectRoot).replace(/\/$/, '')
  if (normalizedFile.startsWith(`${normalizedRoot}/`)) {
    return normalizedFile.slice(normalizedRoot.length + 1)
  }
  return normalizedFile
}

function escapeMentionPath(filePath: string): string {
  return filePath.replace(/\\/g, '\\\\').replace(/([\s"'])/g, '\\$1')
}

function formatMentionToken(filePath: string, projectRoot: string): string {
  return `@${escapeMentionPath(toMentionPath(filePath, projectRoot))}`
}

function scoreFileMention(item: FileMentionItem, query: string): number {
  if (!query) return item.relativePath.length

  const q = query.toLowerCase()
  const path = item.relativePath.toLowerCase()
  const name = item.name.toLowerCase()

  if (path === q) return 0
  if (name === q) return 1
  if (name.startsWith(q)) return 2
  if (path.startsWith(q)) return 3
  if (name.includes(q)) return 4
  if (path.includes(q)) return 5
  return 9999
}

function getMentionQuery(value: string, caretIndex: number): { query: string; start: number; end: number } | null {
  const beforeCaret = value.slice(0, caretIndex)
  const match = beforeCaret.match(/(?:^|\s)@([^\s@]*)$/)
  if (!match) return null

  const query = match[1] || ''
  const start = beforeCaret.length - query.length - 1
  return {
    query,
    start,
    end: caretIndex,
  }
}

function isPlanTool(name: string, input: Record<string, unknown>): boolean {
  if (PLAN_TOOL_NAMES.has(name)) return true
  return name === 'Write' && typeof input.file_path === 'string' && String(input.file_path).includes('/.claude/plans/')
}

function extractLineContent(content: string | ContentBlock[] | undefined): ExtractedLineContent {
  const extracted: ExtractedLineContent = {
    textSegments: [],
    thinkingSegments: [],
    toolUses: [],
    toolResults: [],
  }

  if (typeof content === 'string') {
    if (content.trim()) extracted.textSegments.push(content)
    return extracted
  }

  if (!Array.isArray(content)) return extracted

  for (const block of content) {
    if (!block || typeof block !== 'object' || !('type' in block)) continue

    switch (block.type) {
      case 'text':
        if (typeof block.text === 'string' && block.text.trim()) extracted.textSegments.push(block.text)
        break
      case 'thinking':
        if (typeof block.thinking === 'string' && block.thinking.trim()) extracted.thinkingSegments.push(block.thinking)
        break
      case 'tool_use':
        extracted.toolUses.push(block)
        break
      case 'tool_result':
        extracted.toolResults.push(block)
        break
      default:
        break
    }
  }

  return extracted
}

function appendTurnPiece(turn: NormalizedTurn, piece: TurnPiece): void {
  if (piece.kind === 'text') {
    const nextText = piece.text?.trim()
    if (!nextText) return
    const lastPiece = turn.pieces[turn.pieces.length - 1]
    if (lastPiece?.kind === 'text' && lastPiece.text) {
      lastPiece.text = `${lastPiece.text}\n\n${nextText}`
      return
    }
  }

  turn.pieces.push(piece)
}

function createTurn(line: JsonlLine, isUserInitiated: boolean): NormalizedTurn {
  return {
    id: line.uuid || `turn-${Date.now()}`,
    userText: '',
    pieces: [],
    toolCalls: [],
    startedAt: line.timestamp,
    isUserInitiated,
    status: 'idle',
  }
}

function deriveTurnStatus(turn: NormalizedTurn): TurnStatus {
  const hasUserText = turn.userText.trim().length > 0
  const hasAssistantText = turn.pieces.some((piece) => piece.kind === 'text' && piece.text?.trim())
  const hasThinking = turn.pieces.some((piece) => piece.kind === 'thinking' && piece.text?.trim())
  const hasPlanTools = turn.toolCalls.some((tool) => tool.isPlanTool)
  const hasPendingTools = turn.toolCalls.some((tool) => !tool.result)

  if (hasPlanTools && (hasPendingTools || (!hasAssistantText && !turn.durationMs))) return 'planning'
  if (hasPendingTools) return 'running_tools'
  if ((hasUserText && !hasAssistantText && turn.toolCalls.length === 0) || (hasThinking && !hasAssistantText && !turn.durationMs)) return 'thinking'
  return 'idle'
}

function normalizeSessionLines(lines: JsonlLine[]): NormalizedTurn[] {
  const turns: NormalizedTurn[] = []
  let currentTurn: NormalizedTurn | null = null
  let toolMap = new Map<string, NormalizedToolCall>()

  const flushTurn = () => {
    if (!currentTurn) return
    currentTurn.status = deriveTurnStatus(currentTurn)
    if (currentTurn.userText.trim() || currentTurn.pieces.length > 0) turns.push(currentTurn)
    currentTurn = null
    toolMap = new Map()
  }

  const ensureTurn = (line: JsonlLine, isUserInitiated = false) => {
    if (!currentTurn) {
      currentTurn = createTurn(line, isUserInitiated)
      toolMap = new Map()
    }
    return currentTurn
  }

  const attachToolResult = (turn: NormalizedTurn, result: ToolResultBlock) => {
    const existing = toolMap.get(result.tool_use_id)
    if (existing) {
      existing.result = result
      return
    }

    const syntheticTool: NormalizedToolCall = {
      id: result.tool_use_id,
      name: 'tool_result',
      input: {},
      result,
      isPlanTool: false,
    }
    toolMap.set(syntheticTool.id, syntheticTool)
    turn.toolCalls.push(syntheticTool)
    appendTurnPiece(turn, {
      id: `${turn.id}-tool-${turn.pieces.length}`,
      kind: 'tool',
      toolId: syntheticTool.id,
    })
  }

  for (const line of lines) {
    if (line.type === 'system') {
      if ((line as any).subtype === 'turn_duration' && currentTurn) {
        const durationMs = Number((line as any).durationMs)
        if (!Number.isNaN(durationMs) && durationMs > 0) currentTurn.durationMs = durationMs
      }
      continue
    }

    if (line.type !== 'user' && line.type !== 'assistant') continue

    const extracted = extractLineContent(line.message?.content)
    const textContent = extracted.textSegments.join('\n\n').trim()

    if (line.type === 'user') {
      if (textContent) {
        flushTurn()
        const turn = ensureTurn(line, true)
        turn.userText = textContent
      } else if (!extracted.toolResults.length) {
        continue
      }

      const turn = ensureTurn(line, Boolean(textContent))
      for (const result of extracted.toolResults) attachToolResult(turn, result)
      continue
    }

    if (!textContent && extracted.thinkingSegments.length === 0 && extracted.toolUses.length === 0 && extracted.toolResults.length === 0) {
      continue
    }

    const turn = ensureTurn(line, false)

    for (const segment of extracted.textSegments) {
      appendTurnPiece(turn, {
        id: `${turn.id}-text-${turn.pieces.length}`,
        kind: 'text',
        text: segment,
      })
    }

    for (const segment of extracted.thinkingSegments) {
      appendTurnPiece(turn, {
        id: `${turn.id}-thinking-${turn.pieces.length}`,
        kind: 'thinking',
        text: segment,
      })
    }

    for (const toolUse of extracted.toolUses) {
      const toolCall: NormalizedToolCall = {
        id: toolUse.id,
        name: toolUse.name,
        input: toolUse.input || {},
        isPlanTool: isPlanTool(toolUse.name, toolUse.input || {}),
      }
      toolMap.set(toolCall.id, toolCall)
      turn.toolCalls.push(toolCall)
      appendTurnPiece(turn, {
        id: `${turn.id}-tool-${turn.pieces.length}`,
        kind: 'tool',
        toolId: toolCall.id,
      })
    }

    for (const result of extracted.toolResults) attachToolResult(turn, result)
  }

  flushTurn()
  return turns
}

function deriveConversationState(args: {
  turns: NormalizedTurn[]
  permissionPrompt: PermissionPromptPayload | null
  optimisticThinking: boolean
  isPending: boolean
  isConnected: boolean
}): ConversationState | 'idle' {
  if (args.permissionPrompt) return 'waiting_permission'

  const lastTurn = args.turns[args.turns.length - 1]
  if (lastTurn?.status && lastTurn.status !== 'idle') return lastTurn.status

  if ((args.optimisticThinking || args.isPending) && args.isConnected) return 'thinking'
  return 'idle'
}

function formatTurnDuration(durationMs?: number): string | null {
  if (!durationMs || durationMs <= 0) return null

  if (durationMs < 1000) return `${durationMs}ms`
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)}s`

  const minutes = Math.floor(durationMs / 60_000)
  const seconds = Math.round((durationMs % 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}

export default function MainContent({
  sessionState,
  claudeState,
  activeTab,
  onTabChange,
  newSessionProcessKey,
  onStartConversation,
  onAddProject,
  codeViewContext,
  onViewInCode,
  onClearCodeView
}: MainContentProps) {
  const { t } = useTranslation()
  const { selectedProject, selectedSession, sessionDetails, projects } = sessionState
  const project = projects.find((p) => p.sanitizedName === selectedProject)

  // Determine connection state for the selected session
  const pendingProcessKey = selectedSession?.startsWith('__pending_') ? newSessionProcessKey : null
  const selectedProcessKey = claudeState.getProcessKey(selectedSession)
  const activeProcessKey = selectedProcessKey || pendingProcessKey
  const isSelectedConnected = !!activeProcessKey || claudeState.isConnected(selectedSession)
  const isPending = selectedSession?.startsWith('__pending_') || false

  // For new session, the terminal uses newSessionProcessKey
  const terminalProcessKey = activeProcessKey
  const terminalConnected = !!terminalProcessKey

  if (activeTab === 'conversation' && !selectedSession) {
    return (
      <div className="main-content">
        <div className="tab-bar">
          <button className={`tab-item ${activeTab === 'conversation' ? 'active' : ''}`} onClick={() => onTabChange('conversation')}>{t('tabs.conversation')}</button>
          <button className={`tab-item ${activeTab === 'terminal' ? 'active' : ''}`} onClick={() => onTabChange('terminal')}>{t('tabs.terminal')}</button>
          <button className={`tab-item ${activeTab === 'code' ? 'active' : ''}`} onClick={() => onTabChange('code')}>{t('tabs.code')}</button>
        </div>
        <DraftStartPane
          project={project || null}
          projects={projects}
          onSelectProject={sessionState.openProject}
          onAddProject={onAddProject}
          onStartConversation={onStartConversation}
        />
      </div>
    )
  }

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
        <button className={`tab-item ${activeTab === 'conversation' ? 'active' : ''}`} onClick={() => onTabChange('conversation')}>{t('tabs.conversation')}</button>
        <button className={`tab-item ${activeTab === 'terminal' ? 'active' : ''}`} onClick={() => onTabChange('terminal')}>{t('tabs.terminal')}</button>
        <button className={`tab-item ${activeTab === 'code' ? 'active' : ''}`} onClick={() => onTabChange('code')}>
          {t('tabs.code')}
          {codeViewContext && <span className="tab-badge" />}
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
            processKey={activeProcessKey}
            isPending={isPending}
            claudeState={claudeState}
            onViewInCode={onViewInCode}
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
        <div style={{ display: activeTab === 'code' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
          <CodeTab
            realPath={project.realPath}
            codeViewContext={codeViewContext}
            onClearCodeView={onClearCodeView}
          />
        </div>
      </div>
    </div>
  )
}

// ===== Conversation Tab =====

function DraftStartPane({
  project,
  projects,
  onSelectProject,
  onAddProject,
  onStartConversation
}: {
  project: ProjectData | null
  projects: ProjectData[]
  onSelectProject: (name: string) => void
  onAddProject: () => Promise<{ sanitizedName: string; realPath: string } | null>
  onStartConversation: (project: string, message: string, model: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [draftInput, setDraftInput] = useState('')
  const [draftModel, setDraftModel] = useState('sonnet')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [project?.sanitizedName])

  const handleSubmit = async () => {
    if (!project || !draftInput.trim() || isSubmitting) return
    setIsSubmitting(true)
    try {
      await onStartConversation(project.sanitizedName, draftInput, draftModel)
    } finally {
      setIsSubmitting(false)
    }
  }

  const hasProjects = projects.length > 0
  const projectName = project ? (project.realPath.split(/[/\\]/).pop() || project.realPath) : ''

  return (
    <div className="tab-pane draft-pane">
      <div className="draft-shell">
        <div className="draft-hero">
          <span className="draft-kicker">{t('conversation.newDraftKicker')}</span>
          <h2 className="draft-title">{t('conversation.newDraftTitle')}</h2>
          <p className="draft-subtitle">{t('conversation.newDraftSubtitle')}</p>
        </div>

        <div className="draft-card">
          <div className="draft-card-header">
            <div>
              <div className="draft-section-label">{t('conversation.workspace')}</div>
              {project ? (
                <>
                  <div className="draft-project-name">{projectName}</div>
                  <div className="draft-project-path">{project.realPath}</div>
                </>
              ) : (
                <div className="draft-project-placeholder">{t('conversation.chooseProjectHint')}</div>
              )}
            </div>
            <button
              className="btn draft-folder-btn"
              onClick={() => {
                void onAddProject().then((result) => {
                  if (result) onSelectProject(result.sanitizedName)
                })
              }}
            >
              {t('conversation.chooseFolder')}
            </button>
          </div>

          {!project && hasProjects && (
            <div className="draft-project-list">
              {projects.map((item) => (
                <button
                  key={item.sanitizedName}
                  className="draft-project-chip"
                  onClick={() => onSelectProject(item.sanitizedName)}
                >
                  <span>{item.realPath.split(/[/\\]/).pop() || item.realPath}</span>
                  <small>{item.realPath}</small>
                </button>
              ))}
            </div>
          )}

          <div className="draft-section">
            <div className="draft-section-label">{t('conversation.modelToUse')}</div>
            <div className="draft-model-row">
              {MODEL_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  className={`draft-model-chip ${draftModel === option.value ? 'active' : ''}`}
                  onClick={() => setDraftModel(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="draft-section">
            <div className="draft-section-label">{t('conversation.firstPrompt')}</div>
            <textarea
              ref={textareaRef}
              className="draft-textarea"
              placeholder={project ? t('conversation.newDraftPlaceholder') : t('conversation.newDraftPlaceholderNoProject')}
              value={draftInput}
              onChange={(e) => setDraftInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void handleSubmit()
                }
              }}
            />
          </div>

          <div className="draft-actions">
            <div className="draft-tip">
              {project ? t('conversation.newDraftTipReady', { project: projectName }) : t('conversation.newDraftTipSelect')}
            </div>
            <button
              className="btn btn-connect draft-submit-btn"
              disabled={!project || !draftInput.trim() || isSubmitting}
              onClick={() => void handleSubmit()}
            >
              {isSubmitting ? t('conversation.creatingSession') : t('conversation.sendAndCreate')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ConversationTab({ project, realPath, selectedSession, sessionDetails, isConnected, processKey, isPending, claudeState, onViewInCode }: {
  project: string
  realPath: string
  selectedSession: string | null
  sessionDetails: SessionDetailsPayload | null
  isConnected: boolean
  processKey: string | null
  isPending: boolean
  claudeState: ClaudeState
  onViewInCode: (filePath: string, oldContent: string, newContent: string) => void
}) {
  const { t } = useTranslation()
  const [inputValue, setInputValue] = useState('')
  const [permissionPrompt, setPermissionPrompt] = useState<PermissionPromptPayload | null>(null)
  const [permissionCountdown, setPermissionCountdown] = useState(0)
  const [permissionFailed, setPermissionFailed] = useState(false)
  const [manualInput, setManualInput] = useState('')
  const [optimisticThinking, setOptimisticThinking] = useState(false)
  const [systemSuccessMsg, setSystemSuccessMsg] = useState<string | null>(null)
  const [currentModel, setCurrentModel] = useState<string>('sonnet')
  const [currentEffort, setCurrentEffort] = useState<string>('medium')
  const [connectError, setConnectError] = useState<string | null>(null)
  const [fileMentions, setFileMentions] = useState<FileMentionItem[]>([])
  const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([])
  const [caretIndex, setCaretIndex] = useState(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const successMsgRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const turns = useMemo(() => normalizeSessionLines(sessionDetails?.lines || []), [sessionDetails?.lines])
  const conversationState = useMemo(
    () => deriveConversationState({
      turns,
      permissionPrompt,
      optimisticThinking,
      isPending,
      isConnected,
    }),
    [turns, permissionPrompt, optimisticThinking, isPending, isConnected]
  )

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns, conversationState, systemSuccessMsg])

  // Reset on session change
  useEffect(() => {
    setOptimisticThinking(false)
    setSystemSuccessMsg(null)
    setPermissionPrompt(null)
    setConnectError(null)
    setCurrentModel('sonnet')
    setCurrentEffort('medium')
    if (successMsgRef.current) { clearTimeout(successMsgRef.current); successMsgRef.current = null }
  }, [selectedSession])

  // Session file updated → hand control to normalized turn state
  useEffect(() => {
    if (sessionDetails) setOptimisticThinking(false)
  }, [sessionDetails?.lines.length, sessionDetails?.meta.sessionId])

  // Permission events — filtered by processKey
  useEffect(() => {
    const unsub1 = window.electronAPI.onPermissionPrompt((payload) => {
      if (payload.processKey !== processKey) return
      setPermissionPrompt(payload)
      setPermissionCountdown(Math.round(payload.timeout / 1000))
      setPermissionFailed(false)
      setManualInput('')
      setOptimisticThinking(false)
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

  // Detect system success messages from PTY (model, effort, cost, etc.)
  useEffect(() => {
    const cleanup = window.electronAPI.onPtyData((payload) => {
      if (payload.processKey !== processKey) return

      const data = payload.data
      // Match patterns for system success messages
      const patterns = [
        /Set model to/i,
        /Set effort level to/i,
        /Current session cost/i,
        /Plan-level usage/i,
        /Context window/i,
        /Cleared conversation/i,
        /Compacted conversation/i,
      ]

      const buffer = data.replace(/\x1b\[[0-9;]*m/g, '') // Remove ANSI codes

      // Parse model/effort from success messages
      const modelMatch = buffer.match(/Set model to (\S+)/i)
      if (modelMatch) {
        const model = modelMatch[1].toLowerCase()
        setCurrentModel(model.includes('sonnet') ? 'sonnet' : model.includes('opus') ? 'opus' : model.includes('haiku') ? 'haiku' : model)
      }

      const effortMatch = buffer.match(/Set effort level to (\S+)/i)
      if (effortMatch) {
        const effort = effortMatch[1].toLowerCase()
        setCurrentEffort(effort.includes('auto') ? 'auto' : effort.includes('low') ? 'low' : effort.includes('medium') ? 'medium' : effort.includes('high') ? 'high' : effort.includes('max') ? 'max' : effort)
      }

      for (const pattern of patterns) {
        if (pattern.test(buffer)) {
          setOptimisticThinking(false)
          setSystemSuccessMsg(buffer.trim())
          // Auto-hide after 3 seconds
          if (successMsgRef.current) clearInterval(successMsgRef.current)
          successMsgRef.current = setTimeout(() => {
            setSystemSuccessMsg(null)
            successMsgRef.current = null
          }, 3000)
          break
        }
      }
    })
    return cleanup
  }, [processKey])

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
  const handleSend = async () => {
    const text = inputValue.trim()
    if ((!text && pendingImages.length === 0) || !processKey) return

    setConnectError(null)

    if (pendingImages.length > 0) {
      try {
        await window.electronAPI.submitMessage({
          processKey,
          text,
          images: pendingImages
        })
        setInputValue('')
        setPendingImages([])
        setCaretIndex(0)
        setOptimisticThinking(true)
        setSystemSuccessMsg(null)
        if (successMsgRef.current) { clearTimeout(successMsgRef.current); successMsgRef.current = null }
      } catch (error) {
        const message = error instanceof Error ? error.message : '图片发送失败'
        setConnectError(message)
      }
      return
    }

    window.electronAPI.ptyWrite(processKey, text + '\r')
    setInputValue('')
    setCaretIndex(0)
    setOptimisticThinking(true)
    setSystemSuccessMsg(null)
    if (successMsgRef.current) { clearTimeout(successMsgRef.current); successMsgRef.current = null }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
    if (e.key === 'Escape') { setAutocompleteMode(null) }
  }

  // Input autocomplete
  const [autocompleteMode, setAutocompleteMode] = useState<'command' | 'file' | null>(null)
  const [autocompleteItems, setAutocompleteItems] = useState<AutocompleteItem[]>([])
  const [activeCmdIndex, setActiveCmdIndex] = useState(0)

  useEffect(() => {
    let disposed = false
    setFileMentions([])
    window.electronAPI.readDir(realPath)
      .then((nodes) => {
        if (!disposed) setFileMentions(flattenFileNodes(nodes, realPath))
      })
      .catch(() => {
        if (!disposed) setFileMentions([])
      })
    return () => { disposed = true }
  }, [realPath])

  useEffect(() => {
    const mention = getMentionQuery(inputValue, caretIndex)

    if (mention) {
      const normalizedQuery = mention.query.toLowerCase()
      const filtered = fileMentions
        .map((item) => ({ item, score: scoreFileMention(item, normalizedQuery) }))
        .filter(({ score }) => score < 9999)
        .sort((a, b) => a.score - b.score || a.item.relativePath.localeCompare(b.item.relativePath))
        .slice(0, 8)
        .map(({ item }) => ({
          key: item.fullPath,
          primary: `@${item.relativePath}`,
          secondary: item.name === item.relativePath ? 'File' : item.name,
          kind: 'file' as const,
          value: item.relativePath,
        }))
      setAutocompleteItems(filtered)
      setActiveCmdIndex(0)
      setAutocompleteMode(filtered.length > 0 ? 'file' : null)
      return
    }

    const trimmed = inputValue.trim()
    if (trimmed.startsWith('/')) {
      const query = trimmed.toLowerCase()
      const filtered = SLASH_COMMANDS
        .filter(c => c.cmd.toLowerCase().startsWith(query))
        .map((cmd) => ({
          key: cmd.cmd,
          primary: cmd.cmd,
          secondary: t(`commands.${cmd.cmd}` as any, cmd.cmd),
          kind: 'command' as const,
          value: cmd.cmd,
        }))
      setAutocompleteItems(filtered)
      setActiveCmdIndex(0)
      setAutocompleteMode(filtered.length > 0 ? 'command' : null)
    } else {
      setAutocompleteMode(null)
      setAutocompleteItems([])
    }
  }, [inputValue, fileMentions, t, caretIndex])

  const selectAutocompleteItem = useCallback((item: AutocompleteItem) => {
    if (item.kind === 'command') {
      setInputValue(item.value + ' ')
      setCaretIndex(item.value.length + 1)
      setAutocompleteMode(null)
      return
    }

    const input = inputRef.current
    const caretIndex = input?.selectionStart ?? inputValue.length
    const mention = getMentionQuery(inputValue, caretIndex)
    if (!mention) return

    const nextValue = `${inputValue.slice(0, mention.start)}@${item.value} ${inputValue.slice(mention.end)}`
    setInputValue(nextValue)
    setCaretIndex(mention.start + item.value.length + 2)
    setAutocompleteMode(null)

    requestAnimationFrame(() => {
      const nextCaret = mention.start + item.value.length + 2
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(nextCaret, nextCaret)
    })
  }, [inputValue])

  useEffect(() => {
    if (!autocompleteMode) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      // Don't close if clicking inside autocomplete
      if (cmdListRef.current?.contains(target)) return
      setAutocompleteMode(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [autocompleteMode])

  const cmdListRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (inputValue) { setPermissionPrompt(null); setPermissionCountdown(0) } }, [inputValue])

  if (!selectedSession) {
    return (
      <div className="tab-pane">
        <div className="empty-state">{t('conversation.selectSession')}</div>
      </div>
    )
  }

  return (
    <div className="tab-pane history-pane">
      <div className="history-messages">
        {isPending && !isConnected ? (
          <div className="empty-state" style={{ padding: 40 }}>
            <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>{t('conversation.newSessionNotConnected')}</p>
            <button className="btn btn-connect" onClick={handleConnect}>{t('conversation.connectStart')}</button>
            {connectError && <p style={{ color: 'var(--danger)', marginTop: 8, fontSize: 12 }}>{connectError}</p>}
          </div>
        ) : turns.length === 0 && !isConnected ? (
          <div className="empty-state" style={{ padding: 40 }}>
            <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>{t('conversation.noMessagesConnect')}</p>
            <button className="btn btn-connect" onClick={handleConnect}>{t('conversation.connect')}</button>
            {connectError && <p style={{ color: 'var(--danger)', marginTop: 8, fontSize: 12 }}>{connectError}</p>}
          </div>
        ) : (
          <>
            {isPending && isConnected && turns.length === 0 && (
              <div className="draft-pending-banner">
                <span className="thinking-label">{t('conversation.creatingSessionHint')}</span>
              </div>
            )}
            {turns.map((turn) => (
              <TurnItem key={turn.id} turn={turn} onViewInCode={onViewInCode} />
            ))}

            {conversationState !== 'idle' && conversationState !== 'waiting_permission' && !systemSuccessMsg && (
              <div className={`thinking-indicator thinking-indicator-${conversationState}`}>
                <div className="thinking-dots">
                  <span className="thinking-dot" /><span className="thinking-dot" /><span className="thinking-dot" />
                </div>
                <span className="thinking-label">
                  {conversationState === 'planning'
                    ? t('conversation.planning')
                    : conversationState === 'running_tools'
                      ? t('conversation.runningTools')
                      : t('conversation.thinking')}
                </span>
              </div>
            )}
            {systemSuccessMsg && (
              <div className="thinking-indicator system-success">
                <span className="thinking-label">✓ {systemSuccessMsg}</span>
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
          <button className="btn btn-connect" onClick={handleConnect}>{t('conversation.connect')}</button>
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
            <span className="permission-text">{permissionPrompt.prompt}</span>
            {permissionFailed ? (
              <span className="permission-failed-badge">{t('permission.failedBadge')}</span>
            ) : (
              <span className="permission-countdown">{permissionCountdown}s</span>
            )}
          </div>
          <div className="permission-bar-actions">
            {!permissionFailed && (
              <div className="permission-actions">
                {(permissionPrompt.options && permissionPrompt.options.length > 0 ? permissionPrompt.options : [
                  { label: t('permission.allow'), value: 'y', kind: 'allow' as const },
                  { label: t('permission.always'), value: 'a', kind: 'secondary' as const },
                  { label: t('permission.deny'), value: 'n', kind: 'deny' as const }
                ]).map((option) => (
                  <button
                    key={`${option.value}-${option.label}`}
                    className={`btn ${option.kind === 'deny' ? 'btn-deny' : option.kind === 'secondary' ? 'btn-secondary' : 'btn-allow'}`}
                    onClick={() => handlePermissionResponse(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
            <div className="permission-manual">
              <input type="text" className="permission-manual-input"
                placeholder={permissionFailed ? t('permission.manualPlaceholderFailed') : t('permission.manualPlaceholder')}
                value={manualInput} onChange={(e) => setManualInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleManualSend() }}
                autoFocus={permissionFailed} />
              <button className="btn btn-manual" onClick={handleManualSend}>{t('permission.send')}</button>
            </div>
          </div>
          {permissionFailed && <div className="permission-hint">{t('permission.failedHint')}</div>}
        </div>
      )}

      {/* Input bar */}
      <div className="input-bar">
        <input ref={inputRef} type="text" className="chat-input"
          placeholder={isConnected ? t('conversation.inputPlaceholder') : t('conversation.inputPlaceholderOffline')}
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value)
            setCaretIndex(e.target.selectionStart ?? e.target.value.length)
          }}
          onClick={(e) => setCaretIndex((e.target as HTMLInputElement).selectionStart ?? inputValue.length)}
          onKeyUp={(e) => setCaretIndex((e.currentTarget as HTMLInputElement).selectionStart ?? inputValue.length)}
          onSelect={(e) => setCaretIndex((e.currentTarget as HTMLInputElement).selectionStart ?? inputValue.length)}
          onKeyDown={(e) => {
            if (autocompleteMode && autocompleteItems.length > 0) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActiveCmdIndex(i => (i + 1) % autocompleteItems.length); return }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActiveCmdIndex(i => (i - 1 + autocompleteItems.length) % autocompleteItems.length); return }
              if (e.key === 'Tab') { e.preventDefault(); selectAutocompleteItem(autocompleteItems[activeCmdIndex]); return }
            }
            handleKeyDown(e)
          }}
          disabled={!isConnected} />
        {/* Command autocomplete */}
        {autocompleteMode && autocompleteItems.length > 0 && (
          <div ref={cmdListRef} className="command-autocomplete">
            {autocompleteItems.map((item, i) => (
              <div
                key={item.key}
                className={`command-item ${i === activeCmdIndex ? 'command-item-active' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); selectAutocompleteItem(item) }}
                onMouseEnter={() => setActiveCmdIndex(i)}
              >
                <div className="command-copy">
                  <span className="command-name">{item.primary}</span>
                  <span className="command-desc">{item.secondary}</span>
                </div>
                <span className="command-kind">{item.kind === 'file' ? 'FILE' : 'CMD'}</span>
              </div>
            ))}
          </div>
        )}
        <button className="btn" onClick={handleSend} disabled={(!inputValue.trim() && pendingImages.length === 0) || !isConnected}>{t('conversation.send')}</button>
        <button className="upload-btn" onClick={async () => {
          const imgs = await window.electronAPI.selectImages()
          if (imgs.length > 0) setPendingImages(prev => [...prev, ...imgs])
        }} disabled={!isConnected} title={t('conversation.uploadImage')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
        </button>
        <InputToolbar processKey={processKey} isConnected={isConnected} t={t} currentModel={currentModel} currentEffort={currentEffort} />
      </div>
      {/* Image preview strip */}
      {pendingImages.length > 0 && (
        <div className="image-preview-strip">
          {pendingImages.map((img, i) => (
            <div key={i} className="image-preview-item">
              <img src={img.dataUrl} alt={img.name} />
              <button className="image-preview-remove" onClick={() => setPendingImages(prev => prev.filter((_, idx) => idx !== i))}>✕</button>
              <span className="image-preview-name">{img.name}</span>
            </div>
          ))}
        </div>
      )}
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

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="message-markdown">
      <ReactMarkdown components={MARKDOWN_COMPONENTS}>
        {content}
      </ReactMarkdown>
    </div>
  )
}

function TurnItem({ turn, onViewInCode }: {
  turn: NormalizedTurn
  onViewInCode: (f: string, o: string, n: string) => void
}) {
  const { t } = useTranslation()
  const toolMap = useMemo(() => new Map(turn.toolCalls.map((tool) => [tool.id, tool])), [turn.toolCalls])
  const durationLabel = formatTurnDuration(turn.durationMs)

  return (
    <div className="turn-block">
      {turn.userText.trim() && (
        <div className="message message-user">
          <div className="message-role role-user">{t('conversation.you')}</div>
          <div className="message-content">
            <MarkdownContent content={turn.userText} />
          </div>
        </div>
      )}
      {turn.pieces.length > 0 && (
        <div className="message message-assistant">
          <div className="message-role role-assistant">{t('conversation.claude')}</div>
          <div className="message-content">
            {turn.pieces.map((piece) => {
              if (piece.kind === 'text' && piece.text) {
                return <MarkdownContent key={piece.id} content={piece.text} />
              }

              if (piece.kind === 'thinking' && piece.text) {
                return (
                  <details key={piece.id} className="thinking-block">
                    <summary className="thinking-header">{t('tools.thinking')}</summary>
                    <div className="thinking-content">{piece.text}</div>
                  </details>
                )
              }

              if (piece.kind === 'tool' && piece.toolId) {
                const tool = toolMap.get(piece.toolId)
                if (!tool) return null
                return <ToolCall key={piece.id} tool={tool} onViewInCode={onViewInCode} />
              }

              return null
            })}
          </div>
        </div>
      )}
      {durationLabel && <div className="turn-duration">{durationLabel}</div>}
    </div>
  )
}

function PlanToolDetail({ tool }: { tool: NormalizedToolCall }) {
  const plan = typeof tool.input.plan === 'string' ? tool.input.plan : ''
  const allowedPrompts = Array.isArray(tool.input.allowedPrompts) ? tool.input.allowedPrompts as Array<Record<string, unknown>> : []
  const options = Array.isArray(tool.input.options) ? tool.input.options as Array<Record<string, unknown>> : []
  const subject = typeof tool.input.subject === 'string' ? tool.input.subject : ''
  const description = typeof tool.input.description === 'string' ? tool.input.description : ''
  const question = typeof tool.input.question === 'string'
    ? tool.input.question
    : typeof tool.input.prompt === 'string'
      ? tool.input.prompt
      : typeof tool.input.header === 'string'
        ? tool.input.header
        : ''
  const status = typeof tool.input.status === 'string' ? tool.input.status : ''
  const taskId = tool.input.taskId != null ? String(tool.input.taskId) : ''
  const activeForm = typeof tool.input.activeForm === 'string' ? tool.input.activeForm : ''

  return (
    <div className="plan-call-body">
      {(subject || question) && <div className="plan-call-title">{subject || question}</div>}
      {description && <div className="plan-call-description">{description}</div>}
      {(taskId || status || activeForm) && (
        <div className="plan-chip-row">
          {taskId && <span className="plan-chip">#{taskId}</span>}
          {status && <span className="plan-chip">{status}</span>}
          {activeForm && <span className="plan-chip">{activeForm}</span>}
        </div>
      )}
      {plan && (
        <div className="plan-call-plan">
          <MarkdownContent content={plan} />
        </div>
      )}
      {allowedPrompts.length > 0 && (
        <div className="plan-allowed-actions">
          {allowedPrompts.map((item, index) => (
            <span key={`${tool.id}-allow-${index}`} className="plan-chip">
              {item.tool ? `${String(item.tool)}: ` : ''}{String(item.prompt || '')}
            </span>
          ))}
        </div>
      )}
      {options.length > 0 && (
        <div className="plan-allowed-actions">
          {options.map((item, index) => (
            <span key={`${tool.id}-option-${index}`} className="plan-chip">
              {String(item.label || item.prompt || item.description || '')}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function ToolCall({ tool, onViewInCode }: {
  tool: NormalizedToolCall
  onViewInCode: (filePath: string, oldContent: string, newContent: string) => void
}) {
  const [expanded, setExpanded] = useState(tool.isPlanTool || tool.name === 'tool_result')
  const summary = getToolSummary(tool.name, tool.input, tool.isPlanTool)
  const resultText = getToolResultText(tool.result)
  const icon = getToolIcon(tool.name, tool.isPlanTool)
  const hasResult = resultText.length > 0
  const isError = tool.result?.is_error
  const isPending = !tool.result && tool.name !== 'tool_result'
  const canViewCode = (tool.name === 'Edit' && tool.input.old_string != null) || (tool.name === 'Write' && tool.input.content != null)

  return (
    <div className={`tool-call ${tool.isPlanTool ? 'tool-call-plan' : ''} ${isError ? 'tool-error' : ''}`}>
      <div className="tool-call-header" onClick={() => setExpanded(!expanded)}>
        <span className="tool-icon">{icon}</span>
        <span className="tool-name">{tool.name}</span>
        <span className="tool-summary">{summary}</span>
        {tool.isPlanTool && <span className="tool-badge tool-badge-plan">PLAN</span>}
        {isPending && <span className="tool-badge tool-badge-live">LIVE</span>}
        {isError && <span className="tool-badge tool-badge-error">ERR</span>}
        {canViewCode && (
          <button
            className="tool-code-btn"
            title="View in Code tab"
            onMouseDown={(e) => {
              e.stopPropagation()
              if (tool.name === 'Edit') {
                onViewInCode(tool.input.file_path as string || '', tool.input.old_string as string || '', tool.input.new_string as string || '')
              } else {
                onViewInCode(tool.input.file_path as string || '', '', tool.input.content as string || '')
              }
            }}
          >
            &lt;/&gt;
          </button>
        )}
        <span className="tool-expand">{expanded ? '▾' : '▸'}</span>
      </div>
      {expanded && (
        <div className="tool-call-detail">
          {tool.isPlanTool ? (
            <PlanToolDetail tool={tool} />
          ) : (
            <>
              {tool.name === 'Bash' && tool.input.command && <pre className="tool-command">{tool.input.command as string}</pre>}
              {tool.name === 'Edit' && tool.input.old_string && (
                <div className="tool-edit">
                  <div className="tool-edit-label">Replace:</div>
                  <pre className="tool-code">{(tool.input.old_string as string).slice(0, 500)}</pre>
                  <div className="tool-edit-label">With:</div>
                  <pre className="tool-code">{(tool.input.new_string as string).slice(0, 500)}</pre>
                </div>
              )}
              {tool.name === 'Write' && tool.input.content && <pre className="tool-code">{(tool.input.content as string).slice(0, 500)}</pre>}
            </>
          )}
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

function getToolResultText(result: ToolResultBlock | null | undefined): string {
  if (!result) return ''
  const content = result.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.filter((block) => block.type === 'text').map((block) => block.text).join('\n')
  return ''
}

function getToolIcon(name: string, isPlanCard = false): string {
  if (isPlanCard) return '◈'
  switch (name) {
    case 'Bash': return '⌨'
    case 'Read': return '📄'
    case 'Write': return '✏'
    case 'Edit': return '✎'
    case 'Glob': return '◌'
    case 'Grep': return '🔍'
    case 'Agent': return '⚙'
    case 'tool_result': return '↩'
    default: return '▸'
  }
}

function getToolSummary(name: string, input: Record<string, unknown>, isPlanCard = false): string {
  switch (name) {
    case 'Bash': return `$ ${input.command || ''}`
    case 'Read': return `${input.file_path || ''}${input.offset ? `:${input.offset}-${input.limit ? Number(input.offset) + Number(input.limit) : ''}` : ''}`
    case 'Write': return `${input.file_path || ''}`
    case 'Edit': return `${input.file_path || ''}`
    case 'Glob': return `${input.pattern || ''}`
    case 'Grep': return `"${input.pattern || ''}" in ${input.glob || 'all files'}`
    case 'Agent': return `${input.description || ''}`
    case 'TaskCreate': return `${input.subject || input.activeForm || input.description || ''}`
    case 'TaskUpdate': return `${input.taskId ? `#${input.taskId}` : ''}${input.status ? ` → ${input.status}` : ''}`
    case 'TaskGet': return input.taskId ? `#${input.taskId}` : ''
    case 'TaskList': return '任务列表'
    case 'AskUserQuestion': return `${input.question || input.prompt || input.header || ''}`
    case 'ExitPlanMode': return typeof input.plan === 'string' ? '计划已生成，等待继续执行' : '计划已生成'
    case 'tool_result': return '工具返回结果'
    default: return isPlanCard ? '计划步骤' : ''
  }
}

// ===== Input Toolbar (Model + Effort selectors) =====

function InputToolbar({ processKey, isConnected, t, currentModel, currentEffort }: {
  processKey: string | null
  isConnected: boolean
  t: (key: string) => string
  currentModel: string
  currentEffort: string
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

  const getLabel = (type: string, value: string): string => {
    if (type === 'model') {
      return value.charAt(0).toUpperCase() + value.slice(1)
    }
    return value.charAt(0).toUpperCase() + value.slice(1)
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
          <span className="toolbar-btn-label">{getLabel('model', currentModel)}</span>
          <span className="toolbar-btn-arrow">▾</span>
        </button>
        {modelOpen && (
          <div className="toolbar-dropdown toolbar-dropdown-wide">
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
          <span className="toolbar-btn-label">{getLabel('effort', currentEffort)}</span>
          <span className="toolbar-btn-arrow">▾</span>
        </button>
        {effortOpen && (
          <div className="toolbar-dropdown toolbar-dropdown-wide">
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

// ===== Code Tab =====

function detectLanguage(filePath: string): string {
  const ext = (filePath.split('.').pop() || '').toLowerCase()
  const MAP: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin',
    css: 'css', scss: 'scss', less: 'less', html: 'html', json: 'json',
    md: 'markdown', yaml: 'yaml', yml: 'yaml', sh: 'shell', bash: 'shell',
    c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp', rb: 'ruby', php: 'php',
    swift: 'swift', cs: 'csharp', xml: 'xml', toml: 'toml', ini: 'ini', sql: 'sql',
  }
  return MAP[ext] || 'plaintext'
}

function fileIcon(node: FileNode): string {
  if (node.isDir) return '📁'
  const ext = (node.name.split('.').pop() || '').toLowerCase()
  if (['ts', 'tsx'].includes(ext)) return '🟦'
  if (['js', 'jsx'].includes(ext)) return '🟨'
  if (ext === 'py') return '🐍'
  if (ext === 'json') return '{ }'
  if (['md', 'txt'].includes(ext)) return '📄'
  if (['css', 'scss'].includes(ext)) return '🎨'
  if (['html', 'xml'].includes(ext)) return '🌐'
  return '📄'
}

function FileTreeNode({
  node,
  depth,
  selectedFile,
  onSelect,
}: {
  node: FileNode
  depth: number
  selectedFile: string | null
  onSelect: (node: FileNode) => void
}) {
  const [expanded, setExpanded] = useState(depth === 0)

  if (node.isDir) {
    return (
      <div>
        <div
          className="filetree-dir"
          style={{ paddingLeft: depth * 12 + 8 }}
          onClick={() => setExpanded(!expanded)}
        >
          <span className="filetree-arrow">{expanded ? '▾' : '▸'}</span>
          <span className="filetree-icon">📁</span>
          <span className="filetree-name">{node.name}</span>
        </div>
        {expanded && node.children?.map((child) => (
          <FileTreeNode key={child.path} node={child} depth={depth + 1} selectedFile={selectedFile} onSelect={onSelect} />
        ))}
      </div>
    )
  }

  return (
    <div
      className={`filetree-file ${selectedFile === node.path ? 'filetree-file-active' : ''}`}
      style={{ paddingLeft: depth * 12 + 8 }}
      onClick={() => onSelect(node)}
    >
      <span className="filetree-icon">{fileIcon(node)}</span>
      <span className="filetree-name">{node.name}</span>
    </div>
  )
}

function CodeTab({
  realPath,
  codeViewContext,
  onClearCodeView,
}: {
  realPath: string
  codeViewContext: CodeViewContext | null
  onClearCodeView: () => void
}) {
  const [fileTree, setFileTree] = useState<FileNode[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string>('')
  const [fileLoading, setFileLoading] = useState(false)
  const projectName = realPath.split(/[/\\]/).pop() || realPath

  // Load tree when realPath changes
  useEffect(() => {
    setFileTree([])
    window.electronAPI.readDir(realPath).then(setFileTree).catch(() => setFileTree([]))
  }, [realPath])

  const handleSelectFile = useCallback(async (node: FileNode) => {
    if (node.isDir) return
    setSelectedFile(node.path)
    onClearCodeView()
    setFileLoading(true)
    try {
      const content = await window.electronAPI.readFile(node.path)
      setFileContent(content)
    } finally {
      setFileLoading(false)
    }
  }, [onClearCodeView])

  // When diff context clears via file select, don't clear selectedFile
  const isDiffMode = !!codeViewContext
  const editorLang = isDiffMode
    ? detectLanguage(codeViewContext.filePath)
    : (selectedFile ? detectLanguage(selectedFile) : 'plaintext')

  const fileName = isDiffMode
    ? codeViewContext.filePath.split(/[/\\]/).pop() || codeViewContext.filePath
    : (selectedFile?.split(/[/\\]/).pop() || '')

  return (
    <div className="code-tab">
      {/* File tree panel */}
      <div className="code-filetree">
        <div className="code-filetree-header">{projectName}</div>
        <div className="code-filetree-body">
          {fileTree.map((node) => (
            <FileTreeNode key={node.path} node={node} depth={0} selectedFile={selectedFile} onSelect={handleSelectFile} />
          ))}
        </div>
      </div>

      {/* Editor panel */}
      <div className="code-editor-area">
        {isDiffMode ? (
          <>
            <div className="code-editor-header">
              <span className="code-editor-filename">
                {codeViewContext.oldContent ? 'Diff: ' : 'Write: '}
                {codeViewContext.filePath}
              </span>
              <button className="code-editor-close" onClick={onClearCodeView}>✕ Close</button>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              {codeViewContext.oldContent ? (
                <MonacoDiffEditorLazy
                  original={codeViewContext.oldContent}
                  modified={codeViewContext.newContent}
                  language={editorLang}
                />
              ) : (
                <MonacoEditorLazy
                  value={codeViewContext.newContent}
                  language={editorLang}
                  readOnly
                />
              )}
            </div>
          </>
        ) : selectedFile ? (
          <>
            <div className="code-editor-header">
              <span className="code-editor-filename">{fileName}</span>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              {fileLoading ? (
                <div className="code-editor-loading">Loading…</div>
              ) : (
                <MonacoEditorLazy value={fileContent} language={editorLang} readOnly={false} />
              )}
            </div>
          </>
        ) : (
          <div className="code-editor-empty">
            <div className="code-editor-empty-hint">Select a file to view, or click &lt;/&gt; on an Edit/Write action in the conversation</div>
          </div>
        )}
      </div>
    </div>
  )
}

// Lazy Monaco wrappers (avoid loading Monaco until Code tab is used)
function MonacoEditorLazy({ value, language, readOnly }: { value: string; language: string; readOnly: boolean }) {
  const [Editor, setEditor] = useState<any>(null)
  useEffect(() => {
    import('@monaco-editor/react').then((m) => setEditor(() => m.default))
  }, [])
  if (!Editor) return <div className="code-editor-loading">Loading editor…</div>
  return (
    <Editor
      height="100%"
      value={value}
      language={language}
      theme="vs-dark"
      options={{ readOnly, minimap: { enabled: true }, fontSize: 13, scrollBeyondLastLine: false, wordWrap: 'on' }}
    />
  )
}

function MonacoDiffEditorLazy({ original, modified, language }: { original: string; modified: string; language: string }) {
  const [DiffEditor, setDiffEditor] = useState<any>(null)
  useEffect(() => {
    import('@monaco-editor/react').then((m) => setDiffEditor(() => m.DiffEditor))
  }, [])
  if (!DiffEditor) return <div className="code-editor-loading">Loading editor…</div>
  return (
    <DiffEditor
      height="100%"
      original={original}
      modified={modified}
      language={language}
      theme="vs-dark"
      options={{ readOnly: true, renderSideBySide: true, minimap: { enabled: false }, fontSize: 13 }}
    />
  )
}
