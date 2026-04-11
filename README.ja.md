# Claude Libre

**[English](./README.md)** | **[中文](./README.zh-CN.md)** | **[日本語](./README.ja.md)** | **[한국어](./README.ko.md)**

> **コミュニティオープンソースプロジェクト** — これは [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI 用の無料・オープンソースデスクトップ GUI です。
> Anthropic 公式の [Claude Desktop](https://claude.ai/download) アプリ（有料サブスクリプションが必要）では **ありません**。
> 本プロジェクトは MIT ライセンスで公開されており、Anthropic とは提携、推奨、公式の関係はありません。

![Electron](https://img.shields.io/badge/Electron-34-black?logo=electron) ![React](https://img.shields.io/badge/React-19-blue?logo=react) ![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript) ![License](https://img.shields.io/badge/License-MIT-green)

![スクリーンショット](./screenshot.png)

## 機能

- **プロジェクト / セッションブラウザ** — `~/.claude/projects/` から Claude Code のプロジェクトとセッションを自動検出
- **即時の新規セッション作成** — ワークスペースを選び、モデルを選択し、最初のプロンプトを入力して会話画面から直接セッションを作成
- **リアルタイム同期** — `.jsonl` セッションファイルの変更を監視し、会話の進行に合わせて自動更新
- **会話ビュー** — 折りたたみ可能な思考ブロックとツール呼び出しカード付きのフォーマット済みメッセージ表示
- **コードタブ** — プロジェクトファイルを閲覧し、Claude Code の `Write` / `Edit` 変更を Monaco ベースのビューア / Diff エディタで確認
- **ターミナル統合** — Claude Code CLI と直接対話できるフル `xterm.js` ターミナル
- **セッション再開** — クリックするだけで `claude --resume <session-id>` でセッションを再開
- **モデル / 思考量の切り替え** — 入力ツールバーからモデル変更、思考量設定、スラッシュコマンド補完が可能
- **スマートな権限処理** — Allow/Always/Deny 操作に加え、Claude Code の信頼済みワークスペース確認を自動処理
- **テーマ** — ダークテーマ、洗練されたライトテーマ、システム連動のテーマ切り替えに対応
- **設定とプロファイル** — 内蔵設定パネルで Claude 設定と再利用可能なプロファイルを管理
- **多言語 UI** — 英語、簡体字中国語、繁体字中国語、日本語、韓国語、ヒンディー語、ポルトガル語に対応
- **クロスプラットフォーム** — Windows、macOS、Linux に対応

## v1.0.2 のハイライト

- システム連動のライト / ダークテーマ切り替えと、ライトテーマのサイドバー / メッセージデザイン改善
- フォルダ選択、モデル選択、初回プロンプト送信で自動作成できる新規セッション下書きパネルを追加
- プロジェクトファイル閲覧と Monaco ベースの編集プレビューを行えるコードタブを追加
- モデル / 思考量セレクタ、スラッシュコマンド補完、権限 / ワークスペース確認処理を改善

## なぜこのプロジェクトを作ったのか？

Claude Code は非常に強力な CLI ツールです — でも、全員がターミナルで作業しているわけではありません。

開発者として、複数のセッションを管理し、会話履歴を閲覧し、プロジェクト全体を俯瞰できる、より視覚的な方法が欲しいと考えていました。ターミナルのタブを切り替えたり、長い出力の中をスクロールして探すのは、なかなか面倒です。

そこで Claude Libre を作りました — みなさんがすでに知って愛用している Claude Code CLI をラップする、無料・オープンソースの GUI です。Claude Code CLI へのアクセス以外にサブスクリプションは不要です。インストールして接続するだけですぐに使い始められます。

**目標はシンプルです：** Claude Code をすべての人にとってより使いやすく、より生産的にすること。そして 100% 無料・オープンソースであり続けること。

## 公式 Claude Desktop との違い

| | Claude Desktop（Anthropic 公式） | Claude Libre（本プロジェクト） |
|---|---|---|
| **種類** | Anthropic 公式製品 | サードパーティコミュニティプロジェクト |
| **料金** | Claude Pro / Max サブスクリプションが必要 | **無料 & オープンソース**（MIT ライセンス） |
| **インターフェース** | チャット中心の GUI | ターミナル + 会話ハイブリッド GUI |
| **バックエンド** | Anthropic API に直接接続 | Claude Code CLI |
| **オープンソース** | クローズドソース | **完全オープンソース** |
| **対象ユーザー** | 一般ユーザー | Claude Code CLI を使用する開発者 |

どちらも素晴らしいツールです — ただ、異なるニーズに応えるものです。洗練された Claude とのチャット体験をお探しなら、公式の Claude Desktop をお使いください。Claude Code CLI を日常的に使い、セッションを視覚的に管理したい開発者の方は、ぜひお試しください。

## はじめに

### 前提条件

- [Node.js](https://nodejs.org/) >= 18
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) がインストール・設定済み

### インストール

```bash
git clone https://github.com/HenryMu/claude-libre.git
cd claude-libre
npm install
```

### 開発

```bash
npm run dev
```

### ビルド

```bash
npm run build
```

### macOS：Gatekeeper の回避

本アプリは Apple Developer 証明書で署名されていないため、macOS にセキュリティ警告が表示されます。開くには：

1. アプリを右クリック → **開く** を選択
2. ダイアログで再度 **開く** をクリック

またはターミナルで実行：

```bash
xattr -cr /Applications/Claude\ Code\ Desktop.app
```

## アーキテクチャ

```
src/
├── shared/types.ts              # 共通 TypeScript 型（IPC、JSONL、Session）
├── main/
│   ├── index.ts                 # Electron メインプロセスエントリ
│   ├── ipc-handlers.ts          # IPC チャネル登録
│   ├── session-watcher.ts       # ファイル監視 + インクリメンタル JSONL パーサー
│   ├── claude-manager.ts        # node-pty プロセスライフサイクル管理
│   └── path-utils.ts            # クロスプラットフォームパス sanitiz/unsanitize
├── preload/
│   └── index.ts                 # contextBridge API
└── renderer/
    ├── index.html
    └── src/
        ├── App.tsx              # ルートレイアウトとタブ状態
        ├── components/
        │   ├── Sidebar.tsx      # プロジェクトツリー + セッションリスト
        │   ├── MainContent.tsx  # 会話 + ターミナル + コードタブ
        │   ├── ThemeSwitch.tsx  # ライト / ダーク / システムテーマ切り替え
        │   ├── LangSwitch.tsx   # 言語切り替え
        │   └── SettingsModal.tsx # 設定エディタ + プロファイル管理
        ├── hooks/
        │   ├── useSessionWatcher.ts  # セッションデータ IPC リスナー
        │   └── useClaudeManager.ts   # PTY プロセス管理
        └── styles/
            └── global.css       # ライト / ダークテーマと全体スタイル
```

## 技術スタック

| コンポーネント | 技術 |
|---------------|------|
| デスクトップフレームワーク | [Electron](https://www.electronjs.org/) 34 |
| ビルドツール | [electron-vite](https://electron-vite.org/) |
| フロントエンド | [React](https://react.dev/) 19 + [TypeScript](https://www.typescriptlang.org/) |
| ターミナル | [xterm.js](https://xtermjs.org/) + [node-pty](https://github.com/microsoft/node-pty) |
| コードビューア | [Monaco Editor](https://microsoft.github.io/monaco-editor/) |
| ファイル監視 | [chokidar](https://github.com/paulmillr/chokidar) |
| スタイリング | CSS 変数ベースのライト / ダーク / システムテーマ |

## ライセンス

[MIT](./LICENSE)
