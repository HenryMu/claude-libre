import { BrowserWindow } from 'electron'
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
  private pendingPermissions: Map<string, PendingPermission> = new Map()
  private responseConfirm: Map<string, {
    strategyIndex: number
    response: string
    timer: ReturnType<typeof setTimeout>
  }> = new Map()
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

    const stripped = this.stripAnsi(buf)
    const recent = stripped.slice(-1200)

    for (const pattern of PERMISSION_PATTERNS) {
      const match = recent.match(pattern)
      if (match) {
        const idx = match.index || 0
        const start = Math.max(0, idx - 50)
        const end = Math.min(recent.length, idx + match[0].length + 200)
        const promptText = recent.slice(start, end).trim()
        const entry = this.processes.get(processKey)
        const project = entry?.projectSanitizedName || ''

        console.log(`[ClaudeDesktop:Main] PERMISSION DETECTED: "${promptText}"`)

        const timer = setTimeout(() => {
          if (this.pendingPermissions.has(processKey)) {
            this.pendingPermissions.delete(processKey)
            this.send('permission-clear', { processKey })
          }
        }, PERMISSION_TIMEOUT_MS)

        this.pendingPermissions.set(processKey, { prompt: promptText, timestamp: Date.now(), timer })
        this.ptyBuffers.set(processKey, '')
        this.send('permission-prompt', { processKey, projectSanitizedName: project, prompt: promptText, timeout: PERMISSION_TIMEOUT_MS })
        return
      }
    }
    if (buf.length > 8000) this.ptyBuffers.set(processKey, buf.slice(-3000))
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

    if (isWin) {
      const shell = process.env.COMSPEC || 'cmd.exe'
      const claudeArgs = args.length > 0 ? `claude ${args.join(' ')}` : 'claude'
      ptyProcess = pty.spawn(shell, ['/c', claudeArgs], {
        name: 'xterm-256color', cols: cols || 80, rows: rows || 24,
        cwd: realPath,
        env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } as Record<string, string>
      })
    } else {
      ptyProcess = pty.spawn('claude', args, {
        name: 'xterm-256color', cols: cols || 80, rows: rows || 24,
        cwd: realPath,
        env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } as Record<string, string>
      })
    }

    const entry: ProcessEntry = {
      pty: ptyProcess, processKey, projectSanitizedName, sessionId,
      cwd: realPath, status: 'running', cols: cols || 80, rows: rows || 24
    }
    this.processes.set(processKey, entry)

    ptyProcess.onData((data: string) => {
      this.send('pty-data', { processKey, projectSanitizedName, data })

      if (this.responseConfirm.has(processKey)) {
        const stripped = this.stripAnsi(data)
        for (const pattern of PERMISSION_PATTERNS) {
          if (pattern.test(stripped.slice(-500))) {
            this.handleResponseRetry(processKey)
            return
          }
        }
      }
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
  }

  private send(channel: string, data: unknown): void {
    try { if (!this.mainWindow.isDestroyed()) this.mainWindow.webContents.send(channel, data) } catch {}
  }
}
