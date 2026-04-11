import React, { useState, useCallback } from 'react'
import Sidebar from './components/Sidebar'
import MainContent from './components/MainContent'
import SettingsModal from './components/SettingsModal'
import { useSessionWatcher } from './hooks/useSessionWatcher'
import { useClaudeManager } from './hooks/useClaudeManager'
import type { SessionMeta, CodeViewContext } from '../../shared/types'

export type TabType = 'conversation' | 'terminal' | 'code'

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

    const sendLine = (text: string, delay: number) => {
      window.setTimeout(() => window.electronAPI.ptyWrite(pk, `${text}\r`), delay)
    }

    let nextDelay = 1400
    if (model && model !== 'sonnet') {
      sendLine(`/model ${model}`, nextDelay)
      nextDelay += 550
    }
    sendLine(trimmed, nextDelay)
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
