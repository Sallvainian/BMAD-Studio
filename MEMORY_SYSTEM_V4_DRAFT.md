# Memory System V4 — Definitive Design Document

> Built on: V3 Draft + Hackathon Teams 1–5
> Status: Pre-implementation design document
> Date: 2026-02-22

---

## Table of Contents

1. [Design Philosophy and Competitive Positioning](#1-design-philosophy-and-competitive-positioning)
2. [Architecture Overview](#2-architecture-overview)
3. [Memory Schema](#3-memory-schema)
4. [Memory Observer](#4-memory-observer)
5. [Scratchpad to Validated Promotion Pipeline](#5-scratchpad-to-validated-promotion-pipeline)
6. [Knowledge Graph](#6-knowledge-graph)
7. [Retrieval Engine](#7-retrieval-engine)
8. [Embedding Strategy](#8-embedding-strategy)
9. [Agent Loop Integration](#9-agent-loop-integration)
10. [Build Pipeline Integration](#10-build-pipeline-integration)
11. [Worker Thread Architecture and Concurrency](#11-worker-thread-architecture-and-concurrency)
12. [Cross-Session Pattern Synthesis](#12-cross-session-pattern-synthesis)
13. [UX and Developer Trust](#13-ux-and-developer-trust)
14. [Cloud Sync and Multi-Device](#14-cloud-sync-and-multi-device)
15. [Team and Organization Memories](#15-team-and-organization-memories)
16. [Privacy and Compliance](#16-privacy-and-compliance)
17. [SQLite Schema](#17-sqlite-schema)
18. [Memory Pruning and Lifecycle](#18-memory-pruning-and-lifecycle)
19. [A/B Testing and Metrics](#19-ab-testing-and-metrics)
20. [Implementation Plan](#20-implementation-plan)
21. [Open Questions](#21-open-questions)

---

## 1. Design Philosophy and Competitive Positioning

### Why Memory Is the Technical Moat

Auto Claude positions as "more control than Lovable, more automatic than Cursor or Claude Code." Memory is the primary mechanism that delivers on this promise. Every session without memory forces agents to rediscover the codebase from scratch — re-reading the same files, retrying the same failed approaches, hitting the same gotchas. With a well-designed memory system, agents navigate the codebase like senior developers who built it.

The accumulated value compounds over time:

```
Sessions 1-5:   Cold. Agent explores from scratch every session.
                High discovery cost. No patterns established.

Sessions 5-15:  Co-access graph built. Prefetch patterns emerging.
                Gotchas accumulating. ~30% reduction in redundant reads.

Sessions 15-30: Calibration active. QA failures no longer recur.
                Workflow recipes firing at planning time.
                Impact analysis preventing ripple bugs.
                ~60% reduction in discovery cost.

Sessions 30+:   The system knows this codebase. Agents navigate it
                like senior developers who built it. Context token
                savings measurable in the thousands per session.
```

### The Three-Tier Injection Model

V3 covered two tiers. V4 defines three, which is the complete model:

| Tier | When | Mechanism | Purpose |
|------|------|-----------|---------|
| Passive | Session start | System prompt + initial message injection | Global memories, module memories, workflow recipes, work state |
| Reactive | Mid-session, agent-requested | `search_memory` tool in agent toolset | On-demand retrieval when agent explicitly needs context |
| Active | Mid-session, system-initiated | `prepareStep` callback in `streamText()` | Proactive injection per step based on what agent just did |

The active tier is V4's key addition over V3. It enables the system to inject a `dead_end` memory the moment the agent reads the file it previously failed on — before the agent makes the same mistake — and to short-circuit redundant Grep queries by surfacing already-known answers.

### Observer-First Philosophy

The most valuable memories are never explicitly requested. They emerge from watching what the agent does — which files it reads together, which errors it retries, which edits it immediately reverts, which approaches it abandons. Explicit `remember_this` calls are supplementary, not primary. This is the behavioral observer's core thesis, and no competitor has implemented it.

### Competitive Gap Matrix

| Capability | Cursor | Windsurf | Copilot | Augment | Devin | Auto Claude V4 |
|---|---|---|---|---|---|---|
| Behavioral observation | No | Partial | No | No | No | Yes (17 signals) |
| Co-access graph | No | No | No | No | No | Yes |
| BM25 + semantic hybrid | Partial | No | No | Yes | No | Yes |
| Cross-encoder reranking | No | No | No | Unknown | No | Yes |
| Structured memory schema | No | No | No | Unknown | No | 15+ types |
| Phase-aware retrieval | No | No | No | No | No | Yes (6 phases) |
| Knowledge graph | No | No | No | No | No | Yes (3 layers) |
| Active prepareStep injection | No | No | No | No | No | Yes |
| Scratchpad-to-promotion gate | No | No | No | No | No | Yes |
| Trust progression system | No | No | No | No | No | Yes |
| Session-end user review | No | No | No | No | No | Yes |
| Memory citation chips | No | No | No | No | No | Yes |
| GDPR-compliant, local-first | Partial | No | No | No | No | Yes |

**Where Auto Claude uniquely wins:** Behavioral observation capturing co-access patterns, error-retry fingerprints, and backtrack sequences is unique in the market. No competitor watches what agents actually do and derives memory from behavior. This is the architectural moat that cannot be replicated by adding features — it requires redesigning the agent loop from the inside.

---

## 2. Architecture Overview

### System Layers Diagram

```
USER                 AGENT LOOP              MEMORY SYSTEM
 |                      |                         |
 |--task-request------->|                         |
 |                      |--session-start--------->|
 |                      |                    [T1: Passive Injection]
 |                      |<---system-prompt+msg----|
 |                      |                         |
 |                      |--streamText()---------->|
 |                      |   |                     |
 |                      |   |--tool-call--------->|
 |                      |   |              [MemoryObserver.observe()]
 |                      |   |<-tool-result+gotcha-|[T3: Tool-result augment]
 |                      |   |                     |
 |                      |   |--prepareStep------->|
 |                      |   |              [StepInjectionDecider]
 |                      |   |<-memory-injection---|[T4: Active injection]
 |                      |   |                     |
 |                      |   |--search_memory----->|[T2: Reactive retrieval]
 |                      |   |<-memories-----------|
 |                      |   |                     |
 |                      |<--session-end-----------|
 |                      |              [observer.finalize()]
 |                      |              [ScratchpadPromotion]
 |                      |              [CrossSessionSynthesis]
 |                      |              [EmbeddingGeneration]
 |<--session-end-summary|                         |
 |--user-review-------->|                         |
                        |--store-confirmed-------->|

BACKGROUND JOBS (async, not on critical path):
  KnowledgeGraphIndexer (tree-sitter, file watchers)
  CrossModuleSynthesis (weekly LLM call)
  EmbeddingMaintenance (model upgrade migration)
  MemoryPruningJob (daily decay + lifecycle)
```

### Component Interaction Diagram

```
                  ┌─────────────────────────────────────────┐
                  │           MEMORY SYSTEM                  │
                  │                                          │
  ┌───────────┐   │  ┌──────────┐    ┌───────────────────┐  │
  │  Agent    │   │  │ Memory   │    │  Knowledge Graph  │  │
  │  Worker   │<──│──│ Observer │    │  (3-layer SQLite) │  │
  │  Thread   │   │  │ (main    │    │                   │  │
  │           │──>│  │  thread) │    │  L1: Structural   │  │
  └───────────┘   │  │          │    │  L2: Semantic     │  │
      IPC         │  │Scratchpad│    │  L3: Knowledge    │  │
                  │  │  Store   │    └────────┬──────────┘  │
                  │  └────┬─────┘             │             │
                  │       │                   │             │
                  │  ┌────v─────────────────┐ │             │
                  │  │   Memory Service     │<┘             │
                  │  │   (main thread,      │               │
                  │  │    write proxy)      │               │
                  │  └────┬─────────────────┘               │
                  │       │                                 │
                  │  ┌────v─────────────────────────────┐   │
                  │  │         SQLite (memory.db)        │   │
                  │  │  memories | embeddings | graph    │   │
                  │  │  observer | fts5 | scip_symbols   │   │
                  │  │  embedding_cache | synthesis_log  │   │
                  │  └──────────────────────────────────┘   │
                  └─────────────────────────────────────────┘
```

### Technology Decisions

- **Storage**: SQLite with WAL mode, `sqlite-vec` extension for vector similarity, FTS5 for BM25 search
- **Embeddings**: `qwen3-embedding:4b` via Ollama (primary), Voyage 4 (API fallback), bundled ONNX model (zero-config fallback)
- **Knowledge Graph**: SQLite closure tables (incremental, Glean-style staleness model). Migration to Kuzu when project exceeds 50K nodes or 500MB or P99 query latency exceeds 100ms
- **Parsing**: tree-sitter WASM grammars via `web-tree-sitter` — no native rebuild required on Electron version updates
- **AI operations**: Vercel AI SDK v6 `generateText()` for batch synthesis (not streaming — synthesis is offline). `streamText()` with `prepareStep` for active injection
- **Thread model**: `worker_threads` for agent execution; all SQLite writes through main thread proxy (WAL allows concurrent reads)
- **Graphiti**: Python MCP sidecar (permanent — not replaced). Connected via `@ai-sdk/mcp` `createMCPClient`. Memory system and Graphiti are complementary: Graphiti provides entity-relationship graph over conversations; Memory System provides behavioral pattern memory from agent actions

---

## 3. Memory Schema

### Core Memory Interface

```typescript
// apps/frontend/src/main/ai/memory/types.ts

interface Memory {
  id: string;                           // UUID
  type: MemoryType;
  content: string;
  confidence: number;                   // 0.0 - 1.0
  tags: string[];
  relatedFiles: string[];
  relatedModules: string[];
  createdAt: string;                    // ISO 8601
  lastAccessedAt: string;
  accessCount: number;

  // Work unit reference (replaces specNumber from V1/V2)
  workUnitRef?: WorkUnitRef;
  scope: MemoryScope;

  // Provenance
  source: MemorySource;
  sessionId: string;
  commitSha?: string;                   // Git commit that produced this memory
  provenanceSessionIds: string[];       // Sessions that confirmed/reinforced

  // Knowledge graph link
  targetNodeId?: string;
  impactedNodeIds?: string[];

  // Relations
  relations?: MemoryRelation[];

  // Decay
  decayHalfLifeDays?: number;           // Override default per type

  // Trust
  needsReview?: boolean;
  userVerified?: boolean;
  citationText?: string;               // Short form for inline citation chips (max 40 chars)
  pinned?: boolean;                    // Pinned memories never decay

  // Methodology plugin
  methodology?: string;                // Which plugin created this (for cross-plugin retrieval)
}

type MemoryType =
  // Core — all methodologies
  | 'gotcha'            // Trap or non-obvious constraint in the codebase
  | 'decision'          // Architectural or implementation decision with rationale
  | 'preference'        // User or project coding preference
  | 'pattern'           // Reusable implementation pattern that works here
  | 'requirement'       // Functional or non-functional requirement
  | 'error_pattern'     // Recurring error and its fix
  | 'module_insight'    // Understanding about a module's purpose or behavior

  // Active loop
  | 'prefetch_pattern'  // Files always/frequently read together → pre-load
  | 'work_state'        // Partial work snapshot for cross-session continuity
  | 'causal_dependency' // File A must be touched when file B is touched
  | 'task_calibration'  // Actual vs planned step ratio per module

  // V3 additions
  | 'e2e_observation'   // UI behavioral fact observed via MCP tool use
  | 'dead_end'          // Strategic approach tried and abandoned — do not retry
  | 'work_unit_outcome' // Per work-unit result: files, decisions, success/failure
  | 'workflow_recipe'   // Step-by-step procedural map for a class of task
  | 'context_cost';     // Token consumption profile for a module

type MemorySource =
  | 'agent_explicit'    // Agent called record_memory
  | 'observer_inferred' // MemoryObserver derived from behavioral signals
  | 'qa_auto'           // Auto-extracted from QA report failures
  | 'mcp_auto'          // Auto-extracted from MCP (Electron) tool results
  | 'commit_auto'       // Auto-tagged at git commit time
  | 'user_taught';      // User typed /remember or used Teach panel

type MemoryScope = 'global' | 'module' | 'work_unit' | 'session';

interface WorkUnitRef {
  methodology: string;      // 'native' | 'bmad' | 'tdd' | 'agile'
  hierarchy: string[];      // e.g. ['spec_042', 'subtask_3']
  label: string;            // "Spec 042 / Subtask 3"
}

type UniversalPhase =
  | 'define'     // Planning, spec creation, writing failing tests (TDD red)
  | 'implement'  // Coding, development, making tests pass (TDD green)
  | 'validate'   // QA, acceptance criteria, E2E testing
  | 'refine'     // Refactoring, cleanup, fixing QA issues
  | 'explore'    // Research, insights, discovery
  | 'reflect';   // Session wrap-up, learning capture

interface MemoryRelation {
  targetMemoryId?: string;
  targetFilePath?: string;
  relationType: 'required_with' | 'conflicts_with' | 'validates' | 'supersedes' | 'derived_from';
  confidence: number;
  autoExtracted: boolean;
}
```

### Extended Memory Types

```typescript
interface WorkflowRecipe extends Memory {
  type: 'workflow_recipe';
  taskPattern: string;        // "adding a new IPC handler"
  steps: Array<{
    order: number;
    description: string;
    canonicalFile?: string;
    canonicalLine?: number;
  }>;
  lastValidatedAt: string;
  successCount: number;
  scope: 'global';
}

interface DeadEndMemory extends Memory {
  type: 'dead_end';
  approachTried: string;
  whyItFailed: string;
  alternativeUsed: string;
  taskContext: string;
  decayHalfLifeDays: 90;     // Long-lived — dead ends stay relevant
}

interface WorkUnitOutcome extends Memory {
  type: 'work_unit_outcome';
  workUnitRef: WorkUnitRef;
  succeeded: boolean;
  filesModified: string[];
  keyDecisions: string[];
  stepsTaken: number;
  contextTokensUsed?: number;
  retryCount: number;
  failureReason?: string;
}

interface E2EObservation extends Memory {
  type: 'e2e_observation';
  observationType: 'precondition' | 'timing' | 'ui_behavior' | 'test_sequence' | 'mcp_gotcha';
  mcpToolUsed: string;
  appState?: string;
}

interface PrefetchPattern extends Memory {
  type: 'prefetch_pattern';
  alwaysReadFiles: string[];       // >80% session coverage
  frequentlyReadFiles: string[];   // >50% session coverage
  moduleTrigger: string;
  sessionCount: number;
  scope: 'module';
}

interface TaskCalibration extends Memory {
  type: 'task_calibration';
  module: string;
  methodology: string;
  averageActualSteps: number;
  averagePlannedSteps: number;
  ratio: number;
  sampleCount: number;
}

interface ContextCostMemory extends Memory {
  type: 'context_cost';
  module: string;
  averageTokensPerSession: number;
  p90TokensPerSession: number;
  sampleCount: number;
  scope: 'module';
}
```

### Methodology Abstraction Layer

All methodology phases map into six `UniversalPhase` values. The retrieval engine and `PHASE_WEIGHTS` operate exclusively on `UniversalPhase`.

```typescript
interface MemoryMethodologyPlugin {
  id: string;
  displayName: string;

  mapPhase(methodologyPhase: string): UniversalPhase;
  resolveWorkUnitRef(context: ExecutionContext): WorkUnitRef;
  getRelayTransitions(): RelayTransition[];
  formatRelayContext(memories: Memory[], toStage: string): string;
  extractWorkState(sessionOutput: string): Promise<Record<string, unknown>>;
  formatWorkStateContext(state: Record<string, unknown>): string;
  customMemoryTypes?: MemoryTypeDefinition[];
  onWorkUnitComplete?(ctx: ExecutionContext, result: WorkUnitResult, svc: MemoryService): Promise<void>;
}

// Native plugin (current default)
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
    label: ctx.subtaskId
      ? `Spec ${ctx.specNumber} / Subtask ${ctx.subtaskId}`
      : `Spec ${ctx.specNumber}`,
  }),
  getRelayTransitions: () => [
    { from: 'planner', to: 'coder' },
    { from: 'coder', to: 'qa_reviewer' },
    { from: 'qa_reviewer', to: 'qa_fixer', filter: { types: ['error_pattern', 'requirement'] } },
  ],
  // extractWorkState and formatWorkStateContext implementations omitted for brevity
};
```

---

## 4. Memory Observer

The Observer is the passive behavioral layer. It runs on the main thread, tapping every `postMessage` event from worker threads. It never writes to the database during execution — all accumulation stays in the scratchpad until validation passes.

### 17-Signal Taxonomy with Priority Scoring

Signal value uses the formula: `signal_value = (diagnostic_value × 0.5) + (cross_session_relevance × 0.3) + (1.0 - false_positive_rate) × 0.2`

Signals with `signal_value < 0.4` are discarded before promotion filtering.

| # | Signal Class | Score | Promotes To | Min Sessions | Notes |
|---|-------------|-------|-------------|-------------|-------|
| 2 | Co-Access Graph | 0.91 | causal_dependency, prefetch_pattern | 3 | Captures runtime coupling invisible to static analysis |
| 9 | Self-Correction | 0.88 | gotcha, module_insight | 1 | Agent reasoning "I was wrong about..." — highest ROI |
| 3 | Error-Retry | 0.85 | error_pattern, gotcha | 2 | Normalize error strings; use `errorFingerprint` hash |
| 16 | Parallel Conflict | 0.82 | gotcha | 1 | Files that conflict across parallel subagents |
| 5 | Read-Abandon | 0.79 | gotcha | 3 | Agent reads file repeatedly but never edits it |
| 6 | Repeated Grep | 0.76 | module_insight, gotcha | 2 | Same grep query run 2+ times = confusion |
| 13 | Test Order | 0.74 | task_calibration | 3 | Tests read before or after implement |
| 7 | Tool Sequence | 0.73 | workflow_recipe | 3 | Repeated N-step tool sequences |
| 1 | File Access | 0.72 | prefetch_pattern | 3 | Sessions accessing file early and consistently |
| 15 | Step Overrun | 0.71 | task_calibration | 3 | actualSteps / plannedSteps > 1.2 |
| 4 | Backtrack | 0.68 | gotcha | 2 | Re-edit within 20 steps of original edit |
| 14 | Config Touch | 0.66 | causal_dependency | 2 | package.json, tsconfig, vite, .env |
| 11 | Glob-Ignore | 0.64 | gotcha | 2 | Results returned but < 10% were read |
| 17 | Context Token Spike | 0.63 | context_cost | 3 | tokensUsed / filesRead >> average |
| 10 | External Reference | 0.61 | module_insight | 3 | WebSearch/WebFetch followed by edit |
| 12 | Import Chase | 0.52 | causal_dependency | 4 | Agent reads file then reads files it imports |
| 8 | Time Anomaly | 0.48 | (with correlation) | 3 | Only valuable when correlates with error or backtrack |

### Signal Interfaces (Key Examples)

```typescript
type SignalType =
  | 'file_access' | 'co_access' | 'error_retry' | 'backtrack'
  | 'read_abandon' | 'repeated_grep' | 'sequence' | 'time_anomaly'
  | 'self_correction' | 'external_reference' | 'glob_ignore'
  | 'import_chase' | 'test_order' | 'config_touch' | 'step_overrun'
  | 'parallel_conflict' | 'context_token_spike';

interface CoAccessSignal {
  type: 'co_access';
  fileA: string;
  fileB: string;
  timeDeltaMs: number;
  stepDelta: number;
  sessionId: string;
  directional: boolean;
  taskTypes: string[];     // Cross-task-type co-access is more valuable
}

interface SelfCorrectionSignal {
  type: 'self_correction';
  triggeringText: string;
  correctionType: 'factual' | 'approach' | 'api' | 'config' | 'path';
  confidence: number;
  correctedAssumption: string;
  actualFact: string;
  relatedFile?: string;
}

// Detection patterns for self-correction
const SELF_CORRECTION_PATTERNS = [
  /I was wrong about (.+?)\. (.+?) is actually/i,
  /Let me reconsider[.:]? (.+)/i,
  /Actually,? (.+?) (not|instead of|rather than) (.+)/i,
  /I initially thought (.+?) but (.+)/i,
  /Correction: (.+)/i,
  /Wait[,.]? (.+)/i,
];

interface ErrorRetrySignal {
  type: 'error_retry';
  toolName: string;
  errorMessage: string;
  errorFingerprint: string;  // hash(errorType + normalizedContext)
  retryCount: number;
  resolvedHow?: string;
  stepsToResolve: number;
}
```

### Trust Defense Layer (Anti-Injection)

Inspired by the Windsurf SpAIware exploit. Any signal derived from agent output produced after a WebFetch or WebSearch call is flagged as potentially tainted:

```typescript
function applyTrustGate(
  candidate: MemoryCandidate,
  externalToolCallStep: number | undefined,
): MemoryCandidate {
  if (externalToolCallStep !== undefined && candidate.originatingStep > externalToolCallStep) {
    return {
      ...candidate,
      needsReview: true,
      confidence: candidate.confidence * 0.7,
      trustFlags: { contaminated: true, contaminationSource: 'web_fetch' },
    };
  }
  return candidate;
}
```

### Performance Budget

| Resource | Hard Limit | Enforcement |
|---------|-----------|-------------|
| CPU per event (ingest) | 2ms | `process.hrtime.bigint()` measurement; logged if exceeded, never throw |
| CPU for finalize (non-LLM) | 100ms | Budget tracked; abort if exceeded |
| Scratchpad resident memory | 50MB | Pre-allocated buffers; evict low-value signals on overflow |
| LLM synthesis calls per session | 1 max | Counter enforced in `finalize()` |
| Memories promoted per session | 20 (build), 5 (insights), 3 (others) | Hard cap |
| DB writes per session | 1 batched transaction after finalize | No writes during execution |

Eviction priority (lowest value evicted first): `time_anomaly` > `file_access` > `sequence` > `co_access`. Self-correction and parallel_conflict signals are never evicted.

### Supporting Types for Observer

```typescript
// Outcome of a session — determines whether full promotion runs or only dead-end filter
type SessionOutcome = 'success' | 'failure' | 'partial' | 'cancelled';

// A high-priority candidate detected in-session (before finalize)
interface AcuteCandidate {
  signalType: SignalType;
  originatingStep: number;
  rawText: string;
  priority: number;
  externalToolCallStep: number | undefined;
}

// A memory candidate ready for promotion (output of finalize)
interface MemoryCandidate {
  signalType: SignalType;
  proposedType: MemoryType;
  content: string;
  confidence: number;
  relatedFiles: string[];
  priority: number;
  needsReview: boolean;
  trustFlags?: { contaminated: boolean; contaminationSource: string };
}

// Maximum memories promoted per session type (enforced in finalize)
const SESSION_TYPE_PROMOTION_LIMITS: Record<SessionType, number> = {
  build: 20,
  insights: 5,
  roadmap: 3,
  terminal: 3,
  changelog: 0,
  spec_creation: 3,
  pr_review: 8,
};
```

### MemoryObserver Class Interface

The observer lives entirely on the main thread. Worker threads never call the observer directly — all communication goes through `WorkerBridge.onMessage()`.

```typescript
export class MemoryObserver {
  private readonly scratchpad: Scratchpad;
  private readonly memoryService: MemoryService;
  private externalToolCallStep: number | undefined = undefined;

  constructor(
    sessionId: string,
    sessionType: SessionType,
    projectId: string,
    memoryService: MemoryService,
  ) {
    this.scratchpad = createScratchpad(sessionId, sessionType);
    this.memoryService = memoryService;
  }

  /**
   * Called for every IPC message from the worker thread.
   * MUST complete in < 2ms. Never awaits. Never accesses DB.
   */
  observe(message: MemoryIpcRequest): void {
    const start = process.hrtime.bigint();

    switch (message.type) {
      case 'memory:tool-call':
        this.onToolCall(message);
        break;
      case 'memory:tool-result':
        this.onToolResult(message);
        break;
      case 'memory:reasoning':
        this.onReasoning(message);
        break;
      case 'memory:step-complete':
        this.onStepComplete(message.stepNumber);
        break;
    }

    const elapsed = Number(process.hrtime.bigint() - start) / 1_000_000;
    if (elapsed > 2) {
      // Log budget exceeded but NEVER throw — observer must never block agent
      logger.warn(`[MemoryObserver] observe() budget exceeded: ${elapsed.toFixed(2)}ms for ${message.type}`);
    }
  }

  private onToolCall(msg: { toolName: string; args: Record<string, unknown>; stepIndex: number }): void {
    this.scratchpad.analytics.currentStep = msg.stepIndex;
    this.scratchpad.analytics.recentToolSequence.push(msg.toolName);

    // Track config file access for config_touch signal
    if (msg.toolName === 'Read' || msg.toolName === 'Edit' || msg.toolName === 'Write') {
      const filePath = msg.args['file_path'] as string | undefined;
      if (filePath && isConfigFile(filePath)) {
        this.scratchpad.analytics.configFilesTouched.add(filePath);
      }
      if (filePath) {
        const count = this.scratchpad.analytics.fileAccessCounts.get(filePath) ?? 0;
        this.scratchpad.analytics.fileAccessCounts.set(filePath, count + 1);
        if (!this.scratchpad.analytics.fileFirstAccess.has(filePath)) {
          this.scratchpad.analytics.fileFirstAccess.set(filePath, msg.stepIndex);
        }
        this.scratchpad.analytics.fileLastAccess.set(filePath, msg.stepIndex);
      }
    }

    // Mark external tool calls — all subsequent signals tainted until human review
    if (msg.toolName === 'WebFetch' || msg.toolName === 'WebSearch') {
      this.externalToolCallStep = msg.stepIndex;
    }

    if (msg.toolName === 'Grep') {
      const pattern = msg.args['pattern'] as string | undefined;
      if (pattern) {
        const count = this.scratchpad.analytics.grepPatternCounts.get(pattern) ?? 0;
        this.scratchpad.analytics.grepPatternCounts.set(pattern, count + 1);
      }
    }
  }

  private onToolResult(msg: { toolName: string; result: string; isError: boolean; stepIndex: number }): void {
    if (msg.isError && msg.toolName === 'Bash') {
      const fingerprint = computeErrorFingerprint(msg.result);
      const count = this.scratchpad.analytics.errorFingerprints.get(fingerprint) ?? 0;
      this.scratchpad.analytics.errorFingerprints.set(fingerprint, count + 1);
    }
    if (msg.toolName === 'Edit' || msg.toolName === 'Write') {
      const args = msg as unknown as { args: { file_path?: string } };
      if (args.args?.file_path) {
        this.scratchpad.analytics.fileEditSet.add(args.args.file_path);
      }
    }
  }

  private onReasoning(msg: { text: string; stepIndex: number }): void {
    for (const pattern of SELF_CORRECTION_PATTERNS) {
      if (pattern.test(msg.text)) {
        this.scratchpad.analytics.selfCorrectionCount++;
        this.scratchpad.analytics.lastSelfCorrectionStep = msg.stepIndex;

        const candidate: AcuteCandidate = {
          signalType: 'self_correction',
          originatingStep: msg.stepIndex,
          rawText: msg.text,
          priority: 0.88,
          externalToolCallStep: this.externalToolCallStep,
        };
        this.scratchpad.acuteCandidates.push(candidate);
        break; // Only capture first matching pattern per reasoning chunk
      }
    }
  }

  private onStepComplete(stepNumber: number): void {
    // Check co-access: files accessed within the same 5-step window
    this.detectCoAccess(stepNumber);
  }

  private detectCoAccess(currentStep: number): void {
    const WINDOW = 5;
    const recentFiles = [...this.scratchpad.analytics.fileLastAccess.entries()]
      .filter(([, step]) => currentStep - step <= WINDOW)
      .map(([file]) => file);

    for (let i = 0; i < recentFiles.length; i++) {
      for (let j = i + 1; j < recentFiles.length; j++) {
        const existing = this.scratchpad.analytics.intraSessionCoAccess.get(recentFiles[i]);
        if (existing) {
          existing.add(recentFiles[j]);
        } else {
          this.scratchpad.analytics.intraSessionCoAccess.set(recentFiles[i], new Set([recentFiles[j]]));
        }
      }
    }
  }

  /**
   * Called after session ends and (for build sessions) after QA passes.
   * Runs non-LLM signal analysis synchronously, then optionally fires one
   * LLM synthesis call via generateText().
   * Returns candidate memories for the session-end summary panel.
   */
  async finalize(outcome: SessionOutcome): Promise<MemoryCandidate[]> {
    const candidates: MemoryCandidate[] = [];

    // Collect candidates from all signal types
    candidates.push(...this.finalizeCoAccess());
    candidates.push(...this.finalizeErrorRetry());
    candidates.push(...this.finalizeAcuteCandidates());
    candidates.push(...this.finalizeRepeatedGrep());
    candidates.push(...this.finalizeSequences());

    // Apply trust gate to any tainted candidates
    const gated = candidates.map(c => applyTrustGate(c, this.externalToolCallStep));

    // Apply session-type gate (max promotions per type)
    const gateLimit = SESSION_TYPE_PROMOTION_LIMITS[this.scratchpad.sessionType];
    const filtered = gated
      .sort((a, b) => b.priority - a.priority)
      .slice(0, gateLimit);

    // Optional LLM synthesis call for co-access and sequence patterns
    if (outcome === 'success' && filtered.some(c => c.signalType === 'co_access')) {
      const synthesized = await this.synthesizeWithLLM(filtered);
      filtered.push(...synthesized);
    }

    return filtered;
  }

  // Synthesis and per-signal finalize methods are detailed in Section 5
  private finalizeCoAccess(): MemoryCandidate[] { return []; /* Phase 1 implementation */ }
  private finalizeErrorRetry(): MemoryCandidate[] { return []; }
  private finalizeAcuteCandidates(): MemoryCandidate[] { return [...this.scratchpad.acuteCandidates]; }
  private finalizeRepeatedGrep(): MemoryCandidate[] { return []; }
  private finalizeSequences(): MemoryCandidate[] { return []; }
  private async synthesizeWithLLM(_candidates: MemoryCandidate[]): Promise<MemoryCandidate[]> { return []; }
}
```

The `observe()` method is the hot path — it is called for every single IPC message during agent execution. The 2ms budget is enforced with measurement but never with exceptions. If the observer falls behind, signals are dropped (eviction), not the agent. This is the cardinal rule: the agent loop is always the priority.

---

## 5. Scratchpad to Validated Promotion Pipeline

### Scratchpad 2.0 — Intelligent In-Session Analysis

The scratchpad is not a passive buffer. It runs O(1)-per-event analytics using pre-allocated data structures. No LLM, no embeddings, no database queries during execution.

```typescript
interface Scratchpad {
  sessionId: string;
  sessionType: SessionType;
  startedAt: number;

  // Signal buffers (capped at MAX_SIGNALS_PER_TYPE)
  signals: Map<SignalType, ObserverSignal[]>;

  // Lightweight in-memory analytics (updated incrementally, O(1) per event)
  analytics: ScratchpadAnalytics;

  // High-priority candidates detected in-session
  acuteCandidates: AcuteCandidate[];
}

interface ScratchpadAnalytics {
  fileAccessCounts: Map<string, number>;
  fileFirstAccess: Map<string, number>;
  fileLastAccess: Map<string, number>;
  fileEditSet: Set<string>;

  grepPatternCounts: Map<string, number>;
  grepPatternResults: Map<string, boolean[]>;

  errorFingerprints: Map<string, number>;

  currentStep: number;
  recentToolSequence: CircularBuffer<string>;   // last 8 tool calls
  intraSessionCoAccess: Map<string, Set<string>>; // O(k) per event where k=5

  configFilesTouched: Set<string>;
  selfCorrectionCount: number;
  lastSelfCorrectionStep: number;

  totalInputTokens: number;
  peakContextTokens: number;
}
```

### In-Session Early Promotion Triggers

These conditions stage candidates for priority processing during `finalize()`:

```typescript
const EARLY_TRIGGERS = [
  { condition: (a: ScratchpadAnalytics) => a.selfCorrectionCount >= 1, signalType: 'self_correction', priority: 0.9 },
  { condition: (a) => [...a.grepPatternCounts.values()].some(c => c >= 3), signalType: 'repeated_grep', priority: 0.8 },
  { condition: (a) => a.configFilesTouched.size > 0 && a.fileEditSet.size >= 2, signalType: 'config_touch', priority: 0.7 },
  { condition: (a) => a.errorFingerprints.size >= 2, signalType: 'error_retry', priority: 0.75 },
  { condition: (a) => a.selfCorrectionCount >= 3, signalType: 'self_correction', priority: 0.95 }, // High priority at volume
];
```

### Promotion Gates by Session Type

V3 only promoted after QA passes (covering ~30% of sessions). V4 covers all 7 session types:

| Session Type | Gate Trigger | Max Memories | Requires User Review | Primary Signals |
|---|---|---|---|---|
| Build (full pipeline) | QA passes | 20 | No (high confidence) | All 17 signals |
| Insights | Session end | 5 | Yes | co_access, self_correction, repeated_grep |
| Roadmap | Session end | 3 | Yes (decisions only) | decision, requirement |
| Terminal (agent terminal) | Session end | 3 | Yes | error_retry, sequence |
| Changelog | Skip | 0 | N/A | None (low memory value) |
| Spec Creation | Spec accepted | 3 | No (low confidence) | file_access, module_insight |
| PR Review | Review completed | 8 | No (review context) | error_retry, self_correction |

### Dead-End Promotion Filter

Before discarding a failed build's scratchpad, check for dead-end candidates:

```typescript
function shouldPromoteAsDeadEnd(signal: BacktrackSignal, ctx: SessionObserverContext): boolean {
  // Must have explored the approach for at least 20 steps before abandoning
  if (signal.reEditedWithinSteps < 20) return false;

  // Check for high divergence in file access post-backtrack vs pre-backtrack
  const preBranchFiles = ctx.getFilesAccessedBefore(signal);
  const postBranchFiles = ctx.getFilesAccessedAfter(signal);
  const overlap = setIntersection(preBranchFiles, postBranchFiles).size;
  const divergence = 1 - overlap / Math.max(preBranchFiles.size, postBranchFiles.size);

  return divergence > 0.6;
}
```

Dead-end reasoning detection from agent text stream:

```typescript
const DEAD_END_LANGUAGE_PATTERNS = [
  /this approach (won't|will not|cannot) work/i,
  /I need to abandon this/i,
  /let me try a different approach/i,
  /unavailable in (test|ci|production)/i,
  /not available in this environment/i,
];
```

### Promotion Filter Pipeline

After gate rules apply, candidates pass through:

1. **Validation filter**: discard signals from failed approaches (unless they become `dead_end` candidates)
2. **Frequency filter**: require minimum sessions per signal class (see taxonomy table)
3. **Novelty filter**: cosine similarity > 0.88 to existing memory = discard
4. **Trust gate**: apply contamination check for post-external-tool signals
5. **Scoring**: compute final confidence from signal priority + session count + source trust multiplier
6. **LLM synthesis**: single `generateText()` call to synthesize raw signal data into 1-3 sentence memory content (max 10-20 candidates → 0-5 memories output)
7. **Embedding generation**: generate embeddings for all promoted memories in one batch call
8. **DB write**: single transaction writes all promoted memories

### Scratchpad Checkpointing (LangGraph Lesson)

At each subtask boundary in a multi-subtask build, checkpoint the scratchpad to disk:

```typescript
// At each subtask boundary:
await scratchpadStore.checkpoint(workUnitRef, sessionId);
// On Electron restart mid-build: restore from checkpoint and continue
```

This prevents losing scratchpad state if the Electron process crashes during a 40-subtask pipeline.

### Incremental Promotion for Large Pipelines

For builds with more than 5 subtasks, promote scratchpad notes after each validated subtask rather than waiting for the full pipeline. This prevents scratchpad bloat and provides earlier signal to subsequent subtasks.

---

## 6. Knowledge Graph

### Three-Layer Architecture

```
LAYER 3: KNOWLEDGE (agent-discovered + LLM-analyzed)
+----------------------------------------------------------+
|  [Pattern: Repository]    [Decision: JWT over sessions]  |
|       | applies_pattern        | documents               |
|       v                        v                         |
|  [Module: auth]          [Function: verifyJwt()]         |
+----------------------------------------------------------+
         | is_entrypoint_for
LAYER 2: SEMANTIC (LLM-derived module relationships)
+----------------------------------------------------------+
|  [Module: auth]  --is_entrypoint_for-->  [routes/auth.ts]|
|  [Fn: login()] --flows_to--> [Fn: validateCreds()]       |
+----------------------------------------------------------+
         | calls/imports/defines_in
LAYER 1: STRUCTURAL (AST-extracted via tree-sitter)
+----------------------------------------------------------+
|  [File: routes/auth.ts]                                  |
|       | imports                                          |
|       v                                                  |
|  [File: middleware/auth.ts] --calls--> [Fn: verifyJwt()] |
+----------------------------------------------------------+
```

Layer 1 is computed from code — fast, accurate, automatically maintained via file watchers.
Layer 2 is computed by LLM analysis of Layer 1 subgraphs — scheduled asynchronously.
Layer 3 accumulates from agent sessions and user input — continuous, incremental.

### Node and Edge Types

```typescript
type NodeType =
  // Structural
  | "file" | "directory" | "module" | "function" | "class"
  | "interface" | "type_alias" | "variable" | "enum" | "package"
  // Concept (agent-discovered)
  | "pattern" | "dataflow" | "invariant" | "decision";

type EdgeType =
  // Layer 1: Structural (AST-derived)
  | "imports" | "imports_symbol" | "calls" | "calls_external"
  | "implements" | "extends" | "overrides" | "instantiates"
  | "exports" | "defined_in" | "childof" | "typed_as" | "tested_by"
  // Layer 2: Semantic (LLM-derived)
  | "depends_logically" | "is_entrypoint_for" | "handles_errors_from"
  | "owns_data_for" | "applies_pattern" | "flows_to"
  // Layer 3: Knowledge (agent or user)
  | "is_impact_of" | "documents" | "violates" | "supersedes";

interface GraphNode {
  id: string;
  projectId: string;
  type: NodeType;
  label: string;
  filePath?: string;
  language?: string;
  startLine?: number;
  endLine?: number;
  layer: 1 | 2 | 3;
  source: "ast" | "compiler" | "scip" | "llm" | "agent" | "user";
  confidence: "inferred" | "verified" | "agent-confirmed";
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  staleAt: number | null;    // Glean-style: set when source file changes
  lastAnalyzedAt?: number;
  associatedMemoryIds: string[];
}

interface GraphEdge {
  id: string;
  projectId: string;
  fromId: string;
  toId: string;
  type: EdgeType;
  layer: 1 | 2 | 3;
  weight: number;
  source: "ast" | "compiler" | "scip" | "llm" | "agent" | "user";
  confidence: number;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  staleAt: number | null;
}
```

### tree-sitter WASM Integration

tree-sitter is the correct choice for Electron: no native rebuild required on Electron updates, <5ms incremental re-parse on edits, architecture-independent WASM binaries.

```typescript
// apps/frontend/src/main/ai/graph/parser/tree-sitter-loader.ts
import Parser from 'web-tree-sitter';
import { app } from 'electron';
import { join } from 'path';

const GRAMMAR_PATHS: Record<string, string> = {
  typescript:  'tree-sitter-typescript.wasm',
  tsx:         'tree-sitter-tsx.wasm',
  python:      'tree-sitter-python.wasm',
  rust:        'tree-sitter-rust.wasm',
  go:          'tree-sitter-go.wasm',
  java:        'tree-sitter-java.wasm',
  javascript:  'tree-sitter-javascript.wasm',
};

export class TreeSitterLoader {
  private static instance: TreeSitterLoader | null = null;

  static getInstance(): TreeSitterLoader {
    if (!this.instance) this.instance = new TreeSitterLoader();
    return this.instance;
  }

  private getWasmDir(): string {
    return app.isPackaged
      ? join(process.resourcesPath, 'grammars')
      : join(__dirname, '..', '..', '..', '..', 'node_modules', 'tree-sitter-wasms');
  }

  async initialize(): Promise<void> {
    await Parser.init({ locateFile: (f) => join(this.getWasmDir(), f) });
  }

  async loadGrammar(lang: string): Promise<Parser.Language | null> {
    const wasmFile = GRAMMAR_PATHS[lang];
    if (!wasmFile) return null;
    return Parser.Language.load(join(this.getWasmDir(), wasmFile));
  }
}
```

Grammar load time: ~50ms per grammar. Default bundle: TypeScript + JavaScript + Python + Rust (~20MB added to packaged app).

**Cold-start indexing performance:**

| Project size | Duration |
|---|---|
| < 100 files | 5-10 seconds (background) |
| 100-500 files | 30-60 seconds (background, progressive) |
| 500-2000 files | 2-5 minutes (background) |
| 2000+ files | 10-20 minutes (one-time; use lazy closure for >3 hops) |

### SCIP Integration Path

For TypeScript projects, run `npx scip-typescript index` as a background subprocess at project open. Parse the protobuf output into `graph_nodes` and `graph_edges` rows. This provides VS Code-level go-to-definition accuracy without implementing the TypeScript compiler API ourselves.

```typescript
// Triggered once at project open if scip-typescript is available
async function runSCIPIndexer(projectRoot: string): Promise<void> {
  const scipOutput = await execa('npx', ['scip-typescript', 'index', '--output', 'index.scip'], {
    cwd: projectRoot,
  });
  await parseSCIPIntoGraph(scipOutput, projectRoot);
}
```

SCIP symbols stored in `scip_symbols` table with `node_id` links for precise cross-reference lookup.

### Impact Analysis

Pre-computed closure table enables O(1) "what breaks if I change X?" queries:

```typescript
// Agent tool call:
analyzeImpact({ target: "auth/tokens.ts:verifyJwt", maxDepth: 3 })

// SQL query (using closure table):
// SELECT descendant_id, depth, path, total_weight
// FROM graph_closure
// WHERE ancestor_id = ? AND depth <= 3
// ORDER BY depth, total_weight DESC

// Response includes: direct callers, transitive callers, test files, memories
```

### Staleness Model (Glean-Inspired)

When a source file changes, immediately mark all edges originating from it as stale (`stale_at = NOW()`). Re-index asynchronously. Agents always query with `WHERE stale_at IS NULL`. No agent ever sees stale + fresh edges for the same node simultaneously.

```typescript
// IncrementalIndexer file watcher debounce: 500ms
// On change: markFileEdgesStale(filePath) → rebuildEdges(filePath) → updateClosure()
```

### Kuzu Migration Threshold

Migrate from SQLite closure tables to Kuzu graph database when the project exceeds any of:
- 50,000 graph nodes
- 500MB SQLite database size
- P99 graph query latency > 100ms

Auto-detect during background health check and surface migration UI to user.

### Module Boundary Detection

Use Louvain community detection on the import graph to auto-detect module boundaries when the user has not explicitly defined them. Modules are the unit for memory scoping, co-access analysis, and coverage reporting.

---

## 7. Retrieval Engine

### Four-Stage Pipeline

```
Stage 1: CANDIDATE GENERATION (broad, high recall)
   - BM25 keyword retrieval via SQLite FTS5 (top-100)
   - Dense vector search via sqlite-vec, 256-dim MRL (top-100)
   - File-scoped retrieval: all memories tagged to recently-accessed file
   - Reciprocal Rank Fusion to merge ranked lists

Stage 2: FILTERING (rule-based, milliseconds)
   - Phase filter: PHASE_WEIGHTS[phase][type] threshold >= 0.3
   - Staleness filter: memories past half-life are penalized, not excluded
   - Confidence filter: minConfidence threshold (0.4 default, 0.65 for proactive)
   - Dedup: cosine similarity > 0.95 between two candidates → keep higher-scored

Stage 3: RERANKING (expensive, top-50 only)
   - Phase-aware scoring: full 1024-dim cosine + recency + frequency
   - Cross-encoder reranker (Qwen3-Reranker-0.6B via Ollama)
   - Causal chain expansion: add causally linked memories for selected top results
   - Graph-augmented expansion: add memories for files strongly linked in graph
   - HyDE fallback: if < 3 results above 0.5 confidence, generate hypothetical example

Stage 4: CONTEXT PACKING (token budget management)
   - Type-priority packing per phase (see below)
   - MMR diversity: no two memories with cosine > 0.85 both included
   - Citation chip format appended to each injected memory
   - Output: formatted string within token budget
```

### BM25 via SQLite FTS5

BM25 retrieves memories where exact technical terms appear — function names, error message strings, file paths, configuration keys.

```sql
-- FTS5 virtual table (created during schema init)
CREATE VIRTUAL TABLE memories_fts USING fts5(
  memory_id,
  content,
  tags,
  related_files,
  tokenize='porter unicode61'
);

-- BM25 search query
SELECT m.id, bm25(memories_fts) AS bm25_score
FROM memories_fts
JOIN memories m ON memories_fts.memory_id = m.id
WHERE memories_fts MATCH ?
  AND m.project_id = ?
  AND m.stale_at IS NULL
ORDER BY bm25_score  -- lower is better in SQLite FTS5
LIMIT 100;
```

### Reciprocal Rank Fusion

Merges BM25 and dense vector ranked lists without requiring score normalization:

```typescript
function reciprocalRankFusion(
  bm25Results: Array<{memoryId: string}>,
  denseResults: Array<{memoryId: string}>,
  k: number = 60,
): Map<string, number> {
  const scores = new Map<string, number>();

  bm25Results.forEach((r, rank) => {
    scores.set(r.memoryId, (scores.get(r.memoryId) ?? 0) + 1 / (k + rank + 1));
  });
  denseResults.forEach((r, rank) => {
    scores.set(r.memoryId, (scores.get(r.memoryId) ?? 0) + 1 / (k + rank + 1));
  });

  return scores;
}
```

### Phase-Aware Scoring with Source Trust

```typescript
const PHASE_WEIGHTS: Record<UniversalPhase, Partial<Record<MemoryType, number>>> = {
  define: {
    workflow_recipe: 1.4, dead_end: 1.2, requirement: 1.2,
    decision: 1.1, task_calibration: 1.1,
    gotcha: 0.8, error_pattern: 0.8,
  },
  implement: {
    gotcha: 1.4, error_pattern: 1.3, causal_dependency: 1.2,
    pattern: 1.1, dead_end: 1.2, prefetch_pattern: 1.1,
    workflow_recipe: 0.8,
  },
  validate: {
    error_pattern: 1.4, e2e_observation: 1.4, requirement: 1.2,
    work_unit_outcome: 1.1, gotcha: 1.0,
  },
  refine: {
    error_pattern: 1.3, gotcha: 1.2, dead_end: 1.2,
    pattern: 1.0, decision: 0.9,
  },
  explore: {
    module_insight: 1.4, decision: 1.2, pattern: 1.1,
    causal_dependency: 1.0,
  },
  reflect: {
    work_unit_outcome: 1.4, task_calibration: 1.3, dead_end: 1.1,
  },
};

const SOURCE_TRUST_MULTIPLIERS: Record<MemorySource, number> = {
  user_taught: 1.4,
  agent_explicit: 1.2,
  qa_auto: 1.1,
  mcp_auto: 1.0,
  commit_auto: 1.0,
  observer_inferred: 0.85,
};

function computeFinalScore(memory: Memory, query: string, phase: UniversalPhase): number {
  const cosine = cosineSimilarity(memory.embedding, queryEmbedding);
  const recency = Math.exp(-daysSince(memory.lastAccessedAt) * volatilityDecayRate(memory.relatedFiles));
  const frequency = Math.log1p(memory.accessCount) / Math.log1p(100);

  const base = 0.6 * cosine + 0.25 * recency + 0.15 * frequency;
  const phaseWeight = PHASE_WEIGHTS[phase][memory.type] ?? 1.0;
  const trustWeight = SOURCE_TRUST_MULTIPLIERS[memory.source];

  return base * phaseWeight * trustWeight * memory.confidence;
}
```

### Cross-Encoder Reranking

Qwen3-Reranker-0.6B via Ollama. Run only for T3 (search_memory tool calls) and T1 (session-start injection). NOT for T2 proactive gotcha injection (file-scoped, already high precision, latency-sensitive).

```typescript
async function rerankWithCrossEncoder(
  query: string,
  candidates: Memory[],
  topK: number = 10,
): Promise<Memory[]> {
  if (candidates.length <= topK) return candidates;

  const texts = candidates.map(m => `[${m.type}] ${m.relatedFiles.join(', ')}: ${m.content}`);
  const scores = await crossEncoderReranker.score(query, texts);

  return candidates
    .map((m, i) => ({ memory: m, score: scores[i] }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(r => r.memory);
}
```

### Type-Priority Context Packing

```typescript
const DEFAULT_PACKING_CONFIG: Record<UniversalPhase, ContextPackingConfig> = {
  define: {
    totalBudget: 2500,
    allocation: { workflow_recipe: 0.30, requirement: 0.20, decision: 0.20, dead_end: 0.15, task_calibration: 0.10, other: 0.05 },
  },
  implement: {
    totalBudget: 3000,
    allocation: { gotcha: 0.30, error_pattern: 0.25, causal_dependency: 0.15, pattern: 0.15, dead_end: 0.10, other: 0.05 },
  },
  validate: {
    totalBudget: 2500,
    allocation: { error_pattern: 0.30, requirement: 0.25, e2e_observation: 0.25, work_unit_outcome: 0.15, other: 0.05 },
  },
  refine: { totalBudget: 2000, allocation: { error_pattern: 0.35, gotcha: 0.25, dead_end: 0.20, pattern: 0.15, other: 0.05 } },
  explore: { totalBudget: 2000, allocation: { module_insight: 0.40, decision: 0.25, pattern: 0.20, causal_dependency: 0.15 } },
  reflect: { totalBudget: 1500, allocation: { work_unit_outcome: 0.40, task_calibration: 0.35, dead_end: 0.15, other: 0.10 } },
};
```

### File Staleness Detection (4 Layers)

1. `memory.staleAt` explicitly set (manual deprecation or file deletion)
2. `memory.lastAccessedAt` older than `memory.decayHalfLifeDays` — confidence penalty applied
3. `relatedFiles` changed in git log since `memory.commitSha` — confidence reduced proportionally
4. File modification time newer than `memory.createdAt` by more than 30 days — trigger review flag

### HyDE Fallback

When fewer than 3 results score above 0.5 after all pipeline stages, generate a hypothetical ideal memory using `generateText()` and use that for a secondary dense search. HyDE is only applied for T3 (search_memory tool calls) — never for proactive injection.

---

## 8. Embedding Strategy

### Three-Tier Fallback

The system auto-detects the best available tier at startup. No manual configuration required.

| Priority | Model | When Available | Dims | MTEB Code | Notes |
|---|---|---|---|---|---|
| 1 | `qwen3-embedding:8b` | Ollama, >32GB RAM | 4096 MRL | 80.68 (SOTA local) | Best quality; use if memory allows |
| 2 | `qwen3-embedding:4b` | Ollama (recommended) | 2560 MRL | ~76 (est.) | Default recommendation |
| 3 | `qwen3-embedding:0.6b` | Ollama, low-memory | 1024 | ~68 (est.) | For candidate generation (speed) |
| 4 | `voyage-4-large` | API key set | MoE | SOTA (Jan 2026) | 40% cheaper than dense; best API tier |
| 5 | `voyage-code-3` | API key set | 2048/1024/512/256 | SOTA code | Code-specific retrieval; use over voyage-4 for code tasks |
| 6 | ONNX bundled (`bge-small-en-v1.5`) | Always | 384 | Lower | Zero-config fallback, shipped with app (~100MB) |

**Conflict resolution: Team 2 recommended the 8B model as primary, V3 used 4B.** V4 decision: auto-select based on available RAM. If Ollama reports >32GB available, use 8B. Otherwise use 4B. The 0.6B model is used for candidate generation (256-dim MRL) where speed matters more than accuracy.

### Matryoshka Dimension Strategy

Both Qwen3-embedding models support MRL. Use tiered dimensions:

- **Candidate generation (Stage 1)**: 256-dim — 14x faster, ~90% accuracy retained
- **Precision reranking (Stage 3)**: 1024-dim — full quality
- **Storage**: 1024-dim stored permanently with each memory record

This avoids re-embedding on model upgrade when moving between Qwen3 4B and 8B, as both share MRL-compatible 1024-dim representations.

### Embedding Cache

```typescript
class SQLiteEmbeddingCache {
  get(text: string, modelId: string, dims: number): number[] | null {
    const key = sha256(`${text}:${modelId}:${dims}`);
    const row = this.db.prepare(
      'SELECT embedding FROM embedding_cache WHERE key = ? AND expires_at > ?'
    ).get(key, Date.now());
    return row ? deserializeEmbedding(row.embedding) : null;
  }

  set(text: string, modelId: string, dims: number, embedding: number[]): void {
    const key = sha256(`${text}:${modelId}:${dims}`);
    this.db.prepare(
      'INSERT OR REPLACE INTO embedding_cache (key, embedding, model_id, dims, expires_at) VALUES (?,?,?,?,?)'
    ).run(key, serializeEmbedding(embedding), modelId, dims, Date.now() + 7 * 86400 * 1000);
  }
}
```

Memory contents are embedded once at promotion time and stored alongside the memory record — no re-embedding needed on retrieval. Query embeddings are cached with 7-day TTL.

---

## 9. Agent Loop Integration

### Three-Tier Injection Model — Implementation Details

```
INJECTION POINT 1: System prompt (before streamText())
   Content: global memories, module memories, workflow recipes
   Latency budget: up to 500ms (user waits for session start)
   Mechanism: string concatenation into config.systemPrompt

INJECTION POINT 2: Initial user message (before streamText())
   Content: prefetched file contents, work state (if resuming)
   Latency budget: up to 2s (file reads + memory queries)
   Mechanism: prepended to config.initialMessages[0].content

INJECTION POINT 3: Tool result augmentation (during streamText())
   Content: gotchas, dead_ends, error_patterns for file just read
   Latency budget: < 100ms per augmentation
   Mechanism: tool execute() appends to result string before returning

INJECTION POINT 4: prepareStep callback (between each step)
   Content: step-specific memory based on current agent state
   Latency budget: < 50ms (must not block step progression)
   Mechanism: prepareStep returns updated messages array
```

### prepareStep Active Injection

```typescript
// In runAgentSession() — apps/frontend/src/main/ai/session/runner.ts

const result = streamText({
  model: config.model,
  system: config.systemPrompt,
  messages: config.initialMessages,
  tools: tools ?? {},
  stopWhen: stepCountIs(adjustedMaxSteps),
  abortSignal: config.abortSignal,

  prepareStep: async ({ stepNumber, messages }) => {
    // Skip first 5 steps — agent is still processing initial context
    if (stepNumber < 5 || !memoryContext) {
      workerObserverProxy.onStepComplete(stepNumber);
      return {};
    }

    const injection = await workerObserverProxy.requestStepInjection(
      stepNumber,
      stepMemoryState.getRecentContext(5),  // last 5 tool calls
    );

    workerObserverProxy.onStepComplete(stepNumber);
    if (!injection) return {};

    return {
      messages: [
        ...messages,
        { role: 'system' as const, content: injection.content },
      ],
    };
  },

  onStepFinish: (stepResult) => {
    progressTracker.processStepResult(stepResult);
  },
});
```

### StepInjectionDecider

Runs on main thread. Decision is O(1) — no LLM, just indexed SQLite queries:

```typescript
export class StepInjectionDecider {
  async decide(
    stepNumber: number,
    recentContext: RecentToolCallContext,
  ): Promise<StepInjection | null> {
    // Trigger 1: Agent read a file with unseen gotchas
    const recentReads = recentContext.toolCalls
      .filter(t => t.toolName === 'Read' || t.toolName === 'Edit')
      .map(t => t.args.file_path as string).filter(Boolean);

    if (recentReads.length > 0) {
      const freshGotchas = await this.memoryService.search({
        types: ['gotcha', 'error_pattern', 'dead_end'],
        relatedFiles: recentReads,
        limit: 4,
        minConfidence: 0.65,
        filter: (m) => !recentContext.injectedMemoryIds.has(m.id),
      });
      if (freshGotchas.length > 0) {
        return { content: this.formatGotchas(freshGotchas), type: 'gotcha_injection' };
      }
    }

    // Trigger 2: New scratchpad entry from agent's explicit record_memory call
    const newEntries = this.scratchpad.getNewSince(stepNumber - 1);
    if (newEntries.length > 0) {
      return { content: this.formatScratchpadEntries(newEntries), type: 'scratchpad_reflection' };
    }

    // Trigger 3: Agent is searching for something already in memory
    const recentSearches = recentContext.toolCalls
      .filter(t => t.toolName === 'Grep' || t.toolName === 'Glob').slice(-3);

    for (const search of recentSearches) {
      const pattern = (search.args.pattern ?? search.args.glob ?? '') as string;
      const known = await this.memoryService.searchByPattern(pattern);
      if (known && !recentContext.injectedMemoryIds.has(known.id)) {
        return { content: `MEMORY CONTEXT: ${known.content}`, type: 'search_short_circuit' };
      }
    }

    return null;
  }
}
```

### Memory-Aware stopWhen

Calibration data informs maximum step counts:

```typescript
export function buildMemoryAwareStopCondition(
  baseMaxSteps: number,
  calibrationFactor: number | undefined,
): StopCondition {
  const factor = Math.min(calibrationFactor ?? 1.0, 2.0);  // Cap at 2x
  const adjusted = Math.min(Math.ceil(baseMaxSteps * factor), MAX_ABSOLUTE_STEPS);
  return stepCountIs(adjusted);
}
```

### E2E Validation Memory Pipeline

QA agents using Electron MCP tools generate `e2e_observation` memories:

```typescript
// Post-processor runs after every MCP tool call in QA sessions
async function processMcpToolResult(
  toolName: string,
  args: Record<string, unknown>,
  result: string,
  sessionId: string,
  workUnitRef: WorkUnitRef,
): Promise<void> {
  const MCP_OBS_TOOLS = ['take_screenshot', 'click_by_text', 'fill_input', 'get_page_structure', 'eval'];
  if (!MCP_OBS_TOOLS.includes(toolName)) return;

  const classification = await generateText({
    model: fastModel,
    prompt: `Classify this MCP observation: Tool=${toolName}, Result=${result.slice(0,400)}
    Is this: A=precondition, B=timing, C=ui_behavior, D=test_sequence, E=mcp_gotcha, F=not_worth_remembering
    Reply: letter + one sentence`,
    maxTokens: 100,
  });

  const match = classification.text.match(/^([ABCDE])[:\s]*(.+)/s);
  if (!match) return;

  await memoryService.store({
    type: 'e2e_observation',
    observationType: { A: 'precondition', B: 'timing', C: 'ui_behavior', D: 'test_sequence', E: 'mcp_gotcha' }[match[1]],
    content: match[2].trim(),
    confidence: 0.75,
    source: 'mcp_auto',
    needsReview: true,
    scope: 'global',
    sessionId, workUnitRef,
  });
}
```

---

## 10. Build Pipeline Integration

### Planner: Memory-Guided Planning

The planner receives memory context before producing the implementation plan. Memory shapes the plan itself — not just the agent's context window.

```typescript
export async function buildPlannerMemoryContext(
  taskDescription: string,
  relevantModules: string[],
  memoryService: MemoryService,
): Promise<string> {
  const [calibrations, deadEnds, causalDeps, outcomes, recipes] = await Promise.all([
    memoryService.search({ types: ['task_calibration'], relatedModules: relevantModules, limit: 5, minConfidence: 0.6 }),
    memoryService.search({ types: ['dead_end'], relatedModules: relevantModules, limit: 8, minConfidence: 0.6 }),
    memoryService.search({ types: ['causal_dependency'], relatedModules: relevantModules, limit: 10, minConfidence: 0.65 }),
    memoryService.search({ types: ['work_unit_outcome'], relatedModules: relevantModules, limit: 5, sort: 'recency' }),
    memoryService.searchWorkflowRecipe(taskDescription, { limit: 2 }),
  ]);

  // Calibration shapes subtask estimates:
  //   "payment module: actual/planned = 3.1x over 4 tasks → multiply estimate by 3.1x"
  // Dead ends become explicit constraints in the plan:
  //   "DO NOT use Redis for test sessions — not available in CI (tried in task #41)"
  // Causal deps expand scope:
  //   "auth changes require coordinated updates to middleware/rate-limiter.ts"

  return formatPlannerSections({ calibrations, deadEnds, causalDeps, outcomes, recipes });
}
```

**Three categories of planning transformation:**

1. Unexpected file discoveries (causal dependencies) → expand implementation scope pre-emptively
2. Effort calibration (task_calibration) → adjust subtask count estimate by empirical ratio
3. Dead-end avoidance → write constraints directly into the plan (not just injected as context)

### Coder: Dead-End Avoidance + Predictive Pre-Loading

The coder receives `dead_end` memories via T1 injection and gets file contents pre-loaded via T2 injection based on `prefetch_pattern` memories.

Pre-load budget: max 32K tokens (~25% of context window), max 12 files. Files accessed in >80% of past sessions for this module load first. Files accessed in >50% load second. Files already in system prompt are skipped.

```typescript
const MAX_PREFETCH_TOKENS = 32_000;
const MAX_PREFETCH_FILES = 12;

async function buildPrefetchPlan(
  relevantModules: string[],
  alreadyInjectedPaths: Set<string>,
): Promise<PrefetchPlan> {
  const patterns = await memoryService.search({
    types: ['prefetch_pattern'],
    relatedModules: relevantModules,
    limit: 10,
  }) as PrefetchPattern[];

  // Build candidates sorted by session coverage (alwaysRead > frequentlyRead)
  // Apply token budget greedily
  // Return: files to pre-include in initial message
}
```

### QA: Targeted Validation from Known Failure Patterns

QA session starts with all relevant `e2e_observation`, `error_pattern`, and `requirement` memories injected before the first MCP call:

```typescript
async function buildQaSessionContext(featureUnderTest: string, basePrompt: string): Promise<string> {
  const e2eMemories = await memoryService.search({
    types: ['e2e_observation'],
    query: featureUnderTest,
    limit: 8, minConfidence: 0.7,
    phase: 'validate',
  });

  // Format by observation type:
  // preconditions first, then test_sequences, then timing, then mcp_gotchas, then ui_behaviors
  return `${basePrompt}\n\n## E2E VALIDATION MEMORY\n${formatE2EContext(e2eMemories)}`;
}
```

### Recovery: Known-Good Strategies

When a QA fix session starts (after failed QA), the recovery agent receives `work_unit_outcome` memories from prior failed attempts, `dead_end` memories, and the failed QA report. Past failure context prevents the recovery agent from re-trying the same broken approach.

### Spec Creation: Project Conventions Injection

Spec creation agents receive `preference`, `decision`, `pattern`, and `module_insight` memories to produce specifications aligned with existing codebase conventions rather than generic patterns.

---

## 11. Worker Thread Architecture and Concurrency

### Thread Topology

```
MAIN THREAD (Electron main process)
├── WorkerBridge (per task)
│   ├── MemoryObserver (observes all worker messages — main thread)
│   ├── MemoryService (reads from + writes to SQLite — WAL mode)
│   ├── ScratchpadStore (in-memory, flushed to disk at subtask boundaries)
│   └── Worker (worker_threads.Worker)
│       │
│       │ postMessage() IPC
│       │
│       WORKER THREAD
│       ├── runAgentSession() → streamText()
│       ├── Tool executors (Read, Write, Edit, Bash, Grep, Glob)
│       └── Memory tools (IPC to main thread):
│           ├── search_memory → MemoryService
│           ├── record_memory → ScratchpadStore (not permanent)
│           └── get_session_context → local scratchpad state

For parallel subagents:
MAIN THREAD
├── WorkerBridge-A (subagent A, subtask 1) → ScratchpadStore-A (isolated)
├── WorkerBridge-B (subagent B, subtask 2) → ScratchpadStore-B (isolated)
└── WorkerBridge-C (subagent C, subtask 3) → ScratchpadStore-C (isolated)

After all subagents complete:
ParallelScratchpadMerger.merge([A, B, C]) → unified scratchpad → observer.finalize()
```

### IPC Message Types (Discriminated Union)

```typescript
export type MemoryIpcRequest =
  | { type: 'memory:search'; requestId: string; query: string; filters: MemorySearchFilters }
  | { type: 'memory:record'; requestId: string; entry: MemoryRecordEntry }
  | { type: 'memory:tool-call'; toolName: string; args: Record<string, unknown>; stepIndex: number; timestamp: number }
  | { type: 'memory:tool-result'; toolName: string; args: Record<string, unknown>; result: string; durationMs: number; isError: boolean; stepIndex: number }
  | { type: 'memory:reasoning'; text: string; stepIndex: number }
  | { type: 'memory:step-complete'; stepNumber: number }
  | { type: 'memory:session-complete'; outcome: SessionOutcome; stepsExecuted: number; accessedFiles: string[] };

export type MemoryIpcResponse =
  | { type: 'memory:search-result'; requestId: string; memories: Memory[]; error?: string }
  | { type: 'memory:record-result'; requestId: string; scratchpadId: string; error?: string }
  | { type: 'memory:intercept'; targetToolCallId: string; injectedContent: string; citationIds: string[] };
```

### IPC Latency Budgets

| Operation | Expected | Budget | Strategy |
|---|---|---|---|
| `memory:search` (exact) | 1-5ms | 10ms | Indexed SQLite |
| `memory:search` (vector) | 10-30ms | 50ms | Async, non-blocking |
| `memory:record` (scratchpad) | <1ms | 5ms | In-memory only |
| `memory:tool-call` (fire-and-forget) | N/A | 0ms budget | No acknowledgment |
| Proactive gotcha injection | 20-50ms | 100ms | Must complete before tool result returned |

All IPC uses async request-response with UUID correlation. Timeouts of 3 seconds prevent blocking the agent loop if memory is temporarily unavailable. On timeout, the agent proceeds without memory context (graceful degradation).

### Parallel Subagent Scratchpad Merger

After all parallel subagents complete, merge isolated scratchpads before `finalize()`:

```typescript
export class ParallelScratchpadMerger {
  merge(scratchpads: ScratchpadStore[]): MergedScratchpad {
    const allEntries = scratchpads.flatMap((s, idx) =>
      s.getAll().map(e => ({ ...e, sourceAgentIndex: idx }))
    );

    // Deduplicate entries with >88% content similarity
    const deduplicated = this.deduplicateByContent(allEntries);

    // Quorum boost: entries observed by 2+ agents independently
    // get confidence boost and lowered frequency threshold (1 session instead of 3)
    return {
      entries: deduplicated.map(entry => ({
        ...entry,
        quorumCount: allEntries.filter((e, _) =>
          e.sourceAgentIndex !== entry.sourceAgentIndex &&
          this.contentSimilarity(e.content, entry.content) > 0.85
        ).length + 1,
        effectiveFrequencyThreshold: entry.confirmedBy >= 1 ? 1 : DEFAULT_FREQUENCY_THRESHOLD,
      })),
    };
  }
}
```

### WAL Mode + Write Serialization

```typescript
// SQLite setup
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');

// Workers open read-only connections
// All writes go through MemoryService on main thread
// Main thread serializes writes via async queue (no concurrent writes)
```

---

## 12. Cross-Session Pattern Synthesis

### Three Synthesis Modes

**Mode 1: Incremental (after every session, no LLM)** — Update rolling file statistics, co-access edge weights, error fingerprint registry. O(n) over new session's signals. Updates `observer_co_access_edges` and `observer_file_nodes` tables.

**Mode 2: Threshold-triggered (at session counts 5, 10, 20, 50, 100, one LLM call per trigger per module)** — When a module's session count hits a threshold, synthesize cross-session patterns. Output: 0-5 novel memories per synthesis call.

**Mode 3: Scheduled (weekly, one LLM call per cross-module cluster)** — Find module pairs with high co-access not yet captured as `causal_dependency` memories. Generate cross-module insights.

### Threshold Synthesis

```typescript
const SYNTHESIS_THRESHOLDS = [5, 10, 20, 50, 100];

async function triggerModuleSynthesis(module: string, sessionCount: number): Promise<void> {
  // Avoid re-synthesizing the same module at the same threshold
  const already = index.synthesisLog.some(s => s.module === module && s.triggerCount === sessionCount);
  if (already) return;

  const stats = buildModuleStatsSummary(module);

  const synthesis = await generateText({
    model: fastModel,
    prompt: buildSynthesisPrompt(module, stats, sessionCount),
    maxTokens: 400,
  });

  const memories = parseSynthesisOutput(synthesis.text);

  for (const memory of memories) {
    if (await isNovel(memory)) {
      await memoryService.store({
        ...memory,
        source: 'observer_inferred',
        needsReview: true,
        confidence: computeSynthesisConfidence(sessionCount, stats),
      });
    }
  }
}

function buildSynthesisPrompt(module: string, stats: ModuleStatsSummary, count: number): string {
  return `You are analyzing ${count} agent sessions on the "${module}" module.

File access patterns:
${stats.topFiles.map(f => `- ${f.path}: ${f.sessions} sessions (${f.editSessions} with edits)`).join('\n')}

Co-accessed pairs:
${stats.strongCoAccess.map(e => `- ${e.fileA} + ${e.fileB}: ${e.sessions} sessions`).join('\n')}

Recurring errors:
${stats.errors.map(e => `- "${e.errorType}": ${e.sessions} sessions, resolved: ${e.resolvedHow}`).join('\n')}

Identify (max 5 memories, omit obvious things):
1. Files to prefetch when working in this module (prefetch_pattern)
2. Non-obvious file coupling (causal_dependency or gotcha)
3. Recurring error patterns (error_pattern)
4. Non-obvious module purpose (module_insight)

Format: JSON array [{ "type": "...", "content": "...", "relatedFiles": [...], "confidence": 0.0-1.0 }]`;
}
```

### Synthesis Timeline

```
Session 1-4:   Incremental index updates only. No LLM calls.
Session 5:     MODULE_SESSION_COUNT = 5 → synthesis triggered.
               One LLM call per module. 0-5 memories generated.
Session 6-9:   Incremental updates only.
Session 10:    MODULE_SESSION_COUNT = 10 → synthesis triggered.
               Novelty check against session-5 memories.
Session 20:    High-confidence synthesis. Stable patterns across 20 sessions.
Weekly job:    Cross-module pair synthesis. Catches causal deps across modules.
```

### Workflow Recipe Auto-Creation

When a tool sequence is observed in 3+ sessions with all sequences containing 4+ steps and success rate > 80%, promote as `workflow_recipe`:

```typescript
// Trigger: SequenceSignal with frequency >= 3 AND length >= 4 AND successRate > 0.8
// Output: workflow_recipe with steps derived from the canonical sequence
```

---

## 13. UX and Developer Trust

### Three Trust-Building Moments

1. **Citation Moment**: First time the agent says "based on what we learned last session" and gets it right. Design the citation chip system explicitly for this moment.
2. **Correction Moment**: First time a memory is wrong. If correction is one click and immediate, trust increases. If correction is hidden or hard, trust is destroyed permanently.
3. **Return Moment**: Opening a project after days away and the agent already knows the context. The emotional payoff that converts users from skeptical to loyal.

### Memory Panel Navigation

```
Memory (Cmd+Shift+M)
├── Health Dashboard (default)
│   ├── Stats: total | active (used 30d) | needs-review | tokens-saved-this-session
│   ├── Health score 0-100 (avg confidence × module coverage × review activity)
│   ├── Module coverage progress bars (unknown / shallow / partial / mapped)
│   ├── Recent activity feed (agent sessions, user corrections)
│   └── Needs Attention: stale memories, pending reviews
├── Module Map
│   └── Collapsible per-module cards with file lists, deps, memory count badge
├── Memory Browser
│   ├── Search + filters (scope / type / status)
│   └── Memory cards with full provenance (always visible)
├── Ask Memory
│   └── Chat interface drawing from memories + module map with inline citations
└── [Cloud only] Team Memory
```

### Agent Output Attribution

Memory citation format in agent output:
```
[^ Memory: JWT 24h expiry decision]
[^ Dead End: approach that was abandoned]
```

The renderer detects `[Memory #ID: brief text]` and replaces with `MemoryCitationChip` — an amber-tinted pill with a flag button on hover for point-of-damage correction. Dead-end citations use red tint. More than 5 citations in one response collapse to "Used N memories [view all]".

### Session-End Summary

```
Session Complete: Auth Bug Fix
Memory saved ~6,200 tokens of discovery this session

What the agent remembered (used):
  - JWT decision → used when planning approach  [ok]
  - Redis gotcha → avoided concurrent validation bug  [ok]

What the agent learned (4 new memories):
  1/4  GOTCHA  middleware/auth.ts  [ok] [edit] [x]
       Token refresh fails silently when Redis is unreachable vs. throwing
  2/4  ERROR PATTERN  tests/auth/  [ok] [edit] [x]
       Auth tests require REDIS_URL env var — hang without it
  3/4  WORKFLOW RECIPE  global  [ok] [edit] [x]
       To add auth middleware: 1) Create in middleware/ 2) Register in auth.ts...
  4/4  MODULE INSIGHT  src/auth/tokens.ts  [ok] [edit] [x]
       Token rotation uses Redis MULTI/EXEC to prevent concurrent refresh races

[Save all confirmed]    [Review later]
```

Actions: `[ok]` sets `confidence += 0.1, userVerified: true`. `[edit]` opens inline textarea. `[x]` sets `deprecated: true`.

If the user dismisses without interaction 3 sessions in a row, reduce summary to sessions where > 3 new memories were learned. Never suppress entirely.

### Trust Progression System

Trust tracked per-project. Four levels:

**Level 1 — Cautious (Sessions 1-3):**
- Inject memories with `confidence > 0.80` only
- All new memories require session-end confirmation (cannot skip)
- No proactive gotcha injection — session-start only
- Advance: 3 sessions + 50% of memories confirmed

**Level 2 — Standard (Sessions 4-15):**
- Inject `confidence > 0.65`
- Session-end summary shown, "Confirm all" is default action
- Proactive gotcha injection active (tool-result level)
- Advance: 10+ sessions, < 5% correction rate, at least one correction made

**Level 3 — Confident (Sessions 16+):**
- Inject `confidence > 0.55`
- Session-end summary condensed to `needsReview: true` memories only
- Weekly audit card when stale memories accumulate
- Advance: user must explicitly opt in (never automatic)

**Level 4 — Autonomous (Opt-in only):**
- Inject `confidence > 0.45`
- Session-end summary suppressed by default; on demand in Memory panel
- Entry requires explicit user acknowledgment of what changes

Trust regression: if user flags 3+ memories as wrong in one session, offer (not force) moving to a more conservative level. Never regress automatically.

### Memory Correction Modal

Accessible from: citation chip `[!]` button, memory card `[Flag Wrong]`, session summary `[flag an issue]`.

Radio options with concrete actions:
- "Outdated — we fixed this" → `deprecated: true`, create replacement `human_feedback` memory if text provided
- "Partially wrong — let me refine" → inline edit, saves as new version with diff history
- "Doesn't apply to this project" → scope-removal or project-exclude
- "Incorrect information" → `deprecated: true`, correction text required

### Teach the AI Entry Points

| Method | Location | Action |
|---|---|---|
| `/remember [text]` | Agent terminal | Creates `user_taught` memory immediately |
| `Cmd+Shift+M` | Global | Opens Teach panel |
| Right-click file | File tree | Opens Teach panel pre-filled with file path |
| Hover agent output + `+` | Terminal | Opens Teach panel with highlighted text |
| "Actually..." detection | Terminal | Non-intrusive banner: "Create a correction memory?" |
| Import CLAUDE.md / .cursorrules | Settings | Parse existing rules into typed memories |

### First-Run Experience

Phase 1: "Getting to know your project" — animated progress through file tree analysis, module classification, initial memory seeding (~30-40 seconds).

Phase 2: If CLAUDE.md or .cursorrules found — "Found 8 rules. Import as memories?" — with individual review option.

Phase 3: Card-at-a-time review of seeded memories. "Tell me if anything looks wrong — you're always the authority." One decision per screen. "Confirm all remaining" for users who trust the system immediately.

If no Ollama configured: "Agents work without memory, but rediscover your codebase each session. Install Ollama and run `ollama pull qwen3-embedding:4b` to activate memory."

---

## 14. Cloud Sync and Multi-Device

### Architecture

Local-first. SQLite is source of truth. Cloud is additive replica and collaboration layer.

```
Electron Desktop (primary)
  SQLite DB (source of truth)
    ├── Personal memories (local, private by default)
    ├── Project memories (local, synced when enabled)
    └── Cached team memories (from cloud, read-only locally)

  Sync Engine (background, when cloud sync enabled)
    ├── Local-first: writes go to SQLite first
    ├── Async sync: propagates to cloud within 60 seconds
    └── Conflict detection: CRDT for concurrent edits

Cloud (when sync enabled)
  ├── Personal memories (user-scoped, encrypted)
  ├── Project memories (project-scoped)
  └── Team memories (team-scoped, role-controlled)
```

### Conflict Resolution

When the same memory is edited on two devices before sync:

```
+-- Sync Conflict: Auth Module Gotcha --------+
| Device A (2h ago):                          |
| "Redis session store required for..."       |
|                                             |
| Device B (45m ago):                         |
| "Redis session store was required but       |
|  we added an in-memory fallback in v2.4"    |
|                                             |
| [Keep A]  [Keep B]  [Merge manually]        |
+--------------------------------------------+
```

CRDT merge: for non-conflicting fields (access count, tags), merge automatically. For content, present both and require user decision.

### Vectors-Only Privacy Mode

Sync embedding vectors (needed for cross-device semantic search) while keeping raw memory content on the local device. The remote device re-indexes by fetching vectors and performing local storage only of metadata.

### Cloud Migration Ceremony

Per-project include/exclude. Secret scanner runs before upload and reports findings. Security checklist displayed prominently before any data leaves the device. "Not now" sets 30-day snooze, not permanent dismiss.

---

## 15. Team and Organization Memories

### Four Scope Levels

| Scope | Visible To | Editable By | Use Cases |
|---|---|---|---|
| Personal | Only you | You | Workflow preferences, personal aliases |
| Project | All project members | Project admins + creators | Gotchas, error patterns, decisions |
| Team | All team members | Team admins | Organization conventions, architecture |
| Organization | All org members | Org admins | Security policies, compliance requirements |

### Team Onboarding

When a new developer joins a project, surface the 5 most important team memories immediately. Selection: sort by (confidence × pinned_weight × access_count), take top 5, prioritize pinned memories from team admins. New developer sees months of accumulated tribal knowledge in 60 seconds — and their agents operate with all of it from session one.

### Dispute Resolution

1. Team member clicks "Dispute" (not "Flag Wrong" — different UX and different action)
2. Threaded comment opens on the memory
3. Steward notified
4. Memory gets "disputed" badge — agents still use it but with confidence × 0.8
5. Resolution: steward updates memory (closes dispute) or team admin escalates

---

## 16. Privacy and Compliance

### What Stays Local

By default, everything stays on device. Cloud sync is explicit opt-in per project. The following never sync automatically:

- Personal-scope memories
- Client project memories when project name matches contractor signals
- Any memory flagged by the secret scanner
- Embedding vectors when "vectors-only" mode is selected (content stays local)

### Secret Scanner

Runs before any cloud upload and before storing `user_taught` memories:

```typescript
const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9]{48}/,          // OpenAI API keys
  /sk-ant-[a-zA-Z0-9-]{95}/,     // Anthropic API keys
  /ghp_[a-zA-Z0-9]{36}/,         // GitHub personal tokens
  /-----BEGIN (RSA|EC) PRIVATE KEY-----/,
  /password\s*[:=]\s*["']?\S+/i,
];
```

On detection: block the upload and highlight the substring. User must manually redact before proceeding. Emergency hard-delete path for accidentally stored secrets (bypasses 30-day soft-delete grace period).

### GDPR Controls

- Export all memories as JSON (complete, machine-readable)
- Export as Markdown (human-readable, importable to other tools)
- Export as CLAUDE.md format (for portability to standard AI tool format)
- Delete all memories (hard delete, no 30-day grace for explicit account deletion)
- Request data export (packaged archive of SQLite + embeddings)

### EU AI Act 2026 Considerations

- All memory-augmented agent decisions must be explainable via citation chips and provenance metadata
- Users can opt out of automatic memory creation without losing agent functionality
- Memory health audit provides transparency into what the system has learned
- No opaque automated decisions about code that affect third parties

---

## 17. SQLite Schema

Complete schema for `memory.db` — all tables in one database.

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

-- ============================================================
-- CORE MEMORY TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS memories (
  id                    TEXT PRIMARY KEY,
  type                  TEXT NOT NULL,
  content               TEXT NOT NULL,
  confidence            REAL NOT NULL DEFAULT 0.8,
  tags                  TEXT NOT NULL DEFAULT '[]',          -- JSON array
  related_files         TEXT NOT NULL DEFAULT '[]',          -- JSON array
  related_modules       TEXT NOT NULL DEFAULT '[]',          -- JSON array
  created_at            TEXT NOT NULL,
  last_accessed_at      TEXT NOT NULL,
  access_count          INTEGER NOT NULL DEFAULT 0,
  session_id            TEXT,
  commit_sha            TEXT,
  scope                 TEXT NOT NULL DEFAULT 'global',
  work_unit_ref         TEXT,                               -- JSON: WorkUnitRef
  methodology           TEXT,                               -- denormalized for indexing
  source                TEXT NOT NULL DEFAULT 'agent_explicit',
  target_node_id        TEXT,
  impacted_node_ids     TEXT DEFAULT '[]',                  -- JSON array
  relations             TEXT NOT NULL DEFAULT '[]',          -- JSON array
  decay_half_life_days  REAL,
  provenance_session_ids TEXT DEFAULT '[]',
  needs_review          INTEGER NOT NULL DEFAULT 0,
  user_verified         INTEGER NOT NULL DEFAULT 0,
  citation_text         TEXT,
  pinned                INTEGER NOT NULL DEFAULT 0,
  deprecated            INTEGER NOT NULL DEFAULT 0,
  deprecated_at         TEXT,
  stale_at              TEXT,
  project_id            TEXT NOT NULL,
  trust_level_scope     TEXT DEFAULT 'personal'             -- personal/project/team/org
);

CREATE TABLE IF NOT EXISTS memory_embeddings (
  memory_id   TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
  embedding   BLOB NOT NULL,     -- sqlite-vec float32 vector, default 1024-dim
  model_id    TEXT NOT NULL,     -- enforce matching model on search
  dims        INTEGER NOT NULL DEFAULT 1024,
  created_at  TEXT NOT NULL
);

-- FTS5 for BM25 keyword search
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  memory_id UNINDEXED,
  content,
  tags,
  related_files,
  tokenize='porter unicode61'
);

-- Embedding cache (avoid re-embedding repeated queries)
CREATE TABLE IF NOT EXISTS embedding_cache (
  key        TEXT PRIMARY KEY,   -- sha256(text:modelId:dims)
  embedding  BLOB NOT NULL,
  model_id   TEXT NOT NULL,
  dims       INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_embedding_cache_expires ON embedding_cache(expires_at);

-- ============================================================
-- OBSERVER TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS observer_file_nodes (
  file_path         TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL,
  access_count      INTEGER NOT NULL DEFAULT 0,
  last_accessed_at  TEXT NOT NULL,
  session_count     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS observer_co_access_edges (
  file_a              TEXT NOT NULL,
  file_b              TEXT NOT NULL,
  project_id          TEXT NOT NULL,
  weight              REAL NOT NULL DEFAULT 0.0,
  raw_count           INTEGER NOT NULL DEFAULT 0,
  session_count       INTEGER NOT NULL DEFAULT 0,
  avg_time_delta_ms   REAL,
  directional         INTEGER NOT NULL DEFAULT 0,
  task_type_breakdown TEXT DEFAULT '{}',                   -- JSON: {taskType: count}
  last_observed_at    TEXT NOT NULL,
  promoted_at         TEXT,
  PRIMARY KEY (file_a, file_b, project_id)
);

CREATE TABLE IF NOT EXISTS observer_error_patterns (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL,
  tool_name        TEXT NOT NULL,
  error_fingerprint TEXT NOT NULL,
  error_message    TEXT NOT NULL,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  last_seen_at     TEXT NOT NULL,
  resolved_how     TEXT,
  sessions         TEXT DEFAULT '[]'                       -- JSON array of session IDs
);

CREATE TABLE IF NOT EXISTS observer_module_session_counts (
  module      TEXT NOT NULL,
  project_id  TEXT NOT NULL,
  count       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (module, project_id)
);

CREATE TABLE IF NOT EXISTS observer_synthesis_log (
  module          TEXT NOT NULL,
  project_id      TEXT NOT NULL,
  trigger_count   INTEGER NOT NULL,
  synthesized_at  INTEGER NOT NULL,
  memories_generated INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (module, project_id, trigger_count)
);

-- ============================================================
-- KNOWLEDGE GRAPH TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS graph_nodes (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL,
  type            TEXT NOT NULL,
  label           TEXT NOT NULL,
  file_path       TEXT,
  language        TEXT,
  start_line      INTEGER,
  end_line        INTEGER,
  layer           INTEGER NOT NULL DEFAULT 1,
  source          TEXT NOT NULL,
  confidence      TEXT DEFAULT 'inferred',
  metadata        TEXT DEFAULT '{}',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  stale_at        INTEGER,
  last_analyzed_at INTEGER,
  associated_memory_ids TEXT DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_gn_project_type  ON graph_nodes(project_id, type);
CREATE INDEX IF NOT EXISTS idx_gn_project_label ON graph_nodes(project_id, label);
CREATE INDEX IF NOT EXISTS idx_gn_file_path     ON graph_nodes(project_id, file_path) WHERE file_path IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gn_stale         ON graph_nodes(stale_at) WHERE stale_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS graph_edges (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  from_id     TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  to_id       TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  layer       INTEGER NOT NULL DEFAULT 1,
  weight      REAL DEFAULT 1.0,
  source      TEXT NOT NULL,
  confidence  REAL DEFAULT 1.0,
  metadata    TEXT DEFAULT '{}',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  stale_at    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_ge_from_type ON graph_edges(from_id, type) WHERE stale_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ge_to_type   ON graph_edges(to_id, type)   WHERE stale_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ge_project   ON graph_edges(project_id, type) WHERE stale_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ge_stale     ON graph_edges(stale_at) WHERE stale_at IS NOT NULL;

-- Pre-computed closure for O(1) impact analysis
CREATE TABLE IF NOT EXISTS graph_closure (
  ancestor_id   TEXT NOT NULL,
  descendant_id TEXT NOT NULL,
  depth         INTEGER NOT NULL,
  path          TEXT NOT NULL,         -- JSON array of node IDs
  edge_types    TEXT NOT NULL,         -- JSON array of edge types along path
  total_weight  REAL NOT NULL,         -- product of edge weights along path
  PRIMARY KEY (ancestor_id, descendant_id),
  FOREIGN KEY (ancestor_id)   REFERENCES graph_nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (descendant_id) REFERENCES graph_nodes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gc_ancestor   ON graph_closure(ancestor_id, depth);
CREATE INDEX IF NOT EXISTS idx_gc_descendant ON graph_closure(descendant_id, depth);

-- Graph index state tracking
CREATE TABLE IF NOT EXISTS graph_index_state (
  project_id       TEXT PRIMARY KEY,
  last_indexed_at  INTEGER NOT NULL,
  last_commit_sha  TEXT,
  node_count       INTEGER DEFAULT 0,
  edge_count       INTEGER DEFAULT 0,
  stale_edge_count INTEGER DEFAULT 0,
  index_version    INTEGER DEFAULT 1
);

-- SCIP symbol registry
CREATE TABLE IF NOT EXISTS scip_symbols (
  symbol_id  TEXT PRIMARY KEY,
  node_id    TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scip_node ON scip_symbols(node_id);

-- ============================================================
-- PERFORMANCE INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_memories_project_type     ON memories(project_id, type);
CREATE INDEX IF NOT EXISTS idx_memories_project_scope    ON memories(project_id, scope);
CREATE INDEX IF NOT EXISTS idx_memories_source           ON memories(source);
CREATE INDEX IF NOT EXISTS idx_memories_needs_review     ON memories(needs_review) WHERE needs_review = 1;
CREATE INDEX IF NOT EXISTS idx_memories_confidence       ON memories(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_memories_last_accessed    ON memories(last_accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_type_conf        ON memories(project_id, type, confidence DESC);
CREATE INDEX IF NOT EXISTS idx_memories_session          ON memories(session_id);
CREATE INDEX IF NOT EXISTS idx_memories_commit           ON memories(commit_sha) WHERE commit_sha IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_memories_not_deprecated   ON memories(project_id, deprecated) WHERE deprecated = 0;

CREATE INDEX IF NOT EXISTS idx_co_access_file_a ON observer_co_access_edges(file_a, project_id);
CREATE INDEX IF NOT EXISTS idx_co_access_file_b ON observer_co_access_edges(file_b, project_id);
CREATE INDEX IF NOT EXISTS idx_co_access_weight ON observer_co_access_edges(weight DESC);
```

---

## 18. Memory Pruning and Lifecycle

### Decay Model

```typescript
const DEFAULT_HALF_LIVES: Partial<Record<MemoryType, number>> = {
  work_state: 7,          // Stale work state is harmful — decay fast
  e2e_observation: 30,    // UI behaviors change with releases
  error_pattern: 60,      // Error patterns stay relevant across major versions
  gotcha: 60,
  module_insight: 90,
  dead_end: 90,           // Dead ends stay relevant long-term
  causal_dependency: 120,
  decision: Infinity,     // Decisions never decay (pinned by default)
  workflow_recipe: 120,   // Recipes go stale as codebase evolves
  task_calibration: 180,  // Calibration data remains valid longer
};

// Confidence degradation based on decay:
function currentConfidence(memory: Memory): number {
  if (!memory.decayHalfLifeDays || memory.pinned) return memory.confidence;
  const daysSince = (Date.now() - Date.parse(memory.lastAccessedAt)) / 86400000;
  const decayFactor = Math.pow(0.5, daysSince / memory.decayHalfLifeDays);
  return memory.confidence * decayFactor;
}
```

### Pruning Job

Runs daily, off-peak (e.g., 3am local time via Electron's `powerMonitor` idle event):

```typescript
async function runPruningJob(projectId: string): Promise<PruningResult> {
  const now = new Date().toISOString();

  // 1. Soft-delete memories below confidence floor after decay
  const expired = await db.run(`
    UPDATE memories SET deprecated = 1, deprecated_at = ?
    WHERE project_id = ? AND deprecated = 0
      AND decay_half_life_days IS NOT NULL
      AND pinned = 0
      AND julianday(?) - julianday(last_accessed_at) > decay_half_life_days * 3
  `, [now, projectId, now]);

  // 2. Hard-delete soft-deleted memories older than 30 days (unless user-verified)
  const hardDeleted = await db.run(`
    DELETE FROM memories
    WHERE project_id = ? AND deprecated = 1
      AND user_verified = 0
      AND julianday(?) - julianday(deprecated_at) > 30
  `, [projectId, now]);

  // 3. Evict expired embedding cache entries
  await db.run('DELETE FROM embedding_cache WHERE expires_at < ?', [Date.now()]);

  // 4. Mark graph edges stale for files deleted from git
  // (runs git ls-files and marks edges for missing files)

  return { softDeleted: expired.changes, hardDeleted: hardDeleted.changes };
}
```

### Access Count as Trust Signal

Every time a memory is injected into a session (even without explicit agent citation), increment `access_count`. After `access_count >= 5` with no user correction, auto-increment `confidence` by 0.05 (capped at 0.95). After `access_count >= 10` with no correction, remove `needsReview` flag.

---

## 19. A/B Testing and Metrics

### Control Group Design

5% of new sessions are assigned to the control group (no memory injection). This is tracked per-project, not per-user — a project is either in control or not for a given session. Control group sessions still generate signals for the observer (to build the memory store) but receive no injections. This prevents the control group from being a "cold start" disadvantage — the memory store builds at the same rate.

```typescript
enum MemoryABGroup {
  CONTROL = 'control',         // No injection (5%)
  PASSIVE_ONLY = 'passive',    // T1 + T2 only (10%)
  FULL = 'full',               // T1 + T2 + T3 + T4 (85%)
}

function assignABGroup(sessionId: string, projectId: string): MemoryABGroup {
  const hash = murmurhash(`${sessionId}:${projectId}`) % 100;
  if (hash < 5)  return MemoryABGroup.CONTROL;
  if (hash < 15) return MemoryABGroup.PASSIVE_ONLY;
  return MemoryABGroup.FULL;
}
```

### Key Metrics

| Metric | Definition | Target |
|---|---|---|
| Tool calls per task | Total tool calls in session | < 20% reduction vs control |
| File re-reads | Read calls on files previously read in prior session | < 50% reduction vs control |
| QA first-pass rate | QA passes without a fix cycle needed | > 15% improvement vs control |
| Dead-end re-entry rate | Agent tries a previously-failed approach | < 5% (from ~30% without memory) |
| Session context tokens used | Total prompt tokens consumed | < 10% reduction vs control |
| User correction rate | Memories flagged / memories used | < 5% (trust signal) |

### Statistical Testing

Use Mann-Whitney U test (non-parametric, appropriate for skewed session duration distributions). Minimum 100 sessions per group before drawing conclusions. Report at 95% confidence interval. Do not stop the test early even if results look significant — auto-correct for early stopping bias using sequential analysis.

### Phase Weight Learning (DSPy Inspiration)

After 30+ sessions, run a weight optimization pass: which memory types most strongly correlated with QA first-pass success for each phase? This is a background job, not a real-time optimization. Output updates `PHASE_WEIGHTS` with data-driven values. Human review required before applying new weights.

---

## 20. Implementation Plan

### Phase 0: SQLite Foundation (1-2 days)

**Prerequisites**: None — Phase 0 is the foundation for all others.

**Deliverables**:
- `memory.db` creation logic with WAL mode
- All `CREATE TABLE` statements from Section 17
- FTS5 virtual table initialization
- `sqlite-vec` extension loading in Electron main process
- `MemoryService` stub with typed CRUD methods
- Write serialization proxy (main thread only)

**Acceptance criteria**:
- Database created on app startup in `app.getPath('userData')/memory.db`
- All tables created without errors
- `PRAGMA journal_mode=WAL` verified active
- Unit tests for schema creation pass

### Phase 0 Quick Start — Developer Checklist

A developer can complete Phase 0 in under a day following these concrete steps. No external services required. Ollama not required at this phase.

**Step 1: Install sqlite-vec**

```bash
cd apps/frontend
npm install sqlite-vec
```

Verify the binary loads in Electron's main process context by adding a smoke test to `src/main/ai/memory/__tests__/smoke.test.ts`:

```typescript
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

test('sqlite-vec loads in main process context', () => {
  const db = new Database(':memory:');
  sqliteVec.load(db);
  const result = db.prepare("SELECT vec_version()").get() as { 'vec_version()': string };
  expect(result['vec_version()']).toBeDefined();
});
```

**Step 2: Create the MemoryService module**

Create file `apps/frontend/src/main/ai/memory/service.ts`. Start with the database initializer:

```typescript
import path from 'path';
import { app } from 'electron';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { MEMORY_SCHEMA_SQL } from './schema';

let _db: Database.Database | null = null;

export function getMemoryDb(): Database.Database {
  if (_db) return _db;

  const dbPath = path.join(app.getPath('userData'), 'memory.db');
  _db = new Database(dbPath);

  // Load sqlite-vec extension for vector search
  sqliteVec.load(_db);

  // Apply performance pragmas
  _db.pragma('journal_mode = WAL');
  _db.pragma('synchronous = NORMAL');
  _db.pragma('foreign_keys = ON');
  _db.pragma('busy_timeout = 5000');
  _db.pragma('cache_size = -32000'); // 32MB page cache

  // Initialize schema (idempotent — uses CREATE TABLE IF NOT EXISTS)
  _db.exec(MEMORY_SCHEMA_SQL);

  return _db;
}

export function closeMemoryDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
```

**Step 3: Extract the schema DDL**

Create `apps/frontend/src/main/ai/memory/schema.ts` and paste the complete SQL from Section 17 as a template literal exported as `MEMORY_SCHEMA_SQL`. This keeps schema definition co-located with the service, not scattered through initialization code.

**Step 4: Create the MemoryService stub**

Add typed CRUD methods that will be filled in during Phase 1:

```typescript
export class MemoryService {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  // Phase 0: stub — returns empty array until Phase 3 retrieval is implemented
  async search(_query: string, _filters: MemorySearchFilters): Promise<Memory[]> {
    return [];
  }

  // Phase 0: stub — no-op until Phase 1 observer is implemented
  async record(_entry: MemoryRecordEntry): Promise<string> {
    return crypto.randomUUID();
  }

  // Phase 0: direct insert for user_taught memories (needed by /remember command)
  async insertUserTaught(content: string, projectId: string, tags: string[]): Promise<string> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO memories (id, type, content, confidence, tags, related_files,
        related_modules, created_at, last_accessed_at, access_count,
        scope, source, project_id, trust_level_scope)
      VALUES (?, 'user_taught', ?, 0.90, ?, '[]', '[]', ?, ?, 0,
        'project', 'user_taught', ?, 'personal')
    `).run(id, content, JSON.stringify(tags), now, now, projectId);
    return id;
  }
}
```

**Step 5: Wire into app startup**

In `apps/frontend/src/main/index.ts` (or equivalent app entry), call `getMemoryDb()` inside `app.whenReady()`. Add `closeMemoryDb()` to the `app.on('before-quit')` handler.

**Step 6: Expose via IPC handler**

Create `apps/frontend/src/main/ipc-handlers/memory-handlers.ts`:

```typescript
import { ipcMain } from 'electron';
import { MemoryService } from '../ai/memory/service';
import { getMemoryDb } from '../ai/memory/service';

export function registerMemoryHandlers(): void {
  const service = new MemoryService(getMemoryDb());

  ipcMain.handle('memory:insert-user-taught', async (_, content: string, projectId: string, tags: string[]) => {
    return service.insertUserTaught(content, projectId, tags);
  });
}
```

Register `registerMemoryHandlers()` in the IPC handler initialization block alongside the existing handlers.

**Step 7: Verify with unit tests**

The Phase 0 test suite should verify:
- Database file created at correct path
- All tables exist after initialization
- WAL mode active (`PRAGMA journal_mode` returns `wal`)
- `insertUserTaught` inserts a row and returns a UUID
- `insertUserTaught` twice with same content creates two separate rows (no uniqueness constraint on content)
- `closeMemoryDb` followed by `getMemoryDb` reopens without error

Phase 0 is complete when all 7 tests pass. Do not proceed to Phase 1 until the smoke tests confirm sqlite-vec loads correctly in the packaged Electron environment (run `npm run build && npm run start` and check the app startup log).

### Phase 1: Observer + Scratchpad (3-5 days)

**Prerequisites**: Phase 0 complete.

**Deliverables**:
- `MemoryObserver` class on main thread, tapping `WorkerBridge` events
- `Scratchpad2` with analytics data structures and O(1) ingestion
- Signal detection for top 5 signals: self_correction, co_access, error_retry, parallel_conflict, read_abandon
- Session-type-aware promotion gates (Build + Insights + PR Review gates minimum)
- Trust defense layer (external tool contamination check)
- Basic `observer.finalize()` with LLM synthesis call (single `generateText()`)
- Session-end summary panel (basic version, not full UX)
- Scratchpad checkpoint to disk at subtask boundaries

**Acceptance criteria**:
- Memories promoted after build QA passes but not after failures
- Self-correction signals detected in agent text stream
- Observer `observe()` consistently under 2ms per event (measured in tests)
- Scratchpad does not persist between app restarts (checkpoint restores on resume)
- No database writes during agent execution

### Phase 2: Knowledge Graph — Layer 1 (5-7 days)

**Prerequisites**: Phase 1 complete.

**Deliverables**:
- `TreeSitterLoader` with TypeScript + JavaScript + Python + Rust grammars
- `TreeSitterExtractor`: import edges, function definitions, call edges, class hierarchy
- `GraphDatabase` with node and edge CRUD
- Closure table with incremental maintenance via SQLite triggers
- `IncrementalIndexer` with chokidar file watcher and 500ms debounce
- Glean-style staleness model (`stale_at` marks on file change, async re-index)
- `analyzeImpact` tool available to agent toolset
- `getDependencies` tool available to agent toolset

**Acceptance criteria**:
- Import graph correctly extracted for Auto Claude's own TypeScript codebase
- `analyzeImpact('auth/tokens.ts')` returns direct callers within 50ms
- File change triggers re-index within 1 second
- Stale edges never appear in query results
- Cold-start indexing for the Auto Claude codebase completes in < 2 minutes

### Phase 3: Retrieval Engine (4-6 days)

**Prerequisites**: Phase 1 complete. Phase 2 not required but graph-augmented retrieval adds accuracy.

**Deliverables**:
- FTS5 BM25 search against `memories_fts`
- Dense vector search via `sqlite-vec` at 256-dim (candidates) and 1024-dim (reranking)
- RRF fusion of BM25 + dense results
- Phase-aware scoring with `PHASE_WEIGHTS` and source trust multipliers
- Volatility-aware recency decay by file extension
- Cross-encoder reranking via Qwen3-Reranker-0.6B (Ollama) for T1 and T3 retrieval
- Type-priority context packing with per-phase token budgets
- Session injection deduplication tracker
- HyDE fallback for low-result queries
- Graph-augmented expansion (adds memories from files 1-2 hops in graph from seed)

**Acceptance criteria**:
- BM25 search returns results for exact function names not surfaced by semantic search
- Phase-weighted retrieval scores gotchas > decisions during implement phase
- Context packing stays within 3000-token budget during implement phase
- RRF correctly surfaces memories that score in top-50% in both rankings

### Phase 4: Active Injection (prepareStep) (3-4 days)

**Prerequisites**: Phase 3 complete. Must have working retrieval before active injection.

**Deliverables**:
- `StepInjectionDecider` on main thread (3 triggers: gotcha_injection, scratchpad_reflection, search_short_circuit)
- `WorkerObserverProxy` IPC bridge for step-level coordination
- `prepareStep` callback integration in `runAgentSession()`
- `buildPlannerMemoryContext()` with calibration, dead-end, causal dep sections
- `buildPrefetchPlan()` for T2 file pre-loading
- `createMemoryAwareGrepTool()` for search short-circuiting
- Step injection budget management (500 tokens per injection, 4000 total cap)

**Acceptance criteria**:
- Dead-end memory injected within 2 steps of agent reading the relevant file
- Planner context includes calibration data for modules with 3+ sessions
- Step injection budget never exceeded in 100-step test sessions
- prepareStep callback latency < 50ms (measured with Electron DevTools)

### Phase 5: UX — Memory Panel (5-7 days)

**Prerequisites**: Phase 1 complete (needs memories to display). Phase 3 for Memory Chat.

**Deliverables**:
- Memory Health Dashboard with stats, module coverage bars, recent activity feed
- Module Map view (collapsible per-module cards)
- Memory Browser with search, filters, memory cards with full provenance
- Session-end summary panel (full UX from Section 13)
- MemoryCitationChip component in agent terminal output
- Correction modal
- Teach panel with all 6 entry points
- First-run experience (3 phases)
- Trust progression system (4 levels, per-project tracking)
- Agent startup "Using context from N sessions" indicator
- i18n keys for all new strings in en.json and fr.json

**Acceptance criteria**:
- Memory panel opens in < 200ms
- Session-end summary appears within 30 seconds of session end
- Citation chips render in agent terminal for memories with citation markers
- Correction modal pre-populates with correct memory when triggered from citation chip
- Trust level correctly gates injection confidence threshold per project

### Phase 6: Cloud Sync and Team Memories (7-10 days)

**Prerequisites**: Phase 5 complete. Requires cloud backend infrastructure.

**Deliverables**:
- Sync engine with local-first write semantics
- CRDT conflict resolution for concurrent edits
- Cloud migration ceremony UX
- Vectors-only privacy mode
- Team memory scoping (project/team/org)
- Team onboarding (5 most important memories for new developers)
- Team memory feed (weekly digest)
- Dispute resolution UI
- Secret scanner (runs before upload and on user_taught creation)

**Acceptance criteria**:
- Local memories survive cloud sync outage (writes to SQLite first, sync later)
- Conflict resolution presents both versions without auto-resolution on content fields
- Secret scanner blocks upload when patterns match
- New project member sees correct top-5 most important team memories

### Phase 7: Advanced Features (10-14 days)

**Prerequisites**: Phases 1-5 complete. Phase 2 (graph) for SCIP.

**Deliverables**:
- SCIP integration (`scip-typescript` subprocess, protobuf parser into graph schema)
- Layer 2 semantic LLM analysis (module boundary detection, pattern classification)
- Layer 3 knowledge edges from agent discoveries (`registerRelationshipTool`)
- Full 17-signal observer (remaining 12 signals beyond Phase 1's top 5)
- Cross-session synthesis engine (all 3 modes: incremental, threshold, weekly)
- A/B testing framework with control group assignment
- Phase weight optimization (DSPy-inspired, requires 30+ sessions)
- Memory health audit (weekly cleanup card in dashboard)
- Kuzu migration tooling (detection + UI prompt when thresholds exceeded)

**Acceptance criteria**:
- SCIP-derived cross-references enable go-to-definition accuracy matching VS Code
- Louvain community detection produces module boundaries matching developer's mental model (manual review for 5 representative projects)
- Cross-session synthesis at session 5 threshold produces at least 1 non-trivial memory for Auth module (tested with recorded session data)
- A/B test control group correctly receives zero memory injections

---

## 21. Open Questions

1. **Graphiti coordination**: The Python Graphiti sidecar and the TypeScript Knowledge Graph now partially overlap. Graphiti provides entity-relationship memory over conversations; the Knowledge Graph provides structural code intelligence. Should they share the same node identity scheme? When an agent discovers a relationship via Graphiti, should it also appear in the TypeScript graph? Recommendation: keep separate but define a sync protocol for high-confidence Graphiti entity facts to appear as Layer 3 Knowledge nodes.

2. **Embedding model upgrade path**: When the user upgrades from `qwen3-embedding:4b` to `qwen3-embedding:8b`, existing 1024-dim embeddings are compatible at the 1024-dim MRL level, but accuracy may differ. Should we re-embed on upgrade? Background re-embedding job seems right, but needs UI indication and abort path.

3. **Scratchpad note granularity for large pipelines**: For a 40-subtask build, the scratchpad accumulates notes from all 40 subtasks before finalize(). Incremental promotion at subtask boundaries helps, but the line between "scratchpad during execution" and "permanent memory after validation" blurs when subtask N's memory is available to subtask N+1. Clarify the exact gate: does a promoted subtask memory require its own QA pass, or is promotion from the subtask-level sufficient?

4. **Tree-sitter vs. ts-morph for TypeScript function call extraction**: tree-sitter can extract syntactic call sites but cannot resolve which function is being called across modules (requires type information). ts-morph has full TypeScript compiler resolution but is much slower. The SCIP integration path (Phase 7) resolves this for TypeScript, but what is the intermediate answer for Phases 2-6? Recommendation: tree-sitter for speed in Phases 2-6, SCIP for precision in Phase 7, with a quality flag on edges marking them as `source: "ast"` vs `source: "scip"`.

5. **Phase weight learning triggering**: Phase 7 proposes learning `PHASE_WEIGHTS` from session outcomes. How often should this run? What is the minimum session count before the learned weights are trustworthy? Recommendation: run monthly, minimum 100 sessions per (phase, memory_type) combination, show diff to user before applying, require explicit approval.

6. **Memory scope for terminal sessions**: Terminal sessions are interactive and often diverge from the current task context. Should terminal session memories be scoped to the current project or the user globally? Currently: project-scoped. Concern: a terminal session that discovers a gotcha about a project convention is project-specific, but a terminal session that discovers a system-level issue (e.g., macOS permission error) is global. Recommendation: project-scoped by default, user can manually scope to global via Teach panel.

7. **Team memory conflict with local personal memory**: If a team decision memory says "use PostgreSQL" and a developer's personal memory says "this client project uses SQLite," which takes priority? Recommendation: personal memories override project memories override team memories in retrieval scoring when the personal memory has higher confidence and is more recent. Never silently suppress team memories — surface both with attribution.

8. **Closure table growth for very large codebases**: For a project with 5000+ files and high connectivity, the closure table can grow quadratically. The migration threshold to Kuzu is set at 50K nodes / 500MB / 100ms P99. Should we disable deep closure (>3 hops) earlier, replacing with lazy recursive CTEs? Recommendation: disable pre-computed closure for depth > 2 when closure table exceeds 100MB. Lazy CTE handles 80% of queries adequately.

9. **Parallel subagent memory visibility**: Currently, parallel subagents read from permanent memory (shared, read-only) but cannot see each other's in-progress scratchpad entries. This is correct for isolation, but it means if subagent A and B are both about to make the same mistake, B doesn't benefit from A's real-time discovery. The quorum merger at pipeline end is too late. Consider a read-only "live scratchpad view" that all parallel subagents can query via IPC — their scratchpad entries are visible to peers but not writable by them.

10. **Cold-start graph indexing UX**: The first time a project opens, tree-sitter cold-start takes 30-60 seconds for medium projects and up to 20 minutes for very large projects. This is tolerable as a background process, but the UX must not block agent sessions during indexing. Agents should start with `source: "ast"` edges unavailable and get progressively better impact analysis as indexing completes. How do we communicate partial index state to the agent? Recommendation: prepend `[Knowledge Graph: indexing in progress — impact analysis may be incomplete]` to the first 3 agent sessions after project open.

---

*Document version: V4.0 — 2026-02-22*
*Authors: Consolidated from V3 Draft + Hackathon Teams 1 (Observer), 2 (Retrieval), 3 (Knowledge Graph), 4 (UX), 5 (Agent Loop)*
*Next review: After Phase 2 implementation complete*
