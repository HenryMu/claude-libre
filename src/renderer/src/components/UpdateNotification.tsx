import React, { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { UpdateStatus, UpdateInfoPayload } from '../../../shared/types'

export default function UpdateNotification() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<UpdateStatus>('idle')
  const [updateInfo, setUpdateInfo] = useState<UpdateInfoPayload | null>(null)
  const [progress, setProgress] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')
  const [dismissed, setDismissed] = useState(false)

  const handleUpdateAvailable = useCallback((info: UpdateInfoPayload) => {
    setUpdateInfo(info)
    setStatus('available')
    setDismissed(false)
  }, [])

  const handleProgress = useCallback((data: { percent: number }) => {
    setProgress(data.percent)
    setStatus('downloading')
  }, [])

  const handleDownloaded = useCallback(() => {
    setStatus('downloaded')
    setDismissed(false)
  }, [])

  const handleError = useCallback((data: { message: string }) => {
    setErrorMessage(data.message)
    // Only show error in UI if user triggered the check
    if (status === 'checking') {
      setStatus('error')
    }
  }, [status])

  useEffect(() => {
    const unavail = window.electronAPI.onUpdateAvailable(handleUpdateAvailable)
    const unprog = window.electronAPI.onUpdateProgress(handleProgress)
    const undld = window.electronAPI.onUpdateDownloaded(handleDownloaded)
    const unerr = window.electronAPI.onUpdateError(handleError)

    return () => {
      unavail()
      unprog()
      undld()
      unerr()
    }
  }, [handleUpdateAvailable, handleProgress, handleDownloaded, handleError])

  const handleCheckForUpdates = async () => {
    setStatus('checking')
    setErrorMessage('')
    try {
      const result = await window.electronAPI.checkForUpdates()
      if (result.error) {
        setErrorMessage(result.error)
        setStatus('error')
      } else if (!result.updateInfo) {
        setStatus('idle')
      }
    } catch (err: any) {
      setErrorMessage(err.message)
      setStatus('error')
    }
  }

  const handleDownload = async () => {
    setStatus('downloading')
    setProgress(0)
    await window.electronAPI.downloadUpdate()
  }

  const handleInstall = () => {
    window.electronAPI.quitAndInstall()
  }

  // Idle or dismissed — render nothing
  if (status === 'idle' || (dismissed && status !== 'downloading' && status !== 'downloaded')) {
    return null
  }

  return (
    <div className="update-notification">
      {status === 'checking' && (
        <div className="update-notification-inner">
          <span className="update-icon">{'\u{1F504}'}</span>
          <span className="update-text">{t('update.checking', 'Checking for updates...')}</span>
        </div>
      )}

      {status === 'available' && updateInfo && (
        <div className="update-notification-inner">
          <span className="update-icon">{'\u{2B06}'}</span>
          <span className="update-text">
            {t('update.available', 'New version {{version}} available', { version: updateInfo.version })}
          </span>
          <button className="update-btn update-btn-primary" onClick={handleDownload}>
            {t('update.download', 'Download')}
          </button>
          <button className="update-btn update-btn-ghost" onClick={() => setDismissed(true)}>
            {t('update.later', 'Later')}
          </button>
        </div>
      )}

      {status === 'downloading' && (
        <div className="update-notification-inner">
          <span className="update-icon">{'\u{23F3}'}</span>
          <span className="update-text">
            {t('update.downloading', 'Downloading update... {{progress}}%', { progress })}
          </span>
          <div className="update-progress-bar">
            <div className="update-progress-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {status === 'downloaded' && (
        <div className="update-notification-inner">
          <span className="update-icon">{'\u{2705}'}</span>
          <span className="update-text">
            {t('update.downloaded', 'Update {{version}} ready to install', {
              version: updateInfo?.version ?? ''
            })}
          </span>
          <button className="update-btn update-btn-primary" onClick={handleInstall}>
            {t('update.install', 'Restart & Install')}
          </button>
          <button className="update-btn update-btn-ghost" onClick={() => setDismissed(true)}>
            {t('update.later', 'Later')}
          </button>
        </div>
      )}

      {status === 'error' && (
        <div className="update-notification-inner">
          <span className="update-icon">{'\u{26A0}'}</span>
          <span className="update-text update-text-error">{errorMessage}</span>
          <button className="update-btn update-btn-ghost" onClick={() => { setStatus('idle'); setErrorMessage('') }}>
            {t('update.dismiss', 'Dismiss')}
          </button>
        </div>
      )}
    </div>
  )
}
