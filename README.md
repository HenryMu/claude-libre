# Claude Code Desktop

A desktop application for managing and interacting with [Claude Code](https://docs.anthropic.com/en/docs/claude-code) sessions. Built with Electron + React + TypeScript.

![Claude Code Desktop](https://img.shields.io/badge/Electron-34-black?logo=electron) ![React](https://img.shields.io/badge/React-19-blue?logo=react) ![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript) ![License](https://img.shields.io/badge/License-MIT-green)

## Features

- **Session Browser** — Automatically discovers all Claude Code projects and sessions from `~/.claude/projects/`
- **Real-time Sync** — Watches `.jsonl` session files for changes, auto-updates as conversations progress
- **Conversation View** — Formatted message display with collapsible thinking blocks and tool call cards
- **Terminal Integration** — Full `xterm.js` terminal for direct CLI interaction with Claude Code
- **Session Resume** — Click any session to resume it via `claude --resume <session-id>`
- **Permission Prompts** — Interactive Allow/Always/Deny buttons when Claude Code requests tool permissions
- **Cross-platform** — Works on Windows, macOS, and Linux

## Screenshots

_Sidebar with project list and session history:_

- Left panel shows all projects with session counts
- Each session displays first message preview, timestamp, model info
- Active sessions indicated with green dot

_Tab-based main content:_

- **Conversation tab**: Formatted message history + input bar for sending messages
- **Terminal tab**: Raw xterm.js terminal for direct interaction

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and configured

### Install

```bash
git clone https://github.com/HenryMu/claude-code-desktop.git
cd claude-code-desktop
npm install
```

### Development

```bash
npm run dev
```

### Build

```bash
npm run build
```

## Architecture

```
src/
├── shared/types.ts              # Shared TypeScript types (IPC, JSONL, Session)
├── main/
│   ├── index.ts                 # Electron main process entry
│   ├── ipc-handlers.ts          # IPC channel registration
│   ├── session-watcher.ts       # File watcher + incremental JSONL parser
│   ├── claude-manager.ts        # node-pty process lifecycle manager
│   └── path-utils.ts            # Cross-platform path sanitize/unsanitize
├── preload/
│   └── index.ts                 # contextBridge API
└── renderer/
    ├── index.html
    └── src/
        ├── App.tsx              # Root layout with tab state
        ├── components/
        │   ├── Sidebar.tsx      # Project tree + session list
        │   └── MainContent.tsx  # Conversation + Terminal tabs
        ├── hooks/
        │   ├── useSessionWatcher.ts  # Session data IPC listener
        │   └── useClaudeManager.ts   # PTY process management
        └── styles/
            └── global.css       # Catppuccin dark theme
```

### Core Modules

#### `session-watcher.ts`

Monitors `~/.claude/projects/**/*.jsonl` using [chokidar](https://github.com/paulmillr/chokidar):

- **Incremental parsing**: Tracks `byteOffset` per file, reads only new bytes on change
- **Auto-debounce**: Uses `awaitWriteFinish: { stabilityThreshold: 300 }` to batch streaming writes
- **Incremental metadata**: Updates session stats (message count, timestamps) without re-reading the full file
- **Agent filtering**: Skips `agent-*.jsonl` sub-agent sessions

#### `claude-manager.ts`

Manages `claude` CLI processes via [node-pty](https://github.com/microsoft/node-pty):

- **Single-process constraint**: `Map<projectName, ProcessEntry>` ensures one active PTY per project
- **Cross-platform spawn**: On Windows, uses `cmd.exe /c claude` for `.cmd` compatibility; on Unix, spawns `claude` directly
- **Process lifecycle**: `spawn()`, `resume()`, `kill()` with 3-second safety timeout for force-kill

### IPC Channels

| Channel | Direction | Description |
|---------|-----------|-------------|
| `initial-data` | Main → Renderer | Full project/session snapshot |
| `session-updated` | Main → Renderer | Incremental JSONL lines + updated metadata |
| `session-created` | Main → Renderer | New session file detected |
| `session-deleted` | Main → Renderer | Session file removed |
| `pty-data` | Main → Renderer | PTY stdout data |
| `pty-spawned` | Main → Renderer | PTY process started |
| `pty-exited` | Main → Renderer | PTY process exited |
| `spawn-claude` | Renderer → Main | Start new session |
| `resume-session` | Renderer → Main | Resume existing session |
| `kill-claude` | Renderer → Main | Terminate PTY process |
| `pty-write` | Renderer → Main | Write to PTY stdin |
| `pty-resize` | Renderer → Main | Resize PTY dimensions |
| `get-session-details` | Renderer → Main | Query full session data |

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Desktop Framework | [Electron](https://www.electronjs.org/) 34 |
| Build Tool | [electron-vite](https://electron-vite.org/) |
| Frontend | [React](https://react.dev/) 19 + [TypeScript](https://www.typescriptlang.org/) |
| Terminal | [xterm.js](https://xtermjs.org/) + [node-pty](https://github.com/microsoft/node-pty) |
| File Watching | [chokidar](https://github.com/paulmillr/chokidar) |
| Styling | CSS (Catppuccin dark theme) |

## Path Mapping

Claude Code stores projects with sanitized directory names:

| Real Path | Sanitized Name |
|-----------|---------------|
| `E:\code\claudeDesktop` | `E--code-claudeDesktop` |
| `C:\Users\alice` | `C--Users-alice` |
| `/home/user/project` | `-home-user-project` |

Claude Code Desktop reverses this mapping to resolve the correct working directory for PTY processes.

## License

MIT
