# Component Inventory

**Generated:** 2026-02-23 | **Scan Level:** Deep

## Frontend React Components

### Root-Level Components (29 files)

Located in `apps/frontend/src/renderer/components/`:

| Component | Purpose |
|-----------|---------|
| KanbanBoard, KanbanColumn, KanbanTaskCard | Drag-and-drop task board (@dnd-kit) |
| TaskCreationWizard | Multi-step task creation flow |
| TaskItem, TaskList, TaskStatusBadge | Task list display and status |
| Sidebar, ProjectTabBar | Navigation and project switching |
| Terminal, TerminalGrid | xterm.js terminal integration |
| Insights | AI codebase chat interface |
| Roadmap | Strategic roadmap visualization |
| AppUpdateNotification, UpdateBanner | Auto-update UI |
| UsageIndicator, RateLimitIndicator, RateLimitModal | API usage and rate limit display |
| GitHubSetupModal, GitSetupModal | OAuth setup flows |
| FileExplorerPanel, FileTree, FileTreeItem | File browser |
| ImageUpload, ScreenshotCapture | Media capture |
| WorktreeCleanupDialog | Worktree management |
| ProfileBadge, ClaudeCodeStatusBadge | Status indicators |
| ProactiveSwapListener | Profile auto-switching listener |

### Feature Component Directories (18 directories)

#### Changelog (15 files)
Release note generation and display: `Changelog`, `ChangelogDetails`, `ChangelogEntry`, `ChangelogList`, `ChangelogFilters`, `ChangelogHeader`, `ConfigurationPanel`, `PreviewPanel`, `ArchiveTasksCard`, `GitHubReleaseCard`, `Step3SuccessScreen` + hooks and utils.

#### Context (14 files)
Knowledge graph and semantic context: `Context`, `MemoriesTab`, `MemoryCard`, `ProjectIndexTab`, `PRReviewCard`, `ServiceCard`, `InfoItem` + service-sections subdirectory, hooks, utils, constants, types.

#### GitHub Issues (8 items)
Issue browser with `components/`, `hooks/`, `types/`, `utils/` subdirectories. Includes `ARCHITECTURE.md`.

#### GitHub PRs (6 items)
PR review interface: `GitHubPRs.tsx` + `components/`, `constants/`, `hooks/`, `utils/` subdirectories.

#### GitLab Issues (5 items)
Issue browser: `components/`, `hooks/`, `types/`, `utils/`.

#### GitLab Merge Requests (5 items)
MR review: `GitLabMergeRequests.tsx` + `components/`, `constants/`, `hooks/`.

#### Ideation (17 files)
AI feature suggestions: `Ideation`, `IdeaCard`, `IdeaDetailPanel`, `IdeaSkeletonCard`, `IdeationDialogs`, `IdeationEmptyState`, `IdeationFilters`, `IdeationHeader`, `GenerationProgressScreen`, `TypeIcon`, `TypeStateIcon` + details/, hooks/, type-guards, constants, utils.

#### Linear Import (7 items)
Linear PM import: `LinearTaskImportModalRefactored` + components/, hooks/, types.

#### Onboarding (16 files)
Setup wizard: `OnboardingWizard`, `WelcomeStep`, `AuthChoiceStep`, `OAuthStep`, `ClaudeCodeStep`, `DevToolsStep`, `FirstSpecStep`, `GraphitiStep`, `MemoryStep`, `PrivacyStep`, `CompletionStep`, `OllamaModelSelector`, `WizardProgress` + tests.

#### Project Settings (20 files)
Project configuration: `GeneralSettings`, `SecuritySettings`, `NotificationsSection`, `ClaudeAuthSection`, `ClaudeOAuthFlow`, `GitHubIntegrationSection`, `GitHubOAuthFlow`, `LinearIntegrationSection`, `AutoBuildIntegration`, `MemoryBackendSection`, `AgentConfigSection`, `InfrastructureStatus`, `ConnectionStatus`, `CollapsibleSection`, `StatusBadge`, `PasswordInput` + hooks/.

#### Roadmap (12 files)
Roadmap visualization: `RoadmapHeader`, `RoadmapTabs`, `RoadmapEmptyState`, `FeatureCard`, `FeatureDetailPanel`, `PhaseCard`, `TaskOutcomeBadge` + hooks, utils, types.

#### Settings (32 files)
App-wide settings: `GeneralSettings`, `AccountSettings`, `AdvancedSettings`, `AppSettings`, `LanguageSettings`, `ThemeSettings`, `DisplaySettings`, `AgentProfileSettings`, `ProfileEditDialog`, `ProfileList`, `AccountPriorityList`, `ModelSearchableSelect`, `AuthTerminal`, `DebugSettings`, `DevToolsSettings`, `ThemeSelector`, `SettingsSection` + common/, hooks/, integrations/, sections/, terminal-font-settings/, utils/ subdirectories.

#### Task Detail (14 files)
Task information: `TaskDetailModal`, `TaskHeader`, `TaskMetadata`, `TaskProgress`, `TaskActions`, `TaskSubtasks`, `TaskFiles`, `TaskLogs`, `TaskReview`, `TaskWarnings` + task-review/, hooks/.

#### Task Form (7 items)
Task creation forms: `TaskFormFields`, `TaskModalLayout`, `ClassificationFields`, `ImagePreviewModal`, `useImageUpload` + tests.

#### Terminal (15 files)
Terminal integration: `TerminalHeader`, `TerminalTitle`, `CreateWorktreeDialog`, `TaskSelector`, `WorktreeSelector` + hooks (`useAutoNaming`, `usePtyProcess`, `useTerminalEvents`, `useTerminalFileDrop`, `useXterm`) + types, tests.

#### UI Component Library (27 files)
Reusable Radix UI primitives: `button`, `input`, `checkbox`, `radio-group`, `combobox`, `select`, `textarea`, `label`, `card`, `dialog`, `full-screen-dialog`, `tabs`, `scroll-area`, `resizable-panels`, `badge`, `alert-dialog`, `progress`, `tooltip`, `popover`, `dropdown-menu`, `separator`, `switch`, `collapsible`, `toast`, `toaster`, `error-boundary`.

#### Workspace (1 file)
`AddWorkspaceModal.tsx` — workspace creation interface.

## Zustand State Stores

### Root-Level Stores (24 files in `stores/`)

| Store | Purpose |
|-------|---------|
| project-store.ts | Active project, project list, tab management |
| task-store.ts | Task/spec lifecycle, status, completion |
| terminal-store.ts | Terminal sessions and state |
| settings-store.ts | User preferences and configuration |
| claude-profile-store.ts | Multi-profile credential management |
| auth-failure-store.ts | Authentication error recovery |
| insights-store.ts | AI codebase insights conversation |
| roadmap-store.ts | Roadmap generation and visualization |
| ideation-store.ts | Feature suggestion and ideation results |
| changelog-store.ts | Generated changelog state |
| context-store.ts | Context building and semantic search |
| kanban-settings-store.ts | Kanban board layout and display |
| memory-store.ts | Graphiti knowledge graph state |
| mcp-server-store.ts | MCP server state and configuration |
| agent-tools-store.ts | Agent tool definitions |
| bmad-workflows-store.ts | BMAD workflow definitions |
| worktrees-store.ts | Git worktree tracking |
| sync-status-store.ts | Sync progress and status |
| rate-limit-store.ts | API rate limit warnings |
| download-store.ts | Active downloads tracking |
| file-explorer-store.ts | File browser state |
| project-env-store.ts | Project environment variables |
| release-store.ts | Release information caching |
| terminal-font-settings-store.ts | Terminal font preferences |

### GitHub Stores (5 files in `stores/github/`)

| Store | Purpose |
|-------|---------|
| issues-store.ts | GitHub issue list and details |
| pr-review-store.ts | PR review state and progress |
| investigation-store.ts | Investigation session state |
| sync-status-store.ts | GitHub data sync status |

### GitLab Stores (2 files in `stores/gitlab/`)

| Store | Purpose |
|-------|---------|
| mr-review-store.ts | Merge request review state |

## IPC Handler Modules

### Root-Level Handlers (36 files in `ipc-handlers/`)

| Handler | Purpose |
|---------|---------|
| project-handlers.ts | Project creation, initialization, settings |
| task-handlers.ts | Task CRUD operations |
| terminal-handlers.ts | Terminal session management |
| agent-events-handlers.ts | Agent lifecycle events |
| settings-handlers.ts | User settings persistence |
| context-handlers.ts | Context building and semantic search |
| insights-handlers.ts | Codebase insights |
| roadmap-handlers.ts | Roadmap generation |
| ideation-handlers.ts | Ideation/idea generation |
| changelog-handlers.ts | Release notes generation |
| github-handlers.ts | GitHub operations |
| gitlab-handlers.ts | GitLab operations |
| linear-handlers.ts | Linear PM integration |
| claude-code-handlers.ts | Claude Code IDE integration |
| mcp-handlers.ts | MCP server communication |
| memory-handlers.ts | Knowledge graph memory |
| app-update-handlers.ts | Application update management |
| screenshot-handlers.ts | Screenshot capture |
| file-handlers.ts | File operations |
| env-handlers.ts | Environment variable management |
| debug-handlers.ts | Debug utilities |
| profile-handlers.ts | Profile management (OAuth, switching) |
| queue-routing-handlers.ts | Agent queue routing |

### Domain-Specific Handler Subdirectories

| Directory | Files | Purpose |
|-----------|-------|---------|
| github/ | 14 | PR, issues, review, investigation, autofix, import, release, triage, OAuth |
| gitlab/ | 11 | MR, issues, review, investigation, autofix, import, release, triage, OAuth |
| context/ | 5 | Project context, memory data, memory status |
| ideation/ | 7 | Generation, session manager, idea manager, task converter |
| task/ | 6 | CRUD, execution, archive, worktree, logs |
| terminal/ | 1 | Worktree operations |
| roadmap/ | 1 | Data transformation |
| shared/ | 3 | Label utils, sanitization |

## Preload API Modules

### Root-Level APIs (12 files in `preload/api/`)

| Module | Purpose |
|--------|---------|
| project-api.ts | Project operations |
| task-api.ts | Task operations |
| terminal-api.ts | Terminal session operations |
| agent-api.ts | Agent lifecycle and execution |
| settings-api.ts | Settings read/write |
| profile-api.ts | Profile management |
| app-update-api.ts | Application updates |
| queue-api.ts | Queue routing |
| file-api.ts | File system operations |
| screenshot-api.ts | Screenshot capture |

### Modular APIs (14 files in `preload/api/modules/`)

| Module | Purpose |
|--------|---------|
| changelog-api.ts | Changelog generation |
| roadmap-api.ts | Roadmap operations |
| insights-api.ts | Codebase insights |
| ideation-api.ts | Ideation/idea generation |
| github-api.ts | GitHub operations |
| gitlab-api.ts | GitLab operations |
| linear-api.ts | Linear integration |
| claude-code-api.ts | Claude Code IDE integration |
| mcp-api.ts | MCP server communication |
| shell-api.ts | Shell execution |
| debug-api.ts | Debug utilities |
| ipc-utils.ts | IPC communication utilities |

## Custom React Hooks

11 hooks in `renderer/hooks/`:

| Hook | Purpose |
|------|---------|
| useIpc | IPC communication and message handling |
| useTerminal | Terminal session management |
| useGlobalTerminalListeners | Global terminal event listeners |
| useTaskReconciliation | Task state reconciliation from disk |
| useTerminalProfileChange | Terminal profile switching |
| useResolvedAgentSettings | Agent settings resolution |
| use-profile-swap-notifications | Profile swap notifications |
| useVirtualizedTree | Virtualized tree rendering |
| use-toast | Toast notifications |

## Shared Type Definitions

21 type files in `shared/types/`:

| File | Purpose |
|------|---------|
| project.ts | Project, ProjectSettings, workspace types |
| task.ts | Task, Spec, ImplementationPlan, status types |
| terminal.ts | Terminal session and PTY types |
| agent.ts | Agent state, event, lifecycle types |
| profile.ts | Claude profile and account types |
| settings.ts | User settings types |
| roadmap.ts | Roadmap, phase, goal types |
| insights.ts | Codebase insight types |
| github.ts | GitHub issue and PR types |
| gitlab.ts | GitLab issue and MR types |
| integrations.ts | Integration configuration types |
| kanban.ts | Kanban board and column types |
| changelog.ts | Changelog entry and metadata types |
| app-update.ts | App update state types |
| screenshot.ts | Screenshot capture types |
| pr-status.ts | PR/MR review status types |
| terminal-session.ts | Terminal session metadata |
| unified-account.ts | Unified account abstraction |
| cli.ts | CLI argument and execution types |
| common.ts | Common utility types |
| ipc.ts | IPC message types |

## i18n Translation Namespaces

11 namespaces in `shared/i18n/locales/{en,fr}/`:

| Namespace | Purpose |
|-----------|---------|
| common.json | Buttons, labels, common phrases |
| navigation.json | Navigation labels and menu items |
| settings.json | Settings and configuration UI text |
| tasks.json | Task-related terminology |
| taskReview.json | Task review and validation messages |
| dialogs.json | Dialog titles, messages, buttons |
| errors.json | Error messages and recovery |
| onboarding.json | Onboarding wizard and setup |
| welcome.json | Welcome screen and first-launch |
| terminal.json | Terminal-related text |
| gitlab.json | GitLab-specific terminology |

## Backend Module Inventory

### Core Infrastructure (`core/`)

| Module | Purpose |
|--------|---------|
| client.py | Claude Agent SDK client config and patches |
| auth.py | OAuth token management and authentication |
| agent.py | Agent base classes |
| progress.py | Task progress tracking |
| phase_event.py | Phase lifecycle events |
| model_config.py | Model configuration management |
| fast_mode.py | Fast mode optimization |
| file_utils.py, io_utils.py | File and IO operations |
| error_utils.py | Error handling |
| debug.py | Debug utilities |
| dependency_validator.py | Dependency checking |
| git_executable.py, git_provider.py | Git operations |
| gh_executable.py, glab_executable.py | GitHub/GitLab CLI |
| platform/ | Cross-platform abstractions |

### Agents (`agents/`)

| Module | Purpose |
|--------|---------|
| base.py | Base agent class |
| planner.py | Planning agent for task breakdown |
| coder.py (66KB) | Coding agent for implementation |
| session.py (29KB) | Agent session management |
| memory_manager.py (18KB) | Agent memory operations |
| pr_template_filler.py | PR template handling |
| tools_pkg/ | Tool data models, permissions, registry |

### Spec Pipeline (`spec/`)

| Module | Purpose |
|--------|---------|
| pipeline.py | Main orchestration |
| complexity.py (18KB) | AI-based complexity assessment |
| validation_strategy.py (34KB) | Multi-strategy validation |
| requirements.py | Requirement extraction |
| writer.py | Spec document generation |
| validate_spec.py, validator.py | Spec validation |
| phases/ (11 files) | Phase executors and definitions |
| pipeline/ (4 files) | Orchestrator, agent runner |
| validate_pkg/ (7+ files) | Validators, schemas, auto-fix |

### QA System (`qa/`)

| Module | Purpose |
|--------|---------|
| reviewer.py (17KB) | QA validation and review |
| fixer.py (15KB) | Issue resolution agent |
| loop.py (25KB) | QA iteration loop |
| criteria.py | Acceptance criteria evaluation |
| report.py (15KB) | Issue tracking and escalation |

### Security (`security/`)

| Module | Purpose |
|--------|---------|
| validator.py | Main security validator |
| hooks.py | Pre-tool-use validation hooks |
| tool_input_validator.py | Tool input validation |
| parser.py | Command parsing |
| scan_secrets.py | Secret detection |
| filesystem_validators.py | File system validation |
| shell_validators.py | Shell command validation |
| git_validators.py | Git command validation |
| database_validators.py | Database operation validation |
| process_validators.py | Process execution validation |
| validator_registry.py | Validator registration system |

### Integrations

| Module | Purpose |
|--------|---------|
| graphiti/ (15+ files) | Knowledge graph memory (LadybugDB) |
| linear/ (4 files) | Linear PM integration |
| github/ | GitHub PR/issue management |

### Context Building (`context/`)

| Module | Purpose |
|--------|---------|
| builder.py | Context assembly orchestration |
| search.py | Semantic search |
| categorizer.py | File importance classification |
| keyword_extractor.py | Keyword extraction |
| pattern_discovery.py | Pattern identification |
| graphiti_integration.py | Knowledge graph integration |

### Semantic Merge (`merge/`, 40+ files)

AI-powered conflict resolution: `merge_pipeline.py`, `conflict_detector.py`, `conflict_resolver.py`, `file_merger.py` + `ai_resolver/` (10 files), `auto_merger/` (5 files), `file_evolution/` (3 files).

### Runners (`runners/`)

Standalone execution: `spec_runner.py`, `insights_runner.py`, `ideation_runner.py`, `roadmap_runner.py` + `github/` (40+ files), `gitlab/` (7 files), `roadmap/` (10 files), `ai_analyzer/` (11 files).

### CLI (`cli/`)

Command routing: `main.py`, `spec_commands.py`, `build_commands.py`, `qa_commands.py`, `followup_commands.py`, `workspace_commands.py`, `batch_commands.py`, `input_handlers.py`, `recovery.py`.

## Summary Statistics

| Category | Count |
|----------|-------|
| Frontend Components | 90+ (29 root + 18 feature directories) |
| Zustand Stores | 31 (24 root + 5 GitHub + 2 GitLab) |
| IPC Handlers | 36+ root + 48+ domain-specific |
| Preload API Modules | 26 (12 root + 14 modular) |
| Custom Hooks | 11 |
| Type Definition Files | 21 |
| i18n Namespaces | 11 (English + French) |
| Backend Python Modules | 25+ major modules, 300+ files |
