## Phase 5 — Customization UI + Module Manager + Migration + Cleanup

**Status:** ✅ Gate-fix pass complete; legacy cleanup scoped as a Phase 5 follow-up

**Operating contract:** [`ENGINE_SWAP_PROMPT.md`](../../../../ENGINE_SWAP_PROMPT.md)
**Inventory:** [`INVENTORY.md`](./INVENTORY.md)
**Decisions:** [`DECISIONS.md`](./DECISIONS.md)
**Branch:** `feature/bmad-engine-swap`
**PR:** #49 (draft, base `develop`)
**Predecessor:** [Phase 4 Notes](./PHASE-4-NOTES.md)

---

## Deliverables shipped

- `src/renderer/components/bmad/BmadCustomizationPanel.tsx` — Settings → Project → BMad Customizations. Lists installed skills, supports Team vs Personal scope, writes sparse TOML overrides via `BMAD_WRITE_CUSTOMIZATION`, previews resolved per-skill customization or central config. Common templates map to BMAD docs § "Worked Examples" Recipes 1-5.
- `src/renderer/components/bmad/BmadModuleManager.tsx` — Settings → Project → BMad Modules. Lists installed modules from `_bmad/_config/manifest.yaml`, runs update/install/remove through `npx bmad-method install` via existing installer IPC, supports custom sources per BMAD docs § "Community Modules" and § "Custom Sources".
- `src/main/ai/bmad/migrator.ts` — detects `.auto-claude/specs`, backs up `.auto-claude/` to `.auto-claude.backup/`, migrates `spec.md` to `_bmad-output/planning-artifacts/*-product-brief.md`, seeds story markdown and `sprint-status.yaml`.
- `src/main/ai/bmad/__tests__/migrator.test.ts` — synthetic fixture for D-006. Covers detection, backup, artifact seeding, and no-op when no legacy specs exist.
- `src/main/ipc-handlers/bmad-handlers.ts`, `src/preload/api/bmad-api.ts`, `src/shared/constants/ipc.ts`, `src/shared/types/bmad.ts` — Phase 5 IPC/types for migration plus central-config customization support (`skillId: "config"` writes `config.toml` / `config.user.toml`).
- `src/renderer/components/bmad/BmadKanbanView.tsx` — project-open migration prompt that offers the brownfield migration before continuing.
- Settings integration in `AppSettings.tsx`, `ProjectSettingsContent.tsx`, and `SectionRouter.tsx`.
- i18n additions in `en/fr` for customization, module manager, migration, and new project settings sections.
- Dependency conflict pre-resolution: `i18next` now matches develop's `^26.0.8`; feature branch keeps `csv-parse` and `js-yaml`.
- Deleted old root-level desktop summaries: `COMPLETION_SUMMARY.md`, `VERIFICATION_SUMMARY.md`, `XSTATE_MIGRATION_SUMMARY.md`.
- Updated `README.md`, `apps/desktop/README.md`, and package descriptions toward BMad Studio architecture.

## Gate-fix pass

- `src/main/ai/bmad/migrator.ts` now writes `.auto-claude/.bmad-migration-complete.json` after a successful migration and treats that marker as authoritative on later detection. This keeps the original `.auto-claude/specs/` tree preserved while making the migration prompt and migration run one-shot.
- `src/main/ai/bmad/__tests__/migrator.test.ts` now covers the marker, post-migration detection no-op, and second-run no-op behavior.
- `src/renderer/components/bmad/BmadModuleManager.tsx` now matches BMAD installer semantics: `--modules` is treated as the exact kept set, quick update does not pass a module filter, and add/remove uses full `--action update` with the complete intended module list.
- `src/renderer/components/bmad/BmadCustomizationPanel.tsx` now resets template defaults when switching between central config and per-skill templates, so the central roster editor writes the intended description override.
- Added focused component tests:
  - `src/renderer/components/bmad/__tests__/BmadCustomizationPanel.test.tsx`
  - `src/renderer/components/bmad/__tests__/BmadModuleManager.test.tsx`
- EN/FR i18n updated for the module-manager row-update success copy.

## Tests

- `npm run typecheck` — passing.
- `npx vitest run src/main/ai/bmad/__tests__/ src/shared/types/__tests__/ src/renderer/stores/__tests__/bmad-store.test.ts src/renderer/components/bmad/__tests__/ --no-file-parallelism` — **27 files / 417 passed / 4 skipped**.
- `npm run lint` — exits 0 with the existing warning baseline.

`npm test` and `npm run test:e2e` were not run in this pass. Full `npm test` still has the pre-existing `github-error-parser.test.ts` hardcoded-date failure documented in Phases 1-4.

## Decisions logged

- D-018 — Phase 5 settings surfaces reuse existing BMad IPC instead of adding a parallel settings store.
- D-019 — Brownfield migrator uses a completion marker for one-shot behavior.
- D-020 — Module Manager treats `--modules` as the exact kept module set.

## Smoke test result

Synthetic migration fixture backs up `.auto-claude/`, writes a migrated product brief, creates story markdown, and round-trips the generated `sprint-status.yaml` through the existing reader.

## Known issues / follow-ups

- Full deletion of the legacy orchestration/source prompt tree is not complete in this pass. It is explicitly scoped as a separate Phase 5 follow-up because the old `AgentManager` still routes legacy task entrypoints through the old agent types and prompt loader.
- Manual packaged-build smoke on macOS/Windows/Linux is still outstanding.

### Legacy cleanup follow-up scope

Replace or remove the legacy task/spec/QA entrypoints first, then delete the old implementation surface in one commit. Exact files to address:

**Runtime entrypoints / type surfaces**
- `apps/desktop/src/main/agent/agent-manager.ts`
- `apps/desktop/src/main/ai/agent/worker.ts`
- `apps/desktop/src/main/ai/config/agent-configs.ts`
- `apps/desktop/src/main/ai/prompts/prompt-loader.ts`
- `apps/desktop/src/main/ai/session/runner.ts`
- `apps/desktop/src/main/ai/tools/builtin/spawn-subagent.ts`
- `apps/desktop/src/renderer/components/AgentTools.tsx`

**Legacy prompt files targeted for deletion**
- `apps/desktop/prompts/planner.md`
- `apps/desktop/prompts/coder.md`
- `apps/desktop/prompts/coder_recovery.md`
- `apps/desktop/prompts/qa_fixer.md`
- `apps/desktop/prompts/qa_reviewer.md`
- `apps/desktop/prompts/qa_orchestrator_agentic.md`
- `apps/desktop/prompts/spec_critic.md`
- `apps/desktop/prompts/spec_gatherer.md`
- `apps/desktop/prompts/spec_orchestrator_agentic.md`
- `apps/desktop/prompts/spec_quick.md`
- `apps/desktop/prompts/spec_researcher.md`
- `apps/desktop/prompts/spec_writer.md`
- `apps/desktop/prompts/complexity_assessor.md`
- `apps/desktop/prompts/followup_planner.md`
- `apps/desktop/prompts/validation_fixer.md`

**Legacy orchestration/spec files targeted for deletion**
- `apps/desktop/src/main/ai/orchestration/build-orchestrator.ts`
- `apps/desktop/src/main/ai/orchestration/spec-orchestrator.ts`
- `apps/desktop/src/main/ai/orchestration/qa-loop.ts`
- `apps/desktop/src/main/ai/orchestration/recovery-manager.ts`
- `apps/desktop/src/main/ai/orchestration/subtask-iterator.ts`
- `apps/desktop/src/main/ai/orchestration/pause-handler.ts`
- `apps/desktop/src/main/ai/orchestration/parallel-executor.ts`
- `apps/desktop/src/main/ai/orchestration/qa-reports.ts`
- `apps/desktop/src/main/ai/orchestration/subagent-executor.ts`
- `apps/desktop/src/main/ai/orchestration/__tests__/parallel-executor.test.ts`
- `apps/desktop/src/main/ai/orchestration/__tests__/qa-loop.test.ts`
- `apps/desktop/src/main/ai/orchestration/__tests__/qa-reports.test.ts`
- `apps/desktop/src/main/ai/orchestration/__tests__/recovery-manager.test.ts`
- `apps/desktop/src/main/ai/orchestration/__tests__/subagent-executor.test.ts`
- `apps/desktop/src/main/ai/orchestration/__tests__/subtask-iterator-restamp.test.ts`
- `apps/desktop/src/main/ai/spec/conversation-compactor.ts`
- `apps/desktop/src/main/ai/spec/spec-validator.ts`

## Next phase blockers

Stop here for review. Do not start Phase 6 until this gate-fix pass and the scoped legacy-orchestration cleanup follow-up are approved.
