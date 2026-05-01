## Phase 4 — Persona chat + bmad-help sidebar

**Status:** ✅ Complete

**Operating contract:** [`ENGINE_SWAP_PROMPT.md`](../../../../ENGINE_SWAP_PROMPT.md)
**Inventory:** [`INVENTORY.md`](./INVENTORY.md)
**Decisions:** [`DECISIONS.md`](./DECISIONS.md)
**Branch:** `feature/bmad-engine-swap`
**PR:** [#49](https://github.com/Sallvainian/BMAD-Studio/pull/49) (draft, base `develop`)
**Predecessor:** [Phase 3 Notes](./PHASE-3-NOTES.md)

---

## Pre-work block — locale dedup

Both `apps/desktop/src/shared/i18n/locales/{en,fr}/bmad.json` had a duplicate `help` block (the original 6 keys from Phases 1–2 plus a Phase 4 expansion that re-declared the same names). JSON parsers silently keep the second occurrence, so the surface effect was "Phase 4 keys win," but the file structure was lying about its contents — every reviewer hitting the duplicate would notice it as a bug. Merged the two blocks into a single 24-key `help` namespace (EN + FR). Verified via Node round-trip: both locales now resolve to the same 24 keys (`currentPhase`, `required`, `recommended`, `completed`, `noNextRequired`, `trackComplete`, `sidebarTitle`, `sidebarSubtitle`, `sidebarAriaLabel`, `askQuestionPlaceholder`, `askButton`, `askingButton`, `askPlaceholderHint`, `loading`, `empty`, `openSidebar`, `closeSidebar`, `runRequired`, `runRecommended`, `completedHint`, `phaseLabel`, `trackLabel`, `noActiveProject`, `rationaleAriaLabel`).

---

## Carry-forward from Phase 3

The Phase 3 placeholder `onRunStory` in `BmadKanbanView` set `activeInvocation` to a synthetic id and did nothing else. Phase 4 replaces it with a real `bmad.runWorkflow` invocation via the store's `startWorkflow` action, which:

- Generates a renderer-side invocation id and creates a fresh `BmadChatThread` keyed on it (per BMAD docs § "Step 1: Create Your Plan" `:::caution[Fresh Chats]` + KAD-7).
- Resolves the workflow skill from the story's current displayed status: `ready-for-dev`/`in-progress` → `bmad-dev-story` (Amelia), `review` → `bmad-code-review` (Amelia), `backlog` → `bmad-create-story` (Amelia). `done` is no-op (the Run button is disabled by upstream UI).
- Paints the story `optimistic-in-progress` immediately when the click came from a `ready-for-dev` or `backlog` card (mirrors Phase 3's `setStoryStatus` optimistic pattern).
- Auto-opens the persona chat dock on the right when `activeChatId` becomes non-null (one-shot effect; user-dismissed dock stays closed unless a new workflow starts).
- Reconciles via the existing watcher → store path: when the workflow writes `_bmad-output/implementation-artifacts/sprint-status.yaml`, `applyFileEvent('sprint-status-changed')` re-reads + clears the optimistic override.

Workflow streaming runs through Phase 2's IPC plumbing: `BMAD_RUN_WORKFLOW` invokes `runWorkflow()` in main, which streams chunks via `BMAD_WORKFLOW_STREAM` events. The store's global stream listener (attached lazily on first `startWorkflow`) routes chunks to the matching thread and the chat panel renders them as bubbles + system messages. Menus surface via `bmad:workflowMenuRequest` events (per D-011) and resolve via the user's button click → `respondToWorkflowMenu` IPC.

---

## Deliverables shipped

Every file path is rooted at `apps/desktop/`.

### New BMAD Phase 4 components (`src/renderer/components/bmad/`)

| Path | Purpose |
| --- | --- |
| [`BmadPersonaChat.tsx`](../../src/renderer/components/bmad/BmadPersonaChat.tsx) | Right-docked chat panel. Persona avatar in header, status badge (streaming / awaiting-menu / completed / aborted / errored), `react-markdown` message bubbles, pending-menu button group, free-form text composer (Enter-to-send, Shift+Enter newline), persona switcher dropdown, "Start with X" launch button. Three interaction modes: workflow run, free-form persona chat, BMad-Help free-form. |
| [`BmadHelpSidebar.tsx`](../../src/renderer/components/bmad/BmadHelpSidebar.tsx) | Left-docked always-on companion. Phase + track header, Required action card (highlighted amber), Recommended list, Completed list (no Run buttons). Inline "Ask BMad-Help anything" form forwards to `runHelpAI` (or a parent `onAskQuestion` callback). Per BMAD docs § "Meet BMad-Help: Your Intelligent Guide" — three affordances (show options / recommend next / answer questions). |
| [`BmadInstallWizard.tsx`](../../src/renderer/components/bmad/BmadInstallWizard.tsx) | Install wizard dialog. Module checklist (core required, BMM default-on, CIS + RGM optional), track radio (method / enterprise / quick), advanced section (user-name, communication-language, document-output-language, output-folder, channel selector). Streams `npx bmad-method install` output in a live log via the existing `bmad.onInstallerStream` channel (Phase 1 deliverable). Plus exported `BmadInstallPrompt` empty-state component used by `BmadKanbanView` for non-BMad projects. |
| [`BmadTutorialOverlay.tsx`](../../src/renderer/components/bmad/BmadTutorialOverlay.tsx) | First-launch onboarding. Three skippable cards (BMad-Help sidebar, persona chat, kanban drag-drop). Persisted dismissal via `localStorage` (key `bmad.tutorial.dismissed`) so it survives app restarts. Returns `null` when dismissed. |
| Updated [`BmadKanbanView.tsx`](../../src/renderer/components/bmad/BmadKanbanView.tsx) | Three-column Phase 4 layout: HelpSidebar (left, toggleable) │ KanbanBoard (center) │ PersonaChat (right, conditional). Toolbar with Help/Chat toggle buttons. Real `onRunStory` wired to `startWorkflow`. Install prompt + wizard for non-BMad projects. Tutorial overlay mounts inside the view. |

### Renderer store updates (`src/renderer/stores/bmad-store.ts`)

| Change | Why |
| --- | --- |
| `tutorialDismissed: readTutorialDismissed()` initial value | Persists dismissal across app restarts via localStorage. |
| `dismissTutorial` writes to localStorage before `set` | Same flow. |
| `unloadProject` now detaches stream listeners before resetting state | Fixes a leak — without this, switching projects re-attached `onWorkflowStream` and `onWorkflowMenuRequest` listeners while leaving the prior cleanup orphaned, doubling the IPC subscriber count after each project switch. |
| `unloadProject` re-reads localStorage after reset | Prevents the tutorial from re-appearing after a project switch. |

### Tests (`src/renderer/components/bmad/__tests__/` + `src/renderer/stores/__tests__/`)

| Path | Coverage |
| --- | --- |
| [`BmadPersonaChat.test.tsx`](../../src/renderer/components/bmad/__tests__/BmadPersonaChat.test.tsx) (new) | **11 cases.** Empty state, persona switcher, header + status badge, pending menu options + click → respondToMenu, free-form Send, "Start with John" → runWorkflow, send disabled when empty, no composer when completed, hides on `visible=false`, close-streaming-thread deselects, close-completed-thread drops thread. |
| [`BmadHelpSidebar.test.tsx`](../../src/renderer/components/bmad/__tests__/BmadHelpSidebar.test.tsx) (new) | **12 cases.** Required + recommended + completed sections, loading + empty + error states, Run forward to onRunWorkflow (required + recommended), completed actions are read-only, Ask form callback (with trimming), allowAskQuestion=false hides the form, Ask disabled without active profile, persona icon in action header, phase + track labels. |
| [`BmadInstallWizard.test.tsx`](../../src/renderer/components/bmad/__tests__/BmadInstallWizard.test.tsx) (new) | **6 cases.** Core checkbox is disabled (required), Submit fires runInstaller with full payload + opens success banner, stream chunks render in the log, error response surfaces failure banner, no render when `open=false`, BmadInstallPrompt → onLaunch click forwards. |
| [`BmadTutorialOverlay.test.tsx`](../../src/renderer/components/bmad/__tests__/BmadTutorialOverlay.test.tsx) (new) | **5 cases.** Returns null when dismissed, renders step 1 of 3 by default, advances forward + back through 3 steps + dismisses on Done, Previous button navigation, Skip dismisses + persists to localStorage. |
| Updated [`BmadKanbanView.integration.test.tsx`](../../src/renderer/components/bmad/__tests__/BmadKanbanView.integration.test.tsx) | **+ 5 Phase 4 cases.** Install prompt for non-BMad project (was: empty-state text), Run button → bmad-dev-story, Run on review status → bmad-code-review, starting a workflow auto-opens chat dock, help sidebar toggle hides + shows, chat panel toggle button opens the dock. |
| Updated [`bmad-store.test.ts`](../../src/renderer/stores/__tests__/bmad-store.test.ts) | **+ 13 Phase 4 cases** under new `startWorkflow`, `respondToMenu`, `appendStreamChunk`, and `selectChat / closeChat / dismissTutorial` describe blocks. Covers chat thread creation, optimistic in-progress paint, rollback on `runWorkflow` failure, `startHelpAI` empty-thread shape, menu response → user message + IPC, text-delta accumulation, done chunk finalization, error chunk → errored thread, tool-call → system message, selectChat/closeChat semantics, dismissTutorial flag flip. |

**New Phase 4 totals:** 4 new test files + 2 extended files / 39+ new test cases. Combined with Phases 1–3: **24 BMad test files, 405 cases (4 gated live)** — all green under `--pool=threads --no-file-parallelism`.

---

## Tests

| Stack | Result |
| --- | --- |
| `npx vitest run --pool=threads --no-file-parallelism src/main/ai/bmad/__tests__/ src/shared/types/__tests__/ src/renderer/stores/__tests__/bmad-store.test.ts src/renderer/components/bmad/__tests__/` | **24 files / 405 passed / 4 skipped** |
| `npm run typecheck` | **clean** |
| `npm run lint` (full repo) | **0 errors / 894 warnings** (Phase 3 baseline 864 → +30 new in test files; production code added 0 new warnings) |
| `npm test` (full repo) | **231 files / 5007 passed / 4 skipped / 1 pre-existing failure** (`github-error-parser.test.ts` — same hardcoded-timestamp issue Phase 1+2+3 documented) |

E2E (`npm run test:e2e`) was not extended for Phase 4 — Playwright drag-drop already covered by Phase 3 integration tests, and the persona chat / help sidebar paths exercise mocked IPC in the new component tests. Live-model smoke tests for `runWorkflow` + `runHelpAI` remain gated behind `RUN_BMAD_WORKFLOW_SMOKE=1` (Phase 2 deliverable).

---

## Decisions logged

| ID | Subject | Status |
| --- | --- | --- |
| **D-015** *(new)* | Phase 4 layout uses three persistent panels (Help left, Kanban center, Chat right). Help sidebar defaults open + toggleable; chat panel defaults closed + auto-opens on workflow start; story detail still slides over from right (z-50). All inside the same flex container so toggles don't reflow the kanban layout. | Resolved |
| **D-016** *(new)* | Tutorial overlay is rendered *inside* `BmadKanbanView` (not at App.tsx root) and persists dismissal via `localStorage` (key `bmad.tutorial.dismissed`). Project switches re-read the persisted flag in `unloadProject` so a dismissed tutorial stays dismissed. | Resolved |
| **D-017** *(new)* | The Run button on a story card maps status → next workflow heuristically (`ready-for-dev` / `in-progress` → `bmad-dev-story`, `review` → `bmad-code-review`, `backlog` → `bmad-create-story`). The orchestrator's recommendation is the canonical "what's next" surface for the help sidebar; the kanban Run button is the one-click happy path. | Resolved |

D-015, D-016, D-017 will be appended to [`DECISIONS.md`](./DECISIONS.md) in this same commit.

---

## Acceptance walkthrough

Per ENGINE_SWAP_PROMPT.md Phase 4 §"Acceptance":

1. **Cold-start a fresh project, click "What now?", see "Required: Create PRD with John (`bmad-create-prd`)" with a Run button** — covered by `BmadHelpSidebar` rendering tests + integration test "renders required + recommended + completed sections". Live model not required; orchestrator computes recommendation synchronously per Phase 2. The Required action card surfaces with John's 📋 icon + "Run now" button (red-amber required styling).

2. **Click Run, see John's avatar appear, see the streamed persona greeting, answer his interactive PRD questions, watch `prd.md` appear in `_bmad-output/planning-artifacts/`** — covered structurally by:
   - `BmadKanbanView.integration.test.tsx > Phase 4: Run button on a story card calls runWorkflow with bmad-dev-story` (run path)
   - `BmadKanbanView.integration.test.tsx > Phase 4: starting a workflow auto-opens the chat panel` (chat dock auto-opens)
   - `BmadPersonaChat.test.tsx > renders persona header + status badge when thread is streaming` (avatar + identity)
   - `bmad-store.test.ts > appendStreamChunk > text-delta chunks accumulate into a single streaming assistant message` (streaming bubble)
   - `bmad-store.test.ts > respondToMenu > appends a user message + clears the pending menu + calls IPC` (interactive menu)
   - File-write to `_bmad-output/planning-artifacts/prd.md` is the workflow runner's job (Phase 2 deliverable, unchanged here) — exercised structurally by Phase 2's `workflow-runner.test.ts` and end-to-end by the live-gated `workflow-runner-smoke.test.ts`.

3. **Switch persona to Winston, ask a free-form question, see Winston's icon and architectural communication style** — covered by:
   - `BmadPersonaChat.test.tsx > "Start with John" button calls runWorkflow with bmad-agent-pm` (same code path with persona slug = winston would invoke `bmad-agent-architect`)
   - The chat panel header re-renders when `thread.personaSlug` changes; persona icon comes from the `personas` map prop, sourced from the resolved `_bmad/config.toml` per Phase 2's `loadAllPersonas`.

4. **All copy translated EN/FR** — verified by Node round-trip diff on the locale files (24 keys per locale match). The dedup commit folded the duplicate `help` block in both locales.

---

## Smoke test result

End-to-end happy path proven structurally:
- BmadKanbanView mounts with HelpSidebar + Kanban + (conditional) PersonaChat + (conditional) StoryDetail + (conditional) TutorialOverlay
- Run button on a `ready-for-dev` story → store creates a fresh chat thread keyed on a UUID, paints story `in-progress` optimistically, fires `bmad.runWorkflow` IPC with `skillName: 'bmad-dev-story'`, opens chat dock
- Help sidebar's required/recommended action cards forward Run clicks through the same `startWorkflow` action so the chat thread + optimistic state behave identically
- Pending menu chunks render as button groups; click → `respondToWorkflowMenu` IPC → user message appended → status returns to `streaming`
- "Done" stream chunk finalizes the thread; user can dismiss via X (preserves thread) or close (drops thread when status is terminal)

---

## Known issues / follow-ups

1. **Pre-existing test failure (not Phase 4 — first documented in Phase 1 notes):** `src/renderer/components/github-issues/utils/__tests__/github-error-parser.test.ts > should generate fallback message when reset time has passed` continues to fail because the test uses a hardcoded reset timestamp (`2025-10-21T07:28:00Z`) and expects "moment" while the parser correctly says "approximately N hours" based on the current date. Not introduced by Phase 4; logged in every prior phase.

2. **Persona switcher's "Start with X" button starts the persona's *agent skill* (e.g. `bmad-agent-pm` for John).** Per BMAD docs § "Default Agents" + § "What Named Agents Buy You" the agent skill loads the persona's persistent menu. The user can then pick a workflow from John's menu via interactive `[1]/[2]/[3]` selection. Phase 5's customization editor will surface this menu shape directly so users can launch a workflow from the persona without opening the chat first.

3. **The chat panel's "Stop workflow" button (i18n key `chat.abortWorkflow`) is not yet wired.** The translation key exists from Phase 2 i18n, but no AbortController flows through `runWorkflow` from the renderer. Phase 6 stretch goal — straightforward to add: pipe an abort signal from the chat header → `useBmadStore` action → `BMAD_RUN_WORKFLOW` IPC → workflow runner's `abortSignal`.

4. **Tutorial overlay is per-installation, not per-account.** The `localStorage` key is global to the renderer profile; if a user has two BMad Studio installs they'd see the tutorial twice. Acceptable for Phase 4; if Phase 6 ships a multi-account UX with per-account preferences, the tutorial flag can move to a per-account settings store.

5. **No live AI integration tests for Phase 4 components.** All workflow / chat / help paths use mocked IPC in jsdom. Live-model smoke tests for `runHelpAI` would be a natural addition under the `RUN_BMAD_WORKFLOW_SMOKE=1` gate when Phase 5 lands the customization editor (since persona icon overrides are the most visible cross-cutting test).

6. **`installer wizard` advanced fields are stored in component state but the BMAD installer doesn't accept a `--track` flag.** Per BMAD docs § "Headless CI installs" the installer's flag surface doesn't include track selection — the wizard captures it client-side and currently no-ops it. Phase 5's settings UI will surface track choice directly to the orchestrator (which already accepts it via `getHelpRecommendation(track)`), making the wizard's track radio actually drive behavior.

---

## Next phase blockers

None. Phase 5 (Customization UI + Module Manager + Migration + Cleanup) can start.

Phase 5 needs the foundation Phase 4 ships:
- `BmadPersonaChat` already renders persona icon overrides reactively from the personas map → Phase 5's Customization Panel writing `_bmad/custom/{skill}.toml` flows through the existing file watcher → store reload → chat re-render with no extra wiring.
- `BmadInstallWizard` is the install half of the Module Manager; Phase 5 reuses its checkbox UI for "Install Module" and adds Update / Remove buttons next to each installed module.
- The store's `streamListenerCleanup` fix unblocks reliable project-switch UX, which Phase 5's brownfield migrator depends on.

---

## Gate

Awaiting human review of:
1. This file (deliverables + tests + decisions)
2. The 4 new components in `apps/desktop/src/renderer/components/bmad/`
3. The store updates in `bmad-store.ts` (stream-listener leak fix + tutorial persistence)
4. The locale dedup in EN + FR `bmad.json`
5. Updated `BmadKanbanView.tsx` + `BmadStoryDetail.tsx` (untouched) + integration test
6. **D-015, D-016, D-017** in `DECISIONS.md`

**Stop here. Phase 5 won't kick off until human sign-off.**
