import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import type { ClaudeConfig, ProfileData } from '../shared/types'

const CONFIG_KEYS: (keyof ClaudeConfig)[] = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL'
]

export function getConfigPath(home: string): string {
  return path.join(home, '.claude', 'settings.json')
}

export function getProfilesDir(home: string): string {
  return path.join(home, '.claude-libre', 'profiles')
}

export function readConfigFile(home: string): string {
  const configPath = getConfigPath(home)
  try {
    return fs.readFileSync(configPath, 'utf8')
  } catch {
    return '{\n}\n'
  }
}

export function writeConfigFile(home: string, content: string): void {
  const configPath = getConfigPath(home)
  const dir = path.dirname(configPath)
  fs.mkdirSync(dir, { recursive: true })

  const tmpPath = configPath + '.tmp'
  fs.writeFileSync(tmpPath, content, 'utf8')
  try {
    fs.renameSync(tmpPath, configPath)
  } catch {
    fs.writeFileSync(configPath, content, 'utf8')
    try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
  }
}

export function readClaudeConfig(home: string): ClaudeConfig {
  const configPath = getConfigPath(home)
  try {
    const raw = fs.readFileSync(configPath, 'utf8')
    const parsed = JSON.parse(raw)
    const config: ClaudeConfig = {}
    for (const key of CONFIG_KEYS) {
      if (parsed[key] !== undefined) {
        config[key] = parsed[key]
      }
    }
    return config
  } catch {
    return {}
  }
}

export function writeClaudeConfig(home: string, config: ClaudeConfig): void {
  const configPath = getConfigPath(home)
  const dir = path.dirname(configPath)
  fs.mkdirSync(dir, { recursive: true })

  // Read existing file to preserve unknown keys
  let existing: Record<string, unknown> = {}
  try {
    existing = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  } catch {
    // file doesn't exist yet
  }

  // Merge: update known keys, remove empty-string values
  for (const key of CONFIG_KEYS) {
    const val = config[key]
    if (val && val.trim()) {
      existing[key] = val.trim()
    } else {
      delete existing[key]
    }
  }

  // Atomic write: tmp + rename
  const tmpPath = configPath + '.tmp'
  fs.writeFileSync(tmpPath, JSON.stringify(existing, null, 2), 'utf8')
  try {
    fs.renameSync(tmpPath, configPath)
  } catch {
    // Windows may fail rename if file is locked; fallback to direct write
    fs.writeFileSync(configPath, JSON.stringify(existing, null, 2), 'utf8')
    try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
  }
}

export function listProfiles(home: string): ProfileData[] {
  const profilesDir = getProfilesDir(home)
  try {
    fs.mkdirSync(profilesDir, { recursive: true })
    const files = fs.readdirSync(profilesDir).filter(f => f.endsWith('.json'))
    const profiles: ProfileData[] = []
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(profilesDir, file), 'utf8')
        profiles.push(JSON.parse(raw))
      } catch { /* skip malformed */ }
    }
    return profiles.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  } catch {
    return []
  }
}

export function saveProfile(home: string, profile: ProfileData): void {
  const profilesDir = getProfilesDir(home)
  fs.mkdirSync(profilesDir, { recursive: true })

  const now = new Date().toISOString()
  const toSave: ProfileData = {
    id: profile.id || crypto.randomUUID(),
    name: profile.name,
    content: profile.content,
    updatedAt: now,
    createdAt: profile.createdAt || now
  }

  fs.writeFileSync(
    path.join(profilesDir, `${toSave.id}.json`),
    JSON.stringify(toSave, null, 2),
    'utf8'
  )
}

export function deleteProfile(home: string, profileId: string): void {
  const filePath = path.join(getProfilesDir(home), `${profileId}.json`)
  try {
    fs.unlinkSync(filePath)
  } catch { /* ignore if not found */ }
}
