# Architecture — Backend (Python Agent System)

**Generated:** 2026-02-23 | **Part:** `apps/backend/` | **Language:** Python 3.12+

## Executive Summary

The backend is a Python 3.12+ agent orchestration system that uses the Claude Agent SDK to run autonomous coding pipelines. It handles specification creation, implementation planning, code generation, and QA validation — all operating in isolated git worktrees.

## Entry Points

| Entry | File | Purpose |
|-------|------|---------|
| CLI | `run.py` → `cli/main.py` | 50+ CLI flags for all workflows |
| Module | `core/__init__.py` | Lazy import facade for programmatic use |

### CLI Commands

| Command | Description |
|---------|-------------|
| `--spec SPEC_ID` | Run a specification (build) |
| `--qa` | Run QA validation loop |
| `--merge` | Merge completed build |
| `--review` | Review what was built |
| `--discard` | Delete build |
| `--create-pr` | Push branch and create GitHub PR |
| `--followup` | Add follow-up tasks |
| `--list` | List all available specs |
| `--batch-create` | Batch task operations |
| `--list-worktrees` | Git worktree management |

### CLI Options

| Option | Description |
|--------|-------------|
| `--model` | Override default model |
| `--verbose` | Enable debug output |
| `--isolated` / `--direct` | Force workspace isolation mode |
| `--max-iterations` | Limit agent sessions |
| `--skip-qa` | Skip automatic QA validation |
| `--auto-continue` | Non-interactive mode for UI |
| `--base-branch` | Base branch for worktree |

## Core Module (`core/`)

### SDK Client (`core/client.py` — 40KB)

The client factory creates a configured `ClaudeSDKClient` with:

- **Message Parser Patch:** Handles unknown SDK message types (e.g., `rate_limit_event`) by converting to `SystemMessage` instead of crashing
- **Windows System Prompt Limits:** Caps CLAUDE.md at 20,000 chars due to Windows 32,768 char `CreateProcessW` limit
- **Project Index Caching:** 5-minute TTL cache with thread-safe double-checked locking
- **MCP Server Security Validation:** Three-layer validation:
  - Safe command allowlist (`npx`, `npm`, `node`, `python`, `uv`, `uvx`)
  - Dangerous command blocklist (`bash`, `sh`, `cmd`, `powershell`)
  - Dangerous flag blocklist (`-e`, `-c`, `-m`, `--eval`, `--require`)
  - Path validation and HTTP URL validation

### Authentication (`core/auth.py` — 46KB)

**Token resolution priority:**
1. `CLAUDE_CODE_OAUTH_TOKEN` (Claude Code OAuth)
2. `ANTHROPIC_AUTH_TOKEN` (CCR/proxy token for enterprise)
3. Does NOT fall back to `ANTHROPIC_API_KEY` (prevents silent API billing)

**Cross-platform credential storage:**
- macOS: Keychain
- Windows: Windows Credential Manager
- Linux: Freedesktop Secret Service (DBus via `secretstorage`)

### Other Core Modules

| Module | Purpose |
|--------|---------|
| `worktree.py` | Git worktree isolation management |
| `progress.py` | Subtask counting and progress tracking |
| `model_config.py` | Default model configuration |
| `platform/` | Cross-platform path and executable abstractions |
| `recovery/` | SDK session recovery mechanisms |
| `workspace/` | Workspace management |

## Agent Architecture (`agents/`)

### Agent Pipeline Flow

```
User Task → Spec Pipeline → Planner → Coder (per subtask) → QA Loop → Complete
                                         ↓
                              Session → SDK Client → Claude API
                                         ↓
                              Memory → Graphiti Knowledge Graph
```

### Coder Agent (`agents/coder.py` — 66KB)

The main agent loop that implements subtasks:

1. Load spec and implementation plan
2. Iterate through phases and subtasks
3. Run agent session for each subtask (via `session.py`)
4. Track progress with retry logic
5. Update Linear integration (if configured)
6. Persist discoveries to Graphiti memory

**Error handling:**
- `MAX_SUBTASK_RETRIES = 5` per subtask
- Rate limit handling with exponential backoff (up to 5 minutes)
- Authentication failure pause file support
- Concurrency retry logic (max 3 retries)
- Recovery manager for rollback/retry/skip/escalate actions

**Auto-continue:**
- 30-second delay before auto-resuming
- Skips if human intervention file exists

### Session Management (`agents/session.py` — 29KB)

Core function: `run_agent_session()`
- Creates SDK client with phase-aware tools and MCP configuration
- Runs async message stream from Claude
- Handles tool calls and responses
- Post-session: commit counting, memory updates, recovery actions, Linear updates

### Memory Manager (`agents/memory_manager.py` — 18KB)

- Graphiti integration for semantic knowledge graph
- File-based fallback when Graphiti is disabled
- Episode recording (session insights)
- Functions: `get_graphiti_context()`, `save_session_memory()`

### Tool Configuration (`agents/tools_pkg/models.py`)

Phase-aware tool access:

| Phase | Tools | MCP Servers |
|-------|-------|-------------|
| `spec_gatherer` | Read + Web | — |
| `spec_researcher` | Read + Web | Context7 |
| `spec_writer` | Read + Write | Context7 |
| `planner` | Read + Write | Context7 |
| `coder` | Read + Write + Custom | Context7 |
| `qa_reviewer` | Read | Context7, Puppeteer, Electron |
| `qa_fixer` | Read + Write | Context7 |

**Custom Auto-Claude tools:** `update_subtask_status`, `get_build_progress`, `record_discovery`, `update_qa_status`

## Spec Pipeline (`spec/`)

### Complexity-Driven Phase Selection

**Complexity tiers:**

| Tier | Scope | Phase Sequence |
|------|-------|---------------|
| SIMPLE | 1–2 files, single service | discovery → historical_context → quick_spec → validation |
| STANDARD | 3–10 files, 1–2 services | discovery → requirements → [research?] → context → spec_writing → planning → validation |
| COMPLEX | 10+ files, multiple services | discovery → requirements → research → context → spec_writing → self_critique → planning → validation |

**Key files:**
- `pipeline.py` — `SpecOrchestrator` class, main orchestration
- `complexity.py` (18KB) — AI + heuristic complexity assessment
- `validation_strategy.py` (34KB) — Multi-strategy validation

## QA System (`qa/`)

### Self-Validating Loop

```
QA Reviewer → Issues Found? → QA Fixer → QA Reviewer → Loop
                    ↓ No
              Approved ✓
```

- **Max iterations:** 50
- **Max consecutive errors:** 3
- **Recurring issue detection:** 3+ similar issues → escalate to human
- **No-test project handling:** Skip QA for projects without test infrastructure

**Key files:**
- `loop.py` (25KB) — Main QA orchestration loop
- `reviewer.py` (17KB) — Validation agent
- `fixer.py` (15KB) — Issue resolution agent
- `report.py` (15KB) — Issue tracking and escalation

## Security System (`security/`)

### Three-Layer Command Validation

All commands executed by agents pass through the security system before execution:

1. **Tool input validation** — Must be dict with 'command' key
2. **Command extraction** — Parse command from shell string
3. **Security profile lookup** — Project-specific rules
4. **Command allowlist** — Base allowlist + stack-specific additions
5. **Sensitive command validation** — Per-command validators

**Validators:**
- Database: MySQL, PostgreSQL, MongoDB shell commands
- Git: commit, config, destructive operations
- Filesystem: rm/trash with scope validation
- Shell: bash, sh, zsh execution

## Integrations

### Graphiti Memory (`integrations/graphiti/`)

Semantic knowledge graph for cross-session context:
- **Multiple embedder providers:** OpenAI, Google, Azure OpenAI, Ollama, OpenRouter, Voyage
- **Database:** LadybugDB (embedded graph database, Python 3.12+)
- **Framework:** graphiti-core for episode recording and graph reasoning
- **Graceful fallback:** No-op when disabled

### Linear PM (`integrations/linear/`)

Task lifecycle updates: started → stuck → build_complete → QA phases

### GitHub (`integrations/github/`)

PR creation, issue management, investigation workflows

## Model Configuration (`phase_config.py`)

### Model ID Map

| Shorthand | Full Model ID |
|-----------|---------------|
| `opus` | `claude-opus-4-6` |
| `sonnet` | `claude-sonnet-4-6` |
| `haiku` | `claude-haiku-4-5-20251001` |
| `opus-4.5` | `claude-opus-4-5-20251101` |
| `sonnet-4.5` | `claude-sonnet-4-5-20250929` |

### Thinking Budgets

| Level | Token Budget |
|-------|-------------|
| low | 1,024 |
| medium | 4,096 |
| high | 16,384 |

### Default Phase Models (Balanced Profile)

All phases default to `sonnet`. Spec phases use `high` thinking for discovery, spec_writing, self_critique; `medium` for requirements, research.

## Prompt System (`prompts/`)

20+ markdown prompt files for all agent phases:

| Prompt | Size | Purpose |
|--------|------|---------|
| `coder.md` | 35KB | Main implementation agent |
| `planner.md` | 33KB | Implementation planning |
| `complexity_assessor.md` | 21KB | Complexity assessment |
| `qa_reviewer.md` | 18KB | QA validation |
| `qa_fixer.md` | 10KB | Issue fixing |
| `spec_critic.md` | 10KB | Spec quality review |
| `followup_planner.md` | 9.7KB | Follow-up planning |

Plus ideation, insights, roadmap, and analysis prompts.

## Environment Variables

### Authentication
- `CLAUDE_CODE_OAUTH_TOKEN` — Primary OAuth token
- `ANTHROPIC_AUTH_TOKEN` — Fallback (CCR/proxy)

### Model Configuration
- `AUTO_BUILD_MODEL` — Override default model
- `ANTHROPIC_BASE_URL` — Custom API endpoint
- `UTILITY_MODEL_ID` / `UTILITY_THINKING_BUDGET` — Utility operations

### Feature Flags
- `GRAPHITI_ENABLED` — Enable knowledge graph memory
- `LINEAR_API_KEY` — Enable Linear integration
- `SENTRY_DSN` — Enable error tracking
- `ELECTRON_MCP_ENABLED` — Enable Electron MCP for QA
- `DISABLE_TELEMETRY` — Disable SDK telemetry

## Testing

- **Framework:** pytest 9.0.2
- **Test paths:** `integrations/graphiti/tests`, `core/workspace/tests`
- **Markers:** `slow`, `integration`, `smoke`
- **Coverage source:** agents, cli, context, qa, spec, runners, services
- **Config:** `pyproject.toml` with maxfail=5, short tracebacks
