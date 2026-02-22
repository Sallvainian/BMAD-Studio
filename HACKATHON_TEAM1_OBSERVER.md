# HACKATHON TEAM 1: The Memory Observer Architecture — Enhanced V2

**Team:** Memory Observer
**Date:** 2026-02-22
**Author:** Atlas (Principal Software Architect)
**Document version:** 2.0 — Built on V1 + V3 Draft, Research-Informed

> This document is the enhanced Team 1 submission for the Auto Claude memory system hackathon.
> It builds on V3's scratchpad-to-promotion model and challenges several of its assumptions.
> It is informed by competitive analysis of Cursor, Windsurf, Augment Code, Devin, GitHub Copilot,
> Mastra's Observational Memory, Continue.dev, Aider, and Replit Agent as of February 2026.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Competitive Analysis — 2026 Landscape](#2-competitive-analysis--2026-landscape)
3. [What V3 Gets Right, What Needs to Change](#3-what-v3-gets-right-what-needs-to-change)
4. [Signal Taxonomy V2 — Comprehensive Signals with Priority Scoring](#4-signal-taxonomy-v2--comprehensive-signals-with-priority-scoring)
5. [Scratchpad 2.0 — Intelligent In-Session Analysis](#5-scratchpad-20--intelligent-in-session-analysis)
6. [Promotion Engine — Session-Type-Aware Heuristics](#6-promotion-engine--session-type-aware-heuristics)
7. [Cross-Session Pattern Synthesis](#7-cross-session-pattern-synthesis)
8. [Observer Performance Budget](#8-observer-performance-budget)
9. [TypeScript Interfaces and Code Examples](#9-typescript-interfaces-and-code-examples)
10. [Architecture Diagrams](#10-architecture-diagrams)
11. [Recommendations for V4](#11-recommendations-for-v4)

---

## 1. Executive Summary

### What V3 Gets Right

V3's Memory Observer is the strongest section of the entire V3 design. The three principles it gets exactly right:

**The scratchpad-to-promotion model is correct.** Deferring permanent memory writes until after QA validation passes is the single most important architectural decision in V3. Without this gate, agents write memories for broken approaches — contaminating future sessions with knowledge that led to failure. V3's model ensures only validated knowledge persists.

**Behavioral signals over explicit declarations is correct.** The most architecturally valuable knowledge — co-access patterns, error-retry fingerprints, backtrack sequences — is entirely invisible to an agent making explicit `remember_this` calls. An observer watching from outside the execution loop captures what agents cannot.

**Zero-overhead during execution is correct.** The scratchpad is pure in-memory state accumulation, no LLM calls, no embeddings, no database writes. The observer must be invisible to the agent's execution path.

### What Needs to Change

V3 has five gaps that this document addresses:

1. **Signal blindness.** V3's six-signal taxonomy misses the most diagnostically valuable behavioral signals: read-then-abandon patterns, repeated identical grep queries (confusion indicator), copy-paste-from-external-source patterns, agent commentary self-correction signals, and time-per-step distribution anomalies. Section 4 adds 11 new signal classes.

2. **The scratchpad is passive.** V3's scratchpad only accumulates. It does not analyze. With lightweight, allocation-free algorithms (no LLM, no embeddings), the scratchpad can detect patterns within a single session — dramatically improving promotion precision and enabling early promotion triggers. Section 5 introduces Scratchpad 2.0.

3. **QA-only promotion is insufficient.** V3's promotion model only runs when QA passes. But insights sessions, roadmap sessions, terminal sessions, and changelog sessions generate high-value knowledge with no QA gate. Section 6 defines promotion heuristics for all seven session types.

4. **Cross-session synthesis is undefined.** V3 mentions cross-session pattern detection but provides no concrete algorithm. After session 5, 10, 15 touching the same module, when and how does the observer synthesize the pattern? Section 7 defines the cross-session synthesis engine with concrete triggers.

5. **Observer performance budget is unspecified.** "Zero-overhead" is a claim, not a guarantee. Section 8 provides concrete CPU and memory budgets with enforcement mechanisms.

---

## 2. Competitive Analysis — 2026 Landscape

### 2.1 Augment Code — The Context Engine Benchmark

Augment Code's Context Engine is the most serious competition in codebase-wide memory as of February 2026. Key characteristics:

- **200K token semantic index** built via continuous real-time repository indexing
- **Relationship mapping** across hundreds of thousands of files, not just keyword search
- **70%+ agent performance improvement** on Claude Code, Cursor, and Codex benchmarks (Augment's own published results)
- **MCP-exposed** — Context Engine is now available as an MCP server that any agent can query
- **Onboarding impact**: Reduced engineer onboarding from 18 months to 2 weeks on a 100K+ line Java monolith

**What Auto Claude can learn from Augment:** The relationship graph is the value, not the vector store. Augment's 70% improvement comes from understanding that `AuthService.validateToken()` calling `TokenStore.get()` calling `RedisClient.get()` — and that `RedisClient` goes down on Fridays during cache expiry — is the kind of structural knowledge no amount of semantic search recovers. Auto Claude's Knowledge Graph layer maps to this, but the connection between the graph and the observer is underspecified in V3.

**Where Auto Claude has an advantage:** Augment's context is static (batch-indexed). Auto Claude's observer captures *behavioral* patterns — which files agents actually read together in practice, not just which files import each other. A senior engineer knows that `auth/middleware.ts` and `auth/tokens.ts` are coupled even though tokens has no import of middleware — because every auth bug touches both. Augment cannot know this. The observer can.

### 2.2 Windsurf Cascade — Automatic Memory Generation

Windsurf's Cascade memory system (2025-2026) is the closest analog to what V3 describes:

- **Automatic memory generation** — Cascade autonomously identifies useful context to remember, no explicit calls required
- **Workspace-scoped memories** — memories are scoped to the workspace, not the user globally
- **Three memory tiers:** System (team-wide), Workspace (project), Global (user)
- **Rules layer** — users define rules that govern how memories operate
- **Toggle control** — users can enable/disable automatic memory generation

**Critical weakness:** Cascade's memories are generated from the LLM's own subjective assessment of what matters. The Cascade AI decides "this is worth remembering." This suffers from the same agent-subjectivity bias that V1 had. The observer approach — watching behavioral patterns from outside — is architecturally superior.

**Security finding:** A 2025 security research paper found Windsurf memories could be poisoned via prompt injection ("SpAIware exploit"). This is a concrete risk that Auto Claude must design against. See Section 6 for trust gates.

### 2.3 Mastra Observational Memory — The Observer-Reflector Pattern

Mastra's Observational Memory (February 2026) is the most academically rigorous memory system currently published for AI agents. It achieves:

- **94.87% on LongMemEval** with gpt-4o-mini — industry record
- **5-40x compression ratio** on tool-heavy agent workloads
- **Observer-Reflector two-agent architecture**:
  - Observer: compresses raw message history into dated observation logs when unobserved messages hit 30K tokens
  - Reflector: restructures and condenses observations when observation log hits 40K tokens
- **Emoji prioritization**: red circle (critical), yellow (relevant), green (context-only)
- **Prompt caching optimization**: stable context prefix enables aggressive cache reuse

**What Auto Claude can directly adopt:** The Observer-Reflector pattern maps well onto Auto Claude's scratchpad. The scratchpad is the Observer; a post-session synthesis step is the Reflector. The emoji prioritization system is a clever lightweight signal that costs zero tokens — it is a priority tag, not a summary.

**Key difference:** Mastra's system compresses conversation history. Auto Claude's system observes behavioral signals and promotes semantic memories. These are complementary, not competing. Auto Claude should implement both.

### 2.4 GitHub Copilot Workspace — Repository-Level Learning

GitHub Copilot's memory system (2025-2026 early access):

- **Repository-level context** captures key insights building over time
- **Reduces repeated explanation** of project structure and conventions
- **Auto-compaction** at 95% token limit with `/compact` manual trigger
- **Session resumption** via `--resume` with TAB completion

**Weakness:** GitHub's memory is primarily conversation-level (what did the user say? what did Copilot respond?) not behavioral-level (what did the agent actually do? which files did it read in what order?). It is a better conversation history, not a behavioral observer.

### 2.5 Cursor — Semantic Code Chunking + Vector Search

Cursor's approach (2025-2026):

- **Semantic code chunking** by function/class/logical block boundaries
- **Custom embedding model** for code-specific vector representations
- **Turbopuffer vector storage** optimized for millions of chunks
- **12.5% accuracy improvement** from semantic indexing vs keyword search
- **Codebase indexing in 21 seconds** for large repos (down from 4 hours)

**Key insight:** Cursor excels at "context stuffing" — knowing which 50 files are relevant to your current change. But it has no persistent behavioral memory. Every session starts from scratch. The same context is retrieved the same way every time, regardless of what was learned last session.

### 2.6 Devin — Persistent Planning Memory + Parallel Agents

Cognition's Devin 2.0/3.0 (2025-2026):

- **Running to-do list** persisted across long-running migrations (hours or days)
- **Dynamic re-planning** when hitting roadblocks
- **Parallel agent cloud IDE** for concurrent workstreams
- **Cloud-based execution** with persistent state between sessions

**Weakness:** Devin's memory is task-state memory — "I was doing step 7 of 20." This is V3's `work_state` memory type. What Devin lacks is *codebase knowledge* memory — the kind of structural, behavioral, and gotcha knowledge that the observer captures.

### 2.7 Aider — Repo Map as Minimal Memory

Aider's approach is instructive precisely because it is minimal:

- **Repo map** — a compact, LLM-readable summary of all files, their exports, and relationships
- **Generated fresh each session** from tree-sitter AST analysis
- **Included in context** but never persisted

**Lesson:** Aider proves the repo map concept is valuable for navigation. But regenerating it fresh every session ignores accumulated behavioral knowledge. Aider has no equivalent of "agents always read middleware.ts when touching auth — let's pre-fetch it."

### 2.8 Competitive Matrix

| Dimension | Auto Claude V3 | Augment | Windsurf | Cursor | Devin | Mastra OM | Copilot |
|-----------|---------------|---------|----------|--------|-------|-----------|---------|
| Behavioral signals | Partial | No | No | No | No | No | No |
| Co-access graph | Yes | No | No | No | No | No | No |
| Static code index | Via KG | Yes (200K) | No | Yes | No | No | No |
| Automatic capture | Partial | Batch | LLM-judged | Batch | No | Yes | Partial |
| Cross-session synthesis | Undefined | Static | No | No | No | Observer+Reflector | No |
| Scratchpad-to-promotion | Yes | No | No | No | No | No | No |
| Session-type aware | No (V3 gap) | N/A | No | N/A | No | No | No |
| Prompt injection defense | Not specified | Unknown | Vulnerable | N/A | N/A | N/A | Unknown |

**Auto Claude's differentiated value:** The behavioral observer capturing co-access patterns, backtrack sequences, and error-retry fingerprints is unique in the market. No competitor does this. This is the moat.

---

## 3. What V3 Gets Right, What Needs to Change

### Keep from V3

- Scratchpad-to-promotion model (fundamental, correct)
- Six-signal taxonomy as a starting set
- Single LLM synthesis call after validation (not per-step)
- Novelty check via cosine similarity
- Dead-end memory as a first-class type
- Co-access graph with git log cold-start bootstrap
- Promotion filter pipeline (validation filter → frequency → novelty → scoring → LLM synthesis → embeddings)

### Change in V4

**Expand signal taxonomy.** V3 captures what agents do. It misses what agents *struggle with* and what they *abandon*. The new signals in Section 4 capture confusion, abandonment, and external reference patterns.

**Make scratchpad intelligent.** V3's scratchpad is a passive accumulation buffer. Scratchpad 2.0 runs lightweight in-session analysis (O(n) algorithms, no allocations beyond the signal buffer) that enables early pattern detection within a single session.

**Define session-type-aware promotion.** V3 only promotes after QA passes. That covers ~30% of session types. The remaining 70% (insights, roadmap, terminal, changelog, spec, PR review) need their own promotion heuristics.

**Define cross-session synthesis triggers.** Section 7 specifies exact thresholds, algorithms, and timing for when multi-session pattern synthesis fires.

**Specify observer performance budget.** Section 8 provides hard limits: memory (max 50MB resident), CPU (max 2ms per event), and latency (max 100ms synthesis).

**Add trust defense layer.** Against prompt injection attacks (as demonstrated against Windsurf), add a trust gate that vetoes any promoted memory whose content was influenced by LLM-generated text from external sources.

---

## 4. Signal Taxonomy V2 — Comprehensive Signals with Priority Scoring

V3 defines 6 signal classes. V4 defines 17. Signals are scored by **diagnostic value** (how much information they carry about the codebase) and **false positive rate** (how often the signal fires without a meaningful memory candidate).

### Priority Scoring Formula

```
signal_value = (diagnostic_value × 0.5) + (cross_session_relevance × 0.3) + (1.0 - false_positive_rate) × 0.2
```

Signals with `signal_value < 0.4` are discarded before promotion filter.

### Signal Class 1: File Access Fingerprint (V3, retained)

**Priority Score: 0.72**
**Diagnostic value: High** — Files consistently accessed early in sessions are navigation anchors.
**False positive rate: Low** — Multi-session threshold eliminates one-off exploration.

```typescript
interface FileAccessSignal {
  type: 'file_access';
  filePath: string;
  toolName: 'Read' | 'Edit' | 'Write' | 'Grep' | 'Glob';
  stepIndex: number;           // Position in session (early access = higher value)
  timestamp: number;
  sessionTaskType: string;     // What kind of task was this session?
  accessWeight: number;        // Read=1, Edit=2, Write=3 (writes signal higher importance)
}
```

**Promotion threshold:** accessed in >= 3 sessions, or Edit/Write in >= 2 sessions (writes carry more signal than reads).

---

### Signal Class 2: Co-Access Graph (V3, retained + enhanced)

**Priority Score: 0.91**
**Diagnostic value: Very high** — Captures runtime coupling invisible to static analysis.
**False positive rate: Very low** — Multi-session co-access in diverse task types is extremely reliable.

```typescript
interface CoAccessSignal {
  type: 'co_access';
  fileA: string;
  fileB: string;
  timeDeltaMs: number;         // Time between accessing A and B
  stepDelta: number;           // Steps between accessing A and B
  sessionId: string;
  directional: boolean;        // A always precedes B (or random order)
  taskTypes: string[];         // Task types where this co-access appears
}
```

**Enhancement over V3:** Track `taskTypes` at signal level, not just at edge level. A co-access pattern that appears across bug-fix AND feature AND refactor sessions is 3x more valuable than one that appears only in bug-fix sessions. The task type diversity multiplies the promotion score.

---

### Signal Class 3: Error-Retry Fingerprint (V3, retained + enhanced)

**Priority Score: 0.85**
**Diagnostic value: High** — Each retry is a documented failure mode plus its solution.
**False positive rate: Low** — Only fire when the error appears in >= 2 sessions.

```typescript
interface ErrorRetrySignal {
  type: 'error_retry';
  toolName: string;
  errorMessage: string;         // Normalized (strip paths, version numbers, timestamps)
  errorFingerprint: string;     // Hash of normalized error type + context
  retryCount: number;
  resolvedHow?: string;         // The tool call that finally worked
  stepsToResolve: number;       // How many steps it took to recover
  sessionId: string;
}
```

**Enhancement:** Normalize `errorMessage` before storing. The pattern `ENOENT: no such file or directory: /Users/specific-user/project/.env.local` is a different signal from `ENOENT: no such file or directory` — but the cross-session pattern only emerges if we normalize out user-specific paths. Use `errorFingerprint = hash(errorType + normalizedContext)`.

---

### Signal Class 4: Backtrack Detector (V3, retained)

**Priority Score: 0.68**
**Diagnostic value: Medium** — Backtracking indicates a file is cognitively expensive.
**False positive rate: Medium** — Single-session backtracking is common and normal.

```typescript
interface BacktrackSignal {
  type: 'backtrack';
  editedFilePath: string;
  reEditedWithinSteps: number;
  likelyCause: 'wrong_assumption' | 'missing_context' | 'cascading_change' | 'unknown';
  stepsBetweenEdits: number;
  filesSeen: string[];         // What files did agent read between the two edits?
}
```

---

### Signal Class 5: Read-Then-Abandon (NEW — High Value)

**Priority Score: 0.79**
**Diagnostic value: High** — Files that are read but never edited or referenced again are either red herrings or navigation failures. When this pattern is cross-session consistent, it means agents consistently go to the wrong file first.
**False positive rate: Medium** — Common in exploratory sessions, but the cross-session threshold is strict.

```typescript
interface ReadAbandonSignal {
  type: 'read_abandon';
  filePath: string;
  readCount: number;             // Times read in this session
  editOccurred: boolean;         // Was this file ever edited/written in this session?
  readDurationMs: number;        // How long was spent on this file?
  filesReadAfter: string[];      // What files did agent go to next?
  taskType: string;
  sessionId: string;
}
```

**What this catches:** Agents consistently read `apps/frontend/src/main/ipc-handlers/github.ts` when working on GitHub issues, then pivot to `apps/frontend/src/main/ipc-handlers/github-issues.ts` — because the file they want is actually `github-issues.ts`. After 3 sessions, the observer knows: "When agents look for GitHub issue IPC handlers, they go to github.ts first by mistake — redirect them to github-issues.ts."

**Promoted memory type:** `gotcha` with content: "When working on GitHub issue handlers, the entry point is `ipc-handlers/github-issues.ts` not `ipc-handlers/github.ts`. Agents frequently start in the wrong file."

---

### Signal Class 6: Repeated Grep Query (NEW — Confusion Indicator)

**Priority Score: 0.76**
**Diagnostic value: High** — Repeated identical grep queries within a session mean the agent ran the same search multiple times without finding what it needed. This is a reliable confusion signal.
**False positive rate: Low** — Repeating the same Grep query is never intentional.

```typescript
interface RepeatedGrepSignal {
  type: 'repeated_grep';
  pattern: string;              // The grep pattern
  normalizedPattern: string;    // Path-normalized, lowercased
  repeatCount: number;          // How many times this exact query ran in one session
  timeBetweenRepeatsMs: number[];
  resultsFound: boolean[];      // Did each query return results?
  contextBefore: string;        // What was the agent trying to accomplish?
}
```

**What this catches:** If an agent runs `Grep("IPC_HANDLER_GITHUB")` three times in a session, the first time got 0 results, the second got confusing results, the third finally worked — the observer knows the agent was lost. The promoted memory: "To find IPC handlers for the GitHub module, search for `register.*github` in `ipc-handlers/`, not the handler name directly."

**Promoted memory type:** `module_insight` or `gotcha` depending on whether the query was file-scoped.

---

### Signal Class 7: Tool Sequence Pattern (V3, retained + enhanced)

**Priority Score: 0.73**
**Diagnostic value: Medium** — Repeated sequences become workflow recipes.
**False positive rate: Low** — Sequence frequency threshold is strict.

```typescript
interface SequenceSignal {
  type: 'sequence';
  toolSequence: Array<{
    tool: string;
    argPattern: string;  // Normalized: file paths → module names, values → types
  }>;
  context: string;       // What the agent was trying to accomplish
  frequency: number;
  successRate: number;   // Fraction of sequences that led to task completion
  sessionIds: string[];
}
```

**Enhancement:** Normalize tool arguments before pattern matching. `Read("apps/frontend/src/main/ai/session/runner.ts")` and `Read("apps/frontend/src/main/ai/agent/worker.ts")` should both match as `Read([ai/session/])` and `Read([ai/agent/])` — the pattern is "reads from the ai/ directory," not the specific file.

---

### Signal Class 8: Time-Per-Step Anomaly (V3, retained)

**Priority Score: 0.48**
**Diagnostic value: Low without correlation** — Time alone is a weak signal.
**False positive rate: High** — Network latency, rate limiting, and user pauses all affect timing.

```typescript
interface TimeAnomalySignal {
  type: 'time_anomaly';
  filePath: string;
  dwellMs: number;              // Time between Read tool call and next tool call
  readCount: number;
  correlatesWithError: boolean; // Only valuable when true
  correlatesWithBacktrack: boolean;
}
```

**Rule:** `TimeAnomalySignal` is only promoted if `correlatesWithError || correlatesWithBacktrack`. Time alone is noise; time-plus-confusion is signal.

---

### Signal Class 9: Agent Self-Correction (NEW — Very High Value)

**Priority Score: 0.88**
**Diagnostic value: Very high** — When an agent's text stream contains self-correction signals ("I was wrong about...", "Actually, the correct approach is...", "Let me re-read..."), this indicates the agent discovered something surprising. These are the highest-quality declarative memories available without explicit `remember_this` calls.
**False positive rate: Low** — The detection pattern is specific.

```typescript
interface SelfCorrectionSignal {
  type: 'self_correction';
  triggeringText: string;       // The agent's text that contains the correction
  correctionType: 'factual' | 'approach' | 'api' | 'config' | 'path';
  confidence: number;           // Pattern-match confidence (0-1)
  correctedAssumption: string;  // What the agent thought before
  actualFact: string;           // What the agent discovered
  relatedFile?: string;         // If the correction was about a specific file
}

// Detection patterns
const SELF_CORRECTION_PATTERNS = [
  /I was wrong about (.+?)\. (.+?) is actually/i,
  /Let me reconsider[.:]? (.+)/i,
  /Actually,? (.+?) (not|instead of|rather than) (.+)/i,
  /I initially thought (.+?) but (.+)/i,
  /Correction: (.+)/i,
  /Wait[,.]? (.+)/i,
  /I see[,.]? (.+) is (.+) not (.+)/i,
];
```

**What this catches:** Without any explicit tool call, when the agent's text stream contains "I was wrong about the IPC channel name — it's `github:issues:fetch` not `github:fetchIssues`," the observer captures this as a `gotcha` memory at high confidence. The agent performed its own correction; the observer just transcribed it.

This is the highest signal-to-noise ratio of any new signal class. Agent self-corrections are almost always worth remembering.

---

### Signal Class 10: External Reference Signal (NEW — Medium Value)

**Priority Score: 0.61**
**Diagnostic value: Medium** — When agents search the web or fetch external URLs, they are looking for information not in the codebase. Repeated external searches for the same query indicate a gap in the codebase's documentation or conventions.
**False positive rate: Medium** — Many external searches are task-specific and non-repeatable.

```typescript
interface ExternalReferenceSignal {
  type: 'external_reference';
  toolName: 'WebSearch' | 'WebFetch';
  query: string;               // Normalized search query
  url?: string;                // For WebFetch
  resultedInEdit: boolean;     // Did a file get edited after this search?
  editedFile?: string;
  sessionId: string;
}
```

**What this catches:** If agents consistently search "electron contextBridge preload pattern" when adding new IPC APIs, the observer promotes: "When adding new IPC APIs, refer to the preload bridge pattern — agents consistently look this up externally rather than using the existing codebase examples. Consider adding a CONTRIBUTING.md section on this."

---

### Signal Class 11: Glob-Then-Ignore Pattern (NEW — Medium Value)

**Priority Score: 0.64**
**Diagnostic value: Medium** — When an agent runs a Glob query and gets results, but then reads none of them — the glob returned the wrong files. This is a navigation failure.
**False positive rate: Medium** — Agents sometimes glob to count/verify before deciding not to read.

```typescript
interface GlobIgnoreSignal {
  type: 'glob_ignore';
  pattern: string;
  resultsReturned: number;
  filesReadFromResults: number;  // How many returned files were actually Read
  ignoredFraction: number;       // (resultsReturned - filesRead) / resultsReturned
  taskContext: string;
}
```

**Promotion threshold:** `ignoredFraction > 0.9` (agent got results but read < 10% of them) in >= 2 sessions. Promoted as `gotcha`: "Glob pattern X returns noise files in this context. Agents typically ignore the results. Use Y pattern instead."

---

### Signal Class 12: Import/Require Discovery (NEW — Low Value, High Precision)

**Priority Score: 0.52**
**Diagnostic value: Low-Medium** — When an agent reads a file and then immediately reads the files it imports, the observer can infer import-chasing patterns. This supplements the AST-derived graph with behavioral evidence.
**False positive rate: Low** — The read-within-N-steps-of-parent pattern is reliable.

```typescript
interface ImportChaseSignal {
  type: 'import_chase';
  parentFile: string;
  discoveredFile: string;
  stepsToDiscover: number;   // Steps between reading parent and reading child
  toolPath: 'direct_import' | 'search_then_read';
  taskType: string;
}
```

**Value:** Agents that chase imports via search rather than direct Read are discovering relationships the Knowledge Graph does not yet model. These signals supplement the AST layer with behavioral evidence.

---

### Signal Class 13: Test-Before-Implement (NEW — High Value for Calibration)

**Priority Score: 0.74**
**Diagnostic value: High for calibration** — Whether agents read/run tests before or after implementing determines the effective methodology in use. This calibrates the `task_calibration` memory and helps pre-inject test file paths.
**False positive rate: Low** — The ordering pattern is unambiguous.

```typescript
interface TestOrderSignal {
  type: 'test_order';
  testFilePath: string;
  implementationFilePath: string;
  testReadBeforeImplement: boolean;
  testRunBeforeImplement: boolean;   // Did `npm test` run before Edit?
  specNumber?: string;
}
```

---

### Signal Class 14: Config-File-Touch (NEW — Medium Value)

**Priority Score: 0.66**
**Diagnostic value: Medium** — Config files (package.json, tsconfig.json, vite.config.ts, electron.vite.config.ts, .env) touched during a session are causal dependencies of the feature being built. Every config touch deserves a `causal_dependency` edge.
**False positive rate: Low** — Config files are rarely touched accidentally.

```typescript
interface ConfigTouchSignal {
  type: 'config_touch';
  configFile: string;
  configType: 'package_json' | 'tsconfig' | 'vite' | 'env' | 'tailwind' | 'biome' | 'other';
  taskContext: string;
  filesModifiedInSession: string[];  // What other files were modified? (causal linkage)
}
```

**Promoted memory type:** `causal_dependency`: "When adding new npm dependencies, agents always modify both package.json AND electron.vite.config.ts (to add the package to the externals/bundle list). Both must be touched together."

---

### Signal Class 15: Step-Count Overrun (NEW — High Value for Calibration)

**Priority Score: 0.71**
**Diagnostic value: High for planning accuracy** — When a session uses significantly more steps than the planned subtask count suggests, the subtask was underestimated. This feeds `task_calibration` more precisely than V3's ratio tracking.
**False positive rate: Low** — Overrun is objectively measurable.

```typescript
interface StepOverrunSignal {
  type: 'step_overrun';
  plannedSteps: number;        // From implementation plan
  actualSteps: number;         // From session finish event
  overrunRatio: number;        // actualSteps / plannedSteps
  module: string;              // Which module was being worked on?
  subtaskType: string;         // What kind of subtask? ("add feature", "fix bug", etc.)
  succeeded: boolean;
}
```

**Promoted memory type:** `task_calibration`: "Authentication module subtasks are consistently underestimated. Actual steps are 2.3× the planned count. Allocate more steps when planning auth work."

---

### Signal Class 16: Parallel Agent Conflict (NEW — High Value)

**Priority Score: 0.82**
**Diagnostic value: High** — When parallel subagents both try to edit the same file, the merge layer must intervene. This conflict reveals that the files are causally coupled and should not be assigned to different subagents in the same pipeline.
**False positive rate: Very low** — Merge conflicts are rare and always meaningful.

```typescript
interface ParallelConflictSignal {
  type: 'parallel_conflict';
  conflictedFile: string;
  subagentIds: string[];       // Which subagents both touched this file
  subtaskDescriptions: string[]; // What each subagent was doing
  resolvedHow: 'merge' | 'override' | 'manual';
  specNumber: string;
}
```

**Promoted memory type:** `gotcha`: "Files A and B are causally linked — parallel subagents consistently conflict when both are assigned. Assign them to the same subtask."

---

### Signal Class 17: Session Context Token Spike (NEW — Value for Planning)

**Priority Score: 0.63**
**Diagnostic value: Medium-High for session splitting** — When a session's context token count grows disproportionately fast relative to the files touched, the module is context-expensive. This feeds `context_cost` memories more precisely.
**False positive rate: Low** — Token counts from the Vercel AI SDK finish event are exact.

```typescript
interface ContextTokenSpikeSignal {
  type: 'context_token_spike';
  module: string;
  tokensUsed: number;
  filesRead: number;
  tokensPerFile: number;       // tokensUsed / filesRead
  sessionPhase: UniversalPhase;
  exceeded_budget: boolean;    // Did this session hit context limits?
}
```

### Signal Priority Reference Table

| # | Signal Class | Priority Score | Promotes To | Min Sessions |
|---|-------------|----------------|-------------|-------------|
| 9 | Self-Correction | 0.88 | gotcha, module_insight | 1 |
| 2 | Co-Access Graph | 0.91 | causal_dependency, prefetch_pattern | 3 |
| 3 | Error-Retry | 0.85 | error_pattern, gotcha | 2 |
| 16 | Parallel Conflict | 0.82 | gotcha | 1 |
| 10 | External Reference | 0.61 | module_insight | 3 |
| 5 | Read-Abandon | 0.79 | gotcha | 3 |
| 6 | Repeated Grep | 0.76 | module_insight, gotcha | 2 |
| 13 | Test Order | 0.74 | task_calibration | 3 |
| 7 | Sequence Pattern | 0.73 | workflow_recipe | 3 |
| 1 | File Access | 0.72 | prefetch_pattern | 3 |
| 15 | Step Overrun | 0.71 | task_calibration | 3 |
| 12 | Import Chase | 0.52 | causal_dependency | 4 |
| 14 | Config Touch | 0.66 | causal_dependency | 2 |
| 11 | Glob-Ignore | 0.64 | gotcha | 2 |
| 17 | Token Spike | 0.63 | context_cost | 3 |
| 4 | Backtrack | 0.68 | gotcha | 2 |
| 8 | Time Anomaly | 0.48 | (only with correlation) | 3 |

---

## 5. Scratchpad 2.0 — Intelligent In-Session Analysis

### The Problem with a Passive Scratchpad

V3's scratchpad is a buffer. Events go in; nothing comes out until `finalize()`. This is correct for writes (no premature promotion), but it misses an opportunity: lightweight in-session pattern detection that improves promotion precision and enables early trigger conditions.

The key constraint: **scratchpad analysis must be O(n) or better with no memory allocations beyond the signal buffer itself.** No LLM, no embeddings, no database queries during observation.

### Scratchpad 2.0 Data Structures

```typescript
// All structures use pre-allocated fixed-size arrays/maps.
// The scratchpad never grows beyond its initial allocation.

interface Scratchpad {
  // Session identity
  sessionId: string;
  sessionType: SessionType;
  startedAt: number;

  // Signal buffers (capped at MAX_SIGNALS_PER_TYPE)
  signals: Map<SignalType, ObserverSignal[]>;

  // Lightweight in-memory analytics (updated incrementally)
  analytics: ScratchpadAnalytics;

  // Staging area for acute signals (real-time detection)
  acuteCandidates: AcuteCandidate[];

  // Confidence modifiers (computed in-session, applied during finalize)
  confidenceModifiers: Map<string, number>;
}

interface ScratchpadAnalytics {
  // File access tracking (updated per-event, O(1))
  fileAccessCounts: Map<string, number>;
  fileFirstAccess: Map<string, number>;    // step index of first access
  fileLastAccess: Map<string, number>;
  fileEditSet: Set<string>;               // Files that were written/edited

  // Grep tracking (updated per-event, O(1))
  grepPatternCounts: Map<string, number>;  // normalized pattern → count
  grepPatternResults: Map<string, boolean[]>; // pattern → [hadResults, ...]

  // Error tracking
  errorFingerprints: Map<string, number>;  // errorFingerprint → retry count

  // Step counting
  currentStep: number;
  stepsWithToolCalls: number;

  // Sequence detection (circular buffer, last 8 steps)
  recentToolSequence: CircularBuffer<string>;
  detectedSubsequences: Map<string, number>; // subsequence → times seen this session

  // Co-access detection (updated per file-read event)
  recentlyAccessedFiles: CircularBuffer<string>; // last 5 accessed files
  intraSessionCoAccess: Map<string, Set<string>>; // fileA → Set<fileB> accessed within 5 steps

  // Timing
  stepTimestamps: number[];    // Timestamp per step (for time anomaly detection)

  // Self-correction detection
  selfCorrectionCount: number;
  lastSelfCorrectionStep: number;

  // Config file touches
  configFilesTouched: Set<string>;

  // Token tracking
  totalInputTokens: number;
  totalOutputTokens: number;
  peakContextTokens: number;
}
```

### Incremental Analytics Updates (O(1) per event)

```typescript
class Scratchpad2 {
  private data: Scratchpad;

  // Called for EVERY event — must be < 0.5ms
  ingest(event: WorkerEvent): void {
    switch (event.type) {
      case 'tool-call':
        this.onToolCall(event);
        break;
      case 'tool-result':
        this.onToolResult(event);
        break;
      case 'text-delta':
        this.onTextDelta(event);
        break;
      case 'finish-step':
        this.onFinishStep(event);
        break;
      case 'error':
        this.onError(event);
        break;
    }
  }

  private onToolCall(event: ToolCallEvent): void {
    const a = this.data.analytics;
    a.currentStep++;
    a.stepsWithToolCalls++;

    // File access tracking
    if (isFileAccessTool(event.toolName)) {
      const path = event.args.file_path as string;
      a.fileAccessCounts.set(path, (a.fileAccessCounts.get(path) ?? 0) + 1);
      if (!a.fileFirstAccess.has(path)) {
        a.fileFirstAccess.set(path, a.currentStep);
      }
      a.fileLastAccess.set(path, a.currentStep);

      // Intra-session co-access detection (O(k) where k = buffer size = 5)
      for (const recentFile of a.recentlyAccessedFiles.toArray()) {
        if (recentFile !== path) {
          const coSet = a.intraSessionCoAccess.get(path) ?? new Set();
          coSet.add(recentFile);
          a.intraSessionCoAccess.set(path, coSet);
        }
      }
      a.recentlyAccessedFiles.push(path);

      // Config file detection
      if (isConfigFile(path)) {
        a.configFilesTouched.add(path);
      }
    }

    // Grep tracking
    if (event.toolName === 'Grep') {
      const pattern = normalizeGrepPattern(event.args.pattern as string);
      a.grepPatternCounts.set(pattern, (a.grepPatternCounts.get(pattern) ?? 0) + 1);
    }

    // Sequence tracking (circular buffer, last 8 tool calls)
    const toolKey = `${event.toolName}:${normalizeToolArgs(event.toolName, event.args)}`;
    a.recentToolSequence.push(toolKey);

    // Write/Edit tracking
    if (event.toolName === 'Edit' || event.toolName === 'Write') {
      a.fileEditSet.add(event.args.file_path as string);
    }
  }

  private onToolResult(event: ToolResultEvent): void {
    const a = this.data.analytics;

    // Grep result tracking
    if (event.toolName === 'Grep') {
      const pattern = normalizeGrepPattern(event.args?.pattern as string);
      const results = a.grepPatternResults.get(pattern) ?? [];
      results.push(event.resultLength > 0);
      a.grepPatternResults.set(pattern, results);
    }
  }

  private onTextDelta(event: TextDeltaEvent): void {
    // Self-correction pattern detection (regex match, O(n) on delta length)
    for (const pattern of SELF_CORRECTION_PATTERNS) {
      const match = event.delta.match(pattern);
      if (match) {
        this.data.analytics.selfCorrectionCount++;
        this.data.analytics.lastSelfCorrectionStep = this.data.analytics.currentStep;

        // Stage as acute candidate immediately
        this.data.acuteCandidates.push({
          type: 'self_correction',
          step: this.data.analytics.currentStep,
          rawMatch: match[0],
          confidence: 0.82,
          timestamp: Date.now(),
        });
        break; // One match per delta is enough
      }
    }
  }

  private onFinishStep(event: FinishStepEvent): void {
    const a = this.data.analytics;
    a.stepTimestamps.push(Date.now());

    if (event.usage) {
      a.totalInputTokens += event.usage.promptTokens ?? 0;
      a.totalOutputTokens += event.usage.completionTokens ?? 0;
      a.peakContextTokens = Math.max(a.peakContextTokens, event.usage.promptTokens ?? 0);
    }
  }

  private onError(event: ErrorEvent): void {
    const fingerprint = computeErrorFingerprint(event.error);
    const a = this.data.analytics;
    a.errorFingerprints.set(fingerprint, (a.errorFingerprints.get(fingerprint) ?? 0) + 1);
  }

  // Called during finalize() — derives signals from analytics
  deriveSignals(): ObserverSignal[] {
    const signals: ObserverSignal[] = [];
    const a = this.data.analytics;

    // Derive ReadAbandonment signals
    for (const [file, count] of a.fileAccessCounts) {
      if (count >= 2 && !a.fileEditSet.has(file)) {
        signals.push({
          type: 'read_abandon',
          filePath: file,
          readCount: count,
          editOccurred: false,
          readDurationMs: estimateReadDuration(a, file),
          filesReadAfter: getFilesReadAfter(a, file),
          taskType: this.data.sessionType,
          sessionId: this.data.sessionId,
        });
      }
    }

    // Derive RepeatedGrep signals
    for (const [pattern, count] of a.grepPatternCounts) {
      if (count >= 2) {
        signals.push({
          type: 'repeated_grep',
          pattern,
          normalizedPattern: pattern,
          repeatCount: count,
          timeBetweenRepeatsMs: [],  // Approximate from timestamps
          resultsFound: a.grepPatternResults.get(pattern) ?? [],
          contextBefore: '',
        });
      }
    }

    // Derive IntraSession CoAccess signals
    for (const [fileA, partners] of a.intraSessionCoAccess) {
      for (const fileB of partners) {
        signals.push({
          type: 'co_access',
          fileA,
          fileB,
          timeDeltaMs: 0,  // Approximate
          stepDelta: 0,
          sessionId: this.data.sessionId,
          directional: false,
          taskTypes: [this.data.sessionType],
        });
      }
    }

    // Derive ConfigTouch signals
    if (a.configFilesTouched.size > 0 && a.fileEditSet.size > 0) {
      for (const configFile of a.configFilesTouched) {
        signals.push({
          type: 'config_touch',
          configFile,
          configType: classifyConfigFile(configFile),
          taskContext: this.data.sessionType,
          filesModifiedInSession: Array.from(a.fileEditSet),
        });
      }
    }

    return signals;
  }
}
```

### In-Session Early Promotion Triggers

The scratchpad can detect certain patterns within a single session that warrant early staging (not early promotion — still goes through finalize after validation):

```typescript
interface EarlyPromotionTrigger {
  condition: (analytics: ScratchpadAnalytics) => boolean;
  signalType: SignalType;
  priority: number;  // 0-1, promotes to front of finalize() queue
}

const EARLY_TRIGGERS: EarlyPromotionTrigger[] = [
  {
    // Self-corrections are always high value — front of queue
    condition: (a) => a.selfCorrectionCount >= 1,
    signalType: 'self_correction',
    priority: 0.9,
  },
  {
    // Same grep 3+ times with mixed results = definitely confused
    condition: (a) => {
      for (const [, count] of a.grepPatternCounts) {
        if (count >= 3) return true;
      }
      return false;
    },
    signalType: 'repeated_grep',
    priority: 0.8,
  },
  {
    // Config file touched = causal dependency available immediately
    condition: (a) => a.configFilesTouched.size > 0 && a.fileEditSet.size >= 2,
    signalType: 'config_touch',
    priority: 0.7,
  },
];
```

---

## 6. Promotion Engine — Session-Type-Aware Heuristics

### The V3 Gap: QA-Only Promotion Covers 30% of Sessions

V3's promotion model runs `observer.finalize()` after QA passes. In a full build pipeline, QA is the terminal validation gate. But six other session types generate valuable knowledge with no QA gate:

| Session Type | V3 Coverage | V4 Strategy | Primary Signals |
|-------------|-------------|-------------|-----------------|
| Build (spec + plan + code + QA) | Yes | Retain V3 model | All 17 signal classes |
| Insights | No | Time-boxed confidence gate | Module insight, co-access, grep patterns |
| Roadmap | No | Explicit-only promotion | Decision, requirement |
| Terminal (agent terminal) | No | Pattern-only promotion | Error-retry, sequence |
| Changelog | No | Skip (low memory value) | None |
| Spec Creation | No | Lightweight confidence gate | Requirement, module insight |
| PR Review | No | Defect-pattern gate | Error pattern, gotcha |

### Gate Strategies by Session Type

#### Gate 1: Build Pipeline Gate (V3 Model, Retained)

```typescript
interface BuildGate {
  type: 'build';
  triggers: ['qa_passed'];
  confidenceFloor: 0.65;
  maxMemoriesPerPipeline: 20;
  discardOnFailure: true;  // Failed approach scratchpads are discarded
}
```

The only change from V3: if a build fails and no fix cycle runs (abandoned spec), the scratchpad is analyzed for `dead_end` candidates before discard. A dead end is only promoted if: (a) the approach was tried for > 20 steps, and (b) the agent's text stream contains explicit abandonment language ("this approach won't work", "let me try a different approach").

#### Gate 2: Insights Session Gate

Insights sessions are exploratory — no QA, no clear success criterion. The gate must be lightweight and rely on behavioral confidence rather than outcome.

```typescript
interface InsightsGate {
  type: 'insights';
  triggers: ['session_end'];

  promotionRules: [
    {
      // Co-access patterns from insights sessions ARE valuable
      // Insight agents do deep exploration — their co-access is highly informative
      signalType: 'co_access',
      minOccurrences: 1,  // Even single-session co-access from insights is staged
      confidenceReduction: 0.15,  // But with reduced confidence vs build sessions
    },
    {
      // Self-corrections from insights agents are gold
      signalType: 'self_correction',
      minOccurrences: 1,
      confidenceReduction: 0.0,  // No reduction — self-corrections are reliable regardless of session type
    },
    {
      // Module insights from exploration — high value
      signalType: 'repeated_grep',
      minOccurrences: 1,
      confidenceReduction: 0.1,
    },
  ];

  maxMemoriesPerSession: 5;  // Fewer than build (no validation anchor)
  requiresUserReview: true;  // All insight-session memories flagged needsReview=true
}
```

**Key insight for insights sessions:** Insights agents do the deepest codebase exploration of any session type. Their read-abandon patterns are especially valuable — they tried to find something, failed, then found it elsewhere. That navigation failure is a gotcha for future agents.

#### Gate 3: Terminal Session Gate (Agent Terminal)

Agent terminals are interactive — the user may direct the agent to do anything. The signals are noisier, but error-retry patterns from terminal sessions are highly reliable (the agent hit an actual error the user also cares about).

```typescript
interface TerminalGate {
  type: 'terminal';
  triggers: ['session_end', 'session_timeout'];

  promotionRules: [
    {
      // Error patterns from terminal sessions (user-directed debugging)
      signalType: 'error_retry',
      minOccurrences: 2,  // Must see same error twice in terminal sessions before promoting
      confidenceReduction: 0.1,
    },
    {
      // Sequence patterns from terminal exploration
      signalType: 'sequence',
      minOccurrences: 3,
      confidenceReduction: 0.2,
    },
  ];

  excludedSignals: ['step_overrun', 'test_order'];  // Not meaningful in terminal context
  maxMemoriesPerSession: 3;
  requiresUserReview: true;
}
```

#### Gate 4: Spec Creation Gate

Spec sessions are primarily LLM reasoning — the agent does not deeply explore the codebase. Signal value is low except for:
- Files read during spec research (navigation patterns)
- Module insights from the spec gatherer/researcher agents

```typescript
interface SpecGate {
  type: 'spec_creation';
  triggers: ['spec_accepted'];  // Only promote when spec is saved as accepted

  promotionRules: [
    {
      signalType: 'file_access',
      minOccurrences: 1,  // Even single reads during spec research have orientation value
      confidenceReduction: 0.25,  // But low confidence — spec research is exploratory
    },
  ];

  maxMemoriesPerSession: 3;
  requiresUserReview: false;  // Low confidence already baked in
}
```

#### Gate 5: PR Review Gate

PR review sessions are rich signal sources — the reviewer agent is specifically looking for defects, which means every error pattern it finds is immediately promotable.

```typescript
interface PRReviewGate {
  type: 'pr_review';
  triggers: ['review_completed'];

  promotionRules: [
    {
      // Defects found during PR review become error_pattern memories
      signalType: 'error_retry',  // Agent retries after hitting defect
      minOccurrences: 1,          // Single occurrence is enough
      confidenceReduction: 0.0,   // No reduction — PR review defects are high quality
    },
    {
      // Self-corrections during PR review are definitive gotchas
      signalType: 'self_correction',
      minOccurrences: 1,
      confidenceReduction: 0.0,
    },
  ];

  maxMemoriesPerSession: 8;  // PR reviews are dense signal sources
  requiresUserReview: false;  // Review session already has human oversight context
}
```

### Trust Defense Layer (Anti-Injection)

Inspired by the Windsurf SpAIware exploit: a memory whose content is derived from LLM output that ingested external text (WebFetch, WebSearch) must be flagged for review before promotion.

```typescript
interface TrustGate {
  // Any signal that occurred AFTER a WebFetch or WebSearch tool call
  // is potentially tainted by external content
  contaminated: boolean;
  contaminationSource?: 'web_fetch' | 'web_search' | 'file_with_external_content';
}

// In finalize():
function applyTrustGate(candidate: MemoryCandidate, signalTimeline: SignalTimeline): MemoryCandidate {
  const lastExternalToolAt = signalTimeline.lastExternalToolCallStep;
  const candidateStep = candidate.originatingStep;

  if (lastExternalToolAt !== undefined && candidateStep > lastExternalToolAt) {
    // This candidate was generated after the agent ingested external content
    // Flag for mandatory human review before any injection into future sessions
    return {
      ...candidate,
      needsReview: true,
      trustFlags: { contaminated: true, contaminationSource: 'web_fetch' },
      confidence: candidate.confidence * 0.7,  // Confidence penalty
    };
  }

  return candidate;
}
```

---

## 7. Cross-Session Pattern Synthesis

### The Problem

V3 says: "After 5 sessions touching auth, how does the observer synthesize cross-session patterns?" But provides no algorithm. This section defines the complete cross-session synthesis engine.

### Synthesis Architecture

The cross-session synthesis engine runs in three modes:

1. **Incremental mode** — runs after every session, updating rolling statistics. No LLM calls. O(n) over the new session's signals.
2. **Threshold-triggered mode** — runs when a specific module hits a session count threshold (5, 10, 20). One LLM synthesis call per trigger.
3. **Scheduled mode** — runs weekly across the entire project, looking for cross-module patterns. One LLM call per module cluster.

### Data Structures

```typescript
interface CrossSessionIndex {
  // Per-file rolling statistics
  fileStats: Map<string, FileStatRecord>;

  // Co-access edges with session history
  coAccessEdges: Map<string, CoAccessEdgeRecord>;

  // Error fingerprint registry
  errorRegistry: Map<string, ErrorRecord>;

  // Module session counts (trigger thresholds)
  moduleSessionCounts: Map<string, number>;

  // Synthesis history (avoid re-synthesizing the same pattern)
  synthesisLog: SynthesisRecord[];
}

interface FileStatRecord {
  filePath: string;
  totalSessions: number;
  totalAccessCount: number;
  editSessions: number;        // Sessions where this file was edited
  taskTypeHistogram: Map<string, number>;
  firstSeen: number;           // Timestamp
  lastSeen: number;

  // Per-session breakdown for threshold analysis
  sessionHistory: Array<{
    sessionId: string;
    sessionType: SessionType;
    accessCount: number;
    wasEdited: boolean;
    timestamp: number;
  }>;
}

interface CoAccessEdgeRecord {
  fileA: string;
  fileB: string;
  sessionCount: number;        // Sessions where both were accessed
  directionalCount: number;    // Sessions where A consistently precedes B
  taskTypeBreakdown: Map<string, number>;
  avgTimeDeltaMs: number;
  lastObserved: number;
  promotedAt?: number;         // Timestamp when promoted to causal_dependency
  synthesisTriggeredAt?: number;
}
```

### Incremental Update (After Every Session)

```typescript
class CrossSessionSynthesisEngine {
  private index: CrossSessionIndex;
  private db: Database;

  // Called after every session finalize() — always runs, even if no memories promoted
  async updateIndex(session: CompletedSession, signals: ObserverSignal[]): Promise<void> {
    // Update file stats
    for (const signal of signals) {
      if (signal.type === 'file_access' || signal.type === 'read_abandon') {
        this.updateFileStats(signal.filePath, session);
      }
      if (signal.type === 'co_access') {
        this.updateCoAccessEdge(signal.fileA, signal.fileB, session, signal);
      }
      if (signal.type === 'error_retry') {
        this.updateErrorRegistry(signal.errorFingerprint, signal, session);
      }
    }

    // Update module session counts
    const touchedModules = this.inferTouchedModules(signals);
    for (const module of touchedModules) {
      const count = (this.index.moduleSessionCounts.get(module) ?? 0) + 1;
      this.index.moduleSessionCounts.set(module, count);

      // Check synthesis thresholds
      if (SYNTHESIS_THRESHOLDS.includes(count)) {
        await this.triggerModuleSynthesis(module, count);
      }
    }

    // Persist to SQLite (non-blocking)
    await this.persistIndex();
  }

  private async triggerModuleSynthesis(module: string, sessionCount: number): Promise<void> {
    // Avoid re-synthesizing the same module at the same threshold
    const alreadySynthesized = this.index.synthesisLog.some(
      s => s.module === module && s.triggerCount === sessionCount
    );
    if (alreadySynthesized) return;

    const moduleStats = this.buildModuleStatsSummary(module);

    // Single LLM call — this is the ONLY LLM call in the cross-session engine
    const synthesis = await generateText({
      model: fastModel,
      prompt: buildSynthesisPrompt(module, moduleStats, sessionCount),
      maxTokens: 400,
    });

    const memories = parseSynthesisOutput(synthesis.text);

    for (const memory of memories) {
      if (await this.isNovel(memory)) {
        await memoryService.store({
          ...memory,
          source: 'observer_inferred',
          needsReview: true,
          confidence: computeSynthesisConfidence(sessionCount, moduleStats),
        });
      }
    }

    this.index.synthesisLog.push({
      module,
      triggerCount: sessionCount,
      synthesizedAt: Date.now(),
      memoriesGenerated: memories.length,
    });
  }
}

// Synthesis thresholds: when to trigger cross-session LLM analysis
const SYNTHESIS_THRESHOLDS = [5, 10, 20, 50, 100];
```

### The Synthesis Prompt

```typescript
function buildSynthesisPrompt(
  module: string,
  stats: ModuleStatsSummary,
  sessionCount: number,
): string {
  return `You are analyzing ${sessionCount} agent sessions that worked on the "${module}" module of a codebase.

**File access patterns:**
${stats.topFiles.map(f => `- ${f.path}: accessed in ${f.sessions} sessions (${f.editSessions} with edits)`).join('\n')}

**Files always co-accessed together:**
${stats.strongCoAccess.map(e => `- ${e.fileA} + ${e.fileB}: together in ${e.sessions} sessions`).join('\n')}

**Repeated error patterns:**
${stats.errors.map(e => `- "${e.errorType}": occurred in ${e.sessions} sessions, resolved by: ${e.resolvedHow}`).join('\n')}

**Session types touching this module:**
${Object.entries(stats.taskTypeHistogram).map(([type, count]) => `- ${type}: ${count} sessions`).join('\n')}

Based on these ${sessionCount} sessions, identify:
1. What files should always be pre-fetched when working in this module? (prefetch_pattern)
2. What non-obvious coupling exists between files? (causal_dependency or gotcha)
3. What error patterns recur that future agents should know about? (error_pattern)
4. What does this module do that is NOT obvious from the file names? (module_insight)

Format as JSON array: [{ "type": "...", "content": "...", "relatedFiles": [...], "confidence": 0.0-1.0 }]
Maximum 5 memories. Omit obvious things. Focus on non-obvious patterns.`;
}
```

### Cross-Module Pattern Detection (Weekly)

Beyond per-module synthesis, the weekly scheduled job looks for cross-module patterns:

```typescript
async function runWeeklyCrossModuleSynthesis(): Promise<void> {
  // Find pairs of modules with high co-access across sessions
  const crossModuleEdges = await db.all(`
    SELECT
      m1.module as moduleA,
      m2.module as moduleB,
      COUNT(*) as sharedSessions,
      AVG(e.avg_time_delta_ms) as avgDelta
    FROM observer_co_access_edges e
    JOIN module_file_map m1 ON e.file_a = m1.file_path
    JOIN module_file_map m2 ON e.file_b = m2.file_path
    WHERE m1.module != m2.module
      AND e.session_count >= 5
    GROUP BY m1.module, m2.module
    HAVING sharedSessions >= 3
    ORDER BY sharedSessions DESC
    LIMIT 10
  `);

  // For each cross-module pair, check if a causal_dependency memory exists
  for (const edge of crossModuleEdges) {
    const existingMemory = await memoryService.search({
      types: ['causal_dependency'],
      relatedModules: [edge.moduleA, edge.moduleB],
      minConfidence: 0.5,
    });

    if (existingMemory.length === 0) {
      // New cross-module pattern discovered — synthesize
      await synthesizeCrossModulePattern(edge);
    }
  }
}
```

### When Synthesis Fires: Complete Timeline

```
Session 1: Update incremental index. No thresholds hit. No LLM calls.
Session 2: Update incremental index. No thresholds hit. No LLM calls.
Session 3: Update incremental index. No thresholds hit. No LLM calls.
Session 4: Update incremental index. No thresholds hit. No LLM calls.
Session 5: Update incremental index. MODULE_SESSION_COUNT = 5 → THRESHOLD HIT.
           One LLM synthesis call for this module. 0-5 memories generated.
Session 6-9: Update incremental index. No thresholds hit.
Session 10: MODULE_SESSION_COUNT = 10 → THRESHOLD HIT.
            One LLM synthesis call. Novelty check against session-5 memories.
            Only net-new patterns promoted.
Session 11-19: No thresholds hit.
Session 20: MODULE_SESSION_COUNT = 20 → THRESHOLD HIT.
            One LLM synthesis call. Patterns stable across 20 sessions = high confidence.

Weekly scheduled job: Runs regardless of session count.
            Looks for cross-module patterns not captured per-module.
```

---

## 8. Observer Performance Budget

### Hard Limits

| Resource | Limit | Enforcement |
|---------|-------|-------------|
| Memory (scratchpad resident) | 50MB max | Pre-allocated buffers; error thrown if exceeded |
| CPU per event (ingest) | 2ms max | Measured via `process.hrtime()`; logged if exceeded |
| CPU per session (finalize) | 100ms max (non-LLM) | Budget tracked; finalize aborts if exceeded |
| LLM synthesis calls per session | 1 max (at finalize) | Counter enforced in `finalize()` |
| LLM synthesis calls per threshold | 1 per module per threshold level | `synthesisLog` prevents re-firing |
| Memories promoted per session | 20 max (build), 5 max (insights), 3 max (others) | Hard cap in `finalize()` |
| Database writes per session | Batched; 1 write transaction after finalize | No writes during execution |

### Budget Enforcement Code

```typescript
class BudgetTracker {
  private static readonly MAX_EVENT_CPU_MS = 2;
  private static readonly MAX_FINALIZE_CPU_MS = 100;
  private static readonly MAX_RESIDENT_BYTES = 50 * 1024 * 1024; // 50MB

  private eventCpuMs: number[] = [];
  private currentResidentBytes = 0;

  measureEventCPU<T>(fn: () => T): T {
    const start = process.hrtime.bigint();
    const result = fn();
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;

    this.eventCpuMs.push(elapsedMs);

    if (elapsedMs > BudgetTracker.MAX_EVENT_CPU_MS) {
      // Do NOT throw — observer must never block agent
      // Instead: log warning and flag for optimization
      ObserverMetrics.recordBudgetExceedance('event_cpu', elapsedMs);
    }

    return result;
  }

  checkMemoryBudget(scratchpad: Scratchpad): void {
    const estimated = estimateScratchpadBytes(scratchpad);
    if (estimated > BudgetTracker.MAX_RESIDENT_BYTES) {
      // Evict oldest signals to stay within budget
      this.evictOldestSignals(scratchpad, estimated - BudgetTracker.MAX_RESIDENT_BYTES);
      ObserverMetrics.recordBudgetExceedance('memory', estimated);
    }
  }

  private evictOldestSignals(scratchpad: Scratchpad, bytesToFree: number): void {
    // Eviction priority: time_anomaly (lowest value) → file_access (high volume) → others
    const EVICTION_ORDER: SignalType[] = [
      'time_anomaly', 'file_access', 'sequence', 'co_access',
      'import_chase', 'glob_ignore', 'test_order'
    ];

    let freed = 0;
    for (const type of EVICTION_ORDER) {
      if (freed >= bytesToFree) break;
      const signals = scratchpad.signals.get(type) ?? [];
      if (signals.length > 10) {
        // Keep only last 10 of this type
        const evicted = signals.splice(0, signals.length - 10);
        freed += estimateSignalsBytes(evicted);
        scratchpad.signals.set(type, signals);
      }
    }
  }
}
```

### Telemetry

The observer maintains its own lightweight telemetry that is separate from the agent telemetry:

```typescript
interface ObserverMetrics {
  sessionsObserved: number;
  totalEventsIngested: number;
  totalSignalsGenerated: number;
  totalMemoriesPromoted: number;

  // Performance
  p50EventCpuMs: number;
  p95EventCpuMs: number;
  p99EventCpuMs: number;
  finalizeCpuMsHistory: number[];

  // Quality
  memoriesNeedingReview: number;
  memoriesUserApproved: number;
  memoriesUserRejected: number;
  rejectionRate: number;  // user_rejected / (approved + rejected)

  // Budget exceedances
  budgetExceedances: Map<'event_cpu' | 'memory' | 'finalize_cpu', number>;
}
```

If `rejectionRate > 0.3` (users reject > 30% of observer-generated memories), the promotion thresholds automatically tighten by 20%.

---

## 9. TypeScript Interfaces and Code Examples

### 9.1 Complete Observer Interface

```typescript
// apps/frontend/src/main/ai/memory/observer/types.ts

export type SignalType =
  | 'file_access'
  | 'co_access'
  | 'error_retry'
  | 'backtrack'
  | 'read_abandon'
  | 'repeated_grep'
  | 'sequence'
  | 'time_anomaly'
  | 'self_correction'
  | 'external_reference'
  | 'glob_ignore'
  | 'import_chase'
  | 'test_order'
  | 'config_touch'
  | 'step_overrun'
  | 'parallel_conflict'
  | 'context_token_spike';

export type SessionType =
  | 'build'          // Full planner → coder → QA pipeline
  | 'insights'       // Insights/chat session
  | 'roadmap'        // Roadmap generation
  | 'terminal'       // Agent terminal session
  | 'changelog'      // Changelog generation
  | 'spec_creation'  // Spec creation pipeline
  | 'pr_review';     // PR/MR review

export interface ObserverSignal {
  type: SignalType;
  sessionId: string;
  timestamp: number;
  stepIndex?: number;
}

export interface MemoryCandidate {
  type: MemoryType;
  content: string;
  confidence: number;
  relatedFiles: string[];
  relatedModules: string[];
  tags: string[];
  originatingSignals: SignalType[];
  originatingStep?: number;
  trustFlags?: {
    contaminated: boolean;
    contaminationSource?: 'web_fetch' | 'web_search';
  };
}

export interface PromotionResult {
  promoted: Memory[];
  discarded: MemoryCandidate[];
  discardReasons: Map<string, 'frequency' | 'novelty' | 'score' | 'trust' | 'budget'>;
  synthesisCallMade: boolean;
  processingMs: number;
}
```

### 9.2 Complete MemoryObserver Class

```typescript
// apps/frontend/src/main/ai/memory/observer/memory-observer.ts

import { Scratchpad2 } from './scratchpad2';
import { CrossSessionSynthesisEngine } from './cross-session-synthesis';
import { PromotionFilterPipeline } from './promotion-pipeline';
import { BudgetTracker } from './budget-tracker';
import { getGateForSessionType } from './session-gates';

export class MemoryObserver {
  private scratchpad: Scratchpad2;
  private crossSession: CrossSessionSynthesisEngine;
  private budget: BudgetTracker;
  private sessionType: SessionType;
  private sessionId: string;

  // Volatile: reset per session
  private externalToolCallStep?: number;
  private abandonedApproachSteps: number[] = [];

  constructor(config: SessionConfig) {
    this.sessionId = config.sessionId;
    this.sessionType = inferSessionType(config);
    this.scratchpad = new Scratchpad2(config);
    this.crossSession = CrossSessionSynthesisEngine.getInstance();
    this.budget = new BudgetTracker();
  }

  // Called for EVERY worker event — MUST be synchronous and fast
  observe(event: WorkerEvent): void {
    this.budget.measureEventCPU(() => {
      // Track external tool calls for trust gate
      if (event.type === 'tool-call' && isExternalTool(event.toolName)) {
        this.externalToolCallStep = event.stepIndex;
      }

      this.scratchpad.ingest(event);
      this.budget.checkMemoryBudget(this.scratchpad.getData());
    });
  }

  // Called when agent pipeline reaches a validated state
  // For build sessions: after QA passes
  // For other sessions: after session ends naturally
  async finalize(validationResult?: ValidationResult): Promise<PromotionResult> {
    const start = performance.now();
    const gate = getGateForSessionType(this.sessionType);

    // Step 1: Derive signals from scratchpad analytics
    const derivedSignals = this.scratchpad.deriveSignals();

    // Step 2: Merge derived signals with accumulated signals
    const allSignals = [...this.scratchpad.getAccumulatedSignals(), ...derivedSignals];

    // Step 3: Apply session-type gate rules
    const gatedSignals = gate.filter(allSignals, validationResult);

    // Step 4: Apply trust gate (contamination check)
    const trustedSignals = gatedSignals.map(s =>
      this.applyTrustGate(s, this.externalToolCallStep)
    );

    // Step 5: Convert signals to memory candidates
    const candidates = await this.signalsToCandidates(trustedSignals);

    // Step 6: Run promotion filter pipeline (frequency → novelty → scoring)
    const pipeline = new PromotionFilterPipeline(this.sessionType);
    const promotionResult = await pipeline.run(candidates, {
      maxMemories: gate.maxMemoriesPerSession,
      requiresUserReview: gate.requiresUserReview,
    });

    // Step 7: Update cross-session index (always, even if no memories promoted)
    await this.crossSession.updateIndex(
      { sessionId: this.sessionId, sessionType: this.sessionType },
      allSignals,
    );

    const elapsed = performance.now() - start;
    if (elapsed > 100) {
      ObserverMetrics.recordBudgetExceedance('finalize_cpu', elapsed);
    }

    return { ...promotionResult, processingMs: elapsed };
  }

  discardScratchpad(): void {
    // Called when validation fails without fix cycle
    // Extract dead_end candidates before discard
    const deadEndCandidates = this.extractDeadEndCandidates();
    this.scratchpad.reset();

    // Dead ends from failed sessions are staged for the fix cycle's finalize
    this.abandonedApproachSteps.push(...deadEndCandidates.map(c => c.originatingStep ?? 0));
  }

  private extractDeadEndCandidates(): MemoryCandidate[] {
    const analytics = this.scratchpad.getAnalytics();
    const candidates: MemoryCandidate[] = [];

    // Only create dead_end if session ran for > 20 steps (real attempt, not trivial failure)
    if (analytics.currentStep < 20) return candidates;

    // Check for abandonment language in acute candidates
    const abandonmentSignals = this.scratchpad.getAcuteCandidates()
      .filter(c => c.type === 'self_correction' && looksLikeAbandonment(c.rawMatch));

    if (abandonmentSignals.length > 0) {
      candidates.push({
        type: 'dead_end',
        content: `Approach abandoned after ${analytics.currentStep} steps. ${abandonmentSignals[0].rawMatch}`,
        confidence: 0.6,
        relatedFiles: Array.from(analytics.fileEditSet),
        relatedModules: [],
        tags: ['dead_end', 'abandoned'],
        originatingSignals: ['self_correction'],
      });
    }

    return candidates;
  }

  private applyTrustGate(
    signal: ObserverSignal,
    externalToolStep?: number,
  ): ObserverSignal & { trustFlags?: { contaminated: boolean } } {
    if (externalToolStep !== undefined && (signal.stepIndex ?? 0) > externalToolStep) {
      return {
        ...signal,
        trustFlags: { contaminated: true, contaminationSource: 'web_fetch' },
      };
    }
    return signal;
  }

  private async signalsToCandidates(signals: ObserverSignal[]): Promise<MemoryCandidate[]> {
    const candidates: MemoryCandidate[] = [];

    // Group signals by type for batch processing
    const byType = new Map<SignalType, ObserverSignal[]>();
    for (const signal of signals) {
      const group = byType.get(signal.type) ?? [];
      group.push(signal);
      byType.set(signal.type, group);
    }

    // Convert each signal group to candidates
    // (Self-corrections → gotcha/module_insight, co-access → causal_dependency, etc.)
    for (const [type, group] of byType) {
      const typeCandidates = await convertSignalGroup(type, group);
      candidates.push(...typeCandidates);
    }

    return candidates;
  }
}
```

### 9.3 Promotion Filter Pipeline

```typescript
// apps/frontend/src/main/ai/memory/observer/promotion-pipeline.ts

export class PromotionFilterPipeline {
  async run(
    candidates: MemoryCandidate[],
    options: { maxMemories: number; requiresUserReview: boolean },
  ): Promise<PromotionResult> {
    let remaining = candidates;
    const discarded: MemoryCandidate[] = [];
    const discardReasons = new Map<string, DiscardReason>();

    // Stage 0: Validation filter (discard abandoned-approach signals)
    // (Already handled by scratchpad.discardScratchpad() before calling finalize)

    // Stage 1: Frequency threshold
    const afterFrequency = await this.applyFrequencyThreshold(remaining);
    for (const c of remaining.filter(r => !afterFrequency.includes(r))) {
      discarded.push(c);
      discardReasons.set(candidateKey(c), 'frequency');
    }
    remaining = afterFrequency;

    // Stage 2: Novelty check
    const afterNovelty = await this.applyNoveltyCheck(remaining);
    for (const c of remaining.filter(r => !afterNovelty.includes(r))) {
      discarded.push(c);
      discardReasons.set(candidateKey(c), 'novelty');
    }
    remaining = afterNovelty;

    // Stage 3: Signal scoring
    const scored = remaining.map(c => ({
      candidate: c,
      score: this.scoreCandidate(c),
    })).filter(({ score }) => score > this.getScoreThreshold(c.type));

    for (const c of remaining.filter(r => !scored.map(s => s.candidate).includes(r))) {
      discarded.push(c);
      discardReasons.set(candidateKey(c), 'score');
    }

    // Stage 4: Trust gate (mark contaminated, don't discard)
    const finalCandidates = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, options.maxMemories)
      .map(({ candidate }) => candidate);

    // Stage 5: LLM batch synthesis (ONE call, max 10-20 candidates)
    let synthesisCallMade = false;
    let promoted: Memory[] = [];

    if (finalCandidates.length > 0) {
      promoted = await this.synthesizeAndStore(finalCandidates, options.requiresUserReview);
      synthesisCallMade = true;
    }

    return {
      promoted,
      discarded,
      discardReasons,
      synthesisCallMade,
      processingMs: 0, // Set by caller
    };
  }

  private async applyFrequencyThreshold(
    candidates: MemoryCandidate[],
  ): Promise<MemoryCandidate[]> {
    // Check cross-session frequency against index
    const crossSession = CrossSessionSynthesisEngine.getInstance();

    return candidates.filter(candidate => {
      const threshold = SIGNAL_FREQUENCY_THRESHOLDS[candidate.type] ?? 3;
      const observed = crossSession.getSignalFrequency(candidate);

      // Dead ends always pass (single occurrence is enough)
      if (candidate.type === 'dead_end') return true;

      // Self-corrections always pass (high intrinsic value)
      if (candidate.originatingSignals.includes('self_correction')) return true;

      // Parallel conflicts always pass (rare and always meaningful)
      if (candidate.originatingSignals.includes('parallel_conflict')) return true;

      return observed >= threshold;
    });
  }

  private async applyNoveltyCheck(candidates: MemoryCandidate[]): Promise<MemoryCandidate[]> {
    const result: MemoryCandidate[] = [];

    for (const candidate of candidates) {
      const embedding = await embedText(candidate.content);
      const similar = await vectorSearch(embedding, { limit: 5, minSimilarity: 0.88 });

      if (similar.length === 0) {
        result.push(candidate);
      } else {
        // Check if the existing memory has lower confidence — if so, update it instead
        const mostSimilar = similar[0];
        if (mostSimilar.confidence < candidate.confidence - 0.1) {
          // Don't add new memory — update existing one
          await memoryService.updateConfidence(mostSimilar.id, candidate.confidence);
          // This is a discard-with-update — still not a new memory
        }
      }
    }

    return result;
  }

  private scoreCandidate(candidate: MemoryCandidate): number {
    const signalPriority = SIGNAL_PRIORITY_SCORES[candidate.originatingSignals[0]] ?? 0.5;
    const confidenceScore = candidate.confidence;
    const trustPenalty = candidate.trustFlags?.contaminated ? 0.3 : 0.0;

    return (signalPriority * 0.5 + confidenceScore * 0.5) - trustPenalty;
  }

  private getScoreThreshold(memoryType: MemoryType): number {
    const thresholds: Partial<Record<MemoryType, number>> = {
      'dead_end': 0.3,       // Low threshold — dead ends are valuable even at lower scores
      'gotcha': 0.5,
      'error_pattern': 0.5,
      'causal_dependency': 0.6,
      'prefetch_pattern': 0.6,
      'module_insight': 0.55,
      'workflow_recipe': 0.65,
      'task_calibration': 0.55,
    };
    return thresholds[memoryType] ?? 0.6;
  }

  private async synthesizeAndStore(
    candidates: MemoryCandidate[],
    requiresUserReview: boolean,
  ): Promise<Memory[]> {
    // Single LLM call to convert raw signal summaries to human-readable memories
    const synthesis = await generateText({
      model: fastModel,
      prompt: buildSynthesisPromptFromCandidates(candidates),
      maxTokens: candidates.length * 80, // ~80 tokens per memory
    });

    const parsed = parseSynthesizedMemories(synthesis.text, candidates);

    const stored: Memory[] = [];
    for (const memory of parsed) {
      const id = await memoryService.store({
        ...memory,
        source: 'observer_inferred',
        needsReview: requiresUserReview || (memory.trustFlags?.contaminated ?? false),
        confidence: memory.confidence,
      });
      stored.push({ ...memory, id });
    }

    return stored;
  }
}
```

### 9.4 Integration with WorkerBridge

```typescript
// apps/frontend/src/main/agent/worker-bridge.ts (additions)

class WorkerBridge {
  private observer: MemoryObserver;

  constructor(sessionConfig: SerializableSessionConfig) {
    // ... existing constructor ...
    this.observer = new MemoryObserver(sessionConfig);
  }

  private handleWorkerMessage(event: MessageEvent<WorkerEvent>): void {
    // EXISTING: relay to renderer
    this.dispatchToAgentManager(event.data);

    // NEW: tap to observer (fire-and-forget, synchronous, must be < 2ms)
    this.observer.observe(event.data);
  }

  // Called by orchestration layer after QA passes
  async onQAPassed(qaResult: QAResult): Promise<void> {
    try {
      const result = await this.observer.finalize(qaResult);

      logger.info(`[Observer] Session ${this.sessionId}: promoted ${result.promoted.length} memories, ` +
                  `discarded ${result.discarded.length}, took ${result.processingMs}ms`);

      // Notify renderer (for memory panel UI updates)
      this.mainWindow.webContents.send('memory:promoted', {
        sessionId: this.sessionId,
        count: result.promoted.length,
        memories: result.promoted.map(m => ({ id: m.id, type: m.type, content: m.content.slice(0, 100) })),
      });
    } catch (err) {
      // Observer failures MUST NOT affect agent pipeline
      logger.error('[Observer] finalize() failed:', err);
      Sentry.captureException(err, { tags: { component: 'memory_observer' } });
    }
  }

  // Called when validation fails (agent will attempt fix)
  onValidationFailed(): void {
    this.observer.discardScratchpad();
    logger.debug(`[Observer] Scratchpad discarded after validation failure (sessionId=${this.sessionId})`);
  }
}
```

---

## 10. Architecture Diagrams

### Complete Observer Data Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     WORKER THREAD (isolated)                             │
│                                                                           │
│  streamText()                                                             │
│     │ onStepFinish: { toolCalls, text, usage }                           │
│     ▼                                                                     │
│  WorkerBridge.relay()  ──────────► Renderer (UI events)                 │
│                │                                                          │
│                │ postMessage (every event)                                │
└────────────────┼────────────────────────────────────────────────────────┘
                 │
                 ▼ synchronous, < 2ms
┌─────────────────────────────────────────────────────────────────────────┐
│               MEMORY OBSERVER (main thread)                               │
│                                                                           │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                  SCRATCHPAD 2.0 (per-session)                     │   │
│  │                                                                    │   │
│  │  ScratchpadAnalytics (O(1) incremental updates):                  │   │
│  │  - fileAccessCounts          Map<string, number>                  │   │
│  │  - grepPatternCounts         Map<string, number>                  │   │
│  │  - errorFingerprints         Map<string, number>                  │   │
│  │  - intraSessionCoAccess      Map<string, Set<string>>             │   │
│  │  - recentToolSequence        CircularBuffer[8]                    │   │
│  │  - configFilesTouched        Set<string>                          │   │
│  │  - selfCorrectionCount       number                               │   │
│  │  - acuteCandidates           AcuteCandidate[]                     │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                               │                                           │
│                   validation passes / session ends                        │
│                               │                                           │
│                               ▼                                           │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │              PROMOTION FILTER PIPELINE (finalize)                 │   │
│  │                                                                    │   │
│  │  1. Derive signals from analytics                                  │   │
│  │  2. Apply session-type gate                                        │   │
│  │  3. Apply trust gate (contamination check)                         │   │
│  │  4. Frequency threshold (cross-session index lookup)               │   │
│  │  5. Novelty check (vector similarity < 0.88)                       │   │
│  │  6. Signal scoring (priority × confidence - trust penalty)         │   │
│  │  7. LLM batch synthesis (ONE call, ≤ 20 candidates)               │   │
│  │  8. Embed + store (permanent write, tagged needsReview)            │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                               │                                           │
│                               ▼                                           │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │         CROSS-SESSION SYNTHESIS ENGINE (singleton)               │   │
│  │                                                                    │   │
│  │  Incremental update (every session, O(n)):                         │   │
│  │  - fileStats      Map<string, FileStatRecord>                      │   │
│  │  - coAccessEdges  Map<string, CoAccessEdgeRecord>                  │   │
│  │  - errorRegistry  Map<string, ErrorRecord>                         │   │
│  │  - moduleSessionCounts  Map<string, number>                        │   │
│  │                                                                    │   │
│  │  Threshold-triggered synthesis (5, 10, 20, 50, 100 sessions):     │   │
│  │  - ONE LLM call per threshold per module                           │   │
│  │  - 0-5 memories per synthesis                                      │   │
│  │                                                                    │   │
│  │  Weekly scheduled synthesis:                                        │   │
│  │  - Cross-module pattern detection                                   │   │
│  │  - ONE LLM call per cross-module pattern cluster                   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                               │                                           │
│                               ▼                                           │
│                  SQLite (permanent memory store)                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Scratchpad Signal Detection Decision Tree

```
Event arrives (tool-call / text-delta / finish-step / error)
│
├─ tool-call
│   ├─ isFileAccessTool?  ── YES ──► Update fileAccessCounts, recentlyAccessedFiles
│   │                                Update intraSessionCoAccess (O(k), k=5)
│   │                                If configFile: add to configFilesTouched
│   │                                If Edit/Write: add to fileEditSet
│   ├─ toolName === 'Grep'? ── YES ──► Update grepPatternCounts
│   ├─ isExternalTool?  ── YES ──► Record externalToolCallStep
│   └─ Push to recentToolSequence (circular buffer)
│
├─ text-delta
│   └─ Match SELF_CORRECTION_PATTERNS? ── YES ──► Add to acuteCandidates
│                                                  Increment selfCorrectionCount
│
├─ tool-result
│   └─ toolName === 'Grep'? ── YES ──► Update grepPatternResults (had results?)
│
├─ finish-step
│   └─ event.usage present? ── YES ──► Update token tracking
│
└─ error
    └─ Compute errorFingerprint ──► Increment errorFingerprints[fingerprint]
```

### Session-Type Promotion Gate Selection

```
Session starts
│
▼
inferSessionType(config) → SessionType
│
├─ 'build'        → BuildGate      (promotes after QA passes)
├─ 'insights'     → InsightsGate   (promotes after session_end)
├─ 'terminal'     → TerminalGate   (promotes after session_end)
├─ 'spec_creation'→ SpecGate       (promotes after spec_accepted)
├─ 'pr_review'    → PRReviewGate   (promotes after review_completed)
├─ 'roadmap'      → RoadmapGate    (explicit-only, no observer signals)
└─ 'changelog'    → SkipGate       (no observer promotion)
```

---

## 11. Recommendations for V4

### Priority 1 (Implement First): Self-Correction Signal Detection

Self-correction signals (Signal Class 9) have the highest priority score (0.88) and the lowest implementation cost: they require only regex pattern matching on the text-delta event stream, which is already available in the observer's `onTextDelta` handler. No new data structures, no new LLM calls. One regex scan per text delta. Expected yield: 2-4 high-quality gotcha/module_insight memories per 10 sessions.

**Implementation cost:** 2-3 hours. Expected quality uplift: highest of any single signal class addition.

### Priority 2 (Implement Second): Session-Type-Aware Promotion Gates

Without session-type gates, insights sessions, terminal sessions, and PR review sessions generate zero observer memories — even though they produce valuable signals. The six gate definitions in Section 6 are concrete and implementable. They require no new signal detection, only routing logic in `finalize()`.

**Implementation cost:** 1 day. Unlocks observer coverage for ~70% of sessions currently blind.

### Priority 3: Read-Abandon Pattern Detection

Read-abandon signals (Signal Class 5) are already partially tracked by the analytics system. `fileAccessCounts` is already maintained; `fileEditSet` is already maintained. Deriving read-abandon candidates requires comparing the two maps — O(n) over the file set, zero new infrastructure.

**Implementation cost:** 4 hours. Expected yield: 1-2 navigation gotchas per 5 sessions on complex modules.

### Priority 4: Cross-Session Synthesis Engine

The threshold-triggered synthesis engine (Section 7) is the highest-value long-term investment. It compounds over time: after session 50, the system has an extremely rich behavioral picture of each module. But it requires the cross-session index to be maintained first. Build the index incrementally (it updates after every session) before building the synthesis triggers.

**Implementation cost:** 3-4 days. **Expected yield after 20 sessions:** 5-15 high-confidence module-level memories that fundamentally change agent navigation quality.

### Priority 5: Scratchpad 2.0 with Inline Analytics

The incremental analytics system (Section 5) replaces the current passive signal accumulation. Most analytics updates are already O(1) insertions into pre-existing maps. The new additions (grepPatternCounts, intraSessionCoAccess circular buffer, configFilesTouched) are simple data structure additions. The biggest change is `deriveSignals()` in `finalize()`, which converts analytics to signals automatically.

**Implementation cost:** 2 days. Eliminates a full category of signals that currently require explicit tracking.

### Anti-Recommendations (Do Not Implement in V4)

**Do not implement real-time memory writes.** The scratchpad-to-promotion model is the most important architectural decision in V3. Real-time writes during execution contaminate the memory store with failed-approach knowledge. This is the Windsurf problem: memories generated during execution may reflect code that was subsequently rewritten.

**Do not add more LLM calls per session.** The single LLM synthesis call in `finalize()` is the right limit. More calls = more cost, more latency, more failure modes. If the single call cannot handle the candidates, reduce candidates via tighter thresholds, not additional calls.

**Do not track every tool call argument.** The observer's value is pattern detection, not event replay. Storing full tool arguments for every call would require 100MB+ of storage per session and provide no incremental value over what the session transcript already contains.

### V4 Migration Path

```
Phase 1 (Week 1-2):
  - Add self-correction pattern detection to existing onTextDelta
  - Add session-type inference to MemoryObserver constructor
  - Add basic session-type routing in finalize()
  - Estimated: 2 days dev + 1 day integration

Phase 2 (Week 3-4):
  - Implement Scratchpad 2.0 analytics (replace passive buffer with incremental analytics)
  - Add read-abandon and repeated-grep derivation in deriveSignals()
  - Estimated: 3 days dev + 2 days integration + testing

Phase 3 (Month 2):
  - Implement cross-session index (SQLite schema + incremental update after each session)
  - Implement threshold-triggered synthesis (5, 10, 20 session thresholds)
  - Estimated: 4 days dev + 2 days testing

Phase 4 (Month 3):
  - Add trust gate (contamination tracking via externalToolCallStep)
  - Add budget enforcement with BudgetTracker
  - Add observer telemetry (rejection rate, budget exceedances)
  - Implement weekly cross-module synthesis job
  - Estimated: 3 days dev + 2 days testing
```

### The Long Game: What This Becomes

By session 100 on a mature project, the memory observer has built:

- A **behavioral co-access graph** that reflects runtime coupling invisible to any static analysis tool — richer than anything Augment Code's static indexer can produce
- A **navigation gotcha library** that eliminates the most common agent dead-ends — agents stop going to the wrong file first
- A **error-retry fingerprint database** that makes previously-stumped errors instantly solvable
- A **workflow recipe library** synthesized from actual successful patterns in this specific codebase
- A **module cost profile** that enables accurate session planning and prevents context-limit surprises
- **Dead-end prevention** across all session types — the system has learned what not to try

This is what it means to make Auto Claude the AI coding tool with the best memory in the industry. Not the most memories. The most *useful* memories, capturing what agents actually struggle with, automatically, without asking them.

---

## Sources

Research for this document used information from:
- [Augment Code Context Engine](https://www.augmentcode.com/context-engine)
- [Augment Code Context Engine MCP Launch](https://www.augmentcode.com/blog/context-engine-mcp-now-live)
- [Windsurf Cascade Memories Documentation](https://docs.windsurf.com/windsurf/cascade/memories)
- [Mastra Observational Memory](https://mastra.ai/blog/observational-memory)
- [Mastra Observational Memory Benchmark](https://mastra.ai/research/observational-memory)
- [Observational Memory VentureBeat Coverage](https://venturebeat.com/data/observational-memory-cuts-ai-agent-costs-10x-and-outscores-rag-on-long)
- [How Cursor Indexes Your Codebase](https://towardsdatascience.com/how-cursor-actually-indexes-your-codebase/)
- [Devin 2.0 Features](https://cognition.ai/blog/devin-2)
- [GitHub Copilot Memory](https://ainativedev.io/news/github-gives-copilot-better-memory)
- [Windsurf SpAIware Security Exploit](https://embracethered.com/blog/posts/2025/windsurf-spaiware-exploit-persistent-prompt-injection/)
- [AI Agents Memory New Stack](https://thenewstack.io/memory-for-ai-agents-a-new-paradigm-of-context-engineering/)
