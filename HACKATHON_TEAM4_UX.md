# Memory UX + Developer Trust — Hackathon Team 4 (Enhanced V2)

**Angle:** Make memory a visible, controllable, and delightful first-class product feature that developers actually trust — across Electron desktop, web, and teams.

**Date:** 2026-02-22 (enhanced from V1 draft, 2026-02-21)

**Built on:** V3 Memory Design Draft + competitive research + AI trust UX patterns

---

## Table of Contents

1. [Executive Summary — Memory UX as Competitive Moat](#1-executive-summary)
2. [Competitive UX Analysis](#2-competitive-ux-analysis)
3. [Design Principles — Trust, Transparency, Control, Delight](#3-design-principles)
4. [Memory Panel Design](#4-memory-panel-design)
   - 4.1 Health Dashboard (default view)
   - 4.2 Module Map View
   - 4.3 Memory Browser
   - 4.4 Memory Chat — Ask Your Project Memory
   - 4.5 Agent Output Attribution
   - 4.6 Session End Summary
   - 4.7 Memory Correction Modal
   - 4.8 Teach the AI Workflow
   - 4.9 First-Run / Cold Start Experience
   - 4.10 Cloud Migration Ceremony
   - 4.11 Team Memory Features
   - 4.12 Memory Health Audit
   - 4.13 Micro-interactions and Delight
5. [Trust Progression System](#5-trust-progression-system)
6. [Cloud Sync and Multi-Device](#6-cloud-sync-and-multi-device)
7. [Team and Organization Memories](#7-team-and-organization-memories)
8. [Privacy and Data Controls](#8-privacy-and-data-controls)
9. [Export and Import](#9-export-and-import)
10. [React Component Architecture](#10-react-component-architecture)
11. [Tailwind / Radix Component Mapping](#11-tailwind--radix-component-mapping)
12. [Implementation Priority Order](#12-implementation-priority-order)
13. [Recommendations for V4](#13-recommendations-for-v4)

---

## 1. Executive Summary

### Memory UX as the Defining Competitive Advantage

The memory system is not a feature. It is the product's primary value proposition and its most significant trust risk simultaneously. Get it right and Auto Claude becomes indispensable — the coding tool that actually gets smarter the longer you use it. Get it wrong — invisible memory, wrong facts injected silently, no correction path — and it becomes the tool developers actively distrust and eventually abandon.

The competitive research is stark: no major AI coding tool has solved this problem. ChatGPT's memory is generic and consumer-oriented. Claude (Anthropic) introduced memory in late 2025 but it is opt-in, list-based, and disconnected from code structure. Cursor has rules files — static documents the user writes manually, no session-to-session accumulation. Windsurf Cascade generates memories autonomously but surfaces them to no one — users discover memory exists only when agent behavior mysteriously changes. GitHub Copilot has no persistent memory at all.

The space to own: **structured, transparent, controllable, code-aware memory with provenance** — where the user is always the authority, every memory is visible and correctable, and the system demonstrates its value by showing the developer exactly what it knows, why it knows it, and how it used that knowledge to save them time.

This document defines the complete UX system for achieving that outcome across:
- The Electron desktop app (primary, local-first, privacy-focused)
- The web app (cloud, team collaboration)
- The trust progression system that takes users from skeptical to reliant
- The cloud sync and team memory systems that extend value beyond individual use

### The Three Moments That Build or Break Trust

1. **The Citation Moment**: The first time the agent says "I remembered from our last session..." and gets it right. This is the moment users stop being skeptical. Design for it explicitly.

2. **The Correction Moment**: The first time the agent uses a stale or wrong memory. If correction is hard or invisible, this destroys trust permanently. If correction is one click and immediate, it becomes a trust-building moment — users see the system is corrigible and honest.

3. **The Return Moment**: When a developer opens a project after days away and the agent picks up exactly where things left off. This is the emotional payoff — the feeling that their AI partner actually knows them and their codebase.

All three moments must be explicitly designed for. None will happen by accident.

---

## 2. Competitive UX Analysis

### 2.1 ChatGPT Memory (OpenAI)

**What it does:** Persistent memory across conversations. Users can view, edit, and delete memories from a Settings panel. Paid tiers get richer memory; free users get a lighter version. In 2025-2026, project-scoped memories separated work from personal use.

**Strengths:**
- User control is first-class — view/edit/delete is straightforward
- Per-project memory isolation is a sound design
- "Temporary chat" mode for sessions that should not create memories
- Opt-in with clear mental model: "ChatGPT remembers helpful things"

**Weaknesses:**
- Memories are generic natural-language strings — no structure, no confidence scoring, no provenance
- No citation in responses — you never know when memory influenced an answer
- No decay — stale memories persist indefinitely unless manually deleted
- No code-awareness — treats a codebase convention the same as a food preference
- List UX with search but no filtering by type, recency, or relevance
- No session-end review — memories accumulate silently

**Lesson for Auto Claude:** Adopt the user-control model but add structure, provenance, code-awareness, and citation that ChatGPT lacks.

---

### 2.2 Claude (Anthropic)

**What it does:** Launched to Pro and Max users in October 2025. Automatic memory creation from conversations. Users can audit what Claude remembers, instruct it to forget data points. Per-project memory separation. Enterprise teams can configure memory policies.

**Strengths:**
- Automatic memory creation without user burden
- Granular controls for enterprise/team settings
- Privacy-first framing — opt-in, manageable, auditable
- Memory scoped to projects rather than global for all users

**Weaknesses:**
- Still primarily a conversation assistant, not a code-aware agent
- No structural memory types — just natural language facts
- No confidence scoring, no decay
- No code structure awareness (file/module scoping)
- Citation in responses is limited or non-existent
- No session-end review flow

**Lesson for Auto Claude:** The memory privacy framing from Anthropic is worth adopting. The code-specific layer (file scoping, confidence, types, citation) is Auto Claude's differentiator.

---

### 2.3 Cursor

**What it does:** Two memory mechanisms — `.cursorrules` / `.cursor/rules/*.mdc` (static project rules), and in 2025 added a Memory feature for session context. The rules files are manually authored by the developer.

**Strengths:**
- Project rules are version-controlled and sharable via git — elegant for teams
- Developer has complete control over content (since they wrote it)
- Rules files transfer easily to new team members with the repo

**Weaknesses:**
- 100% user burden — the system never learns anything automatically
- No session-to-session accumulation — rules are static
- No provenance — rules files have no timestamps, no source
- No confidence scoring — a stale rule and a current rule look identical
- Memory feature (2025) has privacy mode restrictions that limit cross-session memory
- No citation — you never know which rule influenced a suggestion
- Onboarding for new projects is a blank slate

**Lesson for Auto Claude:** The `.cursorrules` team-sharing pattern (checked into git) is worth supporting as an import source. Auto Claude's automated learning eliminates the user burden that Cursor imposes.

---

### 2.4 Windsurf Cascade (Codeium)

**What it does:** Cascade generates memories autonomously across conversations. Tracks edits, commands, conversation history, clipboard, terminal commands to infer intent. Memories persist between sessions.

**Strengths:**
- Genuinely automatic memory — no user burden
- Tracks more signals than any competitor (clipboard, terminal, conversation)
- Stated goal of "keeping you in flow" by not making users repeat context

**Weaknesses:**
- Opaque — memories created silently with no user visibility
- No edit/delete UI for individual memories as of 2025 reports
- No provenance — you cannot see when or why a memory was created
- "Spooky action at a distance" — agent behavior changes for unexplained reasons
- No session-end review — memories accumulate without consent
- No confidence scoring or decay
- Privacy concerns: memory creation logic is not visible to users

**Lesson for Auto Claude:** Windsurf proves automatic memory is technically achievable and appreciated by users. It also provides a cautionary tale — invisible automatic memory without user control is a trust time-bomb. The Observer + Session End Review pattern directly addresses this.

---

### 2.5 GitHub Copilot

**What it does:** No cross-session memory. Workspace context injected from currently open files. Ephemeral context per session. In 2025, added some workspace indexing for better project understanding but not persistent learned memory.

**Strengths:**
- Zero risk of stale or wrong memories influencing suggestions
- Simple mental model — every session starts fresh

**Weaknesses:**
- Forces users to re-explain the same context every session
- No accumulation of gotchas, error patterns, or conventions
- No sense of the tool growing with the project
- Highest re-discovery cost of all competitors

**Lesson for Auto Claude:** Copilot's blank-slate model is the alternative developers have been living with. Every memory feature Auto Claude ships is an improvement over this baseline — frame accordingly.

---

### 2.6 Notion AI

**What it does:** AI "awareness" of your entire Notion workspace. Answers questions from your documents. Memory is implicit in the documents themselves, not extracted as structured facts.

**Strengths:**
- Deep integration with the workspace — knowledge is where the work is
- No separate memory system to maintain — documents are the memory
- Good for reference and search

**Weaknesses:**
- Knowledge scattered across pages rather than distilled into actionable facts
- No "here's what I know about this module" view
- No code-specific awareness
- No agent context injection — good for chat, weak for autonomous agents
- No confidence or decay — a 3-year-old document and yesterday's update look the same

**Lesson for Auto Claude:** The document-as-memory mental model works for knowledge management but not for agent context injection. Structured typed memories with scoping are necessary for agent-first use.

---

### 2.7 Rewind.ai / Limitless

**What it does:** Privacy-first full context capture of everything seen on screen and spoken in calls. Timeline UX for scrubbing to exact moments. Natural language search.

**Strengths:**
- Brilliant timeline UX — "what did we decide last Thursday?" with a scrub
- Natural language search over captured context
- Privacy-first framing with on-device processing

**Weaknesses:**
- Passive recording designed for human recall, not agent injection
- Too much noise for agent context — no filtering, synthesis, or structure
- No confidence scoring, no decay, no type classification
- Not code-aware — captures screen pixels, not semantic code understanding

**Lesson for Auto Claude:** The timeline UX for viewing memory history ("what did the agent learn on March 15?") is worth borrowing for the Activity Log. The privacy-first on-device processing framing directly applies to Auto Claude's Electron-first deployment.

---

### 2.8 Mem.ai

**What it does:** Personal knowledge management with AI. Card-based memory with natural language search. Auto-captures notes from email, Slack, meetings. AI assistant surfaces relevant memories in response to queries.

**Strengths:**
- Card-based memory UI is intuitive and browsable
- Natural language search is excellent
- Collections and tagging for organization

**Weaknesses:**
- No temporal threading — cannot see how a memory evolved over time
- No "memory used this session" log
- No confidence scoring or decay
- Equal-weight all memories — no type-based ranking or phase-awareness
- Not code-aware
- No citation in assistant responses

**Lesson for Auto Claude:** The card-based memory browser is the right mental model for the Memory Browser view. The collection/tagging pattern maps to scope filtering (project / module / global).

---

### 2.9 The Opportunity Gap — What Nobody Has Built

| Capability | ChatGPT | Claude | Cursor | Windsurf | Copilot | Auto Claude Target |
|---|---|---|---|---|---|---|
| Automatic memory creation | Partial | Partial | No | Yes | No | Yes |
| User can view all memories | Yes | Yes | Yes (manual) | No | N/A | Yes |
| Memory provenance | No | No | No | No | N/A | Yes |
| Code-file scoping | No | No | No | No | No | Yes |
| Confidence scoring | No | No | No | No | N/A | Yes |
| Memory decay | No | No | No | No | N/A | Yes |
| Citation in agent output | No | No | No | No | No | Yes |
| Session-end review | No | No | No | No | N/A | Yes |
| Point-of-damage correction | No | No | No | No | N/A | Yes |
| Team-scoped sharing | Enterprise | Enterprise | Via git | No | No | Yes (cloud) |
| Module map visualization | No | No | No | No | No | Yes |
| Local-first / privacy-first | Partial | Partial | Partial | No | No | Yes (Electron) |

Auto Claude can own every cell in that last column. No competitor is close.

---

## 3. Design Principles

### Principle 1: Memory Is a Conversation, Not a Database

The mental model for users should be "my AI partner knows these things about our project" — not "there are 247 rows in a SQLite table." Every UI touchpoint reinforces this framing:

- Health Dashboard, not Memory Management
- "Getting to know your project" not "Initializing vector store"
- "The agent remembered" not "Memory retrieval successful"
- "Teach the AI" not "Create memory record"
- "This is what we learned" not "New memories created: 4"

Language choices compound over time into the user's mental model. Every string matters.

---

### Principle 2: Show the Work

Every time memory influences agent behavior, it must be visible. This means:

- Inline citation chips in agent output for every memory reference
- Session-end summary showing which memories were used vs. injected
- Memory Browser showing access count and last-used date per memory
- Health Dashboard showing "7 memories injected, 3 referenced this session"

The agent citing a memory should feel like a colleague saying "remember when we fixed that last time?" — not a mysterious oracle producing correct answers for unknown reasons.

---

### Principle 3: The User Is Always the Authority

The system creates candidate memories. The user confirms, corrects, or deletes them. This power dynamic must be reinforced at every touchpoint:

- Session-end review: confirm/edit/reject per new memory before it is permanent
- First-run seed review: "Tell me if anything looks wrong — you're always the authority"
- Memory cards always show [Flag Wrong] as a primary action, not buried in a menu
- Correction modal always available at point of damage (on citation chips in agent output)
- Teach panel always available — user can add, override, pin any memory

Trust requires that users feel in control. The system should never feel like it is doing things to the user's knowledge base without permission.

---

### Principle 4: Trust Is Earned Per Memory, Per Session

New memories start with lower injection thresholds and require more explicit confirmation. As the system proves accuracy — memories are confirmed by users, used successfully without correction, reinforced across multiple sessions — they earn higher confidence and can be injected more silently.

This is the Trust Progression System (detailed in Section 5). Key behaviors:
- Sessions 1-3: Only inject memories with score > 0.8, require session-end confirmation for all new memories
- Sessions 4-15: Lower threshold to 0.65, batch confirmation (confirm all / review individually)
- Sessions 16+: Standard injection, user-confirmed memories injected without confirmation prompts
- User can always move back to a more conservative level per project

---

### Principle 5: Delight Through Continuity

The emotional payoff — the moment that converts users from skeptical to loyal — is the return moment: a developer opens a project after days away, starts a session, and the agent already knows the context. It references the same quirk they fixed last Tuesday. It doesn't re-explore files it already understands.

Design deliberately for this moment:
- After session, toast: "4 memories saved — your AI will remember these next time"
- At session start (when memories are injected): subtle "Using context from previous sessions" indicator
- At the "wow moment" (first session where memory demonstrably helps): explicit card in session-end summary
- Session 2 onboarding: "Last time you worked on this project, the agent learned..."

---

### Principle 6: Privacy by Default, Sharing by Choice

The Electron desktop app stores all memories locally. Nothing leaves the device without explicit user action. Cloud sync is an opt-in migration — not the default. This is not a regulatory checkbox but a genuine design value.

For users who do sync to cloud, they control:
- Which projects are included (per-project on/off)
- Whether content or only vectors sync (vectors-only mode stays private)
- Whether team members can see shared memories (team memory scoping)
- Which memories are personal vs. project vs. team level

---

## 4. Memory Panel Design

### Navigation Structure

```
Context Panel (existing sidebar in Electron app)
├── Services tab (existing)
├── Files tab (existing)
└── Memory tab (REDESIGNED — first-class)
    ├── Health Dashboard (default view)
    ├── Module Map
    ├── Memory Browser
    └── Ask Memory

Web app adds:
└── Team Memory (cloud only, when team sync enabled)
```

---

### 4.1 Memory Health Dashboard (Default View)

**Purpose:** At-a-glance health of the memory system. Primary entry point for all memory interaction. Reframes memory as system health — not database management.

```
+---------------------------------------------------------------------+
|  Project Memory                              [+ Teach]  [Browse]   |
+---------------------------------------------------------------------+
|                                                                     |
|  +----------------+  +----------------+  +----------------+        |
|  |  247           |  |  89            |  |  12            |        |
|  |  Total         |  |  Active        |  |  Need Review   |        |
|  |  Memories      |  |  (used 30d)    |  |                |        |
|  +----------------+  +----------------+  +----------------+        |
|  (neutral)           (green accent)       (amber accent when > 0)  |
|                                                                     |
|  Memory Health Score                                               |
|  [===========================-----]  78 / 100   Good               |
|  ^ 4 points since last week                                        |
|                                                                     |
|  Module Coverage                                                   |
|  +--------------------------------------------------------------+  |
|  |  authentication   [====================]  Mapped    (check)  |  |
|  |  api-layer        [============--------]  Partial   (~)      |  |
|  |  database         [=========----------]   Partial   (~)      |  |
|  |  frontend         [====----------------]  Shallow   (up)     |  |
|  |  payments         [--------------------]  Unknown   (?)      |  |
|  +--------------------------------------------------------------+  |
|  Click any module to view its memories                             |
|                                                                     |
|  Recent Activity                                                   |
|  * 3h ago   Coder agent added 4 memories during auth task          |
|  * 1d ago   You corrected 1 memory  [view]                         |
|  * 3d ago   Session ended: 8 memories recorded  [view]             |
|                                                                     |
|  Needs Attention (hidden when empty)                               |
|  +--------------------------------------------------------------+  |
|  |  [!] 3 gotcha memories haven't been used in 60+ days         |  |
|  |  Archive or keep?   [Review now]   [Remind me in 30 days]   |  |
|  +--------------------------------------------------------------+  |
|                                                                     |
|  This Session                                                      |
|  Memory saved ~4,200 tokens of file discovery                      |
|  7 memories injected   *   3 referenced by agent in output         |
|                                                                     |
+---------------------------------------------------------------------+
```

**Component breakdown:**

**Stats row** — Three metric cards using `bg-card border rounded-lg p-4`. Numbers large (`text-3xl font-mono`), labels small (`text-xs text-muted-foreground`). "Need Review" card uses amber accent when > 0, green when 0. Cards are clickable: "Total" opens Memory Browser, "Active" opens Browser filtered to active, "Need Review" opens Browser filtered to `needsReview: true`.

**Health Score** — Horizontal Radix `<Progress>` with score 0-100 computed from: (average confidence of active memories × 0.4) + (module coverage percentage × 0.35) + (review activity score × 0.25). Color thresholds: red < 40, amber 40-70, green 70+. Delta indicator with up/down arrow using the same calculation run 7 days prior. Tooltip on hover explains the score components.

**Module Coverage** — Progress bars per module based on `confidence` field from ModuleMap. Fill thresholds: `unknown` = 0% (muted dashed border), `shallow` = 25% fill (muted), `partial` = 60% fill (amber), `mapped` = 100% fill (green). Each row is clickable — jumps to Memory Browser filtered to that module. Status icons: check for mapped, tilde for partial, up-arrow for improving, question for unknown.

**Recent Activity** — Time-stamped feed, most recent 3 items. Radix `ScrollArea` if > 5 items. Each item links to the session or memory it references. Agent-created events show robot icon; user-created events show person icon.

**Needs Attention** — Conditional panel (hidden when 0 items). Amber border. Surfaces cleanup prompts at most once per week. Pulls from decay system: memories with `access_count < 3` and `days_since_access > half_life * 0.75`. Maximum 5 memories shown at once regardless of how many qualify — prevents audit fatigue.

**Session Metrics** — Only shown when active session exists or session ended < 2 hours ago. "Tokens saved" estimate from `discovery_tokens_saved` field in `MemoryMetrics`. Reference count vs. injection count distinction: injection = was in context window, reference = agent explicitly cited in output text.

---

### 4.2 Module Map View

**Purpose:** Interactive visualization of the project's structural knowledge. The "where things are" layer — makes abstract codebase understanding concrete and navigable.

```
+---------------------------------------------------------------------+
|  Module Map                            [Expand All]  [Search...]   |
+---------------------------------------------------------------------+
|                                                                     |
|  +-- authentication  (5 dots filled)  Mapped  ----------------+   |
|  |  src/auth/config.ts                                         |   |
|  |  src/middleware/auth.ts                        [6 memories] |   |
|  |  src/auth/tokens.ts                                         |   |
|  |  src/routes/auth.ts                                         |   |
|  |  tests/auth/                                                |   |
|  |  Deps: jsonwebtoken * redis * bcrypt                        |   |
|  |  Related: session * user-management                         |   |
|  +------------------------------------------------------------+   |
|                                                                     |
|  +-- api-layer  (3 dots filled)  Partial  --------------------+   |
|  |  [collapsed -- click to expand]              [4 memories]  |   |
|  +------------------------------------------------------------+   |
|                                                                     |
|  +-- payments  (0 dots filled)  Unknown  ---------------------+   |
|  |  No files mapped yet. The agent will learn this module      |   |
|  |  when you work in it.          [Manually add files]         |   |
|  +------------------------------------------------------------+   |
|                                                                     |
|  Coverage: 3/5 modules mapped  *  Last updated 2h ago              |
+---------------------------------------------------------------------+
```

**Design details:**

Each module card is a Radix `Collapsible` with a header row showing: module name, confidence indicator (5-dot system: filled dots represent confidence level), confidence label, and memory count badge.

Confidence system: 5 dots rendered as filled/empty circles. dot_count = Math.round(confidence_score * 5). Colors: all green for "mapped", amber for "partial", muted grey for "shallow", dashed border for "unknown". This visual system gives instant read on which modules the agent understands well.

Expanded state shows: list of `coreFiles` as monospace pill chips, `testFiles` with test icon, `dependencies` as small tags using `text-muted-foreground`, `relatedModules` as linked text that highlights the related module card when hovered.

The `[N memories]` badge is a clickable link that opens Memory Browser filtered to that module's file paths.

"Unknown" modules use dashed border and muted colors. Empty state explains: "No files mapped yet. The agent will learn this module when you work in it." This sets correct expectations — the module map grows organically through agent work, not through manual curation.

`[Manually add files]` opens a Radix `Dialog` file picker to manually seed files into a module before the agent has worked in it — useful for critical modules the developer wants the agent to understand from day one.

---

### 4.3 Memory Browser (Refined)

**Purpose:** Search, filter, inspect, and manage individual memories. Secondary view accessed from Health Dashboard or direct navigation — not the default.

```
+---------------------------------------------------------------------+
|  <- Health Dashboard        Memory Browser                [+ Add]  |
+---------------------------------------------------------------------+
|                                                                     |
|  [Search memories...]                       [Sort: Relevance (v)]  |
|                                                                     |
|  Scope: [This Project (v)]  Type: [All (v)]  Status: [Active (v)]  |
|                                                                     |
|  Showing 20 of 247  *  [Show all]                                   |
|                                                                     |
|  +---------------------------------------------------------------+  |
|  |  GOTCHA        (4 dots filled)  High confidence               |  |
|  |  middleware/auth.ts  *  14 sessions used  *  Last: 3h ago     |  |
|  |                                                               |  |
|  |  Refresh token not validated against Redis session store when |  |
|  |  handling concurrent tab requests.                            |  |
|  |                                                               |  |
|  |  Source: [robot] agent:qa  *  Session: Mar 15  *  main        |  |
|  |                                                               |  |
|  |  [Edit]  [Pin (star)]  [Flag Wrong]  [Delete]                 |  |
|  +---------------------------------------------------------------+  |
|                                                                     |
|  +---------------------------------------------------------------+  |
|  |  DECISION      (star) Pinned  *  Never decays                 |  |
|  |  auth/config.ts  *  31 sessions used  *  Last: 1h ago         |  |
|  |                                                               |  |
|  |  JWT over session cookies for API-first architecture.         |  |
|  |  24h expiry with 1h refresh window.                           |  |
|  |                                                               |  |
|  |  Source: [person] user  *  Created Jan 8  *  Confirmed 3x     |  |
|  |  [v] History: 2 updates                                       |  |
|  |                                                               |  |
|  |  [Edit]  [Unpin (star)]  [Flag Wrong]  [Delete]               |  |
|  +---------------------------------------------------------------+  |
|                                                                     |
+---------------------------------------------------------------------+
```

**Filter system:**

Three independent dropdowns (not pill tabs):

1. **Scope** — "This Project" / "All Projects" / "Team" (cloud only). This is the most important filter — shown leftmost and widest (`min-w-44`). Scope filters determine which memory set is visible.
2. **Type** — All / Gotcha / Decision / Convention / Error Pattern / Workflow Recipe / Dead End / Module Insight / Work State / E2E Observation / Preference / Session Insight
3. **Status** — Active / Stale / Pinned / Needs Review / Deprecated / Archived

Default sort: confidence score × recency combined — most useful memories surface first. Alternative sorts: Newest / Most Used / Confidence / File Path / Memory Type.

**Memory card anatomy — full specification:**

```
+---------------------------------------------------------------+
|  [TYPE BADGE]    [CONFIDENCE DOTS (5)]   [USAGE COUNT]        |
|  [FILE ANCHOR]   [DECAY STATUS]          [LAST USED]          |
|                                                               |
|  [CONTENT -- first 2 lines, [Show more] to expand]           |
|                                                               |
|  [SOURCE ICON] [CREATOR TYPE] * [DATE] * [BRANCH/COMMIT]      |
|  [v] History: N updates  (shown only if versions > 1)         |
|                                                               |
|  [Edit]  [Pin/Unpin]  [Flag Wrong]  [Delete]                  |
+---------------------------------------------------------------+
```

**Confidence dots:** 5 dots, filled count = Math.round(confidenceScore * 5). Color: green > 0.7, amber 0.4-0.7, red < 0.4. Tooltip shows exact score: "Confidence: 0.82 (high)".

**Decay status labels:**
- "Never decays" — decision, convention, human_feedback types
- "High activity" — accessed in past 14 days
- "Active" — accessed in past 30 days
- "Aging" — 60-80% through half-life
- "Stale" — past half-life threshold (shown in amber)
- "Archived" — soft-deleted (shown only in Archived filter)

**Source provenance row (always visible, never hidden):** This is the single most important trust signal. Shows: creator icon (robot for agent-created, person for user-created) + creator type label (e.g., "agent:qa", "user", "observer:inferred") + session date + branch name where memory was created. For V3: also shows git commit SHA if `commitSha` is present.

**Pin icon:** Star outline = unpinned, gold filled star = pinned. Pinned memories show gold left border stripe. Pinned memories never decay and appear at top of sort order.

**Flag Wrong:** Opens inline CorrectionModal (see Section 4.7) pre-populated with this memory. Does not navigate away from the browser.

**Version history:** Radix `Collapsible` showing previous versions with timestamps and diff-style view. "Refined" updates show what changed. "Contradicted" updates show old → new clearly with red/green highlighting.

**Edit mode:** Inline `Textarea` replaces content text, saves a new version entry, updates `lastModifiedAt`. Cancel restores previous content.

**Delete:** Requires confirmation for permanent delete (Radix `AlertDialog`). "Archive" option presented first as softer alternative — moves to `deletedAt` soft-delete. Emergency delete (for accidental secrets) bypasses 30-day grace and hard-deletes immediately.

---

### 4.4 Memory Chat ("Ask Your Project Memory")

**Purpose:** Conversational interface for exploring accumulated project knowledge. Like Insights but drawing specifically from memories and ModuleMap, with inline citations.

```
+---------------------------------------------------------------------+
|  Ask Project Memory                                     [Clear]    |
+---------------------------------------------------------------------+
|                                                                     |
|  +----------------------------------------------------------+      |
|  |  You: What do we know about the auth system?             |      |
|  +----------------------------------------------------------+      |
|                                                                     |
|  +----------------------------------------------------------+      |
|  |  Memory: Drawing from 6 memories and auth module map     |      |
|  |                                                          |      |
|  |  The auth system uses JWT with 24h expiry and 1h refresh |      |
|  |  windows [Decision #31, Jan 8]. Redis session store is   |      |
|  |  required for refresh token validation [Gotcha #47, Mar  |      |
|  |  15] -- this was learned the hard way when concurrent    |      |
|  |  tab requests caused token conflicts.                    |      |
|  |                                                          |      |
|  |  Core files: src/auth/config.ts, middleware/auth.ts,     |      |
|  |  src/auth/tokens.ts [Module Map]                         |      |
|  |                                                          |      |
|  |  A known race condition with multiple tabs was fixed in  |      |
|  |  v2.3 with a mutex [Error Pattern #18, Feb 2].           |      |
|  |                                                          |      |
|  |  Sources:  [#31] [#47] [#18] [Module Map]               |      |
|  +----------------------------------------------------------+      |
|                                                                     |
|  +----------------------------------------------------------+      |
|  |  Ask something about your project...         [Send]      |      |
|  +----------------------------------------------------------+      |
|                                                                     |
+---------------------------------------------------------------------+
```

**Design rationale:**

Citations like `[Decision #31, Jan 8]` render as interactive chips (same amber styling as agent output citations). Clicking opens that specific memory card in a panel overlay without leaving the chat view.

`[Module Map]` citations link to the Module Map view scrolled to the referenced module.

Responses generated by the same small model used for post-session extraction, called synchronously. Response time target < 2 seconds with local Ollama; < 1 second with API if embeddings are cached.

**Access points:** Available as the "Ask" tab within the Memory panel. Also accessible via keyboard shortcut `Cmd+Shift+K` from anywhere in the app (K for "Knowledge"), and as a secondary mode within the existing Insights view.

**Empty state:** "Ask me anything about your project — what we've learned, why decisions were made, or what to watch out for in any module."

**Suggested prompts (shown in empty state):**
- "What do we know about [most-accessed module]?"
- "What gotchas should I watch out for in [recently modified file]?"
- "Why did we decide to use [detected key dependency]?"
- "What has the agent learned in the last week?"

**Teach from chat:** When the user types a correction in chat ("Actually, we moved away from Redis because..."), the system detects the correction pattern and shows a banner at the bottom: "Create a correction memory from this?" with [Save] [Dismiss]. One click creates a `human_feedback` memory with `supersedes` relation to the contradicted memory if one is identified.

---

### 4.5 Agent Output Attribution

**Purpose:** Make memory visible at the point of use — inside agent responses. The most important trust signal in the entire system.

When the agent uses a memory in its reasoning, it emits a citation marker in its output. The renderer detects the `[Memory #ID: brief text]` syntax and replaces it with an interactive chip component.

**Agent output in terminal/task view:**

```
  I'll fix the refresh token bug. Based on the JWT architecture
  decision from January [^ Memory: JWT 24h expiry decision], I'll
  keep the expiry at 24 hours but fix the Redis validation gap
  [^ Memory: Refresh token Redis gotcha].

  Let me check middleware/auth.ts first -- I know this is the core
  file for token handling based on the module map.
```

**Citation chip rendering:**

The `[^ Memory: JWT 24h expiry decision]` text renders as:
- Small rounded pill: `bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs rounded px-1.5 py-0.5`
- Up-arrow icon (lucide `ArrowUpRight` at 10px)
- Truncated text (max 28 chars) with full title in tooltip
- Clickable: opens the specific memory card in a right-side panel overlay without closing the terminal
- On hover: shows small `[!]` flag button for instant correction access

**Implementation:** Post-processing pass on agent text output stream. Pattern: `/\[Memory #([a-z0-9-]+): ([^\]]+)\]/g`. Replace with `<MemoryCitationChip memoryId={id} text={text} />`. This pattern must be taught to agents via the system prompt: "When using a memory, always include a citation in format [Memory #ID: brief description]. This helps users track which memories influence your responses."

**"Flag Wrong" inline:** Each citation chip has a `[!]` button on hover. Clicking opens the CorrectionModal pre-populated with that memory and positioned near the chip. This is the point-of-damage correction — the most important moment for trust repair.

**Dead-end citations:** When the agent avoids an approach because of a `dead_end` memory, it cites differently: `[^ Dead End: approach that was abandoned]` with red-tinted chip (`bg-red-500/10 border-red-500/30 text-red-400`). This makes visible the negative knowledge — "I know NOT to do this because we tried it."

**Volume management:** If more than 5 citations appear in a single agent response, the chips are collapsed into "Used N memories [view all]" to prevent visual overwhelm. Expanding shows the full citation list.

---

### 4.6 Session End Summary

**Purpose:** Close the learning loop after every agent session. The primary moment for the user to confirm, correct, and engage with what was learned.

```
+---------------------------------------------------------------------+
|  Session Complete: Auth Bug Fix                      [Dismiss]     |
+---------------------------------------------------------------------+
|                                                                     |
|  Memory saved ~6,200 tokens of discovery this session              |
|                                                                     |
|  What the agent remembered (used from previous sessions):          |
|  * JWT decision     -> used when planning the fix approach  [ok]   |
|  * Redis gotcha     -> avoided concurrent validation bug    [ok]   |
|  * Mutex pattern    -> applied proactively                  [ok]   |
|                                                                     |
|  What the agent learned (4 new memories):                          |
|                                                                     |
|  +----------------------------------------------------------+      |
|  |  1/4  GOTCHA  *  middleware/auth.ts             [ok][edit][x]  |
|  |  Token refresh fails silently when Redis is unreachable  |      |
|  |  vs. throwing -- callers must check return type.         |      |
|  +----------------------------------------------------------+      |
|                                                                     |
|  +----------------------------------------------------------+      |
|  |  2/4  ERROR PATTERN  *  tests/auth/             [ok][edit][x]  |
|  |  Auth tests require REDIS_URL env var -- will hang        |      |
|  |  indefinitely without it, not fail with clear error.     |      |
|  +----------------------------------------------------------+      |
|                                                                     |
|  +----------------------------------------------------------+      |
|  |  3/4  WORKFLOW RECIPE  *  global                [ok][edit][x]  |
|  |  To add a new auth middleware: 1) Create handler in      |      |
|  |  src/middleware/, 2) Register in auth.ts, 3) Add tests   |      |
|  |  in tests/auth/, 4) Update type exports.                 |      |
|  +----------------------------------------------------------+      |
|                                                                     |
|  +----------------------------------------------------------+      |
|  |  4/4  MODULE INSIGHT  *  src/auth/tokens.ts     [ok][edit][x]  |
|  |  Token rotation is atomic -- uses Redis MULTI/EXEC to    |      |
|  |  prevent race conditions on concurrent refresh requests. |      |
|  +----------------------------------------------------------+      |
|                                                                     |
|  [Save all confirmed]        [Review individual memories later]    |
|                                                                     |
|  Did I get anything wrong this session?    [Flag an issue]         |
|                                                                     |
+---------------------------------------------------------------------+
```

**UX decisions:**

This panel appears automatically after a session ends, in the task view below the terminal output. It is dismissible and stays visible for 10 minutes unless dismissed. If the user dismisses without action, memories are saved with `needsReview: true`.

**"What the agent remembered"** — Shows memories that were injected AND explicitly cited in output (not just injected — the agent must have actually referenced them). Checkmarks indicate they were used without contradiction. A warning icon with "seems outdated?" appears if the agent encountered context that conflicted with this memory.

**"What the agent learned"** — Shows new memories from post-session Observer promotion. Each memory shows:
- `[ok]` — Confirm: sets `confidenceScore += 0.1`, marks `userVerified: true`, removes `needsReview`
- `[edit]` — Opens inline textarea to edit content before saving. Saves with user's revision.
- `[x]` — Reject: sets `deprecated: true`. Memory is never injected again. Soft-deleted, visible in Deprecated filter.

This is the interception point: users can correct before a memory is ever used as authoritative. This is dramatically better than reactive correction after damage has occurred.

**"Save all confirmed"** — Marks all displayed memories as user-verified in one action. For users who trust the system's extraction during this session.

**"Review later"** — Sets `needsReview: true` on all unreviewed memories and dismisses the panel. A "12 memories need review" badge appears on the Memory tab until addressed.

**Adaptive frequency:** If the user dismisses without interaction 3 sessions in a row, reduce the summary to showing only sessions where > 3 new memories were learned. Tracked in local storage, not transmitted to cloud. The summary never disappears entirely — it is the core trust loop.

---

### 4.7 Memory Correction Modal

**Purpose:** Focused, low-friction correction at the point of damage. Accessible from citation chips, memory cards, and session summary.

```
+---------------------------------------------------------------------+
|  Correct a Memory                                          [close] |
+---------------------------------------------------------------------+
|                                                                     |
|  Memory flagged:                                                   |
|  +----------------------------------------------------------+      |
|  |  GOTCHA  *  middleware/auth.ts  *  Created Mar 15         |      |
|  |  Refresh token not validated against Redis session store  |      |
|  +----------------------------------------------------------+      |
|                                                                     |
|  What's wrong?                                                     |
|                                                                     |
|  (o) This is outdated -- we fixed this                             |
|  ( ) This is partially wrong -- let me refine it                   |
|  ( ) This doesn't apply to this project                            |
|  ( ) This contains incorrect information                           |
|                                                                     |
|  Add correction detail (optional but encouraged):                  |
|  +----------------------------------------------------------+      |
|  |  We added explicit Redis validation in v2.4 -- this is  |      |
|  |  now handled in the middleware layer with a fallback.    |      |
|  +----------------------------------------------------------+      |
|                                                                     |
|  [Deprecate original + save correction]    [Just deprecate]        |
|                                                                     |
+---------------------------------------------------------------------+
```

**Radio options map to concrete system actions:**
- "Outdated" → `deprecated: true`, creates new `human_feedback` memory as replacement if correction text provided
- "Partially wrong" → opens inline edit of existing memory content and saves as new version
- "Doesn't apply to this project" → prompts to clarify scope: remove from this project, or mark project-excluded
- "Incorrect" → `deprecated: true`, correction text is required before proceeding (bad information must have a replacement)

**"Just deprecate"** — Available for urgent removal (agent is actively using a wrong memory right now). No correction text required. Badge appears on Memory tab: "1 memory deprecated without correction — add replacement?"

**Accessibility from:**
- The `[!]` flag button on citation chips in agent output (pre-populated with that memory)
- The `[Flag Wrong]` button on memory cards in the Browser
- The `[Flag an issue]` link in session-end summary
- The `[x]` reject button in session-end summary (for new memories before they are confirmed)

The modal never navigates away from the current view. It is a Radix `Dialog` positioned relative to the triggering element.

---

### 4.8 Teach the AI Workflow

**Purpose:** Explicit user-initiated memory creation. The power-user path for encoding things the agent would not observe automatically.

**Entry points:**

1. **Global keyboard shortcut:** `Cmd+Shift+M` opens the Teach panel from anywhere in the app.

2. **Terminal slash command:** `/remember [content]` in any AI terminal creates a `human_feedback` memory immediately. Confirmation toast: "Remembered: always use bun, not npm." The terminal `/remember` command accepts flags: `/remember --type=convention --file=package.json [content]`.

3. **Right-click in file tree:** "Teach the AI about [filename]" opens the Teach panel pre-populated with the file path in the Related File field.

4. **"Remember this" on agent output:** When hovering over agent output text, a `+` button appears in the margin. Clicking opens the Teach panel with the highlighted text pre-filled.

5. **"Actually..." detection:** When the user types "Actually, we..." or "Wait, that's wrong..." in an agent terminal, the system detects the correction pattern and shows a non-intrusive banner: "Create a correction memory?" `[Yes, open Teach]` `[Dismiss]`. Banner closes automatically after 8 seconds without interaction.

6. **Import from CLAUDE.md / .cursorrules:** Offered at first-run and in Settings. Parses existing rules files and offers to convert each rule into a typed memory. (See Section 9.)

**Teach panel wireframe:**

```
+---------------------------------------------------------------------+
|  Teach the AI                                              [close] |
+---------------------------------------------------------------------+
|                                                                     |
|  What should I remember?                                           |
|  +----------------------------------------------------------+      |
|  |  Always use bun instead of npm for package management.   |      |
|  |  The project uses bun workspaces.                        |      |
|  +----------------------------------------------------------+      |
|                                                                     |
|  Type:   [Convention (v)]       Scope:  [This Project (v)]         |
|                                                                     |
|  Related file (optional):   [package.json            ]  [Browse]  |
|                                                                     |
|  Preview -- the agent will see this as:                            |
|  +----------------------------------------------------------+      |
|  |  [CONVENTION] package.json                               |      |
|  |  Always use bun instead of npm for package management.   |      |
|  |  The project uses bun workspaces.                        |      |
|  +----------------------------------------------------------+      |
|                                                                     |
|  [!] Secret scanner: no sensitive values detected                  |
|                                                                     |
|  [Save Memory]               [Save + Pin (never decays)]          |
|                                                                     |
+---------------------------------------------------------------------+
```

**Design details:**

The preview section shows exactly how this memory appears when injected into agent context. This closes the mental gap between "I'm creating a memory" and "the agent will actually see this formatted this way."

Type dropdown includes all `MemoryType` values with friendly labels. Scope dropdown: "This Project" / "All Projects" (global) / "Team" (cloud only, if team sync enabled).

"Save + Pin" sets `pinned: true` immediately. Use this for conventions the user is certain will never change.

Secret scanner runs on content before save. If triggered: inline red warning "This content may contain a sensitive value. Redact before saving?" with the detected substring highlighted. User must manually redact or dismiss the warning before saving.

A "Preview" section shows the exact context string the agent will receive. This is the most important trust feature of the Teach flow — no mystery about how what you type becomes what the agent reads.

---

### 4.9 First-Run / Cold Start Experience

**Purpose:** Onboard users to memory without anxiety. Turn 40 seconds of initialization into an exciting "getting to know you" moment that sets correct expectations from the start.

**Phase 1: Project Added — Analysis Running**

```
+---------------------------------------------------------------------+
|  Memory  *  Getting to know your project                           |
+---------------------------------------------------------------------+
|                                                                     |
|  (spinning)  Analyzing project structure...                        |
|  Reading file tree (1,247 files found)                             |
|                                                                     |
|  -------------------------------------------------------           |
|                                                                     |
|  (waiting)  Classifying modules (AI)                               |
|  (waiting)  Scanning configuration files                           |
|  (waiting)  Seeding initial memories                               |
|                                                                     |
|  This takes about 30-40 seconds. Future sessions start             |
|  instantly -- memory is already built.                             |
|                                                                     |
|  What is memory?                                                   |
|  Memory lets your AI agent pick up exactly where you left off.     |
|  Instead of re-discovering your codebase every session, it         |
|  already knows which files matter for any given task. The longer  |
|  you use Auto Claude, the smarter your agent gets for this         |
|  specific codebase.                                                |
|                                                                     |
+---------------------------------------------------------------------+
```

Steps animate: waiting circle -> spinning circle -> checkmark as each phase completes. The explanation text is shown only during initialization — never again after. This is the single educational moment. No onboarding modal, no wizard, no tooltip cascade. Just inline context at the right moment, then gone.

**Phase 2: Importing Existing Rules (if CLAUDE.md / .cursorrules found)**

```
+---------------------------------------------------------------------+
|  Memory  *  Found existing project rules                           |
+---------------------------------------------------------------------+
|                                                                     |
|  Found CLAUDE.md with 8 rules.                                     |
|  Import them as memories so the agent uses them automatically?     |
|                                                                     |
|  [Import all as memories]        [Review each first]               |
|                                                                     |
|  [Skip -- I'll set up memory manually]                             |
|                                                                     |
+---------------------------------------------------------------------+
```

"Review each first" shows the Teach panel one rule at a time, pre-filled, with type and scope inference from the rule content. User confirms, edits, or skips each one. This is the import/import flow from Section 9.

**Phase 3: Review Seeded Memories**

```
+---------------------------------------------------------------------+
|  Memory  *  Found 14 things about your project   [Skip Review]    |
+---------------------------------------------------------------------+
|                                                                     |
|  Before your first session, I noticed these conventions.           |
|  Tell me if anything looks wrong -- you're always the authority.   |
|                                                                     |
|  +----------------------------------------------------------+      |
|  |  1 of 14                                    [ok] [edit] [x]    |
|  |  CONVENTION  *  package.json                              |      |
|  |  Uses bun workspaces. Test command: bun test.             |      |
|  |  Lint: biome check. Build: electron-vite build.           |      |
|  +----------------------------------------------------------+      |
|                                                                     |
|  [<- Prev]    [Next ->]    [Confirm all remaining]                 |
|                                                                     |
|  Progress:  [====------------]  3 / 14 reviewed                   |
|                                                                     |
+---------------------------------------------------------------------+
```

Card-at-a-time review. One decision per screen. Reduces overwhelm compared to a list of 14 items.

"Confirm all remaining" skips to the end and bulk-confirms — respects users who trust the system immediately. After first session, a banner: "14 memories were confirmed — review anytime in Memory."

"Skip Review" seeds all memories with `needsReview: true`. Badge appears on Memory tab for later review. A banner appears before the first session: "14 auto-seeded memories are active — review them in Memory when you have a moment."

User framing throughout: "Tell me if anything looks wrong" and "you're always the authority" — never "the system detected" or "AI found."

**Empty State (no Ollama / local model configured):**

```
+---------------------------------------------------------------------+
|  Memory  *  Not yet active                                         |
+---------------------------------------------------------------------+
|                                                                     |
|  Your agents will still work without memory, but they'll           |
|  re-discover your codebase from scratch each session.              |
|                                                                     |
|  To activate memory:                                               |
|  1. Install Ollama  (free, runs entirely on your device)           |
|  2. Pull the embedding model:  ollama pull nomic-embed-text        |
|  3. Return here -- memory activates automatically.                 |
|                                                                     |
|  [Open Settings -> Memory]      [Learn what memory does]          |
|                                                                     |
+---------------------------------------------------------------------+
```

No error state. No failure framing. Just a clear, actionable path to activation. The "free, runs entirely on your device" framing is accurate and emphasizes the privacy-first design.

---

### 4.10 Cloud Migration Ceremony

**Purpose:** Make the local-to-cloud migration feel intentional, secure, and celebratory rather than a routine data export.

```
+---------------------------------------------------------------------+
|  Sync Memory to Cloud                                              |
|  Take your AI's knowledge with you everywhere                      |
+---------------------------------------------------------------------+
|                                                                     |
|  What will be synced:                                              |
|                                                                     |
|  Project A (My App)        156 memories  [Include (v)] [Exclude]  |
|  Project B (Side Project)   43 memories  [Include (v)] [Exclude]  |
|  Project C (Client Work)    28 memories  [Include]  [Exclude (v)] |
|                                                                     |
|  Total: 199 memories across 2 projects                             |
|                                                                     |
|  Security checks before upload:                                    |
|  [ok]  Secret scanner ran -- 0 sensitive values detected           |
|  [ok]  Embeddings generated locally before upload                  |
|  [ok]  Content encrypted in transit (TLS 1.3)                     |
|  [ok]  Your data is only accessible by you                         |
|                                                                     |
|  Privacy option:                                                   |
|  [ ] Sync content to cloud (full sync, default)                   |
|  [x] Sync vectors only -- content stays on device (privacy-first) |
|                                                                     |
|  After sync, your memories will be available on any device         |
|  where you're logged into Auto Claude.                             |
|                                                                     |
|  [Start Sync]              [Not now -- remind me in 30 days]       |
|                                                                     |
+---------------------------------------------------------------------+
```

**Key UX decisions:**

Per-project include/exclude — critical for client project confidentiality. Client work is excluded by default when the project name matches common contractor signals ("client", "agency", "contract"). This is a heuristic, not forced — users can override.

Security checklist is shown before any upload. Not a tooltip or fine print — a prominent checklist that the user reads before clicking Start. If the secret scanner found and redacted content, the first checklist item becomes: "3 values redacted before upload — [Review what was redacted]" with a link to the redaction log.

"Vectors only" mode: syncs embedding vectors (needed for semantic search across devices) but the raw memory content stays on the local device. This is the privacy-respecting default for developers who want cross-device search but not their code knowledge in the cloud. It requires re-embedding on the new device (handled automatically).

"Not now" sets a 30-day snooze, not a permanent dismiss. The migration prompt will return after 30 days — memory sync is too valuable a feature to offer once and forget.

**Post-migration celebration:**

```
+---------------------------------------------------------------------+
|                                                                     |
|              [check]  Memory Synced                                |
|                                                                     |
|       199 memories now available on all your devices.              |
|                                                                     |
|       Your AI knows your codebase wherever you work.               |
|                                                                     |
|                  [Open Memory Dashboard]                           |
|                                                                     |
+---------------------------------------------------------------------+
```

Simple. One message. One action. Celebrate the moment without marketing language.

---

### 4.11 Team Memory Features (Cloud)

**Purpose:** Multiply the value of accumulated knowledge across the team. New developers onboard faster. Common gotchas never need to be discovered twice.

**Team Memory Onboarding (new developer joins project):**

```
+---------------------------------------------------------------------+
|  Welcome to [Project Name]  *  Team Memory                        |
+---------------------------------------------------------------------+
|                                                                     |
|  Your team has been building this codebase for 8 months.           |
|  Here are the 5 most important things to know before you start:    |
|                                                                     |
|  1. DECISION  *  auth system                                       |
|     JWT over sessions -- API-first, 24h expiry. Do not change      |
|     without discussing with @alice. (Pinned by alice, Jan 8)       |
|                                                                     |
|  2. GOTCHA  *  tests/                                              |
|     All tests require Redis running locally. See CONTRIBUTING.     |
|     (92% confidence -- used 34 sessions)                           |
|                                                                     |
|  3. CONVENTION  *  entire codebase                                 |
|     bun only -- never npm. This is enforced in CI.                 |
|     (100% confidence -- pinned, user-verified)                     |
|                                                                     |
|  4. ERROR PATTERN  *  database/                                    |
|     Migration scripts run in dev but NOT prod automatically.       |
|     Always run manually before deploying.                          |
|                                                                     |
|  5. GOTCHA  *  frontend/                                           |
|     Tailwind v4 -- do not use @apply. Use utility classes only.    |
|                                                                     |
|  ---------------------------------------------------------------   |
|  317 more team memories available in Memory Browser.               |
|  Your agents will learn from all of them automatically.            |
|                                                                     |
|  [Explore all team memories]          [Start working]              |
|                                                                     |
+---------------------------------------------------------------------+
```

This onboarding moment is the killer feature of team memory. New developers absorb months of accumulated tribal knowledge in 60 seconds. The agent then operates with all of that knowledge from session one.

**Selection logic for "5 most important":** Sort by (confidence × pinned_weight × access_count), then take top 5. Pinned memories from team admins surface first. Memories the user's assigned modules have high coverage of surface above others.

**Team Memory Feed (web app, async update):**

```
+---------------------------------------------------------------------+
|  Team Memory  *  What the team learned this week                   |
+---------------------------------------------------------------------+
|                                                                     |
|  Mon  *  alice's agent discovered                                  |
|  GOTCHA  *  payments/stripe.ts                                     |
|  Webhook signature validation fails on dev because the signing     |
|  secret differs from prod. Use STRIPE_WEBHOOK_SECRET.              |
|                                                               [View]|
|                                                                     |
|  Tue  *  bob corrected a memory                                    |
|  DECISION updated: "PostgreSQL" -> "PostgreSQL 16 specifically     |
|  -- use features requiring 16+ (MERGE, CTEs with RETURNING)."     |
|                                                               [View]|
|                                                                     |
|  Thu  *  carlos's agent added workflow recipe                      |
|  WORKFLOW RECIPE  *  api/routes/                                   |
|  How to add a new API endpoint: 5 steps. (Used 2x already)        |
|                                                               [View]|
|                                                                     |
+---------------------------------------------------------------------+
```

**Memory Attribution in team context:**

```
Source: alice (agent:coder)  *  Feb 19  *  Steward: alice
3 team members have used this memory  *  0 disputes
```

Every team memory shows creator, agent type, date, and designated steward (defaults to creator). "Used by N team members" socializes the memory's value — members see which memories their colleagues find useful.

**Team memory dispute flow:**

When a team member disagrees with a shared memory:
1. They click "Dispute" (not "Flag Wrong" — different action, different consequence)
2. A threaded comment opens on that memory
3. The steward is notified via their notification system
4. The memory gets a yellow "disputed" badge — agents still use it but with reduced confidence weight
5. Resolution: steward updates the memory (closes dispute) or team admin escalates

**Memory dispute UI:**

```
+---------------------------------------------------------------------+
|  Memory Dispute  *  [Decision] JWT token expiry                    |
+---------------------------------------------------------------------+
|  Steward: alice  *  Created Jan 8  *  Used 31 sessions             |
|                                                                     |
|  Current: JWT with 24h expiry, 1h refresh window.                  |
|                                                                     |
|  bob disputed on Feb 20:                                           |
|  "We changed the refresh window to 30min in the security audit     |
|  last month -- this is outdated."                                  |
|                                                                     |
|  [Update memory]    [Mark resolved -- current is correct]          |
|  [Escalate to team admin]                                          |
+---------------------------------------------------------------------+
```

"Update memory" opens the inline edit, saves the correction, closes the dispute, notifies bob that the steward responded.

**Memory scoping levels (full detail in Section 7):**

| Scope | Visible to | Editable by | Examples |
|---|---|---|---|
| Personal | Only you | You | Your workflow preferences, personal aliases |
| Project | All project members | Project admins | Gotchas, error patterns, decisions |
| Team | All team members | Team admins | Organization conventions, architecture decisions |
| Organization | All org members | Org admins | Company-wide security policies, compliance requirements |

---

### 4.12 Memory Health Audit (Periodic Cleanup)

**Purpose:** Surface stale memories for proactive management without overwhelming the user. Appears in the Health Dashboard as a conditional attention card.

**Trigger conditions:** At most once per week. Shows only when: memories with `access_count < 3` AND `days_since_access > half_life * 0.8`. Maximum 5 memories per audit session regardless of how many qualify. If user dismissed 3 consecutive audits without acting, extend cadence to bi-weekly.

```
+---------------------------------------------------------------------+
|  Weekly Memory Check  *  ~3 minutes                    [Dismiss]  |
+---------------------------------------------------------------------+
|                                                                     |
|  3 memories haven't been accessed in 90+ days.                    |
|  They may be outdated. Quick review?                               |
|                                                                     |
|  +----------------------------------------------------------+      |
|  |  GOTCHA  *  database/                                    |      |
|  |  SQLite WAL mode requires specific connection flags.     |      |
|  |  Last used: 94 days ago                                  |      |
|  |  [Still accurate (check)]  [Edit]  [Archive]             |      |
|  +----------------------------------------------------------+      |
|                                                                     |
|  1 of 3                                                            |
|                                                                     |
+---------------------------------------------------------------------+
```

"Archive" moves to soft-deleted state (visible in "Archived" filter). Not the same as permanent delete — allows recovery. A monthly cron surfaces archived memories for permanent deletion if they haven't been un-archived.

"Still accurate" resets the decay clock — updates `lastAccessedAt` to now. This manual signal raises the effective confidence of memories the developer explicitly vouches for.

---

### 4.13 Micro-interactions and Delight

These small moments make the difference between a feature users tolerate and one they love.

**Memory created notification (mid-session toast):**

```
+--------------------------------+
|  (circle) Memory saved         |
|  New gotcha: middleware/auth.ts |
|  [View]                        |
+--------------------------------+
```

Duration: 4 seconds. Non-distracting — uses existing toast system, bottom-right corner. Frequency limit: maximum 3 per session, then silently batched to session-end summary to prevent toast fatigue. The circle icon animates to a check when the memory is confirmed (1 second after the save completes).

**Memory milestone cards (shown once, dismissible permanently):**

| Milestone | Message |
|---|---|
| 50 memories | "Your AI is starting to know this codebase well. Coverage: 2/5 modules." |
| 100 memories | "Your AI assistant knows this codebase well. Coverage: 4/5 modules. Health: 82/100." |
| 250 memories | "Deep knowledge. Your agent is navigating this codebase like someone who built it." |
| 500 memories | "Exceptional. This is one of the most thoroughly-understood codebases in Auto Claude." |

No confetti. No animation beyond a fade-in. Just honest, specific language about what the milestone means.

**Token savings badge (post-session, in task view sidebar):**

```
Memory  ^  Saved ~6,200 tokens
```

Small stat, no interaction required. Accumulates into a weekly figure shown in the Health Dashboard: "Memory saved ~41,000 tokens of file exploration this week." This is the value demonstration that converts skeptics — they can see the concrete time the system saved.

**First wow moment — Session 2-3 highlight card:**

Shown at session end for the first session where memory was demonstrably active (memories cited in output by agent):

```
+---------------------------------------------------------------------+
|  Memory worked this session                                        |
|  The agent used 3 memories from previous sessions,                 |
|  skipping 4,200 tokens of file discovery.                          |
|  This is memory doing its job.                      [Dismiss]      |
+---------------------------------------------------------------------+
```

Shown once. Direct. No marketing language. "This is memory doing its job" is the exact framing — matter-of-fact, developer-appropriate, no hype.

**Agent startup indication (when memories are being injected):**

A subtle status line appears in the agent terminal just before the first agent message:

```
[Memory] Using context from 3 previous sessions (14 memories injected)
```

This sets the mental frame before reading the agent's first message — the user knows before they read that the agent is operating with remembered context. The line is styled as a system comment, not agent output (slightly dimmed, different color).

---

## 5. Trust Progression System

### The Core Insight

Trust is not binary and cannot be forced. Users arrive skeptical — they should be; AI systems that "remember" things can cause subtle, hard-to-debug errors. Trust must be earned through demonstrated accuracy over time, with the user maintaining control at every step.

The Trust Progression System tracks behavior per-project (not globally) and adjusts the memory system's behavior based on demonstrated accuracy and user engagement.

### Trust Levels — Four States

**Level 1: Cautious (Sessions 1-3)**

Behavior:
- Inject only memories with `confidence > 0.80` (high bar)
- Require confirmation of ALL new memories in session-end summary (cannot skip)
- Show "Memory needs your review" banner before each session
- Citation chips are shown prominently (not collapsed even at 5+)
- No proactive gotcha injection during tool use — only session-start injection

User experience: The user sees everything and controls everything. This is the "show your work" phase where the system proves it can be trusted.

Advancement condition: 3 sessions completed with at least 50% of new memories confirmed (not just dismissed). OR: user manually advances via the trust level control in settings.

```
Trust Level:  [Cautious]  [Standard]  [Confident]  [Autonomous]
              (selected)

Sessions 1-3: Conservative injection, full review required.
Advance when: 3 sessions, 50%+ memories confirmed.
```

---

**Level 2: Standard (Sessions 4-15 or after advancement)**

Behavior:
- Inject memories with `confidence > 0.65`
- Session-end summary is shown but "Confirm all" is the default action (one-click)
- Individual review is offered, not required
- Proactive gotcha injection active (at tool-result level for reads/edits)
- Citation chips shown normally

User experience: The system works smoothly in the background. The user reviews at session end with a single click for most sessions. Manual corrections still straightforward.

Advancement condition: 10+ sessions with < 5% correction rate (memories confirmed > memories flagged/rejected), AND user has interacted with at least one correction (flagged or corrected a memory).

---

**Level 3: Confident (Sessions 16+ or after advancement)**

Behavior:
- Inject memories with `confidence > 0.55`
- Session-end summary is condensed: only shows memories that `needsReview: true` or received `userVerified: false` signal. Fully accurate sessions show only the token savings figure.
- Citations still shown in output (this never changes — provenance is always visible)
- Weekly audit card appears when stale memories accumulate

User experience: Memory feels seamless. The user is mostly unaware of the system working in the background. It surfaces only when something needs attention.

Advancement condition: User explicitly opts in (Level 4 is never automatic).

---

**Level 4: Autonomous (Opt-in only)**

Behavior:
- Inject all memories with `confidence > 0.45`
- Session-end summary suppressed by default; user can access on demand
- Memory Health Dashboard shows weekly digest instead of per-session review
- Corrections available at any time via Memory Browser or citation chips

User experience: Memory is fully invisible until needed. The agent "just knows" the codebase. The developer trusts the system completely.

Entry condition: Explicitly set by user. Recommended message when the user requests this level: "At Autonomous level, new memories are used immediately without session-end review. You can always check what was learned in the Memory panel or flag specific memories from agent output citations. Continue?"

**Trust level UI in settings:**

```
+---------------------------------------------------------------------+
|  Memory Trust Level  *  [Project: My App]                          |
+---------------------------------------------------------------------+
|                                                                     |
|  [Cautious]  [Standard (v)]  [Confident]  [Autonomous]             |
|              (active)                                               |
|                                                                     |
|  Standard: Active injection of high-confidence memories.           |
|  Session-end review shown with one-click confirmation.             |
|                                                                     |
|  Correct rate:  94.2% over 23 sessions                             |
|  Eligible for Confident level  [Advance now]                       |
|                                                                     |
|  Trust settings are per-project. Your other projects may have      |
|  different levels.                                                 |
|                                                                     |
+---------------------------------------------------------------------+
```

"Correct rate" is the observable trust metric — the user can see their own data. "Eligible for Confident level" based on the advancement conditions. Never automatic — always user-controlled.

### Trust Regression

If the user flags 3+ memories as wrong in a single session, show:

```
+---------------------------------------------------------------------+
|  A few memories were wrong this session.                           |
|  Would you like to be more conservative for this project?          |
|                                                                     |
|  [Stay at Standard]    [Move to Cautious for this project]         |
+---------------------------------------------------------------------+
```

The user chooses. The system does not automatically regress trust — this would feel punitive and surprising. Instead it offers the option with a clear reason.

---

## 6. Cloud Sync and Multi-Device

### Architecture Overview

Auto Claude is local-first. The Electron desktop app is the primary experience. Cloud sync is an additive layer — a migration from local-only to multi-device access. The local SQLite database remains the source of truth even after cloud sync is enabled. Cloud is a replica and collaboration layer, not the primary store.

```
Electron Desktop App (primary)
  |
  |-- SQLite DB (source of truth)
  |   |-- Personal memories (local, private by default)
  |   |-- Project memories (local, synced when enabled)
  |   |-- Cached team memories (from cloud, read-only locally)
  |
  |-- Sync Engine (background, when cloud sync enabled)
      |-- Local-first: writes go to SQLite first
      |-- Async sync: changes propagate to cloud within 60 seconds
      |-- Conflict detection: CRDTs for concurrent edits

Cloud (when sync enabled)
  |-- Personal memories (user-scoped, encrypted)
  |-- Project memories (project-scoped)
  |-- Team memories (team-scoped, role-controlled)

Web App (when logged in)
  |-- Reads from cloud
  |-- Writes immediately to cloud, syncs back to Electron on next connection
```

### Sync Status Indicators

A small sync indicator in the memory panel header:

```
[check] Synced  3 minutes ago
[arrows spinning] Syncing...
[!] Offline -- changes saved locally, will sync when connected
[!] Sync conflict -- 2 memories have conflicts  [Resolve]
```

The sync indicator is subtle — never obtrusive. Developers should not need to think about sync; it just works. The indicator is relevant only when something needs attention.

### Conflict Resolution

Memory conflicts arise when the same memory is edited on two devices before sync. The conflict resolution UI presents both versions:

```
+---------------------------------------------------------------------+
|  Sync Conflict  *  GOTCHA  *  middleware/auth.ts                   |
+---------------------------------------------------------------------+
|                                                                     |
|  This Device (edited 2h ago):                                      |
|  Refresh token not validated -- fixed in v2.4 via middleware.      |
|                                                                     |
|  Cloud Version (edited 5h ago):                                    |
|  Refresh token validation is optional for internal API calls.      |
|                                                                     |
|  [Keep this device version]    [Keep cloud version]    [Merge both]|
|                                                                     |
+---------------------------------------------------------------------+
```

"Merge both" creates a new version that concatenates both contents with a separator — not elegant but avoids data loss. The user can then edit the merged result.

CRDT-based merge for non-conflicting changes (e.g., confidence score updated on one device, content edited on another — these merge without conflict).

### Offline-First Behavior

The Electron app works fully offline. Memory reads, writes, and injection all operate from the local SQLite database. When connectivity is restored, the sync engine reconciles. A session that adds 8 memories while offline will sync those memories when the connection returns — no data loss.

The web app requires connectivity — it reads and writes directly from cloud. If the web app loses connection, it shows: "Offline — working with cached memories. Changes will sync when you reconnect."

### Cross-Device Memory State

When the user opens the app on a second device after cloud sync is enabled:

1. Sync engine downloads all memories for enabled projects
2. Embeddings are generated locally (not synced — embeddings are device-specific due to model variation)
3. "Catching up — syncing 199 memories from your other devices" progress indicator
4. Sync complete: "Your memory is ready. 199 memories available."

Embedding re-generation is the only latency concern. With nomic-embed-text on a modern machine, 199 memories re-embed in approximately 20-30 seconds. This is a one-time cost per device.

---

## 7. Team and Organization Memories

### Memory Scoping Architecture

Four scope levels exist in a strict hierarchy:

```
Organization
  |-- Team
       |-- Project  (default scope for most memories)
            |-- Personal  (private to individual user)
```

Scoping rules:
- A memory at scope N is visible to all members of scope N and above (more general)
- A memory at scope N is editable only by members with write access at that scope
- Personal memories are never visible to anyone else, ever (not even org admins)

**Practical examples:**

| Memory | Scope | Who sees it |
|---|---|---|
| "always use bun" | Project | Everyone on this project |
| "company API auth pattern" | Organization | All engineers at the company |
| "my preference for alphabetical imports" | Personal | Only me |
| "team uses semantic versioning strictly" | Team | All members of my team |

### Team Memory Discovery

When a project memory reaches high confidence (> 0.85) and has been used by 3+ team members independently, a badge appears: "Promote to team memory?" The current steward can approve, which makes it visible to all team members without project membership.

New team members automatically receive the "5 most important things" onboarding (Section 4.11) for any project they are added to. The selection algorithm prioritizes pinned memories and memories with highest access counts.

### Team Memory Governance

**Stewardship:** Every shared memory has a steward (defaults to creator). Stewards can:
- Edit the memory directly
- Mark it as deprecated
- Transfer stewardship to another team member
- Respond to disputes

**Team admin capabilities:**
- Pin memories at team or org level (these are surfaced first in all views)
- Delete any team-scoped memory with reason
- Bulk import memories from documentation or CLAUDE.md
- Export all team memories as JSON or Markdown
- Configure what memory types team members can create at each scope

**Memory promotion flow:**

```
Personal memory -> promote to Project memory  (requires project write access)
Project memory  -> promote to Team memory     (requires team admin)
Team memory     -> promote to Org memory      (requires org admin)
```

Demotion requires the same role level. Demotion does not delete the memory — it narrows its scope.

### Protecting Sensitive Information

Team memories are scanned for secrets before promotion to any scope above Personal:
- API keys, tokens, connection strings detected by the secret scanner
- PII patterns (email addresses, phone numbers in memory content)
- Detected values are redacted with: `[REDACTED: api_key]` and the team admin is notified

Personal memories are never scanned (privacy guarantee) — they remain on-device only.

---

## 8. Privacy and Data Controls

### What Never Leaves the Device (Electron Desktop)

These are immutable guarantees — not settings, not defaults that can be changed by an admin:

1. **All memories when cloud sync is disabled** — The default state. Without explicit cloud sync opt-in, nothing is transmitted.
2. **Personal-scope memories, always** — Even when cloud sync is enabled, personal memories remain local-only.
3. **Memory content when "vectors only" sync mode is selected** — Only embedding vectors transmit, not the content.
4. **Secret scanner results** — The scanner output (what was detected) never leaves the device.
5. **Embedding models** — Ollama runs entirely locally. No embedding data is sent to external services.

### What Optionally Syncs to Cloud (When Opted In)

Controlled at project level with per-project on/off:
- Project-scope memories (content + vectors, or vectors-only)
- Team-scope memories (when team sync is enabled)
- Memory usage statistics (access counts, session IDs — no content)

### GDPR Compliance (for EU Users)

Right to erasure: "Delete all my data" button in Settings → Memory → Privacy. Performs:
1. Hard-delete all local memories immediately
2. Queue cloud deletion request for all synced memories
3. Delete all embedding vectors
4. Remove user from memory attribution records (replaces with "deleted user")
5. Issue confirmation with deletion receipt (timestamp, record count)

Right to portability: "Export all my data" produces a JSON file with all memories, their full history, and metadata. Plain readable format, not proprietary.

Right to rectification: All memories are editable by the user (this is a core UX feature, not a compliance add-on).

Data minimization: Memory content is kept only as long as it is useful. The decay system automatically retires low-confidence stale memories. Periodic audit prompts invite users to actively clean up.

Lawful basis: Processing is under legitimate interest (improving the product's core functionality) and consent (explicit opt-in to cloud sync). The product does not train on user memory content — this must be stated clearly in the privacy policy and surfaced in the app.

**GDPR controls in Settings:**

```
+---------------------------------------------------------------------+
|  Privacy & Data Controls                                           |
+---------------------------------------------------------------------+
|                                                                     |
|  Memory Storage                                                    |
|  [x] Store memories locally (required for memory to work)          |
|  [ ] Sync to cloud  (disabled -- click to enable)                  |
|                                                                     |
|  Data Requests                                                     |
|  [Export my memory data]   Produces JSON file with all memories.   |
|  [Delete all my cloud data] Removes all synced memories from cloud.|
|  [Delete everything]  Removes all memories, local and cloud.       |
|                                                                     |
|  Training Data                                                     |
|  Your memory content is never used to train AI models.             |
|                                                                     |
|  Data Residency (Enterprise)                                       |
|  [ ] EU only  [ ] US only  [x] No preference                       |
|                                                                     |
+---------------------------------------------------------------------+
```

### EU AI Act Compliance (Effective August 2026)

The memory system that autonomously creates and injects context into AI agents may fall within the scope of high-risk AI systems depending on deployment context. At minimum, the system should:
- Document what memories were injected into each agent session (audit log)
- Provide human oversight mechanism (session-end review is this mechanism)
- Make the memory system's influence visible and correctable (citation + correction flows)
- Allow complete disablement by the user (memory off toggle)

These requirements align exactly with the UX design already specified. The compliance requirements are largely implemented by building the right UX.

---

## 9. Export and Import

### Export Formats

**JSON export (full fidelity):**

Exports all memories for a project with complete metadata. Format:
```json
{
  "exportedAt": "2026-02-22T10:00:00Z",
  "project": "My App",
  "memoryCount": 247,
  "memories": [
    {
      "id": "mem_abc123",
      "type": "gotcha",
      "content": "Refresh token not validated against Redis...",
      "confidence": 0.82,
      "relatedFiles": ["src/middleware/auth.ts"],
      "source": "agent:qa",
      "createdAt": "2026-01-15T...",
      "accessCount": 14,
      "userVerified": true
    }
  ]
}
```

**Markdown export (human-readable):**

Produces a Markdown file organized by module and type:
```markdown
# Project Memory Export — My App
## authentication module
### Gotchas
- **middleware/auth.ts** (confidence: high, used 14x): Refresh token not validated against Redis...
```

This format can be shared with teammates, added to documentation, or committed to the repo as supplementary context for future developers.

**CLAUDE.md export:**

Converts the highest-confidence pinned memories (decisions, conventions, preferences) into CLAUDE.md format, appending them after any existing content. This round-trips with Cursor and Copilot users — Auto Claude's memory becomes portable to any AI coding tool.

**Export entry point:**

In Settings → Memory, and in the Memory Panel via a "..." overflow menu: "Export memories for [Project Name]".

### Import Formats

**CLAUDE.md import:**

Parser reads CLAUDE.md sections and heuristically classifies each rule:
- Section headers become scope tags
- Rules starting with "always", "never", "must" classify as `convention`
- Rules about specific files classify as `module_insight` with the file as anchor
- Rules about error scenarios classify as `error_pattern`
- Ambiguous rules are offered to the user for manual classification

This import runs at first-run (if CLAUDE.md is detected) and is also available at any time via Settings → Memory → Import.

**.cursorrules import:**

Same parser as CLAUDE.md. Common `.cursorrules` conventions (MDC format with `---` section separators) are handled. Glob patterns in `globs:` fields map to `relatedFiles`.

**JSON import:**

Accepts the JSON export format from another Auto Claude installation or project. Useful for:
- Migrating memories when a project is reorganized
- Sharing a curated memory set with a new team member
- Merging memories from a forked project

Duplicate detection during import: memories with cosine similarity > 0.92 to existing memories are flagged as likely duplicates and offered for merge rather than creating duplicates.

---

## 10. React Component Architecture

### Memory Panel Component Tree

```
<MemoryPanel>
  <MemoryTabNav>                         // Health | Modules | Browse | Ask

  {activeTab === 'health' && (
    <MemoryHealthDashboard>
      <MemoryStatsRow />                 // Three stat cards with click targets
      <MemoryHealthScore />              // Progress bar + delta indicator
      <ModuleCoverageList>
        <ModuleCoverageRow />            // Click -> Memory Browser filtered to module
      </ModuleCoverageList>
      <RecentActivityFeed />             // Time-stamped events, robot/person icons
      <NeedsAttentionCard />             // Conditional: weekly audit card
      <SessionMetricsBadge />            // Conditional: active session or < 2h ago
    </MemoryHealthDashboard>
  )}

  {activeTab === 'modules' && (
    <ModuleMapView>
      <ModuleMapSearch />
      <ModuleList>
        <ModuleCard>                     // Radix Collapsible
          <ModuleHeader />               // Name + confidence dots + memory count badge
          <ModuleFileList />             // Core files, test files (icons distinguish)
          <ModuleDependencyList />       // Dep tags + related module links
        </ModuleCard>
      </ModuleList>
    </ModuleMapView>
  )}

  {activeTab === 'browse' && (
    <MemoryBrowser>
      <MemoryBrowserSearch />
      <MemoryBrowserFilters>
        <ScopeDropdown />
        <TypeDropdown />
        <StatusDropdown />
        <SortDropdown />
      </MemoryBrowserFilters>
      <MemoryList>
        <MemoryCard>
          <MemoryCardHeader>
            <MemoryTypeBadge />          // Type-colored badge
            <MemoryConfidenceDots />     // 5-dot system
            <MemoryUsageStats />         // Access count + last used
          </MemoryCardHeader>
          <MemoryContent>               // Radix Collapsible for long content
          <MemoryProvenance />          // Creator icon + type + date + branch (always visible)
          <MemoryVersionHistory />      // Radix Collapsible, diff view
          <MemoryActions>
            <EditButton />
            <PinButton />               // Toggle, gold when pinned
            <FlagButton />              // Opens CorrectionModal
            <DeleteButton />            // AlertDialog confirmation
          </MemoryActions>
        </MemoryCard>
      </MemoryList>
    </MemoryBrowser>
  )}

  {activeTab === 'ask' && (
    <MemoryChat>
      <MemoryChatHistory>
        <MemoryChatMessage>
          <CitationChip />              // Interactive [^ Memory: ...] chips
        </MemoryChatMessage>
      </MemoryChatHistory>
      <MemoryChatSuggestions />         // Empty state suggested prompts
      <MemoryChatInput />               // Textarea with auto-resize
      <TeachFromChatBanner />           // Conditional: "Save as memory?"
    </MemoryChat>
  )}

  {/* Overlays */}
  <CorrectionModal />                   // Radix Dialog, positioned near trigger
  <TeachPanel />                        // Radix Sheet side="right" w-96
  <SessionEndSummary />                 // Rendered in task view, not here

  {/* Cloud only */}
  {teamSyncEnabled && activeTab === 'team' && (
    <TeamMemoryView>
      <TeamOnboardingCard />            // 5 most important for new members
      <TeamMemoryFeed />                // This week's team activity
      <TeamDisputeList />               // Active disputes
    </TeamMemoryView>
  )}
</MemoryPanel>
```

### Standalone components used across views

```
<MemoryCitationChip memoryId={id} text={text} onFlag={handleFlag} />
  // Used in: terminal output, memory chat, session end summary

<SessionEndSummary sessionId={id} newMemories={[]} usedMemories={[]} />
  // Used in: task view, below terminal output

<TrustLevelControl projectId={id} />
  // Used in: Settings -> Memory panel

<CloudSyncMigration projectIds={[]} />
  // Used in: Settings -> Memory -> Cloud

<MemoryImport source="claude_md" | "cursorrules" | "json" />
  // Used in: first-run flow, Settings -> Memory -> Import
```

### New constants additions to `constants.ts`

```typescript
// Memory type icons (Lucide)
export const memoryTypeIcons: Record<MemoryType, React.ElementType> = {
  gotcha: AlertTriangle,
  decision: Scale,
  convention: BookOpen,
  preference: Star,
  error_pattern: Bug,
  pattern: Repeat,
  module_insight: Layers,
  workflow_recipe: List,
  dead_end: Ban,
  work_state: Clock,
  e2e_observation: Monitor,
  prefetch_pattern: Zap,
  causal_dependency: GitMerge,
  task_calibration: BarChart,
  context_cost: Cpu,
  work_unit_outcome: CheckSquare,
};

// Memory type colors (Tailwind classes)
export const memoryTypeColors: Record<MemoryType, string> = {
  gotcha: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  decision: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30',
  convention: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
  preference: 'bg-violet-500/10 text-violet-400 border-violet-500/30',
  error_pattern: 'bg-red-500/10 text-red-400 border-red-500/30',
  pattern: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  module_insight: 'bg-slate-500/10 text-slate-400 border-slate-500/30',
  workflow_recipe: 'bg-teal-500/10 text-teal-400 border-teal-500/30',
  dead_end: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
  work_state: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
  e2e_observation: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
  prefetch_pattern: 'bg-green-500/10 text-green-400 border-green-500/30',
  causal_dependency: 'bg-pink-500/10 text-pink-400 border-pink-500/30',
  task_calibration: 'bg-lime-500/10 text-lime-400 border-lime-500/30',
  context_cost: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30',
  work_unit_outcome: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
};

// Confidence dot display utility
export function getConfidenceDots(score: number): string {
  const filled = Math.round(score * 5);
  return '●'.repeat(filled) + '○'.repeat(5 - filled);
}

// Decay label from type and days since access
export function getDecayLabel(type: MemoryType, daysSinceAccess: number): string {
  const neverDecayTypes: MemoryType[] = ['decision', 'convention', 'preference'];
  if (neverDecayTypes.includes(type)) return 'Never decays';
  const halfLife = DECAY_HALF_LIVES[type] ?? 60;
  if (daysSinceAccess < 14) return 'High activity';
  if (daysSinceAccess < halfLife * 0.4) return 'Active';
  if (daysSinceAccess < halfLife * 0.75) return 'Aging';
  if (daysSinceAccess < halfLife) return 'Stale';
  return 'Overdue for review';
}

// Trust level config
export const TRUST_LEVELS = {
  cautious: {
    label: 'Cautious',
    minConfidence: 0.80,
    requireFullReview: true,
    proactiveInjection: false,
    description: 'Full review required for new memories. Conservative injection.',
  },
  standard: {
    label: 'Standard',
    minConfidence: 0.65,
    requireFullReview: false,
    proactiveInjection: true,
    description: 'One-click confirmation. Active gotcha injection.',
  },
  confident: {
    label: 'Confident',
    minConfidence: 0.55,
    requireFullReview: false,
    proactiveInjection: true,
    description: 'Session summary condensed. Review only flagged items.',
  },
  autonomous: {
    label: 'Autonomous',
    minConfidence: 0.45,
    requireFullReview: false,
    proactiveInjection: true,
    description: 'Session summary suppressed. Memory is seamless.',
  },
} as const;

// Memory scope labels
export const MEMORY_SCOPE_LABELS: Record<MemoryScope, string> = {
  session: 'This Session',
  work_unit: 'This Task',
  module: 'Module',
  global: 'All Projects',
};
```

---

## 11. Tailwind / Radix Component Mapping

| UI Element | Radix Component | Tailwind Pattern |
|---|---|---|
| Memory cards | div | `bg-card border rounded-lg p-4 hover:bg-card/80 transition-colors` |
| Module cards | `Collapsible` | `border rounded-lg` with `CollapsibleTrigger` as header |
| Correction modal | `Dialog` | `DialogContent max-w-md` |
| Teach panel | `Sheet` | `SheetContent side="right" className="w-96"` |
| Session summary | div | `bg-card border-l-4 border-amber-500 p-4 rounded-r-lg` |
| Confidence dots | span | `text-green-400` / `text-amber-400` / `text-red-400` |
| Health score | `Progress` | `h-2 bg-secondary [&>div]:bg-green-500 rounded-full` |
| Memory type badges | `Badge` | `variant="outline"` + type-specific color class |
| Citation chips | span | `bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs rounded px-1.5 py-0.5 cursor-pointer inline-flex items-center gap-1` |
| Dead-end citation chips | span | `bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs rounded px-1.5 py-0.5` |
| Pin toggle | `Toggle` | `variant="ghost" size="sm"` with star icons |
| Filter dropdowns | `Select` | Standard Select, Scope dropdown `min-w-44` |
| Memory diff view | div | `bg-red-500/10 text-red-400` / `bg-green-500/10 text-green-400` |
| Audit attention card | div | `border border-amber-500/30 bg-amber-500/5 rounded-lg p-4` |
| Trust level selector | `RadioGroup` | Horizontal layout, active state `bg-primary/10` |
| Sync status | div | Small badge with animated spinner for syncing state |
| Module confidence dots | span | 5 dots system, color by confidence tier |
| Stats cards | div | `bg-card border rounded-lg p-4 flex flex-col` |
| Health dashboard | div | `space-y-4 p-4` |
| Memory version history | `Collapsible` | Inline diff, `border-l-2 border-muted pl-3` |
| Team memory feed | div | Chronological, `border-b border-border` separators |
| Dispute thread | div | `border border-amber-500/30 rounded-lg p-3 space-y-2` |
| Cloud migration | `Dialog` | `DialogContent max-w-lg` with checklist |
| Milestone cards | div | `bg-card border border-primary/20 rounded-lg p-4` |
| Token savings badge | `Badge` | `variant="secondary" className="text-xs"` |

---

## 12. Implementation Priority Order

### P0 — Trust Critical (must ship before memory is live)

These items must exist before memory launches to any user. Without them, memory will feel spooky and erode trust from day one.

1. **Provenance on every card** — Creator icon + session date + branch, always visible. The single most important trust signal. Never hide it.

2. **Inline citation chips in agent output** — `[^ Memory: ...]` rendered as interactive chips. Users must be able to see when memory influences the agent. Implementation requires: system prompt instruction to emit citations, post-processing pass on output stream, `<MemoryCitationChip>` component.

3. **Session end summary with confirm/reject per memory** — Intercept memories at creation time. Users should never be surprised by what the system remembers. Every new memory requires explicit confirmation or rejection before it is used in future sessions.

4. **Flag Wrong at point of damage** — `[!]` button on citation chips + `[Flag Wrong]` on memory cards. Opens focused `CorrectionModal`. Point-of-damage correction is the most critical trust repair mechanism.

5. **Immediate delete option** — For accidental secrets in memory content. Bypasses soft-delete, hard-deletes immediately. Must be available from the Memory Browser and accessible within 2 clicks from any memory card.

6. **Health Dashboard as default view** — Replace any flat list as the entry point. Reframes memory as system health, not database management.

7. **First-run initialization status** — Step-by-step progress during cold start. Users who see work happening have patience and build positive associations with the feature.

### P1 — Core UX Quality

8. **Module Map view** — Structural knowledge visualization. Makes "where things are" tangible.

9. **Seeded memory review flow** — Card-at-a-time confirmation before first session. User confirms what the system inferred from the codebase.

10. **Confidence dots on cards** — 5-dot visual indicator. Instant read on memory quality.

11. **Session metrics badge** — "Saved ~X tokens" after each session. The concrete value demonstration.

12. **Teach the AI panel** — `/remember` slash command + `Cmd+Shift+M`. Power-user memory creation.

13. **Trust Level selector** — Per-project. Cautious / Standard / Confident / Autonomous. Users must be able to control injection behavior.

14. **CLAUDE.md import at first-run** — Import existing rules as typed memories on project open.

### P2 — Depth and Delight

15. **Memory Chat** — Conversational project knowledge exploration with inline citations.

16. **Version history on decision/convention memories** — Timeline of how a memory evolved.

17. **Weekly audit card** — Periodic stale memory cleanup. Prevents memory rot.

18. **Memory milestone cards** — 50, 100, 250, 500 memory milestones. Low effort, meaningful delight.

19. **"First wow moment" highlight card** — Explicit call-out at session end when memory demonstrably helped for the first time.

20. **Export to CLAUDE.md / JSON / Markdown** — Portability and sharing.

### P3 — Cloud and Team (requires cloud infrastructure)

21. **Cloud sync migration ceremony** — Per-project opt-in with security checklist.

22. **Team Memory — scoping and sharing** — Personal / Project / Team / Org levels.

23. **Team memory dispute system** — Threaded comments on disputed memories.

24. **New developer team onboarding view** — "5 most important things" on project join.

25. **Team Memory Feed** — Weekly digest of what the team learned.

26. **Multi-device sync status** — Sync indicator, offline-first behavior.

27. **GDPR data controls** — Export, delete, data residency in Settings.

---

## 13. Recommendations for V4

### Immediate UX gaps to address in V4

**1. Conversational memory refinement in agent sessions**

Currently, corrections happen after the fact (session-end summary) or at point of damage (citation chip flag). V4 should allow natural in-session correction: the user types "wait, that's wrong — actually X" during an agent session, and the agent responds "I'll note that correction. [Memory #ID] will be updated." The correction is applied immediately and the agent continues with the corrected context.

**2. Memory confidence heatmap on code files**

When viewing a file in the context panel, show a sidebar heatmap of how well the memory system understands different sections of that file. High-density memory coverage = green. Unknown = grey. This gives developers an intuitive read on where the agent has and hasn't learned the codebase.

**3. Memory-driven planning assistance**

When the user creates a new task, the system proactively pulls relevant memories and surfaces them as a "What I already know about this area" card before the agent starts. This is distinct from agent injection — it is user-visible, allowing the user to curate what context the agent starts with.

**4. Memory diff between branches**

When switching branches, surface: "This branch has 14 memories that differ from main. The auth module was significantly changed." Gives developers immediate awareness of how their memory state differs across branches they are working on.

**5. Memory search from command palette**

The existing command palette (if one exists) or a new `Cmd+K` flow should include memory search. Type a file name or concept and see instantly what memories the system has for it. This replaces the need to open the Memory panel for quick lookups.

### Architectural recommendations from UX findings

**Agent citation as a prompting requirement (not optional)**

The citation system only works if agents reliably emit `[Memory #ID: text]` markers. This requires the citation instruction to be a mandatory, top-level part of the agent system prompt — not an addendum. Monitor citation rate per agent session. If < 70% of injected memories are cited in output (when the agent clearly uses them), the prompt needs strengthening.

**Trust metrics as a feedback loop for the Observer**

The Trust Progression System generates valuable signal: when users flag memories as wrong, these failures should feed back into the Observer's inference rules. If a particular signal type (e.g., `BacktrackSignal`) consistently produces memories that get flagged, reduce its promotion weight. Trust metrics become training signal for the extraction system.

**Team memory quality as a compound value**

The team memory feature's value compounds — a team of 5 developers using Auto Claude for 3 months will have a collective memory that is dramatically richer than any individual's. This means the first team adopter in an organization is creating value for future team members before those team members even join. Frame this in the product narrative: "The longer your team uses Auto Claude, the faster new developers onboard."

**Privacy architecture for EU enterprises**

Given the EU AI Act's August 2026 enforcement for high-risk AI systems, enterprises in regulated industries (finance, healthcare, legal) will need audit logs of every memory that was injected into every agent session. The session-end summary is the user-facing version of this log, but the underlying data should be queryable by org admins for compliance purposes. Design the session log storage with this requirement in mind early — retrofitting audit logging is painful.

**Memory portability as adoption driver**

The CLAUDE.md export and .cursorrules import are strategically important beyond their direct UX value. They make Auto Claude's memory interoperable with the broader AI coding tool ecosystem. A developer who has been using Cursor for 2 years with a mature `.cursorrules` file can import that knowledge into Auto Claude on day one. This lowers the switching cost and increases the initial memory quality — making the first session better than it would otherwise be. This is a growth feature, not just a convenience feature.

---

Sources:
- [ChatGPT Memory Features 2025-2026](https://mindliftly.com/future-of-chatgpt-2025-2026-roadmap-gpt-5-next-ai-trends/)
- [Building Trust in AI Through Design — 7 Essential UX Patterns](https://medium.com/bestfolios/building-trust-and-enhancing-interactions-7-essential-ai-ux-patterns-in-action-12e7604de435)
- [Designing Trustworthy AI Assistants: 9 UX Patterns](https://orangeloops.com/2025/07/9-ux-patterns-to-build-trustworthy-ai-assistants/)
- [AI Transparency: 5 Design Lessons](https://www.eleken.co/blog-posts/ai-transparency)
- [Windsurf Cascade — AI-Native Coding](https://windsurf.com/cascade)
- [Windsurf Review 2026](https://www.secondtalent.com/resources/windsurf-review/)
- [Anthropic Claude Memory Feature — MacRumors](https://www.macrumors.com/2025/10/23/anthropic-automatic-memory-claude/)
- [Claude AI Memory for Teams and Enterprises](https://www.reworked.co/digital-workplace/claude-ai-gains-persistent-memory-in-latest-anthropic-update/)
- [Collaborative Memory: Multi-User Memory Sharing in LLM Agents](https://arxiv.org/html/2505.18279v1)
- [Knowledge Plane — Shared Memory for AI Agents and Teams](https://knowledgeplane.io)
- [Local AI Privacy Guide 2025](https://localaimaster.com/blog/local-ai-privacy-guide)
- [GDPR and AI in 2026](https://www.sembly.ai/blog/gdpr-and-ai-rules-risks-tools-that-comply/)
- [Cursor AI Review 2025](https://skywork.ai/blog/cursor-ai-review-2025-agent-refactors-privacy/)
- [Improving User Trust in Gen AI — UX Techniques](https://byteridge.com/technology-trends/improving-user-trust-in-gen-ai-ux-techniques-for-transparency-and-control/)
