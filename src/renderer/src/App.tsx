import React, { useState, useCallback } from 'react'
import Sidebar from './components/Sidebar'
import MainContent from './components/MainContent'
import { useSessionWatcher } from './hooks/useSessionWatcher'
import { useClaudeManager } from './hooks/useClaudeManager'

export type TabType = 'conversation' | 'terminal'

export default function App() {
  const sessionState = useSessionWatcher()
  const claudeState = useClaudeManager()
  const [activeTab, setActiveTab] = useState<TabType>('conversation')
  // Track the processKey for the "new session" terminal
  const [newSessionProcessKey, setNewSessionProcessKey] = useState<string | null>(null)

  // New session: spawn PTY immediately, switch to terminal tab
  const handleNewSession = useCallback(async (project: string) => {
    const pk = await claudeState.connectNew(project)
    if (pk) {
      setNewSessionProcessKey(pk)
      sessionState.selectProject(project)
      setActiveTab('terminal')
    }
  }, [claudeState, sessionState])

  // Select session in sidebar: only load history, don't connect PTY
  const handleSelectSession = useCallback((project: string, sessionId: string) => {
    setNewSessionProcessKey(null)
    sessionState.selectSession(project, sessionId)
    setActiveTab('conversation')
  }, [sessionState])

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
      />
      <MainContent
        sessionState={sessionState}
        claudeState={claudeState}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        newSessionProcessKey={newSessionProcessKey}
      />
    </div>
  )
}
