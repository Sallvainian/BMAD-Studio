# BMAD-Studio — Source Tree Analysis

**Generated:** 2026-02-23 | **Scan Level:** Deep

## Annotated Directory Tree

```
BMAD-Studio/                              # Monorepo root (npm workspaces: apps/*, libs/*)
├── apps/
│   ├── backend/                          # Python backend — ALL agent logic
│   │   ├── run.py                        # Main entry point (Python 3.10+ enforced)
│   │   ├── cli/main.py                   # CLI command router (50+ flags)
│   │   ├── core/                         # SDK client, auth, worktree, platform
│   │   │   ├── client.py                 # Claude Agent SDK client (40KB)
│   │   │   ├── auth.py                   # OAuth + credential storage (46KB)
│   │   │   ├── worktree.py               # Git worktree isolation
│   │   │   ├── progress.py               # Task progress tracking
│   │   │   ├── model_config.py           # Model configuration
│   │   │   ├── platform/                 # Cross-platform abstractions
│   │   │   └── workspace/                # Workspace management
│   │   ├── agents/                       # Agent orchestration
│   │   │   ├── coder.py                  # Main agent loop (66KB)
│   │   │   ├── planner.py                # Follow-up planning
│   │   │   ├── session.py                # Agent session management (29KB)
│   │   │   ├── memory_manager.py         # Graphiti memory (18KB)
│   │   │   └── tools_pkg/models.py       # Phase-aware tool configs
│   │   ├── spec/                         # Spec creation pipeline
│   │   │   ├── pipeline.py               # SpecOrchestrator
│   │   │   ├── complexity.py             # AI complexity assessment (18KB)
│   │   │   ├── validation_strategy.py    # Multi-strategy validation (34KB)
│   │   │   └── phases/                   # Spec phase implementations
│   │   ├── qa/                           # QA validation system
│   │   │   ├── loop.py                   # QA iteration loop (25KB)
│   │   │   ├── reviewer.py               # QA validation agent (17KB)
│   │   │   ├── fixer.py                  # Issue resolution (15KB)
│   │   │   └── report.py                 # Issue tracking & escalation (15KB)
│   │   ├── security/                     # Three-layer command security
│   │   │   ├── hooks.py                  # Pre-tool-use validation
│   │   │   ├── parser.py                 # Command parsing (9.6KB)
│   │   │   ├── database_validators.py    # MySQL/PostgreSQL/MongoDB (13KB)
│   │   │   ├── git_validators.py         # Git validation (11KB)
│   │   │   └── shell_validators.py       # Shell validation
│   │   ├── integrations/                 # External services
│   │   │   ├── graphiti/                 # Knowledge graph memory
│   │   │   │   └── providers_pkg/        # Embedder/LLM providers
│   │   │   ├── linear/                   # Linear PM integration
│   │   │   └── github/                   # GitHub PR/issue management
│   │   ├── context/                      # Smart context building
│   │   │   ├── builder.py                # ContextBuilder
│   │   │   ├── search.py                 # Code search
│   │   │   └── graphiti_integration.py   # Memory graph hints
│   │   ├── implementation_plan/          # Plan data structures
│   │   ├── merge/                        # Semantic merge for parallel agents
│   │   ├── runners/                      # Standalone execution runners
│   │   ├── project/                      # Project analysis
│   │   ├── task_logger/                  # Task logging
│   │   ├── phase_config.py               # Model/thinking config
│   │   ├── prompts/                      # Agent system prompts (20+ files)
│   │   ├── requirements.txt              # Python dependencies
│   │   └── pyproject.toml                # Python project config
│   │
│   └── frontend/                         # Electron desktop UI
│       ├── src/
│       │   ├── main/                     # Electron main process
│       │   │   ├── index.ts              # Entry point (665 lines)
│       │   │   ├── agent/                # Agent management (16 files)
│       │   │   ├── claude-profile/       # Multi-profile credentials (18 files)
│       │   │   ├── terminal/             # PTY terminal system
│       │   │   ├── ipc-handlers/         # 32 handler modules by domain
│       │   │   ├── platform/             # Cross-platform abstractions
│       │   │   ├── services/             # Profile service
│       │   │   ├── changelog/            # Changelog generation
│       │   │   ├── insights/             # Codebase insights
│       │   │   └── updater/              # App auto-update
│       │   ├── renderer/                 # React UI
│       │   │   ├── App.tsx               # Root component (1187 lines)
│       │   │   ├── components/           # 69+ components by feature
│       │   │   ├── stores/               # 20 Zustand state stores
│       │   │   ├── hooks/                # 9 custom React hooks
│       │   │   └── contexts/             # ViewStateContext
│       │   ├── preload/                  # Electron preload bridge
│       │   │   └── api/                  # 14 domain-specific API modules
│       │   └── shared/                   # Shared types and utilities
│       │       ├── types/                # 20 type definition files
│       │       ├── i18n/locales/         # en/ + fr/ (11 namespaces)
│       │       └── constants/            # Themes, channels, defaults
│       ├── e2e/                          # Playwright E2E tests
│       ├── scripts/                      # Build utilities
│       └── resources/                    # App icons
│
├── tests/                                # Backend test suite (pytest)
├── scripts/                              # Root build utilities
├── guides/                               # User documentation
├── shared_docs/ARCHITECTURE.md           # Deep-dive architecture ref
├── docs/                                 # Generated documentation
├── .github/workflows/                    # 16 CI/CD workflows
├── package.json                          # Root monorepo config
├── pnpm-lock.yaml                        # Lock file
├── ruff.toml                             # Python linter config
├── CLAUDE.md                             # AI assistant instructions
├── README.md                             # Product readme
├── RELEASE.md                            # Release process
└── LICENSE                               # AGPL-3.0
```

## Critical Folders

| Folder | Purpose |
|--------|---------|
| `apps/backend/core/` | SDK client, auth, platform abstractions |
| `apps/backend/agents/` | Agent orchestration (coder, planner, session) |
| `apps/backend/spec/` | Spec creation pipeline (complexity-driven) |
| `apps/backend/qa/` | QA validation loop (max 50 iterations) |
| `apps/backend/security/` | Three-layer command validation |
| `apps/frontend/src/main/ipc-handlers/` | 32 domain-specific IPC modules |
| `apps/frontend/src/main/claude-profile/` | Multi-account credential system |
| `apps/frontend/src/renderer/stores/` | 20 Zustand state stores |
| `apps/frontend/src/renderer/components/` | 69+ React components |

## Entry Points

| Part | Entry Point | Purpose |
|------|-------------|---------|
| Backend CLI | `apps/backend/run.py` → `cli/main.py` | CLI with 50+ flags |
| Frontend Main | `apps/frontend/src/main/index.ts` | Electron window, IPC, services |
| Frontend Renderer | `apps/frontend/src/renderer/App.tsx` | React root component |
| Frontend Preload | `apps/frontend/src/preload/index.ts` | contextBridge API |
