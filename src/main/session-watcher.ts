import fs from 'fs'
import path from 'path'
import { BrowserWindow } from 'electron'
import chokidar, { FSWatcher } from 'chokidar'
import { unsanitizePath } from './path-utils'
import type { JsonlLine, SessionMeta } from '../shared/types'

interface FileTracker {
  filePath: string
  byteOffset: number
}

interface ProjectIndex {
  sanitizedName: string
  realPath: string
  sessions: Map<string, SessionMeta>
}

export class SessionWatcher {
  private projectsDir: string
  private mainWindow: BrowserWindow
  private watcher: FSWatcher | null = null
  private fileTrackers: Map<string, FileTracker> = new Map()
  private projectIndexes: Map<string, ProjectIndex> = new Map()
  private isReady = false
  private rendererReady = false
  private pendingInitialData: { projects: { sanitizedName: string; realPath: string; sessions: SessionMeta[] }[] } | null = null

  constructor(projectsDir: string, mainWindow: BrowserWindow) {
    this.projectsDir = projectsDir
    this.mainWindow = mainWindow

    // Wait for renderer to be ready before sending initial data
    mainWindow.webContents.on('did-finish-load', () => {
      this.rendererReady = true
      if (this.pendingInitialData) {
        this.send('initial-data', this.pendingInitialData)
        this.pendingInitialData = null
      }
    })
  }

  start(): void {
    // Ensure projects directory exists
    if (!fs.existsSync(this.projectsDir)) {
      console.warn(`Projects directory not found: ${this.projectsDir}`)
      return
    }

    this.watcher = chokidar.watch(this.projectsDir, {
      depth: 2,
      persistent: true,
      ignoreInitial: false,
      ignored: (filePath: string, stats?: fs.Stats) => {
        if (!stats) return false
        if (stats.isDirectory()) {
          const basename = path.basename(filePath)
          return basename === 'memory' || basename === 'subagents' || basename === 'plans'
        }
        if (stats.isFile()) {
          const basename = path.basename(filePath)
          // Watch .jsonl (non-agent) and *.meta.json files
          if (basename.endsWith('.meta.json')) return false
          if (!basename.endsWith('.jsonl')) return true
          if (basename.startsWith('agent-')) return true
          return false
        }
        return false
      },
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 50
      }
    })

    this.watcher.on('add', (filePath, stats) => this.handleFileAdd(filePath, stats))
    this.watcher.on('change', (filePath, stats) => this.handleFileChange(filePath, stats))
    this.watcher.on('unlink', (filePath) => this.handleFileUnlink(filePath))
    this.watcher.on('ready', () => this.handleReady())
    this.watcher.on('error', (err) => console.error('SessionWatcher error:', err))
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
    this.fileTrackers.clear()
    this.projectIndexes.clear()
    this.isReady = false
  }

  // ===== Get session details on demand =====
  getSessionDetails(projectSanitizedName: string, sessionId: string): { lines: JsonlLine[]; meta: SessionMeta } | null {
    const project = this.projectIndexes.get(projectSanitizedName)
    if (!project) return null
    const meta = project.sessions.get(sessionId)
    if (!meta) return null

    const filePath = path.join(this.projectsDir, projectSanitizedName, `${sessionId}.jsonl`)
    const lines = this.readAndParse(filePath, 0)
    return { lines, meta }
  }

  // ===== Chokidar event handlers =====

  private handleFileAdd(filePath: string, stats?: fs.Stats): void {
    // Check if this is a meta.json file
    if (filePath.endsWith('meta.json')) {
      this.handleMetaFileChange(filePath)
      return
    }

    const info = this.parseFilePath(filePath)
    if (!info) return

    const { sanitizedName, sessionId } = info
    const fileSize = stats?.size || 0

    // Read entire file
    const lines = this.readAndParse(filePath, 0)

    // Track file offset
    this.fileTrackers.set(filePath, { filePath, byteOffset: fileSize })

    // Build metadata (includes title from meta.json)
    const meta = this.buildSessionMeta(sessionId, sanitizedName, lines)

    // Update project index
    if (!this.projectIndexes.has(sanitizedName)) {
      // On Windows, unsanitizePath cannot distinguish path-separator dashes from
      // dashes in directory names (e.g. "G--learn-claude-code-desktop" would be
      // incorrectly reconstructed as "G:\learn\claude\code\desktop").
      // Use the cwd recorded by Claude CLI in session data when available.
      const fallbackPath = unsanitizePath(sanitizedName)
      const realPath = (meta.cwd && fs.existsSync(meta.cwd)) ? meta.cwd : fallbackPath
      this.projectIndexes.set(sanitizedName, {
        sanitizedName,
        realPath,
        sessions: new Map()
      })
    }
    this.projectIndexes.get(sanitizedName)!.sessions.set(sessionId, meta)

    // After initial scan, notify renderer of new sessions
    if (this.isReady) {
      this.send('session-created', { projectSanitizedName: sanitizedName, meta })
    }
  }

  private handleFileChange(filePath: string, stats?: fs.Stats): void {
    // Check if this is a meta.json file
    if (filePath.endsWith('meta.json')) {
      this.handleMetaFileChange(filePath)
      return
    }

    const info = this.parseFilePath(filePath)
    if (!info) return

    const tracker = this.fileTrackers.get(filePath)
    if (!tracker) return

    const newOffset = stats?.size || 0
    if (newOffset <= tracker.byteOffset) {
      // File truncated or no new data — re-read from start
      tracker.byteOffset = 0
      const allLines = this.readAndParse(filePath, 0)
      tracker.byteOffset = newOffset
      const { sanitizedName, sessionId } = info
      const project = this.projectIndexes.get(sanitizedName)
      if (project) {
        const meta = this.buildSessionMeta(sessionId, sanitizedName, allLines)
        project.sessions.set(sessionId, meta)
        this.send('session-updated', {
          projectSanitizedName: sanitizedName,
          sessionId,
          newLines: allLines,
          updatedMeta: meta
        })
      }
      return
    }

    // Read only new bytes
    const newLines = this.readAndParse(filePath, tracker.byteOffset)
    tracker.byteOffset = newOffset

    const { sanitizedName, sessionId } = info
    const project = this.projectIndexes.get(sanitizedName)
    if (!project) return

    // Incrementally update metadata instead of re-reading entire file
    const meta = project.sessions.get(sessionId)
    if (meta) {
      this.updateSessionMetaIncr(meta, newLines)
    }

    this.send('session-updated', {
      projectSanitizedName: sanitizedName,
      sessionId,
      newLines,
      updatedMeta: meta
    })
  }

  private handleFileUnlink(filePath: string): void {
    const info = this.parseFilePath(filePath)
    if (!info) return

    const { sanitizedName, sessionId } = info
    this.fileTrackers.delete(filePath)

    const project = this.projectIndexes.get(sanitizedName)
    if (project) {
      project.sessions.delete(sessionId)
    }

    if (this.isReady) {
      this.send('session-deleted', { projectSanitizedName: sanitizedName, sessionId })
    }
  }

  private handleReady(): void {
    this.isReady = true
    const snapshot = this.buildSnapshot()
    if (this.rendererReady) {
      this.send('initial-data', snapshot)
    } else {
      this.pendingInitialData = snapshot
    }
  }

  // ===== Helpers =====

  private handleMetaFileChange(filePath: string): void {
    const relative = path.relative(this.projectsDir, filePath)
    const parts = relative.split(path.sep)
    if (parts.length !== 2) return
    const sanitizedName = parts[0]

    try {
      const raw = fs.readFileSync(filePath, 'utf8')
      const meta = JSON.parse(raw)
      const sessionId = meta.sessionId
      const title: string | undefined = meta.title
      if (!sessionId) return

      const project = this.projectIndexes.get(sanitizedName)
      if (!project) return
      const session = project.sessions.get(sessionId)
      if (!session) return

      session.title = title || null
      if (this.isReady) {
        this.send('session-updated', {
          projectSanitizedName: sanitizedName,
          sessionId,
          newLines: [],
          updatedMeta: session
        })
      }
    } catch { /* ignore malformed meta.json */ }
  }

  /** Read title from meta.json for a session */
  private readMetaTitle(sanitizedName: string, sessionId: string): string | null {
    const dir = path.join(this.projectsDir, sanitizedName)
    // meta.json can be at the session level or project level
    // We look for per-session meta: <project>/<sessionId>.meta.json
    const metaPath = path.join(dir, `${sessionId}.meta.json`)
    try {
      const raw = fs.readFileSync(metaPath, 'utf8')
      const parsed = JSON.parse(raw)
      return parsed.title || null
    } catch {
      return null
    }
  }

  /** Write title to meta.json */
  updateSessionTitle(sanitizedName: string, sessionId: string, title: string): void {
    const dir = path.join(this.projectsDir, sanitizedName)
    const metaPath = path.join(dir, `${sessionId}.meta.json`)
    const data = { sessionId, title }
    fs.writeFileSync(metaPath, JSON.stringify(data, null, 2), 'utf8')

    // Update in-memory index immediately
    const project = this.projectIndexes.get(sanitizedName)
    if (project) {
      const session = project.sessions.get(sessionId)
      if (session) session.title = title
    }
  }

  /** Delete session: remove .jsonl, .meta.json, and clean up index */
  deleteSession(sanitizedName: string, sessionId: string): void {
    const dir = path.join(this.projectsDir, sanitizedName)
    const jsonlPath = path.join(dir, `${sessionId}.jsonl`)
    const metaPath = path.join(dir, `${sessionId}.meta.json`)

    try { fs.unlinkSync(jsonlPath) } catch { /* ignore */ }
    try { fs.unlinkSync(metaPath) } catch { /* ignore */ }

    // Clean up index — chokidar unlink will also do this but do it proactively
    this.fileTrackers.delete(jsonlPath)
    const project = this.projectIndexes.get(sanitizedName)
    if (project) project.sessions.delete(sessionId)

    this.send('session-deleted', { projectSanitizedName: sanitizedName, sessionId })
  }

  /** Return the real filesystem path for a project, falling back to unsanitizePath */
  getRealPath(sanitizedName: string): string {
    return this.projectIndexes.get(sanitizedName)?.realPath ?? unsanitizePath(sanitizedName)
  }

  /** Add a project: create directory and register in index */
  addProject(sanitizedName: string, realPath: string): void {
    if (this.projectIndexes.has(sanitizedName)) {
      // Already tracked — just emit to refresh UI
      return
    }
    const dir = path.join(this.projectsDir, sanitizedName)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    this.projectIndexes.set(sanitizedName, {
      sanitizedName,
      realPath,
      sessions: new Map()
    })
    this.send('project-added', { sanitizedName, realPath })
  }

  /** Delete a project: remove directory and clean up all index entries */
  deleteProject(sanitizedName: string): void {
    // Clean up file trackers for all sessions in this project
    const prefix = path.join(this.projectsDir, sanitizedName) + path.sep
    for (const [filePath] of this.fileTrackers) {
      if (filePath.startsWith(prefix)) {
        this.fileTrackers.delete(filePath)
      }
    }
    this.projectIndexes.delete(sanitizedName)

    // Remove directory from disk
    const dir = path.join(this.projectsDir, sanitizedName)
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }

    this.send('project-deleted', { sanitizedName })
  }

  private parseFilePath(filePath: string): { sanitizedName: string; sessionId: string } | null {
    const relative = path.relative(this.projectsDir, filePath)
    const parts = relative.split(path.sep)
    if (parts.length !== 2) return null
    const sanitizedName = parts[0]
    const fileName = parts[1]
    if (!fileName.endsWith('.jsonl')) return null
    const sessionId = fileName.replace('.jsonl', '')
    if (sessionId.startsWith('agent-')) return null
    return { sanitizedName, sessionId }
  }

  /** Incrementally update session metadata from new lines only */
  private updateSessionMetaIncr(meta: SessionMeta, newLines: JsonlLine[]): void {
    for (const line of newLines) {
      if (line.timestamp) {
        if (!meta.firstTimestamp) meta.firstTimestamp = line.timestamp
        meta.lastTimestamp = line.timestamp
      }
      if (line.type === 'user') {
        meta.userMessageCount++
        if (!meta.firstUserMessage && line.message?.content) {
          const content = line.message.content
          if (typeof content === 'string') {
            meta.firstUserMessage = content.slice(0, 100)
          } else if (Array.isArray(content)) {
            const textBlock = content.find((b: any) => b.type === 'text')
            if (textBlock && 'text' in textBlock) {
              meta.firstUserMessage = textBlock.text.slice(0, 100)
            }
          }
        }
        if ((line as any).cwd) meta.cwd = (line as any).cwd
        if ((line as any).gitBranch) meta.gitBranch = (line as any).gitBranch
      }
      if (line.type === 'assistant') {
        meta.assistantMessageCount++
        if (line.message?.model) meta.model = line.message.model
      }
    }
  }

  private readAndParse(filePath: string, startOffset: number): JsonlLine[] {
    try {
      const fd = fs.openSync(filePath, 'r')
      const stat = fs.fstatSync(fd)
      const bytesToRead = stat.size - startOffset
      if (bytesToRead <= 0) {
        fs.closeSync(fd)
        return []
      }
      const buffer = Buffer.alloc(bytesToRead)
      fs.readSync(fd, buffer, 0, bytesToRead, startOffset)
      fs.closeSync(fd)

      const text = buffer.toString('utf-8')
      const lines: JsonlLine[] = []
      for (const raw of text.split('\n')) {
        const trimmed = raw.trim()
        if (!trimmed) continue
        try {
          lines.push(JSON.parse(trimmed))
        } catch {
          // Skip corrupted/incomplete lines
        }
      }
      return lines
    } catch (err) {
      console.error(`Failed to read ${filePath}:`, err)
      return []
    }
  }

  private buildSessionMeta(sessionId: string, projectSanitizedName: string, lines: JsonlLine[]): SessionMeta {
    let firstTimestamp: string | null = null
    let lastTimestamp: string | null = null
    let userMessageCount = 0
    let assistantMessageCount = 0
    let cwd: string | null = null
    let gitBranch: string | null = null
    let model: string | null = null
    let firstUserMessage: string | null = null

    for (const line of lines) {
      if (line.timestamp) {
        if (!firstTimestamp) firstTimestamp = line.timestamp
        lastTimestamp = line.timestamp
      }

      if (line.type === 'user') {
        userMessageCount++
        if (!firstUserMessage && line.message?.content) {
          const content = line.message.content
          if (typeof content === 'string') {
            firstUserMessage = content.slice(0, 100)
          } else if (Array.isArray(content)) {
            const textBlock = content.find((b: any) => b.type === 'text')
            if (textBlock && 'text' in textBlock) {
              firstUserMessage = textBlock.text.slice(0, 100)
            }
          }
        }
        if ((line as any).cwd) cwd = (line as any).cwd
        if ((line as any).gitBranch) gitBranch = (line as any).gitBranch
      }

      if (line.type === 'assistant') {
        assistantMessageCount++
        if (line.message?.model) model = line.message.model
      }
    }

    return {
      sessionId,
      projectSanitizedName,
      firstTimestamp,
      lastTimestamp,
      userMessageCount,
      assistantMessageCount,
      cwd,
      gitBranch,
      model,
      firstUserMessage,
      title: this.readMetaTitle(projectSanitizedName, sessionId)
    }
  }

  private buildSnapshot(): { projects: { sanitizedName: string; realPath: string; sessions: SessionMeta[] }[] } {
    const projects: { sanitizedName: string; realPath: string; sessions: SessionMeta[] }[] = []
    for (const [, project] of this.projectIndexes) {
      projects.push({
        sanitizedName: project.sanitizedName,
        realPath: project.realPath,
        sessions: Array.from(project.sessions.values())
      })
    }
    // Sort projects by name
    projects.sort((a, b) => a.realPath.localeCompare(b.realPath))
    return { projects }
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
