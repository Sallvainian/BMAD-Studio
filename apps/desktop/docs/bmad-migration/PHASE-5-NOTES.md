## Phase 5 — Customization UI + Module Manager + Migration + Cleanup

**Status:** ⚠️ Partial

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

## Tests

- `npm run typecheck` — passing.
- `npx vitest run src/main/ai/bmad/__tests__/ src/shared/types/__tests__/ src/renderer/stores/__tests__/bmad-store.test.ts src/renderer/components/bmad/__tests__/ --no-file-parallelism` — 25 files / 408 passed / 4 skipped.
- `npm run lint` — exits 0 with the existing warning baseline.

`npm test` and `npm run test:e2e` were not run in this pass. Full `npm test` still has the pre-existing `github-error-parser.test.ts` hardcoded-date failure documented in Phases 1-4.

## Decisions logged

- D-018 — Phase 5 settings surfaces reuse existing BMad IPC instead of adding a parallel settings store.

## Smoke test result

Synthetic migration fixture backs up `.auto-claude/`, writes a migrated product brief, creates story markdown, and round-trips the generated `sprint-status.yaml` through the existing reader.

## Known issues / follow-ups

- Full deletion of the legacy orchestration/source prompt tree is not complete in this partial pass. The old `AgentManager` still imports `BuildOrchestrator`, `QALoop`, `SpecOrchestrator`, and `SubagentExecutorImpl`; removing those files safely requires replacing the legacy task entrypoints with BMAD-first routes.
- Manual packaged-build smoke on macOS/Windows/Linux is still outstanding.

## Next phase blockers

Stop here for review. Do not start Phase 6 until the Phase 5 partial scope and legacy-orchestration cleanup plan are approved.
