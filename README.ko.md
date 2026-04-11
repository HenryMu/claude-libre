# Claude Code Desktop

**[English](./README.md)** | **[中文](./README.zh-CN.md)** | **[日本語](./README.ja.md)** | **[한국어](./README.ko.md)**

> **커뮤니티 오픈소스 프로젝트** — 이 프로젝트는 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI를 위한 무료 오픈소스 데스크톱 GUI입니다.
> Anthropic 공식 [Claude Desktop](https://claude.ai/download) 앱(유료 구독 필요)이 **아닙니다**.
> 본 프로젝트는 MIT 라이선스로 공개되어 있으며, Anthropic과의 제휴, 보증, 공식 관계는 없습니다.

![Electron](https://img.shields.io/badge/Electron-34-black?logo=electron) ![React](https://img.shields.io/badge/React-19-blue?logo=react) ![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript) ![License](https://img.shields.io/badge/License-MIT-green)

![스크린샷](./screenshot.png)

## 기능

- **프로젝트 / 세션 브라우저** — `~/.claude/projects/`에서 Claude Code 프로젝트와 세션을 자동으로 탐색
- **즉시 새 세션 시작** — 워크스페이스를 고르고, 모델을 선택하고, 첫 프롬프트를 입력해 대화 화면에서 바로 새 세션을 생성
- **실시간 동기화** — `.jsonl` 세션 파일의 변경 사항을 감시하여 대화 진행에 따라 자동 업데이트
- **대화 뷰** — 접을 수 있는 사고 블록과 도구 호출 카드가 포함된 포맷된 메시지 표시
- **코드 탭** — 프로젝트 파일을 탐색하고 Claude Code의 `Write` / `Edit` 변경 사항을 Monaco 기반 뷰어와 Diff 편집기로 확인
- **터미널 통합** — Claude Code CLI와 직접 상호작용할 수 있는 완전한 `xterm.js` 터미널
- **세션 재개** — 클릭 한 번으로 `claude --resume <session-id>`를 통해 세션 재개
- **모델 / 사고 깊이 제어** — 입력 툴바에서 모델 전환, 사고 깊이 설정, 슬래시 명령 자동완성 지원
- **스마트 권한 처리** — Allow/Always/Deny 제어와 함께 Claude Code의 신뢰 워크스페이스 확인 프롬프트를 자동 처리
- **테마** — 다크 모드, 다듬어진 라이트 모드, 시스템 설정을 따르는 기본 테마 전환 지원
- **설정 및 프로필** — 내장 설정 패널에서 Claude 설정과 재사용 가능한 프로필 관리
- **다국어 UI** — 영어, 중국어 간체/번체, 일본어, 한국어, 힌디어, 포르투갈어 지원
- **크로스 플랫폼** — Windows, macOS, Linux 지원

## v1.0.2 하이라이트

- 시스템 연동 라이트 / 다크 테마 전환과 함께 라이트 사이드바 및 메시지 스타일 개선
- 폴더 선택, 모델 선택, 첫 프롬프트 전송으로 자동 생성되는 새 세션 초안 패널 추가
- 프로젝트 파일 탐색과 Monaco 기반 편집 미리보기를 제공하는 코드 탭 추가
- 모델 / 사고 깊이 선택기, 슬래시 명령 자동완성, 권한 / 워크스페이스 확인 처리 개선

## 왜 이 프로젝트를 만들었나요?

Claude Code는 매우 강력한 CLI 도구입니다 — 하지만 모든 사람이 터미널에서 작업하는 것은 아니죠.

개발자로서, 여러 세션을 관리하고, 대화 기록을 탐색하며, 프로젝트 전체를 한눈에 파악할 수 있는 더 시각적인 방법을 원했습니다. 터미널 탭 사이를 오가고 긴 출력물을 스크롤하는 것은 결국 지루해집니다.

그래서 Claude Code Desktop을 만들었습니다 — 여러분이 이미 알고 사랑하는 Claude Code CLI를 감싸는 무료 오픈소스 GUI입니다. Claude Code CLI 접근 외에는 추가 구독이 필요 없습니다. 설치하고 연결하면 바로 시작할 수 있습니다.

**목표는 간단합니다:** Claude Code를 모든 사람에게 더 접근 가능하고 생산적으로 만드는 것. 그리고 100% 무료와 오픈소스를 유지하는 것.

## 공식 Claude Desktop과의 차이점

| | Claude Desktop (Anthropic 공식) | Claude Code Desktop (이 프로젝트) |
|---|---|---|
| **유형** | Anthropic 공식 제품 | 서드파티 커뮤니티 프로젝트 |
| **비용** | Claude Pro / Max 구독 필요 | **무료 & 오픈소스** (MIT 라이선스) |
| **인터페이스** | 채팅 중심 GUI | 터미널 + 대화 하이브리드 GUI |
| **백엔드** | Anthropic API에 직접 연결 | Claude Code CLI |
| **오픈소스** | 클로즈드 소스 | **완전한 오픈소스** |
| **대상 사용자** | 일반 사용자 | Claude Code CLI를 사용하는 개발자 |

둘 다 훌륭한 도구입니다 — 다만 다른 요구를 충족합니다. 세련된 Claude 채팅 경험을 원하신다면 공식 Claude Desktop을 사용하세요. Claude Code CLI를 일상적으로 사용하며 세션을 시각적으로 관리하고 싶은 개발자라면 이 프로젝트를 사용해 보세요.

## 시작하기

### 필수 조건

- [Node.js](https://nodejs.org/) >= 18
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) 설치 및 설정 완료

### 설치

```bash
git clone https://github.com/HenryMu/Claude-Code-GUI.git
cd Claude-Code-GUI
npm install
```

### 개발

```bash
npm run dev
```

### 빌드

```bash
npm run build
```

### macOS: Gatekeeper 우회 방법

이 앱은 Apple Developer 인증서로 서명되지 않았으므로 macOS에서 보안 경고가 표시됩니다. 여는 방법:

1. 앱을 우클릭 → **열기** 선택
2. 대화상자에서 다시 **열기** 클릭

또는 터미널에서 실행:

```bash
xattr -cr /Applications/Claude\ Code\ Desktop.app
```

## 아키텍처

```
src/
├── shared/types.ts              # 공유 TypeScript 타입 (IPC, JSONL, Session)
├── main/
│   ├── index.ts                 # Electron 메인 프로세스 엔트리
│   ├── ipc-handlers.ts          # IPC 채널 등록
│   ├── session-watcher.ts       # 파일 감시 + 증분 JSONL 파서
│   ├── claude-manager.ts        # node-pty 프로세스 수명 주기 관리
│   └── path-utils.ts            # 크로스 플랫폼 경로 sanitize/unsanitize
├── preload/
│   └── index.ts                 # contextBridge API
└── renderer/
    ├── index.html
    └── src/
        ├── App.tsx              # 루트 레이아웃과 탭 상태
        ├── components/
        │   ├── Sidebar.tsx      # 프로젝트 트리 + 세션 목록
        │   ├── MainContent.tsx  # 대화 + 터미널 + 코드 탭
        │   ├── ThemeSwitch.tsx  # 라이트 / 다크 / 시스템 테마 전환
        │   ├── LangSwitch.tsx   # 언어 전환
        │   └── SettingsModal.tsx # 설정 편집기 + 프로필 관리
        ├── hooks/
        │   ├── useSessionWatcher.ts  # 세션 데이터 IPC 리스너
        │   └── useClaudeManager.ts   # PTY 프로세스 관리
        └── styles/
            └── global.css       # 라이트 / 다크 테마와 전역 스타일
```

## 기술 스택

| 구성 요소 | 기술 |
|-----------|------|
| 데스크톱 프레임워크 | [Electron](https://www.electronjs.org/) 34 |
| 빌드 도구 | [electron-vite](https://electron-vite.org/) |
| 프론트엔드 | [React](https://react.dev/) 19 + [TypeScript](https://www.typescriptlang.org/) |
| 터미널 | [xterm.js](https://xtermjs.org/) + [node-pty](https://github.com/microsoft/node-pty) |
| 코드 뷰어 | [Monaco Editor](https://microsoft.github.io/monaco-editor/) |
| 파일 감시 | [chokidar](https://github.com/paulmillr/chokidar) |
| 스타일링 | CSS 변수 기반 라이트 / 다크 / 시스템 테마 |

## 라이선스

[MIT](./LICENSE)
