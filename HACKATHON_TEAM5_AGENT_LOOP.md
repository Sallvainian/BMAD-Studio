# HACKATHON TEAM 5: Memory-Augmented Agent Loop
## How Memory Fundamentally Transforms How AI Coding Agents Work

*Date: 2026-02-22 | Author: Team 5 — Principal Architect Agent (Enhanced V2)*
*Builds on: Team 5 V1 (2026-02-21) + V3 Draft + Multi-Agent Framework Research*

---

## Executive Summary

The original Team 5 document drew the right distinction between passive and active memory. This enhanced version goes further: it treats active memory not as a feature layer on top of the agent loop, but as a fundamental architectural primitive that must be designed into the `streamText()` call chain from the beginning.

The central thesis upgrade: V3 Draft and Team 5 V1 both treat memory injection as a pre-session operation — context is assembled before `streamText()` is called, injected into the system prompt and initial messages, and then the agent runs. Mid-session, the agent can call `search_memory` to pull more context on demand.

This document argues for a third layer that neither V3 nor V1 fully designed: **the `prepareStep` injection hook**, which makes memory an active participant in every step of the agent loop — not just at session start and not just on explicit agent request. This is the difference between a secretary who briefs you once before a meeting and one who passes you relevant notes throughout the meeting as new topics arise.

The second major addition is a comprehensive worker thread architecture for the memory observer: IPC message types, latency budgets, parallel subagent scratchpad isolation, and the promotion pipeline across thread boundaries. This makes the V3 scratchpad model concrete and implementable.

---

## Passive vs. Active vs. Reactive Memory: The Three Tiers

| Tier | When | Mechanism | V3 Coverage |
|------|------|-----------|-------------|
| Passive | Session start | System prompt + initial message injection | Covered |
| Reactive | Mid-session, agent-requested | `search_memory` tool available in agent's toolset | Covered |
| Active | Mid-session, system-initiated | `prepareStep` callback injects relevant memories per step | NOT yet covered |

The active tier is the innovation in this document. It enables:

- The system to inject a `dead_end` memory the moment the agent reads the file it previously failed on, before the agent makes the same mistake
- The system to recognize when the agent is about to grep for a pattern it already has in memory and short-circuit with the answer
- The system to inject a workflow recipe step-by-step as the agent progresses through that exact workflow, validating each step matches the pattern

---

## 1. Multi-Agent Memory Systems Survey

Understanding how established frameworks handle memory between agents informs what Auto Claude should adopt, adapt, or reject.

### 1.1 CrewAI: Shared Memory Architecture

CrewAI implements a four-tier memory model shared across all agents in a crew:

- **Short-term memory**: ChromaDB with RAG, scoped to the current session. All agents in the crew can read and write. Stores recent interactions, tool results, and intermediate outputs.
- **Long-term memory**: SQLite3 for task results and knowledge that persists across sessions. A "crew" accumulates knowledge that any future crew execution can access.
- **Entity memory**: RAG-indexed facts about people, systems, and concepts encountered during execution. Shared across the crew — agent A's discovery about a system component is immediately available to agent B.
- **Contextual memory**: The synthesized combination of the above, reassembled into a coherent context block for each agent turn.

**Key lesson for Auto Claude**: CrewAI's shared memory is optimistic about conflict — agents write to the same store without locking. This works because CrewAI's agents are typically sequential (one writes, the next reads) rather than truly parallel. For Auto Claude's parallel subagents, optimistic writes would cause interleaving corruption. Auto Claude needs scoped scratchpads per subagent (designed below).

**Key lesson — entity memory**: CrewAI's concept of entity memory is underrepresented in V3. If one agent discovers that `auth/middleware.ts` has a circular dependency, that discovery should be indexable as an entity fact about `auth/middleware.ts` — not just as a general memory about the auth module. This enables file-level retrieval precision.

### 1.2 LangGraph: Checkpoint-Based Memory Persistence

LangGraph's memory model is built on its checkpointing system:

- **Thread-scoped state (short-term)**: Every graph step produces a checkpoint of the full graph state using `MemorySaver` (dev) or `SqliteSaver`/`PostgresSaver` (production). The state includes the full message history for the current thread.
- **Cross-thread stores (long-term)**: Long-term memory is implemented as a separate persistent store that any thread can read from and write to. It is namespaced by custom keys — the namespace hierarchy mirrors memory scoping (global, module, work-unit).
- **Human-in-the-loop via checkpoint inspection**: Because every step is checkpointed, human reviewers can inspect the exact graph state at any step, approve or modify, and resume. This is the pattern Auto Claude's pause-handler should adopt — checkpointing agent state before pause allows resumption from the exact step rather than re-running.

**Key lesson for Auto Claude**: LangGraph's most useful insight is that long-term memory is just a namespaced key-value store layered on top of the checkpoint system — it is not architecturally separate from session state. The V3 Draft keeps these separate (SQLite for long-term, in-memory scratchpad for session). The LangGraph approach suggests the scratchpad should be checkpointed to disk on every subtask completion, not just held in memory. This makes it durable across Electron restarts.

**Key lesson — checkpointing before pause**: When a user pauses a long-running build, LangGraph restores from the last checkpoint. Auto Claude should write a checkpoint of the `MemoryObserver` scratchpad to disk at each subtask boundary. On resume, the scratchpad is restored and execution continues from where it left off rather than re-observing from scratch.

### 1.3 AutoGen: Event-Driven Memory with Delta Proposals

AutoGen v0.4 took a fundamentally different architectural approach to multi-agent memory. Rather than a shared mutable store, it uses an event-driven model where agents emit state deltas and a conflict resolution layer applies them:

- **Isolated agent buffers**: Each agent maintains its own private memory buffer. Agents do not directly read each other's state.
- **Delta proposals**: When an agent makes a discovery relevant to the team, it emits a delta event. The orchestrator applies or rejects it to the shared context.
- **Conflict resolution**: First-writer-wins for low-risk operations. Quorum voting (majority of agents must agree) for critical decisions that affect other agents' plans.
- **Observable state**: AutoGen's strong observability model logs every state delta with timestamps and agent attribution — the audit trail is a first-class citizen.

**Key lesson for Auto Claude**: AutoGen's insight that state desynchronization between parallel agents is the primary cause of phantom regressions is directly applicable. When three coders work in parallel on different subtasks, their file access patterns can conflict (agent A modifies `auth.ts` while agent B writes a test that imports a function from `auth.ts` that agent A just renamed). The solution is not shared memory — it is isolated scratchpads with a merge step. The `SemanticMerger` already handles file-level conflicts; the memory system needs a scratchpad merge step that runs before `observer.finalize()`.

**Key lesson — quorum for memory promotion**: When 3 parallel subagents all independently observe the same pattern (e.g., all three agents had to update `middleware/rate-limiter.ts` when touching auth), that convergent observation is high-confidence evidence. Quorum confirmation of a pattern observation should lower the frequency threshold for promotion from 3 sessions to 1 session with multi-agent quorum.

### 1.4 DSPy: Compiled Programs with Learned Memory Access

DSPy's approach to memory is fundamentally different from retrieval augmentation — it treats memory access as a learned program that can be optimized:

- **Modules with signatures**: A memory retrieval step is a DSPy module with a typed signature: `MemoryQuery(task_description, agent_phase) -> relevant_memories`. The module's retrieval strategy is a parameter that can be optimized via DSPy's teleprompter.
- **Teleprompter optimization**: Given a set of example sessions (input task, agent actions, success/failure outcome), DSPy can optimize the retrieval strategy — learning which memory types to prioritize for which task types, what similarity threshold to use, how many results to inject.
- **Mem0 integration**: DSPy's `ReAct` framework integrates with Mem0's memory layer, enabling agents to store, search, and retrieve memories using a standardized interface with automatic relevance ranking.

**Key lesson for Auto Claude**: DSPy's most applicable insight is that the `PHASE_WEIGHTS` table in V3's retrieval engine is a manually tuned parameter that could be learned automatically. After 30+ sessions, Auto Claude has enough signal to run a DSPy-style optimization pass: "which memory types most strongly correlated with QA first-pass success for each phase?" The weights should become data-driven. This is a Phase 3 feature but the data collection for it starts now.

**Key lesson — typed retrieval signatures**: V3's retrieval interface is flexible but untyped. DSPy's signature approach would make memory retrieval calls self-documenting: `PlannerMemoryQuery`, `CoderMemoryQuery`, `QAMemoryQuery` each has typed inputs and outputs, making it easier to reason about what each agent phase actually fetches and optimize it independently.

### 1.5 Semantic Kernel: Whiteboard + Long-Term Memory

Microsoft's Semantic Kernel introduces the "whiteboard" concept for multi-agent memory sharing:

- **Whiteboard (short-term shared)**: A shared mutable document that all agents in a session can read and write. The whiteboard maintains requirements, proposals, decisions, and actions extracted from each message turn.
- **Mem0 integration (long-term)**: Long-term memory uses Mem0 as an external store. Each agent can read from and write to Mem0 independently.
- **Plugin isolation trap**: A known failure mode in Semantic Kernel is that when multiple agents share a kernel instance, they accidentally share plugins (tools). The fix is kernel cloning per agent — each agent gets its own tool namespace.

**Key lesson for Auto Claude**: The whiteboard pattern maps directly to what V3 calls the scratchpad — a shared temporary document that accumulates the session's discoveries before any are promoted to permanent memory. The whiteboard-as-shared-state model is compelling for single-session multi-agent pipelines (planner → coder → QA all working in the same build run). The V3 scratchpad is currently agent-private. Making it readable across the pipeline (planner's discoveries available to the coder without going through permanent memory) would improve intra-pipeline knowledge flow.

**Key lesson — plugin isolation for agents**: This directly applies to Auto Claude's worker thread model. Each worker thread must have an independent tool registry. Memory tools in particular must be worker-local (scratchpad read/write goes through the worker's IPC channel, not a shared in-process object).

### 1.6 Mem0: Universal Memory Layer as Infrastructure

Mem0 positions itself as a provider-agnostic memory infrastructure layer. Key architectural patterns from Mem0's April 2025 paper (arXiv:2504.19413):

- **Dynamic extraction**: Rather than waiting for the agent to explicitly call `remember_this`, Mem0 continuously processes conversation turns to extract salient facts, consolidate with existing memories, and prune redundant entries.
- **Causal relationship tracking**: Mem0 tracks causal relationships between stored facts — not just "what" but "what caused what." This maps directly to V3's `causal_dependency` memory type.
- **Personalization layer**: For coding agents, "personalization" translates to codebase-specific preferences and patterns. The agent's behavioral history with a specific codebase becomes its personalization profile.

**Key lesson for Auto Claude**: Mem0's dynamic extraction is worth implementing for the memory observer. Rather than only observing tool calls (behavioral signals), the observer should also process the agent's reasoning text (`text-delta` events) for explicit memory candidates. When the agent says "I need to update the rate limiter whenever I touch auth" in its reasoning, that statement is a high-confidence `causal_dependency` candidate — more reliable than inferring it from co-access patterns.

---

## 2. Active Memory Design

### 2.1 Memory-Guided Planning: How Memory Changes Plans

The planner agent produces an implementation plan based on the task description, the spec, and available context. Without memory, it relies entirely on current codebase analysis and the LLM's general knowledge. With memory, it has empirical evidence from past executions of similar tasks in this specific codebase.

Three categories of past execution evidence transform planning:

**Category 1: Unexpected File Discoveries (Impact Radius Memory)**

When implementing an auth task in task #31, the coder touched `middleware/rate-limiter.ts` even though it was not in the plan. The observer records this as a `causal_dependency` between the auth module and the rate limiter. When the planner plans the next auth task, it reads:

```
[CAUSAL DEPENDENCY] authentication → middleware/rate-limiter.ts
Observed in 3 sessions: when auth logic changes, rate-limiter.ts
requires coordinated updates (import paths, token validation interface).
Confidence: 0.82 | Last observed: task #37

Recommendation: Include middleware/rate-limiter.ts in implementation scope
for any auth-related task.
```

The planner adds rate-limiter.ts to the implementation plan before the coder starts. Zero surprise mid-implementation.

**Category 2: Effort Calibration (Task Calibration Memory)**

The payment module has been consistently underestimated across 4 tasks. The calibration memory says:

```
[CALIBRATION] payment module
Average actual/planned step ratio: 3.1x over 4 tasks.
Most recent: task #39, planned 20 subtasks, required 61 steps.
Common underestimation sources: Redis mocking setup (adds 8+ steps),
Stripe webhook signature validation testing (adds 12+ steps).
```

The planner incorporates this empirically. Rather than writing "3 subtasks for payment integration," it writes "9 subtasks for payment integration (calibration factor: 3.1x for this module)." This is the highest-ROI planning improvement available.

**Category 3: Dead-End Avoidance (Dead-End Memory in Planning)**

The planner's DEFINE phase retrieval gives `dead_end` memories a weight of 1.2 (V3 PHASE_WEIGHTS). The planner reads:

```
[DEAD END] Task #41 — authentication, session storage
Approach tried: Store sessions in Redis for horizontal scaling.
Why it failed: Redis is not available in the test environment. Tests
time out after 30 seconds. CI pipeline fails. No workaround found.
Alternative used: SQLite for local test, Redis only in production
via NODE_ENV check. This adds complexity but works.
Confidence: 0.95 | Decay: 90 days
```

The planner writes this constraint directly into the implementation plan's constraints section. The coder receives it as an explicit constraint — not through injected memory, but through the plan itself. Memory has shaped the artifact the coder works from.

**Implementation — Planner Context Assembly**

```typescript
// apps/frontend/src/main/ai/orchestration/planner-context.ts

export async function buildPlannerMemoryContext(
  taskDescription: string,
  relevantModules: string[],
  memoryService: MemoryService,
): Promise<string> {
  const phase: UniversalPhase = 'define';

  // Parallel retrieval of all planning-relevant memory types
  const [calibrations, deadEnds, causalDeps, workUnitOutcomes, workflowRecipes] =
    await Promise.all([
      memoryService.search({
        types: ['task_calibration'],
        relatedModules: relevantModules,
        limit: 5,
        minConfidence: 0.6,
      }),
      memoryService.search({
        types: ['dead_end'],
        relatedModules: relevantModules,
        limit: 8,
        minConfidence: 0.6,
      }),
      memoryService.search({
        types: ['causal_dependency'],
        relatedModules: relevantModules,
        limit: 10,
        minConfidence: 0.65,
      }),
      memoryService.search({
        types: ['work_unit_outcome'],
        relatedModules: relevantModules,
        limit: 5,
        minConfidence: 0.5,
        sort: 'recency',
      }),
      memoryService.searchWorkflowRecipe(taskDescription, { limit: 2 }),
    ]);

  const sections: string[] = [];

  if (workflowRecipes.length > 0) {
    sections.push(formatWorkflowRecipes(workflowRecipes));
  }

  if (deadEnds.length > 0) {
    sections.push(formatDeadEndsForPlanner(deadEnds));
  }

  if (calibrations.length > 0) {
    sections.push(formatCalibrationsForPlanner(calibrations, relevantModules));
  }

  if (causalDeps.length > 0) {
    sections.push(formatCausalDepsForPlanner(causalDeps));
  }

  if (workUnitOutcomes.length > 0) {
    sections.push(formatOutcomesForPlanner(workUnitOutcomes));
  }

  return sections.join('\n\n');
}

function formatCalibrationsForPlanner(
  calibrations: TaskCalibration[],
  modules: string[],
): string {
  const lines = ['## MODULE COMPLEXITY CALIBRATION'];
  lines.push(
    'Based on past sessions, adjust subtask estimates by these factors:\n',
  );

  for (const cal of calibrations) {
    const direction =
      cal.ratio > 1.2
        ? `UNDERESTIMATED (${cal.ratio.toFixed(1)}x actual vs planned)`
        : cal.ratio < 0.8
          ? `OVERESTIMATED (${cal.ratio.toFixed(1)}x ratio)`
          : 'ACCURATE';
    lines.push(
      `- **${cal.module}**: ${direction} | ` +
        `avg ${cal.averageActualSteps} actual vs ${cal.averagePlannedSteps} planned steps | ` +
        `${cal.sampleCount} sessions`,
    );
  }

  return lines.join('\n');
}

function formatDeadEndsForPlanner(deadEnds: DeadEndMemory[]): string {
  const lines = ['## APPROACHES TO AVOID (DEAD ENDS)'];
  lines.push(
    'These approaches have been tried and failed in this codebase. ' +
      'Do NOT plan to use them:\n',
  );

  for (const de of deadEnds) {
    lines.push(
      `**[${de.taskContext}]** Tried: ${de.approachTried}\n` +
        `Why it failed: ${de.whyItFailed}\n` +
        `Use instead: ${de.alternativeUsed}\n`,
    );
  }

  return lines.join('\n');
}
```

### 2.2 Dead-End Avoidance: Preventing Known Failures

Dead-end avoidance operates at two points in the pipeline:

1. **Planning phase**: Dead-end memories are injected into the planner's context so the plan itself avoids the known-bad approach (designed above).
2. **Execution phase**: When the coder begins working on a file that is associated with a dead-end memory, the dead-end is proactively injected into the tool result — the agent sees the warning before it makes the mistake.

The second mechanism is the `interceptToolResult` function from V3 Section 7. The critical design question is: how does the system know the agent is about to try a dead-end approach versus legitimately doing something different?

The answer is probabilistic, not deterministic. The dead-end memory is always injected when the agent reads the relevant file. The agent then reasons about whether the current situation matches the dead-end context. This is the right tradeoff: a false positive (injecting a dead-end warning when the agent was doing something different) adds a few tokens of context. A false negative (failing to inject when the agent is about to repeat the failure) costs an entire QA cycle.

**Dead-End Memory Lifecycle**

```typescript
// Dead-end promotion: only when approach is genuinely wrong, not when
// implementation had a trivial bug.

function shouldPromoteAsDeadEnd(
  backtrackSignal: BacktrackSignal,
  sessionContext: SessionObserverContext,
): boolean {
  // Must have explored the approach for at least 20 steps before abandoning.
  // Short backtracks (< 5 steps) are implementation corrections, not strategy failures.
  if (backtrackSignal.reEditedWithinSteps < 20) return false;

  // Must have been followed by a fundamentally different approach.
  // We detect this by checking if the post-backtrack file access pattern
  // diverges significantly from the pre-backtrack pattern.
  const preBranchFiles = sessionContext.getFilesAccessedBefore(backtrackSignal);
  const postBranchFiles = sessionContext.getFilesAccessedAfter(backtrackSignal);
  const overlap = setIntersection(preBranchFiles, postBranchFiles).size;
  const divergence =
    1 - overlap / Math.max(preBranchFiles.size, postBranchFiles.size);

  // High divergence = genuinely different approach taken.
  return divergence > 0.6;
}
```

**Dead-End Discovery from Agent Reasoning**

Beyond behavioral signals, the observer should also monitor agent reasoning text (the `reasoning` event type from `fullStream`) for explicit dead-end language. Phrases like "this approach won't work because...", "I need to abandon this and try...", "the issue is that X is unavailable" are strong signals.

```typescript
// In MemoryObserver.onReasoningDelta():
const DEAD_END_LANGUAGE_PATTERNS = [
  /this approach (won't|will not|cannot) work/i,
  /I need to abandon this/i,
  /let me try a different approach/i,
  /this is a dead end/i,
  /unavailable in (test|ci|production)/i,
  /not available in this environment/i,
];

function detectDeadEndReasoning(reasoningText: string): boolean {
  return DEAD_END_LANGUAGE_PATTERNS.some((pattern) =>
    pattern.test(reasoningText),
  );
}
```

When dead-end language is detected in reasoning, the observer immediately creates a high-priority scratchpad entry for synthesis into a `dead_end` memory at finalization time.

### 2.3 Predictive Pre-Loading: Anticipating What Agents Need

The V1 Team 5 document designed this at a high level. This section provides the complete implementation including the token budget management that V1 omitted.

**The Pre-Load Decision Algorithm**

Not all pre-fetched files are equal. Pre-loading the wrong files wastes context window space. The algorithm must:

1. Only pre-load files with high session coverage (>80% of past sessions for this module)
2. Apply a token budget so pre-fetching never consumes more than 25% of the context window
3. Prioritize files by access order in past sessions (files accessed earlier are more likely to be needed first)
4. Skip files that are already likely in the agent's system prompt (spec files, plan files)

```typescript
// apps/frontend/src/main/ai/session/memory-prefetch.ts

const MAX_PREFETCH_TOKENS = 32_000;  // ~25% of 128K context window
const MAX_PREFETCH_FILES = 12;

export async function buildPrefetchPlan(
  relevantModules: string[],
  taskDescription: string,
  memoryService: MemoryService,
  alreadyInjectedPaths: Set<string>,
): Promise<PrefetchPlan> {
  const patterns = await memoryService.search({
    types: ['prefetch_pattern'],
    relatedModules: relevantModules,
    limit: 10,
  }) as PrefetchPattern[];

  if (patterns.length === 0) {
    return { files: [], estimatedTokensSaved: 0 };
  }

  // Collect candidates with their priority score
  const candidates: Array<{ path: string; score: number; avgAccessStep: number }> = [];

  for (const pattern of patterns) {
    // alwaysReadFiles: >80% session coverage — highest priority
    for (const [index, filePath] of pattern.alwaysReadFiles.entries()) {
      if (!alreadyInjectedPaths.has(filePath)) {
        candidates.push({
          path: filePath,
          score: 1.0 - (index * 0.05),  // Earlier files score higher
          avgAccessStep: index + 1,
        });
      }
    }

    // frequentlyReadFiles: >50% coverage — lower priority
    for (const [index, filePath] of pattern.frequentlyReadFiles.entries()) {
      if (!alreadyInjectedPaths.has(filePath)) {
        candidates.push({
          path: filePath,
          score: 0.6 - (index * 0.05),
          avgAccessStep: pattern.alwaysReadFiles.length + index + 1,
        });
      }
    }
  }

  // Sort by score descending, deduplicate
  const seen = new Set<string>();
  const sorted = candidates
    .filter((c) => {
      if (seen.has(c.path)) return false;
      seen.add(c.path);
      return true;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_PREFETCH_FILES);

  // Read files and apply token budget
  const files: PrefetchedFile[] = [];
  let totalTokens = 0;

  for (const candidate of sorted) {
    const content = await safeReadFile(candidate.path);
    if (!content) continue;

    const estimatedTokens = Math.ceil(content.length / 4);  // Rough chars-to-tokens
    if (totalTokens + estimatedTokens > MAX_PREFETCH_TOKENS) {
      // Try a truncated version for larger files
      if (estimatedTokens > 8_000) {
        const truncated = content.slice(0, 24_000);  // ~6K tokens
        files.push({ path: candidate.path, content: truncated, truncated: true });
        totalTokens += 6_000;
      }
      continue;
    }

    files.push({ path: candidate.path, content, truncated: false });
    totalTokens += estimatedTokens;
  }

  // Estimated savings: each pre-fetched file avoids ~2.5 tool call round-trips
  // (Read + potential Grep + potential second Read) × ~800 tokens per round-trip
  const estimatedTokensSaved = files.length * 2_000;

  return { files, totalTokens, estimatedTokensSaved };
}
```

**Measuring Pre-Fetch Effectiveness**

The key metric is the early-read suppression rate: if the agent reads a pre-fetched file in its first 30 steps via the `Read` tool, the pre-fetch failed (the agent didn't notice the pre-loaded content). A successful pre-fetch means the agent references the file's content without calling `Read` for it.

This is measurable from the tool call log: count `Read` calls in the first 30 steps for paths that were pre-fetched. Target: fewer than 15% of pre-fetched files should be re-read in the discovery phase.

### 2.4 Tool-Use Optimization: Reducing Redundant Tool Calls

Beyond file pre-fetching, memory can optimize specific tool usage patterns:

**Pattern: Convention-Aware Tool Call Shaping**

When the memory store contains a convention about this project's codebase structure, injecting it into the session start prevents the agent from discovering it through failed tool calls:

```
[CONVENTION] Search scope
This project has 180K+ files. Glob patterns without path scope take >15 seconds.
Always scope to: apps/frontend/src/ or apps/backend/
Pattern: Glob({ pattern: "**/*.ts", path: "apps/frontend/src" })
NOT: Glob({ pattern: "**/*.ts" })
```

**Pattern: Memory-Aware Tool Wrapper**

The most powerful tool optimization is wrapping the tool's `execute` function to check memory before running the actual tool. For `Grep` in particular:

```typescript
// apps/frontend/src/main/ai/tools/memory-aware-grep.ts

export function createMemoryAwareGrepTool(
  memoryService: MemoryService,
  sessionId: string,
): AITool {
  return tool({
    description:
      'Search file contents for a pattern. Memory will short-circuit if the result is already known.',
    inputSchema: z.object({
      pattern: z.string(),
      path: z.string().optional(),
      glob: z.string().optional(),
    }),
    execute: async ({ pattern, path, glob }) => {
      // Check if we have a cached/known result for this grep pattern in this project.
      // This catches cases like "grep for the IPC handler registration pattern"
      // which the agent does in nearly every session.
      const cacheKey = `grep:${pattern}:${path ?? ''}:${glob ?? ''}`;
      const cached = await memoryService.searchByKey(cacheKey, {
        maxAgeDays: 7,  // Convention greps are stable for a week
        minConfidence: 0.8,
      });

      if (cached) {
        // Return the cached result with a memory citation
        return `${cached.content}\n\n<!-- Memory citation [${cached.id.slice(0, 8)}]: Result cached from session ${cached.sessionId} -->`;
      }

      // Execute the actual grep
      const result = await executeGrep({ pattern, path, glob });

      // Store the result as a potential convention memory if the pattern
      // looks like a structural query (not a one-off search).
      if (isStructuralPattern(pattern)) {
        await memoryService.addToScratchpad(sessionId, {
          type: 'grep_result_candidate',
          key: cacheKey,
          content: result,
          pattern,
        });
      }

      return result;
    },
  });
}

function isStructuralPattern(pattern: string): boolean {
  // Structural patterns are about project conventions, not task-specific values.
  // These are worth caching: "registerIpcHandler", "ipcMain.handle",
  // "useTranslation", "createStore", etc.
  // Not worth caching: specific variable names, feature-specific strings.
  const STRUCTURAL_INDICATORS = [
    'register',
    'Handler',
    'Store',
    'Context',
    'Provider',
    'ipcMain',
    'ipcRenderer',
    'electronAPI',
  ];
  return STRUCTURAL_INDICATORS.some((indicator) => pattern.includes(indicator));
}
```

---

## 3. Worker Thread Architecture

### 3.1 Thread Topology

```
MAIN THREAD (Electron main process)
├── WorkerBridge (per task)
│   ├── MemoryObserver (listens to all worker messages)
│   ├── MemoryService (reads from + writes to SQLite)
│   ├── ScratchpadStore (in-memory per task, flushed to disk at subtask boundaries)
│   └── Worker (worker_threads.Worker)
│       │
│       │ postMessage() → IPC
│       │
│       WORKER THREAD
│       ├── runAgentSession() → streamText()
│       ├── Tool executors (Read, Write, Edit, Bash, Grep, Glob)
│       └── Memory tools:
│           ├── search_memory → IPC to main thread → MemoryService
│           ├── record_memory → IPC to main thread → Scratchpad (not permanent)
│           └── get_session_context → local (no IPC needed)
```

For parallel subagents (multiple coders working on different subtasks simultaneously):

```
MAIN THREAD
├── WorkerBridge-A (subagent A, subtask 1)
│   ├── MemoryObserver-A
│   └── ScratchpadStore-A (isolated)
│       └── Worker-A
├── WorkerBridge-B (subagent B, subtask 2)
│   ├── MemoryObserver-B
│   └── ScratchpadStore-B (isolated)
│       └── Worker-B
└── WorkerBridge-C (subagent C, subtask 3)
    ├── MemoryObserver-C
    └── ScratchpadStore-C (isolated)
        └── Worker-C

After all subagents complete:
ParallelScratchpadMerger.merge([ScratchpadA, ScratchpadB, ScratchpadC])
  → deduplicate
  → resolve conflicts (quorum voting for convergent observations)
  → unified scratchpad for observer.finalize()
```

### 3.2 IPC Message Types

All messages crossing the worker boundary follow a typed discriminated union. Memory-related messages are a sub-protocol within the existing `WorkerMessage` type:

```typescript
// apps/frontend/src/main/ai/agent/types.ts — memory IPC additions

export type MemoryIpcRequest =
  | {
      type: 'memory:search';
      requestId: string;    // UUID for response correlation
      query: string;
      filters: {
        types?: MemoryType[];
        relatedModules?: string[];
        relatedFiles?: string[];
        phase?: UniversalPhase;
        limit?: number;
        minConfidence?: number;
      };
    }
  | {
      type: 'memory:record';
      requestId: string;
      entry: {
        type: MemoryType;
        content: string;
        tags: string[];
        relatedFiles?: string[];
        relatedModules?: string[];
        source: 'agent_explicit';
      };
    }
  | {
      type: 'memory:tool-call';
      toolName: string;
      args: Record<string, unknown>;
      stepIndex: number;
      timestamp: number;
    }
  | {
      type: 'memory:tool-result';
      toolName: string;
      args: Record<string, unknown>;
      result: string;
      durationMs: number;
      isError: boolean;
      stepIndex: number;
    }
  | {
      type: 'memory:reasoning';
      text: string;
      stepIndex: number;
    }
  | {
      type: 'memory:step-complete';
      stepIndex: number;
      toolCalls: number;
      textOutput: string;
    }
  | {
      type: 'memory:session-complete';
      outcome: SessionOutcome;
      stepsExecuted: number;
      accessedFiles: string[];
    };

export type MemoryIpcResponse =
  | {
      type: 'memory:search-result';
      requestId: string;
      memories: Memory[];
      error?: string;
    }
  | {
      type: 'memory:record-result';
      requestId: string;
      scratchpadId: string;    // ID in scratchpad, not permanent memory
      error?: string;
    }
  | {
      type: 'memory:intercept';
      // Main thread can push intercept payloads to augment tool results
      // This is the mechanism for proactive gotcha injection and prepareStep memory
      targetToolCall: string;       // Tool call ID to augment
      injectedContent: string;      // Memory content to append to tool result
      citationIds: string[];        // Memory IDs cited
    };
```

### 3.3 Latency Budget

IPC round-trips between worker and main thread have real latency. For memory operations, the budget must be understood:

| Operation | Expected Latency | Budget | Strategy |
|-----------|-----------------|--------|----------|
| `memory:search` (exact match) | 1-5ms | 10ms | Direct SQLite query |
| `memory:search` (vector similarity) | 10-30ms | 50ms | Async, non-blocking |
| `memory:record` (to scratchpad) | <1ms | 5ms | In-memory write only |
| `memory:tool-call` (fire-and-forget) | N/A | 0ms budget | No acknowledgment needed |
| `memory:tool-result` (fire-and-forget) | N/A | 0ms budget | No acknowledgment needed |
| Proactive gotcha injection | 20-50ms | 100ms | Must complete before tool result returned to model |

The critical path is the proactive gotcha injection: when the agent calls `Read` on a file, the main thread must query memory, find relevant gotchas, and augment the tool result — all before the augmented result is sent back to the worker and passed to `streamText()`. The 100ms budget is achievable with indexed SQLite queries.

For the `search_memory` tool (agent-initiated, reactive), the latency is less critical because the agent has already committed to a reasoning step that involves memory search. 50ms is acceptable and imperceptible in the context of an LLM streaming response.

**Preventing IPC-Induced Stalls**

The main failure mode for IPC in Electron is synchronous IPC (which blocks the main thread and renders UI unresponsive). All memory IPC must be asynchronous:

```typescript
// Worker side: search_memory tool execute function
execute: async ({ query, filters }) => {
  return new Promise<string>((resolve, reject) => {
    const requestId = crypto.randomUUID();

    // Register response handler before sending request
    const responseHandler = (response: MemoryIpcResponse) => {
      if (
        response.type === 'memory:search-result' &&
        response.requestId === requestId
      ) {
        parentPort?.off('message', responseHandler);
        clearTimeout(timeout);
        if (response.error) {
          resolve(`Memory search failed: ${response.error}. Proceed without memory context.`);
        } else {
          resolve(formatMemoriesForAgent(response.memories));
        }
      }
    };

    // Timeout prevents blocking the agent loop indefinitely
    const timeout = setTimeout(() => {
      parentPort?.off('message', responseHandler);
      resolve('Memory search timed out. Proceed without memory context.');
    }, 3_000);

    parentPort?.on('message', responseHandler);
    parentPort?.postMessage({
      type: 'memory:search',
      requestId,
      query,
      filters,
    } satisfies MemoryIpcRequest);
  });
}
```

### 3.4 Parallel Subagent Scratchpad Isolation

When three subagents run in parallel, they must not share a scratchpad. Each WorkerBridge maintains its own `ScratchpadStore`. After all subagents complete, the `ParallelScratchpadMerger` runs:

```typescript
// apps/frontend/src/main/ai/memory/parallel-scratchpad-merger.ts

export class ParallelScratchpadMerger {
  merge(scratchpads: ScratchpadStore[]): MergedScratchpad {
    const allEntries = scratchpads.flatMap((s, idx) =>
      s.getAll().map((entry) => ({ ...entry, sourceAgentIndex: idx })),
    );

    // Deduplicate: entries with >0.88 semantic similarity are the same observation
    const deduplicated = this.deduplicateByContent(allEntries);

    // Quorum resolution: entries observed by 2+ agents independently get a
    // confidence boost and lowered promotion threshold.
    const withQuorum = deduplicated.map((entry) => {
      const confirmedBy = allEntries.filter(
        (e) =>
          e.sourceAgentIndex !== entry.sourceAgentIndex &&
          this.contentSimilarity(e.content, entry.content) > 0.85,
      );
      return {
        ...entry,
        quorumCount: confirmedBy.length + 1,
        // Quorum-confirmed entries need only 1 session observation (normally 3)
        effectiveFrequencyThreshold:
          confirmedBy.length >= 1 ? 1 : DEFAULT_FREQUENCY_THRESHOLD,
      };
    });

    return { entries: withQuorum };
  }

  private deduplicateByContent(
    entries: ScratchpadEntry[],
  ): ScratchpadEntry[] {
    // This is a simplified version; production would use vector similarity
    const seen = new Map<string, ScratchpadEntry>();
    for (const entry of entries) {
      const key = `${entry.type}:${entry.content.slice(0, 100)}`;
      if (!seen.has(key)) {
        seen.set(key, entry);
      }
    }
    return Array.from(seen.values());
  }

  private contentSimilarity(a: string, b: string): number {
    // Simplified: in production, use cosine similarity of embeddings
    const wordsA = new Set(a.toLowerCase().split(/\W+/));
    const wordsB = new Set(b.toLowerCase().split(/\W+/));
    const intersection = [...wordsA].filter((w) => wordsB.has(w)).length;
    return intersection / Math.max(wordsA.size, wordsB.size);
  }
}
```

**Shared Read-Only Memory Access for Parallel Agents**

While scratchpads are isolated (each subagent has its own), the permanent memory store is shared read-only. All three parallel subagents can query `memoryService.search()` on the main thread simultaneously. The SQLite reader does not need locking for concurrent reads. Writes (permanent memory promotion) only happen after all subagents complete and the merged scratchpad is processed.

This means all three parallel subagents benefit equally from all prior session knowledge — they just cannot see each other's in-progress discoveries.

---

## 4. Session Memory Injection Strategy

### 4.1 The Three-Tier Injection Model (Refined from V3)

V3 describes a three-tier injection model but does not specify the exact injection points relative to the `streamText()` call. This section makes the injection points explicit and adds the `prepareStep` tier that V3 is missing.

```
INJECTION POINT 1: system prompt (before streamText() call)
─────────────────────────────────────────────────────────────
Content: global memories, module memories, workflow recipes
Mechanism: string concatenation into config.systemPrompt
Who injects: prompt-loader.ts calling MemoryService
When: synchronously before streamText() starts
Latency budget: up to 500ms (user waits for session start)

INJECTION POINT 2: initial user message (before streamText() call)
────────────────────────────────────────────────────────────────────
Content: pre-fetched file contents, work state (if resuming)
Mechanism: added to config.initialMessages[0].content
Who injects: session builder calling buildPrefetchPlan()
When: synchronously before streamText() starts
Latency budget: up to 2s (file reads + memory queries)

INJECTION POINT 3: tool result augmentation (during streamText() loop)
────────────────────────────────────────────────────────────────────────
Content: gotchas, dead_ends, error_patterns for the file just read
Mechanism: tool execute() function appends to result string
Who triggers: agent calling Read/Edit tools on specific files
When: asynchronously during execution, main thread intercepts
Latency budget: <100ms per augmentation

INJECTION POINT 4: prepareStep system prompt update (NEW — not in V3)
────────────────────────────────────────────────────────────────────────
Content: step-specific memory injection based on current agent state
Mechanism: prepareStep callback returns updated system prompt messages
Who triggers: every step boundary in streamText() loop
When: between steps, before the next model invocation
Latency budget: <50ms (must not block step progression)
```

### 4.2 Mid-Session Injection via prepareStep

The `prepareStep` callback in the Vercel AI SDK v6 `streamText()` call runs before each step. It can return modified settings including `messages` — which allows injecting new content into the conversation context mid-session.

This is the missing piece in V3. V3 says "memories written at step N are available at step N+1" but does not specify the mechanism. The mechanism is `prepareStep`:

```typescript
// apps/frontend/src/main/ai/session/runner.ts — memory-augmented version

export async function runAgentSession(
  config: SessionConfig,
  options: MemoryAwareRunnerOptions = {},
): Promise<SessionResult> {
  const { onEvent, onAuthRefresh, onModelRefresh, tools, memoryContext } = options;
  const startTime = Date.now();

  // Step-level memory state: tracks what the agent has accessed this session
  const stepMemoryState = new StepMemoryState({
    sessionId: config.sessionId,
    agentType: config.agentType,
    relevantModules: memoryContext?.relevantModules ?? [],
  });

  // Observer: accumulates signals for post-session synthesis
  // Lives on the worker thread side, sends events to main thread via postMessage
  const workerObserverProxy = new WorkerObserverProxy(config.sessionId);

  let authRetries = 0;
  let activeConfig = config;

  while (authRetries <= MAX_AUTH_RETRIES) {
    try {
      const result = await executeStreamWithMemory(
        activeConfig,
        tools,
        onEvent,
        stepMemoryState,
        workerObserverProxy,
        memoryContext,
      );

      // Signal session completion to main thread for post-session extraction
      workerObserverProxy.onSessionComplete({
        outcome: result.outcome,
        stepsExecuted: result.stepsExecuted,
        accessedFiles: stepMemoryState.getAccessedFiles(),
      });

      return { ...result, durationMs: Date.now() - startTime };
    } catch (error: unknown) {
      if (
        isAuthenticationError(error) &&
        authRetries < MAX_AUTH_RETRIES &&
        onAuthRefresh
      ) {
        authRetries++;
        const newToken = await onAuthRefresh();
        if (!newToken) {
          const { sessionError } = classifyError(error);
          return buildErrorResult('auth_failure', sessionError, startTime);
        }
        if (onModelRefresh) {
          activeConfig = { ...activeConfig, model: onModelRefresh(newToken) };
        }
        continue;
      }
      const { sessionError } = classifyError(error);
      return buildErrorResult('error', sessionError, startTime);
    }
  }

  return buildErrorResult('error', { message: 'Max auth retries exceeded' }, startTime);
}

async function executeStreamWithMemory(
  config: SessionConfig,
  tools: Record<string, AITool> | undefined,
  onEvent: SessionEventCallback | undefined,
  stepMemoryState: StepMemoryState,
  workerObserverProxy: WorkerObserverProxy,
  memoryContext: MemoryContext | undefined,
): Promise<Omit<SessionResult, 'durationMs'>> {
  const maxSteps = config.maxSteps ?? DEFAULT_MAX_STEPS;
  const progressTracker = new ProgressTracker();

  const emitEvent: SessionEventCallback = (event) => {
    // Forward tool events to observer proxy (main thread)
    if (event.type === 'tool-call') {
      stepMemoryState.onToolCall(event);
      workerObserverProxy.onToolCall(event);
    }
    if (event.type === 'tool-result') {
      stepMemoryState.onToolResult(event);
      workerObserverProxy.onToolResult(event);
    }
    if (event.type === 'reasoning') {
      workerObserverProxy.onReasoning(event);
    }
    progressTracker.processEvent(event);
    onEvent?.(event);
  };

  const streamHandler = createStreamHandler(emitEvent);

  const result = streamText({
    model: config.model,
    system: config.systemPrompt,
    messages: config.initialMessages.map((msg) => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    })),
    tools: tools ?? {},
    stopWhen: stepCountIs(maxSteps),
    abortSignal: config.abortSignal,

    // THE KEY ADDITION: prepareStep for mid-session memory injection
    prepareStep: async ({ stepNumber, messages }) => {
      // Only inject after step 5 — before that, the agent is still reading
      // the initial context and doesn't need additional memory yet.
      if (stepNumber < 5 || !memoryContext) {
        workerObserverProxy.onStepComplete(stepNumber);
        return {};  // No changes to step config
      }

      // Ask main thread what memory (if any) to inject for this step.
      // This is a quick IPC call — main thread has the current scratchpad
      // and can see what the agent has been doing via tool call events.
      const injection = await workerObserverProxy.requestStepInjection(
        stepNumber,
        stepMemoryState.getRecentContext(5),  // Last 5 tool calls
      );

      workerObserverProxy.onStepComplete(stepNumber);

      if (!injection) return {};

      // Return modified messages with memory injection appended
      // The AI SDK prepareStep can return updated messages to modify context
      return {
        messages: [
          ...messages,
          {
            role: 'system' as const,
            content: injection.content,
            // Internal annotation — not visible to the model as a separate turn
            // but included in context window
          },
        ],
      };
    },

    onStepFinish: (stepResult) => {
      // This is synchronous and must be fast
      progressTracker.processStepResult(stepResult);
    },
  });

  // Process the full stream
  for await (const part of result.fullStream) {
    streamHandler(part as FullStreamPart);
  }

  const finalUsage = await result.usage;
  const finalMessages = await result.messages;

  return {
    outcome: progressTracker.getOutcome(),
    stepsExecuted: progressTracker.getStepCount(),
    usage: finalUsage
      ? {
          inputTokens: finalUsage.promptTokens,
          outputTokens: finalUsage.completionTokens,
          totalTokens: finalUsage.totalTokens,
        }
      : undefined,
    messages: finalMessages.map((msg) => ({
      role: msg.role,
      content: typeof msg.content === 'string' ? msg.content : '',
    })),
    toolCallLog: progressTracker.getToolCallLog(),
  };
}
```

### 4.3 What to Inject at Each Step: The StepInjectionDecider

The main thread `MemoryObserver` (which sees all worker messages in real time) runs a fast decision function to determine what, if anything, to inject at each step boundary:

```typescript
// apps/frontend/src/main/ai/memory/step-injection-decider.ts

export class StepInjectionDecider {
  constructor(
    private readonly memoryService: MemoryService,
    private readonly scratchpad: ScratchpadStore,
  ) {}

  async decide(
    stepNumber: number,
    recentContext: RecentToolCallContext,
  ): Promise<StepInjection | null> {
    // Trigger 1: Agent just read a file with known gotchas not yet injected
    const recentReads = recentContext.toolCalls
      .filter((t) => t.toolName === 'Read' || t.toolName === 'Edit')
      .map((t) => t.args.file_path as string)
      .filter(Boolean);

    if (recentReads.length > 0) {
      const freshGotchas = await this.getUnseen(recentReads, recentContext.injectedMemoryIds);
      if (freshGotchas.length > 0) {
        return {
          content: this.formatGotchas(freshGotchas),
          memoryIds: freshGotchas.map((m) => m.id),
          type: 'gotcha_injection',
        };
      }
    }

    // Trigger 2: Scratchpad has a new record_memory entry from the last step
    // (agent explicitly called record_memory; promote it to step context immediately)
    const newScratchpadEntries = this.scratchpad.getNewSince(stepNumber - 1);
    if (newScratchpadEntries.length > 0) {
      return {
        content: this.formatScratchpadEntries(newScratchpadEntries),
        memoryIds: [],
        type: 'scratchpad_reflection',
      };
    }

    // Trigger 3: Agent appears to be searching for something it already has.
    // Detect: Grep/Glob calls in last 3 steps with pattern matching a known memory key.
    const recentSearches = recentContext.toolCalls
      .filter((t) => t.toolName === 'Grep' || t.toolName === 'Glob')
      .slice(-3);

    for (const search of recentSearches) {
      const pattern = (search.args.pattern ?? search.args.glob ?? '') as string;
      const knownResult = await this.memoryService.searchByPattern(pattern);
      if (knownResult && !recentContext.injectedMemoryIds.has(knownResult.id)) {
        return {
          content: `MEMORY CONTEXT: You may already have the result of this search.\n${knownResult.content}`,
          memoryIds: [knownResult.id],
          type: 'search_short_circuit',
        };
      }
    }

    // No injection needed for this step
    return null;
  }

  private async getUnseen(
    filePaths: string[],
    alreadyInjected: Set<string>,
  ): Promise<Memory[]> {
    const memories = await this.memoryService.search({
      types: ['gotcha', 'error_pattern', 'dead_end'],
      relatedFiles: filePaths,
      limit: 4,
      minConfidence: 0.65,
      filter: (m) => !alreadyInjected.has(m.id),
    });
    return memories;
  }

  private formatGotchas(memories: Memory[]): string {
    const lines = [
      '---',
      'MEMORY CONTEXT: Relevant context for the file you just accessed:',
    ];
    for (const m of memories) {
      const tag =
        m.type === 'dead_end'
          ? 'AVOID'
          : m.type === 'error_pattern'
            ? 'KNOWN ERROR'
            : 'GOTCHA';
      lines.push(`[${tag}] ${m.content}`);
    }
    lines.push('---');
    return lines.join('\n');
  }
}
```

### 4.4 Context Window Budget Management

Mid-session injection via `prepareStep` adds tokens to every step that triggers an injection. Without budget management, a long session (100+ steps, touching 20+ files) could exhaust the context window through accumulated injections.

The budget strategy:

```typescript
interface StepInjectionBudget {
  maxTokensPerInjection: 500;    // Each step injection is capped
  maxTotalInjectionTokens: 4000; // Across the full session
  injectedSoFar: number;
}

// In StepInjectionDecider.decide():
// Only inject if within budget AND the injection is high-confidence
if (this.budget.injectedSoFar + estimatedTokens > this.budget.maxTotalInjectionTokens) {
  // Budget exhausted — only inject dead_end memories (highest value)
  if (!memories.some(m => m.type === 'dead_end')) return null;
}
```

For very long sessions (300+ steps), the `prepareStep` injections are suspended after the budget is consumed. By that point, the agent has likely already been exposed to the key memory context through tool-result augmentation.

---

## 5. Integration with Vercel AI SDK v6

### 5.1 The Hook Points Available in streamText()

The Vercel AI SDK v6 provides four hook points that the memory system can use:

| Hook | When | Memory Use Case |
|------|------|-----------------|
| `system` param | Before call | Tier 1 injection (global + module memories) |
| `messages` param | Before call | Tier 2 injection (prefetched files, work state) |
| `prepareStep` callback | Before each step | Tier 4 active injection (gotchas, new scratchpad entries) |
| `onStepFinish` callback | After each step | Observer signal collection (synchronous, must be fast) |

The tool `execute` function is not a hook point per se, but it is the mechanism for Tier 3 injection (tool result augmentation). The `execute` function wraps the actual tool implementation and appends memory context to the result string.

### 5.2 stopWhen with Memory-Informed Limits

V3 does not address dynamic step limits. The `stopWhen` parameter currently uses a static `stepCountIs(N)` value from the agent config. Memory can inform a more intelligent stopping condition:

```typescript
// apps/frontend/src/main/ai/session/memory-aware-stop.ts

export function buildMemoryAwareStopCondition(
  baseMaxSteps: number,
  memoryContext: MemoryContext | undefined,
): StopCondition {
  if (!memoryContext) {
    return stepCountIs(baseMaxSteps);
  }

  // If we have calibration data showing this module runs long,
  // increase the step limit proportionally.
  const calibrationFactor = memoryContext.calibrationFactor ?? 1.0;

  // Cap the increase at 2x to prevent runaway sessions.
  const adjustedFactor = Math.min(calibrationFactor, 2.0);
  const adjustedSteps = Math.ceil(baseMaxSteps * adjustedFactor);

  // Never exceed the absolute maximum (prevents cost runaway).
  const finalSteps = Math.min(adjustedSteps, MAX_ABSOLUTE_STEPS);

  return stepCountIs(finalSteps);
}

const MAX_ABSOLUTE_STEPS = 500;
```

This is particularly valuable for the payment module (calibration factor 3.1x): instead of the agent hitting the step limit mid-task and producing incomplete work, the session is configured with a 2x adjusted limit upfront.

### 5.3 Worker Bridge Memory Event Flow (Complete Implementation)

```typescript
// apps/frontend/src/main/ai/agent/worker-bridge.ts — memory additions

export class WorkerBridge extends EventEmitter {
  private worker: Worker | null = null;
  private progressTracker: ProgressTracker = new ProgressTracker();
  private taskId: string = '';
  private projectId: string | undefined;
  private processType: ProcessType = 'task-execution';

  // Memory additions
  private memoryObserver: MemoryObserver | null = null;
  private stepInjectionDecider: StepInjectionDecider | null = null;
  private pendingMemoryRequests: Map<
    string,
    {
      resolve: (result: MemoryIpcResponse) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  > = new Map();

  spawn(config: AgentExecutorConfig, memoryService?: MemoryService): void {
    if (this.worker) {
      throw new Error(
        'WorkerBridge already has an active worker. Call terminate() first.',
      );
    }

    this.taskId = config.taskId;
    this.projectId = config.projectId;
    this.processType = config.processType;
    this.progressTracker = new ProgressTracker();

    if (memoryService) {
      this.memoryObserver = new MemoryObserver({
        sessionId: config.session.sessionId ?? config.taskId,
        agentType: config.session.agentType,
        projectDir: config.session.projectDir,
        moduleContext: config.session.memoryContext?.relevantModules ?? [],
      });
      this.stepInjectionDecider = new StepInjectionDecider(
        memoryService,
        this.memoryObserver.getScratchpad(),
      );
    }

    const workerConfig: WorkerConfig = {
      taskId: config.taskId,
      projectId: config.projectId,
      processType: config.processType,
      session: config.session,
    };

    const workerPath = resolveWorkerPath();
    this.worker = new Worker(workerPath, { workerData: workerConfig });

    this.worker.on('message', async (message: WorkerMessage) => {
      await this.handleWorkerMessage(message);
    });

    this.worker.on('error', (error: Error) => {
      this.emitTyped('error', this.taskId, error.message, this.projectId);
      this.cleanup();
    });

    this.worker.on('exit', (code: number) => {
      if (this.worker) {
        this.emitTyped(
          'exit',
          this.taskId,
          code === 0 ? 0 : code,
          this.processType,
          this.projectId,
        );
        this.cleanup();
      }
    });
  }

  private async handleWorkerMessage(message: WorkerMessage): Promise<void> {
    // Handle memory IPC requests from the worker
    if (message.type === 'memory:search') {
      const req = message as MemoryIpcRequest & { type: 'memory:search' };
      try {
        const memories = await this.memoryObserver
          ? this.memoryObserver.search(req.query, req.filters)
          : [];
        this.sendToWorker({
          type: 'memory:search-result',
          requestId: req.requestId,
          memories,
        });
      } catch (error) {
        this.sendToWorker({
          type: 'memory:search-result',
          requestId: req.requestId,
          memories: [],
          error: String(error),
        });
      }
      return;
    }

    if (message.type === 'memory:record') {
      const req = message as MemoryIpcRequest & { type: 'memory:record' };
      const scratchpadId = this.memoryObserver?.addToScratchpad(req.entry) ?? 'no-observer';
      this.sendToWorker({
        type: 'memory:record-result',
        requestId: req.requestId,
        scratchpadId,
      });
      return;
    }

    // Fire-and-forget observer signals (no response needed)
    if (message.type === 'memory:tool-call') {
      this.memoryObserver?.observe(message as unknown as ToolCallSignal);
      // Also dispatch to agent manager as before
      this.dispatchToAgentManager(message);
      return;
    }

    if (message.type === 'memory:step-complete') {
      const req = message as unknown as { stepNumber: number; recentContext: RecentToolCallContext };
      if (this.stepInjectionDecider) {
        const injection = await this.stepInjectionDecider.decide(
          req.stepNumber,
          req.recentContext,
        );
        if (injection) {
          this.sendToWorker({
            type: 'memory:intercept',
            targetToolCall: 'step-injection',
            injectedContent: injection.content,
            citationIds: injection.memoryIds,
          });
        } else {
          // Acknowledge with no injection
          this.sendToWorker({ type: 'memory:intercept', targetToolCall: 'step-injection', injectedContent: '', citationIds: [] });
        }
      }
      return;
    }

    if (message.type === 'memory:reasoning') {
      this.memoryObserver?.onReasoning(message as unknown as ReasoningSignal);
      return;
    }

    if (message.type === 'memory:session-complete') {
      // Session is done — do NOT promote yet. Wait for QA validation.
      this.memoryObserver?.onSessionComplete(
        message as unknown as SessionCompleteSignal,
      );
      // Signal to orchestration layer that memory observer is ready for finalization
      this.emitTyped('memory-observer-ready', this.taskId, this.memoryObserver);
      return;
    }

    // All other messages: dispatch as before
    this.dispatchToAgentManager(message);
  }

  // Called by orchestration layer after QA passes
  async finalizeMemory(qaResult: QAResult): Promise<PromotedMemory[]> {
    if (!this.memoryObserver) return [];
    return this.memoryObserver.finalize(qaResult);
  }

  // Called when QA fails — discard scratchpad
  discardMemory(): void {
    this.memoryObserver?.discardScratchpad();
  }

  private sendToWorker(message: MemoryIpcResponse): void {
    this.worker?.postMessage(message);
  }

  private dispatchToAgentManager(message: WorkerMessage): void {
    // Original dispatch logic unchanged
  }
}
```

---

## 6. Build Pipeline Integration

### 6.1 Planner: Past Task Outcomes Shape Better Plans

The planner receives three categories of memory context before generating any output (designed in detail in Section 2.1). The critical integration point is where this context gets injected in the orchestration pipeline:

```typescript
// apps/frontend/src/main/ai/orchestration/build-pipeline.ts

async function runPlannerPhase(
  taskConfig: TaskConfig,
  memoryService: MemoryService,
): Promise<PlannerResult> {
  // Resolve which modules the task is likely to touch
  const relevantModules = await resolveModulesFromTask(
    taskConfig.taskDescription,
    taskConfig.projectDir,
  );

  // Build memory context for planner
  const [plannerMemoryContext, prefetchPlan] = await Promise.all([
    buildPlannerMemoryContext(
      taskConfig.taskDescription,
      relevantModules,
      memoryService,
    ),
    buildPrefetchPlan(
      relevantModules,
      taskConfig.taskDescription,
      memoryService,
      new Set([taskConfig.specPath]),  // spec already in context
    ),
  ]);

  const calibrationFactor = extractCalibrationFactor(
    await memoryService.search({
      types: ['task_calibration'],
      relatedModules: relevantModules,
      limit: 3,
    }),
  );

  const sessionConfig = await buildSessionConfig({
    agentType: 'planner',
    taskConfig,
    memoryContext: {
      relevantModules,
      injectedText: plannerMemoryContext,
      calibrationFactor,
    },
    prefetchPlan,
    maxSteps: buildMemoryAwareStopCondition(
      AGENT_CONFIGS.planner.maxSteps,
      { calibrationFactor },
    ),
  });

  const bridge = new WorkerBridge();
  bridge.spawn(agentExecutorConfig, memoryService);

  return waitForPlannerResult(bridge);
}
```

### 6.2 Coder: Dead-End Avoidance + File Prediction

The coder receives the richest memory context of any pipeline stage. Its memory context combines:

1. **Session start (system prompt Tier 1)**: Global conventions, module gotchas, error patterns, dead ends for relevant modules
2. **Session start (initial message Tier 2)**: Pre-fetched files based on prefetch_pattern memories
3. **Mid-execution (tool result augmentation)**: File-specific gotchas when each file is first accessed
4. **Mid-execution (prepareStep)**: New scratchpad entries visible immediately after record_memory calls

For parallel coders (multiple subtasks running simultaneously), each coder gets a filtered view of memory scoped to its own subtask's files and modules. The full module memory is available via `search_memory` tool, but proactive injection is scoped to prevent irrelevant cross-subtask context pollution.

### 6.3 QA: Known Failure Patterns Drive Targeted Validation

The QA reviewer agent is memory-aware in a distinct way: it receives not just general memory about the files it's reviewing, but specifically the `error_pattern` and `requirement` memories that indicate what types of failures have occurred before on similar tasks.

```typescript
// QA memory injection: target the validator's attention
const qaMemoryContext = await buildQAMemoryContext(
  specNumber,
  touchedFiles,
  memoryService,
);

// qaMemoryContext contains sections like:
// ## KNOWN FAILURE PATTERNS (verify these are fixed)
// [ERROR PATTERN] auth/tokens.ts — JWT expiry at 24h boundary (seen 2x)
//   → Verify: `jwt.verify()` uses `clockTolerance: 10` option
//
// ## E2E OBSERVATIONS (check these behaviors)
// [E2E] Login modal animation — click_by_text fails if modal is animating
//   → Verify: await sufficient settle time after modal trigger
//
// ## REQUIREMENTS (verify these are satisfied)
// [REQUIREMENT] All monetary values must use integer cents
//   → Verify: no floating point in payment calculations
```

This turns the QA agent from a general code reviewer into a targeted validator that knows exactly what failure modes to look for in this specific codebase.

### 6.4 Recovery: Memory Guides Retry Strategy

When a coder agent fails mid-task (hits step limit, produces an error, or gets cancelled), the recovery session needs to pick up intelligently. Memory provides two inputs to recovery:

1. **work_state memory**: If the agent wrote a work state before failing, the recovery session starts from the exact last known good position.
2. **dead_end memory created from the failure**: The approach that caused the failure becomes a dead_end memory visible to the recovery session. The recovery agent starts knowing "approach X failed — try approach Y instead."

```typescript
// apps/frontend/src/main/ai/orchestration/recovery.ts

async function buildRecoverySession(
  failedSession: SessionResult,
  taskConfig: TaskConfig,
  memoryService: MemoryService,
): Promise<SessionConfig> {
  // Retrieve work state if available
  const workState = await memoryService.searchByWorkUnit(
    taskConfig.specNumber,
    failedSession.subtaskId,
    { type: 'work_state' },
  );

  // The failed approach should have been auto-promoted as a dead_end
  // during observer.discardScratchpad() — check if it exists
  const recentDeadEnds = await memoryService.search({
    types: ['dead_end'],
    relatedModules: taskConfig.relevantModules,
    limit: 3,
    maxAgeHours: 2,  // Only very recent dead ends are from THIS failure
  });

  const recoveryContext = buildRecoveryContext(workState, recentDeadEnds, failedSession);

  return buildSessionConfig({
    agentType: 'coder_recovery',
    taskConfig,
    additionalContext: recoveryContext,
    // Recovery sessions get a fresh step budget — they should not inherit
    // the exhausted step count from the failed session.
    memoryContext: { relevantModules: taskConfig.relevantModules },
  });
}
```

---

## 7. Measurable Improvements and A/B Framework

### 7.1 Primary Metrics

All metrics are tracked per session in a `session_metrics` table alongside the memory store:

```typescript
interface SessionMemoryMetrics {
  sessionId: string;
  agentType: string;
  taskId: string;
  specNumber: string;
  relevantModules: string[];

  // Pre-fetch effectiveness
  prefetchedFileCount: number;
  prefetchedTokens: number;
  prefetchHitRate: number;          // % of pre-fetched files NOT re-read in first 30 steps
  discoveryToolCallsStep1to30: number;  // Lower = better

  // Planning accuracy (planner sessions only)
  plannedSubtaskCount: number;
  actualSubtaskCount: number;
  planAccuracyRatio: number;

  // QA outcomes
  qaFirstPassSuccess: boolean;
  qaFixerCycleCount: number;
  errorPatternsInjectedCount: number;  // How many error patterns were in context
  deadEndsInjectedCount: number;

  // Mid-session injection activity
  prepareStepInjectionsCount: number;   // How many steps received injections
  prepareStepTokensAdded: number;       // Total tokens added by prepareStep injections

  // Scratchpad quality
  scratchpadEntriesCreated: number;
  scratchpadEntriesPromoted: number;
  scratchpadPromotionRate: number;

  // Continuity (recovery sessions)
  isRecoverySession: boolean;
  resumeOrientationSteps: number;    // Steps before first code change
}
```

### 7.2 A/B Testing Framework

The memory system needs a principled way to measure its own contribution. Without a control group, it is impossible to know if improvements come from memory or from prompt improvements, model updates, or task selection bias.

```typescript
// apps/frontend/src/main/ai/memory/ab-testing.ts

export enum MemoryABGroup {
  CONTROL = 'control',       // No memory injection
  PASSIVE = 'passive',       // Start-of-session injection only (V3 baseline)
  ACTIVE = 'active',         // Full active memory (prefetch + prepareStep + intercept)
}

export class MemoryABTestManager {
  // Simple deterministic assignment based on spec number mod 3
  // This ensures the same spec always gets the same treatment across retries
  assignGroup(specNumber: string): MemoryABGroup {
    const hash = parseInt(specNumber.replace(/\D/g, '') || '0', 10);
    const groups = [
      MemoryABGroup.CONTROL,
      MemoryABGroup.PASSIVE,
      MemoryABGroup.ACTIVE,
    ];
    return groups[hash % 3];
  }

  buildSessionConfig(
    baseConfig: SessionConfig,
    group: MemoryABGroup,
    memoryService: MemoryService,
  ): SessionConfig {
    switch (group) {
      case MemoryABGroup.CONTROL:
        return baseConfig;  // No memory

      case MemoryABGroup.PASSIVE:
        return {
          ...baseConfig,
          memoryEnabled: true,
          prepareStepInjection: false,
          toolResultAugmentation: false,
        };

      case MemoryABGroup.ACTIVE:
        return {
          ...baseConfig,
          memoryEnabled: true,
          prepareStepInjection: true,
          toolResultAugmentation: true,
        };
    }
  }
}
```

After 50+ sessions per group, compute statistical significance for each primary metric. The null hypothesis is that memory has no effect. Reject the null if p < 0.05.

### 7.3 Expected Improvement Trajectory (Refined)

Based on research from the Reflexion paper (NeurIPS 2023), ExpeL (2024), and Mem0's 2025 production data:

| Metric | Sessions 1-5 | Sessions 10-20 | Sessions 30+ | Mechanism |
|--------|-------------|----------------|--------------|-----------|
| Discovery tool calls (steps 1-30) | 18-25 | 10-14 | 4-8 | Prefetch + prepareStep |
| QA first-pass success rate | ~40% | ~58% | ~72% | Error pattern injection + dead-end avoidance |
| Plan accuracy ratio | 0.3-0.5 | 0.55-0.70 | 0.75-0.90 | Calibration + causal deps |
| Session resume orientation steps | 25-40 | 6-12 | 1-3 | work_state injection |
| prepareStep injection hit rate | N/A (< 5 sessions) | ~35% steps receive injection | ~20% steps (patterns stabilize) | StepInjectionDecider |

The prepareStep injection rate decreasing after session 20 is expected and desirable: it means start-of-session injection is already covering most cases, and mid-session injection is a safety net rather than the primary mechanism.

---

## 8. TypeScript Code Examples: Complete Memory-Aware Session

This section provides the complete, runnable architecture for a memory-aware coder session from session start through post-session promotion.

### 8.1 Session Startup with Full Memory Context

```typescript
// apps/frontend/src/main/ai/orchestration/memory-aware-session-builder.ts

export async function buildMemoryAwareCoderSession(
  taskConfig: TaskConfig,
  subtask: Subtask,
  memoryService: MemoryService,
  modelConfig: ModelConfig,
): Promise<{ sessionConfig: SessionConfig; executorConfig: AgentExecutorConfig }> {

  const relevantModules = await resolveModulesForFiles(subtask.filesTouched);
  const relevantFiles = subtask.filesTouched ?? [];

  // All memory queries in parallel — don't serialize these
  const [
    tier1Memories,
    prefetchPlan,
    calibrationFactor,
    workState,
  ] = await Promise.all([
    // Tier 1: start-of-session memories for system prompt
    memoryService.buildSessionContext({
      phase: 'implement',
      relatedModules: relevantModules,
      relatedFiles: relevantFiles,
      agentType: 'coder',
      limits: { tier1: 30, tier2: 20, tier3: 10 },
    }),

    // Tier 2: pre-fetch file plan
    buildPrefetchPlan(
      relevantModules,
      subtask.description,
      memoryService,
      new Set([taskConfig.specPath, taskConfig.implementationPlanPath]),
    ),

    // Calibration factor for step limit adjustment
    memoryService.getCalibrationFactor(relevantModules),

    // Work state for resumption (null if fresh start)
    memoryService.getWorkState(taskConfig.specNumber, subtask.id),
  ]);

  // Build system prompt with Tier 1 memory
  const systemPrompt = await buildCoderSystemPrompt({
    taskConfig,
    subtask,
    memoryContext: tier1Memories,
    workState,
  });

  // Build initial message with prefetched files (Tier 2)
  const initialMessage = buildInitialMessage(subtask, prefetchPlan);

  // Adjust step limit based on calibration
  const adjustedMaxSteps = buildMemoryAwareStopCondition(
    AGENT_CONFIGS.coder.maxSteps,
    { calibrationFactor },
  );

  const sessionConfig: SessionConfig = {
    model: createProvider(modelConfig),
    systemPrompt,
    initialMessages: [initialMessage],
    maxSteps: adjustedMaxSteps,
    agentType: 'coder',
    sessionId: crypto.randomUUID(),
    projectDir: taskConfig.projectDir,
    memoryContext: {
      relevantModules,
      calibrationFactor,
      prefetchedFilePaths: prefetchPlan.files.map((f) => f.path),
    },
  };

  const executorConfig: AgentExecutorConfig = {
    taskId: taskConfig.specNumber,
    projectId: taskConfig.projectId,
    processType: 'task-execution',
    session: sessionConfig,
  };

  return { sessionConfig, executorConfig };
}
```

### 8.2 Memory-Aware Tool Definitions

```typescript
// apps/frontend/src/main/ai/tools/memory-tools.ts
// Tools that agents can call explicitly to interact with memory

export function createMemoryTools(
  memoryIpc: MemoryIpcClient,  // IPC client in worker thread
): Record<string, AITool> {
  return {
    search_memory: tool({
      description:
        'Search project memory for relevant context. Use this when you need to recall ' +
        'past decisions, known gotchas, error patterns, or implementation approaches ' +
        'for the modules you are working with.',
      inputSchema: z.object({
        query: z.string().describe('What you want to know or recall'),
        types: z
          .array(
            z.enum([
              'gotcha',
              'decision',
              'error_pattern',
              'dead_end',
              'pattern',
              'workflow_recipe',
              'requirement',
              'module_insight',
            ]),
          )
          .optional()
          .describe('Filter to specific memory types'),
        relatedFiles: z
          .array(z.string())
          .optional()
          .describe('Filter to memories about specific files'),
      }),
      execute: async ({ query, types, relatedFiles }) => {
        const response = await memoryIpc.search({
          query,
          filters: { types, relatedFiles },
        });
        if (response.memories.length === 0) {
          return 'No relevant memories found. Proceed with your own analysis.';
        }
        return formatMemoriesForAgent(response.memories);
      },
    }),

    record_memory: tool({
      description:
        'Record an important discovery, decision, or gotcha to project memory. ' +
        'Use this for things future agents working in this module should know. ' +
        'Examples: architectural decisions, discovered constraints, patterns that work, ' +
        'approaches that failed and why. This goes to a scratchpad — only promoted ' +
        'to permanent memory after QA validation passes.',
      inputSchema: z.object({
        type: z
          .enum([
            'gotcha',
            'decision',
            'error_pattern',
            'dead_end',
            'pattern',
            'module_insight',
          ])
          .describe('Type of memory being recorded'),
        content: z.string().describe('Detailed description of what to remember'),
        relatedFiles: z
          .array(z.string())
          .optional()
          .describe('Files this memory relates to'),
        tags: z
          .array(z.string())
          .optional()
          .describe('Tags for categorization (module names, feature names)'),
        approachTried: z
          .string()
          .optional()
          .describe('For dead_end type: what approach was tried'),
        whyItFailed: z
          .string()
          .optional()
          .describe('For dead_end type: why the approach failed'),
        alternativeUsed: z
          .string()
          .optional()
          .describe('For dead_end type: what approach was used instead'),
      }),
      execute: async ({
        type,
        content,
        relatedFiles,
        tags,
        approachTried,
        whyItFailed,
        alternativeUsed,
      }) => {
        const response = await memoryIpc.record({
          type,
          content,
          relatedFiles: relatedFiles ?? [],
          tags: tags ?? [],
          source: 'agent_explicit',
          // Additional fields for dead_end type
          ...(type === 'dead_end' && {
            approachTried,
            whyItFailed,
            alternativeUsed,
          }),
        });
        return `Memory recorded (scratchpad ID: ${response.scratchpadId}). ` +
          `This will be promoted to permanent memory after QA validation.`;
      },
    }),

    get_workflow_recipe: tool({
      description:
        'Get step-by-step instructions for a class of task that has been done before in this project. ' +
        'Examples: "add IPC handler", "add Zustand store", "create React component with i18n". ' +
        'Returns null if no recipe exists for this task type.',
      inputSchema: z.object({
        taskDescription: z.string().describe('Describe the type of task you want a recipe for'),
      }),
      execute: async ({ taskDescription }) => {
        const response = await memoryIpc.search({
          query: taskDescription,
          filters: { types: ['workflow_recipe'] },
        });
        if (response.memories.length === 0) {
          return 'No workflow recipe found for this task type. Proceed with your own approach.';
        }
        const recipe = response.memories[0] as unknown as WorkflowRecipe;
        const steps = recipe.steps
          .map(
            (s) =>
              `${s.order}. ${s.description}${s.canonicalFile ? ` (see ${s.canonicalFile})` : ''}`,
          )
          .join('\n');
        return `Recipe: "${recipe.taskPattern}" (used ${recipe.successCount}x successfully)\n${steps}`;
      },
    }),
  };
}
```

### 8.3 Post-Session Promotion in WorkerBridge

```typescript
// Complete post-session flow triggered by orchestration layer

// In orchestration/build-pipeline.ts, after QA passes:
async function handleQAResult(
  qaResult: QAResult,
  workerBridges: WorkerBridge[],
  memoryService: MemoryService,
  specNumber: string,
): Promise<void> {
  if (qaResult.passed) {
    // Promote all scratchpads to permanent memory
    const allPromoted: PromotedMemory[] = [];

    if (workerBridges.length === 1) {
      // Single agent: direct finalization
      const promoted = await workerBridges[0].finalizeMemory(qaResult);
      allPromoted.push(...promoted);
    } else {
      // Parallel agents: merge scratchpads first
      const scratchpads = workerBridges.map((b) => b.getScratchpad());
      const merger = new ParallelScratchpadMerger();
      const mergedScratchpad = merger.merge(scratchpads);

      // Run promotion pipeline on merged scratchpad
      const promoter = new MemoryPromotionPipeline(memoryService);
      const promoted = await promoter.promoteFromMerged(mergedScratchpad, qaResult);
      allPromoted.push(...promoted);
    }

    // Write work_unit_outcome
    await memoryService.addMemory({
      type: 'work_unit_outcome',
      content: buildOutcomeDescription(qaResult, specNumber),
      workUnitRef: { methodology: 'native', hierarchy: [specNumber], label: `Spec ${specNumber}` },
      succeeded: true,
      filesModified: qaResult.filesModified,
      keyDecisions: extractKeyDecisions(allPromoted),
      stepsTaken: qaResult.totalStepsExecuted,
      retryCount: qaResult.retryCount,
      scope: 'work_unit',
      source: 'observer_inferred',
      confidence: 0.9,
      tags: [],
      relatedFiles: qaResult.filesModified,
      relatedModules: qaResult.modulesTouched,
    });

    // Update task calibration
    await updateTaskCalibration(
      qaResult.modulesTouched,
      qaResult.totalStepsExecuted,
      qaResult.plannedSteps,
      memoryService,
    );

    // For large specs: run consolidation pass
    if (qaResult.subtaskCount >= 10) {
      await consolidateSpecMemories(specNumber, memoryService);
    }

  } else {
    // QA failed — discard all scratchpads
    for (const bridge of workerBridges) {
      bridge.discardMemory();
    }

    // Extract structured QA failures as error_pattern memories immediately
    // (These bypass the scratchpad — QA failures are always worth recording)
    await extractQaFailureMemories(qaResult, memoryService, specNumber);
  }
}
```

---

## 9. Recommendations for V4

Based on the multi-agent framework survey, the worker thread architecture design, and the gaps identified above, these are the recommended additions for V4:

### Priority 1: The prepareStep Injection Hook

V3 and V1 both lack this. It is the difference between passive and truly active memory. The design is complete in this document (Section 4.2). Implementation effort: medium. Expected ROI: high (the "wow moment" metric improves significantly when agents visibly course-correct based on mid-session memory).

### Priority 2: Reasoning Text Monitoring

The observer currently monitors tool calls (behavioral signals). Monitoring the `reasoning` event type from `fullStream` adds semantic signal: the agent's explicit "I'm abandoning this approach" statements are the highest-confidence dead-end indicators available. Implementation effort: low. ROI: high for dead-end quality.

### Priority 3: Scratchpad Checkpointing to Disk

LangGraph's insight applied to our architecture: the `MemoryObserver` scratchpad should be checkpointed to disk at each subtask boundary (not just at session end). This makes large spec executions resilient to Electron restarts. Implementation effort: low (SQLite write at subtask boundaries). ROI: medium (prevents losing all observations if Electron crashes mid-spec).

### Priority 4: Quorum-Based Promotion for Parallel Agents

When 3 parallel subagents all independently observe the same pattern, that observation should be promotable after 1 occurrence rather than 3 sessions. The `ParallelScratchpadMerger` design above implements this. Implementation effort: medium. ROI: speeds up pattern learning for projects that heavily use parallel subagent execution.

### Priority 5: Reasoning-Text Dead-End Detection

Described in Section 2.2. The observer monitors `reasoning` events for natural language dead-end markers. Implementation effort: low. ROI: improves dead-end memory quality dramatically — the agent's own words are more reliable than behavioral inference.

### Priority 6: PHASE_WEIGHTS Optimization via Session Data

After 50+ sessions, use the collected `session_metrics` data to optimize the `PHASE_WEIGHTS` retrieval scoring table. The current table is hand-tuned. Session data can identify which memory types most strongly predict QA first-pass success per phase. Implementation effort: high (requires a DSPy-style optimization pass). ROI: potentially high but data-dependent — defer until enough sessions exist.

### What to Avoid in V4

**Avoid**: Storing conversation history in memory. The agent's message history is not the same as reusable memory. Storing it creates noise, accelerates database growth, and degrades retrieval quality. Keep memory focused on insights, not transcripts.

**Avoid**: Cross-project memory transfer without explicit user consent. Memory from project A should never automatically influence project B. The user must explicitly export/import memories between projects. Cross-project transfer sounds valuable but creates subtle contamination bugs (auth patterns from an Express app corrupting advice for an Electron app).

**Avoid**: Trusting observer-inferred memories before they have accessCount >= 2. A single session's observations are too noisy for automatic injection. The confidence filtering in V3's promotion pipeline must remain strict in V4.

---

## References

- [Memory - CrewAI](https://docs.crewai.com/en/concepts/memory) — CrewAI's four-tier memory architecture
- [Mastering LangGraph Checkpointing: Best Practices for 2025](https://sparkco.ai/blog/mastering-langgraph-checkpointing-best-practices-for-2025) — LangGraph checkpoint patterns
- [Long-Term Agentic Memory With LangGraph](https://medium.com/@anil.jain.baba/long-term-agentic-memory-with-langgraph-824050b09852) — Cross-thread memory stores in LangGraph
- [Memory and RAG — AutoGen](https://microsoft.github.io/autogen/stable//user-guide/agentchat-user-guide/memory.html) — AutoGen v0.4 memory model
- [Memory-Enabled ReAct Agents - DSPy](https://dspy.ai/tutorials/mem0_react_agent/) — DSPy + Mem0 integration for agent memory
- [Adding memory to Semantic Kernel Agents](https://learn.microsoft.com/en-us/semantic-kernel/frameworks/agent/agent-memory) — Whiteboard pattern
- [Agents: Loop Control - Vercel AI SDK](https://ai-sdk.dev/docs/agents/loop-control) — prepareStep and stopWhen documentation
- [Collaborative Memory: Multi-User Memory Sharing in LLM Agents](https://arxiv.org/abs/2505.18279) — Bipartite access graph model for shared memory
- [Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory](https://arxiv.org/abs/2504.19413) — Mem0 production architecture paper
- [Memory for AI Agents: A New Paradigm of Context Engineering](https://thenewstack.io/memory-for-ai-agents-a-new-paradigm-of-context-engineering/) — Context engineering survey
- Shinn, N. et al. (2023). "Reflexion: Language Agents with Verbal Reinforcement Learning." NeurIPS 2023.
- Zhao, A. et al. (2024). "ExpeL: LLM Agents Are Experiential Learners."
- Zhou, A. et al. (2023). "Language Agent Tree Search (LATS)."
