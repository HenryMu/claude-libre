# Claude Libre

**[English](./README.md)** | **[中文](./README.zh-CN.md)** | **[日本語](./README.ja.md)** | **[한국어](./README.ko.md)**

> **社区开源项目** — 这是一个免费、开源的 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI 桌面 GUI 客户端。
> 它 **不是** Anthropic 官方的 [Claude Desktop](https://claude.ai/download) 应用（官方应用需要付费订阅）。
> 本项目基于 MIT 协议开源，与 Anthropic 没有关联、未被背书、也不存在官方联系。

![Electron](https://img.shields.io/badge/Electron-34-black?logo=electron) ![React](https://img.shields.io/badge/React-19-blue?logo=react) ![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript) ![License](https://img.shields.io/badge/License-MIT-green)

![截图](./screenshot.png)

## 功能特性

- **项目与会话浏览器** — 自动发现 `~/.claude/projects/` 下的 Claude Code 项目和会话
- **即时新建会话** — 选择工作区、选择模型、输入第一条提示词，即可直接从会话页创建新会话
- **实时同步** — 监听 `.jsonl` 会话文件变化，随对话进展自动更新
- **对话视图** — 格式化消息展示，支持折叠的思考块和工具调用卡片
- **代码标签页** — 浏览项目文件，并通过 Monaco 查看 Claude Code `Write` / `Edit` 变更和差异
- **终端集成** — 完整的 `xterm.js` 终端，可直接与 Claude Code CLI 交互
- **会话恢复** — 点击任意会话即可通过 `claude --resume <session-id>` 恢复
- **模型与深度控制** — 在输入栏切换模型、设置思考深度，并支持斜杠命令自动补全
- **智能权限处理** — 提供 Allow/Always/Deny 交互控制，并自动确认 Claude Code 的可信工作区提示
- **主题** — 支持暗色模式、精致浅色模式，以及默认跟随系统主题的快速切换
- **配置集与设置** — 内置设置面板，可管理 Claude 配置和可复用配置集
- **多语言界面** — 支持英文、简体中文、繁体中文、日文、韩文、印地语和葡萄牙语
- **跨平台** — 支持 Windows、macOS 和 Linux

## v1.0.2 新增内容

- 新增跟随系统的浅色/暗色主题切换，并优化浅色侧边栏与消息样式
- 新增会话草稿面板：选择文件夹、选择模型、发送首条消息即可自动创建会话
- 新增代码标签页，支持项目文件浏览和 Monaco 驱动的写入/编辑预览
- 新增模型/思考深度选择、斜杠命令补全，并改进权限与工作区确认处理

## 为什么做这个项目？

Claude Code 是一个极其强大的 CLI 工具 — 但并不是每个人都习惯在终端中工作。

作为开发者，我们希望有一种更直观的方式来管理多个会话、浏览对话历史、统览所有项目。在终端标签页之间来回切换、在长输出中滚动查找信息，效率并不高。

所以我们打造了 Claude Libre — 一个免费、开源的 GUI，封装了你已经熟悉和喜爱的 Claude Code CLI。除了 Claude Code CLI 本身的访问权限外，不需要任何额外订阅。安装、连接、开箱即用。

**目标很简单：** 让 Claude Code 对每个人都更易用、更高效，同时保持 100% 免费和开源。

## 与官方产品的区别

| | Claude Desktop（Anthropic 官方） | Claude Libre（本项目） |
|---|---|---|
| **类型** | Anthropic 官方产品 | 第三方社区项目 |
| **费用** | 需要 Claude Pro / Max 订阅 | **免费 & 开源**（MIT 协议） |
| **界面** | 以聊天为核心的 GUI | 终端 + 对话混合型 GUI |
| **后端** | 直接调用 Anthropic API | Claude Code CLI |
| **开源** | 闭源 | **完全开源** |
| **目标用户** | 普通用户 | 使用 Claude Code CLI 的开发者 |

两者都是优秀的工具 — 只是满足不同的需求。如果你想要一个精致的 Claude 聊天体验，请使用官方 Claude Desktop。如果你是深度使用 Claude Code CLI 的开发者，想要一个可视化的会话管理器，欢迎试试本项目。

## 快速开始

### 前置要求

- [Node.js](https://nodejs.org/) >= 18
- 已安装并配置 [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)

### 安装

```bash
git clone https://github.com/HenryMu/claude-libre.git
cd claude-libre
npm install
```

### 开发

```bash
npm run dev
```

### 构建

```bash
npm run build
```

### macOS：绕过 Gatekeeper

由于本应用未经 Apple 开发者证书签名，macOS 会显示安全警告。打开方式：

1. 右键点击应用 → 选择 **打开**
2. 在弹窗中再次点击 **打开**

或在终端中执行：

```bash
xattr -cr /Applications/Claude\ Libre.app
```

## 架构

```
src/
├── shared/types.ts              # 共享 TypeScript 类型（IPC、JSONL、Session）
├── main/
│   ├── index.ts                 # Electron 主进程入口
│   ├── ipc-handlers.ts          # IPC 通道注册
│   ├── session-watcher.ts       # 文件监听 + 增量 JSONL 解析器
│   ├── claude-manager.ts        # node-pty 进程生命周期管理
│   └── path-utils.ts            # 跨平台路径编码/解码
├── preload/
│   └── index.ts                 # contextBridge API
└── renderer/
    ├── index.html
    └── src/
        ├── App.tsx              # 根布局与标签状态
        ├── components/
        │   ├── Sidebar.tsx      # 项目树 + 会话列表
        │   ├── MainContent.tsx  # 对话 + 终端 + 代码标签页
        │   ├── ThemeSwitch.tsx  # 浅色/暗色/跟随系统主题切换
        │   ├── LangSwitch.tsx   # 语言切换
        │   └── SettingsModal.tsx # 配置编辑器 + 配置集管理
        ├── hooks/
        │   ├── useSessionWatcher.ts  # 会话数据 IPC 监听
        │   └── useClaudeManager.ts   # PTY 进程管理
        └── styles/
            └── global.css       # 暗色/浅色主题与全局样式
```

## 技术栈

| 组件 | 技术 |
|------|------|
| 桌面框架 | [Electron](https://www.electronjs.org/) 34 |
| 构建工具 | [electron-vite](https://electron-vite.org/) |
| 前端 | [React](https://react.dev/) 19 + [TypeScript](https://www.typescriptlang.org/) |
| 终端 | [xterm.js](https://xtermjs.org/) + [node-pty](https://github.com/microsoft/node-pty) |
| 代码查看器 | [Monaco Editor](https://microsoft.github.io/monaco-editor/) |
| 文件监听 | [chokidar](https://github.com/paulmillr/chokidar) |
| 样式 | CSS 变量，支持暗色、浅色和跟随系统主题 |

## 许可证

[MIT](./LICENSE)
