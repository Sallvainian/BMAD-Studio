---
project_name: 'BMAD-Studio'
user_name: 'Sallvain'
date: '2026-05-01'
sections_completed:
  - technology_stack
  - language_rules
  - framework_rules
  - testing_rules
  - quality_rules
  - workflow_rules
  - anti_patterns
status: 'complete'
rule_count: 54
optimized_for_llm: true
existing_patterns_found: 42
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing code in this project. Focus on unobvious details that agents might otherwise miss._

---

## Current Repository Reality

- The active app is `apps/desktop`, an Electron desktop application with React renderer, preload bridge, and main process. References to `apps/frontend`, `apps/backend`, or Python-first app orchestration are stale docs drift and must not be treated as current structure.
- The BMAD engine-swap Phase 0-5 work has landed in history. Phase docs under `apps/desktop/docs/bmad-migration/` are source context, but live code, `package-lock.json`, and current git state win over stale handoff prose.
- The current branch can differ by session. Verify `git status`, branch, and PR state before giving release/merge guidance.
- Some generated docs under `docs/` may lag the app after migration. Use them for orientation, not as authority when they conflict with `apps/desktop`, lockfiles, or migration notes.

## Technology Stack & Versions

- **Runtime:** Node >=24.0.0, npm >=10.0.0. Root scripts delegate to `apps/desktop`.
- **Desktop shell:** Electron 40.8.5, electron-vite 5.0.0, electron-builder 26.8.1.
- **Frontend:** React 19.2.4, React DOM 19.2.4, TypeScript 6.0.3 strict mode, Vite 7.3.2, Tailwind CSS 4.2.1.
- **AI runtime:** Vercel AI SDK `ai` 6.0.116 with `@ai-sdk/*` provider adapters. Agent execution uses `streamText()` / `generateText()` through the TypeScript AI layer.
- **State/UI:** Zustand 5.0.11, XState 5.28.0, Radix UI, lucide-react, xterm.js 6.0.0, Motion 12.36.0.
- **Validation/data:** Zod 4.3.6, js-yaml 4.1.1, smol-toml 1.6.1, uuid 14.0.0, libsql client 0.17.0.
- **Quality:** Vitest 4.1.0, Playwright 1.58.2, Biome 2.4.7 linting, lint-staged 16.4.0. Biome formatter is disabled in config.
- **Localization:** i18next 26.0.8 and react-i18next 17.0.6 with mirrored `en` and `fr` resource files.

## Critical Implementation Rules

### Language-Specific Rules

- Use the strict TypeScript contract in `apps/desktop/tsconfig.json`: `strict`, `isolatedModules`, `moduleResolution: "bundler"`, `jsx: "react-jsx"`, `noEmit`.
- Prefer configured aliases when they match the target layer: `@shared/*`, `@preload/*`, `@features/*`, `@components/*`, `@hooks/*`, `@lib/*`.
- Keep shared contracts narrow and validated. Put cross-process/domain types in `apps/desktop/src/shared/types/*` and validate untrusted IPC, YAML, TOML, CSV, and AI output with Zod or parser-specific checks.
- Preserve existing `type` vs `interface` style near the code being changed. Do not churn public type shapes for style-only reasons.
- Return structured domain results and errors. BMAD IPC uses `BmadIpcResult<T>`, `bmadOk()`, and `bmadFail()` with error codes.
- Do not add broad catch-and-ignore recovery. If a missing file is normal, make that state explicit with a typed nullable result, option flag, or documented error code.

### AI, BMAD, And Workflow Rules

- Agent/model execution goes through `apps/desktop/src/main/ai/` using the Vercel AI SDK. Do not add new direct provider SDK calls in agent execution paths.
- Existing direct `@anthropic-ai/sdk` usage in profile/account validation is specialized legacy surface area. Do not copy that pattern into runners, worker threads, BMAD workflows, or new AI features.
- BMAD workflow execution must stay generic. Skill behavior comes from installed `SKILL.md`, step files, `customize.toml`, project overrides, and `_bmad/bmm/config.yaml`.
- Enforce BMAD just-in-time step loading. Do not load future workflow step files into context or UI state before the current step allows continuation.
- The BMAD filesystem is the contract: `_bmad/_config/manifest.yaml`, `skill-manifest.csv`, `bmad-help.csv`, `_bmad/custom/*.toml`, `_bmad-output/planning-artifacts/`, and `_bmad-output/implementation-artifacts/`.
- Preserve customization merge semantics: scalars override, tables deep-merge, arrays of tables keyed uniformly by `code` or `id` replace/append by key, all other arrays append.
- Personas can persist in the app session, but each workflow invocation starts a fresh conversation. Do not leak previous workflow chat history into a new BMAD run.
- Legacy task/spec/QA entrypoints are intentionally fail-fast after Phase 5 cleanup. Do not resurrect deleted planner/coder/QA prompt orchestration unless the user explicitly starts that migration work.
- Phase 6/stretch features such as Quick Flow, IDE delegation, marketplace, or deeper Aperant integration are out of scope unless the user explicitly asks for them.

### Electron, Renderer, And State Rules

- Renderer code must use preload APIs exposed through `contextBridge`; do not call Electron, Node filesystem, shell, or process APIs directly from React.
- Add typed preload wrappers and main IPC handlers together. Keep channel names centralized in `apps/desktop/src/shared/constants/ipc.ts`.
- Event subscriptions exposed through preload must return cleanup functions, and React components/hooks must call them on unmount or project switch.
- Keep privileged filesystem, shell, installer, and credential work in the main process with path containment and typed IPC payload validation.
- Renderer state belongs in existing Zustand stores under `src/renderer/stores/`. Reconcile file-backed state from watcher events instead of inventing a second database.
- For BMAD Kanban, `sprint-status.yaml` is truth. Optimistic UI may be temporary, but must roll back or reconcile when the watcher confirms the actual file state.
- Use the platform abstraction layer in `apps/desktop/src/main/platform/` for new main-process OS branching. Preload may expose simple platform facts for renderer use.

### Testing Rules

- Run desktop commands from `apps/desktop` when validating app code: `npm test`, `npm run test:unit`, `npm run test:integration`, `npm run test:e2e`, `npm run typecheck`, `npm run lint`.
- Vitest defaults to Node environment and mocks Electron/Sentry in `apps/desktop/vitest.config.ts`. Renderer tests that need DOM behavior must follow existing test setup and mocks.
- Unit/spec tests use `*.test.ts`, `*.test.tsx`, `*.spec.ts`, or `*.spec.tsx` under `src/**`; keep tests near the code or in established `__tests__` folders.
- Electron E2E tests live in `apps/desktop/e2e`, match `*.e2e.ts`, run serially with one worker, and use Electron-specific setup.
- BMAD core changes need focused fixtures around resolver, config, manifest, step loader, sprint status, workflow runner, migrator, installer, and kanban helpers.
- IPC/preload changes should test both main handler behavior and renderer/preload shape where practical. Mocks must match `window.electronAPI` names exactly.
- Coverage thresholds are intentionally low. Passing thresholds is not enough for risky changes; add targeted regression tests for the behavior being changed.

### Code Quality & Style Rules

- Use the existing root command surface for convenience, but remember it delegates to `apps/desktop`.
- Run formatting or the project fixer on modified files before committing. In this repo that usually means `npm run format` or `npm run lint:fix` from `apps/desktop`, scoped when possible.
- Biome is the linter, but `apps/desktop/biome.jsonc` disables Biome formatting. Do not assume `biome check --write` handles layout formatting.
- New user-facing React text must use `react-i18next` keys. Add matching keys to both `apps/desktop/src/shared/i18n/locales/en/*.json` and `fr/*.json`.
- Keep i18n namespaces registered in `apps/desktop/src/shared/i18n/index.ts`; adding files without registering both languages is incomplete.
- Use existing Radix/Tailwind component patterns and lucide-react icons for UI controls where an icon exists.
- Avoid production `console.log` debugging. Use existing logging/Sentry patterns or keep logging behind existing debug-only paths.
- Never hardcode secrets, API keys, OAuth tokens, or provider credentials in source or `.env`. The user's secret workflow is fnox-backed; app runtime credentials belong in profile/credential mechanisms.

### Development Workflow Rules

- PRs target `develop`, not `main`, unless the user is explicitly doing a release flow.
- Before merge/release advice, verify branch, remotes, PR number, and current mergeability. Do not trust older phase notes for live PR status.
- Keep user/unrelated dirty worktree changes out of your task. Do not revert, stage, or absorb files you did not intentionally modify.
- For packaged Electron behavior, check dev and packaged paths. Assets that work under Vite can fail when moved into `resources` or `asar`.
- If adding main-process or worker dependencies, review `apps/desktop/electron.vite.config.ts` bundling/externalization and `apps/desktop/package.json` `build.extraResources`.
- Native or hoisted packages need packaging attention. `@lydell/node-pty` and libsql-related packages already have special handling.
- For BMAD migration or phase-gate work, preserve the reviewer/implementer/orchestrator boundary. Do not silently continue into the next phase or stretch scope.

### Critical Don't-Miss Rules

- Do not bundle or vendor BMAD skills as app source. BMAD is installed and updated in user projects through the BMAD install/update flow.
- Do not create a second source of truth for BMAD phases, modules, workflow dependencies, stories, or kanban state.
- Do not silently add `development_status` keys when moving kanban cards. Existing status updates intentionally fail if the story key is missing.
- Do not assume BMAD output files exist before their workflow runs. Missing `sprint-status.yaml`, story files, or planning artifacts can be a normal pre-workflow state.
- Do not trust generated docs over live app files. If docs mention `apps/frontend`, `apps/backend`, or Python-first app orchestration, treat that claim as obsolete unless live files prove otherwise.
- Do not hardcode English strings in JSX, dialogs, toast text, errors, empty states, or buttons.
- Do not use `dangerouslySetInnerHTML` unless the content is sanitized and the rendering reason is local and documented by nearby code.
- Do not rely on bundled Electron runtime `process.env` for secrets. Build-time defines are embedded; runtime credentials must come from app credential/profile mechanisms.
- Do not add shell or filesystem access from the renderer. Use main/preload with validation and path containment.
- Do not assume macOS-only paths, shells, commands, path delimiters, executable extensions, or app packaging behavior. The app supports macOS, Windows, and Linux.

---

## Usage Guidelines

**For AI Agents:**

- Read this file before implementing code in BMAD-Studio.
- Follow all rules documented here.
- When this file conflicts with live source or lockfiles, verify and update this file.
- When in doubt, prefer the more restrictive option and match nearby code.

**For Humans:**

- Keep this file lean and focused on agent needs.
- Update it when the technology stack, BMAD contracts, or workflow boundaries change.
- Remove rules that become obvious, stale, or superseded by code.

Last Updated: 2026-05-01
