import path from 'path'

/**
 * Sanitize a real filesystem path into a Claude projects directory name.
 * E:\code\claudeDesktop → E--code-claudeDesktop
 * /home/user/proj   → -home-user-proj
 */
export function sanitizePath(realPath: string): string {
  if (process.platform === 'win32') {
    // E:\code\claudeDesktop → E--code-claudeDesktop
    return realPath
      .replace(/:\s*/g, '-')
      .replace(/[/\\]+/g, '-')
  } else {
    // /home/user/proj → -home-user-proj
    return realPath
      .replace(/^\//, '')
      .replace(/\/+/g, '-')
      .replace(/^/, '-')
  }
}

/**
 * Un-sanitize a Claude projects directory name back to a real path.
 * E--code-claudeDesktop → E:\code\claudeDesktop
 * -home-user-proj    → /home/user/proj
 */
export function unsanitizePath(sanitizedName: string): string {
  if (process.platform === 'win32') {
    // E--code-claudeDesktop → E:\code\claudeDesktop
    const match = sanitizedName.match(/^([A-Za-z])--(.*)$/)
    if (match) {
      return match[1] + ':\\' + match[2].replace(/-/g, '\\')
    }
    // Fallback: return as-is
    return sanitizedName
  } else {
    // -home-user-proj → /home/user/proj
    if (sanitizedName.startsWith('-')) {
      return '/' + sanitizedName.slice(1).replace(/-/g, '/')
    }
    return sanitizedName
  }
}

/**
 * Get the projects directory path under the user's home.
 */
export function getProjectsDir(homeDir: string): string {
  return path.join(homeDir, '.claude', 'projects')
}
