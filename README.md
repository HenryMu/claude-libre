# Claude Code Desktop

**[English](./README.md)** | **[中文](./README.zh-CN.md)** | **[日本語](./README.ja.md)** | **[한국어](./README.ko.md)**

> **Community Open Source Project** — This is a free, open-source desktop GUI for the [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI.
> It is **NOT** the official [Claude Desktop](https://claude.ai/download) app by Anthropic (which requires a paid subscription).
> This project is MIT-licensed and is not affiliated with, endorsed by, or connected to Anthropic.

![Electron](https://img.shields.io/badge/Electron-34-black?logo=electron) ![React](https://img.shields.io/badge/React-19-blue?logo=react) ![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript) ![License](https://img.shields.io/badge/License-MIT-green)

![Screenshot](./screenshot.png)

## Features

- **Project & Session Browser** — Automatically discovers Claude Code projects and sessions from `~/.claude/projects/`
- **Instant New Sessions** — Pick a workspace, choose a model, type your first prompt, and create a new session directly from the conversation page
- **Real-time Sync** — Watches `.jsonl` session files for changes, auto-updates as conversations progress
- **Conversation View** — Formatted message display with collapsible thinking blocks and tool call cards
- **Code Tab** — Browse project files and inspect Claude Code `Write` / `Edit` changes with a Monaco-powered viewer and diff editor
- **Terminal Integration** — Full `xterm.js` terminal for direct CLI interaction with Claude Code
- **Session Resume** — Click any session to resume it via `claude --resume <session-id>`
- **Model & Effort Controls** — Switch models, set thinking effort, and use slash-command autocomplete from the input toolbar
- **Smart Permission Handling** — Interactive Allow/Always/Deny controls plus automatic confirmation for Claude Code trusted-workspace prompts
- **Themes** — Dark mode, polished light mode, and a system-following default with a quick theme switcher
- **Profiles & Settings** — Manage Claude config and reusable profiles from the built-in settings panel
- **Multilingual UI** — English, Simplified Chinese, Traditional Chinese, Japanese, Korean, Hindi, and Portuguese
- **Cross-platform** — Works on Windows, macOS, and Linux

## What's New in v1.0.2

- Added system-aware light/dark theme switching with a refined light sidebar and message styling
- Added a new-session draft panel: choose a folder, select a model, and send the first prompt to auto-create the session
- Added Code tab support for project file browsing and Monaco-based edit/write previews
- Added model/effort selectors, slash-command autocomplete, and improved permission/workspace confirmation handling

## Why This Project?

Claude Code is an incredibly powerful CLI tool — but not everyone lives in the terminal.

As developers, we wanted a more visual way to manage multiple sessions, browse conversation history, and keep an overview of our projects. Switching between terminal tabs and scrolling through long outputs gets old fast.

So we built Claude Code Desktop — a free, open-source GUI that wraps the Claude Code CLI you already know and love. No subscription needed beyond your Claude Code CLI access. Just install, connect, and go.

**The goal is simple:** make Claude Code more accessible and productive for everyone, while keeping it 100% free and open source.

## How Is This Different from Claude Desktop?

| | Claude Desktop (Official by Anthropic) | Claude Code Desktop (This Project) |
|---|---|---|
| **Type** | Official Anthropic product | Third-party community project |
| **Cost** | Requires Claude Pro / Max subscription | **Free & Open Source** (MIT License) |
| **Interface** | Chat-focused GUI | Terminal + Conversation hybrid GUI |
| **Backend** | Anthropic API directly | Claude Code CLI |
| **Open Source** | Closed source | **Fully open source** |
| **Target Users** | General users | Developers using Claude Code CLI |

Both are great tools — they just serve different needs. If you want a polished chat experience with Claude, use the official Claude Desktop. If you're a developer who lives in Claude Code CLI and wants a visual manager for your sessions, give this a try.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and configured

### Install

```bash
git clone https://github.com/HenryMu/Claude-Code-GUI.git
cd Claude-Code-GUI
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

### macOS: Bypass Gatekeeper

Since this app is not signed with an Apple Developer certificate, macOS will show a security warning. To open it:

1. Right-click the app → select **Open**
2. Click **Open** again in the dialog

Or run this in Terminal:

```bash
xattr -cr /Applications/Claude\ Code\ Desktop.app
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
        │   ├── MainContent.tsx  # Conversation + Terminal + Code tabs
        │   ├── ThemeSwitch.tsx  # Light/dark/system theme switcher
        │   ├── LangSwitch.tsx   # Language switcher
        │   └── SettingsModal.tsx # Config editor + profile manager
        ├── hooks/
        │   ├── useSessionWatcher.ts  # Session data IPC listener
        │   └── useClaudeManager.ts   # PTY process management
        └── styles/
            └── global.css       # Dark/light themes and app styling
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Desktop Framework | [Electron](https://www.electronjs.org/) 34 |
| Build Tool | [electron-vite](https://electron-vite.org/) |
| Frontend | [React](https://react.dev/) 19 + [TypeScript](https://www.typescriptlang.org/) |
| Terminal | [xterm.js](https://xtermjs.org/) + [node-pty](https://github.com/microsoft/node-pty) |
| Code Viewer | [Monaco Editor](https://microsoft.github.io/monaco-editor/) |
| File Watching | [chokidar](https://github.com/paulmillr/chokidar) |
| Styling | CSS variables with dark, light, and system-aware themes |

## License

[MIT](./LICENSE)
