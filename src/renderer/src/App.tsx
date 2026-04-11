import React, { useState, useCallback } from 'react'
import Sidebar from './components/Sidebar'
import MainContent from './components/MainContent'
import SettingsModal from './components/SettingsModal'
import { useSessionWatcher } from './hooks/useSessionWatcher'
import { useClaudeManager } from './hooks/useClaudeManager'
import type { SessionMeta, CodeViewContext } from '../../shared/types'

export type TabType = 'conversation' | 'terminal' | 'code'

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
}

const WORKSPACE_TRUST_PATTERN = /Accessing workspace:|Quick safety check|Yes,\s*I trust this folder|Enter to confirm/i

export default function App() {
  const sessionState = useSessionWatcher()
  const claudeState = useClaudeManager()
  const [activeTab, setActiveTab] = useState<TabType>('conversation')
  // Track the processKey for the "new session" terminal
  const [newSessionProcessKey, setNewSessionProcessKey] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [codeViewContext, setCodeViewContext] = useState<CodeViewContext | null>(null)

  const handleViewInCode = useCallback((filePath: string, oldContent: string, newContent: string) => {
    setCodeViewContext({ filePath, oldContent, newContent })
    setActiveTab('code')
  }, [])

  const handleNewSession = useCallback((project: string) => {
    setNewSessionProcessKey(null)
    sessionState.openProject(project)
    setActiveTab('conversation')
  }, [sessionState])

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

    const pk = await claudeState.connectNew(project)
    if (!pk) {
      sessionState.removePendingSession(tempId)
      sessionState.openProject(project)
      return
    }

    setNewSessionProcessKey(pk)

    const waitForPtyState = <T,>(matcher: (text: string) => T | null, timeoutMs: number) =>
      new Promise<T | null>((resolve) => {
        let settled = false
        let cleanup = () => {}

        const finish = (matched: T | null) => {
          if (settled) return
          settled = true
          cleanup()
          resolve(matched)
        }

        cleanup = window.electronAPI.onPtyData((payload) => {
          if (payload.processKey !== pk) return
          const matched = matcher(stripAnsi(payload.data))
          if (matched !== null) {
            finish(matched)
          }
        })

        window.setTimeout(() => finish(null), timeoutMs)
      })

    const firstState = await waitForPtyState<'trust' | 'output'>((text) => {
      if (!text.trim()) return null
      return WORKSPACE_TRUST_PATTERN.test(text) ? 'trust' : 'output'
    }, 2500)

    if (firstState === 'trust') {
      await waitForPtyState<boolean>((text) => {
        if (!text.trim()) return null
        return WORKSPACE_TRUST_PATTERN.test(text) ? null : true
      }, 5000)
      await new Promise((resolve) => window.setTimeout(resolve, 250))
    }

    if (model && model !== 'sonnet') {
      window.electronAPI.ptyWrite(pk, `/model ${model}\r`)
      await waitForPtyState<boolean>((text) => (/Set model to/i.test(text) ? true : null), 8000)
    }

    window.electronAPI.ptyWrite(pk, `${trimmed}\r`)
  }, [claudeState, sessionState])

  // Select session in sidebar: only load history, don't connect PTY
  const handleSelectSession = useCallback((project: string, sessionId: string) => {
    setNewSessionProcessKey(null)
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
