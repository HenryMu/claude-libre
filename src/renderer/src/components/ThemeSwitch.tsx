import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

type ThemePreference = 'system' | 'light' | 'dark'
type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'CC-GUI-theme'

const THEME_OPTIONS: Array<{ value: ThemePreference; icon: string }> = [
  { value: 'system', icon: '◐' },
  { value: 'light', icon: '☀' },
  { value: 'dark', icon: '☾' }
]

function readThemePreference(): ThemePreference {
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== 'system') return preference
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference)
  document.documentElement.dataset.theme = resolved
  document.documentElement.dataset.themePreference = preference
  return resolved
}

export default function ThemeSwitch() {
  const { t } = useTranslation()
  const [theme, setTheme] = useState<ThemePreference>(() => readThemePreference())
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(readThemePreference()))
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    setResolvedTheme(applyTheme(theme))
    window.localStorage.setItem(STORAGE_KEY, theme)

    if (theme !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const handleChange = () => setResolvedTheme(applyTheme('system'))
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [theme])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const current = THEME_OPTIONS.find((option) => option.value === theme) || THEME_OPTIONS[0]
  const getLabel = (value: ThemePreference | ResolvedTheme) => t(`theme.${value}`, { defaultValue: value })
  const resolvedLabel = t('theme.resolved', { theme: getLabel(resolvedTheme), defaultValue: `Resolved: ${getLabel(resolvedTheme)}` })

  return (
    <div className="theme-switch-wrapper" ref={ref}>
      <button
        className="theme-switch"
        title={`${getLabel(theme)} · ${resolvedLabel}`}
        onClick={() => setOpen(!open)}
      >
        <span>{current.icon}</span>
      </button>
      {open && (
        <div className="theme-dropdown">
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.value}
              className={`theme-dropdown-item ${option.value === theme ? 'active' : ''}`}
              onClick={() => {
                setTheme(option.value)
                setOpen(false)
              }}
            >
              <span>{option.icon}</span>
              <span>{getLabel(option.value)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
