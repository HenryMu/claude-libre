import React from 'react'
import Sidebar from './components/Sidebar'
import MainContent from './components/MainContent'
import { useSessionWatcher } from './hooks/useSessionWatcher'
import { useClaudeManager } from './hooks/useClaudeManager'

export default function App() {
  const sessionState = useSessionWatcher()
  const claudeState = useClaudeManager()

  return (
    <div className="app-layout">
      <Sidebar
        projects={sessionState.projects}
        selectedProject={sessionState.selectedProject}
        selectedSession={sessionState.selectedSession}
        activeProcesses={claudeState.activeProcesses}
        onSelectProject={sessionState.selectProject}
        onSelectSession={sessionState.selectSession}
        onNewSession={claudeState.spawn}
        onResumeSession={claudeState.resume}
      />
      <MainContent
        sessionState={sessionState}
        claudeState={claudeState}
      />
    </div>
  )
}
