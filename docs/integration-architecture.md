# Integration Architecture

**Generated:** 2026-02-23 | **Scan Level:** Deep

## Overview

BMAD-Studio is a monorepo with two primary parts that communicate through multiple integration patterns. This document describes how the frontend (Electron/React) and backend (Python) parts interact, plus all external service integrations.

## Part-to-Part Communication

### Electron ↔ Python Backend

The primary integration is the Electron main process spawning Python backend subprocesses:

```
Electron Main Process
    │
    ├── agent-process.ts (40KB)
    │   └── Spawns: python run.py --spec XXX --auto-continue
    │       ├── Communication: Structured JSON over stdio
    │       ├── Events: Phase progress, subtask status, errors
    │       └── Lifecycle: Start, monitor, recover, terminate
    │
    ├── python-env-manager.ts
    │   └── Manages: Python venv creation, dependency installation
    │
    └── python-detector.ts
        └── Locates: System Python installations (3.10+)
```

**Communication Protocol:**
- **Direction:** Bidirectional via stdio streams
- **Format:** Newline-delimited JSON messages
- **Events:** Phase transitions, progress updates, error reports, completion signals
- **Recovery:** Automatic restart on crash, session recovery mechanisms

### Electron Main ↔ Renderer (IPC)

```
Renderer                    Main Process
   │                            │
   ├── window.electronAPI.*  ──→│  ipcMain.handle('channel', handler)
   │   (invoke, returns Promise) │
   │                            │
   │  ←── webContents.send() ──┤  Push events (agent progress, etc.)
   │   (on, event listener)     │
```

**32 IPC handler modules** organized by domain:
- Project, Task, Terminal, Settings, Agent Events
- GitHub (5 handlers), GitLab (5 handlers), Linear
- Roadmap, Insights, Ideation, Changelog, Memory
- Environment, MCP, Claude Code, Profile, File

### Preload Bridge

The preload layer (`src/preload/`) exposes 14 domain-specific API modules via `contextBridge.exposeInMainWorld('electronAPI', ...)`, providing a safe, typed interface between renderer and main process.

## External Service Integrations

### Claude AI (Claude Agent SDK)

| Aspect | Detail |
|--------|--------|
| **SDK** | claude-agent-sdk >= 0.1.39 |
| **Auth** | OAuth token (primary) or CCR/proxy token (fallback) |
| **Models** | opus, sonnet, haiku (with 4.5/4.6 variants) |
| **Endpoints** | Configurable via `ANTHROPIC_BASE_URL` |
| **MCP Servers** | Context7, Puppeteer, Electron, Linear, Graphiti |

### GitHub Integration

| Feature | Implementation |
|---------|---------------|
| OAuth setup | `GitHubSetupModal.tsx` → `github-handlers.ts` |
| Issue import | `github/issue-handlers.ts` |
| PR review | `github/pr-review-handlers.ts` → `github_runner.py` |
| PR creation | `--create-pr` CLI flag → `github_runner.py` |
| Bot detection | `bot_detection_state.json` tracking |

### GitLab Integration

| Feature | Implementation |
|---------|---------------|
| OAuth setup | `GitSetupModal.tsx` → `gitlab-handlers.ts` |
| Issue import | `gitlab/issue-handlers.ts` |
| MR review | `gitlab/merge-request-handlers.ts` |
| Release ops | `gitlab/release-handlers.ts` |

### Linear PM Integration

| Feature | Implementation |
|---------|---------------|
| API key auth | `LINEAR_API_KEY` environment variable |
| Task updates | `integrations/linear/integration.py` |
| Status sync | started → stuck → build_complete → QA phases |
| UI | `linear-handlers.ts` (17KB) |

### Graphiti Memory System

| Feature | Implementation |
|---------|---------------|
| Database | LadybugDB (embedded graph, Python 3.12+) |
| Framework | graphiti-core for episode recording |
| Embedders | OpenAI, Google, Azure OpenAI, Ollama, OpenRouter, Voyage |
| Episodes | Codebase discovery, gotchas, patterns, QA results, session insights |
| UI | `memory-handlers.ts` (28KB) → Graphiti queries |

### Sentry Error Tracking

| Part | Implementation |
|------|---------------|
| Frontend | `@sentry/electron` 7.5.0 via `sentry.ts` |
| Backend | `sentry-sdk` 2.0+ via CLI initialization |

### Auto-Updates

| Feature | Implementation |
|---------|---------------|
| Framework | `electron-updater` 6.6.2 |
| Provider | GitHub Releases |
| UI | `AppUpdateNotification.tsx` (12KB) |
| Handler | `app-update-handlers.ts` |

## Data Flow

### Task Execution Flow

```
User (UI) → TaskCreationWizard → task-store → IPC → project-handlers
    │
    ▼
Python subprocess (run.py --spec XXX)
    │
    ├── Spec Pipeline → requirements.json, spec.md, context.json
    ├── Planner → implementation_plan.json
    ├── Coder → git commits in worktree
    └── QA Loop → qa_report.md
    │
    ▼
Events (JSON/stdio) → agent-events-handlers → task-store → KanbanBoard
```

### Profile Auto-Switching Flow

```
API call fails (rate limit) → rate-limit-detector.ts
    │
    ▼
profile-scorer.ts → rank available profiles
    │
    ▼
credential-utils.ts → load new profile credentials
    │
    ▼
usage-monitor.ts → track new profile usage
    │
    ▼
claude-profile-store.ts → update UI
```

## Integration Points Summary

| From | To | Type | Protocol |
|------|----|------|----------|
| Electron Main | Python Backend | Subprocess | JSON/stdio |
| Renderer | Main | IPC | Electron IPC |
| Backend | Claude API | HTTP | Claude Agent SDK |
| Backend | GitHub API | HTTP | REST via runners |
| Backend | GitLab API | HTTP | REST via runners |
| Backend | Linear API | HTTP | REST |
| Backend | LadybugDB | Embedded | Python driver |
| Frontend | Sentry | HTTP | @sentry/electron |
| Frontend | GitHub Releases | HTTP | electron-updater |
