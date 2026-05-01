# Phase 1 — Foundation: installer integration + manifest/skill discovery

**Status:** ✅ Complete

**Operating contract:** [`ENGINE_SWAP_PROMPT.md`](../../../../ENGINE_SWAP_PROMPT.md)
**Inventory:** [`INVENTORY.md`](./INVENTORY.md)
**Decisions:** [`DECISIONS.md`](./DECISIONS.md)
**Branch:** `feature/bmad-engine-swap`
**Tracking issue:** [#48](https://github.com/Sallvainian/BMAD-Studio/issues/48)

---

## Deliverables shipped

Every file path is rooted at `apps/desktop/`.

### New BMAD subsystem (`src/main/ai/bmad/`)

| Path | Purpose |
| --- | --- |
| [`customization-resolver.ts`](../../src/main/ai/bmad/customization-resolver.ts) | TS port of `_bmad/scripts/resolve_customization.py`. Three-layer TOML merge with the four shape-driven rules (scalar override / table deep-merge / keyed-array replace / plain-array append) per BMAD docs § "Merge Rules (by shape, not by field name)". |
| [`config-resolver.ts`](../../src/main/ai/bmad/config-resolver.ts) | TS port of `_bmad/scripts/resolve_config.py`. Four-layer central config merge per BMAD docs § "Central Configuration". |
| [`manifest-loader.ts`](../../src/main/ai/bmad/manifest-loader.ts) | Parses + Zod-validates `manifest.yaml`, `skill-manifest.csv`, `bmad-help.csv`, `files-manifest.csv`. Surfaces `BmadManifestBundle` for aggregate consumers. |
| [`module-registry.ts`](../../src/main/ai/bmad/module-registry.ts) | `listInstalledModules`, `listAllWorkflows`, `getWorkflowsForModule`, `getPhaseGraph`, `getRequiredWorkflowsForPhase`. Cache-free; reads manifests on every call (KAD-3 + filesystem-as-contract per KAD-2). |
| [`skill-registry.ts`](../../src/main/ai/bmad/skill-registry.ts) | Loads `SKILL.md` (frontmatter + body), enumerates `steps/` `steps-c/` `steps-e/` `steps-v/`, parses `customize.toml`, resolves three-layer customization. In-memory cache; invalidated by file watcher events. |
| [`file-watcher.ts`](../../src/main/ai/bmad/file-watcher.ts) | `chokidar` wrapper over `_bmad/` and `_bmad-output/`. Debounced 250ms (per prompt). Emits `manifest-changed`, `skill-changed`, `customization-changed`, `sprint-status-changed`, `story-file-changed`, `epic-file-changed`, `config-changed`, `project-context-changed`, `planning-artifact-changed`, `implementation-artifact-changed`. Filters atomic-write temp files (`.{name}.tmp.{hex}`). |
| [`installer.ts`](../../src/main/ai/bmad/installer.ts) | Spawns `npx bmad-method install` with the full Headless-CI flag surface from BMAD docs (`--yes`, `--directory`, `--modules`, `--tools`, `--action`, `--custom-source`, `--channel`, `--all-stable`, `--all-next`, `--next=`, `--pin`, `--set`, `--user-name`, `--communication-language`, `--document-output-language`, `--output-folder`). Streams stdout/stderr, parses progress prefixes (`◆`, `◇`, `◒`, `●`), strips ANSI, supports `AbortSignal`. Plus `listInstallerOptions` for `--list-options`. Module / tag / set-key allowlists prevent shell-injection-shaped payloads even though `spawn` runs with `shell: false` on Unix. |

### IPC bridge

| Path | Purpose |
| --- | --- |
| [`src/main/ipc-handlers/bmad-handlers.ts`](../../src/main/ipc-handlers/bmad-handlers.ts) | Wires every `IPC_CHANNELS.BMAD_*` channel. Validates inputs with Zod; returns the `BmadIpcResult<T>` envelope (`{ success: true, data } \| { success: false, error: { code, message, details } }`) per D-007. Drops a Sentry breadcrumb around installer invocations per `<engineering_standards>` "Error handling". Hosts the dev-mode `dumpSkills` debug command. |
| [`src/preload/api/bmad-api.ts`](../../src/preload/api/bmad-api.ts) | `electronAPI.bmad.*` surface. Thin `ipcRenderer.invoke` wrappers; event subscriptions return `IpcListenerCleanup` functions. |
| Updated: [`src/shared/constants/ipc.ts`](../../src/shared/constants/ipc.ts) | New channel constants (`BMAD_DETECT_PROJECT`, `BMAD_LIST_MODULES`, `BMAD_LIST_WORKFLOWS`, `BMAD_GET_PHASE_GRAPH`, `BMAD_LIST_SKILLS`, `BMAD_LOAD_SKILL`, `BMAD_READ_CUSTOMIZATION`, `BMAD_WRITE_CUSTOMIZATION`, `BMAD_READ_SPRINT_STATUS`, `BMAD_READ_STORY_FILE`, `BMAD_RUN_INSTALLER`, `BMAD_LIST_INSTALLER_OPTIONS`, `BMAD_WATCHER_START`, `BMAD_WATCHER_STOP`, `BMAD_FILE_EVENT`, `BMAD_INSTALLER_STREAM`, `BMAD_DEBUG_DUMP_SKILLS`). |
| Updated: [`src/shared/types/ipc.ts`](../../src/shared/types/ipc.ts) | Extended `ElectronAPI` with `bmad: BmadAPI` namespace. |
| Updated: [`src/preload/api/index.ts`](../../src/preload/api/index.ts) | Wired `createBmadAPI()` into the composed `ElectronAPI`. |
| Updated: [`src/main/ipc-handlers/index.ts`](../../src/main/ipc-handlers/index.ts) | Calls `registerBmadHandlers({ getMainWindow })` from `setupIpcHandlers`. |
| Updated: [`src/renderer/lib/browser-mock.ts`](../../src/renderer/lib/browser-mock.ts) | Browser stubs for `bmad.*` so renderer code that conditionally enables BMad UI degrades gracefully outside Electron. |

### Shared types + i18n

| Path | Purpose |
| --- | --- |
| [`src/shared/types/bmad.ts`](../../src/shared/types/bmad.ts) | Canonical type + Zod schema source for the BMad subsystem. Includes `BmadManifest`, `BmadModule`, `BmadSkill`, `BmadSkillManifestEntry`, `BmadHelpRow`, `BmadPersona`, `BmadPhase`, `BmadPhaseGraph`, `BmadStoryStatus`, `BmadCustomizationOverride`, `BmadFileEvent`, `BmadInstallerOptions`, `BmadInstallerResult`, `BmadIpcResult<T>`, plus the closed `BMAD_ERROR_CODES` enum. Framework-free (no Electron/Node imports) so renderer can validate cached payloads. |
| Updated: [`src/shared/types/index.ts`](../../src/shared/types/index.ts) | Re-exports `bmad.ts`. |
| [`src/shared/i18n/locales/en/bmad.json`](../../src/shared/i18n/locales/en/bmad.json) + `fr/bmad.json` | Phase 1 strings — error messages keyed by `BmadErrorCode` and the dev `dumpSkills` chrome. Both EN and FR translated. |
| Updated: [`src/shared/i18n/index.ts`](../../src/shared/i18n/index.ts) | Registered the `bmad` namespace. |

### Tests (`src/main/ai/bmad/__tests__/`)

| Path | Coverage |
| --- | --- |
| [`customization-resolver.test.ts`](../../src/main/ai/bmad/__tests__/customization-resolver.test.ts) | **54 cases.** All four shape-driven merge rules (scalar / table / keyed array / append fallback). `detectKeyedMergeField`, `mergeByKey`, `mergeArrays`, `extractKey`, `isPlainObject`, `loadToml` (file-loading boundary). Three-layer integration: defaults → team → user, including the "rebrand John's icon to 🏥" scenario from BMAD docs § "Worked Examples". |
| [`config-resolver.test.ts`](../../src/main/ai/bmad/__tests__/config-resolver.test.ts) | **9 cases.** Four-layer priority (`config.toml` → `config.user.toml` → `custom/config.toml` → `custom/config.user.toml`). Rebrand-an-agent recipe + add-a-fictional-agent recipe per BMAD docs § "Worked Examples". |
| [`manifest-loader.test.ts`](../../src/main/ai/bmad/__tests__/manifest-loader.test.ts) | **22 cases.** `loadManifest` / `loadSkillManifest` / `loadBmadHelp` / `loadFilesManifest` / `loadAllManifests` happy + sad paths. CSV dependency parsing including `bmad-create-story:validate` action-suffix syntax. |
| [`file-watcher.test.ts`](../../src/main/ai/bmad/__tests__/file-watcher.test.ts) | **30 cases** (21 unit + 9 integration). All 21 path-classification cases (every `BmadFileEventType`). Atomic-write temp-file ignore. End-to-end chokidar emission for `customization-changed`, `manifest-changed`, `sprint-status-changed`, plus debounce coalescing and `close()` behavior. |
| [`installer.test.ts`](../../src/main/ai/bmad/__tests__/installer.test.ts) | **29 cases.** Validation rejects bad inputs. CLI arg builder produces every flag from BMAD docs § "Headless CI installs". ANSI stripper, progress detector. **Live integration test** (`runInstaller` against a real temp dir, gated by `RUN_BMAD_INSTALL_TEST=1` to keep CI fast — verified locally producing `_bmad/_config/manifest.yaml` with `version: 6.6.0`). |

**Totals:** 5 test files / 144 test cases (143 + 1 gated live install). Skipped count when `RUN_BMAD_INSTALL_TEST` is unset: 1.

---

## Tests

| Stack | Result |
| --- | --- |
| `npx vitest run src/main/ai/bmad/__tests__/` | **5 files / 143 passed / 1 skipped (live install)** |
| `RUN_BMAD_INSTALL_TEST=1 npx vitest run src/main/ai/bmad/__tests__/` | **5 files / 144 passed (live install green)** |
| `npm run typecheck` | **clean** |
| `npm run lint` (full repo) | **0 errors** (842 pre-existing warnings; my new files contributed 0 after fixes) |
| `npm test` (full repo) | **211 files / 4745 passed / 1 skipped / 1 pre-existing failure** (see Known issues below) |

E2E (`npm run test:e2e`) was not run for Phase 1 — the prompt's `<acceptance_walkthrough>` E2E checks all target Phase 3+ UI features (Kanban drag-drop, persona chat, customization edit roundtrip). No new Playwright tests were authored in Phase 1 because there's no UI yet.

---

## Decisions logged

| ID | Subject | Status |
| --- | --- | --- |
| **D-007** *(new)* | IPC envelope shape: keep `success`/`data` verb (existing Aperant convention) but elevate `error` from `string` to structured `{ code, message, details }` for BMAD handlers. The prompt mandated `{ ok, error: { code } }`; reconciled to the codebase's existing `success` verb so we don't fork the IPC convention. New BMAD handlers use `BmadIpcResult<T>`; existing handlers keep `IPCResult<T>`. | Resolved |

D-007 will be appended to [`DECISIONS.md`](./DECISIONS.md) on the next push.

---

## Acceptance walkthrough

Per ENGINE_SWAP_PROMPT.md Phase 1 §"Acceptance":

1. **`npm test -- bmad/customization-resolver` green.** ✅ 54/54 tests pass.
2. **A debug command in dev mode logs every installed skill with resolved persona block.** ✅ `BMAD_DEBUG_DUMP_SKILLS` IPC channel calls `dumpSkills(projectRoot)` which iterates the skill registry, looks up the persona slug for `bmad-agent-*` skills, and logs:
   ```
   [bmad.debug] dumpSkills (BMAD-Install-Files, 2 modules, 42 skills)
       AGENT  bmad-agent-pm                            📋  (john)
       AGENT  bmad-agent-architect                     🏗️  (winston)
        TASK  bmad-help                                    [0 steps, 0 customize keys]
    WORKFLOW  bmad-create-prd                              [3 steps, 1 customize keys]
   ...
   ```
   Trigger from the dev DevTools console:
   ```js
   await window.electronAPI.bmad.debugDumpSkills('/path/to/bmad/project')
   ```
3. **File watcher fires correctly when a skill's customize.toml changes.** ✅ Integration test in `file-watcher.test.ts` writes `_bmad/custom/bmad-agent-pm.toml` and asserts a `customization-changed` event arrives within 12 seconds.
4. **The installer can be invoked from a TS unit test against a temp dir and produces a valid `_bmad/`.** ✅ Live integration test in `installer.test.ts` runs `runInstaller` against `mkdtempSync` and asserts (a) `bmadDirCreated: true`, (b) `skillsConfigured > 0`, (c) `_bmad/_config/manifest.yaml` exists, (d) the `completed` progress event was emitted. Gated behind `RUN_BMAD_INSTALL_TEST=1` so vanilla `npm test` doesn't pull from npm; passed locally producing v6.6.0.

---

## Smoke test result

Ran the live install on `/tmp/bmad-fresh-install` via the Vitest live integration. `_bmad/_config/manifest.yaml` reports `version: 6.6.0` with two modules (`core`, `bmm`) and `cursor` as the configured IDE. 42 skills configured into `.agents/skills/`. End-to-end happy path proven.

---

## Known issues / follow-ups

1. **Pre-existing test failure (not Phase 1):** `src/renderer/components/github-issues/utils/__tests__/github-error-parser.test.ts > should generate fallback message when reset time has passed` fails on `develop` HEAD too — the test uses a hardcoded reset timestamp (`2025-10-21T07:28:00Z`) and expects the parser to say "moment" when the reset is in the past, but the parser produces "approximately N hours" because of how it computes the relative offset. Not introduced by Phase 1; not a Phase 1 deliverable to fix. Logged here so reviewers don't think the engine swap caused it.

2. **`appLog` in `bmad-handlers.ts` ipcMain `console.warn` log line:** the central `setupIpcHandlers` function ends with `console.warn('[IPC] All handler modules registered successfully')` (pre-existing). The prompt says no `console.log` in production paths but this line is pre-existing in `index.ts`. Unchanged in Phase 1.

3. **i18n keys for the persona chat / kanban / install wizard etc. are not yet authored.** Phase 1 only adds the error-code map + debug strings under `bmad/errors.*` and `bmad/debug.*`. The renderer-side UI components live in Phases 3–5 and will add their own keys then.

4. **Quick Flow track wiring — deferred.** Per D-005, `getRequiredWorkflowsForPhase(track: 'quick')` throws today. The signature accepts `BmadTrack` so Phase 6 only adds behavior, not call-site changes.

---

## Next phase blockers

None. Phase 2 can start.

Phase 2 needs the foundation provided here: `customization-resolver` and `manifest-loader` for the variable-substitution engine; `skill-registry` for `step-loader.ts` to enforce the just-in-time rule against an already-parsed `BmadSkill`; `module-registry.getPhaseGraph` for the orchestrator's `phase-progressed` events; the `bmad/orchestrator.ts` will sit on top of these primitives without rewriting them.
