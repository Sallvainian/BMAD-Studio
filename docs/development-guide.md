# Development Guide

**Generated:** 2026-02-23 | **Scan Level:** Deep

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Python | 3.12+ | Required for backend and Graphiti |
| Node.js | 24+ | Required for frontend |
| npm | 10+ | Package manager |
| Git | Latest | Version control |
| CMake | Latest | For native dependencies (LadybugDB) |
| uv (optional) | Latest | Fast Python package installer |

## Quick Setup

```bash
git clone https://github.com/Sallvainian/BMAD-Studio.git
cd BMAD-Studio
npm run install:all         # Sets up Python venv + Node deps
npm run dev                 # Development mode with HMR
```

### Manual Setup

```bash
# Backend
cd apps/backend
uv venv && uv pip install -r requirements.txt
# Or: python -m venv .venv && pip install -r requirements.txt

# Frontend
cd apps/frontend
npm install
```

## Running the Application

| Command | Purpose |
|---------|---------|
| `npm run dev` | Development mode with hot reload |
| `npm run dev:debug` | Development with DEBUG=true |
| `npm run dev:mcp` | Development with MCP remote debugging (port 9222) |
| `npm start` | Production build + run |
| `npm start:mcp` | Production with remote debugging |
| `npm run build` | Production build only |
| `npm run preview` | Preview production build |

### CLI Only (Backend)

```bash
cd apps/backend
python run.py --spec 001               # Run spec
python run.py --spec 001 --qa          # Run QA only
python run.py --spec 001 --auto-continue # Auto-continue mode
```

## Environment Configuration

### Frontend (`apps/frontend/.env`)

| Variable | Purpose | Default |
|----------|---------|---------|
| DEBUG | Debug logging | false |
| DEBUG_UPDATER | Auto-updater debug | false |
| SENTRY_DSN | Error reporting endpoint | — |
| SENTRY_DEV | Force Sentry in dev mode | false |
| SENTRY_TRACES_SAMPLE_RATE | Transaction sampling | 0.1 |
| NODE_ENV | Electron environment | development |

### Backend (`apps/backend/.env`)

| Variable | Purpose | Required |
|----------|---------|----------|
| CLAUDE_CODE_OAUTH_TOKEN | OAuth authentication | Yes (or API key) |
| ANTHROPIC_AUTH_TOKEN | Enterprise/CCR token | Alternative auth |
| ANTHROPIC_BASE_URL | Custom API endpoint | No |
| AUTO_BUILD_MODEL | Model override | No |
| DEFAULT_BRANCH | Git default branch | No (defaults: main) |
| DEBUG | Debug mode | No |
| LINEAR_API_KEY | Linear PM integration | No |
| GITLAB_TOKEN | GitLab integration | No |
| GRAPHITI_ENABLED | Knowledge graph memory | No |
| GRAPHITI_LLM_PROVIDER | LLM provider for memory | No |
| GRAPHITI_EMBEDDER_PROVIDER | Embedding provider | No |
| ELECTRON_MCP_ENABLED | MCP server for E2E testing | No |

See `apps/backend/.env.example` for complete reference including Graphiti provider options (OpenAI, Anthropic+Voyage, Ollama, Azure OpenAI, Google, OpenRouter).

## Testing

### Backend Tests (pytest)

```bash
# From root
npm run test:backend

# From backend directory
apps/backend/.venv/bin/pytest tests/ -v

# Skip slow tests (default behavior)
apps/backend/.venv/bin/pytest tests/ -m "not slow"

# Run specific markers
apps/backend/.venv/bin/pytest tests/ -m integration
apps/backend/.venv/bin/pytest tests/ -m smoke
```

**Test Configuration (pyproject.toml):**
- Test paths: `integrations/graphiti/tests`, `core/workspace/tests`
- Markers: `slow` (>2 sec or external services), `integration`, `smoke`
- Default: Skip slow tests, maxfail=5, verbose, short traceback
- Coverage sources: integrations, core, agents, cli, context, qa, spec, runners, services

### Frontend Unit Tests (Vitest)

```bash
cd apps/frontend
npm test                    # Run tests
npm run test:watch          # Watch mode
npm run test:coverage       # Coverage report
```

### E2E Tests (Playwright)

```bash
cd apps/frontend
npm run test:e2e
```

Configuration in `apps/frontend/e2e/playwright.config.ts`.

## Code Quality

### Linting

| Stack | Tool | Command |
|-------|------|---------|
| Python | Ruff 0.14.10 | `npm run lint:backend` |
| Frontend | Biome 2.3.11 | `cd apps/frontend && npm run lint` |
| Frontend fix | Biome | `cd apps/frontend && npm run lint:fix` |
| Formatting | Biome | `cd apps/frontend && npm run format` |

### Type Checking

```bash
cd apps/frontend && npm run typecheck   # TypeScript strict mode
```

### Pre-commit Hooks

Husky + lint-staged runs automatically on staged files:
- Biome check (with --write) on `*.{ts,tsx,js,jsx,json}`

## Python Linting Rules (Ruff)

**Enabled rule sets:** E (pycodestyle errors), W (warnings), F (Pyflakes), I (isort), B (flake8-bugbear), C4 (comprehensions), UP (pyupgrade)

**Key ignored rules:** E501 (line length), B008/B904/B905 (bugbear exceptions), E402 (import order)

**Per-file overrides:**
- `__init__.py`: F401 (unused imports allowed for re-exports)
- `tests/*`: B011 (assert False allowed)

## TypeScript Configuration

**Strict mode enabled** with these path aliases:

| Alias | Maps to |
|-------|---------|
| `@/*` | `src/renderer/*` |
| `@shared/*` | `src/shared/*` |
| `@preload/*` | `src/preload/*` |
| `@features/*` | `src/renderer/features/*` |
| `@components/*` | `src/renderer/shared/components/*` |
| `@hooks/*` | `src/renderer/shared/hooks/*` |
| `@lib/*` | `src/renderer/shared/lib/*` |

## Build Configuration

**Electron Vite** (`electron.vite.config.ts`) configures three Electron processes:
- **Main:** Node.js main process
- **Preload:** contextBridge scripts
- **Renderer:** React UI with Vite HMR

**Bundled packages:** uuid, chokidar, dotenv, electron-log, minimatch, xstate, zod, @sentry/*, @anthropic-ai/sdk

**External (rebuilt by electron-builder):** @lydell/node-pty

## Code Style Guidelines

### Python
- PEP 8, type hints required on function signatures
- Docstrings for public functions/classes
- Keep functions under 50 lines
- Always use `encoding="utf-8"` for file operations (Windows compatibility)

### TypeScript/React
- TypeScript strict mode, no implicit `any`
- Functional components with hooks
- Named exports over default exports
- Use Radix UI primitives from `src/renderer/components/ui/`

### File Naming
- React components: PascalCase (`TaskCard.tsx`)
- Hooks: camelCase with `use` prefix (`useTaskStore.ts`)
- Stores: kebab-case (`task-store.ts`)
- Types: PascalCase (`Task.ts`)
- Constants: SCREAMING_SNAKE_CASE

### Import Order
1. External libraries
2. Shared components and utilities
3. Feature imports
4. Type-only imports

## Git Workflow (Git Flow)

| Branch | Purpose | Merges to |
|--------|---------|-----------|
| `main` | Production-ready, tagged releases | — |
| `develop` | Integration branch | main (via release) |
| `feature/*` | New features | develop |
| `fix/*` | Bug fixes | develop |
| `release/vX.Y.Z` | Release preparation | main + develop |
| `hotfix/*` | Production hotfixes | main + develop |

**PR Requirements:**
- Target `develop` (NOT `main`)
- All tests pass
- No linting errors
- TypeScript type checking passes
- Rebase onto develop before merge

## i18n

All frontend UI text uses `react-i18next`. Translation files in `apps/frontend/src/shared/i18n/locales/{en,fr}/`.

**11 namespaces:** common, navigation, settings, tasks, taskReview, dialogs, errors, onboarding, welcome, terminal, gitlab

When adding new UI text, add keys to ALL language files using `namespace:section.key` format.
