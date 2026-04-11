import React, { useState, useCallback } from 'react'
import Sidebar from './components/Sidebar'
import MainContent from './components/MainContent'
import SettingsModal from './components/SettingsModal'
import { useSessionWatcher } from './hooks/useSessionWatcher'
import { useClaudeManager } from './hooks/useClaudeManager'

export type TabType = 'conversation' | 'terminal'

export default function App() {
  const sessionState = useSessionWatcher()
  const claudeState = useClaudeManager()
  const [activeTab, setActiveTab] = useState<TabType>('conversation')
  // Track the processKey for the "new session" terminal
  const [newSessionProcessKey, setNewSessionProcessKey] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

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

  const handleAddProject = useCallback(async () => {
    try {
      await window.electronAPI.addProject()
    } catch (err) {
      console.error('Failed to add project:', err)
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
      />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
