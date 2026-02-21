# Python to TypeScript Migration Plan

## Single source of truth for the complete migration from Python claude-agent-sdk to TypeScript Vercel AI SDK v6.

---

## 1. Executive Summary

### Current State

The migration from Python `claude-agent-sdk` to a TypeScript-native AI execution layer using the Vercel AI SDK v6 is approximately 35% complete. The core execution infrastructure is fully operational and end-to-end validated: spec creation, task execution (planning + coding), and QA review all run through the TypeScript agent layer. The Electron main process never spawns a Python agent process for primary AI work.

**What works today (TypeScript, production-ready):**

- Session runtime (`runAgentSession()` via `streamText()` with tool-use loops)
- Worker thread execution (agent sessions run in `worker_threads`, bridged via `WorkerBridge`)
- Provider factory (9 providers: Anthropic, OpenAI, Google, Bedrock, Azure, Mistral, Groq, xAI, Ollama)
- OAuth and API-key authentication with automatic token refresh
- 8 builtin tools (Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch)
- Build orchestrator (planning → coding → QA pipeline)
- Spec orchestrator (11-phase complexity-driven pipeline)
- QA loop (reviewer/fixer iteration with recurring issue detection)
- Recovery manager (attempt tracking, rollback, stuck detection)
- Insights runner (full LLM-powered codebase analysis)
- GitHub PR review (parallel orchestrator, followup reviewer, triage engine)
- GitLab MR review engine
- Roadmap runner (~60% complete)
- Commit message generator
- Changelog generator
- Merge resolver (AI resolution phase only)
- Error classification (rate_limit, auth_failure, tool_concurrency)
- Progress tracking with step counts and token usage
- Task log writer

**What still requires Python or is missing from TypeScript:**

- Security validators: 19 specific command validators are stubbed out in `VALIDATORS` map (the dispatch framework exists but all validator functions are empty)
- Secret scanning module (561-line Python module, not ported)
- Prompt loading system (prompts are read directly by Python; TypeScript has no `loadPrompt()` utility)
- Auto-Claude custom tools: `record_gotcha` and `get_session_context` are referenced in configs but not implemented
- Context system (keyword extraction, service matching, file categorization, pattern discovery)
- Project analyzer (stack detection, framework detection, command registry, security profile generation)
- Spec pipeline: validation framework with auto-fix, conversation compaction between phases
- QA loop: iteration history persistence to `implementation_plan.json`, report generation (QA_ESCALATION.md, MANUAL_TEST_PLAN.md)
- Post-session processing: insight extraction integration, Linear subtask updates
- Rate-limit / auth pause file handling (RATE_LIMIT_PAUSE_FILE, AUTH_FAILURE_PAUSE_FILE)
- Coder prompt generation: `generate_planner_prompt()`, `generate_subtask_prompt()` with file validation
- Merge system: semantic analyzer, conflict detector, auto-merger (only AI resolver is ported)
- Ideation runner orchestrator (4-phase parallel pipeline)
- Runner IPC wiring (insights runner is 100% complete but not wired to IPC handlers)
- CLAUDE.md injection into agent system prompts

### Total Migration Scope

| Module | Python LOC | Status |
|--------|-----------|--------|
| Security validators | 2,871 | Stubbed (framework exists, validators empty) |
| Agents (coder, planner, session) | 5,560 | Orchestration ported, validators/prompts missing |
| Spec pipeline | 6,188 | Orchestrator ported, validation/compaction missing |
| QA loop | 2,379 | Core loop ported, reporting/history missing |
| Context system | 1,042 | Not started |
| Project analyzer | 2,496 | Not started |
| Runners (GitHub, GitLab, insights, etc.) | 37,207 | ~40% ported |
| Merge system | 9,969 | AI resolver only (~15%) |
| Prompts pkg | 1,495 | Not started (prompts are .md files, loader not ported) |
| Miscellaneous (phase_config, recovery, etc.) | ~4,000 | Mostly ported |
| **Total** | **~73,200** | **~35% ported** |

Note: The runners total includes the large GitHub orchestration suite (31,523 lines). Scoped to "agent-relevant" Python (security + agents + spec + qa + context + project + merge + prompts), the total is approximately 30,000 lines with ~40% ported.

### Key Architecture Decision: Graphiti Stays Python

Graphiti (the semantic memory graph) remains as a Python MCP sidecar. The TypeScript agent layer connects to it via `createMCPClient` from `@ai-sdk/mcp`. This decision is final and not subject to migration. The Python files in `apps/backend/integrations/graphiti/` are permanent.

---

## 2. Migration Status Dashboard

### Core AI Layer (`apps/frontend/src/main/ai/`)

| Subdirectory | Purpose | Status | Key TS Files |
|---|---|---|---|
| `providers/` | Multi-provider factory | 100% | `factory.ts`, `transforms.ts`, `registry.ts` |
| `auth/` | Token resolution, OAuth | 100% | `resolver.ts` |
| `session/` | `streamText()` runtime | 100% | `runner.ts`, `stream-handler.ts`, `error-classifier.ts`, `progress-tracker.ts` |
| `agent/` | Worker thread bridge | 100% | `worker.ts`, `worker-bridge.ts` |
| `config/` | Agent configs, phase config | 100% | `agent-configs.ts`, `phase-config.ts` |
| `tools/builtin/` | 8 builtin tools | 100% | `bash.ts`, `read.ts`, `write.ts`, `edit.ts`, `glob.ts`, `grep.ts`, `web-fetch.ts`, `web-search.ts` |
| `tools/` | Tool registry | 95% | `registry.ts` (auto-claude tool implementations missing) |
| `security/` | Bash validator framework | 40% | `bash-validator.ts`, `command-parser.ts`, `path-containment.ts` (VALIDATORS map empty) |
| `orchestration/` | Build + spec + QA pipelines | 85% | `build-orchestrator.ts`, `spec-orchestrator.ts`, `qa-loop.ts`, `recovery-manager.ts`, `subtask-iterator.ts` |
| `runners/insights.ts` | Codebase analysis | 100% | `insights.ts` (IPC not wired) |
| `runners/insight-extractor.ts` | Post-session insight extraction | 100% | `insight-extractor.ts` |
| `runners/roadmap.ts` | Roadmap generation | 60% | `roadmap.ts` (competitor + graph phases missing) |
| `runners/commit-message.ts` | Commit message generation | 100% | `commit-message.ts` |
| `runners/changelog.ts` | Changelog generation | 100% | `changelog.ts` |
| `runners/github/` | GitHub PR review | 80% | `pr-review-engine.ts`, `parallel-orchestrator.ts`, `parallel-followup.ts`, `triage-engine.ts` |
| `runners/gitlab/` | GitLab MR review | 70% | `mr-review-engine.ts` |
| `runners/ideation.ts` | Ideation pipeline | 30% | `ideation.ts` (orchestrator skeleton only) |
| `runners/merge-resolver.ts` | AI merge resolution | 100% | `merge-resolver.ts` |
| `mcp/` | MCP client integration | 100% | MCP server connection + tool injection |
| `logging/` | Task log writer | 100% | `task-log-writer.ts` |
| `worktree/` | Worktree utilities | 100% | Ported from `worktree.py` |

### Python Modules to Port

| Python Module | LOC | TS Target | % Done | Blocking |
|---|---|---|---|---|
| `security/process_validators.py` | 134 | `ai/security/bash-validator.ts` (VALIDATORS) | 0% | Bash tool safety |
| `security/filesystem_validators.py` | 155 | `ai/security/bash-validator.ts` (VALIDATORS) | 0% | Bash tool safety |
| `security/git_validators.py` | 303 | `ai/security/bash-validator.ts` (VALIDATORS) | 0% | Bash tool safety |
| `security/shell_validators.py` | 153 | `ai/security/bash-validator.ts` (VALIDATORS) | 0% | Bash tool safety |
| `security/database_validators.py` | 444 | `ai/security/bash-validator.ts` (VALIDATORS) | 0% | Bash tool safety |
| `security/scan_secrets.py` | 561 | `ai/security/secret-scanner.ts` | 0% | Pre-commit safety |
| `security/tool_input_validator.py` | 97 | `ai/security/tool-input-validator.ts` | 0% | Tool safety |
| `security/profile.py` | 128 | `ai/security/security-profile.ts` | 30% | Dynamic allowlisting |
| `prompts_pkg/prompt_generator.py` | 1,495 | `ai/prompts/prompt-loader.ts` | 0% | All agent phases |
| `agents/tools_pkg/tools/memory.py` (record_gotcha) | ~100 | `ai/tools/builtin/record-gotcha.ts` | 0% | Coder agent |
| `agents/tools_pkg/tools/memory.py` (get_session_context) | ~80 | `ai/tools/builtin/get-session-context.ts` | 0% | Coder agent |
| `spec/validate_pkg/` | ~500 | `ai/orchestration/spec-validator.ts` | 0% | Spec validation |
| `spec/compaction.py` | 155 | `ai/orchestration/spec-orchestrator.ts` | 0% | Spec pipeline |
| `spec/complexity.py` | 463 | `ai/orchestration/spec-orchestrator.ts` | 60% | Complexity gating |
| `qa/report.py` | 523 | `ai/orchestration/qa-loop.ts` | 20% | QA reporting |
| `context/keyword_extractor.py` | 101 | `ai/context/keyword-extractor.ts` | 0% | Context building |
| `context/search.py` | 101 | `ai/context/search.ts` | 0% | Context building |
| `context/service_matcher.py` | 81 | `ai/context/service-matcher.ts` | 0% | Context building |
| `context/categorizer.py` | 73 | `ai/context/categorizer.ts` | 0% | Context building |
| `context/builder.py` | 250 | `ai/context/builder.ts` | 0% | Spec + coder |
| `project/analyzer.py` | 428 | `ai/project/analyzer.ts` | 0% | Security profile |
| `project/stack_detector.py` | 369 | `ai/project/stack-detector.ts` | 0% | Project analysis |
| `project/framework_detector.py` | 265 | `ai/project/framework-detector.ts` | 0% | Project analysis |
| `project/command_registry/` | ~500 | `ai/project/command-registry.ts` | 0% | Security profile |
| `merge/semantic_analysis/` | ~430 | `ai/merge/semantic-analyzer.ts` | 0% | Merge system |
| `merge/conflict_detector.py` | ~300 | `ai/merge/conflict-detector.ts` | 0% | Merge system |
| `merge/auto_merger/` | ~700 | `ai/merge/auto-merger.ts` | 0% | Merge system |
| `merge/file_evolution/` | ~1,200 | `ai/merge/file-evolution.ts` | 0% | Merge system |

---

## 3. Architecture Overview

### Current Architecture

```
Electron Renderer Process
        |
        | IPC (window.electronAPI.*)
        v
Electron Main Process
        |
        +-- agent-manager.ts
        |     - spawnWorkerProcess() for spec, task, QA
        |
        +-- WorkerBridge (worker-bridge.ts)
        |     - Spawns worker_thread
        |     - Relays postMessage() events to AgentManagerEvents
        |
        v
  Worker Thread (worker.ts)
        |
        +-- runSingleSession() or buildKickoffMessage()
        |
        v
  runAgentSession() (session/runner.ts)
        |
        +-- streamText() [Vercel AI SDK v6]
        |     - model: LanguageModel (from provider factory)
        |     - tools: ToolRegistry.getToolsForAgent(agentType)
        |     - stopWhen: stepCountIs(1000)
        |     - onStepFinish: ProgressTracker
        |
        v
  Tool Execution
        +-- Builtin tools (bash.ts, read.ts, write.ts, ...)
        +-- MCP tools (Graphiti, Linear, Context7, ...)
        +-- Security validation (bash-validator.ts → VALIDATORS map)
```

### How Python Is Currently Invoked

Python is **not** invoked for AI agent execution. All AI work goes through TypeScript. The only remaining Python invocations are:

1. **Graphiti MCP sidecar**: Spawned as a background process (`integrations/graphiti/`) when Graphiti memory is enabled. The TypeScript layer connects to it via MCP protocol.
2. **Worktree operations**: `worktree.py` utilities may still be called via subprocess in some paths; `worktree/` in the TypeScript layer replaces this.
3. **Legacy CLI** (`run.py`): The Python CLI still exists for backward compatibility but is not used by the Electron UI for agent execution.

### Target Architecture (Post-Migration)

```
Electron App
        |
        v
TypeScript Agent Layer (apps/frontend/src/main/ai/)
        |
        +-- All agent execution (spec, task, QA, insights, roadmap, etc.)
        +-- Security validation (19 validators + secret scanning)
        +-- Prompt loading (from apps/backend/prompts/*.md)
        +-- Context building (keyword extraction, service matching)
        +-- Project analysis (stack detection, security profile)
        +-- Merge system (semantic analysis + auto-merge + AI resolution)
        |
        v
Python Sidecar (ONLY)
        - apps/backend/integrations/graphiti/ (MCP server)
        - Spawned by Electron on demand, connected via MCP
```

---

## 4. Phase 1 - Critical Foundation (Blocks Core Execution)

These items block correct and safe agent execution. Until they are complete, agents run with a partially disabled security system and cannot load prompts from the filesystem. They must be completed before any other work.

### 4.1 Security Validators (~2,000 lines of logic)

**Purpose:** Enforce a command allowlist before every `Bash` tool execution. Without validators, the bash tool either blocks everything (if conservative) or allows too much (if permissive). The framework (`bash-validator.ts`) exists and correctly dispatches to the `VALIDATORS` map, but the map is completely empty.

**Python source files:**

| File | LOC | Content |
|------|-----|---------|
| `apps/backend/security/process_validators.py` | 134 | `validate_pkill_command`, `validate_kill_command`, `validate_killall_command` |
| `apps/backend/security/filesystem_validators.py` | 155 | `validate_chmod_command`, `validate_rm_command`, `validate_init_script` |
| `apps/backend/security/git_validators.py` | 303 | `validate_git_commit` (blocks `git push --force` to protected branches, validates commit messages) |
| `apps/backend/security/shell_validators.py` | 153 | `validate_bash_command`, `validate_sh_command`, `validate_zsh_command` (recursive validation for `-c` args) |
| `apps/backend/security/database_validators.py` | 444 | `validate_dropdb_command`, `validate_dropuser_command`, `validate_psql_command`, `validate_mysql_command`, `validate_mysqladmin_command`, `validate_redis_cli_command`, `validate_mongosh_command` (7 validators + shared `check_destructive_db_args()`) |
| `apps/backend/security/scan_secrets.py` | 561 | 34+ regex patterns for secrets (API keys, AWS, GitHub, Stripe, GCP, etc.) |
| `apps/backend/security/tool_input_validator.py` | 97 | Validates non-bash tool inputs (file paths, etc.) |
| `apps/backend/security/validator_registry.py` | 77 | `VALIDATORS` dict mapping command names to functions |

**TypeScript target location:** `apps/frontend/src/main/ai/security/`

**What's already done:**
- `bash-validator.ts`: Framework complete. `validateBashCommand()` dispatches to `VALIDATORS`, handles pipe chains, subshells, semicolon-separated commands via `command-parser.ts`. The `HookInputData` interface and `HookResult` types are correct.
- `command-parser.ts`: `extractCommands()`, `getCommandForValidation()`, `splitCommandSegments()` fully ported (355 lines).
- `path-containment.ts`: Path escaping prevention fully ported.
- `security-profile.ts`: Interface defined, `getAllAllowedCommands()` stub exists.

**What's missing:**
```typescript
// apps/frontend/src/main/ai/security/bash-validator.ts
// Line 73-80 — VALIDATORS map is completely empty:
export const VALIDATORS: Record<string, ValidatorFunction> = {
  // All 19 validators need to be implemented and registered here
};
```

The following 19 validators need TypeScript implementations:

| Command | Python source | Validator name |
|---------|--------------|----------------|
| `pkill` | `process_validators.py:validate_pkill_command` | `validatePkillCommand` |
| `kill` | `process_validators.py:validate_kill_command` | `validateKillCommand` |
| `killall` | `process_validators.py:validate_killall_command` | `validateKillallCommand` |
| `chmod` | `filesystem_validators.py:validate_chmod_command` | `validateChmodCommand` |
| `rm` | `filesystem_validators.py:validate_rm_command` | `validateRmCommand` |
| `init.sh` | `filesystem_validators.py:validate_init_script` | `validateInitScript` |
| `git` | `git_validators.py:validate_git_commit` | `validateGitCommand` |
| `bash` | `shell_validators.py:validate_bash_command` | `validateBashSubshell` |
| `sh` | `shell_validators.py:validate_sh_command` | `validateShSubshell` |
| `zsh` | `shell_validators.py:validate_zsh_command` | `validateZshSubshell` |
| `dropdb` | `database_validators.py:validate_dropdb_command` | `validateDropdbCommand` |
| `dropuser` | `database_validators.py:validate_dropuser_command` | `validateDropuserCommand` |
| `psql` | `database_validators.py:validate_psql_command` | `validatePsqlCommand` |
| `mysql` / `mariadb` | `database_validators.py:validate_mysql_command` | `validateMysqlCommand` |
| `mysqladmin` | `database_validators.py:validate_mysqladmin_command` | `validateMysqladminCommand` |
| `redis-cli` | `database_validators.py:validate_redis_cli_command` | `validateRedisCliCommand` |
| `mongosh` / `mongo` | `database_validators.py:validate_mongosh_command` | `validateMongoshCommand` |

**Secret Scanner (`scan_secrets.py` → `secret-scanner.ts`):**

The secret scanner contains 34+ patterns across two categories:
- `GENERIC_PATTERNS`: API key assignments, bearer tokens, passwords, base64 secrets
- `SERVICE_PATTERNS`: Anthropic/OpenAI keys (`sk-ant-*`), AWS (`AKIA*`), Google (`AIza*`), GitHub (`ghp_*`, `gho_*`, `ghs_*`, `ghr_*`), Stripe (`sk_live_*`, `sk_test_*`), and more

The scanner is used as a git pre-commit hook. It needs to be ported to TypeScript and wired into the Electron app's commit flow.

**Dependencies:** None. This is a standalone module.

**Implementation notes:**

The shell validator pattern (`validate_bash_command`) recursively validates the command passed to `-c "..."`. For example:
```
bash -c "rm -rf /tmp/build"
```
Should extract `rm -rf /tmp/build`, then re-run through the validator pipeline with `rm` as the command. The TypeScript `command-parser.ts` already extracts the inner command; the validator just needs to call `validateBashCommand()` recursively with the extracted argument.

The database validators follow a shared pattern: extract flags, check for `--force`/`-f` equivalents, reject destructive operations without explicit backup confirmation. Port the shared helper `check_destructive_db_args()` first.

After porting each validator, register it in the `VALIDATORS` map:
```typescript
export const VALIDATORS: Record<string, ValidatorFunction> = {
  pkill: validatePkillCommand,
  kill: validateKillCommand,
  killall: validateKillallCommand,
  chmod: validateChmodCommand,
  rm: validateRmCommand,
  'init.sh': validateInitScript,
  git: validateGitCommand,
  bash: validateBashSubshell,
  sh: validateShSubshell,
  zsh: validateZshSubshell,
  dropdb: validateDropdbCommand,
  dropuser: validateDropuserCommand,
  psql: validatePsqlCommand,
  mysql: validateMysqlCommand,
  mariadb: validateMysqlCommand,
  mysqladmin: validateMysqladminCommand,
  'redis-cli': validateRedisCliCommand,
  mongosh: validateMongoshCommand,
  mongo: validateMongoshCommand,
};
```

---

### 4.2 Prompt Loading System (~1,500 lines)

**Purpose:** Every agent phase requires a system prompt loaded from a `.md` file in `apps/backend/prompts/`. Currently the TypeScript orchestrators (`spec-orchestrator.ts`, `build-orchestrator.ts`, `qa-loop.ts`) must pass a `generatePrompt` callback — but there is no TypeScript implementation of this callback that actually reads from disk. The orchestrators have stubs/TODOs, but the actual `loadPrompt()` + context injection is not implemented.

**Python source files:**

| File | LOC | Content |
|------|-----|---------|
| `apps/backend/prompts_pkg/prompts.py` | ~400 | `load_prompt()`, `inject_context()`, `get_qa_tools_section()` |
| `apps/backend/prompts_pkg/prompt_generator.py` | ~1,000 | `generate_planner_prompt()`, `generate_subtask_prompt()`, `load_subtask_context()`, `format_context_for_prompt()`, `detect_worktree_isolation()`, `generate_worktree_isolation_warning()` |
| `apps/backend/prompts_pkg/project_context.py` | ~95 | CLAUDE.md loading, project index caching |

**TypeScript target location:** `apps/frontend/src/main/ai/prompts/`

**What's already done:** Nothing. The prompts directory does not exist in TypeScript.

**What's missing:**

`prompt-loader.ts` — Core loader with the following functions:
```typescript
// Load a prompt .md file from the bundled prompts directory
export function loadPrompt(promptName: string): string

// Inject dynamic sections into a prompt template
export function injectContext(
  promptTemplate: string,
  context: {
    projectDir: string;
    specDir: string;
    capabilities?: ProjectCapabilities;
    taskMetadata?: TaskMetadata;
    baseBranch?: string;
  }
): string

// Generate the QA tools section based on project capabilities
export function getQaToolsSection(capabilities: ProjectCapabilities): string

// Load and inject CLAUDE.md into agent prompts
export function loadClaudeMd(projectDir: string): string | null
```

`subtask-prompt-generator.ts` — Subtask-specific prompt generation:
```typescript
// Generate full planner system prompt
export function generatePlannerPrompt(config: PlannerPromptConfig): Promise<string>

// Generate per-subtask coder system prompt
export function generateSubtaskPrompt(config: SubtaskPromptConfig): Promise<string>

// Load file-context for a subtask (resolves fuzzy file references)
export function loadSubtaskContext(specDir: string, subtaskId: string): Promise<SubtaskContext>

// Detect worktree isolation and inject warning
export function generateWorktreeIsolationWarning(
  projectDir: string,
  parentProjectPath: string
): string
```

**Prompt files to load (from `apps/backend/prompts/`):**

| Prompt file | Used by phase | Agent type in config |
|---|---|---|
| `coder.md` | Coding phase | `coder` |
| `coder_recovery.md` | Coding recovery | `coder_recovery` |
| `planner.md` | Planning phase | `planner` |
| `qa_reviewer.md` | QA review | `qa_reviewer` |
| `qa_fixer.md` | QA fix | `qa_fixer` |
| `spec_gatherer.md` | Requirements phase | `spec_gatherer` |
| `spec_researcher.md` | Research phase | `spec_researcher` |
| `spec_writer.md` | Spec writing + planning | `spec_writer` |
| `spec_critic.md` | Self-critique | `spec_critic` |
| `spec_quick.md` | Quick spec (simple tasks) | Quick spec phase |
| `complexity_assessor.md` | Complexity assessment | `spec_gatherer` |
| `insight_extractor.md` | Insight extraction | `insight_extractor` |
| `roadmap_discovery.md` | Roadmap discovery | `roadmap` |
| `roadmap_features.md` | Roadmap features | `roadmap` |
| `competitor_analysis.md` | Competitor analysis | `roadmap` |
| `ideation_*.md` (6 files) | Ideation phases | `ideation_*` |
| `github/*.md` | GitHub PR review | Various |
| `followup_planner.md` | PR followup planning | PR review |
| `validation_fixer.md` | Spec validation fix | `spec_validation` |

**Bundling approach:** The `apps/backend/prompts/` directory must be accessible to the TypeScript layer at runtime. Options:
1. Copy prompts into `apps/frontend/resources/prompts/` during build and read via `path.join(app.getAppPath(), 'resources', 'prompts', name + '.md')` or via `process.resourcesPath` in packaged builds.
2. Read directly from `apps/backend/prompts/` by resolving the path relative to the app root.

Option 2 is simpler for development. For production, check `app.isPackaged` and use `process.resourcesPath`. Update `electron-vite.config.ts` to copy the prompts directory to resources.

**Dynamic QA tools section:** The Python `get_qa_tools_section()` function injects a conditional block into the QA reviewer prompt based on whether the project has tests, a linter, a type checker, etc. These capabilities come from the `ProjectCapabilities` object generated by the project analyzer. Until the project analyzer is ported (Phase 3.1), use a static fallback section.

**Dependencies:** None for basic loading. Project analyzer needed for dynamic QA tools section.

---

### 4.3 Missing Auto-Claude Custom Tools

**Purpose:** The agent configs in `agent-configs.ts` reference `mcp__auto-claude__record_gotcha` and `mcp__auto-claude__get_session_context`, but these are listed as tool names for MCP servers that do not exist yet. The coder agent is configured to receive these tools, so any coder agent session that tries to call them will fail with "tool not found."

**Python source files:**

| Tool | Python source | LOC |
|------|-------------|-----|
| `record_gotcha` | `agents/tools_pkg/tools/memory.py` (gotcha section) | ~80 |
| `get_session_context` | `agents/tools_pkg/tools/memory.py` (session context section) | ~60 |
| `update_subtask_status` | `agents/tools_pkg/tools/subtask.py` | ~60 |
| `get_build_progress` | `agents/tools_pkg/tools/progress.py` | ~40 |
| `record_discovery` | `agents/tools_pkg/tools/memory.py` (discovery section) | ~60 |
| `update_qa_status` | `agents/tools_pkg/tools/qa.py` | ~50 |

**TypeScript target location:** These tools should be implemented as builtin tools registered in the `ToolRegistry`, not as MCP tools. The current naming (`mcp__auto-claude__*`) is a holdover from the Python design where they were exposed as MCP tools.

**What's already done:**
- `update_subtask_status`, `get_build_progress`, `record_discovery`, `update_qa_status` appear to be partially implemented in the tool registry based on the registry file structure. Verification needed.
- Tool name constants are defined in `registry.ts`.

**What's missing:**

`record_gotcha` — Saves a gotcha/pitfall to `spec_dir/gotchas.md` and optionally to Graphiti:
```typescript
// apps/frontend/src/main/ai/tools/builtin/record-gotcha.ts
export const recordGotchaTool = tool({
  description: 'Record a gotcha or pitfall discovered during implementation',
  inputSchema: z.object({
    title: z.string(),
    description: z.string(),
    category: z.enum(['debugging', 'performance', 'api', 'config', 'other']).optional(),
    tags: z.array(z.string()).optional(),
  }),
  execute: async ({ title, description, category, tags }, { specDir, projectDir }) => {
    // Append to gotchas.md in spec directory
    // Fire-and-forget save to Graphiti via MCP if available
    // Return success confirmation
  }
});
```

`get_session_context` — Reads the session context files that accumulate during a build:
```typescript
// apps/frontend/src/main/ai/tools/builtin/get-session-context.ts
export const getSessionContextTool = tool({
  description: 'Get context accumulated during this build session',
  inputSchema: z.object({}),
  execute: async ({}, { specDir }) => {
    // Read codebase_map.json if exists
    // Read gotchas.md if exists
    // Read patterns.md if exists
    // Return combined context as markdown
  }
});
```

**Dependencies:** Prompt loading (4.2) must exist before these tools are useful, since prompts instruct agents when to call them.

---

### 4.4 Spec Pipeline Completion

**Purpose:** The spec orchestrator (`spec-orchestrator.ts`) drives the 11-phase pipeline but is missing two critical components: (1) conversation compaction between phases to prevent context window overflow, and (2) the validation framework with auto-fix that runs after spec writing.

**Python source files:**

| File | LOC | Content |
|------|-----|---------|
| `apps/backend/spec/compaction.py` | 155 | `compact_conversation()` — trims conversation history between phases to reduce tokens |
| `apps/backend/spec/validate_pkg/` | ~500 | Validation schemas, spec validator, implementation plan validator, auto-fix |
| `apps/backend/spec/validate_pkg/validators/implementation_plan_validator.py` | 217 | Validates `implementation_plan.json` structure and content |
| `apps/backend/spec/validate_pkg/auto_fix.py` | 290 | Auto-fix runner: calls fix agent on validation failures (up to 3 retries) |
| `apps/backend/spec/validate_pkg/schemas.py` | 134 | JSON schemas for spec artifacts |

**TypeScript target location:** `apps/frontend/src/main/ai/orchestration/`

**What's already done:**
- `spec-orchestrator.ts` (482 lines): Phase selection, phase execution loop, retry logic, error handling.
- Complexity tier selection (`simple`/`standard`/`complex`) is partially implemented.

**What's missing:**

Conversation compaction: Between spec phases, the conversation history can grow to 50,000+ tokens. The Python `compact_conversation()` function strips early tool outputs, keeping only the most recent N exchanges. This needs a TypeScript equivalent that operates on the `SessionMessage[]` array passed between phases.

```typescript
// apps/frontend/src/main/ai/orchestration/conversation-compactor.ts
export function compactConversation(
  messages: SessionMessage[],
  options: {
    maxTokenEstimate: number;  // Target max tokens (default: 40000)
    keepLastN: number;          // Always keep last N messages (default: 10)
    preserveSystem: boolean;    // Keep system messages (default: true)
  }
): SessionMessage[]
```

Spec validation framework: After the `planning` phase completes and writes `implementation_plan.json`, the validator checks:
- All subtasks have `id`, `title`, `description`, `files` fields
- File paths referenced in subtasks exist in the project
- Dependencies between subtasks form a valid DAG (no cycles)
- Phase assignments are valid

If validation fails, the `validation_fixer.md` prompt is used to run a fix agent (up to 3 retries). This is the `validation` phase in the spec orchestrator's `COMPLEXITY_PHASES` map.

```typescript
// apps/frontend/src/main/ai/orchestration/spec-validator.ts
export interface SpecValidationResult {
  valid: boolean;
  errors: SpecValidationError[];
  warnings: SpecValidationWarning[];
}

export async function validateImplementationPlan(
  specDir: string,
  projectDir: string
): Promise<SpecValidationResult>

export async function autoFixSpecValidation(
  specDir: string,
  result: SpecValidationResult,
  runSession: (prompt: string) => Promise<SessionResult>,
  maxRetries?: number
): Promise<boolean>
```

**Data artifacts produced by spec pipeline** (these paths are assumed by downstream code):

| Artifact | Path within specDir | Written by phase |
|---|---|---|
| `spec.md` | `spec.md` | spec_writing |
| `requirements.json` | `requirements.json` | requirements |
| `context.json` | `context.json` | context |
| `implementation_plan.json` | `implementation_plan.json` | planning |
| `complexity.json` | `complexity.json` | complexity_assessment |
| `research.md` | `research.md` | research |
| `critique.md` | `critique.md` | self_critique |

**Dependencies:** Prompt loading (4.2) must be complete before phases can run.

---

## 5. Phase 2 - Core Pipeline (Full Task Execution)

These items are required for the build pipeline to match Python's behavior fully. The pipeline currently runs but is missing key behaviors that affect output quality and correctness.

### 5.1 Coder and Planner Prompt Generation

**Purpose:** The Python `generate_planner_prompt()` and `generate_subtask_prompt()` functions build dynamically tailored prompts for each subtask. They include: the subtask description, file context, implementation plan summary, prior subtask results, worktree isolation warning, and project capabilities. Without this, agents receive generic prompts and lack the context they need.

**Python source:** `apps/backend/prompts_pkg/prompt_generator.py` (1,000+ lines total)

**Key functions to port:**

`generate_planner_prompt(config)` — Generates the planning agent's system prompt including:
- Base prompt from `planner.md`
- Project structure overview
- Existing implementation state
- Worktree isolation warning (when in worktree)
- CLAUDE.md content injection

`generate_subtask_prompt(config)` — Generates per-subtask coder prompt including:
- Base prompt from `coder.md` or `coder_recovery.md`
- Subtask-specific context (description, files to modify, acceptance criteria)
- File validation: checks that referenced files exist (with fuzzy correction for mismatches)
- Prior subtask outcomes (what changed in the last N completed subtasks)
- Worktree isolation warning

**File validation with fuzzy auto-correction:**
```python
# Python pattern to port:
def validate_and_correct_files(files: list[str], project_dir: Path) -> tuple[list[str], list[str]]:
    """
    Returns (valid_files, corrected_files).
    For each file not found, tries fuzzy match against project structure.
    """
```

The fuzzy matching uses `difflib.get_close_matches()` with cutoff=0.6. Port this with a simple Levenshtein-based match or use the existing `Glob` tool logic.

**Plan validation and auto-fix:** After the planner writes `implementation_plan.json`, the build orchestrator validates it (correct subtask IDs, valid phase assignments, no missing required fields). If invalid, it runs the validation fixer prompt up to 3 retries. This validation lives in `build-orchestrator.ts` at the `MAX_PLANNING_VALIDATION_RETRIES = 3` constant but the actual validation logic is a stub.

**TypeScript target:** `apps/frontend/src/main/ai/prompts/subtask-prompt-generator.ts`

**Dependencies:** Prompt loading (4.2), context system (5.4 for file context).

---

### 5.2 QA Loop Completion

**Purpose:** The QA loop (`qa-loop.ts`) runs the review/fix iteration cycle but is missing report generation and iteration history persistence. These are needed for the UI to display QA progress and for human escalation to work correctly.

**Python source files:**

| File | LOC | Content |
|------|-----|---------|
| `apps/backend/qa/report.py` | 523 | `generate_qa_report()`, `generate_escalation_report()`, `generate_manual_test_plan()` |
| `apps/backend/qa/loop.py` | 660 | `QALoop.run()` with history persistence, recurring issue detection |
| `apps/backend/qa/criteria.py` | 179 | `get_qa_criteria()` — project-specific acceptance criteria |

**TypeScript target:** `apps/frontend/src/main/ai/orchestration/qa-loop.ts` (extends existing file)

**What's already done:**
- Core loop structure: reviewer → fixer → reviewer cycle
- Recurring issue detection at `RECURRING_ISSUE_THRESHOLD = 3`
- Consecutive error tracking at `MAX_CONSECUTIVE_ERRORS = 3`
- QA issue types and iteration record interfaces

**What's missing:**

Iteration history persistence: After each QA iteration, the loop should append to `implementation_plan.json`'s `qa_history` array:
```typescript
interface QAIterationRecord {
  iteration: number;
  status: 'approved' | 'rejected' | 'error';
  issues: QAIssue[];
  durationMs: number;
  timestamp: string;
}
// Persist to: specDir/implementation_plan.json → .qa_history[]
```

Report generation (write these files to `specDir`):
```typescript
// qa_report.md — summary of QA outcome for UI display
export function generateQAReport(
  iterations: QAIterationRecord[],
  finalStatus: 'approved' | 'escalated' | 'max_iterations'
): string

// QA_ESCALATION.md — detailed escalation report when QA cannot fix issues
export function generateEscalationReport(
  iterations: QAIterationRecord[],
  recurringIssues: QAIssue[]
): string

// MANUAL_TEST_PLAN.md — test plan for human reviewer
export function generateManualTestPlan(
  specDir: string,
  projectDir: string
): Promise<string>
```

**Recurring issue detection:** The Python implementation uses 0.8 similarity threshold between issue descriptions across iterations. Port this with a simple normalized edit-distance or token overlap function:
```typescript
function issuesSimilar(a: QAIssue, b: QAIssue, threshold = 0.8): boolean {
  // Compare title + description with normalized edit distance
}
```

**Dependencies:** Prompt loading (4.2), spec validator (4.4) for criteria file.

---

### 5.3 Post-Session Processing

**Purpose:** After each agent session completes, the Python codebase runs several post-processing steps: insight extraction (saves learnings to Graphiti), rate limit / auth pause handling, and Linear integration updates. The TypeScript layer skips most of these.

**Python source files:**

| File | LOC | Content |
|------|-----|---------|
| `apps/backend/agents/session.py` | 727 | `post_session_processing()`, pause file handling |
| `apps/backend/linear_updater.py` | ~500 | `linear_task_started()`, `linear_task_stuck()`, `linear_build_complete()` |
| `apps/backend/agents/base.py` | 99 | Pause file constants, retry delays |

**TypeScript target:** `apps/frontend/src/main/ai/orchestration/post-session.ts`

**What's already done:**
- `insight-extractor.ts` (320 lines): Fully ported LLM-powered insight extraction. Reads session output, calls insight agent, saves to Graphiti via MCP.
- `recovery-manager.ts` (451 lines): Fully ported attempt tracking, rollback, stuck detection.

**What's missing:**

Pause file handling: The Python codebase writes sentinel files to pause/resume agent execution:
```python
# Constants from apps/backend/agents/base.py
RATE_LIMIT_PAUSE_FILE = ".auto-claude/rate_limit_pause"
AUTH_FAILURE_PAUSE_FILE = ".auto-claude/auth_failure_pause"
HUMAN_INTERVENTION_FILE = ".auto-claude/human_intervention_needed"
RESUME_FILE = ".auto-claude/resume"
```

The TypeScript orchestrators should check for these files and wait/retry accordingly. The error classifier (`error-classifier.ts`) already detects rate limit and auth errors, but it does not write pause files or wait for resume.

```typescript
// apps/frontend/src/main/ai/orchestration/pause-handler.ts
export const RATE_LIMIT_PAUSE_FILE = '.auto-claude/rate_limit_pause';
export const AUTH_FAILURE_PAUSE_FILE = '.auto-claude/auth_failure_pause';

export async function waitForRateLimitResume(
  projectDir: string,
  signal: AbortSignal,
  onStatus: (message: string) => void
): Promise<void>

export async function waitForAuthResume(
  projectDir: string,
  signal: AbortSignal,
  onStatus: (message: string) => void
): Promise<void>
```

Linear integration: When Linear API key is configured, the Python codebase updates Linear issue status as subtasks progress. The TypeScript layer should fire Linear MCP tool calls (the `LINEAR_TOOLS` are already in the MCP config) after phase transitions.

```typescript
// In build-orchestrator.ts — after each subtask completes:
if (linearIssueId && session.tools.has('mcp__linear-server__update_issue')) {
  await updateLinearSubtaskStatus(linearIssueId, subtaskId, 'in_progress');
}
```

Post-session insight extraction: `insight-extractor.ts` is fully implemented but is not called after coder sessions. The `build-orchestrator.ts` should call it after each subtask completes:
```typescript
// After subtask session completes successfully:
await extractInsights({
  sessionOutput: result.text,
  specDir,
  projectDir,
  subtaskId,
});
```

**Dependencies:** Insight extractor is ready (no dependency). Linear needs Linear API key env var configured.

---

### 5.4 Context System

**Purpose:** Before coding, the Python codebase builds a context package for each subtask: relevant source files, service definitions, patterns, and related code. Without this, agents must explore the codebase from scratch each subtask.

**Python source files:**

| File | LOC | Content |
|------|-----|---------|
| `apps/backend/context/keyword_extractor.py` | 101 | Extracts keywords from task description using LLM |
| `apps/backend/context/search.py` | 101 | Searches codebase for files matching keywords |
| `apps/backend/context/service_matcher.py` | 81 | Matches task context to known service patterns |
| `apps/backend/context/categorizer.py` | 73 | Categorizes matched files as "modify" vs "reference" |
| `apps/backend/context/builder.py` | 250 | Orchestrates all context-building steps |
| `apps/backend/context/pattern_discovery.py` | 65 | Discovers coding patterns in matched files |
| `apps/backend/context/graphiti_integration.py` | 53 | Adds context to Graphiti memory |
| `apps/backend/context/main.py` | 144 | Top-level `build_context()` entry point |

**TypeScript target location:** `apps/frontend/src/main/ai/context/`

**What's already done:** Nothing. The context directory does not exist in TypeScript.

**Key data structures to preserve:**

```typescript
// apps/frontend/src/main/ai/context/types.ts
export interface ContextFile {
  path: string;          // Relative to project root
  role: 'modify' | 'reference';  // Whether agent should modify or just read
  relevance: number;     // 0-1 relevance score
  snippet?: string;      // Optional key section excerpt
}

export interface SubtaskContext {
  files: ContextFile[];
  services: ServiceMatch[];
  patterns: CodePattern[];
  keywords: string[];
}

export interface ServiceMatch {
  name: string;
  type: 'api' | 'database' | 'queue' | 'cache' | 'storage';
  relatedFiles: string[];
}

export interface CodePattern {
  name: string;
  description: string;
  example: string;
  files: string[];
}
```

**Implementation approach:**

Keyword extraction can use a simpler regex-based approach first (extract technical terms, file paths mentioned in task description, camelCase identifiers), then optionally enhance with an LLM call.

Code search uses the existing `Grep` tool logic (ripgrep-based) to search for keyword occurrences.

File categorization: Files in `files_to_modify` list from `implementation_plan.json` are `modify`; files that appear in search results but not in the modify list are `reference`.

**Dependencies:** This is a standalone module. The `Glob` and `Grep` builtin tools provide the search primitives.

---

## 6. Phase 3 - Feature Parity (Complete Product)

### 6.1 Project Analyzer

**Purpose:** The project analyzer scans the project to determine its technology stack, framework, available commands, and generates a `SecurityProfile` with the appropriate command allowlist. Without this, agents use only the base command set and cannot run project-specific commands (e.g., `pytest`, `npm test`, `cargo check`).

**Python source files:**

| File | LOC | Content |
|------|-----|---------|
| `apps/backend/project/analyzer.py` | 428 | Main `ProjectAnalyzer` class, `analyze()` entry point |
| `apps/backend/project/stack_detector.py` | 369 | Detects 20+ languages from file extensions and config files |
| `apps/backend/project/framework_detector.py` | 265 | Detects 50+ frameworks from `package.json`, `requirements.txt`, `Cargo.toml`, etc. |
| `apps/backend/project/config_parser.py` | 81 | Parses JSON, TOML, YAML config files for framework hints |
| `apps/backend/project/structure_analyzer.py` | 123 | Directory structure analysis |
| `apps/backend/project/command_registry/languages.py` | 190 | Commands for 15+ language stacks |
| `apps/backend/project/command_registry/frameworks.py` | 169 | Commands for 20+ frameworks |
| `apps/backend/project/command_registry/databases.py` | 120 | Database CLI commands |
| `apps/backend/project/command_registry/infrastructure.py` | 88 | Docker, Kubernetes, cloud commands |
| `apps/backend/project/command_registry/cloud.py` | 74 | AWS, GCP, Azure CLI commands |
| `apps/backend/project/command_registry/package_managers.py` | 42 | npm, pip, cargo, gem, etc. |
| `apps/backend/project/command_registry/code_quality.py` | 39 | Linting, formatting, type-check commands |
| `apps/backend/project/command_registry/version_managers.py` | 31 | nvm, pyenv, rbenv commands |

**TypeScript target location:** `apps/frontend/src/main/ai/project/`

**What's already done:** The `security-profile.ts` interface is defined. The `SecurityProfile` interface in `bash-validator.ts` matches the Python design.

**What's missing:**

The full project analysis pipeline:
```typescript
// apps/frontend/src/main/ai/project/analyzer.ts
export interface ProjectAnalysis {
  stacks: LanguageStack[];
  frameworks: Framework[];
  packageManagers: PackageManager[];
  configFiles: ConfigFile[];
  hasTests: boolean;
  hasLinter: boolean;
  hasTypeChecker: boolean;
  hasDocker: boolean;
  testCommands: string[];
  lintCommands: string[];
  buildCommands: string[];
}

export async function analyzeProject(projectDir: string): Promise<ProjectAnalysis>
export function buildSecurityProfile(analysis: ProjectAnalysis): SecurityProfile
```

**Security profile caching:** The Python implementation caches the security profile using file modification time (mtime) of key config files (`package.json`, `pyproject.toml`, `Cargo.toml`). If none of these files have changed since the last analysis, the cached profile is returned. Port this caching pattern:

```typescript
interface SecurityProfileCache {
  profile: SecurityProfile;
  configMtimes: Record<string, number>;
  generatedAt: number;
}
// Cache path: specDir/.security-profile-cache.json
```

**Command registry (400+ commands across 9 registries):** The full registry is large but mechanical. Port the structure as a TypeScript object literal:

```typescript
// apps/frontend/src/main/ai/project/command-registry.ts
export const LANGUAGE_COMMANDS: Record<string, string[]> = {
  python: ['python', 'python3', 'pip', 'pip3', 'pytest', 'ruff', 'mypy', 'black', 'isort'],
  typescript: ['tsc', 'ts-node', 'tsx'],
  rust: ['cargo', 'rustc', 'rustfmt', 'clippy'],
  go: ['go', 'gofmt', 'golint'],
  // ... 15+ more languages
};

export const FRAMEWORK_COMMANDS: Record<string, string[]> = {
  react: ['react-scripts', 'vite', 'next'],
  django: ['django-admin', 'manage.py'],
  // ... 20+ more frameworks
};
```

**Dependencies:** None for basic analysis. The `Glob` builtin tool provides filesystem scanning.

---

### 6.2 Runner Integration (Wire TypeScript Runners to IPC)

**Purpose:** Several TypeScript runners are fully implemented but not connected to the IPC handlers that the Electron renderer uses to trigger them. Without this wiring, the UI features that call these runners silently fail or use the old Python subprocess path.

**Insights runner (0% wired, 100% implemented):**

`apps/frontend/src/main/ai/runners/insights.ts` is complete (339 lines). The IPC handler in `apps/frontend/src/main/ipc-handlers/` must be updated to call this TypeScript runner instead of spawning a Python subprocess.

The IPC handler update pattern:
```typescript
// Before (Python subprocess):
ipcMain.handle('insights:run', async (_, { projectDir, query }) => {
  return spawnPythonRunner('insights_runner.py', { projectDir, query });
});

// After (TypeScript runner):
import { runInsights } from '../ai/runners/insights';
ipcMain.handle('insights:run', async (_, { projectDir, query }) => {
  return runInsights({ projectDir, query, onEvent: (e) => sendToRenderer('insights:event', e) });
});
```

**Ideation runner (30% implemented):**

`apps/frontend/src/main/ai/runners/ideation.ts` has a skeleton. The Python ideation pipeline runs 4 phases in parallel: code improvements, code quality, security, performance + optionally documentation and UI/UX. Each phase uses a different prompt from `prompts/ideation_*.md`.

```typescript
// 4 parallel ideation streams
const phases = ['code_improvements', 'code_quality', 'security', 'performance'];
const results = await Promise.allSettled(
  phases.map(phase => runIdeationPhase({ phase, projectDir, onEvent }))
);
```

**Roadmap runner (60% implemented):**

`apps/frontend/src/main/ai/runners/roadmap.ts` (461 lines) is missing two phases:
1. Competitor analysis phase (uses `competitor_analysis.md` prompt)
2. Graph hints phase (queries Graphiti for historical context to inform roadmap)

**GitHub runner (80% implemented):**

Missing from the TypeScript GitHub runner:
- Batch processing coordinator (Python `batch_issues.py`, 1,159 lines) — processes multiple issues simultaneously with concurrency limiting
- Duplicate detection (`duplicates.py`, 601 lines) — deduplicates issues before processing
- Bot detection (`bot_detection.py`, 631 lines) — identifies automated/bot-generated issues to skip
- Rate limiter (`rate_limiter.py`, 701 lines) — token bucket with backoff for GitHub API

**GitLab runner (70% implemented):**

The `mr-review-engine.ts` is complete. Missing:
- GitLab follow-up review orchestration (parallel followup pattern, similar to GitHub)
- GitLab rate limiting

---

### 6.3 CLAUDE.md and System Prompt Integration

**Purpose:** The Python agents load `CLAUDE.md` from the project root and inject it into agent system prompts. This gives agents project-specific context (architecture decisions, gotchas, coding standards). The TypeScript layer does not do this.

**Python source:** `apps/backend/prompts_pkg/project_context.py` (~95 lines)

**TypeScript target:** Part of `apps/frontend/src/main/ai/prompts/prompt-loader.ts`

**Implementation:**
```typescript
export async function loadClaudeMd(projectDir: string): Promise<string | null> {
  const claudeMdPath = join(projectDir, 'CLAUDE.md');
  try {
    return await readFile(claudeMdPath, 'utf-8');
  } catch {
    return null; // Not all projects have CLAUDE.md
  }
}

// In generateSubtaskPrompt():
const claudeMd = await loadClaudeMd(projectDir);
if (claudeMd) {
  systemPrompt += `\n\n## Project Instructions (CLAUDE.md)\n\n${claudeMd}`;
}
```

**Project index caching:** The Python `project_context.py` caches a lightweight project index (top-level directory listing, key config files) to avoid re-reading the filesystem for every prompt generation. Port this as a simple in-memory cache with a 5-minute TTL.

---

## 7. Phase 4 - Advanced Systems (Can Defer)

### 7.1 Merge System (~6,300 lines unported)

**Purpose:** The merge system handles parallel subagent work by intelligently merging their results. The AI resolver (already ported to `merge-resolver.ts`) handles conflict resolution, but the upstream semantic analysis, conflict detection, and auto-merger pipeline are not ported.

**Python source files:**

| Component | Files | LOC | Description |
|---|---|---|---|
| Semantic analyzer | `merge/semantic_analysis/regex_analyzer.py`, `comparison.py` | ~430 | Regex-based analysis: 40+ change types (function added/removed/modified, import changes, etc.), multi-language support (Python, TypeScript, Go, Rust) |
| Conflict detector | `merge/conflict_detector.py`, `conflict_analysis.py`, `compatibility_rules.py` | ~952 | 80+ compatibility rules, conflict scoring, severity classification |
| Auto-merger | `merge/auto_merger/`, `file_merger.py` | ~700 | 8 deterministic merge strategies: append-only, import-merge, dict-merge, list-merge, etc. |
| File evolution tracker | `merge/file_evolution/` | ~1,200 | Tracks file modification history, baseline capture, storage |
| Timeline tracker | `merge/timeline_tracker.py`, `timeline_git.py`, `timeline_models.py` | ~1,300 | Per-file modification timeline using git history |
| Orchestrator | `merge/orchestrator.py` | 918 | Drives the full pipeline: capture → evolve → semantic → conflict → auto-merge → ai-resolve |

**TypeScript target location:** `apps/frontend/src/main/ai/merge/`

**What's already done:** `merge-resolver.ts` — AI-powered resolution for conflicts that cannot be auto-merged. This is the last step in the pipeline.

**Recommendation:** This is the most complex module (~6,300 lines, not counting timeline). Defer until Phase 1-3 are complete. The current behavior (all conflicts go to AI resolver) is safe but slower. A phased approach:
1. Port semantic analyzer (regex-based, straightforward)
2. Port auto-merger strategies (deterministic, testable)
3. Port conflict detector and compatibility rules
4. Port file evolution tracker (most complex, uses git history)

---

### 7.2 Graphiti MCP Server Bridge

**Status:** Already complete. The Python Graphiti MCP sidecar runs as a background process, and the TypeScript layer connects via MCP. No additional porting needed.

**How it works:**
- Electron spawns `apps/backend/integrations/graphiti/` as a subprocess on app start (when Graphiti is enabled)
- The `mcp/` module creates an MCP client connection to the sidecar
- Graphiti tools (`mcp__graphiti-memory__*`) are injected into agent sessions that have memory enabled

---

## 8. Dependencies and Ordering

The following dependency graph shows which modules must be completed before others. Work in topological order.

```
Phase 1 (Critical Foundation)
  [4.1] Security validators
    -> Bash tool operates safely for all agents
    -> Required before: All agent execution is fully safe

  [4.2] Prompt loading system
    -> All agent phases can load their system prompts
    -> Required before: [4.1] VALIDATORS needed for bash tool safety
    -> Blocks: [4.3] auto-claude tools (prompts instruct agents when to call them)
    -> Blocks: [5.1] Subtask prompt generation (builds on top of loadPrompt())
    -> Blocks: [5.4] Context system (context is injected into prompts)

  [4.3] Auto-Claude custom tools (record_gotcha, get_session_context)
    -> Requires: [4.2] Prompt loading
    -> Blocks nothing critical, but needed for coder agent tool calls to not fail

  [4.4] Spec pipeline completion (compaction + validation)
    -> Requires: [4.2] Prompt loading
    -> Blocks: Spec quality (specs without validation produce incomplete plans)

Phase 2 (Core Pipeline)
  [5.1] Coder/planner prompt generation
    -> Requires: [4.2] Prompt loading
    -> Optionally uses: [5.4] Context system for file context
    -> Blocks: [5.2] QA loop (QA needs complete coder output)

  [5.2] QA loop completion (reporting + history)
    -> Requires: [5.1] Coder/planner prompts (QA validates coder output)
    -> Blocks: Human review quality (escalation reports needed)

  [5.3] Post-session processing
    -> Requires: Nothing (insight extractor already ready)
    -> Run after: [5.1] Coder sessions complete

  [5.4] Context system
    -> Requires: Nothing (standalone)
    -> Feeds into: [5.1] Subtask prompt generation

Phase 3 (Feature Parity)
  [6.1] Project analyzer
    -> Requires: Nothing (standalone)
    -> Feeds into: [4.1] Security profile for dynamic allowlisting
    -> Feeds into: [6.3] CLAUDE.md injection (project context)

  [6.2] Runner IPC wiring
    -> Requires: [4.2] Prompt loading (runners need prompts)
    -> Insights: Can be wired immediately (runner is complete)
    -> Others: Need orchestrator completion

  [6.3] CLAUDE.md injection
    -> Requires: [4.2] Prompt loading (part of prompt-loader.ts)
    -> Feeds into: [5.1] Subtask prompts

Phase 4 (Deferred)
  [7.1] Merge system
    -> Requires: Nothing (standalone)
    -> Very large, port incrementally
```

**Recommended execution order:**

1. `4.1` Security validators (safety-critical, 1-2 days)
2. `4.2` Prompt loading system (foundation for everything, 2-3 days)
3. `6.1` Project analyzer (parallel with 4.2, feeds security profile)
4. `4.3` Auto-Claude tools (1 day)
5. `5.4` Context system (parallel, 2 days)
6. `4.4` Spec pipeline completion (1-2 days)
7. `5.1` Coder/planner prompt generation (2 days)
8. `5.2` QA loop completion (1 day)
9. `5.3` Post-session processing (1 day)
10. `6.2` Runner IPC wiring (1-2 days)
11. `6.3` CLAUDE.md injection (0.5 days)
12. `7.1` Merge system (deferred, 5-8 days)

---

## 9. Key Technical Patterns

These patterns are critical to preserve during migration. Deviating from them will cause subtle failures.

### 9.1 Vercel AI SDK v6 Stream Event Names

The AI SDK v6 uses different event names than v5. Always use these exact names:

```typescript
for await (const part of result.fullStream) {
  switch (part.type) {
    case 'text-delta':
      // part.textDelta — the text increment
      break;
    case 'tool-call':
      // part.toolCallId, part.toolName, part.args (NOT part.input)
      break;
    case 'tool-result':
      // part.toolCallId, part.result (NOT part.output)
      break;
    case 'tool-error':
      // part.toolCallId, part.error
      break;
    case 'finish-step':
      // part.usage.promptTokens, part.usage.completionTokens
      break;
    case 'error':
      // part.error (NOT part.errorText)
      break;
    case 'reasoning':
      // part.reasoning — thinking token content
      break;
  }
}
```

**Common mistake:** `part.delta` may be undefined in some events. Always guard with `?? ''`:
```typescript
// Wrong:
outputText += part.delta;

// Correct:
outputText += part.textDelta ?? '';
```

### 9.2 OAuth Token Detection

The `auth/resolver.ts` must correctly distinguish OAuth tokens from API keys:

```typescript
// OAuth tokens (require anthropic-beta: oauth-2025-04-20 header):
const isOAuth = token.startsWith('sk-ant-oa') || token.startsWith('sk-ant-ort');

// API keys (use directly as apiKey):
const isApiKey = token.startsWith('sk-ant-api');

// Provider construction:
if (isOAuth) {
  return anthropic({ authToken: token }); // Uses Authorization: Bearer header
} else {
  return anthropic({ apiKey: token });    // Uses x-api-key header
}
```

This pattern is critical — using the wrong header causes immediate 401 errors that are hard to diagnose.

### 9.3 Worker Thread Serialization

The `SerializableSessionConfig` interface defines what crosses the worker thread boundary. `LanguageModel` instances cannot be serialized (they contain closures), so only the config needed to recreate them is passed:

```typescript
// apps/frontend/src/main/ai/agent/worker-bridge.ts
interface SerializableSessionConfig {
  // Serializable — crosses thread boundary
  modelId: string;        // e.g., 'claude-opus-4-5'
  authToken: string;      // Raw token (not the model instance)
  systemPrompt: string;
  messages: SessionMessage[];
  agentType: AgentType;
  specDir: string;
  projectDir: string;
  // ... other primitive config fields

  // NOT serializable — recreated in worker:
  // model: LanguageModel  <-- never include
}

// In worker.ts — recreate the model:
const model = createProviderFromModelId(config.modelId, config.authToken);
```

### 9.4 Error Classification

The `error-classifier.ts` uses HTTP status codes and error message patterns to classify errors. Downstream code should use the classified type, not raw error messages:

```typescript
import { classifyError, isAuthenticationError } from './error-classifier';

const classification = classifyError(error);
switch (classification.type) {
  case 'rate_limit':
    // Retry after delay, write RATE_LIMIT_PAUSE_FILE
    break;
  case 'auth_failure':
    // Refresh token, write AUTH_FAILURE_PAUSE_FILE
    break;
  case 'tool_concurrency':
    // Back off, retry with lower concurrency
    break;
  case 'context_exhausted':
    // Compact conversation, restart with summary
    break;
  case 'unknown':
    // Log and escalate
    break;
}
```

### 9.5 Phase-Aware Model Resolution

Different build phases use different models (e.g., planning uses a more capable model than coding). The `phase-config.ts` handles this:

```typescript
import { getPhaseModel, getPhaseThinkingBudget } from '../config/phase-config';

const model = getPhaseModel(agentType, {
  cliModelOverride: config.cliModel,
  defaultModel: 'claude-opus-4-5',
  phase: 'planning',  // 'planning' | 'coding' | 'qa' | 'spec'
});

const thinkingBudget = getPhaseThinkingBudget(agentType);
```

Do not hardcode model names in orchestrators. Always use `getPhaseModel()` to allow user-configured model overrides to propagate.

### 9.6 Tool Context Injection Pattern

Builtin tools receive a `ToolContext` object with the current spec and project directories. This context must be passed correctly when building the tool registry:

```typescript
// apps/frontend/src/main/ai/tools/registry.ts
const toolContext: ToolContext = {
  specDir: config.specDir,
  projectDir: config.projectDir,
  abortSignal: config.abortSignal,
};

const tools = toolRegistry.getToolsForAgent(agentType, toolContext);
```

Each tool's `execute` function receives this context as a second argument. Never hardcode paths inside tool execute functions — always use `toolContext.specDir` and `toolContext.projectDir`.

### 9.7 Security Profile Caching (mtime-based)

The project analyzer is expensive (filesystem traversal). Cache the result using config file modification times:

```typescript
// apps/frontend/src/main/ai/project/analyzer.ts
const CONFIG_FILES_TO_WATCH = [
  'package.json', 'pyproject.toml', 'Cargo.toml',
  'go.mod', 'Gemfile', 'composer.json', 'pom.xml',
  '.auto-claude/security-profile.json',
];

async function isProfileStale(projectDir: string, cache: SecurityProfileCache): Promise<boolean> {
  for (const configFile of CONFIG_FILES_TO_WATCH) {
    const fullPath = join(projectDir, configFile);
    try {
      const stat = await fs.stat(fullPath);
      const cachedMtime = cache.configMtimes[configFile] ?? 0;
      if (stat.mtimeMs > cachedMtime) return true;
    } catch {
      // File doesn't exist — not a staleness indicator
    }
  }
  return false;
}
```

### 9.8 streamText Requires at Least One User Message

A critical gotcha: calling `streamText()` with only a `system` prompt and no `messages` causes the model to respond with text only and never call tools. Always include at least one user message:

```typescript
// Wrong — model will not call tools:
const result = streamText({
  model,
  system: systemPrompt,
  messages: [],  // Empty!
  tools,
});

// Correct — model will call tools:
const result = streamText({
  model,
  system: systemPrompt,
  messages: [{ role: 'user', content: buildKickoffMessage(config) }],
  tools,
});
```

The `buildKickoffMessage()` function in `worker.ts` constructs the initial user message from the spec/subtask context.

---

## 10. Risk Assessment

### Highest Risk Areas

**Risk 1: Behavioral parity in security validators**

The 19 security validators contain subtle business logic (e.g., which git commands are allowed vs blocked, which database operations require explicit destructive flag confirmation). A too-permissive port allows agents to run dangerous commands; a too-restrictive port blocks valid operations.

Mitigation:
- Port validators one at a time with direct test cases from the Python test suite
- Run the existing Python validator test suite against the TypeScript implementation via a thin bridge
- Test with actual agent sessions against a throw-away project before enabling in production

**Risk 2: Prompt loading path resolution in packaged builds**

Prompts are `.md` files in `apps/backend/prompts/`. In development, this path is easily resolved. In packaged Electron builds, `app.getAppPath()` points to an ASAR archive and file paths are different.

Mitigation:
- Use `app.isPackaged ? process.resourcesPath : path.join(__dirname, '../../backend/prompts')` pattern
- Test packaged builds on all three platforms before declaring this complete
- Add a startup validation that checks all expected prompt files are readable

**Risk 3: Merge system behavioral parity (~6,300 lines)**

The merge system is the most complex module. The regex-based semantic analyzer covers 40+ change types across multiple languages. A partial port (e.g., missing some change type patterns) causes silent incorrect merges that are hard to detect.

Mitigation:
- Port with a comprehensive test suite that exercises each of the 40+ change types
- Run Python and TypeScript implementations in parallel on real merge scenarios and compare output
- Keep the Python fallback path active until full behavioral parity is confirmed

**Risk 4: Context window overflow without compaction**

Without conversation compaction between spec phases, long-running spec pipelines (complex tasks) can exceed the context window. This is not a crash — the AI SDK returns a context_length_exceeded error — but it causes spec creation to fail silently.

Mitigation:
- Implement compaction (4.4) before enabling complex-tier specs
- Add monitoring for conversation length: log token counts at each phase transition
- Set conservative phase limits until compaction is implemented

**Risk 5: Linear integration timing**

Linear subtask status updates must fire at the right phase transitions. Firing too early (before the subtask is actually complete) or too late (after the next subtask starts) causes confusing Linear state.

Mitigation:
- Gate Linear integration behind `LINEAR_API_KEY` env var check
- Add integration tests that mock the Linear MCP and verify the sequence of calls
- Keep Linear optional — the pipeline must work correctly without it

### Testing Approach Per Phase

**Phase 1 (Security):**
- Unit tests for each validator function (test allowed commands, blocked commands, edge cases)
- Integration test: run a coder session against a sandboxed project and verify that dangerous commands are blocked
- Property test: generate random command strings and verify validators never crash

**Phase 2 (Core Pipeline):**
- End-to-end test: create a spec, build it, run QA, check that all artifacts are produced
- Regression test: run the same spec through Python pipeline and TypeScript pipeline, compare output artifacts
- Load test: run 3 parallel coder sessions and verify no state corruption

**Phase 3 (Feature Parity):**
- Manual testing of each UI feature (insights, roadmap, ideation) after IPC wiring
- GitHub PR review test: review a known PR and compare output to Python baseline

**Phase 4 (Merge):**
- Port the Python merge test suite (real file pairs with known expected outputs)
- Test each of the 8 deterministic strategies independently

---

## 11. Files to Delete After Migration

Once each module's TypeScript equivalent is validated and the Python subprocess invocations for that module are removed, these Python files can be deleted. Delete module by module to allow incremental cleanup.

**After Phase 1 (Security) is validated:**
```
apps/backend/security/
  ├── database_validators.py
  ├── filesystem_validators.py
  ├── git_validators.py
  ├── hooks.py
  ├── main.py
  ├── parser.py
  ├── process_validators.py
  ├── scan_secrets.py
  ├── shell_validators.py
  ├── tool_input_validator.py
  ├── validation_models.py
  ├── validator.py
  └── validator_registry.py
  (keep: profile.py until project analyzer is ported)
  (keep: constants.py — may be referenced by other modules)
```

**After Phase 2 (Core Pipeline) is validated:**
```
apps/backend/agents/
  ├── coder.py
  ├── planner.py
  ├── session.py
  ├── memory_manager.py
  ├── pr_template_filler.py
  ├── utils.py
  ├── base.py
  └── tools_pkg/
      ├── models.py
      ├── permissions.py
      ├── registry.py
      └── tools/
          ├── memory.py
          ├── subtask.py
          ├── qa.py
          └── progress.py

apps/backend/spec/
  (after spec pipeline is fully ported)

apps/backend/qa/
  (after QA loop is fully ported)

apps/backend/context/
  (after context system is ported)

apps/backend/prompts_pkg/
  ├── prompt_generator.py
  ├── prompts.py
  └── project_context.py
```

**After Phase 3 (Feature Parity) is validated:**
```
apps/backend/project/
  (entire directory after project analyzer is ported)

apps/backend/runners/
  ├── insights_runner.py
  ├── roadmap_runner.py
  ├── ideation_runner.py
  ├── spec_runner.py
  └── ai_analyzer/
  (keep: github/ and gitlab/ until those runners are fully validated)

apps/backend/
  ├── agent.py
  ├── analyzer.py
  ├── phase_config.py
  ├── phase_event.py
  ├── progress.py
  ├── prompt_generator.py
  ├── prompts.py
  ├── recovery.py
  ├── insight_extractor.py
  ├── linear_updater.py
  ├── linear_integration.py
  └── workspace.py
```

**After Phase 4 (Merge System) is validated:**
```
apps/backend/merge/
  (entire directory)
```

**Core Python files to delete last (after all modules are ported):**
```
apps/backend/
  ├── client.py          (create_client() replaced by TypeScript provider factory)
  ├── core/client.py     (same)
  ├── core/auth.py       (replaced by TypeScript auth resolver)
  ├── run.py             (replaced by TypeScript build orchestrator)
  └── cli/               (may keep for power users; can defer)
```

---

## 12. Files to Keep Permanently (Python)

These files are not being migrated. They are permanent parts of the architecture.

### Always Keep

```
apps/backend/integrations/graphiti/
  (entire directory — this IS the Graphiti MCP sidecar)
  ├── __init__.py
  ├── mcp_server.py      (FastAPI MCP server exposing Graphiti tools)
  ├── graphiti_client.py
  └── README.md
```

### Keep Until Explicitly Decided

```
apps/backend/prompts/
  (all .md prompt files — read by TypeScript at runtime)
  ├── coder.md
  ├── coder_recovery.md
  ├── planner.md
  ├── qa_reviewer.md
  ├── qa_fixer.md
  ├── spec_gatherer.md
  ├── spec_researcher.md
  ├── spec_writer.md
  ├── spec_critic.md
  ├── spec_quick.md
  ├── complexity_assessor.md
  ├── insight_extractor.md
  ├── roadmap_discovery.md
  ├── roadmap_features.md
  ├── competitor_analysis.md
  ├── ideation_*.md (6 files)
  ├── followup_planner.md
  ├── validation_fixer.md
  └── github/
      └── *.md (GitHub-specific prompts)

apps/backend/core/worktree.py
  (keep until TypeScript worktree/ module is fully validated on all platforms)

apps/backend/
  ├── pyproject.toml     (needed for Graphiti sidecar dependency management)
  └── requirements.txt   (same)
```

### CLI Compatibility (Optional Keep)

```
apps/backend/
  ├── run.py             (Python CLI for power users; may keep for compatibility)
  └── cli/               (same — CLI commands like spec, build, workspace, qa)
```

The Python CLI does not need to be removed even after full TypeScript migration. It provides a fallback for users who prefer CLI over the Electron app. However, it will not receive new features and its agent execution will lag behind the TypeScript layer.

---

## 13. Appendix: File Sizes and Quick Reference

### TypeScript AI Layer Current LOC

```
apps/frontend/src/main/ai/                     ~19,659 lines total
  providers/                                   ~2,100
    factory.ts, registry.ts, transforms.ts, ...
  session/                                     ~1,300
    runner.ts, stream-handler.ts, error-classifier.ts, progress-tracker.ts
  agent/                                       ~1,200
    worker.ts, worker-bridge.ts
  orchestration/                               ~2,900
    build-orchestrator.ts, spec-orchestrator.ts, qa-loop.ts,
    recovery-manager.ts, subtask-iterator.ts
  tools/                                       ~2,200
    registry.ts, define.ts, builtin/*.ts (8 tools)
  config/                                      ~1,200
    agent-configs.ts, phase-config.ts, types.ts
  security/                                    ~700
    bash-validator.ts, command-parser.ts, path-containment.ts
  runners/                                     ~5,000
    insights.ts, insight-extractor.ts, roadmap.ts,
    commit-message.ts, changelog.ts, ideation.ts,
    merge-resolver.ts,
    github/ (pr-review-engine.ts, parallel-orchestrator.ts,
             parallel-followup.ts, triage-engine.ts),
    gitlab/ (mr-review-engine.ts)
  logging/                                     ~372
    task-log-writer.ts
  auth/, client/, mcp/, worktree/              ~600
```

### Python Backend LOC (excluding venv, migration targets only)

```
apps/backend/                                  ~142,375 lines total (all .py)
  security/                                    ~2,870 lines
  agents/                                      ~5,560 lines
  spec/                                        ~6,188 lines
  qa/                                          ~2,379 lines
  context/                                     ~1,042 lines
  project/                                     ~2,496 lines
  merge/                                       ~9,969 lines
  runners/ (github + gitlab + others)          ~37,207 lines
  prompts_pkg/                                 ~1,495 lines
  (rest: graphiti, CLI, tests, config)
```

### Migration Priority Quick Reference

| Priority | Module | Est. Days | Blocker for |
|---|---|---|---|
| P0 | Security validators (19 functions) | 2 | All agent bash safety |
| P0 | Prompt loading system | 3 | All agent phases |
| P1 | Auto-Claude tools (record_gotcha, get_session_context) | 1 | Coder tool calls |
| P1 | Spec validation + compaction | 2 | Spec quality |
| P2 | Coder/planner prompt generation | 2 | Subtask focus |
| P2 | Context system | 2 | File context injection |
| P2 | QA report generation + history | 1 | QA reporting |
| P2 | Post-session processing | 1 | Insight saving |
| P3 | Project analyzer | 3 | Dynamic allowlisting |
| P3 | Runner IPC wiring | 2 | UI feature connectivity |
| P3 | CLAUDE.md injection | 1 | Project context |
| P4 | Merge system | 8 | Smart parallel merges |

---

*Document generated: 2026-02-20. Based on investigation of 10 agent reports covering security, agents, spec, QA, context, project, merge, runners, prompt, and orchestration modules.*
