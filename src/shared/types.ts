// ===== Claude Config =====

export interface ClaudeConfig {
  ANTHROPIC_BASE_URL?: string
  ANTHROPIC_AUTH_TOKEN?: string
  ANTHROPIC_API_KEY?: string
  ANTHROPIC_MODEL?: string
  ANTHROPIC_SMALL_FAST_MODEL?: string
}

export interface ProfileData {
  id: string
  name: string
  content: string
  createdAt: string
  updatedAt: string
}

// ===== Path Utils =====

export interface ProjectInfo {
  sanitizedName: string
  realPath: string
}

// ===== Code / File Browser =====

export interface FileNode {
  name: string
  path: string
  isDir: boolean
  children?: FileNode[]
}

export interface CodeViewContext {
  filePath: string
  oldContent: string  // empty = new file (Write tool); non-empty = diff (Edit tool)
  newContent: string
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
  title?: string | null
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

export interface ProjectAddedPayload {
  sanitizedName: string
  realPath: string
}

export interface ProjectDeletedPayload {
  sanitizedName: string
}

/** PTY output data — routed by processKey */
export interface PtyDataPayload {
  processKey: string
  projectSanitizedName: string
  data: string
}

/** PTY process spawned */
export interface PtySpawnedPayload {
  processKey: string
  projectSanitizedName: string
  sessionId: string | null
  cwd: string
  pid: number
}

/** PTY process exited */
export interface PtyExitedPayload {
  processKey: string
  projectSanitizedName: string
  exitCode: number
  signal?: number
}

// ===== IPC Actions (renderer -> main) =====

export interface SessionDetailsPayload {
  lines: JsonlLine[]
  meta: SessionMeta
}

/** A running PTY process — keyed by processKey */
export interface ActiveProcess {
  processKey: string
  projectSanitizedName: string
  pid: number
  sessionId: string | null
  status: 'spawning' | 'running' | 'exiting'
  cwd: string
}

export interface PermissionPromptPayload {
  processKey: string
  projectSanitizedName: string
  prompt: string
  timeout: number
}

export interface PermissionClearPayload {
  processKey: string
}

export interface PermissionFailedPayload {
  processKey: string
}

// ===== Electron API (exposed via preload) =====

export interface ElectronAPI {
  // Session data events
  onInitialData: (callback: (data: InitialDataPayload) => void) => () => void
  onSessionCreated: (callback: (data: SessionCreatedPayload) => void) => () => void
  onSessionUpdated: (callback: (data: SessionUpdatedPayload) => void) => () => void
  onSessionDeleted: (callback: (data: SessionDeletedPayload) => void) => () => void

  // Project events
  onProjectAdded: (callback: (data: ProjectAddedPayload) => void) => () => void
  onProjectDeleted: (callback: (data: ProjectDeletedPayload) => void) => () => void

  // Terminal events — routed by processKey
  onPtyData: (callback: (data: PtyDataPayload) => void) => () => void
  onPtySpawned: (callback: (data: PtySpawnedPayload) => void) => () => void
  onPtyExited: (callback: (data: PtyExitedPayload) => void) => () => void

  // Permission prompt detected in main process
  onPermissionPrompt: (callback: (data: PermissionPromptPayload) => void) => () => void
  onPermissionClear: (callback: (data: PermissionClearPayload) => void) => () => void
  onPermissionFailed: (callback: (data: PermissionFailedPayload) => void) => () => void

  // Actions — all use processKey for routing
  spawnClaude: (projectSanitizedName: string, cols: number, rows: number) => Promise<{ processKey: string; pid: number }>
  resumeSession: (projectSanitizedName: string, sessionId: string, cols: number, rows: number) => Promise<{ processKey: string; pid: number }>
  killClaude: (processKey: string) => Promise<void>
  ptyWrite: (processKey: string, data: string) => void
  ptyResize: (processKey: string, cols: number, rows: number) => void
  respondPermission: (processKey: string, response: string) => void

  // Queries
  getSessionDetails: (projectSanitizedName: string, sessionId: string) => Promise<SessionDetailsPayload>
  isProcessRunning: (processKey: string) => Promise<boolean>
  getActiveProcesses: () => Promise<ActiveProcess[]>

  // Config & profiles
  readConfig: () => Promise<ClaudeConfig>
  saveConfig: (config: ClaudeConfig) => Promise<void>
  readConfigFile: () => Promise<string>
  writeConfigFile: (content: string) => Promise<void>
  listProfiles: () => Promise<ProfileData[]>
  saveProfile: (profile: ProfileData) => Promise<void>
  deleteProfile: (profileId: string) => Promise<void>

  // Session management
  deleteSession: (projectSanitizedName: string, sessionId: string) => Promise<void>
  renameSession: (projectSanitizedName: string, sessionId: string, title: string) => Promise<void>

  // Project management
  addProject: () => Promise<{ sanitizedName: string; realPath: string } | null>
  deleteProject: (projectSanitizedName: string) => Promise<void>

  // File browsing
  readDir: (dirPath: string) => Promise<FileNode[]>
  readFile: (filePath: string) => Promise<string>
}
