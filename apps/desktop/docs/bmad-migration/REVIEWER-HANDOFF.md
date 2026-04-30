# Reviewer / Orchestrator Handoff

> **Purpose:** Bring a fresh AI assistant up to speed on the BMad Studio engine swap so they can resume the **reviewer/orchestrator role** I've been playing for Sallvain. Read this end-to-end before responding to anything.
>
> **Created:** 2026-04-30 (mid-Phase 2 → Phase 3 transition)
> **Authoring assistant:** Claude (Cursor agent, Opus 4.7)
> **Reason:** Conversation context was getting heavy. This file preserves the decisions, working pattern, and load-bearing knowledge so a fresh assistant can pick up without re-reading the full chat history.

---

## What's happening

Sallvain (the user) is migrating his Electron desktop app **Aperant** (a fork of [AndyMik90/Aperant](https://github.com/AndyMik90/Aperant), repo: `Sallvainian/BMAD-Studio`) to function as a **visual frontend over the [BMad Method](https://github.com/bmad-code-org/BMAD-METHOD) engine**, with a Kanban board as the headline differentiator.

The migration is structured in 6 phases, executed by **separate AI agents** (Cursor agents) that follow a single canonical prompt: [`/Users/sallvain/Projects/BMAD-Studio/ENGINE_SWAP_PROMPT.md`](../../../ENGINE_SWAP_PROMPT.md). Each phase runs in a **fresh chat** (per the prompt's "fresh context window per phase" rule).

I (the assistant) am **not the agent doing the work.** I'm the **reviewer/orchestrator** — I help Sallvain:

1. Author and refine the operating prompt (`ENGINE_SWAP_PROMPT.md`)
2. Approve / push back on decisions the worker agents flag
3. Spot-check load-bearing files when worker agents finish a phase
4. Compose the close-out message for the finishing agent and the kickoff message for the next fresh agent
5. Make small surgical edits when needed (like adding `structuredClone` hardening to the resolver)

---

## Phase status (as of this handoff)

| Phase | Title | Status |
|---|---|---|
| 0 | Inventory + decisions log | ✅ Complete |
| 1 | Foundation (installer, manifest, skill registry, customization resolver, file watcher) | ✅ Complete + hardened (D-008) |
| 2 | Workflow runtime + orchestrator + personas + step loader + sprint status + IPC | ✅ Complete |
| 3 | Kanban board (the headline differentiator) | 🔜 Next — kickoff message just sent |
| 4 | Persona chat + bmad-help sidebar | Pending |
| 5 | Customization UI + module manager + migration + cleanup | Pending |
| 6 | Stretch goals (Quick Flow, IDE delegation, marketplace) | Pending |

**Branch:** `feature/bmad-engine-swap` (cut from `develop`)
**PR:** #49 (draft, base `develop`, links #48)
**Latest commits:** Phase 1 + Phase 1 hardening + Phase 2 (commits a71a162d, 5d2e32b2, d4271373 plus a docs follow-up the Phase 2 agent is doing right now to append D-009/D-010/D-011 to DECISIONS.md)

---

## Source of truth files (read these in order)

1. [`/Users/sallvain/Projects/BMAD-Studio/ENGINE_SWAP_PROMPT.md`](../../../ENGINE_SWAP_PROMPT.md) — the operating contract for every worker agent. **Read this first.** It's structured with XML-tagged sections: `<role>`, `<product_vision>`, `<key_architectural_decisions>` (KAD-1 through KAD-10), `<concept_translation>`, `<file_changes>`, `<execution_plan>` (Phases 0-6), `<engineering_standards>`, `<reference_material>`, `<docs_protocol>`, `<bmad_docs_index>`, `<acceptance_criteria>`, `<anti_patterns>`, `<output_format>`, `<self_verification>`, `<start_command>`.
2. [`INVENTORY.md`](./INVENTORY.md) — Phase 0 deliverable. Aperant deletions, BMAD skill catalog, agent type mapping, Mermaid phase graph from `bmad-help.csv`.
3. [`DECISIONS.md`](./DECISIONS.md) — D-001 through D-008 (D-009/D-010/D-011 being appended in a docs-only commit by the Phase 2 agent right now).
4. [`PHASE-1-NOTES.md`](./PHASE-1-NOTES.md), [`PHASE-2-NOTES.md`](./PHASE-2-NOTES.md) — per-phase completion summaries from the worker agents.

The BMAD docs canonical URL: `https://docs.bmad-method.org/llms-full.txt` (169 KB). The prompt's `<bmad_docs_index>` section maps doc sections to phases — use that to know what to re-read for each phase.

The reference BMAD install on this machine: `~/Projects/BMAD-Install-Files/`. Treat as a snapshot; live docs win on conflicts (per `<docs_protocol>` Rule 3).

---

## The 10 Key Architectural Decisions (locked in)

These are the contract. **Don't relitigate without a written counter-proposal in `DECISIONS.md`.**

- **KAD-1:** BMAD installed via `npx bmad-method install`, NOT bundled as static assets
- **KAD-2:** Filesystem is the contract — `_bmad/` and `_bmad-output/` are source of truth, watched via chokidar
- **KAD-3:** Phase + skill graph comes from `_bmad/_config/bmad-help.csv`
- **KAD-4:** Workflow execution is a generic runtime; adding a new BMAD module = zero code changes
- **KAD-5:** TS resolver is a faithful spec implementation of the Python `resolve_customization.py` (with one deliberate deviation — see D-008)
- **KAD-6:** Hybrid AI host — embedded Vercel AI SDK default, IDE delegation in Phase 6 stretch
- **KAD-7:** Personas persist across workflows in the same worker thread; chats are fresh per workflow
- **KAD-8:** Kanban driven by `sprint-status.yaml` schema (5 statuses + Optional lane)
- **KAD-9:** Modules are first-class via `_bmad/_config/manifest.yaml` + `module.yaml` discovery
- **KAD-10:** Aperant's existing strengths (multi-account profiles, terminal, GitHub/GitLab, MCP, security, worktree, i18n, themes) are preserved — only the orchestration layer is replaced

---

## Decisions made so far (D-001 through D-011)

- **D-001:** Reference install version skew (6.6.1-next vs 6.6.0) — informational only, follow live docs
- **D-002:** `pause-handler.ts` added to DELETE list (orphaned once subtask-iterator goes)
- **D-003:** Keep `analysis` agent type (powers competitor_analysis and ideation runners — KEEP set)
- **D-004:** `spec_compaction` deletion safety deferred to Phase 5 typecheck
- **D-005:** Quick Flow track deferred to Phase 6 (Phase 1-5 ships BMad Method + Enterprise only)
- **D-006:** Synthetic fixture for migrator testing in Phase 5
- **D-007:** BMAD IPC envelope keeps `success`/`data` verb (preserves Aperant convention) but elevates `error` to structured `{ code: BmadErrorCode, message, details }` via `BmadIpcResult<T>`. Helpers `bmadOk()` and `bmadFail()` keep handler bodies terse.
- **D-008 (post-Phase-1 hardening):** `customization-resolver.ts` returns `structuredClone` of merged tree to prevent caller mutation of cached defaults. Memory-model deviation from Python, not semantics deviation.
- **D-009:** Variable regex uses `(?<!\{)…(?!\})` lookaround to preserve `{{model-side}}` Mustache templates while substituting `{single-brace}` BMAD variables.
- **D-010:** Workflow runner detects menus heuristically via patterns A `[CODE]`, B `1.`/`1)`, plus question/select fallback. BMAD docs § "Why Not Just a Menu?" establishes menus are conventional, not structured.
- **D-011:** IPC `runWorkflow` bridges `onMenu` callbacks via a per-`(invocationId, menuId)` resolver registry with 10-min renderer-response timeout.

---

## Working pattern (how I interact with Sallvain)

1. **Worker agent finishes a phase**, posts a structured summary (per `<output_format>` shape).
2. **Sallvain pastes that summary to me**, often with a one-line question like "what should I tell him?"
3. **My job:**
   - Verify the substantive claims (run tests, run typecheck — don't take "tests pass" on faith for big phases)
   - Spot-check the load-bearing file for the phase (Phase 1 = `customization-resolver.ts`; Phase 2 = `workflow-runner.ts`; Phase 3 = whatever the Kanban data flow hinges on)
   - Make a call on each new D-NN decision the agent flagged (approve, push back, or modify)
   - Identify any process misses (e.g. Phase 2 agent forgot to actually append D-009/D-010/D-011 to DECISIONS.md — caught and flagged)
   - Make small surgical fixes directly when warranted (like the structuredClone hardening)
   - Update `ENGINE_SWAP_PROMPT.md` if a phase decision should propagate forward
   - Compose two messages for Sallvain to paste:
     - Close-out for the current agent (approvals + any cleanup tasks)
     - Kickoff for the fresh next-phase agent (always references all migration docs + the prompt)
4. **Sallvain pastes those messages**, opens a fresh chat for the next phase, repeats.

---

## Working style with Sallvain (his preferences)

These are in his user rules and reinforced by behavior:

- **Casual tone, concise, code-first.** No theory. Get to the point. Treat him as an expert.
- **Anticipate his needs.** When he asks "what should I tell him?", give him paste-ready messages, not a discussion.
- **Suggest things he didn't think of.** When I spot something brittle (like the resolver shallow-clone), I flag it.
- **Push back when warranted.** Don't approve sloppy decisions; he wants real engineering.
- **No moral lectures, no AI disclosure, no knowledge-cutoff disclaimers.**
- **Cite sources at the end, not inline.**
- **Respect prettier preferences.** Match Biome formatting that's already in the codebase.
- **Fully implement.** No TODOs, no placeholders.
- **Voice mode:** when Sallvain triggers `/voicemode/converse` (often when driving), keep utterances brief, don't ramble. He'll often ask me to copy the close-out / kickoff messages directly to his clipboard via `pbcopy` (he's hands-busy).

---

## What I look for during phase reviews

When a worker agent finishes a phase, here's the checklist I run:

### Always

- Run `npx vitest run src/main/ai/bmad/__tests__/ --no-file-parallelism` from `apps/desktop/` and verify the count he claims
- Run `npm run typecheck` from `apps/desktop/` and verify exit 0
- Read `PHASE-N-NOTES.md` end-to-end
- Read each new D-NN entry the agent claimed to add (verify they actually landed in `DECISIONS.md`, not just summaries in PHASE-N-NOTES.md)
- Verify the deliverables claimed in his summary actually exist in the file tree

### Spot-check the load-bearing file for the phase

| Phase | Load-bearing file | What to look for |
|---|---|---|
| 1 | `customization-resolver.ts` | The four shape-driven merge rules (scalar override, table deep-merge, keyed-array replace, plain-array append). Three-layer override order. `structuredClone` at the public API boundary (D-008). |
| 2 | `workflow-runner.ts` | 8-step activation flow in `composeSystemPrompt`. Just-in-time step loading enforced. Menu detection heuristics. Variable substitution preserves `{{model-side}}`. Persona persistence model. |
| 3 | (TBD — likely `BmadKanbanBoard.tsx` + `sprint-status.ts` interaction) | Bidirectional sync between drag-and-drop and YAML writes. Optimistic UI with rollback. File-watcher-driven re-render. Status state machine matches BMAD's 5 states + Optional lane. |
| 4 | (TBD — `help-runner.ts` + `BmadHelpSidebar.tsx`) | Sidebar invokes the actual `bmad-help` skill, never reimplements it. Persona chat preserves icon prefix on every message. |
| 5 | (TBD — `BmadCustomizationPanel.tsx` + `migrator.ts`) | Visual TOML editor writes valid override files that survive next install. Migrator backs up `.auto-claude/specs/` before touching anything. |

### Common process misses to catch

- Decisions claimed in the summary but not actually appended to `DECISIONS.md`. **Gotcha:** before flagging this, ALWAYS run `git show HEAD:apps/desktop/docs/bmad-migration/DECISIONS.md | grep "^### D-"` to check the committed version. The local working tree can diverge from the committed state (editor buffers, partial checkouts, stash mishaps). I (the previous me) flagged the Phase 2 agent for missing D-009/D-010/D-011 based on a stale local read; the entries were actually committed and pushed. Don't repeat this — verify against `HEAD` before accusing.
- Files claimed deleted but still imported elsewhere (will surface in typecheck)
- i18n added to EN but not FR (or vice versa)
- `console.log` slipping in (run `rg "console\.log" apps/desktop/src/main/ai/bmad/`)
- `process.platform` direct reads (must use `apps/desktop/src/main/platform/`)

---

## Things to know about the worker agents

- They run in **fresh Cursor agent chats**, one per phase
- They read `ENGINE_SWAP_PROMPT.md` + `INVENTORY.md` + `DECISIONS.md` + prior phase notes as their entire context
- They've been good at code quality but occasionally miss process details (the DECISIONS.md append miss in Phase 2)
- They're capable of running tests, typechecks, and pushing commits autonomously
- They follow the prompt's "stop at the gate" rule — they finish a phase, post a summary, and wait for human signoff
- They are NOT supposed to start the next phase in the same chat (KAD-style "fresh context per phase" rule)

---

## Voice mode notes

When Sallvain uses `/voicemode/converse`:

- He's often driving. Keep replies short and conversational.
- He'll often say things like "copy the close-out message to my clipboard" — use `pbcopy` via Shell:
  ```bash
  cat <<'EOF' | pbcopy
  <message text>
  EOF
  ```
- STT misrecognitions happen ("Asian" → "agent", etc.) — interpret charitably from context.

---

## Resuming the role (what to do first when picking this up)

1. Read this file end-to-end (you just did)
2. Read `ENGINE_SWAP_PROMPT.md` end-to-end
3. Skim `DECISIONS.md` to see all D-NN entries
4. Skim the most recent `PHASE-N-NOTES.md` to know what just shipped
5. Check `git log --oneline feature/bmad-engine-swap` to see latest commits
6. Check PR #49 status: `gh pr view 49`
7. Wait for Sallvain to paste the next worker agent's summary or ask a question

If Sallvain asks "where are we?" — give him a 2-3 sentence orientation per the phase status table above.

---

## Things I deliberately did NOT do (so don't try to redo them)

- Edit Sallvain's WIP files: root `CONTRIBUTING.md` (he emptied it intentionally), `ENGINE_SWAP_PROMPT_LEAN.md` (his WIP)
- Touch `.auto-claude/specs/` (it's empty in this checkout; migrator handles it in Phase 5)
- Fix the pre-existing `github-error-parser.test.ts` clock-relative bug (it's on `develop` already; separate small PR)
- Force-push or merge to `main`
- Add Quick Flow track to Phase 1-5 (deferred to Phase 6 per D-005)

---

## Useful commands

```bash
# Run BMAD subsystem tests
cd /Users/sallvain/Projects/BMAD-Studio/apps/desktop
npx vitest run src/main/ai/bmad/__tests__/ --no-file-parallelism

# Full typecheck
cd /Users/sallvain/Projects/BMAD-Studio/apps/desktop
npm run typecheck

# Check PR status
gh pr view 49 --repo Sallvainian/BMAD-Studio

# View recent commits on the migration branch
cd /Users/sallvain/Projects/BMAD-Studio
git log --oneline feature/bmad-engine-swap -20
```

---

## Open questions / things I'm watching

- **Phase 3 file-watcher hardening:** the `file-watcher.test.ts > coalesces duplicate events` case is parallelism-flaky; Phase 3's pre-work in the prompt now includes fixing it (added by me at the end of Phase 2 review).
- **D-009/D-010/D-011 append:** the Phase 2 agent is supposed to append these to `DECISIONS.md` in a small docs follow-up commit. Verify they land before kicking off Phase 3.
- **Kanban performance:** Phase 3 budget is < 100ms first paint after sprint-status load. With drag-and-drop on a project with 5 epics × 10 stories, watch for re-render storms.

---

That's the handoff. Good luck.
