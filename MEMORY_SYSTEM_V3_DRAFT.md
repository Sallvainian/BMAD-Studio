# Memory System V3 — Complete Design Draft

> Built on: V2 Draft + Methodology Abstraction Analysis + Agent-First Gap Review
> Status: Pre-implementation design document
> Date: 2026-02-21

---

## Table of Contents

1. [Design Philosophy](#1-design-philosophy)
2. [What Changed V2 → V3](#2-what-changed-v2--v3)
3. [Methodology Abstraction Layer](#3-methodology-abstraction-layer)
4. [Memory Schema](#4-memory-schema)
5. [Memory Observer](#5-memory-observer)
6. [Knowledge Graph Layer](#6-knowledge-graph-layer)
7. [Retrieval Engine](#7-retrieval-engine)
8. [Active Agent Loop Integration](#8-active-agent-loop-integration)
9. [E2E Validation Memory](#9-e2e-validation-memory)
10. [UX & Trust Model](#10-ux--trust-model)
11. [SQLite Schema](#11-sqlite-schema)
12. [Concurrency Architecture](#12-concurrency-architecture)
13. [Memory Pruning & Lifecycle Management](#13-memory-pruning--lifecycle-management)
14. [Implementation Plan](#14-implementation-plan)
15. [Open Questions](#15-open-questions)

---

## 1. Design Philosophy

### The Three Principles

**1. Methodology-Agnostic Core**
The memory system must work identically whether the agent is running native subtasks, BMAD epics/stories, TDD red/green/refactor cycles, or any future methodology plugin. The memory *core* — schema, observer, knowledge graph, retrieval engine — has zero knowledge of methodology. A thin plugin layer translates between methodology concepts and the universal memory model.

**2. Agent-First Memory Flow**
Memory is not a lookup table you query once at session start. It is a living map of the codebase that flows with the agent through every phase of work:
- Before planning: workflow recipes pre-injected based on task type
- During planning: requirements, decisions, calibration memories surface
- Per work unit start: gotchas and error patterns injected for the files about to be touched
- Mid-execution: memories written in step N are available at step N+1
- Between work units: orchestration layer passes context forward; memory observes patterns across units
- At validation: E2E observations from MCP tool use become memories
- At session end: observer infers patterns from behavioral signals; work state captured

**3. Observation Over Explicit Declaration**
The most valuable memories are never explicitly requested. They emerge from watching what the agent *does* — which files it reads together, which errors it retries, which edits it immediately reverts, which approaches it abandons. Explicit `remember_this` calls are the exception, not the primary source.

### What the System Learns Over Time

```
Session 1-5:   Cold. Agent explores the codebase from scratch every time.
               High discovery cost. No patterns established.

Session 5-15:  Observer has built co-access graph. Prefetch patterns emerging.
               Gotchas accumulating. ~30% reduction in redundant reads.

Session 15-30: Methodology-calibrated. QA failures no longer recur.
               Workflow recipes firing at planning time. Impact analysis
               preventing ripple bugs. ~60% reduction in discovery cost.

Session 30+:   The system knows this codebase. Agents navigate it like
               senior developers who built it. Context token savings
               measurable in the thousands per session.
```

---

## 2. What Changed V2 → V3

### Schema Changes

| Field | V2 | V3 |
|-------|----|----|
| `specNumber` | hardcoded string | replaced by `workUnitRef: WorkUnitRef` |
| `AgentPhase` enum | native pipeline stages | `UniversalPhase` (6 values, all methodologies map into) |
| `work_state.completedSubtasks` | native-only | `work_state.methodologyState` (plugin-defined contents) |

### New Memory Types (V3)

| Type | Source | Why added |
|------|--------|-----------|
| `e2e_observation` | QA agent MCP tool use | UI behavioral facts, test preconditions, timing constraints — only observable by running the app |
| `dead_end` | Agent explicit / observer | Strategic approach tried and abandoned — prevents re-trying failed strategies |
| `work_unit_outcome` | Auto at work-unit completion | Per work unit: what was tried, which files touched, succeeded or failed, why |
| `workflow_recipe` | Agent explicit / user taught | Procedural map for a class of task — "to add an IPC handler, do steps 1-4" |
| `context_cost` | Observer auto | Token consumption per module — helps plan session splitting |

### New Architectural Additions (V3)

- **Methodology Plugin Interface** — `MemoryMethodologyPlugin` with phase mapping, work unit resolution, relay transitions
- **Mid-session memory availability** — memories written at step N injectable by step N+1 in same session
- **Scratchpad → validated promotion pipeline** — observer accumulates notes during execution; permanent memories promoted only after QA passes; broken approaches discarded
- **Commit-time memory tagging** — link memories to the git commit that produced them
- **E2E Validation Memory Pipeline** — MCP tool results → structured `e2e_observation` memories
- **Workflow Recipe Pre-injection** — matched at planning time by task-type semantics, not just file retrieval

---

## 3. Methodology Abstraction Layer

This is the foundational architectural change in V3. It decouples the memory core from any specific agent workflow methodology.

### Universal Work Unit Reference

Every memory that belongs to a unit of work uses `WorkUnitRef` instead of `specNumber`:

```typescript
interface WorkUnitRef {
  // Which methodology plugin created this reference
  methodology: string;           // 'native' | 'bmad' | 'tdd' | 'agile' | ...

  // Hierarchy from outermost container to innermost work item.
  // Each entry is an opaque string — only the methodology plugin parses its meaning.
  // native:  ['spec_042', 'subtask_3']
  // bmad:    ['epic_3', 'story_3_2', 'task_5']
  // tdd:     ['feature_auth', 'red_cycle_5']
  // agile:   ['sprint_12', 'story_US47']
  hierarchy: string[];

  // Human-readable label for display purposes
  label: string;                 // "Epic 3 / Story 3.2" or "Spec 042 / Subtask 3"
}

// Scope determines how broadly a memory applies
type MemoryScope =
  | 'global'      // Applies to all work in this project, any methodology
  | 'module'      // Applies to specific files/modules, regardless of work unit
  | 'work_unit'   // Applies to the current work item (story, subtask, ticket)
  | 'session';    // Applies to the current agent session only
```

### Universal Phases

All methodology phases map into six universal phases. The retrieval engine and `PHASE_WEIGHTS` operate exclusively on `UniversalPhase` — no methodology-specific phase names ever reach the retrieval layer:

```typescript
type UniversalPhase =
  | 'define'      // Planning, spec, story creation, writing failing tests (TDD red)
                  // → native: 'planning', 'spec'; bmad: 'story_creation'; tdd: 'red'
  | 'implement'   // Coding, development, making tests pass (TDD green)
                  // → native: 'coding'; bmad: 'story_development'; tdd: 'green'
  | 'validate'    // QA, acceptance criteria, code review, E2E testing
                  // → native: 'qa_review'; bmad: 'story_acceptance'; tdd: 'assertion'
  | 'refine'      // Refactoring, cleanup, optimization, fixing QA issues
                  // → native: 'debugging'; tdd: 'refactor'; agile: 'tech_debt'
  | 'explore'     // Research, insights, discovery, codebase investigation
                  // → native: 'insights'; bmad: 'research'; all: open-ended sessions
  | 'reflect';    // Retrospective, learning capture, session wrap-up
                  // → all methodologies have an analog for this
```

### Methodology Plugin Interface

```typescript
interface MemoryMethodologyPlugin {
  id: string;          // 'native' | 'bmad' | 'tdd' | 'agile'
  displayName: string; // "BMAD (Epic/Story)" for UI

  // ── Phase Resolution ──────────────────────────────────────────────────────

  // Map this methodology's phase name to a UniversalPhase.
  // The retrieval engine calls this; it never sees methodology-specific names.
  mapPhase(methodologyPhase: string): UniversalPhase;

  // ── Work Unit Resolution ──────────────────────────────────────────────────

  // Produce a WorkUnitRef from the current execution context.
  // Called whenever a memory needs to be scoped to a work unit.
  resolveWorkUnitRef(context: ExecutionContext): WorkUnitRef;

  // ── Stage Relay ───────────────────────────────────────────────────────────

  // Define which stages pass memories forward to which other stages.
  // native:  [{ from: 'planner', to: 'coder' }, { from: 'coder', to: 'qa' }]
  // bmad:    [{ from: 'analyst', to: 'architect' }, { from: 'architect', to: 'dev' }, ...]
  // tdd:     [{ from: 'test_writer', to: 'implementer' }, { from: 'implementer', to: 'refactorer' }]
  getRelayTransitions(): RelayTransition[];

  // Format relay memories for injection into the next stage's context.
  // Each methodology knows how to present "what came before" to its agents.
  formatRelayContext(memories: Memory[], toStage: string): string;

  // ── Work State ────────────────────────────────────────────────────────────

  // Extract a work-state summary from session output in this methodology's terms.
  // The return value is stored opaquely in work_state.methodologyState.
  // native returns: { completedSubtasks, inProgressSubtask, keyDecisions }
  // bmad returns:   { storiesCompleted, currentStory, acceptanceCriteriaStatus }
  // tdd returns:    { testsGreen, testsRed, refactorsPending, cycleCount }
  extractWorkState(sessionOutput: string): Promise<Record<string, unknown>>;

  // Format a stored work_state.methodologyState for injection into the next session.
  formatWorkStateContext(methodologyState: Record<string, unknown>): string;

  // ── Optional Extensions ───────────────────────────────────────────────────

  // Additional memory types this methodology introduces.
  // e.g. bmad might add 'acceptance_criterion'; tdd might add 'test_contract'
  customMemoryTypes?: MemoryTypeDefinition[];

  // Called when a work unit completes — allows methodology to emit a
  // work_unit_outcome memory with methodology-specific fields.
  onWorkUnitComplete?(
    context: ExecutionContext,
    result: WorkUnitResult,
    memoryService: MemoryService,
  ): Promise<void>;
}

interface RelayTransition {
  from: string;           // Stage name in this methodology
  to: string;             // Stage name in this methodology
  filter?: {              // Optional: only relay memories matching this filter
    types?: MemoryType[];
    minConfidence?: number;
    tags?: string[];
  };
}
```

### Built-in Plugin Implementations

```typescript
// Native (current default)
const nativePlugin: MemoryMethodologyPlugin = {
  id: 'native',
  displayName: 'Auto Claude (Subtasks)',
  mapPhase: (p) => ({
    planning: 'define', spec: 'define',
    coding: 'implement',
    qa_review: 'validate', qa_fix: 'refine',
    debugging: 'refine',
    insights: 'explore',
  }[p] ?? 'explore'),
  resolveWorkUnitRef: (ctx) => ({
    methodology: 'native',
    hierarchy: [ctx.specNumber, ctx.subtaskId].filter(Boolean),
    label: ctx.subtaskId ? `Spec ${ctx.specNumber} / Subtask ${ctx.subtaskId}` : `Spec ${ctx.specNumber}`,
  }),
  getRelayTransitions: () => [
    { from: 'planner', to: 'coder' },
    { from: 'coder', to: 'qa_reviewer' },
    { from: 'qa_reviewer', to: 'qa_fixer', filter: { types: ['error_pattern', 'requirement'] } },
  ],
  // ...
};

// BMAD plugin (future)
const bmadPlugin: MemoryMethodologyPlugin = {
  id: 'bmad',
  displayName: 'BMAD (Epic/Story)',
  mapPhase: (p) => ({
    analyst: 'define', pm: 'define', architect: 'define',
    story_creation: 'define',
    dev: 'implement', story_development: 'implement',
    qa: 'validate', story_acceptance: 'validate',
    sm: 'reflect', retrospective: 'reflect',
  }[p] ?? 'explore'),
  resolveWorkUnitRef: (ctx) => ({
    methodology: 'bmad',
    hierarchy: [ctx.epicId, ctx.storyId, ctx.taskId].filter(Boolean),
    label: [ctx.epicLabel, ctx.storyLabel].filter(Boolean).join(' / '),
  }),
  getRelayTransitions: () => [
    { from: 'analyst', to: 'architect' },
    { from: 'architect', to: 'dev' },
    { from: 'dev', to: 'qa' },
    { from: 'qa', to: 'sm', filter: { types: ['decision', 'module_insight'] } },
  ],
  // ...
};
```

### How the Plugin is Used

`MemoryService` holds the active plugin. When the user changes methodology in settings, the plugin reference swaps. All existing memories remain — they retain their `workUnitRef.methodology` field and continue to be retrievable. Phase-aware retrieval uses the new plugin's `mapPhase()` going forward.

```typescript
class MemoryService {
  private plugin: MemoryMethodologyPlugin = nativePlugin;

  setMethodology(plugin: MemoryMethodologyPlugin): void {
    this.plugin = plugin;
    // No data migration. Old memories are still retrievable.
    // They'll be scored against UniversalPhase going forward.
  }

  resolvePhase(methodologyPhase: string): UniversalPhase {
    return this.plugin.mapPhase(methodologyPhase);
  }
}
```

---

## 4. Memory Schema

### Core Memory Interface

```typescript
interface Memory {
  id: string;
  type: MemoryType;
  content: string;
  confidence: number;             // 0.0 – 1.0
  tags: string[];
  relatedFiles: string[];
  relatedModules: string[];
  createdAt: string;              // ISO
  lastAccessedAt: string;         // ISO
  accessCount: number;

  // V3: work unit reference (replaces specNumber)
  workUnitRef?: WorkUnitRef;
  scope: MemoryScope;             // 'global' | 'module' | 'work_unit' | 'session'

  // Provenance
  source: MemorySource;
  sessionId: string;
  commitSha?: string;             // Git commit that produced this memory (V3 new)
  provenanceSessionIds: string[]; // Sessions that confirmed/reinforced

  // Graph link
  targetNodeId?: string;          // Link to KnowledgeGraph node

  // Relations
  relations?: MemoryRelation[];

  // Decay
  decayHalfLifeDays?: number;     // Override default (work_state=7, dead_end=90, global=∞)

  // Trust / Review
  needsReview?: boolean;
  userVerified?: boolean;
  citationText?: string;          // Short form for inline citation chips
}

type MemoryType =
  // Core (V1, all methodologies)
  | 'gotcha'           // Trap or non-obvious constraint in the codebase
  | 'decision'         // Architectural or implementation decision with rationale
  | 'preference'       // User or project coding preference
  | 'pattern'          // Reusable implementation pattern that works here
  | 'requirement'      // Functional or non-functional requirement
  | 'error_pattern'    // Recurring error and its fix
  | 'module_insight'   // Understanding about a module's purpose or behavior
  | 'workflow'         // High-level process insight (deprecated in V3 — see workflow_recipe)

  // Active loop (V2)
  | 'prefetch_pattern' // Files always/frequently read together → pre-load
  | 'work_state'       // Partial work snapshot for cross-session continuity
  | 'causal_dependency'// File A must be touched when file B is touched
  | 'task_calibration' // Actual vs planned step ratio per module

  // V3 new
  | 'e2e_observation'  // UI behavioral fact observed via MCP tool use
  | 'dead_end'         // Strategic approach tried and abandoned — do not retry
  | 'work_unit_outcome'// Per work-unit result: what happened, files touched, why
  | 'workflow_recipe'  // Step-by-step procedural map for a class of task
  | 'context_cost';    // Token consumption profile for a module

type MemorySource =
  | 'agent_explicit'    // Agent called remember_this
  | 'observer_inferred' // MemoryObserver derived from behavioral signals
  | 'qa_auto'           // Auto-extracted from QA report failures
  | 'mcp_auto'          // Auto-extracted from MCP (Electron) tool results
  | 'commit_auto'       // Auto-tagged at git commit time
  | 'user_taught';      // User typed /remember or used Teach panel

interface MemoryRelation {
  // Exactly one of these is set per relation.
  targetMemoryId?: string;   // Points to another Memory record
  targetFilePath?: string;   // Points to a file path (for causal_dependency)

  relationType: 'required_with' | 'conflicts_with' | 'validates' | 'supersedes' | 'derived_from';
  confidence: number;
  autoExtracted: boolean;
}
```

### Extended Memory Type Interfaces

```typescript
// work_state — cross-session continuity, methodology-aware
interface WorkStateMemory extends Memory {
  type: 'work_state';
  workUnitRef: WorkUnitRef;
  // Plugin-defined contents — stored opaquely, interpreted by plugin.formatWorkStateContext()
  methodologyState: Record<string, unknown>;
  decayHalfLifeDays: 7;  // Stale work state is harmful
}

// e2e_observation — observed by QA agent via MCP tools
interface E2EObservation extends Memory {
  type: 'e2e_observation';
  observationType:
    | 'precondition'      // "Must do X before testing Y"
    | 'timing'            // "Wait Nms after action before asserting"
    | 'ui_behavior'       // "Element Z always appears at position X"
    | 'test_sequence'     // "To reach state S, follow steps A→B→C"
    | 'mcp_gotcha';       // "click_by_text fails if modal is animating"
  mcpToolUsed: string;    // Which MCP tool produced this observation
  appState?: string;      // What UI state was active when observed
  // relatedFiles: maps to the component/handler file if determinable
}

// dead_end — strategic approach tried and abandoned
interface DeadEndMemory extends Memory {
  type: 'dead_end';
  approachTried: string;        // What was attempted
  whyItFailed: string;          // Root cause of failure
  alternativeUsed: string;      // What was done instead
  taskContext: string;          // What type of task led here
  decayHalfLifeDays: 90;        // Long-lived — dead ends stay relevant
}

// work_unit_outcome — per work item result
interface WorkUnitOutcome extends Memory {
  type: 'work_unit_outcome';
  workUnitRef: WorkUnitRef;
  succeeded: boolean;
  filesModified: string[];
  keyDecisions: string[];
  stepsTaken: number;
  contextTokensUsed?: number;  // V3: feeds context_cost profiling
  retryCount: number;          // How many times this work unit was retried
  failureReason?: string;      // If !succeeded
}

// workflow_recipe — procedural map for a class of task
interface WorkflowRecipe extends Memory {
  type: 'workflow_recipe';
  taskPattern: string;         // Semantic description of when to use this
  // e.g. "adding a new IPC handler", "adding a new Zustand store",
  //      "creating a new React component with i18n"
  steps: Array<{
    order: number;
    description: string;
    canonicalFile?: string;    // The file to look at/edit for this step
    canonicalLine?: number;    // Approximate line number for orientation
  }>;
  lastValidatedAt: string;     // Recipes go stale as codebase changes
  successCount: number;        // Times used successfully
  scope: 'global';             // Recipes always apply globally
}

// context_cost — token consumption profile
interface ContextCostMemory extends Memory {
  type: 'context_cost';
  module: string;
  averageTokensPerSession: number;
  p90TokensPerSession: number;  // 90th percentile — for worst-case planning
  sampleCount: number;
  scope: 'module';
}

// prefetch_pattern — unchanged from V2 but workUnitRef replaces specNumber
interface PrefetchPattern extends Memory {
  type: 'prefetch_pattern';
  alwaysReadFiles: string[];    // >80% of sessions touching this module
  frequentlyReadFiles: string[];// >50% of sessions touching this module
  moduleTrigger: string;
  sessionCount: number;
  scope: 'module';
}

// task_calibration — updated to use workUnitRef hierarchy for scoping
interface TaskCalibration extends Memory {
  type: 'task_calibration';
  module: string;
  methodology: string;          // Calibration is methodology-specific
  averageActualSteps: number;
  averagePlannedSteps: number;
  ratio: number;                // >1.0 = consistently underestimated
  sampleCount: number;
}
```

---

## 5. Memory Observer

The Observer is the passive behavioral layer — memories generated from what agents *do*, not what they *say*. It is fully methodology-agnostic: it observes file access patterns and tool call sequences regardless of whether the agent is working on a subtask, a story, or a TDD cycle.

### Scratchpad → Validated Promotion Model

The Observer does not write permanent memories during execution. Instead, it maintains a **scratchpad** — lightweight structured notes requiring no LLM calls or embeddings. Permanent memories are only promoted **after validation passes**.

```
DURING EXECUTION (scratchpad, temporary):
  - Observer tracks tool calls, file access, errors, backtracks
  - Agent's remember_this → scratchpad (NOT permanent memory)
  - No LLM calls, no embeddings — lightweight and fast

AFTER VALIDATION PASSES (observer.finalize()):
  - Scratchpad filtered: notes from broken approaches discarded
  - Patterns that survived validation promoted → permanent memory
  - work_unit_outcome written for the validated result
  - e2e_observations confirmed by QA promoted
  - LLM batch synthesis + embeddings generated HERE (single call, max 10-20 memories)

IF VALIDATION FAILS → FIX → RE-VALIDATE:
  - Scratchpad from failed run is NOT promoted
  - Fix cycle produces its own scratchpad
  - Only final passing state promotes to permanent memory
  - Failed approach MAY become dead_end (only if genuinely wrong strategy, not a typo)
```

For 40-subtask pipelines: the scratchpad accumulates across all subtasks. After the full pipeline validates (QA passes), the observer synthesizes the scratchpad into 10-20 high-value permanent memories in a single LLM synthesis call.

### Architecture: Main Thread, WorkerBridge Integration

```typescript
// worker-bridge.ts
import { MemoryObserver } from '../ai/memory/observer';

class WorkerBridge {
  private observer: MemoryObserver;

  constructor(sessionConfig: SerializableSessionConfig) {
    this.observer = new MemoryObserver(sessionConfig);
  }

  private handleWorkerMessage(event: MessageEvent) {
    this.observer.observe(event.data); // tap every event — no writes yet
    this.dispatchToAgentManager(event.data);
  }

  // Called only after QA passes — not at session end
  async onValidationPassed(qaResult: QAResult) {
    const promoted = await this.observer.finalize(qaResult);
    for (const memory of promoted) {
      await memoryService.store(memory); // permanent write only here
    }
  }

  // Called when validation fails — scratchpad discarded, not promoted
  onValidationFailed(): void {
    this.observer.discardScratchpad();
  }
}
```

### Signal Taxonomy (6 Types)

```typescript
type ObserverSignal =
  | FileAccessSignal
  | CoAccessSignal
  | ErrorRetrySignal
  | BacktrackSignal
  | SequenceSignal
  | TimeAnomalySignal;

interface FileAccessSignal {
  type: 'file_access';
  filePath: string;
  toolName: 'Read' | 'Edit' | 'Write' | 'Grep' | 'Glob';
  stepIndex: number;
  timestamp: number;
}

interface CoAccessSignal {
  type: 'co_access';
  fileA: string;
  fileB: string;
  timeDeltaMs: number;
  stepDelta: number;
  sessionId: string;
}

interface ErrorRetrySignal {
  type: 'error_retry';
  toolName: string;
  errorMessage: string;
  retryCount: number;
  resolvedHow?: string;
}

interface BacktrackSignal {
  type: 'backtrack';
  editedFilePath: string;
  reEditedWithinSteps: number;
  likelyCause: 'wrong_assumption' | 'missing_context' | 'cascading_change';
}

interface SequenceSignal {
  type: 'sequence';
  toolSequence: string[];
  context: string;
  frequency: number;
}

interface TimeAnomalySignal {
  type: 'time_anomaly';
  filePath: string;
  dwellMs: number;
  readCount: number;
}
```

### Memory Inference Rules

| Signal | Inference | Memory Type |
|--------|-----------|-------------|
| Files A+B accessed within 3 steps in ≥3 sessions | A and B are co-dependent | `causal_dependency` |
| File read 4+ times in one session without Edit | File is confusing or poorly structured | `module_insight` |
| ErrorRetry with same error 3+ times | Recurring error pattern | `error_pattern` |
| Edit followed by re-Edit within 5 steps | Wrong first assumption | `gotcha` |
| File accessed in >80% of sessions for a module | Should be pre-fetched | `prefetch_pattern` |
| BacktrackSignal with `cascading_change` | Edit triggers required paired edits | `gotcha` (with relatedFiles) |
| Agent explores approach A → abandons after 20+ steps → takes approach B | Strategic dead end | `dead_end` |
| Session context tokens tracked via finish event | Module cost profile | `context_cost` |

### Promotion Filter Pipeline

Runs in `observer.finalize()`, called only after validation passes. All steps operate on the accumulated scratchpad — no intermediate writes.

```
scratchpad signals (accumulated during execution)
    │
    ▼ 0. Validation filter
    │     Discard signals associated with approaches that were tried and abandoned
    │     (i.e. from failed subtasks that were subsequently retried and fixed)
    │
    ▼ 1. Frequency threshold
    │     file_access: ≥3 sessions, co_access: ≥2 sessions
    │     error_retry: ≥2 occurrences, backtrack: ≥2 occurrences
    │     dead_end: 1 occurrence (high-value even once)
    │
    ▼ 2. Novelty check (cosine similarity < 0.88 vs existing memories)
    │
    ▼ 3. Signal scoring
    │     score = (frequency × 0.4) + (recency × 0.3) + (novelty × 0.3)
    │     Threshold: score > 0.6 (dead_end threshold: 0.3 — lower bar)
    │
    ▼ 4. LLM batch synthesis (one call per pipeline completion, not per session)
    │     Convert scratchpad signals + context into human-readable memory.content
    │     Max 10-20 memories per pipeline run
    │
    ▼ 5. Embedding generation (happens HERE, not during execution)
    │     Only promoted memories get embeddings — saves cost on ephemeral signals
    │
    ▼ marked source='observer_inferred', needsReview=true, stored permanently
```

### Co-Access Graph

```typescript
interface CoAccessEdge {
  fileA: string;
  fileB: string;
  weight: number;          // Sessions in which both accessed, normalized [0,1]
  avgTimeDeltaMs: number;
  directional: boolean;    // A almost always precedes B
  lastObservedAt: string;
}
```

Cold-start bootstrap: parse `git log --diff-filter=M --name-only` to seed co-commit patterns before any agent sessions exist.

---

## 6. Knowledge Graph Layer

The Knowledge Graph is a separate, linked layer — not embedded in the memory store. It models codebase structure, enabling impact radius analysis that enriches both memory retrieval and agent planning.

### Linked-But-Separate Design

```
Memory record                    Knowledge Graph node
─────────────────                ─────────────────────
{ targetNodeId: "node_abc" } ──► { id: "node_abc"          }
{ relatedFiles: [...] }          { label: "auth.ts"         }
                                 { associatedMemoryIds: [...] }
```

### Graph Schema

```typescript
type NodeType =
  | 'file' | 'directory' | 'module'
  | 'function' | 'class' | 'interface'
  | 'pattern' | 'dataflow' | 'invariant' | 'decision';

type EdgeType =
  // Structural (AST-derived via tree-sitter)
  | 'imports' | 'calls' | 'implements' | 'extends' | 'exports'
  // Semantic (LLM-derived or agent-discovered)
  | 'depends_logically' | 'is_entrypoint_for'
  | 'handles_errors_from' | 'applies_pattern' | 'flows_to';

interface GraphNode {
  id: string;
  label: string;
  type: NodeType;
  metadata: Record<string, unknown>;
  associatedMemoryIds: string[];
  staleAt?: string;
  lastAnalyzedAt: string;
}

interface GraphEdge {
  fromId: string;
  toId: string;
  type: EdgeType;
  weight: number;         // Impact propagation weight (0.0–1.0)
  confidence: number;
  autoExtracted: boolean;
}
```

### Impact Radius via Closure Table

Pre-computed transitive closure for O(1) impact queries:

```sql
CREATE TABLE graph_closure (
  ancestor_id TEXT NOT NULL,
  descendant_id TEXT NOT NULL,
  depth INTEGER NOT NULL,
  path TEXT,              -- JSON array of node IDs
  PRIMARY KEY (ancestor_id, descendant_id)
);

-- O(1) impact query
SELECT gc.descendant_id, gc.depth, gn.label
FROM graph_closure gc
JOIN graph_nodes gn ON gc.descendant_id = gn.id
WHERE gc.ancestor_id = (SELECT id FROM graph_nodes WHERE label = ?)
  AND gc.depth <= 3
ORDER BY gc.depth;
```

### Impact Analysis

```typescript
interface ImpactAnalysis {
  targetNode: GraphNode;
  directDependents: GraphNode[];
  transitiveDependents: GraphNode[];
  testCoverage: string[];
  invariants: Memory[];
  e2eObservations: E2EObservation[]; // V3 new: UI test implications
  impactScore: number;
}

const EDGE_IMPACT_WEIGHTS: Record<EdgeType, number> = {
  imports: 0.9, calls: 0.8, implements: 0.7, extends: 0.7, exports: 0.6,
  depends_logically: 0.5, is_entrypoint_for: 0.8,
  handles_errors_from: 0.4, applies_pattern: 0.3, flows_to: 0.6,
};
```

### 3-Layer Construction

| Layer | Source | When |
|-------|--------|------|
| Structural | tree-sitter AST | Cold start, file change |
| Semantic | LLM module analysis | First session, periodic refresh |
| Knowledge | Agent + observer + MCP | Ongoing, every session |

**Semantic Module Scan (First Project Open)**

On first project open, the system runs a one-time LLM-powered semantic scan across top-level modules. For each module directory, the LLM reads key files (entry points, exports, README) and produces:
- A one-paragraph **module summary**: "This module handles OAuth token refresh, credential storage, and multi-account profile switching."
- **Convention extraction**: "This project uses camelCase IPC handler names, Vitest for tests, and always adds i18n keys to both en/ and fr/ locales."

These are stored as `module_insight` memories with `scope: 'module'` and `source: 'observer_inferred'`. Without this scan, the Knowledge Graph is structurally complete but semantically empty — agents would know file A imports file B but not *what* module A does. The semantic scan lets the first session start already knowing what each module does, not just how it connects.

The scan is user-visible: "Auto Claude is analyzing your codebase..." with module-by-module progress. This sets the expectation that the system is learning the project and builds trust in the memory system from the start.

**Incremental invalidation**: file mtime change → mark `stale_at` → rebuild only stale subgraph.

**Scale ceiling**: SQLite closure handles ~50K nodes. At 100K+ nodes, migrate to Kuzu embedded graph DB (35-60MB binary, same query interface).

### Agent Tools

```typescript
const analyzeImpactTool = tool({
  description: 'Analyze which files/modules are affected by changing a given file, including known memories and E2E test implications',
  inputSchema: z.object({ filePath: z.string(), maxDepth: z.number().optional().default(3) }),
  execute: async ({ filePath, maxDepth }) => knowledgeGraph.analyzeImpact(filePath, maxDepth),
});

const getDependenciesTool = tool({
  description: 'Get all files this file depends on (direct and transitive)',
  inputSchema: z.object({ filePath: z.string() }),
  execute: async ({ filePath }) => knowledgeGraph.getDependencies(filePath),
});

const getWorkflowRecipeTool = tool({
  description: 'Get step-by-step instructions for a class of task (e.g. "add IPC handler", "add Zustand store")',
  inputSchema: z.object({ taskDescription: z.string() }),
  execute: async ({ taskDescription }) => memoryService.searchWorkflowRecipe(taskDescription),
});
```

---

## 7. Retrieval Engine

### Phase-Aware Re-Ranking

All retrieval operates on `UniversalPhase`. The active methodology plugin translates its phase name before the retrieval call — the retrieval engine never sees methodology-specific names.

```typescript
const PHASE_WEIGHTS: Record<UniversalPhase, Record<MemoryType, number>> = {
  define: {
    requirement: 1.5, decision: 1.3, workflow_recipe: 1.5, task_calibration: 1.4,
    pattern: 1.2, work_state: 1.1, preference: 1.0, module_insight: 1.0,
    gotcha: 0.8, error_pattern: 0.7, causal_dependency: 0.9,
    dead_end: 1.2,        // Avoid dead ends early in planning
    e2e_observation: 0.6, prefetch_pattern: 0.5, work_unit_outcome: 1.0,
    context_cost: 1.3,    // Know how expensive this module is before planning
  },
  implement: {
    gotcha: 1.5, error_pattern: 1.3, causal_dependency: 1.3, pattern: 1.2,
    module_insight: 1.2, prefetch_pattern: 1.1, work_state: 1.0,
    dead_end: 1.3,        // Don't repeat failed approaches during coding
    workflow_recipe: 1.4, // Recipes are most valuable during implementation
    work_unit_outcome: 0.9, e2e_observation: 0.7,
    requirement: 0.8, decision: 0.7, task_calibration: 0.5,
    preference: 0.9, context_cost: 0.4,
  },
  validate: {
    error_pattern: 1.5, requirement: 1.4, e2e_observation: 1.5,
    gotcha: 1.2, decision: 1.1, module_insight: 0.9,
    dead_end: 0.8, work_state: 0.5, prefetch_pattern: 0.3,
    causal_dependency: 1.0, task_calibration: 0.8, workflow_recipe: 0.6,
    work_unit_outcome: 1.1, // Past outcomes inform what to check
    context_cost: 0.3,
  },
  refine: {
    pattern: 1.4, error_pattern: 1.3, gotcha: 1.2, dead_end: 1.4,
    decision: 1.0, module_insight: 1.1, work_state: 0.9,
    requirement: 0.7, e2e_observation: 0.8, workflow_recipe: 1.0,
    causal_dependency: 1.1, work_unit_outcome: 0.8, context_cost: 0.4,
  },
  explore: {
    decision: 1.4, module_insight: 1.3, pattern: 1.2, workflow_recipe: 1.1,
    requirement: 1.0, preference: 1.0, dead_end: 0.9, work_unit_outcome: 1.0,
    gotcha: 0.8, error_pattern: 0.7, e2e_observation: 0.9,
    causal_dependency: 1.1, task_calibration: 0.6, context_cost: 0.5,
  },
  reflect: {
    work_unit_outcome: 1.5, task_calibration: 1.4, dead_end: 1.3,
    error_pattern: 1.2, decision: 1.2, module_insight: 1.1,
    e2e_observation: 1.0, work_state: 0.7, gotcha: 0.8,
    context_cost: 1.3,  // Good time to review cost patterns
    workflow_recipe: 0.6, prefetch_pattern: 0.4,
  },
};
```

### Base Hybrid Score

```
score = 0.6 * cosine_similarity
      + 0.25 * recency_score       // exp(-days_since_accessed / 30)
      + 0.15 * access_frequency    // log(1 + accessCount) / log(1 + maxCount)

final_score = score * PHASE_WEIGHTS[universalPhase][memoryType]
```

### Proactive Gotcha Injection (At Tool-Result Level)

When an agent reads a file, inject relevant memories without the agent asking:

```typescript
async function interceptToolResult(
  toolName: string,
  args: Record<string, unknown>,
  result: string,
  universalPhase: UniversalPhase,
): Promise<string> {
  if (toolName !== 'Read' && toolName !== 'Edit') return result;

  const filePath = args.file_path as string;
  const memories = await memoryService.search({
    types: ['gotcha', 'error_pattern', 'dead_end', 'e2e_observation'],
    relatedFiles: [filePath],
    limit: 4,
    minConfidence: 0.65,
    // Only inject memories that have been seen before or user-verified
    filter: (m) => m.userVerified === true || m.accessCount >= 2,
  });

  if (memories.length === 0) return result;

  const byType = {
    gotcha: memories.filter(m => m.type === 'gotcha'),
    error_pattern: memories.filter(m => m.type === 'error_pattern'),
    dead_end: memories.filter(m => m.type === 'dead_end'),
    e2e_observation: memories.filter(m => m.type === 'e2e_observation'),
  };

  const lines: string[] = [];
  if (byType.gotcha.length) lines.push(...byType.gotcha.map(m => `⚠️  Gotcha [${m.id.slice(0,8)}]: ${m.content}`));
  if (byType.error_pattern.length) lines.push(...byType.error_pattern.map(m => `🔴 Error pattern [${m.id.slice(0,8)}]: ${m.content}`));
  if (byType.dead_end.length) lines.push(...byType.dead_end.map(m => `🚫 Dead end [${m.id.slice(0,8)}]: ${m.content}`));
  if (byType.e2e_observation.length) lines.push(...byType.e2e_observation.map(m => `📱 E2E [${m.id.slice(0,8)}]: ${m.content}`));

  return `${result}\n\n---\n**Memory context for this file:**\n${lines.join('\n')}`;
}
```

### Workflow Recipe Pre-Injection (At Planning Time)

Before the agent starts planning, search for workflow recipes that match the task description. These are pre-injected as concrete procedural guidance, not retrieved reactively:

```typescript
async function preInjectWorkflowRecipes(
  taskDescription: string,
  baseSystemPrompt: string,
): Promise<string> {
  // Semantic search against recipe.taskPattern
  const recipes = await memoryService.searchWorkflowRecipe(taskDescription, { limit: 2 });

  if (recipes.length === 0) return baseSystemPrompt;

  const recipeText = recipes.map(r => {
    const steps = r.steps.map(s =>
      `  ${s.order}. ${s.description}${s.canonicalFile ? ` (see ${s.canonicalFile})` : ''}`
    ).join('\n');
    return `**Recipe: ${r.taskPattern}** (used ${r.successCount}× successfully)\n${steps}`;
  }).join('\n\n');

  return `${baseSystemPrompt}\n\n## KNOWN WORKFLOW PATTERNS\n${recipeText}\n`;
}
```

### Workflow Recipe Creation (Observer → Recipe Synthesis)

Recipes are not manually authored — they emerge from the observer detecting repeated successful sequences. The concrete creation rule:

**Trigger**: The same 4+ step sequence (matching tool calls and file-scope pattern) is observed in 3+ successful sessions within the same module scope within 30 days.

**Process**:
1. Observer's promotion pipeline detects the repeating `SequenceSignal` pattern during `finalize()`
2. If the sequence involves 4+ distinct steps and has appeared in ≥3 validated sessions, flag it as a recipe candidate
3. LLM synthesis converts the raw signal aggregate into a structured `WorkflowRecipe`:

```typescript
async function synthesizeRecipe(
  sequence: SequenceSignal,
  sessionContexts: string[],  // what the agent was doing in each occurrence
): Promise<WorkflowRecipe | null> {
  if (sequence.frequency < 3 || sequence.toolSequence.length < 4) return null;

  const recipe = await generateText({
    model: fastModel,
    prompt: `These ${sequence.frequency} sessions all followed a similar pattern when working in this scope:
${sessionContexts.map((c, i) => `Session ${i + 1}: ${c}`).join('\n')}

Common tool sequence: ${sequence.toolSequence.join(' → ')}

Extract a reusable recipe:
1. What class of task triggers this pattern? (e.g. "adding a new IPC handler")
2. List the steps in order, with the canonical file to edit at each step.

Format as JSON: { "taskPattern": "...", "steps": [{ "order": 1, "description": "...", "canonicalFile": "..." }, ...] }`,
    maxTokens: 300,
  });

  // Parse and store as workflow_recipe with successCount = sequence.frequency
  return parseRecipeFromLLM(recipe.text, sequence.frequency);
}
```

Recipes start with `confidence: 0.7` and `needsReview: true`. Each subsequent successful use bumps `successCount` and confidence. If an agent follows a recipe and the task fails, the observer records `recipe_failed` and marks `lastValidatedAt` as stale.

### Causal Chain Retrieval

```typescript
async function expandWithCausalChain(
  initialResults: Memory[],
  relatedFiles: string[],
): Promise<Memory[]> {
  const causalFiles = await getCausallyLinkedFiles(relatedFiles);
  if (causalFiles.length === 0) return initialResults;

  const causalMemories = await memoryService.search({
    relatedFiles: causalFiles,
    types: ['gotcha', 'pattern', 'error_pattern', 'dead_end'],
    limit: 5,
  });

  return deduplicateAndMerge(initialResults, causalMemories);
}

async function getCausallyLinkedFiles(files: string[]): Promise<string[]> {
  const edges = await db.all(`
    SELECT CASE WHEN file_a = ? THEN file_b ELSE file_a END as linked_file
    FROM observer_co_access_edges
    WHERE (file_a = ? OR file_b = ?) AND weight > 0.6
    ORDER BY weight DESC LIMIT 5
  `, [files[0], files[0], files[0]]);
  return edges.map(e => e.linked_file);
}
```

### HyDE Search

For low-recall queries (< 3 results above 0.5 confidence), generate a hypothetical ideal memory and use ensemble embedding:

```typescript
async function hydeSearch(query: string, phase: UniversalPhase): Promise<Memory[]> {
  const hypothetical = await generateText({
    model: fastModel,
    prompt: `Write a concise, specific developer memory that would perfectly answer: "${query}". Focus on concrete technical details.`,
    maxTokens: 150,
  });

  const [queryEmbedding, hydeEmbedding] = await embedMany({
    model: embeddingModel,  // must produce 1024-dim; enforce dimensions: 1024 for OpenAI fallback
    values: [query, hypothetical.text],
  });

  // Ensemble: 40% query + 60% hypothetical
  const ensemble = queryEmbedding.map((v, i) => 0.4 * v + 0.6 * hydeEmbedding[i]);
  return vectorSearch(ensemble, { phase, limit: 10 });
}
```

### Confidence Propagation

```typescript
async function propagateConfidence(
  memoryId: string,
  newConfidence: number,
  visited: Set<string> = new Set(),
): Promise<void> {
  if (visited.has(memoryId)) return;
  visited.add(memoryId);

  const relations = await getRelations(memoryId);

  for (const rel of relations) {
    // Only propagate to memory-to-memory relations
    if (!rel.targetMemoryId) continue;

    const propagated = computePropagated(newConfidence, rel.relationType, rel.confidence);
    if (Math.abs(propagated - rel.targetCurrentConfidence) > 0.05) {
      await updateConfidence(rel.targetMemoryId, propagated);
      await propagateConfidence(rel.targetMemoryId, propagated, visited);
    }
  }
}

const PROPAGATION_FACTORS: Record<MemoryRelation['relationType'], number> = {
  validates: 0.6,
  required_with: 0.3,
  conflicts_with: -0.4,
  supersedes: 0.8,
  derived_from: 0.5,
};
```

### File Staleness Detection

When files are refactored, moved, or deleted, memories referencing those paths must not inject stale references. Four detection layers, applied in order:

**1. File-existence check at retrieval time** — `stat()` call before injecting any memory with `relatedFiles`. If the file doesn't exist, mark `stale_at = now`. Stale memories are never proactively injected. Cheap, catches ~90% of cases.

**2. Git-diff event hook** — on every git commit or merge, diff changed files against `relatedFiles` in memories. If a file was renamed (`git log --follow --diff-filter=R`), auto-update the path in the memory record. If deleted, mark `stale_at`.

```typescript
async function handleFileRename(oldPath: string, newPath: string): Promise<void> {
  const affected = await db.all(
    `SELECT id, related_files FROM memories WHERE related_files LIKE ?`,
    [`%${oldPath}%`]
  );
  for (const memory of affected) {
    const files = JSON.parse(memory.related_files);
    const updated = files.map((f: string) => f === oldPath ? newPath : f);
    await db.run(
      `UPDATE memories SET related_files = ? WHERE id = ?`,
      [JSON.stringify(updated), memory.id]
    );
  }
}
```

**3. Knowledge Graph invalidation** — structural change detected in the graph → propagate `stale_at` to linked memories via `associatedMemoryIds`. This catches semantic staleness (e.g., a module was restructured so a memory about its "entry point" is now incorrect even if the file still exists).

**4. Periodic sweep** — on project open and every 20 sessions, scan all `relatedFiles` across all memories against the filesystem. Flag mismatches with `stale_at`. Runs as a background job, non-blocking.

**Retrieval rule for stale memories**: A memory with `stale_at` set must never be proactively injected into tool results. It CAN still be found via `memory_search` (agent explicitly asked for it), but is returned with a confidence penalty and a `[STALE — file no longer exists]` warning prepended to `content`.

---

## 8. Active Agent Loop Integration

### Memory as Observer, Not Relay

Memory's role is to **observe** the pipeline and accumulate knowledge — not to relay context between subtasks. Context passing from subtask 1 to subtask 2 is the orchestration/methodology layer's responsibility. Memory watches the pipeline, takes scratchpad notes during execution, and promotes validated knowledge to permanent storage after QA passes.

The distinction matters: if subtask 3 depends on a decision made in subtask 2, the orchestration layer passes that decision forward explicitly (as structured context). Memory records the *pattern* that emerged — the gotcha, the error that recurred, the file that was always read alongside another — so future sessions benefit without relying on in-pipeline relay.

### Full Memory Flow Through a Build Pipeline

This shows where memory observes, reads, and writes throughout a complete agent pipeline execution. The orchestration layer (not memory) controls which stages exist and how context passes between them.

```
PIPELINE ENTRY
│
├─ [READ] preInjectWorkflowRecipes(taskDescription)
│         → workflow_recipe memories pre-loaded into system prompt
│
├─ DEFINE PHASE (planner/analyst/story-creator depending on methodology)
│   ├─ [READ] session start: phase-aware context injection
│   │         requirement, decision, task_calibration, work_state memories
│   ├─ [READ] per file access: proactive gotcha injection
│   ├─ [OBSERVE] SessionMemoryObserver starts scratchpad
│   └─ [SCRATCHPAD] remember_this → scratchpad (not yet permanent)
│
├─ IMPLEMENT PHASE (coder/dev, possibly multiple work units in parallel)
│   │   Orchestration layer passes subtask context forward — not memory's job.
│   │
│   ├─ WORK UNIT N START
│   │   ├─ [READ] work_state from previous session (if resuming)
│   │   ├─ [READ] prefetch_pattern → pre-load always-read files
│   │   └─ [READ] per file access: proactive injection (gotcha, dead_end, error_pattern)
│   │
│   │   MID-EXECUTION
│   │   ├─ [SCRATCHPAD] remember_this → scratchpad only
│   │   ├─ [OBSERVE] SessionMemoryObserver tracks tool calls, file access, errors
│   │   └─ [READ] memory_search tool available to agent on demand
│   │
│   └─ WORK UNIT N END
│       ├─ [OBSERVE] scratchpad grows; nothing promoted yet
│       └─ [OBSERVE] commit_auto tagged if git commit made (SHA linkage)
│
├─ VALIDATE PHASE (QA reviewer/tester)
│   ├─ [READ] session start: error_pattern, requirement, e2e_observation memories
│   ├─ [READ] per file access: proactive injection
│   ├─ [OBSERVE] QA agent MCP tool results → scratchpad as potential e2e_observations
│   └─ [OBSERVE] QA failures logged in scratchpad for potential error_pattern promotion
│
└─ VALIDATION PASSES → PROMOTION (observer.finalize())
    ├─ [WRITE] scratchpad filtered: broken-approach notes discarded
    ├─ [WRITE] 10-20 high-value permanent memories promoted (LLM synthesis)
    ├─ [WRITE] work_unit_outcome for the validated result
    ├─ [WRITE] e2e_observations confirmed by QA promoted
    ├─ [WRITE] context_cost update for modules touched this session
    └─ [WRITE] task_calibration update (actual vs planned steps)

    IF VALIDATION FAILS:
    └─ [DISCARD] scratchpad from failed run not promoted
        Fix cycle produces its own scratchpad.
        Only final passing state promotes to permanent memory.
        Failed approach MAY become dead_end (if genuinely wrong strategy, not a typo).
```

### Partial QA: Incremental Promotion for Large Specs

For specs with >5 subtasks, the all-or-nothing promotion model is too conservative. A 40-subtask spec that fails at subtask 38 should not discard all scratchpad notes from the 37 subtasks that passed.

**Rule**: When QA validates subtasks incrementally (per-subtask QA pass), promote scratchpad notes for validated subtasks immediately. Only hold back notes from subtasks that failed or haven't been validated yet. When the full spec passes final QA, run a final promotion pass for any remaining scratchpad notes.

For small specs (≤5 subtasks), the all-or-nothing model applies: promote everything after final QA, discard on failure.

This means the orchestration layer must signal to the memory observer which subtasks have individually passed validation, not just whether the entire spec passed.

### Post-Large-Task Consolidation

After a complex spec (≥10 subtasks) completes and all subtasks are validated, run a **consolidation pass** — a single LLM call that looks across all `work_unit_outcome` memories from the spec and synthesizes higher-level insights:

```typescript
async function consolidateSpecMemories(
  specRef: WorkUnitRef,
  outcomes: WorkUnitOutcome[],
): Promise<void> {
  const summary = outcomes.map(o =>
    `Subtask ${o.workUnitRef.hierarchy.slice(-1)[0]}: ${o.succeeded ? 'succeeded' : 'failed'}, ` +
    `files: ${o.filesModified.join(', ')}, decisions: ${o.keyDecisions.join('; ')}`
  ).join('\n');

  const consolidated = await generateText({
    model: fastModel,
    prompt: `You are analyzing ${outcomes.length} completed subtasks for a spec.

${summary}

Extract 2-5 durable insights about this project that future sessions should know.
Focus on:
- Module coupling patterns ("auth module is tightly coupled to token-refresh")
- Techniques that worked or didn't ("test ordering matters in this suite")
- Codebase conventions confirmed by this work
- Recurring complexity hotspots

Write each insight as a standalone sentence.`,
    maxTokens: 400,
  });

  const insights = consolidated.text.split('\n').filter(Boolean);
  for (const insight of insights) {
    await memoryService.store({
      type: 'module_insight',
      content: insight,
      confidence: 0.85,
      source: 'observer_inferred',
      scope: 'global',
      workUnitRef: specRef,
      relatedFiles: [...new Set(outcomes.flatMap(o => o.filesModified))],
      needsReview: true,
      tags: ['consolidation', specRef.hierarchy[0]],
    });
  }
}
```

These consolidated memories are `scope: 'global'` and outlive the individual `work_unit_outcome` entries (which are pruned 90 days after merge). They capture what the system *learned about the project* from the work, not just what happened.

### SessionMemoryObserver (Worker Thread)

Lives alongside `executeStream()` in `session/runner.ts`. Tracks the session and emits signals to the main thread:

```typescript
class SessionMemoryObserver {
  private accessedFiles: Map<string, number> = new Map(); // path → first step
  private toolCallSequence: Array<{ tool: string; step: number }> = [];
  private stepLimit = 30;
  private totalTokens = 0;
  private sessionId: string;
  private workUnitRef: WorkUnitRef;

  onToolCall(toolName: string, args: Record<string, unknown>, stepIndex: number): void {
    this.toolCallSequence.push({ tool: toolName, step: stepIndex });

    if (['Read', 'Edit', 'Write'].includes(toolName)) {
      const p = args.file_path as string;
      if (stepIndex <= this.stepLimit && !this.accessedFiles.has(p)) {
        this.accessedFiles.set(p, stepIndex);
      }
    }
  }

  onToolResult(toolName: string, result: string): void {
    if (result.includes('Error') || result.includes('failed')) {
      parentPort?.postMessage({
        type: 'memory-signal',
        signal: { type: 'error_retry', toolName, errorMessage: result.slice(0, 200) },
      });
    }
  }

  onFinish(usage: { totalTokens: number }): void {
    this.totalTokens = usage.totalTokens;
  }

  finalize(): void {
    parentPort?.postMessage({
      type: 'memory-session-end',
      accessedFiles: Array.from(this.accessedFiles.keys()),
      toolSequence: this.toolCallSequence,
      totalTokens: this.totalTokens,
      sessionId: this.sessionId,
      workUnitRef: this.workUnitRef,
    });
  }
}
```

### Mid-Session Scratchpad Availability

When an agent calls `remember_this` mid-session, the note goes into the **session scratchpad** only — not permanent memory. The scratchpad is available immediately for injection at the next step within the same session. Permanent promotion happens only after validation passes.

```typescript
// In session/runner.ts — session scratchpad (temporary, not permanent)
class SessionScratchpad {
  private notes: ScratchpadNote[] = [];

  // Agent calls remember_this → goes to scratchpad only
  addNote(note: ScratchpadNote): void {
    this.notes.push(note);
    // Send to main thread to accumulate in MemoryObserver.scratchpad
    // NOT a permanent write — observer holds it pending validation
    parentPort?.postMessage({ type: 'memory-scratchpad', payload: note });
  }

  // Available immediately for proactive injection within this session
  getNotesForFile(filePath: string): ScratchpadNote[] {
    return this.notes.filter(n => n.relatedFiles?.includes(filePath));
  }

  // Merge scratchpad notes with permanent memories for proactive injection
  augmentResults(permanentMemories: Memory[]): (Memory | ScratchpadNote)[] {
    const ids = new Set(permanentMemories.map(m => m.id));
    const localOnly = this.notes.filter(n => !ids.has(n.id));
    return [...permanentMemories, ...localOnly];
  }
}

interface ScratchpadNote {
  id: string;
  content: string;
  relatedFiles?: string[];
  type: MemoryType;
  addedAtStep: number;
  sessionId: string;
}
```

When `remember_this` is called mid-session, it writes to `SessionScratchpad` for immediate within-session injection. The proactive injection interceptor merges scratchpad notes with permanent memories. After validation passes, the orchestrator calls `observer.finalize()` which promotes qualifying scratchpad notes to permanent memory.

### Work Unit Outcome Recording (Observer Role Only)

When a work unit completes, the observer records an outcome — but does NOT relay context to downstream units. Context between subtasks flows through the orchestration layer. The outcome memory accumulates in the scratchpad and is promoted to permanent storage only after QA validation passes.

```typescript
// orchestration/build-pipeline.ts

// Called by observer.finalize() after validation passes — not at work unit end
async function recordWorkUnitOutcome(
  result: WorkUnitResult,
  plugin: MemoryMethodologyPlugin,
  context: ExecutionContext,
): Promise<void> {
  const workUnitRef = plugin.resolveWorkUnitRef(context);

  // Promoted to permanent memory only after the full pipeline validates
  await memoryService.store({
    type: 'work_unit_outcome',
    workUnitRef,
    succeeded: result.succeeded,
    filesModified: result.filesModified,
    keyDecisions: result.keyDecisions,
    stepsTaken: result.stepsTaken,
    contextTokensUsed: result.contextTokensUsed,
    retryCount: result.retryCount,
    failureReason: result.failureReason,
    source: 'observer_inferred',
    scope: 'work_unit',
  });
}
```

Context relay between stages (planner → coder, coder → qa) is handled entirely by the orchestration/methodology layer via structured context passing — not memory tags.

### Task Complexity Gate

Memory overhead scales proportionally to task complexity. Rather than building a separate complexity classifier, the memory system reads the task classification that already exists in the kanban board. The scratchpad still runs for all tasks (it is lightweight and free), but the promotion step is gated on complexity.

```typescript
// Memory config derived from existing kanban classification
const complexity = task.classification; // 'trivial' | 'standard' | 'complex'

const memoryConfig = {
  trivial:  {
    enableRecipeSearch:   false,  // Skip recipe pre-injection (overhead not worth it)
    enableE2EInjection:   false,  // Skip E2E memory injection
    maxPromotedMemories:  2,      // At most 2 memories per trivial task
  },
  standard: {
    enableRecipeSearch:   true,
    enableE2EInjection:   true,
    maxPromotedMemories:  10,
  },
  complex:  {
    enableRecipeSearch:   true,
    enableE2EInjection:   true,
    maxPromotedMemories:  25,
  },
};
```

For trivial tasks (e.g. "change button color"), the scratchpad accumulates signals but the promotion filter's session cap (`maxPromotedMemories: 2`) means near-zero noise enters permanent memory. This prevents the memory store from filling with low-value observations from routine tasks.

### Predictive Pre-Fetching

```typescript
async function buildInitialMessageWithPrefetch(
  baseMessage: string,
  moduleTrigger: string,
  phase: UniversalPhase,
  projectRoot: string,  // must be passed in; never from global state
): Promise<string> {
  if (phase !== 'implement') return baseMessage;

  const patterns = await memoryService.search({
    types: ['prefetch_pattern'],
    relatedModules: [moduleTrigger],
    minConfidence: 0.7,
    limit: 1,
  }) as PrefetchPattern[];

  if (patterns.length === 0) return baseMessage;

  const preloadedContents: string[] = [];
  for (const filePath of patterns[0].alwaysReadFiles.slice(0, 5)) {
    const resolved = path.resolve(filePath);
    const rootWithSep = projectRoot.endsWith(path.sep) ? projectRoot : projectRoot + path.sep;
    if (!resolved.startsWith(rootWithSep) && resolved !== projectRoot) continue;

    try {
      const content = await fs.readFile(resolved, 'utf-8');
      const truncated = content.length > 3000
        ? content.slice(0, 3000) + '\n... [truncated]'
        : content;
      preloadedContents.push(`### ${filePath}\n\`\`\`\n${truncated}\n\`\`\``);
    } catch { /* file moved/deleted */ }
  }

  if (preloadedContents.length === 0) return baseMessage;
  return `${baseMessage}\n\n## PRE-LOADED FILES\n${preloadedContents.join('\n\n')}`;
}
```

### QA Failure → Reflexion Memory

```typescript
async function extractQaFailureMemories(
  qaReport: QAReport,
  sessionId: string,
  workUnitRef: WorkUnitRef,
): Promise<void> {
  const failures = qaReport.issues.filter(i =>
    i.severity === 'critical' || i.severity === 'high'
  );

  for (const failure of failures) {
    const memory = await generateText({
      model: fastModel,
      prompt: `Extract a structured error pattern memory from this QA failure:
Issue: ${failure.description}
File: ${failure.file}
What was tried: ${failure.whatWasTried ?? 'unknown'}
What should be done: ${failure.recommendation}

Write 2-3 sentences: what went wrong, what the correct approach is, how to avoid it.`,
      maxTokens: 200,
    });

    await memoryService.store({
      type: 'error_pattern',
      content: memory.text,
      confidence: 0.8,
      relatedFiles: failure.file ? [failure.file] : [],
      relatedModules: failure.module ? [failure.module] : [],
      source: 'qa_auto',
      workUnitRef,
      sessionId,
      scope: 'module',
      needsReview: false,
      tags: ['qa_failure'],
    });
  }
}
```

### Commit-Time Memory Tagging

When the agent makes a git commit, the commit SHA is recorded in the scratchpad. Since no permanent memories exist during execution (scratchpad model), the SHA cannot be retroactively tagged onto existing memories. Instead, commit SHAs are passed into `observer.finalize()` so they are attached when memories are promoted:

```typescript
// During execution: record commit SHA in scratchpad
function onCommit(commitSha: string, filesChanged: string[]): void {
  // Store in scratchpad — will be attached to promoted memories during finalize()
  parentPort?.postMessage({
    type: 'memory-scratchpad',
    payload: {
      id: crypto.randomUUID(),
      content: `Commit ${commitSha.slice(0, 8)}: changed ${filesChanged.join(', ')}`,
      type: 'module_insight',
      relatedFiles: filesChanged,
      addedAtStep: currentStep,
      sessionId,
      commitSha, // carried through to promotion
    },
  });
}

// In observer.finalize() — attach commit SHAs to promoted memories
async function finalize(qaResult: QAResult): Promise<Memory[]> {
  const commitShas = this.scratchpad
    .filter(n => n.commitSha)
    .map(n => ({ sha: n.commitSha!, files: n.relatedFiles }));

  const promoted = await this.synthesizeAndPromote();

  // Attach commit SHA to promoted memories whose files overlap with committed files
  for (const memory of promoted) {
    const matchingCommit = commitShas.find(c =>
      c.files?.some(f => memory.relatedFiles.includes(f))
    );
    if (matchingCommit) {
      memory.commitSha = matchingCommit.sha;
    }
  }

  return promoted;
}
```

---

## 9. E2E Validation Memory

This is entirely new in V3. The QA agent uses the Electron MCP server to interact with the running application — clicking elements, filling inputs, taking screenshots, checking page structure. Every observation from this interaction is a potential high-value memory that no code analysis can produce.

### Why This Is Different From Other Memory Sources

Code-level QA tells you "the test failed." MCP-level QA tells you *what the actual UI did*. These are fundamentally different:

- "The button was disabled when the modal was still animating" → not in any test file
- "Navigating to Memory Panel requires Graphiti to be enabled in settings first" → not in any component code
- "The kanban card renders yellow during the paused state — that's correct, not a visual bug" → not documented anywhere

These facts only emerge from running the actual application and watching its behavior. Without memory, every QA agent session re-discovers them.

### MCP Tool Result Post-Processor

After every MCP tool call, a post-processor classifies the observation and stores it:

```typescript
async function processMcpToolResult(
  toolName: string,
  args: Record<string, unknown>,
  result: string,
  sessionId: string,
  workUnitRef: WorkUnitRef,
): Promise<void> {
  // Only process MCP observation tools
  const MCP_OBSERVATION_TOOLS = [
    'take_screenshot', 'click_by_text', 'fill_input',
    'get_page_structure', 'eval', 'send_keyboard_shortcut',
  ];
  if (!MCP_OBSERVATION_TOOLS.includes(toolName)) return;

  // Classify the observation type
  const classification = await generateText({
    model: fastModel,
    prompt: `Classify this Electron MCP tool result as a memory type:
Tool: ${toolName}
Args: ${JSON.stringify(args)}
Result: ${result.slice(0, 500)}

Is this:
A) A PRECONDITION — something that must be true before testing can proceed
B) A TIMING issue — the UI needs time before an action can be taken
C) A UI BEHAVIOR — how a UI element visually or functionally behaves
D) A TEST SEQUENCE — steps required to reach a particular app state
E) AN MCP GOTCHA — the MCP tool itself has a quirk or limitation
F) NOT WORTH REMEMBERING — routine operation with no unusual observations

Reply with just the letter and a one-sentence memory if A-E.`,
    maxTokens: 100,
  });

  const match = classification.text.match(/^([ABCDE])\s*[:\-–]?\s*(.+)/s);
  if (!match) return;

  const [, typeCode, content] = match;
  if (!content?.trim()) return;

  const observationTypes: Record<string, E2EObservation['observationType']> = {
    A: 'precondition', B: 'timing', C: 'ui_behavior', D: 'test_sequence', E: 'mcp_gotcha',
  };

  await memoryService.store({
    type: 'e2e_observation',
    content: content.trim(),
    confidence: 0.75,     // Lower initial confidence — needs a second observation to confirm
    observationType: observationTypes[typeCode],
    mcpToolUsed: toolName,
    source: 'mcp_auto',
    sessionId,
    workUnitRef,
    scope: 'global',      // UI behaviors apply globally, not to one work unit
    needsReview: true,    // Always review E2E observations — automation can misclassify
    tags: ['e2e', toolName, observationTypes[typeCode]],
    relatedFiles: [],     // Filled in later if component file is determinable
  });
}
```

### E2E Memory at Session Start (QA Phase)

When a QA session starts, inject all relevant `e2e_observation` memories before the agent makes its first MCP call:

```typescript
async function buildQaSessionContext(
  featureUnderTest: string,
  basePrompt: string,
): Promise<string> {
  const e2eMemories = await memoryService.search({
    types: ['e2e_observation'],
    query: featureUnderTest,
    limit: 8,
    minConfidence: 0.7,
    phase: 'validate',
  });

  if (e2eMemories.length === 0) return basePrompt;

  const byType = {
    precondition: e2eMemories.filter(m => m.observationType === 'precondition'),
    timing: e2eMemories.filter(m => m.observationType === 'timing'),
    test_sequence: e2eMemories.filter(m => m.observationType === 'test_sequence'),
    mcp_gotcha: e2eMemories.filter(m => m.observationType === 'mcp_gotcha'),
    ui_behavior: e2eMemories.filter(m => m.observationType === 'ui_behavior'),
  };

  const sections: string[] = [];
  if (byType.precondition.length) {
    sections.push(`**Preconditions required before testing:**\n${byType.precondition.map(m => `- ${m.content}`).join('\n')}`);
  }
  if (byType.test_sequence.length) {
    sections.push(`**Known test sequences:**\n${byType.test_sequence.map(m => `- ${m.content}`).join('\n')}`);
  }
  if (byType.timing.length) {
    sections.push(`**Timing constraints:**\n${byType.timing.map(m => `- ${m.content}`).join('\n')}`);
  }
  if (byType.mcp_gotcha.length) {
    sections.push(`**MCP tool gotchas:**\n${byType.mcp_gotcha.map(m => `- ${m.content}`).join('\n')}`);
  }
  if (byType.ui_behavior.length) {
    sections.push(`**Known UI behaviors (not bugs):**\n${byType.ui_behavior.map(m => `- ${m.content}`).join('\n')}`);
  }

  return `${basePrompt}\n\n## E2E VALIDATION MEMORY\n${sections.join('\n\n')}\n`;
}
```

### E2E Memory Feeds Knowledge Graph

When an `e2e_observation` is stored with a determinable component file, it links to the Knowledge Graph node. Impact analysis then includes E2E implications:

```typescript
// When analyzeImpact() runs, it includes E2E memories linked to affected nodes
interface ImpactAnalysis {
  // ...existing fields...
  e2eObservations: E2EObservation[];  // "If you change this file, these E2E behaviors may change"
}
```

This means when a coder agent runs `analyzeImpact('MemoryPanel.tsx')`, it learns not only which other files will break — but also which E2E test behaviors are anchored to this component.

---

## 10. UX & Trust Model

### Design Principle

Memory is only valuable if users trust it. A single wrong memory confidently applied is worse than no memory. Every UX decision prioritizes **trust signals** over feature richness.

### P0 Trust-Critical Requirements

1. **Provenance always visible** — Source, session, phase on every memory card
2. **Inline citation chips** — `[↗ Memory: gotcha in auth.ts]` in agent terminal output
3. **Session-end review** — After every session, user reviews new inferred/auto memories
4. **Flag-wrong at point of damage** — Flag incorrect memory immediately in terminal
5. **Health Dashboard as default** — Users see health/status, not a raw list
6. **E2E observations clearly labeled** — `[mcp_auto]` badge distinguishes UI observations from code observations

### Navigation Structure

```
Memory Panel (Cmd+Shift+M)
├── Health Dashboard (default)
│   ├── Stats: total | active | needs-review | tokens-saved
│   ├── Health score 0-100
│   ├── Module coverage bars
│   ├── Methodology badge (shows active plugin)
│   └── Session metrics
├── Module Map
│   ├── Graph of modules with memory coverage + E2E observation count
│   └── Click module → filtered Memory Browser
├── Memory Browser
│   ├── Filter: type | source | confidence | module | methodology | date
│   └── Memory cards
├── Workflow Recipes
│   └── List of workflow_recipe memories; can add/edit manually
└── Memory Chat
    └── "What do you know about the settings flow?"
```

### Memory Card

```
┌──────────────────────────────────────────────────────────┐
│ [e2e_observation] [mcp_auto] ●●●○○        Used 2× ago   │
│ session: qa-018 · phase: validate · precondition         │ ← always visible
├──────────────────────────────────────────────────────────┤
│ Graphiti must be enabled in Settings > Integrations      │
│ before the Memory Panel renders content. Without it,     │
│ the panel shows an empty state with no error message.    │
├──────────────────────────────────────────────────────────┤
│ 📱 precondition · e2e · take_screenshot                  │
├──────────────────────────────────────────────────────────┤
│ [✓ Confirm] [✏ Correct] [⚑ Flag wrong] [🗑 Delete]     │
└──────────────────────────────────────────────────────────┘
```

### Session-End Review

```
╔══════════════════════════════════════════════════════════╗
║  Session Memory Summary — qa-018                         ║
╠══════════════════════════════════════════════════════════╣
║  APPLIED (memories that informed this session)           ║
║  ✓ [e2e] Memory Panel requires Graphiti enabled first    ║
║  ✓ [gotcha] WAL mode needed for concurrent writes        ║
╠══════════════════════════════════════════════════════════╣
║  NEW — REVIEW REQUIRED                                   ║
║  [✓][✏][✗] [mcp_auto] click_by_text fails on animating  ║
║             modals — add 300ms delay                     ║
║                                                          ║
║  [✓][✏][✗] [observer] auth.ts + token-refresh.ts always ║
║             accessed together                            ║
║                                                          ║
║  [✓][✏][✗] [qa_auto] Closure table must rebuild after   ║
║             schema migration                             ║
╠══════════════════════════════════════════════════════════╣
║  AUTO-CONFIRMED (high confidence, skipping review)       ║
║  ✓ [commit_auto] Commit a3f9: changed auth.ts, ...       ║
╚══════════════════════════════════════════════════════╤═══╝
                               [Review Later]  [Done ✓]
```

**Auto-confirmation rule**: `userVerified` memories, `commit_auto` memories, and any memory with `confidence > 0.9 && accessCount >= 3` are auto-confirmed and shown collapsed. Only new inferred memories with `needsReview: true` require explicit action.

### Correction Modal

```
┌─ Correct this memory ────────────────────────────────────┐
│ Original: "Graphiti must be enabled before Memory Panel" │
│                                                          │
│ What's wrong?                                            │
│ ○ Content is inaccurate — I'll correct it                │
│ ○ No longer applies — mark as outdated                   │
│ ○ Too specific — I'll generalize it                      │
│ ○ It's a duplicate — I'll find the original              │
│                                                          │
│ [Correction text editor]                                 │
│                              [Cancel] [Save Correction]  │
└──────────────────────────────────────────────────────────┘
```

### "Teach the AI" Entry Points

| Method | Location | Action |
|--------|----------|--------|
| `/remember <text>` | Terminal | `user_taught` memory, immediately available |
| `Cmd+Shift+M` | Global | Opens Memory Panel |
| Right-click file | File tree | "Add memory about this file" |
| Session-end `[✏]` | Summary modal | Edit before confirming |
| Memory Browser `[+ Add]` | Panel | Manual entry with type picker |
| Workflow Recipes `[+ Recipe]` | Panel | Add procedural task recipe |

---

## 11. SQLite Schema

```sql
-- ==========================================
-- CORE MEMORY TABLES
-- ==========================================

CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.8,
  tags TEXT NOT NULL DEFAULT '[]',            -- JSON array
  related_files TEXT NOT NULL DEFAULT '[]',   -- JSON array
  related_modules TEXT NOT NULL DEFAULT '[]', -- JSON array
  created_at TEXT NOT NULL,
  last_accessed_at TEXT NOT NULL,
  access_count INTEGER NOT NULL DEFAULT 0,
  session_id TEXT,
  commit_sha TEXT,                            -- V3: git commit link
  scope TEXT NOT NULL DEFAULT 'global',       -- 'global'|'module'|'work_unit'|'session'

  -- Work unit reference (replaces spec_number)
  work_unit_ref TEXT,                         -- JSON: WorkUnitRef
  methodology TEXT,                           -- denormalized from work_unit_ref for indexing

  -- Provenance
  source TEXT NOT NULL DEFAULT 'agent_explicit',
  target_node_id TEXT,
  relations TEXT NOT NULL DEFAULT '[]',       -- JSON array of MemoryRelation
  decay_half_life_days REAL,
  provenance_session_ids TEXT DEFAULT '[]',

  -- Trust
  needs_review INTEGER NOT NULL DEFAULT 0,
  user_verified INTEGER NOT NULL DEFAULT 0,
  citation_text TEXT,
  stale_at TEXT
);

CREATE TABLE memory_embeddings (
  memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
  embedding BLOB NOT NULL,    -- sqlite-vec float32, 1024-dim (default Matryoshka dimension for qwen3-embedding:4b)
  model_id TEXT NOT NULL,     -- enforce same model_id per search
  created_at TEXT NOT NULL
);

-- ==========================================
-- OBSERVER TABLES
-- ==========================================

CREATE TABLE observer_file_nodes (
  file_path TEXT PRIMARY KEY,
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at TEXT NOT NULL,
  session_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE observer_co_access_edges (
  file_a TEXT NOT NULL,
  file_b TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 0.0,
  raw_count INTEGER NOT NULL DEFAULT 0,
  avg_time_delta_ms REAL,
  directional INTEGER NOT NULL DEFAULT 0,
  last_observed_at TEXT NOT NULL,
  PRIMARY KEY (file_a, file_b)
);

CREATE TABLE observer_error_patterns (
  id TEXT PRIMARY KEY,
  tool_name TEXT NOT NULL,
  error_hash TEXT NOT NULL,
  error_message TEXT NOT NULL,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  last_seen_at TEXT NOT NULL,
  resolved_how TEXT
);

CREATE TABLE observer_signal_log (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  signal_data TEXT NOT NULL,  -- JSON
  score REAL,
  processed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- ==========================================
-- KNOWLEDGE GRAPH TABLES
-- ==========================================

CREATE TABLE graph_nodes (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  type TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  associated_memory_ids TEXT DEFAULT '[]',
  stale_at TEXT,
  last_analyzed_at TEXT NOT NULL
);

CREATE TABLE graph_edges (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  to_id TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 0.5,
  confidence REAL NOT NULL DEFAULT 0.8,
  auto_extracted INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE graph_closure (
  ancestor_id TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  descendant_id TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  depth INTEGER NOT NULL,
  path TEXT,
  PRIMARY KEY (ancestor_id, descendant_id)
);

-- ==========================================
-- INDEXES
-- ==========================================

CREATE INDEX idx_memories_type ON memories(type);
CREATE INDEX idx_memories_methodology ON memories(methodology);
CREATE INDEX idx_memories_scope ON memories(scope);
CREATE INDEX idx_memories_session ON memories(session_id);
CREATE INDEX idx_memories_commit ON memories(commit_sha) WHERE commit_sha IS NOT NULL;
CREATE INDEX idx_memories_source ON memories(source);
CREATE INDEX idx_memories_needs_review ON memories(needs_review) WHERE needs_review = 1;
CREATE INDEX idx_memories_confidence ON memories(confidence DESC);
CREATE INDEX idx_memories_last_accessed ON memories(last_accessed_at DESC);
CREATE INDEX idx_memories_type_confidence ON memories(type, confidence DESC);

CREATE INDEX idx_co_access_file_a ON observer_co_access_edges(file_a);
CREATE INDEX idx_co_access_file_b ON observer_co_access_edges(file_b);
CREATE INDEX idx_co_access_weight ON observer_co_access_edges(weight DESC);

CREATE INDEX idx_graph_nodes_label ON graph_nodes(label);
CREATE INDEX idx_graph_nodes_type ON graph_nodes(type);
CREATE INDEX idx_graph_edges_from ON graph_edges(from_id);
CREATE INDEX idx_graph_edges_to ON graph_edges(to_id);
CREATE INDEX idx_closure_ancestor ON graph_closure(ancestor_id, depth);
CREATE INDEX idx_closure_descendant ON graph_closure(descendant_id);

CREATE INDEX idx_signal_log_session ON observer_signal_log(session_id);
CREATE INDEX idx_signal_log_unprocessed ON observer_signal_log(processed) WHERE processed = 0;
```

---

## 12. Concurrency Architecture

### WAL Mode + Main-Thread Write Proxy

- `PRAGMA journal_mode=WAL` enables concurrent readers with a single writer
- All writes via `MemoryService` on main thread — no worker writes directly
- Workers open SQLite with `readonly: true`
- Workers communicate writes via `postMessage`

### Worker → Main Message Types

```typescript
type WorkerToMainMessage =
  | { type: 'memory-scratchpad'; payload: ScratchpadNote }
  | { type: 'memory-signal'; signal: ObserverSignal }
  | { type: 'memory-session-end';
      accessedFiles: string[];
      toolSequence: Array<{ tool: string; step: number }>;
      totalTokens: number;
      sessionId: string;
      workUnitRef: WorkUnitRef; }
  | { type: 'memory-qa-failure'; qaReport: QAReport; workUnitRef: WorkUnitRef }
  | { type: 'memory-mcp-observation';
      toolName: string;
      args: Record<string, unknown>;
      result: string;
      sessionId: string;
      workUnitRef: WorkUnitRef; }
  | { type: 'memory-subtask-validated';
      workUnitRef: WorkUnitRef;
      sessionId: string;
      succeeded: boolean; };  // triggers incremental promotion for large specs (>5 subtasks)
```

### Write Serialization

```typescript
async handleWorkerMessage(msg: WorkerToMainMessage): Promise<void> {
  switch (msg.type) {
    case 'memory-scratchpad':
      this.observer.addToScratchpad(msg.payload); // no permanent write — held pending validation
      break;
    case 'memory-signal':
      this.observer.observe(msg.signal);
      break;
    case 'memory-session-end':
      await this.observer.finalizeSession(msg);
      await this.updateContextCost(msg.accessedFiles, msg.totalTokens, msg.workUnitRef);
      break;
    case 'memory-qa-failure':
      await extractQaFailureMemories(msg.qaReport, msg.workUnitRef);
      break;
    case 'memory-mcp-observation':
      await processMcpToolResult(msg.toolName, msg.args, msg.result, msg.sessionId, msg.workUnitRef);
      break;
    case 'memory-subtask-validated':
      // Incremental promotion for large specs (>5 subtasks)
      // Promotes scratchpad notes scoped to this subtask's work unit
      if (msg.succeeded) {
        await this.observer.promoteSubtaskScratchpad(msg.workUnitRef, msg.sessionId);
      }
      break;
  }
}
```

### Embedding Strategy

Tiered by user environment — no manual configuration required. The system detects the best available option at startup.

| Priority | Model | When |
|----------|-------|------|
| Primary | `qwen3-embedding:4b` via Ollama | User has Ollama installed (recommended) |
| Fallback 1 | `text-embedding-3-small` via OpenAI | User has OpenAI API key in provider settings |
| Fallback 2 | Bundled ONNX model (`bge-small-en-v1.5` via `fastembed-js`) | Zero-config fallback — no Ollama, no OpenAI |

**qwen3-embedding:4b specs:**
- Supports Matryoshka dimensions up to 2560 — use **1024-dim** as default for balance of quality vs storage
- 32K token context window (handles large file excerpts without truncation)
- State-of-the-art quality for its size class; 100+ language support
- Privacy advantage: code never leaves the machine for indexing (vs cloud-only alternatives)

**ONNX fallback:**
- `fastembed-js` from Qdrant runs in Electron's Node process via `onnxruntime-node`
- ~100MB binary shipped with the app — zero external dependencies for users with neither Ollama nor OpenAI
- Lower quality than qwen3-embedding:4b but sufficient for basic retrieval

**Dimension enforcement:**
- All embeddings stored with their `model_id` and `dimensions` in `memory_embeddings.model_id`
- Before any similarity query: verify `model_id` matches and `dimensions` match — reject cross-model comparisons
- For OpenAI fallback: **always** pass `dimensions: 1024` explicitly — default 1536-dim will silently corrupt search against 1024-dim embeddings
- When user switches embedding model (e.g. installs Ollama later), existing embeddings must be re-indexed — prompt user to trigger re-index from Memory Panel settings

**Storage:**
- `sqlite-vec` BLOB column, brute-force scan (sufficient for ≤10K memories at 5-50ms)
- Migrate to Qdrant local at 50K+ memories

---

## 13. Memory Pruning & Lifecycle Management

Memory quality degrades over time without active curation. Stale memories about renamed files, completed specs, or deprecated patterns reduce retrieval precision and consume storage. This section defines how memories age, when they are archived, and when they are permanently removed.

### Scope-Based Pruning Rules

| Scope | Pruning Rule |
|-------|-------------|
| `session` | Expire after 7 days. Session-scoped memories are transient by design. |
| `work_unit` | Archive when the associated work unit (spec/story) is merged and closed. Retain in archive for 90 days post-merge, then prune permanently. |
| `module` | Persist indefinitely, subject to confidence decay and file staleness checks. |
| `global` | Persist indefinitely. Only removed on explicit user action or if confidence decays below 0.2 and the memory hasn't been accessed in 60+ days. |

### Type-Based Pruning Rules

| Memory Type | Pruning Rule |
|-------------|-------------|
| `work_unit_outcome` | Archive with the work unit at merge. Prune 90 days post-merge. |
| `work_state` | 7-day half-life (already defined in `decayHalfLifeDays`). Stale work state is actively harmful. |
| `commit_auto` (`module_insight`) | Prune when all `relatedFiles` no longer exist in the repository. |
| `dead_end` | 90-day half-life (already defined). Long-lived — dead ends stay relevant for a long time. |
| `context_cost` | Rolling window: retain the last 30 sessions of data per module. Prune older samples. |
| `e2e_observation` | Retain while referenced components exist. Mark stale if component file removed. |
| `workflow_recipe` | Mark stale when any `canonicalFile` step is modified (trigger re-validation). Time-based expiry at 60 days without successful use. |

### Background Pruning Job

Runs on project open and every 20 sessions. Non-blocking — runs in main thread idle time.

```typescript
async function runPruningJob(projectRoot: string): Promise<PruningReport> {
  const report: PruningReport = { archived: 0, pruned: 0, staleMarked: 0 };

  // 1. Check file existence for all memories with relatedFiles
  const memoriesWithFiles = await db.all(
    `SELECT id, related_files, stale_at FROM memories WHERE related_files != '[]'`
  );
  for (const memory of memoriesWithFiles) {
    if (memory.stale_at) continue; // already stale
    const files: string[] = JSON.parse(memory.related_files);
    const results = await Promise.all(
      files.map(f => fs.access(path.resolve(projectRoot, f)).then(() => false).catch(() => true))
    );
    const anyMissing = results.some(Boolean);
    if (anyMissing) {
      await db.run(`UPDATE memories SET stale_at = ? WHERE id = ?`, [new Date().toISOString(), memory.id]);
      report.staleMarked++;
    }
  }

  // 2. Prune low-confidence, long-unaccessed memories
  const cutoffDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const pruned = await db.run(`
    DELETE FROM memories
    WHERE confidence < 0.2
      AND last_accessed_at < ?
      AND scope IN ('global', 'module')
      AND user_verified = 0
  `, [cutoffDate]);
  report.pruned += pruned.changes ?? 0;

  // 3. Archive work_unit memories for merged specs
  // (Requires integration with task store to get merged spec numbers)
  const mergedWorkUnits = await getMergedWorkUnitRefs();
  for (const ref of mergedWorkUnits) {
    const archiveCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const archived = await db.run(`
      DELETE FROM memories
      WHERE scope = 'work_unit'
        AND methodology = ?
        AND json_extract(work_unit_ref, '$.hierarchy[0]') = ?
        AND created_at < ?
    `, [ref.methodology, ref.hierarchy[0], archiveCutoff]);
    report.archived += archived.changes ?? 0;
  }

  // 4. Compact observer_signal_log — aggregate processed signals, delete source rows
  await db.run(`
    DELETE FROM observer_signal_log
    WHERE processed = 1
      AND created_at < ?
  `, [new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()]);

  return report;
}
```

### User Controls in Memory Panel

Users have manual control over pruning in addition to the automated job. The Memory Panel settings view exposes:

- **Storage stats**: total memories, by scope, by type; DB file size; estimated savings from pruning
- **"Remove memories for deleted files"**: runs the file-existence sweep immediately and removes all stale memories
- **"Archive memories for merged specs"**: triggers work_unit archive sweep for user-selected specs
- **"Prune low-confidence memories"**: removes all memories below a user-set confidence threshold (default 0.2) not accessed in 30+ days
- **"Re-index embeddings"**: triggered when user switches embedding model; regenerates all embeddings under the new model

---

## 14. Implementation Plan

### Phase 0: Clean Cutover
*Drop all Python/legacy memory paths. No backwards compatibility.*

- [ ] Remove Python memory subprocess calls from all IPC handlers
- [ ] Create fresh SQLite DB at `{projectRoot}/.auto-claude/memory.db` with V3 schema
- [ ] Implement `MemoryService` class at `apps/frontend/src/main/ai/memory/service.ts`
- [ ] Implement native `MemoryMethodologyPlugin` (maps native pipeline stages to UniversalPhase)
- [ ] Wire `MemoryService` to `WorkerBridge` message handling

**Cutover is a hard switch. Old memory data is discarded.**

---

### Phase 1: Core Memory + Phase-Aware Retrieval
*Prerequisite: Phase 0*

- [ ] Full Memory schema with `WorkUnitRef`, `MemoryScope`, `source`, `needsReview`, etc.
- [ ] `PHASE_WEIGHTS` on `UniversalPhase` — phase-aware scoring in `search()`
- [ ] `remember_this` and `memory_search` agent tools wired to `MemoryService`
- [ ] `work_state` auto-capture at session end (lightweight LLM extract via plugin)
- [ ] QA failure → `error_pattern` auto-extraction
- [ ] Session-end summary modal (P0 UX for trust)

**Shippable milestone**: memory works, phase-aware retrieval works, QA failures auto-captured.

---

### Phase 2: Knowledge Graph
*Prerequisite: Phase 1*

The Knowledge Graph provides structural completeness — knowing *which* files exist and how they relate. Without it, memory knows *how* to work with files but can't comprehensively tell you *which* files matter. Agents have structural awareness from day 1 of this phase.

- [ ] `graph_nodes`, `graph_edges`, `graph_closure` tables
- [ ] tree-sitter cold-start structural analysis
- [ ] Closure table pre-computation
- [ ] Semantic module scan on first project open (LLM reads key files per module → `module_insight` + convention memories)
- [ ] User-visible scan progress ("Auto Claude is analyzing your codebase...")
- [ ] `analyzeImpactTool`, `getDependenciesTool`, `traceDataFlowTool`
- [ ] Memory ↔ Graph linking
- [ ] Diff-based incremental invalidation
- [ ] ModuleMap auto-derived from graph (no agent population needed)

**Shippable milestone**: agent can query impact radius before touching files; structural AND semantic completeness from the first session.

---

### Phase 3: Memory Observer + Co-Access Graph
*Prerequisite: Phase 2*

- [ ] `MemoryObserver` class on main thread
- [ ] `SessionScratchpad` in worker — accumulates notes pending validation
- [ ] Tap `WorkerBridge` events, all 6 signal types
- [ ] Observer tables: `observer_file_nodes`, `observer_co_access_edges`, `observer_error_patterns`, `observer_signal_log`
- [ ] Promotion filter pipeline (validation filter → frequency → novelty → scoring → LLM synthesis → embedding)
- [ ] `observer.finalize()` called on validation pass; `observer.discardScratchpad()` on validation fail
- [ ] Cold-start bootstrap from `git log` co-commit history
- [ ] `prefetch_pattern` generation (>80% / >50% thresholds)
- [ ] Pre-fetch injection into session start context

**Shippable milestone**: system infers memories from behavior after validation; prefetch reduces discovery tool calls; broken approaches never promoted.

---

### Phase 4: Active Agent Loop + Scratchpad Integration
*Prerequisite: Phase 3*

- [ ] `SessionMemoryObserver` in `session/runner.ts`
- [ ] `SessionScratchpad` — `remember_this` goes to scratchpad; injected immediately at next step
- [ ] Proactive gotcha injection at tool-result level for Read/Edit
- [ ] `workflow_recipe` memory type + `getWorkflowRecipeTool`
- [ ] `preInjectWorkflowRecipes()` at planning phase start
- [ ] Recipe creation rule: 3+ successful uses of same 4+ step sequence → LLM synthesizes `workflow_recipe`
- [ ] Commit-time memory tagging via `onCommit()` hook
- [ ] `task_calibration` update after each work unit completes
- [ ] `context_cost` profiling from session token counts
- [ ] Partial QA promotion: for specs >5 subtasks, promote per-subtask as QA validates each
- [ ] Post-large-task consolidation: LLM synthesis across `work_unit_outcome` entries after complex specs (≥10 subtasks)

**Shippable milestone**: agent loop is memory-augmented end-to-end; recipes fire at planning time; scratchpad → promotion model in place; large specs produce durable consolidated insights.

---

### Phase 5: E2E Validation Memory
*Prerequisite: Phase 1*

- [ ] `e2e_observation` memory type
- [ ] `processMcpToolResult()` post-processor wired to QA agent MCP calls
- [ ] `buildQaSessionContext()` pre-injects E2E memories at QA session start
- [ ] Knowledge Graph `ImpactAnalysis` includes `e2eObservations`
- [ ] E2E memories shown in session-end review with `[mcp_auto]` badge

**Shippable milestone**: QA agent accumulates UI knowledge over time; preconditions/timings never re-discovered.

---

### Phase 6: Retrieval Innovations
*Prerequisite: Phase 1 + Phase 2*

- [ ] Causal chain retrieval (expand via co-access edges weight > 0.6)
- [ ] HyDE search (activate when <3 results above 0.5 confidence)
- [ ] Temporal search modes (`recent_sessions`, `time_window`, `around_event`)
- [ ] Confidence propagation through typed relation edges
- [ ] `dead_end` memory type + observer detection (20+ steps abandoned)
- [ ] `work_unit_outcome` storage and retrieval in plan context

**Shippable milestone**: retrieval quality measurably better than baseline across all memory types.

---

### Phase 7: Methodology Plugin System
*Prerequisite: Phase 1 + Phase 4*

- [ ] `MemoryMethodologyPlugin` interface in `apps/frontend/src/main/ai/memory/plugins/`
- [ ] Native plugin extracted from hardcoded logic
- [ ] Plugin registry — `MemoryService.setMethodology(plugin)`
- [ ] Methodology picker in Settings UI
- [ ] BMAD plugin (`epic`, `story`, `task` hierarchy; analyst→architect→dev relay)
- [ ] i18n: all new keys to `en/*.json` and `fr/*.json`

**Shippable milestone**: users can switch methodology; memory persists across switches.

---

### Phase 8: UX Trust Layer (full)
*Prerequisite: Phase 1 + Phase 3 + Phase 5*

- [ ] Health Dashboard as default Memory Panel view
- [ ] Memory card with provenance always visible
- [ ] Inline citation chips in agent terminal output
- [ ] Correction modal (4 radio options)
- [ ] `Cmd+Shift+M` global shortcut
- [ ] `/remember` terminal command
- [ ] Workflow Recipes view in Memory Panel
- [ ] Flag-wrong affordance with immediate delete
- [ ] Auto-confirm rules (high-confidence + high-accessCount skip review)

---

## 15. Open Questions

### Architecture

1. **Scratchpad crash safety**: The `SessionScratchpad` in the worker holds notes pending validation. If the worker crashes, these are lost. Should we write scratchpad notes to a temp table immediately (synchronous) or accept the loss risk? WAL makes the temp-table approach safe but adds write latency per step. Since scratchpad notes are only promoted after QA passes, losing them on crash means the session produces no permanent memories — acceptable trade-off in most cases.

2. **Plugin hot-swap**: When a user switches methodology mid-project, existing `work_unit_ref` hierarchy entries are foreign to the new plugin. The new plugin can still retrieve them (raw hierarchy is stored), but `resolveWorkUnitRef()` and `formatWorkStateContext()` won't understand them. Should we translate old refs on switch, or leave them as opaque cross-methodology memories?

3. **Observer dead-end detection accuracy**: Detecting "20+ steps then abandoned" requires the observer to track intent across steps — hard from tool calls alone. A simpler proxy: Edit to file A followed by full-revert of file A within the same session (Bash `git checkout` or re-write to original content). This is detectable. Should we use this proxy, or require explicit agent signal?

4. **Workflow recipe staleness**: Recipes have `lastValidatedAt`. How do we detect staleness? Option A: mark stale when any `canonicalFile` in the recipe is modified. Option B: time-based expiry (60 days). Option C: agent reports `recipe_failed` when following a recipe doesn't produce the expected result. Combination of A + C is most accurate.

### Data

5. **Cross-methodology memory retrieval**: When a user runs BMAD sessions, those memories have `methodology: 'bmad'` in their `workUnitRef`. If they later switch to native mode, should those memories rank lower in retrieval (they came from a different workflow context) or equally (the content is still valid)?

6. **E2E observation confidence bootstrap**: First observation gets `confidence: 0.75`. How does confidence update? Options: bump to 0.9 on second independent observation of same behavior; decay if behavior changes in a later session. Needs explicit rule.

7. **Context cost across methodologies**: A BMAD story session may touch the same module as a native subtask session. Token counts are comparable. Should `context_cost` memories be pooled across methodologies (they are — scope is `module`), or kept separate?

### Performance

8. **Embedding cost at scale**: Storing embeddings for `work_unit_outcome`, `commit_auto`, and `context_cost` memories may add significant embedding overhead — these are high-volume, low-retrieval-value types. Should these memory types skip embedding entirely and rely on structured search only?

9. **Observer signal log growth**: Every session writes N signals to `observer_signal_log`. With 1000 sessions, this table could have millions of rows. Strategy: compact processed signals weekly (aggregate into co-access edges, then delete source rows). Need explicit cleanup job.

10. **Closure table and methodology-aware graphs**: If the user's codebase is also the target for methodology-aware analysis (BMAD epics correspond to feature modules), should the Knowledge Graph nodes have methodology metadata? Or is the graph always purely structural?

---

*V3 is a complete, methodology-agnostic memory system. It learns from observation, flows with the agent through every phase, captures E2E behavioral knowledge, and works identically whether the agent is running native subtasks, BMAD epics/stories, TDD cycles, or any future methodology plugin.*

*Next action: Phase 0 implementation. Select methodology plugin target for Phase 7 (BMAD recommended as first non-native plugin given its imminent integration).*
