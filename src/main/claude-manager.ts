import { BrowserWindow } from 'electron'
import pty, { IPty } from 'node-pty'
import { unsanitizePath } from './path-utils'

interface ProcessEntry {
  pty: IPty
  projectSanitizedName: string
  sessionId: string | null
  cwd: string
  status: 'spawning' | 'running' | 'exiting'
  cols: number
  rows: number
}

export class ClaudeManager {
  private processes: Map<string, ProcessEntry> = new Map()
  private mainWindow: BrowserWindow

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow
  }

  private spawnClaude(
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
      // On Windows, claude is a .cmd file — must spawn via shell
      // Use conpty compatible approach: spawn cmd.exe and run claude
      const shell = process.env.COMSPEC || 'cmd.exe'
      const claudeArgs = args.length > 0 ? `claude ${args.join(' ')}` : 'claude'
      ptyProcess = pty.spawn(shell, ['/c', claudeArgs], {
        name: 'xterm-256color',
        cols: cols || 80,
        rows: rows || 24,
        cwd: realPath,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor'
        } as Record<string, string>
      })
    } else {
      ptyProcess = pty.spawn('claude', args, {
        name: 'xterm-256color',
        cols: cols || 80,
        rows: rows || 24,
        cwd: realPath,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor'
        } as Record<string, string>
      })
    }

    const entry: ProcessEntry = {
      pty: ptyProcess,
      projectSanitizedName,
      sessionId,
      cwd: realPath,
      status: 'running',
      cols: cols || 80,
      rows: rows || 24
    }

    this.processes.set(projectSanitizedName, entry)

    ptyProcess.onData((data: string) => {
      this.send('pty-data', { projectSanitizedName, data })
    })

    ptyProcess.onExit(({ exitCode }) => {
      this.processes.delete(projectSanitizedName)
      this.send('pty-exited', { projectSanitizedName, exitCode })
    })

    this.send('pty-spawned', {
      projectSanitizedName,
      cwd: realPath,
      pid: ptyProcess.pid
    })

    return { pid: ptyProcess.pid }
  }

  async spawn(projectSanitizedName: string, cols: number, rows: number): Promise<{ pid: number }> {
    await this.killProcess(projectSanitizedName)
    return this.spawnClaude(projectSanitizedName, [], cols, rows, null)
  }

  async resume(
    projectSanitizedName: string,
    sessionId: string,
    cols: number,
    rows: number
  ): Promise<{ pid: number }> {
    await this.killProcess(projectSanitizedName)
    return this.spawnClaude(projectSanitizedName, ['--resume', sessionId], cols, rows, sessionId)
  }

  async killProcess(projectSanitizedName: string): Promise<void> {
    const entry = this.processes.get(projectSanitizedName)
    if (!entry) return

    entry.status = 'exiting'

    try {
      entry.pty.kill()
    } catch {
      // Process might already be dead
    }

    // Safety timeout: force-kill after 3s
    const pid = entry.pty.pid
    setTimeout(() => {
      if (this.processes.has(projectSanitizedName)) {
        try {
          if (process.platform === 'win32') {
            process.kill(pid)
          } else {
            process.kill(pid, 'SIGKILL')
          }
        } catch {
          // Already dead
        }
        this.processes.delete(projectSanitizedName)
      }
    }, 3000)
  }

  write(projectSanitizedName: string, data: string): void {
    const entry = this.processes.get(projectSanitizedName)
    if (!entry || entry.status !== 'running') return
    entry.pty.write(data)
  }

  resize(projectSanitizedName: string, cols: number, rows: number): void {
    const entry = this.processes.get(projectSanitizedName)
    if (!entry) return
    entry.cols = cols
    entry.rows = rows
    try {
      entry.pty.resize(cols, rows)
    } catch {
      // PTY might not be ready
    }
  }

  isRunning(projectSanitizedName: string): boolean {
    const entry = this.processes.get(projectSanitizedName)
    return !!entry && entry.status === 'running'
  }

  getActiveProcesses(): Array<{
    projectSanitizedName: string
    pid: number
    sessionId: string | null
    status: string
    cwd: string
  }> {
    return Array.from(this.processes.values()).map((e) => ({
      projectSanitizedName: e.projectSanitizedName,
      pid: e.pty.pid,
      sessionId: e.sessionId,
      status: e.status,
      cwd: e.cwd
    }))
  }

  cleanup(): void {
    for (const [, entry] of this.processes) {
      try {
        entry.pty.kill()
      } catch {
        // Ignore
      }
    }
    this.processes.clear()
  }

  private send(channel: string, data: unknown): void {
    try {
      if (!this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send(channel, data)
      }
    } catch {
      // Window might be closing
    }
  }
}
