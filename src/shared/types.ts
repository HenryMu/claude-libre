// ===== Path Utils =====

export interface ProjectInfo {
  sanitizedName: string
  realPath: string
}

// ===== JSONL Line Types =====

export type MessageType = 'user' | 'assistant' | 'system' | 'attachment' | 'file-history-snapshot' | 'permission-mode' | 'last-prompt'

export interface TextBlock {
  type: 'text'
  text: string
}

export interface ThinkingBlock {
  type: 'thinking'
  thinking: string
}

export interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string | ContentBlock[]
  is_error?: boolean
}

export type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock

export interface JsonlLine {
  type: MessageType
  uuid: string
  parentUuid?: string | null
  timestamp?: string
  sessionId?: string
  message?: {
    role: string
    content: string | ContentBlock[]
    model?: string
    stop_reason?: string
    usage?: { input_tokens: number; output_tokens: number }
  }
  [key: string]: unknown
}

// ===== Session Metadata =====

export interface SessionMeta {
  sessionId: string
  projectSanitizedName: string
  firstTimestamp: string | null
  lastTimestamp: string | null
  userMessageCount: number
  assistantMessageCount: number
  cwd: string | null
  gitBranch: string | null
  model: string | null
  firstUserMessage: string | null
}

// ===== IPC Events (main -> renderer) =====

export interface InitialDataPayload {
  projects: {
    sanitizedName: string
    realPath: string
    sessions: SessionMeta[]
  }[]
}

export interface SessionCreatedPayload {
  projectSanitizedName: string
  meta: SessionMeta
}

export interface SessionUpdatedPayload {
  projectSanitizedName: string
  sessionId: string
  newLines: JsonlLine[]
  updatedMeta: SessionMeta
}

export interface SessionDeletedPayload {
  projectSanitizedName: string
  sessionId: string
}

export interface PtyDataPayload {
  projectSanitizedName: string
  data: string
}

export interface PtySpawnedPayload {
  projectSanitizedName: string
  cwd: string
  pid: number
}

export interface PtyExitedPayload {
  projectSanitizedName: string
  exitCode: number
  signal?: number
}

// ===== IPC Actions (renderer -> main) =====

export interface SessionDetailsPayload {
  lines: JsonlLine[]
  meta: SessionMeta
}

export interface ActiveProcess {
  projectSanitizedName: string
  pid: number
  sessionId: string | null
  status: 'spawning' | 'running' | 'exiting'
  cwd: string
}

// ===== Electron API (exposed via preload) =====

export interface ElectronAPI {
  // Session data events
  onInitialData: (callback: (data: InitialDataPayload) => void) => () => void
  onSessionCreated: (callback: (data: SessionCreatedPayload) => void) => () => void
  onSessionUpdated: (callback: (data: SessionUpdatedPayload) => void) => () => void
  onSessionDeleted: (callback: (data: SessionDeletedPayload) => void) => () => void

  // Terminal events
  onPtyData: (callback: (data: PtyDataPayload) => void) => () => void
  onPtySpawned: (callback: (data: PtySpawnedPayload) => void) => () => void
  onPtyExited: (callback: (data: PtyExitedPayload) => void) => () => void

  // Actions
  spawnClaude: (projectSanitizedName: string, cols: number, rows: number) => Promise<{ pid: number }>
  resumeSession: (projectSanitizedName: string, sessionId: string, cols: number, rows: number) => Promise<{ pid: number }>
  killClaude: (projectSanitizedName: string) => Promise<void>
  ptyWrite: (projectSanitizedName: string, data: string) => void
  ptyResize: (projectSanitizedName: string, cols: number, rows: number) => void

  // Queries
  getSessionDetails: (projectSanitizedName: string, sessionId: string) => Promise<SessionDetailsPayload>
  isProcessRunning: (projectSanitizedName: string) => Promise<boolean>
  getActiveProcesses: () => Promise<ActiveProcess[]>
}
