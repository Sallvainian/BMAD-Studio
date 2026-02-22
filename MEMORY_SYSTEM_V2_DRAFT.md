# Memory System V2 — Design Draft

> Synthesized from: V1 Foundation + 5 Hackathon Team Reports + 4 Investigation Reports
> Status: Pre-implementation design document
> Date: 2026-02-21

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Competitive Landscape](#2-competitive-landscape)
3. [V1 → V2 Delta](#3-v1--v2-delta)
4. [Architecture Overview](#4-architecture-overview)
5. [Memory Schema (Extended)](#5-memory-schema-extended)
6. [Memory Observer (Passive Behavioral Layer)](#6-memory-observer-passive-behavioral-layer)
7. [Knowledge Graph Layer](#7-knowledge-graph-layer)
8. [Retrieval Engine (V2)](#8-retrieval-engine-v2)
9. [Active Agent Loop Integration](#9-active-agent-loop-integration)
10. [UX & Trust Model](#10-ux--trust-model)
11. [SQLite Schema](#11-sqlite-schema)
12. [Concurrency Architecture](#12-concurrency-architecture)
13. [Implementation Plan](#13-implementation-plan)
14. [Open Questions](#14-open-questions)

---

## 1. Executive Summary

V2 elevates memory from a passive lookup store to an **active cognitive layer** that observes agent behavior, models codebase structure, and continuously improves agent performance without requiring explicit user or agent intervention.

### Core V2 Thesis

V1 answered: *"Can agents remember things?"*
V2 answers: *"Can the system learn from agent behavior itself?"*

Three new systems compose V2:

1. **Memory Observer** — Passive event-stream watcher that infers memories from agent behavioral patterns (file co-access, error-retry sequences, backtracking). No explicit `remember_this` calls needed.

2. **Knowledge Graph** — Structural + semantic codebase model. Impact radius analysis (O(1) via closure tables). Linked-but-separate from the memory store, enriching retrieval context.

3. **Active Agent Loop** — Pre-fetching, stage-to-stage relay, Reflexion-style QA failure learning, work-state continuity across sessions. Memory flows with the agent, not just at session start.

### V2 Performance Targets (based on Team 5 projections)

| Metric | Sessions 1-5 | Sessions 10-20 | Sessions 30+ |
|--------|-------------|----------------|--------------|
| Discovery tool calls | 15-25 | 8-12 | 3-6 |
| Re-reading known files | 40-60% | 20-30% | 8-15% |
| QA failure recurrence | baseline | -40% | -70% |
| Context tokens saved/session | 0 | ~8K | ~25K |

---

## 2. Competitive Landscape

Analysis of 13 tools (Team 2 research) to understand Auto Claude's unique position:

| Tool | Vector Search | Typed Schema | Navigational Map | Confidence Score | OSS/Local | User-Editable |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| Cursor | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Windsurf | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| GitHub Copilot | Partial | ✗ | ✗ | ✗ | ✗ | ✗ |
| Sourcegraph Cody | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ |
| Augment Code | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ |
| Cline | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
| Aider | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
| Continue | Partial | ✗ | ✗ | ✗ | ✓ | Partial |
| Devin | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ |
| Amazon Q | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Tabnine | Partial | ✗ | ✗ | ✗ | ✗ | ✗ |
| Bolt/Lovable | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Claude Code | ✗ | ✗ | ✗ | ✗ | ✓ | Partial |
| **Auto Claude V1** | **✓** | **✓** | **✓** | **✓** | **✓** | **✓** |
| **Auto Claude V2** | **✓+** | **✓+** | **✓+** | **✓+** | **✓** | **✓+** |

**V2 adds** (no competitor has all):
- Passive behavioral observation (co-access graph, error pattern extraction)
- Causal chain retrieval (`required_with` / `conflicts_with` edges)
- Phase-aware re-ranking (memories scored differently during planning vs coding vs QA)
- Proactive gotcha injection at tool-result level (not just at session start)
- Reflexion-style QA failure → structured error memory (auto, no agent prompt needed)
- UX trust model with session-end memory review, inline citation chips, correction modal

---

## 3. V1 → V2 Delta

### What V1 Got Right (keep)
- Core Memory schema: `type`, `content`, `confidence`, `tags`, `relatedFiles`, `relatedModules`
- Hybrid retrieval scoring: `0.6*cosine + 0.25*recency + 0.15*access_frequency`
- 3-tier context injection (global / spec-scoped / task-scoped)
- 8 memory types: `gotcha`, `decision`, `preference`, `pattern`, `requirement`, `error_pattern`, `module_insight`, `workflow`
- WAL-mode SQLite with main-thread write proxy
- `memory_search` and `remember_this` agent tools
- `ModuleMap` navigational structure
- Confidence decay with `lastAccessedAt` / `accessCount` freshness tracking

### What V1 Got Wrong (fix in V2)

| V1 Assumption | V2 Correction |
|---------------|---------------|
| Agents explicitly call `remember_this` for everything important | Observer infers memories from behavioral signals; explicit tool is fallback only |
| ModuleMap is populated manually by agents | ModuleMap is derived automatically from Knowledge Graph structural layer |
| All memory types retrieved with same relevance formula | Phase-aware retrieval weights memories differently per agent phase |
| Memories injected only at session start | Proactive injection at tool-result level when agent accesses a tagged file |
| QA failure learnings require agent to call `remember_this` | Auto-extract `error_pattern` memories from QA failures immediately |
| Single-session context; fresh start every build | Work-state memory + stage-to-stage relay enables multi-session continuity |
| Knowledge graph is part of memory store | Graph is a separate linked layer (linked by `targetNodeId` on Memory) |

### New Memory Types in V2

| Type | Source | Description |
|------|--------|-------------|
| `prefetch_pattern` | Observer auto | Files always/frequently read together → pre-load next session |
| `work_state` | Agent auto | Partial work snapshot: completed subtasks, current step, key decisions |
| `causal_dependency` | Observer + LLM | File A must be read before file B (extracted from co-access timing) |
| `task_calibration` | QA auto | Actual vs planned step ratio per module for better planning estimates |

---

## 4. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          ELECTRON MAIN THREAD                           │
│                                                                         │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐  │
│  │  MemoryObserver  │◄───│  WorkerBridge    │◄───│  Worker Thread   │  │
│  │  (event tap)     │    │  (event relay)   │    │  (streamText)    │  │
│  └────────┬─────────┘    └──────────────────┘    └──────────────────┘  │
│           │                                                              │
│           ▼                                                              │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                      SQLite (WAL mode)                           │   │
│  │  memories  │  memory_embeddings  │  observer_*  │  graph_*       │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│           │                                                              │
│           ▼                                                              │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    MemoryService (main thread)                   │   │
│  │  search() │ store() │ injectContext() │ proactiveInject()        │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│           │                                                              │
│  ┌────────┴─────────┐    ┌──────────────────┐                          │
│  │  KnowledgeGraph  │    │  RetrievalEngine  │                          │
│  │  (impact radius) │    │  (phase-aware)    │                          │
│  └──────────────────┘    └──────────────────┘                          │
└─────────────────────────────────────────────────────────────────────────┘
         │
         │  postMessage('memory-write', ...)
         ▼
┌─────────────────────┐
│   Worker Thread     │
│  SessionMemory      │
│  Observer           │
│  (read-only SQLite) │
└─────────────────────┘
```

### Layer Responsibilities

| Layer | Location | Responsibility |
|-------|----------|----------------|
| `MemoryObserver` | Main thread | Tap `WorkerBridge` events, infer memories from behavioral signals |
| `KnowledgeGraph` | Main thread | Structural + semantic codebase model, impact radius queries |
| `RetrievalEngine` | Main thread | Phase-aware hybrid search, HyDE, causal chain expansion |
| `MemoryService` | Main thread | Store/search/inject API, proactive injection at tool-result level |
| `SessionMemoryObserver` | Worker thread | Track tool calls/file access within session, trigger pre-fetch |
| SQLite (WAL) | Disk | Single source of truth; workers use read-only connections |

---

## 5. Memory Schema (Extended)

### Core Memory Type

```typescript
// Extended from V1
interface Memory {
  // V1 fields (unchanged)
  id: string;
  type: MemoryType;
  content: string;
  confidence: number;          // 0.0 – 1.0
  tags: string[];
  relatedFiles: string[];
  relatedModules: string[];
  createdAt: string;           // ISO
  lastAccessedAt: string;      // ISO
  accessCount: number;
  sessionId: string;
  specNumber?: string;

  // V2 additions
  source: MemorySource;        // 'agent_explicit' | 'observer_inferred' | 'qa_auto' | 'user_taught'
  targetNodeId?: string;       // Link to KnowledgeGraph node
  relations?: MemoryRelation[];// Causal/conflict/validation edges
  decayHalfLifeDays?: number;  // Override default decay (e.g. work_state = 7)
  provenanceSessionIds: string[]; // All sessions that confirmed/reinforced this
  needsReview?: boolean;       // Flagged for session-end user review
  userVerified?: boolean;      // User confirmed correct
  citationText?: string;       // Short form for inline citation chips
}

type MemoryType =
  // V1 types
  | 'gotcha' | 'decision' | 'preference' | 'pattern'
  | 'requirement' | 'error_pattern' | 'module_insight' | 'workflow'
  // V2 new types
  | 'prefetch_pattern' | 'work_state' | 'causal_dependency' | 'task_calibration';

type MemorySource =
  | 'agent_explicit'   // Agent called remember_this
  | 'observer_inferred'// MemoryObserver derived from behavioral signals
  | 'qa_auto'          // Auto-extracted from QA failure
  | 'user_taught';     // User typed /remember or used Teach panel

interface MemoryRelation {
  // Use targetMemoryId when the relation points to another Memory record.
  // Use targetFilePath when the relation describes a file-pair dependency
  // (e.g. causal_dependency memories created by extractCausalChains()).
  // Exactly one of these should be set per relation.
  targetMemoryId?: string;
  targetFilePath?: string;
  relationType: 'required_with' | 'conflicts_with' | 'validates' | 'supersedes' | 'derived_from';
  confidence: number;
  autoExtracted: boolean;
}
```

### Extended Memory Types Detail

```typescript
// prefetch_pattern — auto-generated by SessionMemoryObserver
interface PrefetchPattern extends Memory {
  type: 'prefetch_pattern';
  alwaysReadFiles: string[];    // >80% of sessions that touch this module
  frequentlyReadFiles: string[];// >50% of sessions that touch this module
  moduleTrigger: string;        // Which module being worked on triggers this prefetch
  sessionCount: number;         // How many sessions generated this pattern
}

// work_state — cross-session continuity
interface WorkStateMemory extends Memory {
  type: 'work_state';
  specNumber: string;
  completedSubtasks: string[];
  inProgressSubtask?: {
    description: string;
    nextStep: string;           // Last agent thought before session ended
  };
  keyDecisionsThisSession: string[];
  decayHalfLifeDays: 7;        // Expires fast — stale work state is harmful
}

// task_calibration — QA/planner alignment
interface TaskCalibration extends Memory {
  type: 'task_calibration';
  module: string;
  averageActualSteps: number;
  averagePlannedSteps: number;
  ratio: number;               // >1.0 = consistently underestimated
  sampleCount: number;
}
```

---

## 6. Memory Observer (Passive Behavioral Layer)

The Observer is the keystone V2 innovation: memories generated from *what agents do*, not what they say.

### Placement: Main Thread, `WorkerBridge` Integration

```typescript
// worker-bridge.ts (V2 addition)
import { MemoryObserver } from '../ai/memory/observer';

class WorkerBridge {
  private observer: MemoryObserver;

  constructor(sessionConfig: SerializableSessionConfig) {
    this.observer = new MemoryObserver(sessionConfig);
  }

  private handleWorkerMessage(event: MessageEvent) {
    // Existing event routing...
    this.observer.observe(event.data); // ← tap every event
    this.dispatchToAgentManager(event.data);
  }

  async onSessionEnd() {
    const inferred = await this.observer.finalize();
    // Store inferred memories via MemoryService
    for (const memory of inferred) {
      await memoryService.store(memory);
    }
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
  timeDeltaMs: number;    // How quickly B was accessed after A
  stepDelta: number;      // Steps between accesses
  sessionId: string;
}

interface ErrorRetrySignal {
  type: 'error_retry';
  toolName: string;
  errorMessage: string;
  retryCount: number;
  resolvedHow?: string;   // Tool result text that ended the retry loop
}

interface BacktrackSignal {
  type: 'backtrack';
  editedFilePath: string;
  reEditedWithinSteps: number; // File edited, then re-edited quickly
  likelyCause: 'wrong_assumption' | 'missing_context' | 'cascading_change';
}

interface SequenceSignal {
  type: 'sequence';
  toolSequence: string[]; // e.g. ['Read', 'Grep', 'Grep', 'Edit']
  context: string;        // What the sequence accomplished
  frequency: number;      // How many times this exact sequence occurred
}

interface TimeAnomalySignal {
  type: 'time_anomaly';
  filePath: string;
  dwellMs: number;        // Agent "re-read" repeatedly — indicates confusion
  readCount: number;
}
```

### Memory Inference Rules

| Signal | Inference | Memory Type |
|--------|-----------|-------------|
| Files A+B accessed within 3 steps in ≥3 sessions | A and B are co-dependent | `causal_dependency` |
| File read 4+ times in one session without Edit | File is confusing / poorly named | `module_insight` |
| ErrorRetry with same error 3+ times | Error pattern worth recording | `error_pattern` |
| Edit followed by re-Edit within 5 steps | Wrong first assumption | `gotcha` |
| File accessed in >80% of sessions for a module | Should be pre-fetched | `prefetch_pattern` |
| BacktrackSignal with `cascading_change` cause | Edit triggers required paired edits | `gotcha` (with relatedFiles) |

### Filter Pipeline

```
raw signals
    │
    ▼ 1. Frequency threshold (signal must occur ≥ N times)
    │     file_access: ≥3 sessions, co_access: ≥2 sessions,
    │     error_retry: ≥2 occurrences, backtrack: ≥2 occurrences
    │
    ▼ 2. Novelty check (cosine similarity < 0.88 vs existing memories)
    │     Skip if an existing memory already captures this
    │
    ▼ 3. Signal scoring
    │     score = (frequency × 0.4) + (recency × 0.3) + (novelty × 0.3)
    │     Threshold: score > 0.6
    │
    ▼ 4. LLM synthesis (batched at session end)
    │     Convert raw signal + context into human-readable memory.content
    │
    ▼ 5. Session cap: max 10 new inferred memories per session
    │
    ▼ marked source='observer_inferred', needsReview=true
```

### Co-Access Graph

The co-access graph is the Observer's most durable output: a weighted edge list of files that agents access together across sessions. This reveals **runtime coupling invisible to static analysis** (e.g., config + handler that share a secret constant, test fixture + implementation that must stay in sync).

```typescript
// Stored in observer_co_access_edges table
interface CoAccessEdge {
  fileA: string;
  fileB: string;
  weight: number;          // Sessions in which both accessed, normalized
  avgTimeDeltaMs: number;  // Average time between A→B access
  directional: boolean;    // True if A almost always precedes B
  lastObservedAt: string;
}
```

Cold-start bootstrap: Parse `git log --diff-filter=M --name-only` to seed initial co-commit patterns before any agent sessions exist.

---

## 7. Knowledge Graph Layer

The Knowledge Graph is a **separate, linked layer** — not embedded in the memory store. It models codebase structure and enables impact radius analysis, enriching memory retrieval with structural context.

### Design Decision: Linked-But-Separate

```
Memory record                    Knowledge Graph node
─────────────────                ─────────────────────
{ targetNodeId: "node_abc" } ──► { id: "node_abc",     }
{ relatedFiles: [...] }          { label: "auth.ts",    }
                                 { associatedMemoryIds: }
                                 { ["mem_123", ...]     }
```

Memories link to graph nodes via `targetNodeId`. Graph nodes link back via `associatedMemoryIds`. Neither owns the other.

### Graph Schema

```typescript
type NodeType =
  | 'file' | 'directory' | 'module'
  | 'function' | 'class' | 'interface'
  | 'pattern' | 'dataflow' | 'invariant' | 'decision';

type EdgeType =
  // Structural (AST-derived)
  | 'imports' | 'calls' | 'implements' | 'extends' | 'exports'
  // Semantic (LLM-derived or agent-discovered)
  | 'depends_logically' | 'is_entrypoint_for'
  | 'handles_errors_from' | 'applies_pattern' | 'flows_to';

interface GraphNode {
  id: string;
  label: string;             // File path or symbol name
  type: NodeType;
  metadata: Record<string, unknown>;
  associatedMemoryIds: string[];
  staleAt?: string;          // Invalidated by file change
  lastAnalyzedAt: string;
}

interface GraphEdge {
  fromId: string;
  toId: string;
  type: EdgeType;
  weight: number;            // Impact propagation weight (0.0–1.0)
  confidence: number;
  autoExtracted: boolean;
}
```

### Impact Radius via Closure Table

Pre-computed transitive closure avoids O(N×E) recursive CTEs at query time:

```sql
-- graph_closure table (pre-computed)
CREATE TABLE graph_closure (
  ancestor_id TEXT NOT NULL,
  descendant_id TEXT NOT NULL,
  depth INTEGER NOT NULL,
  path TEXT,                 -- JSON array of node IDs
  PRIMARY KEY (ancestor_id, descendant_id)
);

-- O(1) impact query: all nodes transitively depending on file X
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
  directDependents: GraphNode[];   // depth=1
  transitiveDependents: GraphNode[];// depth=2-3
  testCoverage: string[];          // test files in closure
  invariants: Memory[];            // invariant memories linked to affected nodes
  impactScore: number;             // sum of edge weights along paths
}

// Edge weights for impact propagation
const EDGE_IMPACT_WEIGHTS: Record<EdgeType, number> = {
  imports: 0.9,
  calls: 0.8,
  implements: 0.7,
  extends: 0.7,
  exports: 0.6,
  depends_logically: 0.5,
  is_entrypoint_for: 0.8,
  handles_errors_from: 0.4,
  applies_pattern: 0.3,
  flows_to: 0.6,
};
```

### 3-Layer Construction

| Layer | Source | When Built |
|-------|--------|-----------|
| Structural | tree-sitter AST parsing | Cold start, file change |
| Semantic | LLM analysis of module relationships | First agent session, periodic |
| Knowledge | Agent-discovered + observer-inferred | Ongoing, every session |

**Incremental invalidation**: File mtime change → mark `stale_at` on affected nodes → rebuild only stale subgraph.

**V2 → V3 upgrade path**: Kuzu embedded graph DB (35-60MB bundle) when node count exceeds 100K. SQLite closure table handles up to ~50K nodes with acceptable performance.

### Agent Tools Exposed

```typescript
// New tools available to agents in V2
const analyzeImpactTool = tool({
  description: 'Analyze which files/modules will be affected by changing a given file',
  inputSchema: z.object({ filePath: z.string(), maxDepth: z.number().optional().default(3) }),
  execute: async ({ filePath, maxDepth }) => knowledgeGraph.analyzeImpact(filePath, maxDepth),
});

const getDependenciesTool = tool({
  description: 'Get all files this file depends on (direct and transitive)',
  inputSchema: z.object({ filePath: z.string() }),
  execute: async ({ filePath }) => knowledgeGraph.getDependencies(filePath),
});

const traceDataFlowTool = tool({
  description: 'Trace how data flows through the codebase from a given source',
  inputSchema: z.object({ sourceNodeId: z.string() }),
  execute: async ({ sourceNodeId }) => knowledgeGraph.traceDataFlow(sourceNodeId),
});
```

---

## 8. Retrieval Engine (V2)

### Phase-Aware Re-Ranking

Different agent phases need different memory types. V2 applies `typeMultiplier` per phase before final scoring:

```typescript
type AgentPhase = 'planning' | 'coding' | 'qa_review' | 'debugging' | 'insights' | 'spec';

const PHASE_WEIGHTS: Record<AgentPhase, Record<MemoryType, number>> = {
  planning: {
    requirement: 1.5, decision: 1.3, pattern: 1.2, task_calibration: 1.4,
    gotcha: 0.8, error_pattern: 0.7, work_state: 1.1, prefetch_pattern: 0.6,
    preference: 1.0, module_insight: 1.0, workflow: 1.1, causal_dependency: 0.9,
  },
  coding: {
    gotcha: 1.5, error_pattern: 1.3, pattern: 1.2, causal_dependency: 1.3,
    prefetch_pattern: 1.1, module_insight: 1.2, work_state: 1.0,
    requirement: 0.8, decision: 0.7, task_calibration: 0.6, preference: 0.9, workflow: 0.8,
  },
  qa_review: {
    error_pattern: 1.5, requirement: 1.4, gotcha: 1.2, decision: 1.1,
    module_insight: 0.9, pattern: 0.8, work_state: 0.5, prefetch_pattern: 0.3,
    preference: 0.7, causal_dependency: 1.0, task_calibration: 0.8, workflow: 0.9,
  },
  debugging: {
    error_pattern: 1.5, gotcha: 1.4, causal_dependency: 1.3, module_insight: 1.2,
    pattern: 1.0, decision: 0.8, requirement: 0.6, work_state: 0.9,
    prefetch_pattern: 0.5, task_calibration: 0.5, preference: 0.7, workflow: 0.8,
  },
  insights: {
    decision: 1.4, module_insight: 1.3, pattern: 1.2, workflow: 1.1,
    requirement: 1.0, preference: 1.0, gotcha: 0.8, error_pattern: 0.7,
    causal_dependency: 1.1, task_calibration: 0.6, work_state: 0.4, prefetch_pattern: 0.3,
  },
  spec: {
    requirement: 1.5, decision: 1.3, preference: 1.2, workflow: 1.1,
    pattern: 1.0, module_insight: 1.0, gotcha: 0.7, error_pattern: 0.6,
    task_calibration: 1.3, causal_dependency: 0.8, work_state: 0.5, prefetch_pattern: 0.3,
  },
};

function phaseAwareScore(
  baseScore: number,
  memoryType: MemoryType,
  phase: AgentPhase
): number {
  return baseScore * PHASE_WEIGHTS[phase][memoryType];
}
```

### Base Hybrid Score (V1, kept)

```
score = 0.6 * cosine_similarity
      + 0.25 * recency_score       // exp(-days_since_accessed / 30)
      + 0.15 * access_frequency    // log(1 + accessCount) / log(1 + maxCount)
```

**V2 final score**: `phaseAwareScore(baseScore, type, phase)`

### Proactive Gotcha Injection

When an agent reads a file, inject relevant `gotcha`/`error_pattern` memories for that file **at the tool-result level** — without the agent needing to ask:

```typescript
// In session/runner.ts, tool result interceptor
async function interceptToolResult(
  toolName: string,
  args: Record<string, unknown>,
  result: string,
  phase: AgentPhase,
): Promise<string> {
  if (toolName !== 'Read' && toolName !== 'Edit') return result;

  const filePath = args.file_path as string;
  const gotchas = await memoryService.search({
    types: ['gotcha', 'error_pattern'],
    relatedFiles: [filePath],
    limit: 3,
    // Gate: only inject memories the system has seen before (accessCount >= 2)
    // or that a user has verified. Prevents freshly-inferred bad memories from
    // being injected before they've had any validation signal.
    minConfidence: 0.65,
    filter: (m) => m.userVerified === true || m.accessCount >= 2,
  });

  if (gotchas.length === 0) return result;

  const injection = gotchas
    .map(m => `⚠️ Memory [${m.id.slice(0, 8)}]: ${m.content}`)
    .join('\n');

  return `${result}\n\n---\n**Relevant memories for this file:**\n${injection}`;
}
```

### Causal Chain Retrieval

When searching for memories related to file A, expand results to include memories linked to files that must be accessed with A:

```typescript
async function expandWithCausalChain(
  initialResults: Memory[],
  relatedFiles: string[],
): Promise<Memory[]> {
  const causalFiles = await getCausallyLinkedFiles(relatedFiles);

  if (causalFiles.length === 0) return initialResults;

  const causalMemories = await memoryService.search({
    relatedFiles: causalFiles,
    types: ['gotcha', 'pattern', 'error_pattern'],
    limit: 5,
  });

  return deduplicateAndMerge(initialResults, causalMemories);
}

async function getCausallyLinkedFiles(files: string[]): Promise<string[]> {
  // Query observer_co_access_edges for edges with weight > 0.6
  const edges = await db.all(`
    SELECT CASE WHEN file_a = ? THEN file_b ELSE file_a END as linked_file
    FROM observer_co_access_edges
    WHERE (file_a = ? OR file_b = ?)
      AND weight > 0.6
    ORDER BY weight DESC
    LIMIT 5
  `, [files[0], files[0], files[0]]);

  return edges.map(e => e.linked_file);
}

// Auto-extract causal edges from co-access patterns (runs weekly)
async function extractCausalChains(): Promise<void> {
  // WHERE clause already filters weight > 0.7; no redundant inner check needed
  const strongEdges = await db.all(`
    SELECT file_a, file_b, weight FROM observer_co_access_edges
    WHERE weight > 0.7 AND directional = 1
  `);

  for (const edge of strongEdges) {
    // NOTE: relations.targetFilePath, not targetMemoryId — this relation links two
    // file paths, not two memory records. Use targetFilePath in the MemoryRelation
    // schema for file-pair causal dependencies (see schema note in §5).
    await memoryService.store({
      type: 'causal_dependency',
      content: `${edge.file_a} typically needs ${edge.file_b} (co-access strength: ${edge.weight.toFixed(2)})`,
      relatedFiles: [edge.file_a, edge.file_b],
      relations: [{
        targetFilePath: edge.file_b,   // file path, not a memory ID
        relationType: 'required_with',
        confidence: edge.weight,
        autoExtracted: true,
      }],
      source: 'observer_inferred',
    });
  }
}
```

### HyDE Search (Hypothetical Document Embeddings)

For low-recall queries, generate a hypothetical ideal memory and use ensemble embedding:

```typescript
async function hydeSearch(query: string, phase: AgentPhase): Promise<Memory[]> {
  // Generate hypothetical ideal memory for this query
  const hypothetical = await generateText({
    model: fastModel,
    prompt: `Write a brief, specific developer memory that would perfectly answer: "${query}"
             Format as if it were a real memory entry. Focus on concrete technical details.`,
    maxTokens: 150,
  });

  const [queryEmbedding, hydeEmbedding] = await embedMany({
    model: embeddingModel,
    values: [query, hypothetical.text],
  });

  // Ensemble: 40% query + 60% hypothetical
  const ensembleEmbedding = queryEmbedding.map(
    (v, i) => 0.4 * v + 0.6 * hydeEmbedding[i]
  );

  return vectorSearch(ensembleEmbedding, { phase, limit: 10 });
}
```

HyDE is used when standard search returns < 3 results above confidence threshold 0.5.

### Temporal Search Modes

```typescript
type TemporalMode = 'recent_sessions' | 'time_window' | 'around_event' | 'trend';

interface TemporalSearchOptions {
  mode: TemporalMode;
  sessionCount?: number;    // recent_sessions: last N sessions
  startDate?: string;       // time_window: ISO date
  endDate?: string;
  eventId?: string;         // around_event: ±3 sessions around event
  trendDays?: number;       // trend: analyze over N days
}
```

### Confidence Propagation

When a memory's confidence is updated, propagate changes through typed relation edges:

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
    // Skip file-path relations — confidence propagation only applies to
    // memory-to-memory relations (targetMemoryId). File targets (targetFilePath)
    // have no confidence to update.
    if (!rel.targetMemoryId) continue;

    const propagated = computePropagated(newConfidence, rel.relationType, rel.confidence);
    if (Math.abs(propagated - rel.targetCurrentConfidence) > 0.05) {
      await updateConfidence(rel.targetMemoryId, propagated);
      await propagateConfidence(rel.targetMemoryId, propagated, visited);
    }
  }
}

function computePropagated(
  sourceConfidence: number,
  relationType: MemoryRelation['relationType'],
  edgeConfidence: number,
): number {
  const PROPAGATION_FACTORS: Record<MemoryRelation['relationType'], number> = {
    validates: 0.6,        // A validates B → B gets partial confidence boost
    required_with: 0.3,    // Weak propagation
    conflicts_with: -0.4,  // Negative propagation (opposing memories)
    supersedes: 0.8,       // Strong: superseding memory confidence → old memory decays
    derived_from: 0.5,
  };
  return Math.max(0, Math.min(1,
    sourceConfidence * PROPAGATION_FACTORS[relationType] * edgeConfidence
  ));
}
```

---

## 9. Active Agent Loop Integration

### `SessionMemoryObserver` (Worker Thread)

Lives in `session/runner.ts` alongside `executeStream()`. Observes the current session and sends signals to main thread:

```typescript
class SessionMemoryObserver {
  private accessedFiles: Map<string, number> = new Map(); // path → first step
  private toolCallSequence: Array<{ tool: string; step: number }> = [];
  private stepLimit = 30; // Only track first 30 steps for prefetch
  private sessionId: string;

  onToolCall(toolName: string, args: Record<string, unknown>, stepIndex: number): void {
    this.toolCallSequence.push({ tool: toolName, step: stepIndex });

    if (toolName === 'Read' || toolName === 'Edit' || toolName === 'Write') {
      const path = args.file_path as string;
      if (stepIndex <= this.stepLimit && !this.accessedFiles.has(path)) {
        this.accessedFiles.set(path, stepIndex);
      }
    }
  }

  onToolResult(toolName: string, args: Record<string, unknown>, result: string): void {
    // Check for error patterns in tool results
    if (result.includes('Error') || result.includes('failed')) {
      parentPort?.postMessage({
        type: 'memory-signal',
        signal: { type: 'error_retry', toolName, errorMessage: result.slice(0, 200) },
      });
    }
  }

  getAccessedFiles(): string[] {
    return Array.from(this.accessedFiles.keys());
  }

  finalize(): void {
    // Send access patterns to main thread for Observer processing
    parentPort?.postMessage({
      type: 'memory-session-end',
      accessedFiles: this.getAccessedFiles(),
      toolSequence: this.toolCallSequence,
      sessionId: this.sessionId,
    });
  }
}
```

### Predictive Pre-Fetching

At session start, before agent first tool call, inject pre-fetched file contents based on `prefetch_pattern` memories:

```typescript
async function buildInitialMessageWithPrefetch(
  baseMessage: string,
  specNumber: string,
  phase: AgentPhase,
  projectRoot: string,          // must be passed in; never read from global state
): Promise<string> {
  const patterns = await memoryService.search({
    types: ['prefetch_pattern'],
    specNumber,
    minConfidence: 0.7,
    limit: 1,
  }) as PrefetchPattern[];

  if (patterns.length === 0 || phase !== 'coding') return baseMessage;

  const pattern = patterns[0];
  const preloadedContents: string[] = [];

  for (const filePath of pattern.alwaysReadFiles.slice(0, 5)) {
    // Security: constrain to project root to prevent poisoned memory from
    // reading arbitrary paths (e.g. /etc/passwd or paths outside the worktree).
    // Use `+ path.sep` to avoid prefix collisions: /repo vs /repo2 both start
    // with "/repo", but only "/repo/" is truly inside the project root.
    const resolved = path.resolve(filePath);
    const rootWithSep = projectRoot.endsWith(path.sep) ? projectRoot : projectRoot + path.sep;
    if (!resolved.startsWith(rootWithSep) && resolved !== projectRoot) continue;

    try {
      const content = await fs.readFile(resolved, 'utf-8');
      const truncated = content.length > 3000
        ? content.slice(0, 3000) + '\n... [truncated, use Read tool for full content]'
        : content;
      preloadedContents.push(`### ${filePath}\n\`\`\`\n${truncated}\n\`\`\``);
    } catch { /* file moved/deleted, skip */ }
  }

  if (preloadedContents.length === 0) return baseMessage;

  return `${baseMessage}\n\n## PRE-LOADED FILES\n*These files are pre-loaded because you always need them for this module:*\n\n${preloadedContents.join('\n\n')}`;
}
```

### QA Failure → Reflexion Memory

Auto-extract structured `error_pattern` memories immediately when QA reviewer flags failures:

```typescript
// In orchestration/qa-reports.ts
async function extractQaFailureMemories(
  qaReport: QAReport,
  sessionId: string,
  specNumber: string,
): Promise<void> {
  const failures = qaReport.issues.filter(i => i.severity === 'critical' || i.severity === 'high');

  for (const failure of failures) {
    const memory = await generateText({
      model: fastModel,
      prompt: `Extract a structured error pattern memory from this QA failure:
Issue: ${failure.description}
File: ${failure.file}
What was tried: ${failure.whatWasTried || 'unknown'}
What should be done: ${failure.recommendation}

Write a concise memory entry (2-3 sentences) describing:
1. What went wrong
2. What the correct approach is
3. How to avoid this in future`,
      maxTokens: 200,
    });

    await memoryService.store({
      type: 'error_pattern',
      content: memory.text,
      confidence: 0.8,
      relatedFiles: failure.file ? [failure.file] : [],
      relatedModules: failure.module ? [failure.module] : [],
      source: 'qa_auto',
      specNumber,
      sessionId,
      needsReview: false, // QA failures are trusted; skip review
      tags: ['qa_failure', `spec_${specNumber}`],
    });
  }
}
```

### Stage-to-Stage Memory Relay

Planner writes context that Coder receives at its session start:

```typescript
// orchestration/build-pipeline.ts

// After planner completes:
async function afterPlannerComplete(planResult: PlanResult, specNumber: string): Promise<void> {
  const plannerMemories = await memoryService.search({
    sessionId: planResult.sessionId,
    source: 'agent_explicit',
    limit: 20,
  });

  // Tag planner memories for coder relay
  for (const memory of plannerMemories) {
    await memoryService.update(memory.id, {
      tags: [...memory.tags, 'planner_relay', `spec_${specNumber}`],
    });
  }
}

// Before coder starts:
async function buildCoderContext(specNumber: string, phase: AgentPhase): Promise<string> {
  const plannerMemories = await memoryService.search({
    tags: ['planner_relay', `spec_${specNumber}`],
    limit: 10,
    phase,
  });

  if (plannerMemories.length === 0) return '';

  const relay = plannerMemories
    .map(m => `- [PLANNER] ${m.content}`)
    .join('\n');

  return `\n## Context from Planning Phase\n${relay}\n`;
}
```

### Work-State Continuity

At session end, agent writes a `work_state` memory with current progress:

```typescript
// Auto-generated work_state at session end (via observer onSessionEnd)
async function captureWorkState(
  sessionId: string,
  specNumber: string,
  agentOutput: string,
): Promise<void> {
  // Extract work state from final agent output using lightweight LLM call
  const workState = await generateText({
    model: fastModel,
    prompt: `From this agent session output, extract:
1. Which subtasks were completed
2. What was in-progress when session ended
3. Key decisions made

Agent output (last 2000 chars): ${agentOutput.slice(-2000)}

Output JSON: { completedSubtasks: [], inProgressSubtask: { description, nextStep }, keyDecisions: [] }`,
    maxTokens: 300,
  });

  try {
    const parsed = JSON.parse(workState.text);
    await memoryService.store({
      type: 'work_state',
      content: JSON.stringify(parsed),
      confidence: 0.9,
      specNumber,
      sessionId,
      source: 'observer_inferred',
      decayHalfLifeDays: 7,
      tags: [`spec_${specNumber}`, 'work_state'],
    });
  } catch { /* non-parseable output, skip */ }
}
```

---

## 10. UX & Trust Model

### Design Principle

Memory is only valuable if users trust it. A single wrong memory confidently applied is worse than no memory. Every V2 UX decision prioritizes **trust signals** over feature richness.

### P0 Trust-Critical Requirements

1. **Provenance always visible** — Every memory shows where it came from (which session, which agent phase, source type)
2. **Inline citation chips** — When agent output is informed by a memory, show `[↗ Memory: gotcha in auth.ts]` inline
3. **Session-end review** — After every build session, user reviews a summary of what agent remembered and learned
4. **Flag-wrong at point of damage** — User can flag an incorrect memory immediately when they notice the error in agent behavior
5. **Health Dashboard as default view** — Users land on health/status, not a raw memory list

### Navigation Structure

```
Memory Panel (Cmd+Shift+M)
├── Health Dashboard (default view)
│   ├── Stats row: total | active | need-review | tokens-saved
│   ├── Health score (0-100) with explanation
│   ├── Module coverage bars
│   ├── Recent activity feed
│   └── Session metrics
├── Module Map
│   ├── Visual graph of modules with memory coverage
│   └── Click module → filtered Memory Browser
├── Memory Browser
│   ├── Filter: type | confidence | source | module | date
│   ├── Sort: confidence | recency | usage
│   └── Memory cards (see anatomy below)
└── Memory Chat
    └── Natural language queries ("What do you know about auth?")
```

### Memory Card Anatomy

```
┌────────────────────────────────────────────────────────┐
│ [gotcha] ●●●○○ (conf: 0.72)              Used 4× ago  │
│ session: build-042 · phase: coding · observer_inferred  │ ← always visible
├────────────────────────────────────────────────────────┤
│ Writing to observer_co_access_edges requires WAL mode   │
│ to be enabled; without it, concurrent reads cause       │
│ "database is locked" errors on high-traffic sessions.   │
├────────────────────────────────────────────────────────┤
│ 📁 observer.ts, worker-bridge.ts                       │
│ 🏷  observer, sqlite, concurrency                      │
├────────────────────────────────────────────────────────┤
│ [✓ Confirm] [✏ Correct] [⚑ Flag wrong] [🗑 Delete]   │
└────────────────────────────────────────────────────────┘
```

### Session-End Review Flow

After every build session, show summary before closing:

```
╔══════════════════════════════════════════════════════╗
║  Session Memory Summary — build-042                  ║
╠══════════════════════════════════════════════════════╣
║  WHAT THE AGENT REMEMBERED (retrieved, applied)      ║
║  ┌─────────────────────────────────────────────┐    ║
║  │ ✓ [gotcha] WAL mode needed for co-access... │    ║
║  │ ✓ [pattern] Always read index.ts before ... │    ║
║  └─────────────────────────────────────────────┘    ║
║                                                      ║
║  WHAT THE AGENT LEARNED (new memories created)       ║
║  ┌─────────────────────────────────────────────┐    ║
║  │ [✓][✏][✗] [observer] auth.ts and token-    │    ║
║  │   refresh.ts always accessed together...    │    ║
║  │                                             │    ║
║  │ [✓][✏][✗] [qa_auto] Closure table must be  │    ║
║  │   rebuilt after schema migration...         │    ║
║  └─────────────────────────────────────────────┘    ║
║                           [Review Later] [Done ✓]   ║
╚══════════════════════════════════════════════════════╝
```

### Correction Modal

When user clicks [✏ Correct] or [⚑ Flag wrong]:

```
┌─ Correct this memory ──────────────────────────────┐
│ Original: "WAL mode needed for observer tables"    │
│                                                    │
│ What's wrong?                                      │
│ ○ The content is inaccurate — I'll correct it      │
│ ○ This no longer applies — mark as outdated        │
│ ○ This is too specific — generalize it             │
│ ○ This is a duplicate — I'll find the original     │
│                                                    │
│ [Text editor for corrected content]                │
│                                                    │
│                    [Cancel] [Save Correction]      │
└────────────────────────────────────────────────────┘
```

### Inline Citation Chips

In agent terminal output, when a memory informed agent behavior:

```
Reading auth.ts...
[↗ Memory: gotcha in token-refresh.ts — always invalidate cache after refresh]
[→ Applied: added cache.invalidate() after line 47]
```

Implementation: Agent output post-processor in `agent-events-handlers.ts` scans for memory IDs in agent thoughts, injects citation chip HTML before rendering.

### "Teach the AI" Entry Points

| Method | Where | Action |
|--------|-------|--------|
| `/remember <text>` | Terminal | Creates `user_taught` memory |
| `Cmd+Shift+M` | Global | Opens Memory Panel |
| Right-click file in editor | File tree | "Add memory about this file" |
| Session-end summary `[✏]` | Modal | Edit before confirming |
| Memory Browser `[+ Add]` | Panel | Manual memory entry form |

### React Component Hierarchy

```typescript
<MemoryPanel>
  <MemoryNav />                          // tab switcher
  <HealthDashboard>
    <MemoryStatsRow />
    <HealthScore />
    <ModuleCoverageBars />
    <RecentActivityFeed />
    <SessionMetrics />                   // tokens saved
  </HealthDashboard>
  <ModuleMapView>
    <GraphCanvas />                      // D3/Canvas graph
    <ModuleMemoryList />
  </ModuleMapView>
  <MemoryBrowser>
    <MemoryFilterBar />
    <MemoryList>
      <MemoryCard>
        <MemoryTypeChip />
        <ConfidenceDots />               // ●●●○○
        <ProvenanceBadge />              // always visible
        <MemoryContent />
        <RelatedFiles />
        <MemoryActions />               // confirm/correct/flag/delete
      </MemoryCard>
    </MemoryList>
  </MemoryBrowser>
  <MemoryChat />
  <SessionEndSummaryModal />
  <CorrectionModal />
  <TeachPanel />
</MemoryPanel>
```

---

## 11. SQLite Schema

Full schema including all V2 additions:

```sql
-- ==========================================
-- CORE MEMORY TABLES (V1 + V2 extensions)
-- ==========================================

CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.8,
  tags TEXT NOT NULL DEFAULT '[]',          -- JSON array
  related_files TEXT NOT NULL DEFAULT '[]', -- JSON array
  related_modules TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  last_accessed_at TEXT NOT NULL,
  access_count INTEGER NOT NULL DEFAULT 0,
  session_id TEXT,
  spec_number TEXT,
  -- V2 additions
  source TEXT NOT NULL DEFAULT 'agent_explicit',
  target_node_id TEXT,                      -- FK to graph_nodes
  relations TEXT NOT NULL DEFAULT '[]',     -- JSON array of MemoryRelation
  decay_half_life_days REAL,
  provenance_session_ids TEXT DEFAULT '[]', -- JSON array
  needs_review INTEGER NOT NULL DEFAULT 0,
  user_verified INTEGER NOT NULL DEFAULT 0,
  citation_text TEXT,
  stale_at TEXT                             -- null = valid
);

CREATE TABLE memory_embeddings (
  memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
  embedding BLOB NOT NULL,                  -- sqlite-vec float32 768-dim
  model_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- ==========================================
-- OBSERVER TABLES
-- ==========================================

CREATE TABLE observer_file_nodes (
  file_path TEXT PRIMARY KEY,
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at TEXT NOT NULL,
  session_count INTEGER NOT NULL DEFAULT 0  -- distinct sessions
);

CREATE TABLE observer_co_access_edges (
  file_a TEXT NOT NULL,
  file_b TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 0.0,         -- normalized [0,1]
  raw_count INTEGER NOT NULL DEFAULT 0,
  avg_time_delta_ms REAL,
  directional INTEGER NOT NULL DEFAULT 0,   -- 1 = A almost always precedes B
  last_observed_at TEXT NOT NULL,
  PRIMARY KEY (file_a, file_b)
);

CREATE TABLE observer_error_patterns (
  id TEXT PRIMARY KEY,
  tool_name TEXT NOT NULL,
  error_hash TEXT NOT NULL,                 -- hash of normalized error
  error_message TEXT NOT NULL,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  last_seen_at TEXT NOT NULL,
  resolved_how TEXT
);

CREATE TABLE observer_signal_log (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  signal_data TEXT NOT NULL,               -- JSON
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
  metadata TEXT NOT NULL DEFAULT '{}',     -- JSON
  associated_memory_ids TEXT DEFAULT '[]', -- JSON array
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
  path TEXT,                               -- JSON array of node IDs
  PRIMARY KEY (ancestor_id, descendant_id)
);

-- ==========================================
-- INDEXES
-- ==========================================

CREATE INDEX idx_memories_type ON memories(type);
CREATE INDEX idx_memories_spec ON memories(spec_number);
CREATE INDEX idx_memories_session ON memories(session_id);
CREATE INDEX idx_memories_source ON memories(source);
CREATE INDEX idx_memories_needs_review ON memories(needs_review) WHERE needs_review = 1;
CREATE INDEX idx_memories_confidence ON memories(confidence DESC);
CREATE INDEX idx_memories_last_accessed ON memories(last_accessed_at DESC);

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

### V1 Architecture (kept, extended)

- **WAL mode** (`PRAGMA journal_mode=WAL`) enables concurrent readers
- **Main-thread write proxy**: all writes go through `MemoryService` on main thread
- **Workers use read-only connections**: `readonly: true` SQLite open flag
- **Write messages**: workers send `postMessage({ type: 'memory-write', ... })` to main

### V2 Extensions

```typescript
// New message types workers can send to main thread
type WorkerToMainMessage =
  | { type: 'memory-write'; payload: Partial<Memory> }
  | { type: 'memory-signal'; signal: ObserverSignal }        // NEW: observer signals
  | { type: 'memory-session-end';                            // NEW: session wrap-up
      accessedFiles: string[];
      toolSequence: Array<{ tool: string; step: number }>;
      sessionId: string; }
  | { type: 'memory-qa-failure'; qaReport: QAReport };      // NEW: QA auto-extract
```

### Write Serialization

```typescript
// main thread: MemoryService.handleWorkerMessage()
async handleWorkerMessage(msg: WorkerToMainMessage): Promise<void> {
  switch (msg.type) {
    case 'memory-write':
      await this.store(msg.payload);
      break;
    case 'memory-signal':
      this.observer.observe(msg.signal);
      break;
    case 'memory-session-end':
      await this.observer.finalizeSession(msg);
      break;
    case 'memory-qa-failure':
      await extractQaFailureMemories(msg.qaReport, ...);
      break;
  }
}
```

### Embedding Strategy

- **Model**: `nomic-embed-text` via Ollama (768-dim, runs locally)
- **Fallback**: `text-embedding-3-small` via OpenAI API if Ollama unavailable — **must** be called with `dimensions: 768` to match the column schema. Default OpenAI output is 1536-dim; mixing dimensions in the same BLOB column will silently corrupt vector search results.
- **Enforcement**: `memory_embeddings.model_id` must be checked before any similarity query. Reject searches that would compare vectors from different model IDs in the same result set.
- **Storage**: `sqlite-vec` BLOB column, brute-force scan (no HNSW)
- **Performance**: 5-50ms at 5K-10K vectors (acceptable for current scale)
- **V3 upgrade**: Move to dedicated vector DB (Qdrant local) at 50K+ memories

### Cloud Backend (Phased)

| Phase | Storage | Embedding | When |
|-------|---------|-----------|------|
| Local | SQLite + sqlite-vec | Ollama nomic-embed | Now |
| Hybrid | SQLite + Convex backup | Voyage-3-lite API | V2.1 |
| Full cloud | Convex + Pinecone | Voyage-3 | V3 |

Convex tenant isolation: `ctx.auth`-derived project ID as row-level filter. Per-project include/exclude during cloud migration. Vectors-only privacy option (no raw content sent to cloud).

---

## 13. Implementation Plan

Ordered by value delivered per effort. Each phase is independently shippable.

### Phase 0: Clean Cutover
*No backwards compatibility. Drop all Python/Ladybug/Graphiti memory paths.*

- [ ] Remove Python memory subprocess calls from all IPC handlers
- [ ] Create fresh SQLite DB at `{projectRoot}/.auto-claude/memory.db` with V2 schema (no migration from V1 data)
- [ ] Implement `MemoryService` class in `apps/frontend/src/main/ai/memory/service.ts` as the single write/read interface
- [ ] Wire `MemoryService` to `WorkerBridge` message handling

**Cutover is a hard switch — old memory data is discarded. No dual-write, no backfill.**

---

### Phase 1: Foundation Extensions
*Prerequisite: Phase 0 complete*

- [ ] Add `source`, `relations`, `decay_half_life_days`, `needs_review`, `user_verified`, `citation_text` columns to `memories` table (migration)
- [ ] Add new memory types: `prefetch_pattern`, `work_state`, `causal_dependency`, `task_calibration`
- [ ] Phase-aware retrieval weights (`PHASE_WEIGHTS` record, apply in `search()`)
- [ ] Session-end `work_state` capture (lightweight LLM extract from agent output)
- [ ] QA failure → `error_pattern` auto-extraction (no user action needed)

**Validation**: QA failure recurrence drops within 10 sessions. Work state summary visible after each build.

### Phase 2: Memory Observer
*Prerequisite: Phase 1*

- [ ] `MemoryObserver` class on main thread
- [ ] Tap `WorkerBridge.handleWorkerMessage()` to feed observer
- [ ] `observer_file_nodes`, `observer_co_access_edges`, `observer_error_patterns`, `observer_signal_log` tables
- [ ] Signal filter pipeline (frequency → novelty → scoring → session cap)
- [ ] LLM batch synthesis at session end (`needsReview=true`)
- [ ] Cold-start bootstrap from `git log` co-commit history
- [ ] Co-access graph build from `observer_co_access_edges`

**Validation**: Observer generates ≥3 valid inferred memories per session after 5 sessions on a project.

### Phase 3: Active Agent Loop
*Prerequisite: Phase 1 + Phase 2*

- [ ] `SessionMemoryObserver` in `session/runner.ts`
- [ ] `prefetch_pattern` generation from access frequency (>80% / >50% thresholds)
- [ ] Pre-fetch injection into `buildInitialMessage()` as `## PRE-LOADED FILES`
- [ ] Stage-to-stage relay: planner tags memories with `planner_relay`, coder retrieves tagged
- [ ] Proactive gotcha injection at tool-result level for Read/Edit tools
- [ ] `task_calibration` memories from actual vs planned step ratios

**Validation**: Discovery tool calls drop from 20+ to <10 after 15 sessions on same project.

### Phase 4: Knowledge Graph
*Prerequisite: Phase 1 (can parallelize with Phase 2/3)*

- [ ] `graph_nodes`, `graph_edges`, `graph_closure` SQLite tables
- [ ] tree-sitter cold-start structural analysis (imports, exports, calls)
- [ ] Closure table pre-computation (run after each graph build)
- [ ] `analyzeImpactTool`, `getDependenciesTool` agent tools
- [ ] Memory ↔ Graph linking (`targetNodeId` on Memory, `associatedMemoryIds` on GraphNode)
- [ ] Diff-based incremental invalidation (`stale_at` column)
- [ ] ModuleMap auto-derivation from graph (replaces agent-populated ModuleMap)

**Validation**: `analyzeImpact('auth.ts')` returns correct transitive dependents within 100ms.

### Phase 5: Retrieval Innovations
*Prerequisite: Phase 1 + Phase 4*

- [ ] Causal chain retrieval (expand results via `observer_co_access_edges` weight > 0.6)
- [ ] HyDE search (activate when standard search returns <3 results above 0.5 confidence)
- [ ] Temporal search modes (`recent_sessions`, `time_window`, `around_event`, `trend`)
- [ ] Confidence propagation through typed relation edges
- [ ] `extractCausalChains()` weekly job (co-access weight > 0.7 → `causal_dependency` memory)

**Validation**: Search recall at top-5 improves by >20% vs V1 on a 200-memory test corpus.

### Phase 6: UX Trust Layer
*Prerequisite: Phase 1 + Phase 2 (for session-end data)*

- [ ] Health Dashboard as default Memory Panel view
- [ ] Session-end review modal (confirm/edit/reject per inferred memory)
- [ ] Memory card with provenance always visible
- [ ] Inline citation chips in agent terminal output
- [ ] Correction modal (4 radio options)
- [ ] `Cmd+Shift+M` global shortcut for Memory Panel
- [ ] `/remember` terminal command
- [ ] Flag-wrong affordance in memory card
- [ ] i18n: add all new keys to `en/*.json` and `fr/*.json`

**Validation**: User can flag a wrong memory and confirm it was deleted in <5 clicks.

---

## 14. Open Questions

### Architecture
1. **Observer placement**: Main thread (Team 1 recommendation, Option C) vs dedicated observer worker vs IPC handler. Main thread avoids worker comms but adds CPU load per event. Decision needed before Phase 2.

2. **Knowledge Graph build timing**: Cold-start build on project open (blocking) vs background build (eventual consistency) vs on-demand (first use). Background recommended but complicates first-session accuracy.

3. **HyDE cost**: Each low-recall search triggers a `generateText()` call. At ~150 tokens each, 10 searches/session = ~1500 extra tokens. Acceptable? Should we only enable for debugging/insights phases?

### Data & Privacy
4. **Observer training**: Co-access graph accumulates over many sessions. How do we handle file renames (git tracking) vs file content changes? Should we use git blame content hashes rather than file paths?

5. **Work-state decay**: 7-day half-life seems right but needs tuning. A spec that takes 3 weeks of sporadic work shouldn't lose its work state after 7 days. Should decay pause between sessions?

6. **Cloud privacy boundary**: When user opts for Convex backup, do we encrypt memory content client-side before upload? Embedding-only option (no raw text) reduces utility significantly.

### UX
7. **Session-end review cognitive load**: Reviewing 10 inferred memories after every session is unsustainable. Should we show only "high-stakes" inferred memories (confidence < 0.7 or `error_pattern` type) and auto-confirm the rest?

8. **Citation chips in terminal**: Terminal output is ANSI text. Citation chips require renderer-level post-processing. Do we post-process in `agent-events-handlers.ts` before passing to xterm, or add a custom xterm addon?

9. **ModuleMap clean cut**: V1's agent-populated ModuleMap is dropped entirely. V2 auto-derives the module view from the Knowledge Graph structural layer. No migration or carryover — fresh graph build on first V2 session. No backwards compatibility required.

### Performance
10. **sqlite-vec at scale**: Brute-force at 10K memories = ~50ms. At 50K memories (large long-running project) = ~500ms. Should we shard by project, or add HNSW indexing via `sqlite-vec` when it ships?

11. **Closure table rebuild cost**: Full rebuild is O(N²) in worst case. For large TypeScript codebases (1000+ files), this could take seconds. Should we use incremental closure maintenance instead?

---

*Document ends. Next action: review open questions with team, select Phase 1 for immediate implementation.*
