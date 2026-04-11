import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Editor from '@monaco-editor/react'
import type { ProfileData } from '../../../shared/types'

type Selection =
  | { kind: 'current' }
  | { kind: 'profile'; id: string; editing: boolean }
  | { kind: 'new' }

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { t } = useTranslation()
  const [selection, setSelection] = useState<Selection>({ kind: 'current' })
  const [editorContent, setEditorContent] = useState('')
  const [liveConfig, setLiveConfig] = useState('')
  const [profiles, setProfiles] = useState<ProfileData[]>([])
  const [newProfileName, setNewProfileName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [lastAppliedId, setLastAppliedId] = useState<string | null>(
    () => localStorage.getItem('lastAppliedProfileId')
  )
  const [toast, setToast] = useState<string | null>(null)
  const newNameRef = useRef<HTMLInputElement>(null)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2000)
  }, [])

  const loadConfig = useCallback(async () => {
    try {
      const text = await window.electronAPI.readConfigFile()
      setLiveConfig(text)
      return text
    } catch {
      return '{\n}\n'
    }
  }, [])

  const loadProfiles = useCallback(async () => {
    try {
      const list = await window.electronAPI.listProfiles()
      setProfiles(list)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    if (!open) return
    loadConfig().then(text => {
      setEditorContent(text)
    })
    loadProfiles()
    setSelection({ kind: 'current' })
    setNewProfileName('')
    setRenamingId(null)
  }, [open, loadConfig, loadProfiles])

  // Focus new profile name input when entering 'new' mode
  useEffect(() => {
    if (selection.kind === 'new') {
      setTimeout(() => newNameRef.current?.focus(), 50)
    }
  }, [selection])

  // ===== Handlers =====

  const handleSaveConfig = useCallback(async () => {
    try {
      await window.electronAPI.writeConfigFile(editorContent)
      setLiveConfig(editorContent)
      showToast(t('settings.configSaved'))
    } catch {
      showToast(t('settings.configSaveError'))
    }
  }, [editorContent, t, showToast])

  const handleApplyProfile = useCallback(async (profile: ProfileData) => {
    try {
      await window.electronAPI.writeConfigFile(profile.content)
      setLiveConfig(profile.content)
      localStorage.setItem('lastAppliedProfileId', profile.id)
      setLastAppliedId(profile.id)
      showToast(t('settings.applied'))
    } catch {
      showToast(t('settings.configSaveError'))
    }
  }, [t, showToast])

  const handleSaveProfile = useCallback(async () => {
    if (selection.kind === 'new') {
      const name = newProfileName.trim()
      if (!name) { showToast('Enter a profile name'); return }
      try {
        await window.electronAPI.saveProfile({
          id: '',
          name,
          content: editorContent,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })
        await loadProfiles()
        showToast(t('settings.profileSaved'))
        setSelection({ kind: 'current' })
        setNewProfileName('')
      } catch {
        showToast(t('settings.configSaveError'))
      }
    } else if (selection.kind === 'profile' && selection.editing) {
      const profile = profiles.find(p => p.id === selection.id)
      if (!profile) return
      try {
        await window.electronAPI.saveProfile({ ...profile, content: editorContent })
        await loadProfiles()
        showToast(t('settings.profileSaved'))
        setSelection({ kind: 'profile', id: selection.id, editing: false })
      } catch {
        showToast(t('settings.configSaveError'))
      }
    }
  }, [selection, newProfileName, editorContent, profiles, loadProfiles, t, showToast])

  const handleDeleteProfile = useCallback(async (id: string) => {
    try {
      await window.electronAPI.deleteProfile(id)
      await loadProfiles()
      if (lastAppliedId === id) {
        localStorage.removeItem('lastAppliedProfileId')
        setLastAppliedId(null)
      }
      setSelection({ kind: 'current' })
      setEditorContent(liveConfig)
      showToast(t('settings.profileDeleted'))
    } catch { /* ignore */ }
  }, [lastAppliedId, liveConfig, loadProfiles, t, showToast])

  const handleCancelEdit = useCallback(() => {
    if (selection.kind === 'new') {
      setSelection({ kind: 'current' })
      setEditorContent(liveConfig)
      setNewProfileName('')
    } else if (selection.kind === 'profile' && selection.editing) {
      const profile = profiles.find(p => p.id === selection.id)
      setEditorContent(profile?.content || liveConfig)
      setSelection({ kind: 'profile', id: selection.id, editing: false })
    }
  }, [selection, profiles, liveConfig])

  const handleSelectProfile = useCallback((profile: ProfileData) => {
    setSelection({ kind: 'profile', id: profile.id, editing: false })
    setEditorContent(profile.content)
  }, [])

  const handleSelectCurrent = useCallback(() => {
    setSelection({ kind: 'current' })
    setEditorContent(liveConfig)
  }, [liveConfig])

  const handleStartNew = useCallback(() => {
    setSelection({ kind: 'new' })
    setEditorContent(liveConfig)
    setNewProfileName('')
  }, [liveConfig])

  const handleStartRename = useCallback((profile: ProfileData) => {
    setRenamingId(profile.id)
    setRenameValue(profile.name)
  }, [])

  const handleCommitRename = useCallback(async (id: string) => {
    const profile = profiles.find(p => p.id === id)
    if (!profile || !renameValue.trim()) { setRenamingId(null); return }
    try {
      await window.electronAPI.saveProfile({ ...profile, name: renameValue.trim() })
      await loadProfiles()
    } catch { /* ignore */ }
    setRenamingId(null)
  }, [profiles, renameValue, loadProfiles])

  if (!open) return null

  const selectedProfile = selection.kind === 'profile'
    ? profiles.find(p => p.id === selection.id)
    : null

  const isReadOnly = selection.kind === 'profile' && !selection.editing
  const isEditing = selection.kind === 'new' || (selection.kind === 'profile' && selection.editing)

  const monacoOptions = {
    minimap: { enabled: false },
    fontSize: 13,
    lineNumbers: 'on' as const,
    scrollBeyondLastLine: false,
    automaticLayout: true,
    tabSize: 2,
    wordWrap: 'on' as const,
    readOnly: isReadOnly
  }

  // Header label for the editor area
  let editorLabel: React.ReactNode
  if (selection.kind === 'current') {
    editorLabel = <span className="settings-editor-label">~/.claude/settings.json</span>
  } else if (selection.kind === 'new') {
    editorLabel = (
      <input
        ref={newNameRef}
        className="settings-name-input"
        placeholder={t('settings.profileNamePlaceholder')}
        value={newProfileName}
        onChange={e => setNewProfileName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') void handleSaveProfile() }}
      />
    )
  } else if (selectedProfile) {
    editorLabel = <span className="settings-editor-label">{selectedProfile.name}</span>
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog modal-settings" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{t('settings.title')}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="settings-layout">
          {/* ===== Left sidebar ===== */}
          <div className="settings-sidebar">
            {/* Current item */}
            <div
              className={`settings-current-item ${selection.kind === 'current' ? 'active' : ''}`}
              onClick={handleSelectCurrent}
            >
              <span className="settings-current-star">★</span>
              <span className="settings-current-label">Current</span>
              {lastAppliedId === null && <span className="settings-applied-mark">✓</span>}
            </div>

            <div className="settings-divider" />

            {/* Profile list */}
            <div className="settings-profile-list">
              {profiles.length === 0 && (
                <div className="settings-empty-hint">{t('settings.noProfiles')}</div>
              )}
              {profiles.map(p => (
                <ProfileRow
                  key={p.id}
                  profile={p}
                  isSelected={selection.kind === 'profile' && selection.id === p.id}
                  isApplied={lastAppliedId === p.id}
                  isRenaming={renamingId === p.id}
                  renameValue={renameValue}
                  onSelect={() => handleSelectProfile(p)}
                  onApply={() => void handleApplyProfile(p)}
                  onEdit={() => {
                    handleSelectProfile(p)
                    setSelection({ kind: 'profile', id: p.id, editing: true })
                  }}
                  onDelete={() => void handleDeleteProfile(p.id)}
                  onStartRename={() => handleStartRename(p)}
                  onRenameChange={setRenameValue}
                  onRenameCommit={() => void handleCommitRename(p.id)}
                  onRenameCancel={() => setRenamingId(null)}
                />
              ))}
            </div>

            {/* Add button */}
            <button
              className={`settings-add-btn ${selection.kind === 'new' ? 'active' : ''}`}
              onClick={handleStartNew}
            >
              + {t('settings.addProfile')}
            </button>
          </div>

          {/* ===== Right editor area ===== */}
          <div className="settings-main">
            <div className="settings-editor-header">
              {editorLabel}
            </div>

            <div className="settings-editor-body">
              <Editor
                height="100%"
                language="json"
                theme="vs-dark"
                value={editorContent}
                onChange={v => { if (v !== undefined) setEditorContent(v) }}
                options={monacoOptions}
              />
            </div>

            <div className="settings-action-bar">
              {selection.kind === 'current' && (
                <button className="btn" onClick={handleSaveConfig}>
                  {t('settings.saveConfig')}
                </button>
              )}
              {selection.kind === 'profile' && !selection.editing && selectedProfile && (
                <>
                  <button className="btn" onClick={() => void handleApplyProfile(selectedProfile)}>
                    {t('settings.applyProfile')}
                  </button>
                  <button className="btn" onClick={() => setSelection({ kind: 'profile', id: selection.id, editing: true })}>
                    {t('settings.editProfile')}
                  </button>
                  <button className="btn btn-danger" onClick={() => void handleDeleteProfile(selection.id)}>
                    {t('settings.deleteProfile')}
                  </button>
                </>
              )}
              {isEditing && (
                <>
                  <button className="btn" onClick={() => void handleSaveProfile()}>
                    {t('settings.saveProfile')}
                  </button>
                  <button className="btn" onClick={handleCancelEdit}>
                    {t('settings.cancel')}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

// ===== ProfileRow subcomponent =====

function ProfileRow({
  profile, isSelected, isApplied, isRenaming, renameValue,
  onSelect, onApply, onEdit, onDelete,
  onStartRename, onRenameChange, onRenameCommit, onRenameCancel
}: {
  profile: ProfileData
  isSelected: boolean
  isApplied: boolean
  isRenaming: boolean
  renameValue: string
  onSelect: () => void
  onApply: () => void
  onEdit: () => void
  onDelete: () => void
  onStartRename: () => void
  onRenameChange: (v: string) => void
  onRenameCommit: () => void
  onRenameCancel: () => void
}) {
  const renameRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (isRenaming) setTimeout(() => renameRef.current?.select(), 30)
  }, [isRenaming])

  return (
    <div
      className={`settings-profile-row ${isSelected ? 'active' : ''}`}
      onClick={onSelect}
    >
      {isRenaming ? (
        <input
          ref={renameRef}
          className="settings-rename-input"
          value={renameValue}
          onChange={e => onRenameChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.stopPropagation(); onRenameCommit() }
            if (e.key === 'Escape') { e.stopPropagation(); onRenameCancel() }
          }}
          onClick={e => e.stopPropagation()}
        />
      ) : (
        <span className="settings-profile-name" onDoubleClick={e => { e.stopPropagation(); onStartRename() }}>
          {profile.name || '(unnamed)'}
        </span>
      )}
      {isApplied && !isRenaming && <span className="settings-applied-mark">✓</span>}
      {!isRenaming && (
        <div className="settings-profile-actions">
          <button
            className="settings-profile-btn"
            title="Apply"
            onClick={e => { e.stopPropagation(); onApply() }}
          >
            ▶
          </button>
          <button
            className="settings-profile-btn"
            title="Edit"
            onClick={e => { e.stopPropagation(); onEdit() }}
          >
            ✎
          </button>
          <button
            className="settings-profile-btn settings-profile-btn-danger"
            title="Delete"
            onClick={e => { e.stopPropagation(); onDelete() }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
