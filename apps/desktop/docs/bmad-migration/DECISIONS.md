# BMad Studio Engine Swap — Decisions Log

> **Status:** Phase 0 deliverable. Living document — every architectural decision that goes beyond `ENGINE_SWAP_PROMPT.md` lands here, numbered, dated, with rationale.
>
> **Operating contract:** [`ENGINE_SWAP_PROMPT.md`](../../../../ENGINE_SWAP_PROMPT.md)
> **Inventory:** [`INVENTORY.md`](./INVENTORY.md)
> **Branch:** `feature/bmad-engine-swap`

---

## How to use this file

Every claim about BMAD behavior cites the live docs at `https://docs.bmad-method.org/llms-full.txt` per `<docs_protocol>` Rule 2. Two kinds of entries live here:

1. **Key Architectural Decisions (KAD-1 through KAD-10)** — locked in by `ENGINE_SWAP_PROMPT.md`. These are the contract. Do not relitigate without raising a written counter-proposal as a `D-NN` entry below.
2. **Phase decisions (D-001, D-002, …)** — anything not pre-decided by the prompt. Open with `Status: Open` (awaiting reviewer), move to `Status: Resolved (decision)` when accepted.

Entry shape:

```
### D-NN: <one-line title>

**Date:** YYYY-MM-DD
**Phase:** N
**Status:** Open | Resolved | Superseded by D-NN
**Author:** Sallvain (or future agent's handle)

**Context:**
<one or two paragraphs describing what the question is and why it surfaces now>

**Options considered:**
1. <option A — what it does, what it costs>
2. <option B — same>
3. <option C — same>

**Decision:**
<the chosen path; cite a doc section if it leans on BMAD spec>

**Rationale:**
<why this option over the others>

**Consequences:**
<what changes downstream>
```

---

## Key Architectural Decisions

These are quoted verbatim from `ENGINE_SWAP_PROMPT.md` — the contract, not open for re-debate without a written counter-proposal entry below.

### KAD-1: BMAD is installed, not bundled

New projects run `npx bmad-method install --yes --modules <selected> --tools cursor --directory <project>` (or equivalent). Existing projects are detected by the presence of `_bmad/_config/manifest.yaml`. Updates run `npx bmad-method install --action update`. We **never** copy skill folders from a vendored snapshot — that breaks BMAD's update model and freezes us to one release.

**Cite:** BMAD docs § "Installation" + § "Updating an existing install".

### KAD-2: Filesystem is the contract

BMAD writes to `_bmad/`, `_bmad-output/planning-artifacts/`, `_bmad-output/implementation-artifacts/`. BMad Studio reads from the same places via a `chokidar` file watcher and renders. When the user acts in the UI (drag a card, edit a checklist), BMad Studio writes back to the same files. There is no separate Studio database for BMAD state. Projects, profiles, settings, and chat history are local DB; **BMAD project state is filesystem-only**.

**Cite:** BMAD docs § "What got installed" — defines the canonical filesystem layout.

### KAD-3: The phase + skill graph comes from `_bmad/_config/bmad-help.csv`

That CSV defines `phase`, `after`, `before`, `required`, `output-location`, `outputs` for every installed workflow. The Kanban's columns, the workflow dependency arrows, and the "is this phase complete?" detection all read from this CSV. Treat it as a database. When new modules are installed, the CSV regenerates and the UI re-renders.

**Cite:** `bmad-help/SKILL.md` § "CSV Interpretation" (within `~/Projects/BMAD-Install-Files/.agents/skills/bmad-help/SKILL.md`).

### KAD-4: Workflow execution is a generic runtime

`WorkflowRunner` takes any installed BMAD skill and executes it via `streamText()` from Vercel AI SDK v6, enforcing BMAD's just-in-time step-file rule (one step file in context at a time, never peek ahead). The runner is **agnostic to which skill it's running** — the skill's `SKILL.md` + step files + `customize.toml` fully describe behavior. Adding a new BMAD module = zero code changes in BMad Studio.

**Cite:** BMAD docs § "How Skills Are Generated" + § "The Activation Flow" (8-step sequence).

### KAD-5: TS resolver is a faithful spec implementation

`_bmad/scripts/resolve_customization.py` and `resolve_config.py` are ports to TypeScript using `smol-toml`. The four shape-driven merge rules (scalar-override, table-deep-merge, keyed-array-replace, plain-array-append) are reproduced exactly with Vitest fixtures pinned against the BMAD repo. We never shell out to Python for the runtime path; Python remains optional for users who want to run BMAD's own scripts.

**Cite:** BMAD docs § "Merge Rules (by shape, not by field name)" + § "Three-Layer Override Model" + § "How Resolution Works".

### KAD-6: Hybrid AI host

Default execution path: in-app Vercel AI SDK v6 with the user's chosen provider/profile (existing Aperant strength). Power-user path (Phase 6+): launch Claude Code or Cursor agent in a subprocess with the project mounted, capture stdout, watch the filesystem. The default ships first; subprocess delegation is a stretch goal. **Both paths read the same SKILL.md.**

**Cite:** BMAD docs § "Where Skill Files Live" — IDE-specific paths confirm subprocess delegation is feasible without forking the skill content.

### KAD-7: Personas persist; chats are fresh

A persona (Mary, John, Winston, Sally, Paige, Amelia) loaded into a worker thread stays loaded across multiple workflow invocations within the same project session. Each workflow invocation starts a **fresh `streamText()` conversation** (empty message history) but inherits the persona's system prompt. This matches BMAD's "fresh chat per workflow" principle without thrashing worker threads.

**Cite:** BMAD docs § "Step 1: Create Your Plan" `:::caution[Fresh Chats]` block + § "Why Not Just a Blank Prompt?" (persona-as-context-frame argument).

### KAD-8: Kanban is the headline differentiator

Status states map directly to BMAD's `sprint-status.yaml` schema: `backlog | ready-for-dev | in-progress | review | done` (+ `optional` lane for retros). Drag-and-drop updates the YAML; YAML changes update the UI. Card click opens the story file; "Run" actions invoke the matching BMAD skill. **No bespoke task system.**

**Cite:** `~/Projects/BMAD-Install-Files/.agents/skills/bmad-sprint-planning/sprint-status-template.yaml` (canonical schema).

### KAD-9: Modules are first-class

A `ModuleRegistry` reads `_bmad/_config/manifest.yaml` + each module's `_bmad/{module}/config.yaml` + `_bmad/_config/skill-manifest.csv` and exposes installed modules + their workflows to the UI. Module install/update/remove is a UI action that wraps the CLI.

**Cite:** BMAD docs § "How Module Discovery Works" + § "Headless CI installs".

### KAD-10: Aperant's existing strengths are preserved

Multi-account profiles, terminal system, GitHub/GitLab integration, ideation runners, changelog, insights, roadmap, merge-resolver, MCP integration, worktree isolation, security layer, i18n, themes — **all stay**. BMAD doesn't have these; that's our value-add. The pieces being rewritten are exclusively in `apps/desktop/src/main/ai/orchestration/`, `apps/desktop/src/main/ai/spec/`, and `apps/desktop/prompts/`.

**Cite:** N/A — Aperant-specific. See `INVENTORY.md` §1.4 for the explicit `AgentType` keep/delete list.

---

## Phase decisions

### D-001: Reference install version skew is informational only

**Date:** 2026-04-30
**Phase:** 0
**Status:** Resolved (informational)
**Author:** Sallvain

**Context:**
The reference install at `~/Projects/BMAD-Install-Files/` reports `version: 6.6.1-next.0` (the `@next` channel). A fresh `npx bmad-method install --yes --modules bmm --tools cursor` (default channel) reports `version: 6.6.0`. The two are **one minor-rc apart**, not a snapshot of the same release. All skill content is byte-identical; only `_config/manifest.yaml`, `_config/files-manifest.csv`, `config.toml`, `bmm/config.yaml`, `core/config.yaml` differ — and only for install-time metadata reasons (timestamps, project name, version string).

**Options considered:**
1. Pin all dev work against `~/Projects/BMAD-Install-Files/` and ignore the live channel — simple but freezes us to one snapshot.
2. Pin against the default channel (`6.6.0`) and re-verify the snapshot at every phase gate — closer to user reality.
3. Treat both as snapshots of the live spec at `https://docs.bmad-method.org/llms-full.txt`, fetch the docs at every phase, log drift if found.

**Decision:**
Option 3. Per `<docs_protocol>` Rule 3, when the snapshot and live docs disagree, follow the docs and log it. The reference install is a useful local reference; the docs are the spec. The TS resolver port (Phase 1) targets the merge rules described in BMAD docs § "Merge Rules (by shape, not by field name)" — the Python `resolve_customization.py` is a reference implementation, not the spec.

**Rationale:**
This matches the prompt's `<docs_protocol>` discipline. Locking to a snapshot would silently drift; following the docs and re-verifying at every phase gate keeps us honest.

**Consequences:**
- Every phase's pre-work re-fetches the live docs and diffs section titles against the inventory's `<bmad_docs_index>`.
- The customization resolver's Vitest fixtures (Phase 1) are derived from the docs' "Merge Rules" section, not from blindly mirroring `resolve_customization.py`.
- If the install at `~/Projects/BMAD-Install-Files/` ever stops matching the live docs at the byte level for skill content, that's a docs-vs-implementation drift in the BMAD repo itself — file an issue against the BMAD repo per `<docs_protocol>` Rule 3.

---

### D-002: `pause-handler.ts` disposition

**Date:** 2026-04-30
**Phase:** 0 (decision needed before Phase 5)
**Status:** Open — awaiting human review
**Author:** Sallvain

**Context:**
`apps/desktop/src/main/ai/orchestration/pause-handler.ts` (247 lines) creates filesystem sentinel files (`RATE_LIMIT_PAUSE`, `AUTH_PAUSE`, `RESUME`, `PAUSE`) for the build orchestrator to coordinate rate-limit and auth-failure pause/resume cycles with the renderer. It's **not** in `ENGINE_SWAP_PROMPT.md`'s explicit DELETE list, but its only consumer is `subtask-iterator.ts`, which **is** in the DELETE list. After Phase 5, `pause-handler.ts` becomes orphan code unless the new `WorkflowRunner` adopts the same pattern.

**Options considered:**
1. Delete `pause-handler.ts` in Phase 5 alongside `subtask-iterator.ts`. The new `WorkflowRunner` (Phase 2) handles rate-limit / auth errors via the `runAgentSession` error-classification path (HTTP 429/401 already handled there); UI pause/resume can be done via a Zustand store + IPC instead of sentinel files.
2. Keep `pause-handler.ts` and rewire it to be called from `WorkflowRunner` for parity with the old behavior. UI keeps its existing "paused" indicator.
3. Delete `pause-handler.ts` but keep the IPC events (`workflow-paused`, `workflow-resumed`) so the existing UI components don't need to be rewritten.

**Decision:**
Pending — recommended Option 1.

**Rationale (for Option 1):**
- The sentinel-file approach was a workaround for the Python sidecar architecture (pre-Vercel-AI-SDK migration). With the runtime entirely in the Electron main process, IPC events + Zustand state is the idiomatic pattern.
- BMAD has no concept of "pause"; the user just stops a workflow and starts a new one with `bmad-correct-course` or by re-invoking the skill. Rate-limit handling is a host-runtime concern, not a BMAD concern.
- Removing it shrinks the surface area of the migration.

**Consequences if Option 1:**
- Remove `pause-handler.ts` from `apps/desktop/src/main/ai/orchestration/`.
- Audit consumers in `apps/desktop/src/renderer/` for sentinel-file polling — those need rewiring to IPC events.
- Document the new pause/resume flow in Phase 5 phase notes.

---

### D-003: `AgentType` enum entry `analysis` retention

**Date:** 2026-04-30
**Phase:** 0 (decision needed before Phase 5)
**Status:** Open — awaiting human review
**Author:** Sallvain

**Context:**
The `analysis` agent type in `agent-configs.ts` is the only one without a phase prefix or PR / spec / build / ideation namespace. Consumers aren't immediately clear from a quick scan. Three candidates emerged from the inventory walk:

**Options considered:**
1. **Keep `analysis` as-is.** Treat it as a generic "analyse this code/file/diff" agent, similar to `insights`. Useful for ad-hoc surfaces.
2. **Fold into `ideation`.** Both have full builtin tools, no MCP, similar `thinkingDefault: 'medium'`/`high`. The ideation runners already cover most of what the `analysis` agent handles.
3. **Rename to `code_analysis`** to make scope explicit.

**Decision:**
Pending — recommended Option 1 unless usage audit shows zero consumers (then Option 2).

**Rationale:**
The 18-entry KEEP list (INVENTORY §1.4) is intentionally conservative — KAD-10 says Aperant strengths stay. If `analysis` has any consumer, keeping it is the safer move; renaming or folding is a follow-up cleanup, not a migration concern.

**Consequences if Option 1:**
- No code changes.
- A future cleanup pass can audit consumers and fold/rename if appropriate.

---

### D-004: `spec_compaction` deletion is safe — no orphans

**Date:** 2026-04-30
**Phase:** 0 (verify in Phase 5 cleanup)
**Status:** Open — pending Phase 5 audit
**Author:** Sallvain

**Context:**
`spec_compaction` was used by Aperant's spec pipeline to compress long agent conversations to fit a context window. BMAD's "fresh chat per workflow" model (KAD-7) eliminates the need for compaction — every workflow starts with empty conversation history per BMAD docs § "Step 1: Create Your Plan" `:::caution[Fresh Chats]` block.

**Options considered:**
1. Delete `spec_compaction` confidently and let any orphan import surface as a typecheck error in Phase 5.
2. Audit `spec_compaction` consumers in Phase 0 before declaring the deletion safe.

**Decision:**
Pending — Option 1 is fine if the typecheck passes after Phase 5 deletes; Option 2 is the belt-and-suspenders move.

**Rationale:**
TypeScript strict mode + `npm run typecheck` will catch any orphan import at Phase 5 gate. No need to spend Phase 0 cycles on the audit.

**Consequences:**
- Phase 5's cleanup checklist explicitly verifies `npm run typecheck` exits 0 after `agent-configs.ts` is trimmed.

---

### D-005: Quick Flow track wiring uses `bmad-quick-dev`

**Date:** 2026-04-30
**Phase:** 0 (decision needed before Phase 2 orchestrator implementation)
**Status:** Open — awaiting human review
**Author:** Sallvain

**Context:**
`ENGINE_SWAP_PROMPT.md` mapping table maps Aperant's `complexity_assessor.md` to "BMAD's three tracks: Quick Flow (`bmad-quick-dev`), BMad Method (full PRD+Arch+Stories), Enterprise." Quick Flow's stated goal is to skip planning artifacts for trivial changes. The `bmad-quick-dev` skill (Amelia, anytime phase) handles intent → plan → implement → review → present in a single workflow per its `SKILL.md` description.

**Options considered:**
1. **Ship Quick Flow in Phase 1–4.** UI exposes track choice (Quick / Method / Enterprise) on project creation; Quick projects skip directly to `bmad-quick-dev` invocations.
2. **Defer Quick Flow to Phase 5+.** Phase 1–4 only ships BMad Method (full PRD + Arch + Stories) flow; Quick Flow follows after the kanban + persona chat UX is stable.
3. **Ship Quick Flow but as a single "Quick Build" button** rather than a full track radio.

**Decision:**
Pending — recommended Option 2 (defer).

**Rationale:**
- Phase 3's Kanban is the headline differentiator (KAD-8). Quick Flow doesn't produce sprint-status.yaml or epic/story files — it skips the kanban entirely.
- Building three tracks doubles UX surface area for Phase 1–4. Cleanest scope: ship BMad Method (the kanban-driven track), validate the full lifecycle, then add Quick Flow as a project-creation-time radio in Phase 5 alongside Enterprise.
- BMAD docs § "Three Planning Tracks" + § "Step 1: Create Your Plan — Quick Flow" make Quick Flow distinctly different from the kanban-driven flow; mixing them in the same UI before the kanban-driven flow is solid would be premature.

**Consequences if Option 2:**
- Phase 1–4 ships only BMad Method track in the UI.
- The `BmadOrchestrator` (Phase 2) takes a `track: BmadTrack` parameter from day one, but only `'method'` is wired; `'quick'` and `'enterprise'` are TS-typed but throw `UnsupportedTrackError` until Phase 5.
- Phase 5 phase notes document the addition of the radio.

---

### D-006: Migrator ships without an in-repo fixture

**Date:** 2026-04-30
**Phase:** 0 (decision needed before Phase 5)
**Status:** Open — awaiting human review
**Author:** Sallvain

**Context:**
`apps/desktop/src/main/ai/bmad/migrator.ts` (Phase 5 deliverable) handles `.auto-claude/specs/XXX-name/` → `_bmad-output/` translation for users with existing Aperant projects. This repo's `.auto-claude/specs/` is empty, so there's no in-repo fixture to test the migrator against.

**Options considered:**
1. **Ship the migrator with synthetic fixtures.** Author a `__tests__/fixtures/aperant-spec-001-foo/` directory with a fake `spec.md`, `implementation_plan.json`, `requirements.json` that the Vitest suite drives the migrator against.
2. **Ship the migrator without a fixture.** Document the manual smoke test procedure (drop an Aperant spec dir into a clean install of BMad Studio, open the project, accept the prompt) and rely on QA validation.
3. **Defer the migrator to Phase 6.** Users with Aperant data manually move it; Phase 5 ships only forward-compatible code paths.

**Decision:**
Pending — recommended Option 1 (synthetic fixture).

**Rationale:**
- Migrators are exactly the kind of code that breaks silently on edge cases (encoding, missing fields, partial writes). A fixture-driven Vitest suite catches 90% of regressions for free.
- Deferring to Phase 6 leaves users in the wild without an upgrade path; that's a worse experience than a slightly-imperfect migrator with test coverage.
- Synthetic fixtures are easy to author from the existing `apps/desktop/src/main/ai/spec/` schema definitions before they're deleted.

**Consequences if Option 1:**
- Phase 5 deliverable expands to include `apps/desktop/src/main/ai/bmad/__tests__/migrator.test.ts` + a `__tests__/fixtures/aperant-spec-fixture/` directory.
- The fixture is removed in Phase 6 once enough real-world migrations are confirmed.

---

## Later decisions

### D-007: BMAD IPC envelope keeps `success`/`data` verb but uses structured `error`

**Date:** 2026-04-30
**Phase:** 1
**Status:** Resolved
**Author:** Sallvain

**Context:**
`ENGINE_SWAP_PROMPT.md` `<engineering_standards>` "Error handling" mandates every IPC handler returns `{ ok: false, error: { code, message, details } }`. The existing Aperant codebase uses `IPCResult<T> = { success: boolean; data?: T; error?: string }` (defined in `apps/desktop/src/shared/types/common.ts`) and that envelope is referenced by 50+ handlers and the renderer's `useIpc` hook. Adopting the prompt's `ok` shape verbatim would either fork the convention (two envelope types in one app) or trigger a giant refactor that's outside Phase 1's scope.

**Options considered:**
1. **Use the prompt's exact shape, fork the convention.** Two envelopes in the codebase — `IPCResult<T>` for legacy handlers, `{ ok, error: { code } }` for new BMAD handlers. Renderer hooks become envelope-aware.
2. **Refactor the entire codebase to the `ok` shape.** Out of scope per KAD-10 ("Aperant strengths preserved") and the prompt's "Don't write a parallel task DB" / minimal-changes spirit.
3. **Compromise: keep `success`/`data` (the existing verb) but elevate `error` from `string` to structured `{ code, message, details }` for BMAD handlers.** New shape: `BmadIpcResult<T> = { success: true; data: T } | { success: false; error: { code: BmadErrorCode; message: string; details?: unknown } }`.

**Decision:**
Option 3.

**Rationale:**
- Substantive change the prompt actually wants is the **structured error code + details** — not the `ok` vs `success` verb. Option 3 captures the substantive requirement without forking the envelope verb.
- The `BmadErrorCode` union (closed set, 24 codes) gives the renderer exhaustive error UX without `string` parsing.
- Existing handlers continue working unchanged (KAD-10).
- The renderer can introduce a single helper `unwrap(result)` later that handles both envelope shapes uniformly.

**Consequences:**
- New BMAD handlers in `apps/desktop/src/main/ipc-handlers/bmad-handlers.ts` return `BmadIpcResult<T>`.
- The preload bridge (`apps/desktop/src/preload/api/bmad-api.ts`) types every method's return as `BmadIpcResult<T>` so renderer call-sites get full type narrowing on `result.success` discriminator.
- `apps/desktop/src/shared/types/bmad.ts` exports `bmadOk(data)` + `bmadFail(code, message, details?)` helpers so handler bodies stay terse.
- All BMAD error codes are translated under `bmad.errors.{CODE}` in the EN + FR locale files. New error codes always require both translations.
- Future migration to a unified envelope (if ever needed) is a single `IPCResult<T>` widening + adapter, not a per-handler rewrite.

---

### D-008: Resolver returns `structuredClone` of merged tree (deviation from Python's reference-sharing memory model)

**Date:** 2026-04-30
**Phase:** 1 (post-Phase-1 hardening)
**Status:** Resolved
**Author:** Sallvain

**Context:**
The Python `resolve_customization.py` (the spec) returns merged dicts that share object references with the loaded `customize.toml` defaults — `deep_merge` in Python clones at the object level but recursively shares nested references, same as the original TS port. `skill-registry.ts` caches each skill's parsed `customize.toml` and calls `resolveCustomization()` to produce a merged view; the result was typed as `Readonly<Record<string, unknown>>` (compile-time hint only, zero runtime enforcement).

Future consumers — specifically Phase 5's `BmadCustomizationPanel.tsx` (reads resolved tree to display "current values," lets user edit, writes back to override files) and Phase 2's `workflow-runner.ts` (substitutes variables into resolved values) — would naturally mutate the result. A push to `resolved.agent.menu` or a splice on `resolved.workflow.persistent_facts` would corrupt the skill registry's cached defaults via shared reference. Symptoms would be subtle: the next call to `resolveCustomization()` on the same skill would see a corrupted base, downstream merges would produce surprising results, and debugging would be painful because the corruption survives across resolver invocations.

The `ENGINE_SWAP_PROMPT.md` `<anti_patterns>` rule "Don't be clever in the customization resolver. The Python implementation is the spec; mirror it line-for-line." applies to **merge semantics**, not to memory model. Cloning the result does not change which keys win, which arrays append, or which tables deep-merge. It only changes who owns the returned object graph.

**Options considered:**
1. **Mirror Python verbatim, document the mutation hazard, hope consumers comply.** Relies on every future agent reading the docstring and remembering. Long-term liability.
2. **Freeze the result with recursive `Object.freeze`.** Catches mutation at runtime via TypeError, but breaks legitimate consumer patterns (e.g. workflow runner extending the result with computed fields). More invasive.
3. **`structuredClone` the merged tree at the public API boundary.** One clone per `resolveCustomization()` call. Result is fully detached from inputs. Consumers may mutate freely. Native, no dependency, preserves `Date` (smol-toml emits `Date` for TOML datetimes), available in Node 17+ (package.json mandates Node ≥24 — fine).

**Decision:**
Option 3. Single `structuredClone` call site in `resolveCustomization`, applied to the merged tree before either the full-tree or sparse-`keys` extraction return path. `__internals` (`deepMerge`, `mergeByKey`, `detectKeyedMergeField`, `isPlainObject`, `findProjectRoot`) are unchanged — they're test-only and the tests don't mutate.

**Rationale:**
- Concrete future-bug class eliminated, not just documented away.
- Memory-model deviation, not semantics deviation. Anti-pattern rule unviolated (per docs_protocol Rule 1: cited [BMAD docs § "Merge Rules (by shape, not by field name)"](https://docs.bmad-method.org/how-to/customize-bmad/) for the merge contract; the immutability decision is TS-side).
- `structuredClone` perf cost is microseconds for typical TOML sizes (BMAD `customize.toml` files are small — tens of fields, no deep nesting).
- The `Readonly<>` type signature on `skill-registry.ts:186` is now backed by runtime behavior, closing the compile-vs-runtime gap.

**Consequences:**
- File-header docstring on `customization-resolver.ts` updated with a "Mutation safety" note explaining the contract.
- All 54 customization-resolver tests pass unchanged (none rely on referential equality of returned objects).
- `npm run typecheck` clean.
- Phase 2's `workflow-runner.ts` may safely mutate results from `resolveCustomization()` (e.g. for variable substitution or computed-field injection) without skill-registry corruption.
- Phase 5's `BmadCustomizationPanel.tsx` may safely build edit-state from the resolved tree without defensive copying at the consumer site.
- Future agents reading the resolver: do **not** remove the `structuredClone` call, even if comparing line-for-line against `resolve_customization.py`. The deviation is intentional and this entry is the canonical "why."
