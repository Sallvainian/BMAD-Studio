# Architecture — Frontend (Electron/React Desktop App)

**Generated:** 2026-02-23 | **Part:** `apps/frontend/` | **Language:** TypeScript 5.9.3 (strict)

## Executive Summary

The frontend is an Electron 40 + React 19 desktop application with a three-process architecture (main, preload, renderer). It implements a feature-rich project management and AI-powered autonomous task execution system with 32 IPC handler modules, 20 Zustand stores, 69+ components, and comprehensive i18n support.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     MAIN PROCESS                             │
│  AgentManager │ TerminalManager │ PythonEnvManager          │
│  Claude Profile System (Credentials, OAuth, Scoring)        │
│  32 IPC Handler Modules (Project, Task, Terminal, etc.)     │
└──────────────────────────┬──────────────────────────────────┘
                           │ IPC
┌──────────────────────────┴──────────────────────────────────┐
│                   PRELOAD BRIDGE                             │
│  ElectronAPI: 14 domain-specific API modules                │
│  contextBridge.exposeInMainWorld('electronAPI', ...)        │
└──────────────────────────┬──────────────────────────────────┘
                           │ IPC
┌──────────────────────────┴──────────────────────────────────┐
│                  RENDERER PROCESS                            │
│  App.tsx (routing, state init, global listeners)            │
│  20 Zustand Stores │ 69+ Components │ 9 Hooks              │
│  React 19 + Tailwind CSS v4 + Radix UI + xterm.js          │
└─────────────────────────────────────────────────────────────┘
```

## Main Process (`src/main/`)

### Entry Point (`index.ts` — 665 lines)

- CommonJS require polyfill for ESM compatibility
- Environment loading (.env) before any imports
- Window creation: 1400x900 preferred, 800x500 minimum
- Hidden title bar on macOS (traffic lights at 15,10)
- Context isolation enabled, no Node integration
- Spell check with multi-language support

### Top-Level Managers (35 files)

| Manager | Purpose |
|---------|---------|
| `agent-manager.ts` | Agent lifecycle orchestration |
| `terminal-manager.ts` | PTY-based terminal lifecycle |
| `python-env-manager.ts` | Python 3.10+ venv setup |
| `python-detector.ts` | System Python detection |
| `claude-profile-manager.ts` | Multi-account lifecycle |
| `file-watcher.ts` | File system monitoring |
| `project-store.ts` | Main process project persistence |
| `terminal-session-store.ts` | Terminal session storage |

### Agent Module (`src/main/agent/` — 16 files)

| File | Size | Purpose |
|------|------|---------|
| `agent-manager.ts` | 26KB | Main orchestration facade |
| `agent-process.ts` | 40KB | Subprocess communication |
| `agent-queue.ts` | 39KB | Queue management, prioritization |
| `agent-state.ts` | 5.3KB | Mutable state per agent |
| `agent-events.ts` | 12KB | Event forwarding, progress parsing |
| `parsers/` | — | Phase-specific event parsers |
| `types.ts` | — | Agent TypeScript interfaces |

### Claude Profile System (`src/main/claude-profile/` — 18 files)

| File | Size | Purpose |
|------|------|---------|
| `credential-utils.ts` | 88KB | OS keychain (Keychain/Windows Credential Manager) |
| `usage-monitor.ts` | 78KB | Per-profile token tracking, auto-switch |
| `token-refresh.ts` | 19KB | OAuth lifecycle, auto-refresh |
| `profile-scorer.ts` | 20KB | Profile availability ranking |

### IPC Handlers (`src/main/ipc-handlers/` — 32 modules)

**Project Management:**
- `project-handlers.ts` (21KB) — Project CRUD, git ops
- `task-handlers.ts` — Task lifecycle routing

**Terminal & Claude:**
- `terminal-handlers.ts` (26KB) — PTY creation, write, resize
- `claude-code-handlers.ts` (58KB) — Claude Code integration

**Configuration:**
- `settings-handlers.ts` (32KB) — App settings
- `env-handlers.ts` (31KB) — Environment variables
- `profile-handlers.ts` (11KB) — Claude profiles

**AI Features:**
- `roadmap-handlers.ts` (34KB) — Roadmap generation
- `insights-handlers.ts` (16KB) — Codebase chat
- `ideation-handlers.ts` + `ideation/` — Idea generation
- `memory-handlers.ts` (28KB) — Graphiti operations

**Integrations:**
- `github/` — 5 handlers (issues, PRs, import, repository, utils)
- `gitlab/` — 5 handlers (issues, MRs, import, releases, repository)
- `linear-handlers.ts` (17KB) — Linear PM

**Other:**
- `agent-events-handlers.ts` (17KB) — Agent lifecycle events
- `changelog-handlers.ts` (16KB) — Release notes
- `mcp-handlers.ts` (17KB) — MCP server management
- `context/` — Context building
- `app-update-handlers.ts` — Auto-updater

## Renderer Process (`src/renderer/`)

### Root Component (`App.tsx` — 1187 lines)

- Multi-view routing (Kanban, Terminals, Insights, Roadmap, etc.)
- Project tab bar with drag-and-drop reordering
- Modal management (auth, settings, task detail)
- Global listeners: IPC, terminal output, task reconciliation, profile swapping
- Error boundary wrapping

### Zustand State Stores (20 stores)

**Core:**

| Store | Size | Purpose |
|-------|------|---------|
| `task-store.ts` | 42KB | Tasks, status, kanban ordering, logs |
| `terminal-store.ts` | 28KB | Sessions, xterm callbacks, XState actors |
| `settings-store.ts` | 25KB | Preferences, API profiles, models |
| `project-store.ts` | 15KB | Active project, tabs, list |

**Feature-Specific:**

| Store | Size | Purpose |
|-------|------|---------|
| `roadmap-store.ts` | 31KB | Roadmap generation, goals |
| `ideation-store.ts` | 25KB | Ideation sessions, ideas |
| `changelog-store.ts` | 20KB | Release notes, versions |
| `insights-store.ts` | 15KB | Codebase chat, history |
| `kanban-settings-store.ts` | 12KB | Board layout |

**Integration:** `claude-profile-store.ts`, `github/issues-store.ts`, `github/pr-review-store.ts`, `github/investigation-store.ts`, `gitlab-store.ts`, `context-store.ts`

**Utility:** `auth-failure-store.ts`, `rate-limit-store.ts`, `download-store.ts`, `file-explorer-store.ts`, `project-env-store.ts`, `release-store.ts`, `terminal-font-settings-store.ts`

**Patterns:**
- Zustand with `create()` API
- Immer middleware for immutable updates
- Selector-based components (prevents unnecessary re-renders)
- Module-level Maps for non-serializable data (XState actors, terminal callbacks)

### Custom Hooks (9 files)

| Hook | Purpose |
|------|---------|
| `useIpc.ts` | IPC communication wrapper |
| `useTerminal.ts` | Terminal session management |
| `use-toast.ts` | Toast notifications |
| `useGlobalTerminalListeners.ts` | Global terminal output |
| `useTerminalProfileChange.ts` | Profile change detection |
| `useTaskReconciliation.ts` | Task state sync |
| `useResolvedAgentSettings.ts` | Agent settings resolution |
| `useVirtualizedTree.ts` | Virtualized tree rendering |
| `use-profile-swap-notifications.ts` | Profile swap alerts |

## Preload Bridge (`src/preload/`)

### API Structure (14 modules)

The preload exposes a unified `ElectronAPI` via `contextBridge`:

```typescript
contextBridge.exposeInMainWorld('electronAPI', createElectronAPI());
contextBridge.exposeInMainWorld('DEBUG', process.env.DEBUG === 'true');
contextBridge.exposeInMainWorld('platform', { isWindows, isMacOS, isLinux, isUnix });
```

**Domain APIs:** project, terminal, task, settings, file, agent, app-update, profile, screenshot, queue

**Module APIs:** github, gitlab, ideation, insights, roadmap, changelog, linear, shell, claude-code, mcp, debug

**Pattern:** All APIs follow `ipcInvoke('channel:method', args)` → `Promise<Result>`

## Shared Layer (`src/shared/`)

### Type Definitions (20 files)

Core: `task.ts`, `project.ts`, `terminal.ts`, `agent.ts`, `settings.ts`, `profile.ts`
Features: `roadmap.ts`, `insights.ts`, `ideation.ts`, `changelog.ts`, `kanban.ts`, `pr-status.ts`
Infrastructure: `ipc.ts`, `integrations.ts`, `screenshot.ts`, `app-update.ts`, `cli.ts`, `unified-account.ts`, `common.ts`

### i18n (react-i18next)

**Namespaces:** common, navigation, settings, tasks, taskReview, terminal, dialogs, errors, gitlab, onboarding, welcome

**Languages:** English (`en/`) and French (`fr/`)

**Pattern:** `t('namespace:section.key')` — all UI text must use translation keys

### Constants

- 7 color themes (Default, Dusk, Lime, Ocean, Retro, Neo + more) with light/dark variants
- IPC channel definitions
- Default app settings
- Phase protocol definitions

## IPC Communication Pattern

**Renderer → Main:** `window.electronAPI.method(args)` → Promise
**Main → Renderer:** `mainWindow.webContents.send('channel', data)`
**Renderer listens:** `window.electronAPI.on('channel', handler)`

Channels organized by domain: `project:*`, `terminal:*`, `task:*`, `agent:*`, `settings:*`, `github:*`, `gitlab:*`, etc.

## Performance Optimizations

- **Store selectors** — Components subscribe to specific state slices
- **Module-level buffer manager** — Buffers terminal output when not visible
- **Virtualization** — `useVirtualizedTree.ts` for large file lists
- **Lazy loading** — Feature views loaded on demand

## Styling

- **Tailwind CSS v4** with `@tailwindcss/postcss` plugin
- **7 color themes** with light/dark mode variants via CSS custom properties
- **Utility:** `clsx` + `tailwind-merge` via `cn()` helper
- **Component variants:** `class-variance-authority` (CVA)

## Testing

- **Unit:** Vitest 4.0.16 + React Testing Library + jsdom
- **E2E:** Playwright 1.52.0
- **Linting:** Biome 2.3.11
- **Type checking:** `tsc --noEmit` (strict mode)
- **Pre-commit:** Husky + lint-staged

## Build System

- **Bundler:** electron-vite 5.0.0 (Vite 7.2.7) for 3 Electron processes
- **Packaging:** electron-builder 26.4.0
- **Targets:** macOS (dmg, zip), Windows (nsis, zip), Linux (AppImage, deb, flatpak)
- **Python bundling:** Per-platform Python runtime in `python-runtime/`
