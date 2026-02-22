# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

Auto Claude is an autonomous multi-agent coding framework that plans, builds, and validates software for you. It's a monorepo with a Python backend (CLI + agent logic) and an Electron/React frontend (desktop UI).

> **Deep-dive reference:** [ARCHITECTURE.md](shared_docs/ARCHITECTURE.md) | **Frontend contributing:** [apps/frontend/CONTRIBUTING.md](apps/frontend/CONTRIBUTING.md)

## Product Overview

Auto Claude is a desktop application (+ CLI) where users describe a goal and AI agents autonomously handle planning, implementation, and QA validation. All work happens in isolated git worktrees so the main branch stays safe.

**Core workflow:** User creates a task → Spec creation pipeline assesses complexity and writes a specification → Planner agent breaks it into subtasks → Coder agent implements (can spawn parallel subagents) → QA reviewer validates → QA fixer resolves issues → User reviews and merges.

**Main features:**

- **Autonomous Tasks** — Multi-agent pipeline (planner, coder, QA) that builds features end-to-end
- **Kanban Board** — Visual task management from planning through completion
- **Agent Terminals** — Up to 12 parallel AI-powered terminals with task context injection
- **Insights** — AI chat interface for exploring and understanding your codebase
- **Roadmap** — AI-assisted feature planning with strategic roadmap generation
- **Ideation** — Discover improvements, performance issues, and security vulnerabilities
- **GitHub/GitLab Integration** — Import issues, AI-powered investigation, PR/MR review and creation
- **Changelog** — Generate release notes from completed tasks
- **Memory System** — Graphiti-based knowledge graph retains insights across sessions
- **Isolated Workspaces** — Git worktree isolation for every build; AI-powered semantic merge
- **Flexible Authentication** — Use a Claude Code subscription (OAuth) or API profiles with any Anthropic-compatible endpoint (e.g., Anthropic API, z.ai for GLM models)
- **Multi-Account Swapping** — Register multiple Claude accounts; when one hits a rate limit, Auto Claude automatically switches to an available account
- **Cross-Platform** — Native desktop app for Windows, macOS, and Linux with auto-updates

## Critical Rules

**Claude Agent SDK only** — All AI interactions use `claude-agent-sdk`. NEVER use `anthropic.Anthropic()` directly. Always use `create_client()` from `core.client`.

**i18n required** — All frontend user-facing text MUST use `react-i18next` translation keys. Never hardcode strings in JSX/TSX. Add keys to both `en/*.json` and `fr/*.json`.

**Platform abstraction** — Never use `process.platform` directly. Import from `apps/frontend/src/main/platform/` or `apps/backend/core/platform/`. CI tests all three platforms.

**No time estimates** — Never provide duration predictions. Use priority-based ordering instead.

**PR target** — Always target the `develop` branch for PRs to Sallvainian/Auto-Claude, NOT `main`.

**No console.log for debugging production issues** — `console.log` output is not visible in bundled/packaged versions of the Electron app. Use Sentry for error tracking and diagnostics in production. Reserve `console.log` for development only.

## Work Approach

**Investigate before speculating** — Always read the actual code before proposing root causes. Spawn agents to grep and read relevant source files before forming any hypothesis. Never guess at causes without evidence from the codebase.

**Spawn agents for complex tasks** — When tackling complex tasks, spawn sub-agents/agent teams immediately rather than trying to handle everything in a single context window. Never attempt to analyze large codebases or multiple features monolithically.

**Minimal fixes only** — Prefer the simplest approach (e.g., prompt-only changes, single guard clause) before suggesting multi-component solutions. If the user asks for X, implement X — don't bundle additional fixes they didn't request.

## Known Gotchas

**Electron path resolution** — For bug fixes in the Electron app, always check path resolution differences between dev and production builds (`app.isPackaged`, `process.resourcesPath`). Paths that work in dev often break when Electron is bundled for production — verify both contexts.

### Resetting PR Review State

To fully clear all PR review data so reviews run fresh, delete/reset these three things in `.auto-claude/github/`:

1. `rm .auto-claude/github/pr/logs_*.json` — review log files
2. `rm .auto-claude/github/pr/review_*.json` — review result files
3. Reset `pr/index.json` to `{"reviews": [], "last_updated": null}`
4. Reset `bot_detection_state.json` to `{"reviewed_commits": {}}` — this is the gatekeeper; without clearing it, the bot detector skips already-seen commits

## Project Structure

```
BMAD-Studio/                              # Monorepo root (npm workspaces: apps/*, libs/*)
├── apps/
│   ├── backend/                          # Python backend — ALL agent logic
│   │   ├── run.py                        # ★ Main entry point (Python 3.10+ enforced)
│   │   ├── cli/
│   │   │   └── main.py                   # CLI command router (50+ flags)
│   │   ├── core/                         # SDK client, auth, worktree, platform
│   │   │   ├── __init__.py               # Lazy imports facade
│   │   │   ├── client.py                 # ★ Claude Agent SDK client config & patches
│   │   │   ├── auth.py                   # OAuth authentication + token management
│   │   │   ├── worktree.py               # Git worktree isolation management
│   │   │   ├── progress.py               # Task progress tracking
│   │   │   ├── platform/                 # Cross-platform abstractions (Win/Mac/Linux)
│   │   │   └── recovery/                 # SDK session recovery mechanisms
│   │   ├── agents/                       # Agent orchestration
│   │   │   ├── planner.py                # Follow-up planning agent
│   │   │   ├── coder.py                  # Autonomous coding agent
│   │   │   ├── session.py                # Agent session management
│   │   │   └── tools_pkg/                # Agent tool definitions and implementations
│   │   ├── spec/                         # Spec creation pipeline
│   │   │   ├── pipeline.py               # Orchestration
│   │   │   ├── gatherer.py               # Requirements gathering phase
│   │   │   ├── researcher.py             # Research and analysis phase
│   │   │   ├── writer.py                 # Specification writing phase
│   │   │   └── complexity.py             # AI-based complexity assessment
│   │   ├── qa/                           # QA validation system
│   │   │   ├── reviewer.py               # QA validation and review
│   │   │   ├── fixer.py                  # Issue resolution agent
│   │   │   ├── loop.py                   # QA iteration loop management
│   │   │   ├── criteria.py               # Acceptance criteria evaluation
│   │   │   └── report.py                 # QA report generation
│   │   ├── security/                     # Command security
│   │   │   ├── main.py                   # Backward compatibility facade
│   │   │   ├── allowlist/                # Three-layer command allowlisting
│   │   │   ├── validators/               # File, shell, network validators
│   │   │   └── hooks.py                  # Security validation hooks
│   │   ├── integrations/                 # External services
│   │   │   ├── graphiti/                 # ★ Knowledge graph memory (Python 3.12+)
│   │   │   │   ├── memory.py             # Facade (episode types, GroupIdMode)
│   │   │   │   ├── queries_pkg/          # Modular implementation
│   │   │   │   │   ├── graphiti.py       # GraphitiMemory class
│   │   │   │   │   ├── client.py         # LadybugDB client wrapper
│   │   │   │   │   ├── queries.py        # Graph query operations
│   │   │   │   │   ├── search.py         # Semantic search logic
│   │   │   │   │   ├── schema.py         # Graph schema definitions
│   │   │   │   │   └── kuzu_driver_patched.py # Monkeypatch for embedded DB
│   │   │   │   └── graphiti_config.py    # Configuration
│   │   │   ├── linear/                   # Linear PM integration
│   │   │   │   ├── integration.py        # API wrapper, graceful no-op
│   │   │   │   ├── config.py             # Linear API configuration
│   │   │   │   └── client.py             # Linear API client
│   │   │   └── github/                   # GitHub PR/issue management
│   │   ├── context/                      # Task context building
│   │   │   ├── builder.py                # Context assembly
│   │   │   ├── semantic_search.py        # Semantic context retrieval
│   │   │   ├── file_categorizer.py       # File importance classification
│   │   │   └── codebase_analyzer.py      # Codebase analysis
│   │   ├── project/                      # Project analysis
│   │   │   ├── analyzer.py               # Project structure analysis
│   │   │   ├── security.py               # Project-level security profiles
│   │   │   └── config.py                 # Project configuration parsing
│   │   ├── runners/                      # Standalone execution runners
│   │   │   ├── spec_runner.py            # Spec creation
│   │   │   ├── roadmap_runner.py         # Roadmap generation
│   │   │   ├── insights_runner.py        # Codebase insights
│   │   │   └── github_runner.py          # GitHub operations
│   │   ├── services/                     # Background services
│   │   │   ├── recovery.py               # SDK session recovery orchestration
│   │   │   └── background.py             # Background service management
│   │   ├── merge/                        # Semantic merge for parallel agents
│   │   │   ├── intent_analyzer.py        # AI-powered intent extraction
│   │   │   └── semantic_merge.py         # Conflict resolution
│   │   ├── prompts/                      # ★ Agent system prompts (.md)
│   │   │   ├── planner.md                # Planner agent prompt
│   │   │   ├── coder.md                  # Coder agent prompt
│   │   │   ├── coder_recovery.md         # Recovery prompt for coder
│   │   │   ├── qa_reviewer.md            # QA reviewer prompt
│   │   │   ├── qa_fixer.md               # QA fixer prompt
│   │   │   ├── spec_gatherer.md          # Requirements gathering
│   │   │   ├── spec_researcher.md        # Research and analysis
│   │   │   ├── spec_writer.md            # Specification writing
│   │   │   ├── spec_critic.md            # Spec quality review
│   │   │   └── complexity_assessor.md    # Complexity assessment
│   │   ├── phase_config.py               # ★ Phase model/thinking config (MODEL_ID_MAP, budgets)
│   │   ├── task_logger.py                # Task logging and persistence
│   │   ├── implementation_plan.py        # Plan data structures, CRUD, status
│   │   ├── graphiti_config.py            # Graphiti configuration module
│   │   ├── requirements.txt              # Python dependencies
│   │   └── pyproject.toml                # Python project config
│   │
│   └── frontend/                         # Electron desktop UI
│       ├── src/
│       │   ├── main/                     # ★ Electron main process
│       │   │   ├── index.ts              # ★ Entry: window creation, services, IPC (665 lines)
│       │   │   ├── agent/                # Agent management (20 files)
│       │   │   │   ├── agent-queue.ts    # Queue mgmt for ideation/roadmap
│       │   │   │   ├── agent-process.ts  # Subprocess communication
│       │   │   │   ├── agent-state.ts    # State tracking
│       │   │   │   ├── agent-events.ts   # Lifecycle events
│       │   │   │   ├── agent-recovery.ts # Recovery from crashes
│       │   │   │   ├── session-handler.ts# Multi-session coordination
│       │   │   │   ├── timeout-manager.ts# Stalled agent handling
│       │   │   │   ├── output-parser.ts  # Structured output parsing
│       │   │   │   ├── error-handler.ts  # Error classification
│       │   │   │   └── token-counter.ts  # Token usage tracking
│       │   │   ├── claude-profile/       # Multi-profile credential management
│       │   │   │   ├── credential-utils.ts  # OS keychain (Mac/Win/Linux)
│       │   │   │   ├── token-refresh.ts     # OAuth lifecycle + auto-refresh
│       │   │   │   ├── usage-monitor.ts     # ★ API usage tracking + auto-switch (537 lines)
│       │   │   │   └── profile-scorer.ts    # Profile availability ranking
│       │   │   ├── terminal/             # PTY-based terminal system
│       │   │   │   ├── pty-daemon.ts     # ★ Detached PTY process (533 lines)
│       │   │   │   ├── pty-manager.ts    # PTY instance lifecycle
│       │   │   │   ├── terminal-lifecycle.ts # Session creation/cleanup
│       │   │   │   └── claude-integration-handler.ts # SDK in terminals
│       │   │   ├── ipc-handlers/         # 39 handler modules by domain
│       │   │   │   ├── project-handlers.ts  # Git ops, init, settings
│       │   │   │   ├── github/           # 5 handlers (issues, PR, review, investigation, bot)
│       │   │   │   ├── gitlab/           # 5 handlers (issues, MR, review, investigation, bot)
│       │   │   │   ├── agent-events/     # 3 handlers (planning, building, QA)
│       │   │   │   ├── task/             # 4 handlers (create, update, complete, delete)
│       │   │   │   ├── terminal/         # 4 handlers (create, write, resize, export)
│       │   │   │   ├── context/          # 2 handlers (build, search)
│       │   │   │   ├── ideation/         # 3 handlers (features, performance, security)
│       │   │   │   ├── roadmap/          # 2 handlers (generate, update)
│       │   │   │   ├── settings/         # App settings management
│       │   │   │   ├── profile/          # Claude profile management
│       │   │   │   ├── app-update.ts     # Auto-updater control
│       │   │   │   ├── changelog.ts      # Release notes generation
│       │   │   │   ├── file.ts           # File operations
│       │   │   │   ├── screenshot.ts     # Screenshot capture
│       │   │   │   ├── claude-code.ts    # Claude Code integration
│       │   │   │   ├── env.ts            # Environment management
│       │   │   │   ├── memory.ts         # Graphiti knowledge graph ops
│       │   │   │   └── mcp.ts            # MCP server communication
│       │   │   ├── platform/             # Cross-platform abstraction
│       │   │   │   ├── platform.ts       # OS detection and utilities
│       │   │   │   └── executable-finder.ts # Cross-platform exe lookup
│       │   │   ├── services/             # SDK session recovery, profile service
│       │   │   ├── changelog/            # Changelog generation and formatting
│       │   │   ├── project-store.ts      # Main process project persistence
│       │   │   └── terminal-session-store.ts # Terminal session storage
│       │   │
│       │   ├── renderer/                 # ★ React UI
│       │   │   ├── App.tsx               # ★ Root component (1187 lines)
│       │   │   ├── components/           # UI components by feature
│       │   │   │   ├── onboarding/       # Setup wizard, GitHub/GitLab/Claude config
│       │   │   │   ├── task/             # Task list, detail modal, creation wizard
│       │   │   │   ├── terminal/         # xterm.js wrapper, tab bar, controls
│       │   │   │   ├── kanban/           # Drag-and-drop board (@dnd-kit)
│       │   │   │   ├── github/           # Issue browser, PR review, diff viewer
│       │   │   │   ├── gitlab/           # Issue browser, MR review
│       │   │   │   ├── roadmap/          # Goal visualization, timeline
│       │   │   │   ├── insights/         # AI chat interface, analysis results
│       │   │   │   ├── ideation/         # Feature suggestions, security findings
│       │   │   │   └── settings/         # Theme selector, language, API keys
│       │   │   ├── stores/               # ★ 29 Zustand state stores
│       │   │   │   ├── project-store.ts  # Projects, tabs, active project
│       │   │   │   ├── task-store.ts     # Task/spec lifecycle
│       │   │   │   ├── terminal-store.ts # Terminal sessions
│       │   │   │   ├── settings-store.ts # User preferences
│       │   │   │   ├── claude-profile-store.ts # Multi-profile auth state
│       │   │   │   ├── insights-store.ts # Insights conversation
│       │   │   │   ├── roadmap-store.ts  # Roadmap generation
│       │   │   │   ├── ideation-store.ts # Ideation results
│       │   │   │   ├── changelog-store.ts# Generated changelog
│       │   │   │   ├── context-store.ts  # Context building
│       │   │   │   ├── kanban-settings-store.ts # Kanban layout
│       │   │   │   ├── github/           # issues-store, pr-review-store, investigation-store
│       │   │   │   ├── gitlab/           # mr-review-store, gitlab-store
│       │   │   │   ├── auth-failure-store.ts # Auth error recovery
│       │   │   │   ├── rate-limit-store.ts   # Rate limit warnings
│       │   │   │   ├── download-store.ts     # Active downloads
│       │   │   │   ├── file-explorer-store.ts# File browser
│       │   │   │   ├── project-env-store.ts  # Project env vars
│       │   │   │   ├── release-store.ts      # Release data
│       │   │   │   ├── mcp-server-store.ts   # MCP server state
│       │   │   │   ├── agent-tools-store.ts  # Agent tools
│       │   │   │   ├── memory-store.ts       # Graphiti memory
│       │   │   │   ├── bmad-workflows-store.ts # Workflow definitions
│       │   │   │   ├── worktrees-store.ts    # Git worktrees
│       │   │   │   ├── sync-status-store.ts  # Sync progress
│       │   │   │   └── terminal-font-settings-store.ts # Terminal fonts
│       │   │   ├── hooks/                # Custom React hooks
│       │   │   │   ├── useIpc.ts         # IPC communication
│       │   │   │   └── useTerminal.ts    # Terminal session management
│       │   │   ├── contexts/             # React contexts
│       │   │   │   └── ViewStateContext.ts # Global view state
│       │   │   └── styles/               # CSS / Tailwind styles
│       │   │
│       │   ├── preload/                  # Electron preload
│       │   │   └── index.ts              # contextBridge → window.electronAPI
│       │   │
│       │   └── shared/                   # Shared types and utilities
│       │       ├── types/                # 19+ type definition files
│       │       │   ├── project.ts        # Project, ProjectSettings
│       │       │   ├── task.ts           # Task, Spec, ImplementationPlan
│       │       │   ├── terminal.ts       # Terminal session types
│       │       │   ├── agent.ts          # Agent state, event types
│       │       │   ├── github.ts         # GitHub issue/PR types
│       │       │   └── gitlab.ts         # GitLab MR/issue types
│       │       ├── i18n/
│       │       │   └── locales/
│       │       │       ├── en/           # English translations (8+ namespace files)
│       │       │       └── fr/           # French translations (matching en)
│       │       ├── constants/
│       │       │   └── themes.ts         # 7 color themes (light/dark variants)
│       │       └── utils/
│       │           ├── ansi-sanitizer.ts  # Strip ANSI escape codes
│       │           └── shell-escape.ts    # Safe shell argument escaping
│       │
│       ├── resources/                    # App icons and assets (icns, ico, png)
│       ├── e2e/                          # Playwright E2E tests
│       │   └── playwright.config.ts      # E2E configuration
│       ├── scripts/                      # Frontend build utilities
│       │   ├── package-with-python.cjs   # Cross-platform packaging + Python bundling
│       │   ├── download-python.cjs       # Download Python runtime per platform
│       │   ├── verify-python-bundling.cjs# Verify Python bundle integrity
│       │   ├── verify-linux-packages.cjs # Verify Linux package structure
│       │   └── postinstall.cjs           # Post-install hooks
│       ├── package.json                  # v2.7.13, 150+ deps, electron-builder config
│       ├── electron.vite.config.ts       # Vite config for 3 Electron processes
│       ├── vitest.config.ts              # Unit test configuration
│       └── tsconfig.json                 # TypeScript strict mode, 7 path aliases
│
├── tests/                                # Backend test suite (pytest)
├── scripts/                              # Root build utilities
│   ├── bump-version.js                   # Semantic version bumping
│   ├── install-backend.js                # Python venv setup
│   └── test-backend.js                   # Backend test runner
├── guides/                               # User documentation and tutorials
├── shared_docs/
│   └── ARCHITECTURE.md                   # Deep-dive architecture reference
├── docs/                                 # Generated project documentation
│   └── index.md                          # Master documentation index
├── .github/workflows/                    # ★ 16 CI/CD workflows
│   ├── release.yml                       # Production release (macOS notarization)
│   ├── beta-release.yml                  # Beta (Azure Trusted Signing, 746 lines)
│   ├── prepare-release.yml               # Version validation + tagging
│   ├── ci.yml                            # Cross-platform CI matrix
│   ├── lint.yml                          # Biome 2.3.11 + Ruff 0.14.10
│   ├── build-prebuilds.yml               # Native module prebuilds (node-pty)
│   ├── quality-security.yml              # CodeQL + Bandit scanning
│   ├── virustotal-scan.yml               # Post-release security scan
│   ├── claude.yml                        # @claude mention detection
│   ├── claude-code-review.yml            # Automated code review
│   ├── pr-labeler.yml                    # Conventional commit PR labels
│   ├── issue-auto-label.yml              # Issue area labels
│   ├── stale.yml                         # 60-day stale issue lifecycle
│   ├── welcome.yml                       # First-time contributor greeting
│   ├── discord-release.yml               # Discord webhook notifications
│   └── test-azure-auth.yml               # Manual OIDC verification
├── package.json                          # Root monorepo config (workspaces)
├── pnpm-lock.yaml                        # Lock file
├── ruff.toml                             # Python linter config
├── run.py                                # Backend CLI entry point (symlink/shortcut)
├── CLAUDE.md                             # AI assistant project instructions
├── README.md                             # Product readme, downloads, security model
├── CONTRIBUTING.md                       # Contribution guidelines
├── RELEASE.md                            # Release process documentation
├── CHANGELOG.md                          # Version history
├── LICENSE                               # AGPL-3.0
└── CLA.md                                # Contributor License Agreement
```

## Commands Quick Reference

### Setup
```bash
npm run install:all              # Install all dependencies from root
# Or separately:
cd apps/backend && uv venv && uv pip install -r requirements.txt
cd apps/frontend && npm install
```

### Testing

| Stack | Command | Tool |
|-------|---------|------|
| Backend | `apps/backend/.venv/bin/pytest tests/ -v` | pytest |
| Frontend unit | `cd apps/frontend && npm test` | Vitest |
| Frontend E2E | `cd apps/frontend && npm run test:e2e` | Playwright |
| All backend | `npm run test:backend` (from root) | pytest |

### Releases
```bash
node scripts/bump-version.js patch|minor|major  # Bump version
git push && gh pr create --base main             # PR to main triggers release
```

See [RELEASE.md](RELEASE.md) for full release process.

## Backend Development

### Claude Agent SDK Usage

Client: `apps/backend/core/client.py` — `create_client()` returns a configured `ClaudeSDKClient` with security hooks, tool permissions, and MCP server integration.

Model and thinking level are user-configurable (via the Electron UI settings or CLI override). Use `phase_config.py` helpers to resolve the correct values

### Agent Prompts (`apps/backend/prompts/`)

| Prompt | Purpose |
|--------|---------|
| planner.md | Implementation plan with subtasks |
| coder.md / coder_recovery.md | Subtask implementation / recovery |
| qa_reviewer.md / qa_fixer.md | Acceptance validation / issue fixes |
| spec_gatherer/researcher/writer/critic.md | Spec creation pipeline |
| complexity_assessor.md | AI-based complexity assessment |

### Spec Directory Structure

Each spec in `.auto-claude/specs/XXX-name/` contains: `spec.md`, `requirements.json`, `context.json`, `implementation_plan.json`, `qa_report.md`, `QA_FIX_REQUEST.md`

### Memory System (Graphiti)

Graph-based semantic memory in `integrations/graphiti/`. Configured through the Electron app's onboarding/settings UI (CLI users can alternatively set `GRAPHITI_ENABLED=true` in `.env`). See [ARCHITECTURE.md](shared_docs/ARCHITECTURE.md#memory-system) for details.

## Frontend Development

### Tech Stack

React 19, TypeScript (strict), Electron 39, Zustand 5, Tailwind CSS v4, Radix UI, xterm.js 6, Vite 7, Vitest 4, Biome 2, Motion (Framer Motion)

### Path Aliases (tsconfig.json)

| Alias | Maps to |
|-------|---------|
| `@/*` | `src/renderer/*` |
| `@shared/*` | `src/shared/*` |
| `@preload/*` | `src/preload/*` |
| `@features/*` | `src/renderer/features/*` |
| `@components/*` | `src/renderer/shared/components/*` |
| `@hooks/*` | `src/renderer/shared/hooks/*` |
| `@lib/*` | `src/renderer/shared/lib/*` |

### State Management (Zustand)

All state lives in `src/renderer/stores/`. Key stores:

- `project-store.ts` — Active project, project list
- `task-store.ts` — Tasks/specs management
- `terminal-store.ts` — Terminal sessions and state
- `settings-store.ts` — User preferences
- `github/issues-store.ts`, `github/pr-review-store.ts` — GitHub integration
- `insights-store.ts`, `roadmap-store.ts`, `kanban-settings-store.ts`

Main process also has stores: `src/main/project-store.ts`, `src/main/terminal-session-store.ts`

### Styling

- **Tailwind CSS v4** with `@tailwindcss/postcss` plugin
- **7 color themes** (Default, Dusk, Lime, Ocean, Retro, Neo + more) defined in `src/shared/constants/themes.ts`
- Each theme has light/dark mode variants via CSS custom properties
- Utility: `clsx` + `tailwind-merge` via `cn()` helper
- Component variants: `class-variance-authority` (CVA)

### IPC Communication

Main ↔ Renderer communication via Electron IPC:
- **Handlers:** `src/main/ipc-handlers/` — organized by domain (github, gitlab, ideation, context, etc.)
- **Preload:** `src/preload/` — exposes safe APIs to renderer
- Pattern: renderer calls via `window.electronAPI.*`, main handles in IPC handler modules

### Agent Management (`src/main/agent/`)

The frontend manages agent lifecycle end-to-end:
- **`agent-queue.ts`** — Queue routing, prioritization, spec number locking
- **`agent-process.ts`** — Spawns and manages agent subprocess communication
- **`agent-state.ts`** — Tracks running agent state and status
- **`agent-events.ts`** — Agent lifecycle events and state transitions

### Claude Profile System (`src/main/claude-profile/`)

Multi-profile credential management for switching between Claude accounts:
- **`credential-utils.ts`** — OS credential storage (Keychain/Windows Credential Manager)
- **`token-refresh.ts`** — OAuth token lifecycle and automatic refresh
- **`usage-monitor.ts`** — API usage tracking and rate limiting per profile
- **`profile-scorer.ts`** — Scores profiles by usage and availability

### Terminal System (`src/main/terminal/`)

Full PTY-based terminal integration:
- **`pty-daemon.ts`** / **`pty-manager.ts`** — Background PTY process management
- **`terminal-lifecycle.ts`** — Session creation, cleanup, event handling
- **`claude-integration-handler.ts`** — Claude SDK integration within terminals
- Renderer: xterm.js 6 with WebGL, fit, web-links, serialize addons. Store: `terminal-store.ts`

## Code Quality

### Frontend
- **Linting:** Biome (`npm run lint` / `npm run lint:fix`)
- **Type checking:** `npm run typecheck` (strict mode)
- **Pre-commit:** Husky + lint-staged runs Biome on staged `.ts/.tsx/.js/.jsx/.json`
- **Testing:** Vitest + React Testing Library + jsdom

### Backend
- **Linting:** Ruff
- **Testing:** pytest (`apps/backend/.venv/bin/pytest tests/ -v`)

## i18n Guidelines

All frontend UI text uses `react-i18next`. Translation files: `apps/frontend/src/shared/i18n/locales/{en,fr}/*.json`

**Namespaces:** `common`, `navigation`, `settings`, `dialogs`, `tasks`, `errors`, `onboarding`, `welcome`

```tsx
import { useTranslation } from 'react-i18next';
const { t } = useTranslation(['navigation', 'common']);

<span>{t('navigation:items.githubPRs')}</span>     // CORRECT
<span>GitHub PRs</span>                             // WRONG

// With interpolation:
<span>{t('errors:task.parseError', { error })}</span>
```

When adding new UI text: add keys to ALL language files, use `namespace:section.key` format.

## Cross-Platform

Supports Windows, macOS, Linux. CI tests all three.

**Platform modules:** `apps/frontend/src/main/platform/` and `apps/backend/core/platform/`

| Function | Purpose |
|----------|---------|
| `isWindows()` / `isMacOS()` / `isLinux()` | OS detection |
| `getPathDelimiter()` | `;` (Win) or `:` (Unix) |
| `findExecutable(name)` | Cross-platform executable lookup |
| `requiresShell(command)` | `.cmd/.bat` shell detection (Win) |

Never hardcode paths. Use `findExecutable()` and `joinPaths()`. See [ARCHITECTURE.md](shared_docs/ARCHITECTURE.md#cross-platform-development) for extended guide.

## E2E Testing (Electron MCP)

QA agents can interact with the running Electron app via Chrome DevTools Protocol:

1. Start app: `npm run dev:debug` (debug mode for AI self-validation via Electron MCP)
2. Set `ELECTRON_MCP_ENABLED=true` in `apps/backend/.env`
3. Run QA: `python run.py --spec 001 --qa`

Tools: `take_screenshot`, `click_by_text`, `fill_input`, `get_page_structure`, `send_keyboard_shortcut`, `eval`. See [ARCHITECTURE.md](shared_docs/ARCHITECTURE.md#end-to-end-testing) for full capabilities.

## Running the Application

```bash
# CLI only
cd apps/backend && python run.py --spec 001

# Desktop app
npm start          # Production build + run
npm run dev        # Development mode with HMR
npm run dev:debug  # Debug mode with verbose output
npm run dev:mcp    # Electron MCP server for AI debugging

# Project data: .auto-claude/specs/ (gitignored)
```
