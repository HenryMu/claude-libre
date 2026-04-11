import React, { useState, useCallback, useEffect, useRef } from 'react'
import Sidebar from './components/Sidebar'
import MainContent from './components/MainContent'
import SettingsModal from './components/SettingsModal'
import { useSessionWatcher } from './hooks/useSessionWatcher'
import { useClaudeManager } from './hooks/useClaudeManager'
import type { SessionMeta, CodeViewContext } from '../../shared/types'

export type TabType = 'conversation' | 'terminal' | 'code'

interface PendingConversationStartup {
  tempId: string
  project: string
  message: string
  model: string
  retryCount: number
  processKey: string | null
  submitted: boolean
}

type PtyWaitResult<T> =
  | { status: 'matched'; value: T }
  | { status: 'timeout' }
  | { status: 'exited' }

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
}

const WORKSPACE_TRUST_PATTERN = /Accessing workspace:|Quick safety check|Yes,\s*I trust this folder|Enter to confirm/i
const NEW_SESSION_RETRY_LIMIT = 1

export default function App() {
  const sessionState = useSessionWatcher()
  const claudeState = useClaudeManager()
  const [activeTab, setActiveTab] = useState<TabType>('conversation')
  // Track the processKey for the "new session" terminal
  const [newSessionProcessKey, setNewSessionProcessKey] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [codeViewContext, setCodeViewContext] = useState<CodeViewContext | null>(null)
  const pendingStartupRef = useRef<PendingConversationStartup | null>(null)

  const handleViewInCode = useCallback((filePath: string, oldContent: string, newContent: string) => {
    setCodeViewContext({ filePath, oldContent, newContent })
    setActiveTab('code')
  }, [])

  const handleNewSession = useCallback((project: string) => {
    setNewSessionProcessKey(null)
    pendingStartupRef.current = null
    sessionState.openProject(project)
    setActiveTab('conversation')
  }, [sessionState])

  const waitForPtyState = useCallback(<T,>(processKey: string, matcher: (text: string) => T | null, timeoutMs: number) => (
    new Promise<PtyWaitResult<T>>((resolve) => {
      let settled = false
      let cleanupData = () => {}
      let cleanupExit = () => {}
      let timeoutId: number | null = null

      const finish = (result: PtyWaitResult<T>) => {
        if (settled) return
        settled = true
        cleanupData()
        cleanupExit()
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId)
        }
        resolve(result)
      }

      cleanupData = window.electronAPI.onPtyData((payload) => {
        if (payload.processKey !== processKey) return
        const matched = matcher(stripAnsi(payload.data))
        if (matched !== null) {
          finish({ status: 'matched', value: matched })
        }
      })

      cleanupExit = window.electronAPI.onPtyExited((payload) => {
        if (payload.processKey !== processKey) return
        finish({ status: 'exited' })
      })

      timeoutId = window.setTimeout(() => finish({ status: 'timeout' }), timeoutMs)
    })
  ), [])

  const clearPendingStartup = useCallback((tempId: string, project: string) => {
    const processKeyToClear = pendingStartupRef.current?.tempId === tempId
      ? pendingStartupRef.current.processKey
      : null

    if (pendingStartupRef.current?.tempId === tempId) {
      pendingStartupRef.current = null
    }
    setNewSessionProcessKey((current) => (
      current === processKeyToClear ? null : current
    ))
    sessionState.removePendingSession(tempId)
    if (sessionState.selectedProject === project) {
      sessionState.openProject(project)
    }
  }, [sessionState])

  const startPendingConversation = useCallback(async (startup: PendingConversationStartup) => {
    const pk = await claudeState.connectNew(startup.project)
    if (!pk) return 'failed' as const

    pendingStartupRef.current = { ...startup, processKey: pk, submitted: false }
    setNewSessionProcessKey(pk)

    const firstState = await waitForPtyState<'trust' | 'output'>(pk, (text) => {
      if (!text.trim()) return null
      return WORKSPACE_TRUST_PATTERN.test(text) ? 'trust' : 'output'
    }, 2500)

    if (firstState.status === 'exited') return 'retryable_exit' as const

    if (firstState.status === 'matched' && firstState.value === 'trust') {
      const trustResolved = await waitForPtyState<boolean>(pk, (text) => {
        if (!text.trim()) return null
        return WORKSPACE_TRUST_PATTERN.test(text) ? null : true
      }, 5000)

      if (trustResolved.status === 'exited') return 'retryable_exit' as const
      await new Promise((resolve) => window.setTimeout(resolve, 250))
    }

    if (startup.model && startup.model !== 'sonnet') {
      window.electronAPI.ptyWrite(pk, `/model ${startup.model}\r`)
      const modelResolved = await waitForPtyState<boolean>(pk, (text) => (/Set model to/i.test(text) ? true : null), 8000)
      if (modelResolved.status === 'exited') return 'retryable_exit' as const
    }

    const currentStartup = pendingStartupRef.current
    if (!currentStartup || currentStartup.tempId !== startup.tempId || currentStartup.processKey !== pk) {
      return 'cancelled' as const
    }

    window.electronAPI.ptyWrite(pk, `${startup.message}\r`)
    pendingStartupRef.current = { ...currentStartup, submitted: true }
    return 'submitted' as const
  }, [claudeState, waitForPtyState])

  const handleStartConversation = useCallback(async (project: string, message: string, model: string) => {
    const trimmed = message.trim()
    if (!trimmed) return

    const tempId = `__pending_${Date.now()}`
    const now = new Date().toISOString()
    const pendingMeta: SessionMeta = {
      sessionId: tempId,
      projectSanitizedName: project,
      firstTimestamp: now,
      lastTimestamp: now,
      userMessageCount: 1,
      assistantMessageCount: 0,
      cwd: null,
      gitBranch: null,
      model,
      firstUserMessage: trimmed,
      title: trimmed.slice(0, 80)
    }

    sessionState.addPendingSession(project, pendingMeta)
    sessionState.selectSession(project, tempId)
    setActiveTab('conversation')
    const startup: PendingConversationStartup = {
      tempId,
      project,
      message: trimmed,
      model,
      retryCount: 0,
      processKey: null,
      submitted: false
    }

    pendingStartupRef.current = startup

    const result = await startPendingConversation(startup)
    if (result === 'failed') {
      clearPendingStartup(tempId, project)
    }
  }, [clearPendingStartup, sessionState, startPendingConversation])

  // Select session in sidebar: only load history, don't connect PTY
  const handleSelectSession = useCallback((project: string, sessionId: string) => {
    setNewSessionProcessKey(null)
    pendingStartupRef.current = null
    sessionState.selectSession(project, sessionId)
    setActiveTab('conversation')
  }, [sessionState])

  const handleAddProject = useCallback(async () => {
    try {
      return await window.electronAPI.addProject()
    } catch (err) {
      console.error('Failed to add project:', err)
      return null
    }
  }, [])

  const handleDeleteProject = useCallback(async (projectSanitizedName: string) => {
    try {
      await window.electronAPI.deleteProject(projectSanitizedName)
    } catch (err) {
      console.error('Failed to delete project:', err)
    }
  }, [])

  useEffect(() => {
    const cleanup = window.electronAPI.onPtyExited((payload) => {
      const startup = pendingStartupRef.current

      if (!startup || payload.processKey !== startup.processKey) {
        if (payload.processKey === newSessionProcessKey) {
          setNewSessionProcessKey(null)
        }
        return
      }

      if (sessionState.selectedSession !== startup.tempId) {
        pendingStartupRef.current = null
        if (payload.processKey === newSessionProcessKey) {
          setNewSessionProcessKey(null)
        }
        return
      }

      if (startup.retryCount < NEW_SESSION_RETRY_LIMIT) {
        void startPendingConversation({
          ...startup,
          retryCount: startup.retryCount + 1,
          processKey: null,
          submitted: false
        }).then((result) => {
          if (result === 'failed') {
            clearPendingStartup(startup.tempId, startup.project)
          }
        })
        return
      }

      clearPendingStartup(startup.tempId, startup.project)
    })

    return cleanup
  }, [clearPendingStartup, newSessionProcessKey, sessionState.selectedProject, sessionState.selectedSession, startPendingConversation])

  useEffect(() => {
    const startup = pendingStartupRef.current
    if (!startup) return
    if (sessionState.selectedSession === startup.tempId) return
    pendingStartupRef.current = null
  }, [sessionState.selectedSession])

  return (
    <div className="app-layout">
      <Sidebar
        projects={sessionState.projects}
        pendingSessions={sessionState.pendingSessions}
        selectedProject={sessionState.selectedProject}
        selectedSession={sessionState.selectedSession}
        activeProcesses={claudeState.activeProcesses}
        connections={claudeState.connections}
        onSelectProject={sessionState.selectProject}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        onOpenSettings={() => setSettingsOpen(true)}
        onAddProject={handleAddProject}
        onDeleteProject={handleDeleteProject}
      />
      <MainContent
        sessionState={sessionState}
        claudeState={claudeState}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        newSessionProcessKey={newSessionProcessKey}
        onStartConversation={handleStartConversation}
        onAddProject={handleAddProject}
        codeViewContext={codeViewContext}
        onViewInCode={handleViewInCode}
        onClearCodeView={() => setCodeViewContext(null)}
      />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
