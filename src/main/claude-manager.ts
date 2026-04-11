import { BrowserWindow } from 'electron'
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import pty, { IPty } from 'node-pty'
import { unsanitizePath } from './path-utils'

interface ProcessEntry {
  pty: IPty
  processKey: string
  projectSanitizedName: string
  sessionId: string | null
  cwd: string
  status: 'spawning' | 'running' | 'exiting'
  cols: number
  rows: number
}

interface PendingPermission {
  prompt: string
  timestamp: number
  timer: ReturnType<typeof setTimeout>
  options?: Array<{ label: string; value: string; kind?: 'allow' | 'deny' | 'secondary' }>
}

interface ParsedPermissionPrompt {
  prompt: string
  options?: Array<{ label: string; value: string; kind?: 'allow' | 'deny' | 'secondary' }>
}

const PERMISSION_PATTERNS: RegExp[] = [
  /Do you want to allow[\s\S]{0,300}?\?/i,
  /Allow(?:\s+Claude)?\s+(?:to\s+)?[\s\S]{0,300}?\?/i,
  /Allow this[\s\S]{0,200}?\?/i,
  /\[Y\/n\]/, /\[y\/N\]/, /\[y\/n\]/i,
  /\(yes\/no\)/i, /\(y\/n\)/i, /\(Y\/N\)/,
  /Claude wants to[\s\S]{0,300}?\?/i,
  /wants to (?:run|use|execute|access|write|edit|read|create|delete|move|copy|modify)[\s\S]{0,200}/i,
  /Permission required[\s\S]{0,200}/i,
  /Proceed[\s\S]{0,100}?\?/i,
  /Press Enter to[\s\S]{0,100}/i,
  /continue\?[\s\S]{0,50}\(y\/n\)/i,
  /\?\s*\n?\s*\(?(?:y\/n|yes\/no)\)?/i,
  /allow(?:ing)?\s+(?:the\s+)?(?:tool|command|bash|script|operation)[\s\S]{0,200}/i,
]

const PERMISSION_TIMEOUT_MS = 30_000
const CONFIRMATION_TIMEOUT_MS = 3_000
const MAX_CONCURRENT_PROCESSES = Infinity
const WORKSPACE_TRUST_MATCHERS = [
  /Accessing workspace:/i,
  /Quick safety check/i,
  /Yes,\s*I trust this folder/i,
  /Enter to confirm/i
]

const RESPONSE_STRATEGIES: Array<{ name: string; build: (char: string) => Array<string | null> }> = [
  { name: 'raw-char-then-enter', build: (char) => [char, '\r'] },
  { name: 'char+cr-single', build: (char) => [char + '\r'] },
  { name: 'char+lf-single', build: (char) => [char + '\n'] },
  { name: 'char+crlf-single', build: (char) => [char + '\r\n'] },
  { name: 'yes+cr', build: () => ['yes\r'] },
]

export class ClaudeManager {
  private processes: Map<string, ProcessEntry> = new Map()
  private mainWindow: BrowserWindow
  private ptyBuffers: Map<string, string> = new Map()
  private workspaceTrustBuffers: Map<string, string> = new Map()
  private pendingPermissions: Map<string, PendingPermission> = new Map()
  private responseConfirm: Map<string, {
    strategyIndex: number
    response: string
    timer: ReturnType<typeof setTimeout>
  }> = new Map()
  private workspaceTrustAttempts: Map<string, number> = new Map()
  private resolvedShellEnv: Record<string, string> | null = null
  private resolvedClaudePath: string | null = null
  private processCounter = 0

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow
  }

  private generateKey(): string {
    return `_pk_${++this.processCounter}_${Date.now()}`
  }

  private stripAnsi(text: string): string {
    return text
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/\x1b\].*?(?:\x07|\x1b\\)/g, '')
      .replace(/\x1b\[\?[0-9]*[a-zA-Z]/g, '')
      .replace(/\x1b[()][AB012]/g, '')
      .replace(/\x1b[><=]/g, '')
      .replace(/\x1b[^[\]()]./g, '')
      .replace(/[\x00-\x09\x0b\x0c\x0e-\x1f]/g, '')
  }

  private normalizeTerminalText(text: string): string {
    return this.stripAnsi(text)
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  private classifyPermissionOption(label: string): 'allow' | 'deny' | 'secondary' {
    const normalized = label.toLowerCase()
    if (/(^|\b)(no|deny|cancel|exit|reject)(\b|$)/i.test(normalized)) return 'deny'
    if (/don't ask again|do not ask again|always|trust this folder/i.test(normalized)) return 'secondary'
    return 'allow'
  }

  private parseNumberedPermissionPrompt(recent: string): ParsedPermissionPrompt | null {
    const normalized = this.normalizeTerminalText(recent)
    if (!normalized) return null

    const lines = normalized
      .split('\n')
      .map((line) => line.replace(/\s+$/g, ''))

    if (lines.length < 3) return null

    const optionEntries: Array<{ lineIndex: number; value: string; label: string }> = []

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim()
      const match = line.match(/^(?:[❯>▶→*]\s*)?(\d+)\.\s+(.+?)$/)
      if (!match) continue

      const labelParts = [match[2].trim()]
      let cursor = index + 1

      while (cursor < lines.length) {
        const nextLine = lines[cursor].trim()
        if (!nextLine) {
          cursor += 1
          continue
        }
        if (/^(?:[❯>▶→*]\s*)?\d+\.\s+/.test(nextLine)) break
        if (/enter to confirm|esc to cancel/i.test(nextLine)) break
        labelParts.push(nextLine)
        cursor += 1
      }

      optionEntries.push({
        lineIndex: index,
        value: match[1],
        label: labelParts.join(' ')
      })
      index = cursor - 1
    }

    if (optionEntries.length < 2) return null

    const firstOptionIndex = optionEntries[0].lineIndex
    const promptCandidates = lines
      .slice(Math.max(0, firstOptionIndex - 4), firstOptionIndex)
      .map((line) => line.trim())
      .filter((line) => line && !/^(?:enter to confirm|esc to cancel)$/i.test(line))

    const promptLine = [...promptCandidates].reverse().find((line) => /[?？]\s*$/.test(line))
      || promptCandidates[promptCandidates.length - 1]

    if (!promptLine) return null

    const options = optionEntries.map((entry) => ({
      label: entry.label,
      value: entry.value,
      kind: this.classifyPermissionOption(entry.label)
    }))

    return { prompt: promptLine, options }
  }

  private emitPermissionPrompt(processKey: string, promptText: string, options?: Array<{ label: string; value: string; kind?: 'allow' | 'deny' | 'secondary' }>): void {
    const entry = this.processes.get(processKey)
    const project = entry?.projectSanitizedName || ''

    console.log(`[ClaudeDesktop:Main] PERMISSION DETECTED: "${promptText}"`)

    const timer = setTimeout(() => {
      if (this.pendingPermissions.has(processKey)) {
        this.pendingPermissions.delete(processKey)
        this.send('permission-clear', { processKey })
      }
    }, PERMISSION_TIMEOUT_MS)

    this.pendingPermissions.set(processKey, {
      prompt: promptText,
      timestamp: Date.now(),
      timer,
      options
    })
    this.ptyBuffers.set(processKey, '')
    this.send('permission-prompt', {
      processKey,
      projectSanitizedName: project,
      prompt: promptText,
      timeout: PERMISSION_TIMEOUT_MS,
      options
    })
  }

  private writeRaw(processKey: string, data: string): boolean {
    const entry = this.processes.get(processKey)
    if (!entry || entry.status !== 'running') {
      console.error(`[ClaudeDesktop:Main] writeRaw FAILED: key=${processKey}, entry=${!!entry}, status=${entry?.status}`)
      return false
    }
    const bytes = Buffer.from(data).toString('hex')
    console.log(`[ClaudeDesktop:Main] pty.write: key=${processKey}, pid=${entry.pty.pid}, data=${JSON.stringify(data)}, bytes=0x${bytes}`)
    try {
      entry.pty.write(data)
      return true
    } catch (err) {
      console.error(`[ClaudeDesktop:Main] pty.write EXCEPTION:`, err)
      return false
    }
  }

  private detectPermission(processKey: string, data: string): void {
    if (this.pendingPermissions.has(processKey)) return

    let buf = this.ptyBuffers.get(processKey) || ''
    buf += data
    this.ptyBuffers.set(processKey, buf)

    const normalized = this.normalizeTerminalText(buf)
    const recent = normalized.slice(-2000)

    const numberedPrompt = this.parseNumberedPermissionPrompt(recent)
    if (numberedPrompt) {
      this.emitPermissionPrompt(processKey, numberedPrompt.prompt, numberedPrompt.options)
      return
    }

    for (const pattern of PERMISSION_PATTERNS) {
      const match = recent.match(pattern)
      if (match) {
        const idx = match.index || 0
        const start = Math.max(0, idx - 50)
        const end = Math.min(recent.length, idx + match[0].length + 200)
        const promptText = recent.slice(start, end).trim()
        this.emitPermissionPrompt(processKey, promptText)
        return
      }
    }
    if (buf.length > 8000) this.ptyBuffers.set(processKey, buf.slice(-3000))
  }

  private detectWorkspaceTrustPrompt(processKey: string, data: string): boolean {
    let buf = this.workspaceTrustBuffers.get(processKey) || ''
    buf += data
    this.workspaceTrustBuffers.set(processKey, buf)

    const stripped = this.stripAnsi(buf)
    const recent = stripped.slice(-2000)
    const isWorkspaceTrustPrompt = WORKSPACE_TRUST_MATCHERS.every((pattern) => pattern.test(recent))
    if (!isWorkspaceTrustPrompt) {
      if (buf.length > 8000) this.workspaceTrustBuffers.set(processKey, buf.slice(-3000))
      return false
    }

    const attempts = this.workspaceTrustAttempts.get(processKey) || 0
    if (attempts >= 2) return false

    this.workspaceTrustAttempts.set(processKey, attempts + 1)
    this.workspaceTrustBuffers.set(processKey, '')

    const response = attempts === 0 ? '\r' : '1\r'
    console.log(`[ClaudeDesktop:Main] Auto-confirm workspace trust with attempt ${attempts + 1}`)
    setTimeout(() => this.writeRaw(processKey, response), 120)
    return true
  }

  respondPermission(processKey: string, response: string): void {
    const pending = this.pendingPermissions.get(processKey)
    if (pending) { clearTimeout(pending.timer); this.pendingPermissions.delete(processKey) }
    const existing = this.responseConfirm.get(processKey)
    if (existing) { clearTimeout(existing.timer); this.responseConfirm.delete(processKey) }

    const entry = this.processes.get(processKey)
    if (!entry || entry.status !== 'running') {
      this.send('permission-clear', { processKey })
      return
    }

    setTimeout(() => this.executeStrategy(processKey, response, 0), 100)
  }

  private executeStrategy(processKey: string, response: string, strategyIndex: number): void {
    if (strategyIndex >= RESPONSE_STRATEGIES.length) {
      this.responseConfirm.delete(processKey)
      this.send('permission-failed', { processKey })
      return
    }
    const strategy = RESPONSE_STRATEGIES[strategyIndex]
    const writes = strategy.build(response)
    console.log(`[ClaudeDesktop:Main] Strategy ${strategyIndex} (${strategy.name}) for ${processKey}`)

    writes.forEach((data, i) => {
      if (data === null) return
      setTimeout(() => this.writeRaw(processKey, data), i * 200)
    })

    const totalWriteTime = writes.length * 200
    const confirmTimer = setTimeout(() => {
      this.responseConfirm.delete(processKey)
    }, totalWriteTime + CONFIRMATION_TIMEOUT_MS)

    this.responseConfirm.set(processKey, { strategyIndex, response, timer: confirmTimer })
    this.send('permission-clear', { processKey })
  }

  private handleResponseRetry(processKey: string): void {
    const confirm = this.responseConfirm.get(processKey)
    if (!confirm) return
    clearTimeout(confirm.timer)
    const pending = this.pendingPermissions.get(processKey)
    if (pending) { clearTimeout(pending.timer); this.pendingPermissions.delete(processKey) }
    setTimeout(() => this.executeStrategy(processKey, confirm.response, confirm.strategyIndex + 1), 150)
  }

  private isExecutable(filePath: string): boolean {
    try {
      fs.accessSync(filePath, fs.constants.X_OK)
      return true
    } catch {
      return false
    }
  }

  private mergePathEntries(entries: Array<string | undefined | null>): string {
    const seen = new Set<string>()
    const result: string[] = []

    for (const entry of entries) {
      if (!entry) continue
      for (const part of entry.split(':')) {
        const trimmed = part.trim()
        if (!trimmed || seen.has(trimmed)) continue
        seen.add(trimmed)
        result.push(trimmed)
      }
    }

    return result.join(':')
  }

  private parseEnvOutput(output: Buffer): Record<string, string> {
    const marker = Buffer.from('__CCD_ENV_START__\0')
    const markerIndex = output.indexOf(marker)
    if (markerIndex === -1) return {}

    const envPayload = output.subarray(markerIndex + marker.length).toString('utf8')
    const parsed: Record<string, string> = {}

    for (const line of envPayload.split('\0')) {
      const separatorIndex = line.indexOf('=')
      if (separatorIndex <= 0) continue
      const key = line.slice(0, separatorIndex)
      const value = line.slice(separatorIndex + 1)
      parsed[key] = value
    }

    return parsed
  }

  private getShellCandidates(): string[] {
    return Array.from(new Set([
      process.env.SHELL,
      '/bin/zsh',
      '/bin/bash',
      '/bin/sh'
    ].filter(Boolean) as string[]))
  }

  private loadLoginShellEnv(): Record<string, string> {
    const basePath = this.mergePathEntries([
      process.env.PATH,
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
      path.join(os.homedir(), '.local', 'bin'),
      path.join(os.homedir(), 'bin')
    ])

    for (const shell of this.getShellCandidates()) {
      try {
        const output = execFileSync(
          shell,
          ['-ilc', 'printf "__CCD_ENV_START__\\0"; env -0'],
          {
            encoding: 'buffer',
            maxBuffer: 1024 * 1024,
            env: {
              ...process.env,
              PATH: basePath
            }
          }
        )

        const parsed = this.parseEnvOutput(output)
        if (Object.keys(parsed).length > 0) {
          return parsed
        }
      } catch (err) {
        console.warn(`[ClaudeDesktop:Main] Failed to load login shell env via ${shell}:`, err)
      }
    }

    return {}
  }

  private getSpawnEnv(): Record<string, string> {
    if (this.resolvedShellEnv) return { ...this.resolvedShellEnv }

    const fallbackPath = this.mergePathEntries([
      process.env.PATH,
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
      path.join(os.homedir(), '.local', 'bin'),
      path.join(os.homedir(), 'bin')
    ])

    let shellEnv: Record<string, string> = {}
    if (process.platform === 'darwin') {
      shellEnv = this.loadLoginShellEnv()
    }

    const mergedEnv = {
      ...process.env,
      ...shellEnv,
      PATH: this.mergePathEntries([
        shellEnv.PATH,
        fallbackPath
      ])
    } as Record<string, string>

    this.resolvedShellEnv = mergedEnv
    return { ...mergedEnv }
  }

  private resolveClaudeExecutable(env: Record<string, string>): string {
    if (this.resolvedClaudePath && this.isExecutable(this.resolvedClaudePath)) {
      return this.resolvedClaudePath
    }

    const candidatePaths = [
      process.env.CLAUDE_PATH,
      path.join('/opt/homebrew/bin', 'claude'),
      path.join('/usr/local/bin', 'claude'),
      path.join('/usr/bin', 'claude'),
      path.join(os.homedir(), '.local', 'bin', 'claude'),
      path.join(os.homedir(), 'bin', 'claude')
    ].filter(Boolean) as string[]

    for (const candidate of candidatePaths) {
      if (this.isExecutable(candidate)) {
        this.resolvedClaudePath = candidate
        return candidate
      }
    }

    const pathEntries = (env.PATH || '').split(':').filter(Boolean)
    for (const dir of pathEntries) {
      const candidate = path.join(dir, 'claude')
      if (this.isExecutable(candidate)) {
        this.resolvedClaudePath = candidate
        return candidate
      }
    }

    throw new Error(
      'Unable to locate the `claude` executable. On macOS packaged builds, launch from Terminal once or install Claude Code CLI into a standard PATH location such as /opt/homebrew/bin or /usr/local/bin.'
    )
  }

  /** Spawn a new Claude session (no --resume). Returns processKey. */
  async spawnNew(projectSanitizedName: string, cols: number, rows: number): Promise<{ processKey: string; pid: number }> {
    if (this.processes.size >= MAX_CONCURRENT_PROCESSES) {
      throw new Error(`Maximum ${MAX_CONCURRENT_PROCESSES} concurrent sessions reached. Disconnect a session first.`)
    }
    const processKey = this.generateKey()
    return { processKey, ...this.spawnClaude(processKey, projectSanitizedName, [], cols, rows, null) }
  }

  /** Resume an existing session. processKey = sessionId. */
  async resume(projectSanitizedName: string, sessionId: string, cols: number, rows: number): Promise<{ processKey: string; pid: number }> {
    // Kill existing PTY for this session if any
    await this.killBySessionId(sessionId)

    if (this.processes.size >= MAX_CONCURRENT_PROCESSES) {
      throw new Error(`Maximum ${MAX_CONCURRENT_PROCESSES} concurrent sessions reached. Disconnect a session first.`)
    }

    const processKey = sessionId
    return { processKey, ...this.spawnClaude(processKey, projectSanitizedName, ['--resume', sessionId], cols, rows, sessionId) }
  }

  private spawnClaude(
    processKey: string,
    projectSanitizedName: string,
    args: string[],
    cols: number,
    rows: number,
    sessionId: string | null
  ): { pid: number } {
    const realPath = unsanitizePath(projectSanitizedName)
    const isWin = process.platform === 'win32'
    let ptyProcess: IPty

    try {
      const spawnEnv = {
        ...this.getSpawnEnv(),
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor'
      } as Record<string, string>

      if (isWin) {
        const shell = process.env.COMSPEC || 'cmd.exe'
        const claudeArgs = args.length > 0 ? `claude ${args.join(' ')}` : 'claude'
        ptyProcess = pty.spawn(shell, ['/c', claudeArgs], {
          name: 'xterm-256color', cols: cols || 80, rows: rows || 24,
          cwd: realPath,
          env: spawnEnv
        })
      } else {
        const claudeExecutable = this.resolveClaudeExecutable(spawnEnv)
        ptyProcess = pty.spawn(claudeExecutable, args, {
          name: 'xterm-256color', cols: cols || 80, rows: rows || 24,
          cwd: realPath,
          env: spawnEnv
        })
      }
    } catch (err) {
      console.error('[ClaudeDesktop:Main] Failed to spawn Claude process:', err)
      throw err
    }

    const entry: ProcessEntry = {
      pty: ptyProcess, processKey, projectSanitizedName, sessionId,
      cwd: realPath, status: 'running', cols: cols || 80, rows: rows || 24
    }
    this.processes.set(processKey, entry)

    ptyProcess.onData((data: string) => {
      this.send('pty-data', { processKey, projectSanitizedName, data })

      if (this.responseConfirm.has(processKey)) {
        const normalized = this.normalizeTerminalText(data).slice(-800)
        if (this.parseNumberedPermissionPrompt(normalized)) {
          this.handleResponseRetry(processKey)
          return
        }
        for (const pattern of PERMISSION_PATTERNS) {
          if (pattern.test(normalized)) {
            this.handleResponseRetry(processKey)
            return
          }
        }
      }
      if (this.detectWorkspaceTrustPrompt(processKey, data)) return
      this.detectPermission(processKey, data)
    })

    ptyProcess.onExit(({ exitCode }) => {
      this.processes.delete(processKey)  // Free up the slot!
      this.cleanProcessState(processKey)
      this.send('pty-exited', { processKey, projectSanitizedName, exitCode })
    })

    this.send('pty-spawned', { processKey, projectSanitizedName, sessionId, cwd: realPath, pid: ptyProcess.pid })
    return { pid: ptyProcess.pid }
  }

  /** Kill a specific process by its processKey */
  async killProcess(processKey: string): Promise<void> {
    const entry = this.processes.get(processKey)
    if (!entry) return
    entry.status = 'exiting'
    this.cleanProcessState(processKey)
    try { entry.pty.kill() } catch {}
    const pid = entry.pty.pid
    setTimeout(() => {
      if (this.processes.has(processKey)) {
        try { process.kill(pid) } catch {}
        this.processes.delete(processKey)
      }
    }, 3000)
  }

  /** Kill by sessionId — for deduplication before resume */
  /** Kill by sessionId — for deduplication or session deletion */
  async killBySessionId(sessionId: string): Promise<void> {
    for (const [key, entry] of this.processes) {
      if (entry.sessionId === sessionId) {
        await this.killProcess(key)
        return
      }
    }
  }

  /** Kill all running processes for a project */
  async killByProject(projectSanitizedName: string): Promise<void> {
    const keysToKill: string[] = []
    for (const [key, entry] of this.processes) {
      if (entry.projectSanitizedName === projectSanitizedName) {
        keysToKill.push(key)
      }
    }
    await Promise.all(keysToKill.map(key => this.killProcess(key)))
  }

  private cleanProcessState(processKey: string): void {
    const pending = this.pendingPermissions.get(processKey)
    if (pending) { clearTimeout(pending.timer); this.pendingPermissions.delete(processKey) }
    const confirm = this.responseConfirm.get(processKey)
    if (confirm) { clearTimeout(confirm.timer); this.responseConfirm.delete(processKey) }
    this.ptyBuffers.delete(processKey)
    this.workspaceTrustBuffers.delete(processKey)
    this.workspaceTrustAttempts.delete(processKey)
  }

  write(processKey: string, data: string): void {
    this.writeRaw(processKey, data)
  }

  resize(processKey: string, cols: number, rows: number): void {
    const entry = this.processes.get(processKey)
    if (!entry) return
    entry.cols = cols; entry.rows = rows
    try { entry.pty.resize(cols, rows) } catch {}
  }

  isRunning(processKey: string): boolean {
    const entry = this.processes.get(processKey)
    return !!entry && entry.status === 'running'
  }

  getActiveProcesses(): Array<{
    processKey: string
    projectSanitizedName: string
    pid: number
    sessionId: string | null
    status: string
    cwd: string
  }> {
    return Array.from(this.processes.values()).map(e => ({
      processKey: e.processKey,
      projectSanitizedName: e.projectSanitizedName,
      pid: e.pty.pid,
      sessionId: e.sessionId,
      status: e.status,
      cwd: e.cwd
    }))
  }

  cleanup(): void {
    for (const [, entry] of this.processes) { try { entry.pty.kill() } catch {} }
    for (const [, p] of this.pendingPermissions) clearTimeout(p.timer)
    for (const [, c] of this.responseConfirm) clearTimeout(c.timer)
    this.pendingPermissions.clear()
    this.responseConfirm.clear()
    this.processes.clear()
    this.ptyBuffers.clear()
    this.workspaceTrustBuffers.clear()
    this.workspaceTrustAttempts.clear()
    this.resolvedShellEnv = null
    this.resolvedClaudePath = null
  }

  private send(channel: string, data: unknown): void {
    try { if (!this.mainWindow.isDestroyed()) this.mainWindow.webContents.send(channel, data) } catch {}
  }
}
