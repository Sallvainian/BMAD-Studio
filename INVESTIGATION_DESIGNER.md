# Memory System V1 — UX Edge Case Analysis

Prepared by: Design Review
Source document: MEMORY_SYSTEM_V1_DRAFT.md
Review scope: All 23 sections, focusing on user-facing interaction patterns and trust dynamics

---

## Executive Summary

The architecture is technically sound and well-thought-out. The UX gaps identified below are not about what the system does — they are about how it communicates with the user, handles edge cases the user will encounter, and earns the kind of trust that makes users rely on memory rather than fear it. Left unaddressed, several of these issues will result in users disabling the memory system entirely after a bad first experience.

The single highest-risk issue is Issue 1 (Wrong Memory Problem). The single highest-upside opportunity is Issue 10 (Wow Moment delivery). Everything else sits between those two poles.

---

## Issue 1: The Wrong Memory Problem — No Recovery UX

### What the draft says

The draft describes conflict detection, the `deprecated` flag, the `supersedes` relation, and a rollback mechanism in Section 16. The flow is: user clicks "This memory is wrong" in the Memory Browser, which sets `deprecated: true`.

### The edge case

The user never opens the Memory Browser. Most users will not proactively manage memories. They will experience the consequence — an agent making a wrong decision based on a stale memory — and not connect it to the memory system at all. They will blame the agent, lose trust, and either stop using Auto Claude or disable memory.

The draft assumes a feedback loop that requires the user to:
1. Notice the agent made a wrong decision
2. Attribute it to a specific memory
3. Navigate to Context → Memories tab
4. Find the relevant memory among potentially hundreds
5. Click the correction button

That is five steps of metacognitive work that most users will never complete.

### Concrete recommendations

**Inline correction at the point of damage.** When an agent references a memory in its response (e.g., "I've accounted for the JWT expiration issue from last time"), show a lightweight inline affordance next to that citation: a small flag icon with tooltip "Wrong? Correct this." Clicking it opens a focused correction modal showing only that memory, not the full browser.

**Session-end correction prompt.** At the end of each session, alongside the "Here's what I learned" summary (already in the draft), add: "Did I get anything wrong this session?" with a simple thumbs-down next to each memory the agent actually used. This surfaces correction at the moment when the user still has context about what happened.

**Surfacing source in agent output.** When an agent uses a memory in its reasoning, it should cite the source inline — not just in the Memory Browser. "Based on the decision we made in the auth refactor (March 12)" gives the user enough context to know whether that reference is correct without opening a separate panel.

**Urgency tier for corrections.** Not all wrong memories are equal. A stale `gotcha` about a test setup is annoying. A wrong `decision` that causes an agent to choose the wrong architecture is a blocker. The correction UI should distinguish these. A wrong `decision` memory should prompt: "Do you want to update the architectural record, or just correct this session?"

---

## Issue 2: Trust and Transparency — Invisible Provenance

### What the draft says

The schema includes `createdBy: "agent:coder" | "agent:qa" | "user"` and `source.sessionId`. This is good for the data layer. The draft also notes that "invisible AI memory feels spooky."

### The edge case

The draft does not describe how provenance is surfaced in the UI. Without visible provenance, users cannot assess whether to trust a memory. "The refresh token has a known validation bug" means very different things depending on whether:

- A QA agent flagged it three days ago during testing
- The user explicitly told the system this six months ago
- A planner agent inferred it from a commit message

All three are stored identically in the current UI design. The user sees a memory card with content, type, and creation date — but not the chain of evidence that created it.

### Concrete recommendations

**Provenance chain visible on every memory card.** Each card should show: who created it (agent type or user), which session, which branch it was active on, and how many times it has influenced agent behavior. Not buried in a detail panel — surfaced as metadata visible without clicking.

**Trust gradient visual design.** Memories created by `human_feedback` type should look visually distinct from memories created by `agent:qa`. Consider a subtle but consistent signal: user-created memories get a person icon, agent-created memories get an agent icon, and hybrid memories (user-confirmed after agent suggestion) get both. This should be readable at a glance in the memory list, not just on expanded cards.

**Memory audit trail.** For `decision` and `convention` type memories — the ones with no decay that permanently shape agent behavior — provide an expandable timeline showing every modification. If a `decision` was created by the planner, then modified by the user, then superseded by a newer decision, that full chain should be inspectable.

**"How did this influence my agent?" panel.** For each memory, show a log of which sessions it was injected into and whether the agent referenced it in its output. This closes the feedback loop between memory creation and memory use, making the system feel like a living knowledge base rather than a black box.

---

## Issue 3: First-Run UX — The Empty State Problem

### What the draft says

Section 6 describes the cold start process: static analysis (~10 seconds), LLM classification (~30 seconds), configuration seeding from README/package.json/etc., then presenting seeded memories to the user: "I found 12 conventions in your project. Review?"

### The edge case

The draft describes a technically correct initialization flow but doesn't address the UX of encountering an unfamiliar, consequential system for the first time. Users who arrive at the Memory tab for the first time face:

- A list of 12 auto-detected memories they didn't create
- No explanation of what these memories will do
- No framing of when memory is and is not used
- No indication of what the quality of the auto-detection is

This creates anxiety rather than excitement. "How did it know that? Is it reading everything? What else does it know about me?"

There is also a gap between project add and first session: the 40-second initialization window (10s static + 30s LLM) happens at an unspecified time. If the user immediately starts a session before initialization completes, they get no memory benefits and no explanation why.

### Concrete recommendations

**Guided first-run flow, not just a toast.** The first time a user visits the Memory tab, replace the standard list view with an onboarding card that explains: what memory does, what it stores, what it does not store, and that the user is always in control. This should be a one-time experience that advances to the normal view after 30 seconds or on explicit dismissal.

**Explicit initialization status.** When a project is added, show a progress indicator in the Memory tab: "Building your project map... (Step 1 of 3: Analyzing file structure)". Users who see work happening have patience. Users who see a spinner and nothing else close the window and come back later, missing the confirmation step.

**Seeded memory review as an active decision, not passive approval.** The draft says "Present seeded memories to user: 'I found 12 conventions. Review?'" — this framing treats the user as an approver of work already done. Instead, frame it as: "Before your first session, here are 12 things I noticed about your project. Tell me if any of these are wrong." This positions the user as the authority, not the rubber-stamp. Show each memory with a quick confirm/edit/remove action inline, not as a bulk approve button.

**Zero-memory empty state.** For users who disable Ollama or start without a memory backend configured, the Memory tab should not show an error state. It should show a clear explanation: "Memory is inactive — your agents will still work, but they won't remember between sessions. Enable Ollama in Settings to activate memory."

**Progressive disclosure of confidence.** The `confidence: "shallow" | "partial" | "mapped"` field exists in the ModuleMap schema. Surface this clearly during first-run: "These 3 modules are well-mapped from multiple sessions. These 4 are partially mapped — they'll improve as you work." This sets correct expectations about memory quality improving over time.

---

## Issue 4: Multi-Project Context Bleeding — The Wrong Project Problem

### What the draft says

The schema supports `projectId: null` for user-level cross-project memories (preferences). The `source.branch` field enables branch-scoped retrieval. Multi-tenant safety is covered in Section 17. The `visibility` field controls access at the project/team/private level.

### The edge case

User-level memories (preferences, conventions the user applies everywhere) are intended to be cross-project. But the line between "a preference I have everywhere" and "a pattern that only applies to this project" is fuzzy, and users will create memories in the wrong scope.

Consider: a user has two projects — one React, one Vue. They set a `preference` memory: "always use functional components." That preference is stored at user level. In the Vue project, the agent now applies a React-centric pattern incorrectly.

A second scenario: a user has a work project and a personal side project. They pin a `decision` memory about database architecture in the work project. Two months later, they start a personal project and the agent references "our established pattern of using PostgreSQL" — referring to the work project's decision. The user doesn't realize why the agent has strong opinions about their personal project's database choice.

### Concrete recommendations

**Explicit scope assignment on every memory creation.** When an agent records a memory (or the user creates one manually), the default should require explicit scope confirmation: "This memory will apply to [Project Name only / all your projects / your team]. Change scope." The current draft defaults agent-created to `project` and user-created to `private` — this is good, but the UI should make these defaults visible and easy to change without opening settings.

**Scope filter as a primary navigation element.** In the Memory Browser, the scope filter ("This project / All projects / Team") should be prominent — not buried in filter pills alongside type filters. Users need to know immediately which scope they're looking at.

**Cross-project memory warnings.** When a cross-project preference is about to influence an agent session in a project where it might not apply, surface a gentle warning: "Using your general preference for functional components — this project uses Vue. Is that still what you want?" This should not block the agent, but should be logged and surfaced after the session.

**Scope migration workflow.** Provide a way to move a memory from user-level to project-level (and vice versa) without recreating it. Users will get this wrong initially and need a way to correct it without losing the memory content and history.

---

## Issue 5: The Correction Flow — Updating Without Losing History

### What the draft says

Section 16 describes the rollback mechanism: user clicks "This memory is wrong," which sets `deprecated: true` and creates a `supersedes` relation on the replacement. The conflict notification in the UI table is marked P2.

### The edge case

Users need to update memories that are partially right, not entirely wrong. The draft's model is binary: a memory is either current or deprecated. Real knowledge is more nuanced.

A `decision` memory says: "We use JWT with 24h expiry." The team decides to add Redis session validation on top of JWT. The original decision isn't wrong — it's incomplete. Setting it to `deprecated: true` removes true historical information. Creating a new memory with `supersedes` loses the context that there was an evolution, not a reversal.

Also: when a memory is superseded, the agent should understand the relationship between old and new — not just receive the new memory. "We originally used JWT without session validation, and added Redis validation after encountering logout issues" is more useful context than just "we use JWT with Redis validation."

### Concrete recommendations

**Edit-in-place with version history.** Memory cards should support inline editing that preserves the previous version. Show the edit history as a collapsed timeline: "Updated 3 times — view history." This preserves the evolution narrative while keeping the current state clean.

**Supersedes relationship displayed as a narrative.** When a memory has a `supersedes` chain, the Memory Browser should optionally display this as a timeline: "Original decision (March) → Updated (April) → Current (June)." The agent should receive this timeline for `decision` type memories, not just the current state.

**"Refine" vs "Contradict" distinction.** Give users two correction modes. "Refine" appends to the existing memory with a note: "Updated: added Redis validation requirement." "Contradict" creates a formal supersession. This maps to how knowledge actually evolves — gradual refinement vs fundamental reversal.

**Bulk correction for outdated memories.** After a major refactor, users should be able to mark a category of memories as "needs review" and work through them systematically — not one by one. A "Review stale memories" workflow that surfaces memories older than N days that haven't been accessed would reduce the maintenance burden.

---

## Issue 6: Memory Overflow and Fatigue — The Too-Much-Memory Problem

### What the draft says

Rate limits are defined: 50 memories per session, 2KB max per content field. Decay rates are defined per memory type. MMR reranking prevents injecting duplicate memories. Semantic deduplication (cosine > 0.92) prevents bloat.

### The edge case

The draft addresses technical bloat but not psychological bloat. A user who has been using Auto Claude for six months might have 3,000 memories across multiple projects. The decay and scoring system means most of these will never surface — but the user doesn't know that. Looking at a Memory Browser showing 3,000 entries feels overwhelming, and the instinct is to delete everything and start fresh.

There is also a fatigue pattern at the session level: the "Here's what I learned" session-end summary (P1 in UI table) will, over time, feel like homework. After 100 sessions, the user stops engaging with it. At that point, the memory quality degrades because no one is correcting agent errors, but the user doesn't know the quality has degraded.

### Concrete recommendations

**Memory health dashboard, not a memory list.** Reframe the Memory Browser primary view from "here are all your memories" to "here is the health of your memory system." Show: total memories (but de-emphasized), active memories (those with high confidence scores that are actually being injected), stale memories (high decay, low access), and memories that need review. The user's job is health maintenance, not list management.

**Progressive disclosure by relevance.** Default the Memory Browser to showing only the top 20 most active memories (highest confidence score + recent access). Provide a "Show all" option. Most users never need to see the full corpus — they need to see what's actually influencing their agents.

**Session-end summary with effort calibration.** The "Here's what I learned" panel should adapt based on user engagement. If the user consistently dismisses it, reduce frequency (show only when agent learned something categorized as high-value). If the user consistently engages, keep showing it. Track engagement, not just exposure.

**Periodic memory audits.** Once per week (or per N sessions), surface a focused prompt: "I found 3 memories that may be outdated. Want to review them now? (2 min)" This replaces the passive decay model with an active maintenance loop that fits into the user's workflow.

**"Clean start" affordance.** For users who want to reset without losing everything, provide an "Archive all" option that moves all memories to a hidden archive rather than deleting them. The agent starts fresh. The archive is available for recovery. This addresses the impulse to delete without the permanence risk.

---

## Issue 7: Team Dynamics — Shared Memory Conflict

### What the draft says

Section 16 defines `visibility: 'private' | 'team' | 'project'`. Section 17 defines RBAC: owner (full CRUD), team-member (read all team, write own, cannot delete others'), team-admin (full CRUD + audit log). Memory conflict notification is P2 in the UI table.

### The edge case

The draft addresses permission structure but not the social dynamics of shared memory. When a team member reads a memory that a colleague created — especially a `decision` or `convention` memory — they may disagree with it. But they can only flag it through their own team-member account as a private correction. The team then operates on two diverging memory states: the shared `team` memory (which they can read but not modify) and their private correction (which other team members can't see).

The result is silent disagreement encoded in memory, where one team member's agent behaves differently from another's because of invisible private corrections.

There is also an onboarding edge case: a new team member joins and is granted access to the project. They receive 400 team memories created over the past year. There is no mechanism for understanding the context of old team memories — why they exist, whether they're still applicable, who has questioned them.

### Concrete recommendations

**Memory discussion threads.** For `team` and `project` visibility memories, allow team members to add comments, not just corrections. A comment might be: "This was true until we upgraded to v3 — double-check before applying." Comments are visible to all team members and are not corrections — they do not affect the memory's confidence score or deprecated status. They provide context without authority conflicts.

**Team memory ownership and stewardship.** Introduce the concept of a memory "steward" — not just a creator. When a `team` memory is created, the creator is automatically the steward. Any team member can request stewardship. The steward is responsible for keeping the memory current. Surfacing stewardship makes team memory feel like a shared document with an owner, not an anonymous artifact.

**New member onboarding flow.** When a user joins a project team for the first time, don't dump 400 memories on them. Show the 20 most foundational memories (highest confidence `decision` and `convention` type) as a guided tour: "Here are the 5 most important things to know about how this team works." This is also a social proof mechanism — new members feel like they're inheriting wisdom, not noise.

**Conflict escalation.** When a team-member flags a `team` memory as wrong, do not silently deprecate it from their view. Surface the disagreement to the memory steward and team-admin: "Alex flagged the auth architecture decision as potentially outdated. Do you want to discuss?" This prevents the silent divergence problem.

---

## Issue 8: Cloud Transition — The Migration Experience

### What the draft says

Section 8 describes the migration flow: run SecretScanner on all local memories, show user a preview ("127 memories across 3 projects"), allow exclusion of specific projects, re-embed with cloud model, upload to Convex, mark local DB as "synced, cloud-primary," future ops go to cloud.

Section 9 addresses offline behavior: if CloudStore fails with a network error, throw and surface "Memory unavailable — offline." Do not silently fall back to local.

### The edge case

The migration preview ("127 memories across 3 projects — review before uploading") is technically correct but experientially underspecified. What does "review" mean in this context? If the user is shown 127 memory cards, they will not review them — they will click "upload all" immediately. The review step provides false safety.

The deeper issue: the migration is a trust event, not a technical event. The user is being asked to move personal project knowledge — potentially including descriptions of bugs, architectural weaknesses, code patterns, and work history — to a cloud service. They need to understand not just what is being uploaded, but who can see it, how it is secured, and what happens if they want to remove it later.

The offline behavior (throw rather than fall back) is technically correct but creates a UX problem: an agent session starts, the user's cloud memory is unavailable, and the agent silently proceeds without any memory context. The user sees an agent behaving as if it has no knowledge of the project. They do not know why. This is particularly jarring for power users who have built up significant memory over months.

### Concrete recommendations

**Migration as a ceremony, not a step.** The local-to-cloud migration should be a distinct, intentional event with a dedicated screen — not a modal overlaid on the settings page. The screen should include:
- A clear explanation of what is stored in the cloud and under what terms
- A visual breakdown of what will be migrated (by project and by type, not just a count)
- An explicit disclosure that embeddings are derived from code content
- A privacy-first option: "Embed locally, sync vectors only" (already planned in Section 12)
- A "not now" option that does not nag again for at least 30 days

**Secret scan results visible to user.** If the SecretScanner finds and redacts content before migration, show the user exactly what was redacted and why — before upload, not after. This is a trust signal: "I found a potential API key in one memory and removed it before uploading." Hiding the redaction undermines confidence in the security process.

**Offline graceful degradation UX.** When cloud memory is unavailable, the agent should open with an explicit inline notice: "Memory unavailable this session — I'm working without project context. I'll use memory again once your connection is restored." This prevents the user from misattributing agent behavior to intelligence degradation rather than connectivity.

**Post-migration health check.** After migration, run a comparison: top 10 most-accessed memories retrieved from cloud vs from local. If the results diverge significantly (due to embedding model differences between local and cloud), surface a warning: "Some memories may retrieve differently with cloud embeddings. Spot-check recommended." This is an edge case that the draft acknowledges (re-embed with cloud model) but does not address at the UX level.

---

## Issue 9: Privacy and Forgetting — The Right to Be Forgotten

### What the draft says

Section 15 describes soft-delete with a 30-day grace period: user deletes project → all memories get `deletedAt`, appear in search results filtered out, permanently deleted after 30 days, user can restore within 30 days. Section 17 mentions GDPR compliance: `exportAllMemories()`, "Delete All My Data" workflow, consent capture.

### The edge case

The soft-delete model assumes the user wants to delete memories at the project level. It does not address the more common scenario: the user wants to delete a specific memory because it contains something they should not have shared — a snippet of code that includes a real API key that the SecretScanner missed, a description of a security vulnerability in their work project, or a reference to a colleague's work product.

There is also a temporal privacy issue: when a user works on a client project in Auto Claude, the memories created during that engagement belong to the user but describe the client's codebase. When the engagement ends, those memories should not persist as institutional knowledge — they are confidential client information. The draft has no mechanism for time-bounded memory retention beyond the soft-delete.

For cloud users, "Delete All My Data" is a regulatory requirement, but it needs to be more than a settings menu item — it needs a confirmation flow that explains what is being deleted (including embeddings, which are listed in the draft as derived personal data under GDPR) and provides a receipt.

### Concrete recommendations

**Individual memory deletion with immediate effect option.** Alongside the standard "delete with 30-day grace period," provide a "Delete immediately and permanently" option for urgent cases. Show a clear warning: "This cannot be undone. Are you sure?" Use this path for the user who has just discovered a real secret in a memory.

**Memory retention policies.** Allow users to set per-project retention policies: "Auto-delete all memories for this project after 90 days" or "Never retain memories for this project." This addresses the client project scenario without requiring manual cleanup.

**Explicit secret-scan disclosure on first memory save.** The first time a user creates or the system creates a memory, show an inline notice: "Auto Claude scans memory content for secrets before storing. If something slips through, you can delete individual memories anytime." This sets expectations about the security model without overwhelming the first-run experience.

**GDPR deletion flow with export-first option.** When a user initiates "Delete All My Data," offer export-first: "We recommend exporting your memories before deleting. Your memories cannot be recovered after deletion." Provide the export link inline. The export itself should include a machine-readable format (JSON) and a human-readable format (Markdown) as the draft specifies, but also a plain-text summary that could serve as a data subject access request response.

**Audit log for deletions.** For team/cloud scenarios, maintain an audit log of who deleted what memory and when. This is a GDPR-adjacent requirement and a trust signal for teams — administrators can verify that data deletion requests were honored.

---

## Issue 10: The Wow Moment — Making It Land

### What the draft says

Section 19 describes the target experience: user returns to a project after two weeks, agent opens with "Last time we worked on auth, we hit a JWT expiration edge case — I've already accounted for that in this plan." The five technical steps to make it happen are described.

### The edge case

The draft describes the mechanism correctly but misses the presentation layer. The wow moment fails if:

- The agent references the memory too casually, buried in a longer response
- The user doesn't notice that the agent is referencing past context vs generating fresh analysis
- The memory reference is accurate but the user doesn't remember the original incident, so the callback feels strange rather than impressive
- The agent references a memory that is slightly wrong, and the "wow" immediately becomes distrust

There is also a timing problem: the wow moment is designed for users returning after a gap. But the first wow moment needs to happen in the first three sessions, not after two weeks. Users who don't experience a tangible benefit from memory within their first few sessions will mentally categorize it as a passive background feature and stop engaging with the Memory Browser.

### Concrete recommendations

**Make the memory reference visually distinct in agent output.** When an agent uses a memory in its response, highlight the memory citation distinctly — similar to a footnote reference. "I've accounted for the JWT expiration edge case from the March 15 auth session [memory ref]." The citation is interactive: clicking it opens the specific memory card. This makes the wow moment undeniable — the user can literally see their past knowledge being applied.

**Design the first three sessions for memory discovery.** The first three sessions on a new project should be instrumented to surface memory creation explicitly. After Session 1: "I recorded 4 things about your project's conventions." After Session 2: "I remembered 2 things from last time — here's what I used." After Session 3 (the first real wow): highlight a moment where past knowledge directly influenced the agent's approach. If Session 3 doesn't produce a natural wow moment, the system should find the best available callback and surface it: "I noticed you're working in the same module as last session — here's what we learned."

**Wow moment notification, not just inline reference.** For returning users (gap of 3+ days), open the session with a dedicated card: "Welcome back to [Project]. Since your last session, I've been keeping these things in mind: [3 most relevant memories]." This is distinct from the standard system prompt injection — it's an explicit acknowledgment of continuity that surfaces before the agent starts working.

**Measure and optimize for wow.** The `memoryHits` metric in the draft (memories referenced in agent output) is necessary but not sufficient. Add a `wowRate` metric: the percentage of sessions where the agent's memory reference was noticed and positively engaged with by the user (clicked, confirmed correct, or shared). If `wowRate` drops below a threshold, trigger a memory quality review — the system is injecting memories but users are not finding them meaningful.

**Protect the wow moment from false positives.** A wrong memory reference is 10x more damaging than a correct one is beneficial. For the first three sessions with a new user on a project, apply a higher confidence threshold for memory injection: only inject memories with confidence score > 0.8 (vs the normal threshold). The user's first experience of memory should be reliably accurate, even at the cost of fewer references. Accuracy in early sessions builds the trust necessary for users to rely on the system long-term.

---

## Summary Table

| Issue | Risk Level | Draft Coverage | Key Gap |
|-------|-----------|----------------|---------|
| 1. Wrong Memory Problem | Critical | Partial (rollback mechanism exists but relies on user finding Memory Browser) | No point-of-damage correction, no inline attribution |
| 2. Trust and Transparency | High | Partial (schema has provenance fields) | Provenance not surfaced in UI design |
| 3. First-Run UX | High | Partial (cold start described technically) | No guided onboarding, no initialization status |
| 4. Multi-Project Context Bleeding | Medium | Partial (scope fields exist) | No scope confirmation flow, no cross-scope warnings |
| 5. Correction Flow | Medium | Partial (deprecated flag exists) | No edit-in-place, no version history, binary model for nuanced knowledge |
| 6. Memory Overflow | Medium | Partial (decay rates, deduplication) | No health dashboard, no psychological bloat addressed |
| 7. Team Dynamics | Medium | Partial (RBAC defined) | No discussion threads, no conflict escalation, no new member onboarding |
| 8. Cloud Transition | High | Partial (migration steps listed) | Migration is a ceremony, not a checklist; offline graceful degradation UX missing |
| 9. Privacy and Forgetting | Medium | Partial (soft-delete, GDPR mentioned) | No immediate-delete for urgent cases, no retention policies |
| 10. Wow Moment | High | Partial (mechanism described) | No visual distinctiveness, no early-session design, no accuracy threshold for first impressions |

---

## Prioritization for V1

The following UX elements are required in V1 to avoid the system actively harming user trust:

**Must-ship (trust-critical):**
- Inline memory citation in agent output with click-to-open (Issue 1, Issue 10)
- Session-end correction prompt alongside "What I learned" (Issue 1)
- Provenance visible on every memory card without expanding (Issue 2)
- Initialization status indicator when project is added (Issue 3)
- Offline graceful degradation message at session start (Issue 8)
- Immediate-delete option for individual memories (Issue 9)

**Should-ship for quality UX:**
- First-run guided onboarding for Memory tab (Issue 3)
- Scope confirmation on memory creation (Issue 4)
- Memory health dashboard as primary view (Issue 6)
- Higher confidence threshold for first three sessions (Issue 10)

**Phase 2/3 (important but not blocking):**
- Team discussion threads (Issue 7)
- New member onboarding flow (Issue 7)
- Bulk correction workflow (Issue 5, Issue 6)
- Memory retention policies (Issue 9)
- Migration ceremony screen (Issue 8)

---

*End of UX Edge Case Analysis*
