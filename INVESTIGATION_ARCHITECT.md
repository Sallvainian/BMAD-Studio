# Memory System V1 — Architecture Investigation Report

**Author:** Atlas (Principal Software Architect)
**Date:** 2026-02-21
**Source Document:** MEMORY_SYSTEM_V1_DRAFT.md
**Scope:** Gap analysis across 10 focus areas — race conditions, cold start, embedding lifecycle,
search quality, memory garbage collection, ModuleMap staleness, terminal integration,
failure modes, testing strategy, and missing features.

---

## Executive Summary

The V1 draft is architecturally sound at a high level. The two-layer model (ModuleMap +
Memories), the main-thread write proxy pattern, and the hybrid retrieval scorer are all
correct design decisions. However, the draft contains approximately 47 identifiable gaps
across the 10 focus areas analyzed below. These gaps range from blockers that would cause
data corruption on day one (P0) to important quality-of-life features missing from the
implementation plan (P2).

The most critical gaps are: (1) the embedding initialization race condition that would crash
the first `addMemory()` call on a cold start, (2) the absence of any write serialization
mechanism inside the main-thread singleton (concurrent `postMessage()` bursts from parallel
agents will interleave writes without a queue), (3) no WAL connection reuse strategy for
workers doing repeated `search_memory` calls, and (4) the post-session extractor has no
defined trigger point when agents crash or are cancelled mid-session.

---

## Focus Area 1: Race Conditions

### GAP-RC-01 (P0) — No write queue in MemoryService singleton

**What the draft says:** Workers post `{ type: 'memory-write' }` messages to the main
thread. The main-thread `MemoryService` singleton handles all writes.

**The gap:** The draft assumes `handleWorkerMessage()` processes one message at a time.
In reality, with 12 parallel agent sessions (the app supports up to 12 terminals), all
agents can call `record_memory` or `record_gotcha` within the same event loop tick. Node.js
processes `postMessage()` callbacks asynchronously. Two writes can interleave if `addMemory()`
is `async` (which it must be — it calls `embed()` which is async).

**Concrete failure scenario:**
```
Agent A calls addMemory("auth gotcha")  → starts embed() → awaits...
Agent B calls addMemory("db gotcha")    → starts embed() → awaits...
Agent A embed() resolves → db.run(INSERT ...) → OK
Agent B embed() resolves → db.run(INSERT ...) with stale dedup state → duplicate stored
```

The semantic deduplication check (cosine > 0.92) reads existing memories BEFORE the embed
resolves. If two agents are writing near-identical memories concurrently, both will pass the
dedup check because neither has committed yet when the other reads.

**Required fix:** Implement a write queue (e.g., a `Promise` chain or explicit async queue
like `p-queue` with concurrency=1) inside `MemoryService`. All `addMemory()` and
`updateModule()` calls must be serialized through this queue. Reads (`search()`) remain
fully parallel — only writes are serialized.

```typescript
class MemoryService {
  private writeQueue: Promise<void> = Promise.resolve();

  addMemory(text: string, metadata: MemoryMetadata): Promise<string> {
    this.writeQueue = this.writeQueue.then(() => this._addMemoryInternal(text, metadata));
    return this.writeQueue.then(() => /* id */);
  }
}
```

---

### GAP-RC-02 (P0) — Embedding initialization race at first write

**What the draft says:** Section 12 describes embedding via Ollama local or cloud TEI.
Section 22 Step 2 creates `memory/embedding.ts`.

**The gap:** The embedding provider (Ollama connection, model load) takes 2-15 seconds to
initialize on first use. If an agent session starts before Ollama has fully loaded the
`nomic-embed-text` model, the first `embed()` call will fail or time out. The draft has no
initialization guard.

**Concrete failure scenario:**
- App starts, user immediately starts a task
- Agent calls `record_gotcha` within 10 seconds of app start
- `embed()` call hits Ollama before model is loaded → HTTP 500 or timeout
- Memory write fails silently (or crashes if unhandled)

**Required fix:** Add an `initialize()` method to `EmbeddingService` that sends a warm-up
embed call at `MemoryService` startup. Gate `addMemory()` on initialization completion with
a `ready` promise. Surface Ollama unavailability in the UI immediately on app start rather
than at first write.

```typescript
class EmbeddingService {
  private ready: Promise<void>;

  constructor() {
    this.ready = this.warmUp();
  }

  private async warmUp(): Promise<void> {
    // Send a trivial embed call to force model load
    await embed({ model: this.model, value: 'warmup' });
  }

  async embed(text: string): Promise<number[]> {
    await this.ready;
    // ...
  }
}
```

---

### GAP-RC-03 (P1) — Worker WAL connection lifetime not defined

**What the draft says:** "Workers open read-only WAL connections for `search_memory` tool
calls." Section 22 Step 3: "pass `dbPath` via `SerializableSessionConfig`."

**The gap:** The draft does not specify when workers open and close their WAL connections.
If each `search_memory` tool call opens a new `better-sqlite3` connection and never closes
it, a 12-agent session will hold 12 open WAL reader connections for the entire session
duration. SQLite WAL mode allows unlimited readers, so this won't deadlock — but each
`better-sqlite3` instance is not free (native bindings, file descriptor). The draft also
doesn't address what happens when a worker thread exits: does the connection get closed?
If the worker exits abnormally, the connection leak is permanent until app restart.

**Required fix:** Workers should open ONE read-only connection per worker thread lifetime
(not per tool call), and close it in the worker's `process.on('exit')` handler. Use a
module-level singleton in `worker.ts`:

```typescript
// In worker.ts
let memoryReadDb: Database | null = null;

function getMemoryReadDb(dbPath: string): Database {
  if (!memoryReadDb) {
    memoryReadDb = new Database(dbPath, { readonly: true });
    process.on('exit', () => memoryReadDb?.close());
  }
  return memoryReadDb;
}
```

---

### GAP-RC-04 (P1) — No acknowledgement protocol for memory-write messages

**What the draft says:** Workers post `{ type: 'memory-write', memory: {...} }` and continue
execution. The main thread writes asynchronously.

**The gap:** There is no round-trip acknowledgement. If the main thread's write fails
(Ollama down, SQLite locked, secret scanner throws), the worker has no way to know. The
agent continues believing the memory was saved. Post-session extraction might then try to
extract the same information again, creating duplicate entries if extraction succeeds where
the real-time write failed.

**Required fix:** Add an optional `requestId` field to the `memory-write` message and a
`memory-write-ack` message type back from main to worker. The worker-side `record_memory`
tool can fire-and-forget (no await) for normal writes, but should log a warning if an ack
is not received within 5 seconds. This enables debugging without blocking the agent.

---

### GAP-RC-05 (P2) — Parallel post-session extractors can race on ModuleMap update

**What the draft says:** Post-session extractor "runs on main thread after worker exits"
and "updates ModuleMap with newly-accessed files."

**The gap:** In a parallel coder subagent scenario (multiple worker threads working on
different subtasks simultaneously), all workers may exit within seconds of each other.
The draft says extractors "run on main thread after worker exits" — but multiple workers
can exit near-simultaneously, triggering multiple concurrent extractor runs. If two
extractors both read the current ModuleMap, both add different files to the same module,
and both write back, one write will clobber the other.

**Required fix:** ModuleMap updates must go through the same write queue as memory writes.
The session extractor should use `MemoryService.updateModule()` (serialized) rather than
directly updating the SQLite row.

---

## Focus Area 2: Cold Start

### GAP-CS-01 (P0) — No user feedback during cold start scan

**What the draft says:** "Static analysis (~10 seconds)" + "Fast LLM classification
(~30 seconds)" happen automatically when a new project is added.

**The gap:** 40+ seconds with no progress feedback is unacceptable for a desktop app. The
draft mentions "present seeded memories to user: 'I found 12 conventions. Review?'" but
only at the END of the process. If Ollama is not running, the LLM classification step will
hang indefinitely. There is no timeout, no cancellation path, and no graceful degradation
to "shallow only" if LLM classification fails.

**Required fix:**
1. IPC progress events from the cold start pipeline: `memory:scan-progress { stage, pct }`
2. Hard timeout on LLM classification step (30 seconds, not open-ended)
3. Graceful fallback: if LLM step fails or times out, store ModuleMap with
   `confidence: "shallow"` and retry LLM classification on next app start
4. UI progress indicator during scan (not just a final notification)

---

### GAP-CS-02 (P1) — `project_index.json` may not exist at ModuleMap build time

**What the draft says:** Step 6: "Build on existing `project-indexer.ts`" and "Read
existing `project_index.json` (already generated by project-indexer)."

**The gap:** The draft assumes `project_index.json` already exists. It does not define
the ordering guarantee between project indexing and ModuleMap cold start. A newly-added
project triggers both processes. If ModuleMap cold start runs before `project-indexer.ts`
generates `project_index.json`, `loadProjectIndex()` returns null or throws. The draft
has no null check or fallback for this case.

**Required fix:** `module-map.ts` cold start must check for `project_index.json` existence
and either: (a) wait for `project-indexer.ts` to complete via a promise/event, or
(b) generate a minimal ModuleMap from direct directory walk if the index file is absent.
Add explicit sequencing: project-indexer runs first, emits `project:indexed` event, ModuleMap
cold start listens for this event.

---

### GAP-CS-03 (P1) — No incremental cold start for large monorepos

**What the draft says:** "Walk directory tree, group files by folder structure" as step 1
of static analysis.

**The gap:** For a monorepo with 50,000+ files (e.g., a large enterprise project), the full
directory walk will take 10-30 seconds just for I/O. The draft has no file count limit,
no depth limit, and no `.gitignore` / `.auto-claudeignore` filtering during the walk. The
LLM classification step that follows will receive a file list too large for a single prompt
if the project has hundreds of modules.

**Required fix:**
1. Respect `.gitignore` patterns during directory walk (use `ignore` npm package)
2. Implement a hard cap: max 10,000 files in initial scan
3. For LLM classification, batch files into groups of ~200 paths per prompt call
4. Add `node_modules/`, `.git/`, `dist/`, `build/`, `.cache/` to default exclusion list

---

### GAP-CS-04 (P2) — Re-scan trigger not defined

**What the draft says:** No mention of when to re-run the cold start scan for an existing
project.

**The gap:** When a user adds a major new feature (new directory, new service), the
ModuleMap becomes stale. The draft has incremental updates via file access instrumentation,
but no mechanism for detecting that a project has structurally changed enough to warrant a
fresh scan. If a developer adds a new `payments/` service directory but never has an agent
session touch those files, the ModuleMap will never learn about it.

**Required fix:** Trigger a partial re-scan when:
1. A new top-level directory is detected (check on task start, compare against known modules)
2. User explicitly requests "Refresh project map" from the UI
3. More than 30 days since last full scan (background, low-priority)

---

## Focus Area 3: Embedding Lifecycle

### GAP-EL-01 (P0) — Mixed-dimension vectors crash sqlite-vec

**What the draft says:** Section 12: "On model switch, trigger background re-embedding job.
Never mix embeddings from different models in the same similarity search."

**The gap:** The `memory_vec` virtual table is defined with a fixed dimension:
```sql
CREATE VIRTUAL TABLE IF NOT EXISTS memory_vec USING vec0(
  embedding float[768]
);
```
If the user switches from `nomic-embed-text` (768 dim) to `qwen3-embedding:0.6b` (1024 dim),
any new memories inserted will have 1024-dim vectors. The `vec0` table with `float[768]`
will reject these inserts with a dimension mismatch error. The draft says "filter to memories
embedded with the current active model" but does NOT say how to handle the `vec0` table
schema constraint.

**Required fix:** Use separate `memory_vec` virtual tables per embedding model, named
`memory_vec_768`, `memory_vec_1024`, `memory_vec_2560`. Alternatively, store the vector in
the `memories` table as a raw `BLOB` column and perform the cosine similarity computation
in application code (acceptable for <10K vectors), bypassing the fixed-dimension constraint.
The application-code approach is simpler and eliminates the schema migration complexity.

---

### GAP-EL-02 (P0) — Re-embedding job has no progress tracking or resumability

**What the draft says:** "On model switch, trigger background re-embedding job."

**The gap:** For a user with 5,000 memories switching from `nomic-embed-text` to
`qwen3-embedding:0.6b`, a re-embedding job must make 5,000 `embed()` calls to Ollama.
At ~50ms each, this is 4+ minutes of background work. The draft does not specify:
- How to resume if the app is closed mid-job
- How to avoid blocking new memory writes during re-embedding
- What happens to search quality during the transition (some memories are old-dim,
  some are new-dim — mixing them corrupts search results)
- How to surface progress in the UI

**Required fix:**
1. Store `reembedding_job` state in SQLite: `{ model, start_time, last_processed_id, total, done }`
2. Process in batches of 50 with `embedMany()`, commit each batch
3. During re-embedding, filter search to only return memories already re-embedded
   (by checking `embedding_model = currentModel`)
4. IPC progress events: `memory:reembedding-progress { done, total, pct }`
5. Resumable: on app start, check for in-progress job and continue

---

### GAP-EL-03 (P1) — No Ollama availability check before embedding calls

**What the draft says:** Section 12 describes using Ollama for local embeddings. No mention
of availability checking.

**The gap:** Ollama may not be running when the user starts the app. The draft does not
specify a health check before embedding calls, an error message to the user when Ollama
is absent, or whether memory writing should be queued/deferred when Ollama is unavailable.

**Required fix:**
1. On `MemoryService.initialize()`, ping Ollama health endpoint (`GET /api/tags`)
2. If unavailable, set `embeddingAvailable: false` and surface "Memory unavailable —
   start Ollama to enable memory recording" in the UI status indicator
3. Queue memory write requests while Ollama is unavailable (up to 100 queued, then drop
   with warning)
4. Retry Ollama connection every 30 seconds
5. Memory reads (search) that require embeddings should fall back to keyword-only search
   when Ollama is unavailable

---

### GAP-EL-04 (P1) — `embeddingModel` field not enforced at search time

**What the draft says:** "On retrieval, filter to memories embedded with the current
active model."

**The gap:** The draft does not specify where this filter is applied in the query pipeline.
The `memory_vec` virtual table does NOT store `embedding_model` — only the `memories` table
does. A sqlite-vec ANN search returns nearest neighbors from ALL vectors regardless of model.
To filter by model, you would need to join the ANN results with the `memories` table and
discard results with mismatched `embedding_model`. This means the `vec0` ANN query may
return many results that get discarded, degrading effective precision. The draft implies
this filtering happens but does not define the SQL.

**Required fix:** Store `embedding_model` in the `memory_vec` table as an additional
column, or perform a two-stage query: (1) ANN query from `memory_vec`, (2) filter by
`embedding_model` in `memories` table, (3) if fewer than K valid results remain, fall back
to keyword search. Document this explicitly in the implementation.

---

### GAP-EL-05 (P2) — Cloud-to-local embedding model migration not addressed

**What the draft says:** Section 9 migration flow mentions "Re-embed with cloud embedding
model (dimensions may differ from local)." Section 8 mentions cloud uses Voyage/TEI.

**The gap:** When a user goes BACK from cloud to local (e.g., cancels subscription),
memories embedded with Voyage-3 (1024 dim) need to be re-embedded with `nomic-embed-text`
(768 dim) for local search to work. The draft only describes the local-to-cloud migration
direction. The reverse path is unspecified, leaving the user with a non-functional local
memory system after downgrading.

**Required fix:** The migration flow must handle both directions:
- Local → Cloud: re-embed with cloud model (documented)
- Cloud → Local: download memories with their content, re-embed locally, store in SQLite
Add "Export memories for offline use" functionality that explicitly handles the re-embedding
step and shows progress.

---

## Focus Area 4: Search Quality

### GAP-SQ-01 (P0) — Hybrid scorer weights are hardcoded with no validation basis

**What the draft says:** `score = 0.6*cosine + 0.25*recency + 0.15*access_frequency`

**The gap:** The weights 0.6/0.25/0.15 are presented as final without any empirical
justification. The draft does not define how to tune these weights if search quality is
poor. For a new project with few memories and no access history (`accessCount = 0` for
all), the `frequencyScore` term adds zero value and the 0.15 weight is wasted — effectively
making the scorer `0.6*cosine + 0.25*recency`. For memories with no access history but high
cosine similarity, the recency penalty can bury highly relevant old `decision` memories.

**Required fix:**
1. Document the weight rationale: "validated on N test queries with M memories"
2. Make weights configurable via settings (advanced) so users can tune for their usage
3. For the `decision` and `convention` types (no decay), override the recency term to 1.0
   rather than letting it decay to near-zero for memories older than 90 days
4. Add a `boostScore` field to Memory: allows user-pinned items and `human_feedback` type
   to always score above the hybrid threshold

---

### GAP-SQ-02 (P0) — MMR reranking has no defined K value

**What the draft says:** "After top-K selection, apply Maximal Marginal Relevance to ensure
diversity."

**The gap:** "top-K" is never defined. The injection budget is ~1,200 tokens for Tier 2.
At ~30 tokens per compressed summary, that is 40 memories maximum. But should K be 40?
100? The draft does not define K for the initial ANN query, nor the final count after MMR
reranking. MMR with a small K (e.g., 5) will miss relevant memories that were ranked 6-10
by cosine but would have been diverse. MMR with a large K (e.g., 200) on a 10K-vector
database is 200 cosine computations post-ANN — acceptable, but not specified.

**Required fix:** Explicitly define: ANN retrieves top-100 candidates, MMR selects top-20
for injection. Budget enforcement: if 20 summaries exceed 1,200 tokens, truncate from the
bottom (lowest hybrid score). Document these numbers in the implementation spec.

---

### GAP-SQ-03 (P1) — Module-scoped search has no fallback for unknown modules

**What the draft says:** Section 3 Step 2: "Vector search scoped to memories whose
`source.file` overlaps with auth module files."

**The gap:** For new tasks or tasks that describe functionality not yet in the ModuleMap,
there is no matching module. The scoped search will return zero results. The draft does not
define what happens in this case — does it fall back to project-wide search? Does it inject
nothing? A zero-memory injection on the first task in a new feature area is a missed
opportunity and leaves agents without context.

**Required fix:** Define a fallback hierarchy for memory retrieval:
1. Module-scoped search (primary)
2. If <5 results: widen to project-wide search
3. If still <5 results: include user-level memories (projectId = null)
4. Always include `convention` and `decision` type memories regardless of scope
   (these are architectural truths that apply to all tasks)

---

### GAP-SQ-04 (P1) — Task-to-module matching is not specified

**What the draft says:** Section 3: "The system matches 'auth' against the ModuleMap."
Section 5: "Scoped to modules identified from the task via ModuleMap."

**The gap:** The matching algorithm is never defined. Is it keyword matching ("auth" in
task description matches module named "authentication")? Is it LLM-based classification?
Is it embedding similarity between task description and module descriptions? For a task
like "Fix the memory leak in the connection pool", keyword matching would need to resolve
"connection pool" to the database module — which may not be obvious from simple string
matching.

**Required fix:** Define the matching algorithm explicitly:
1. Primary: keyword extraction from task title + description (use existing
   `keyword-extractor.ts`), match against module names and descriptions
2. Secondary: if keyword match returns <2 modules, embed the task description and
   find top-3 module descriptions by cosine similarity
3. Return top-3 matched modules for memory scoping (not just the top-1)

---

### GAP-SQ-05 (P2) — No search result quality feedback loop

**What the draft says:** `memoryHits: number` in the metrics (Section 15) — "Memories
referenced in agent output."

**The gap:** "Referenced in agent output" is not defined operationally. The system has no
way to automatically detect whether an agent actually used a retrieved memory versus
ignoring it. Without a feedback signal, the hybrid scorer weights cannot be improved over
time. The draft mentions `accessCount` grows with retrieval — but retrieval does not equal
usefulness.

**Required fix:**
1. Instrument the agent's tool call log: if agent calls `search_memory` and then reads a
   file that is in the returned memory's `source.file`, count that as a "hit"
2. Track injection-to-use ratio: memories injected via T1/T2 that the agent explicitly
   references (e.g., quotes or uses a file from) vs. ignored
3. Surface per-memory hit rate in the Memory Browser UI
4. Long-term: use hit rate to adjust individual memory `confidenceScore`

---

## Focus Area 5: Memory Garbage Collection

### GAP-GC-01 (P0) — 50 memories/session rate limit is per-call, not per-session-globally

**What the draft says:** "Max 50 memories per agent session."

**The gap:** The draft does not specify whether this limit is enforced: (a) by counting
`memory-write` messages received from a single worker, (b) by counting calls to
`addMemory()` that originated from a specific session, or (c) by counting post-session
extraction outputs separately from real-time writes. Post-session extraction can add
another 10-20 memories on top of the real-time writes. A session that writes 49 memories
in real-time plus 20 from extraction = 69 total, exceeding the spirit of the limit.

**Required fix:** Track writes per `sessionId` in `MemoryService`. The session-level counter
applies to ALL writes for that session (real-time + extraction combined). When extraction
runs, check remaining budget: `50 - realtime_writes`. Emit a metric event when a session
hits the cap.

---

### GAP-GC-02 (P0) — 30-day soft-delete grace period conflicts with VACUUM strategy

**What the draft says:** Soft-delete with 30-day grace period. "Run VACUUM quarterly or
when DB exceeds 100MB."

**The gap:** `VACUUM` in SQLite reclaims space from deleted rows by rewriting the entire
database. If you soft-delete rows (set `deleted_at`) but never hard-delete them, VACUUM
will NOT reclaim their storage — the rows still exist. The 30-day grace period means
hundreds of "deleted" memories accumulate in the database, all still consuming vector
storage in `memory_vec`. The draft says ModuleMap is "deleted immediately" but memories
only after 30 days. The VACUUM strategy assumes rows are actually deleted before VACUUM
runs, which they are not during the grace period.

**Required fix:** Implement a background hard-delete job that runs at app start:
1. Find all memories where `deleted_at IS NOT NULL AND deleted_at < (now - 30days)`
2. Hard-delete rows from `memories` and `memory_vec` tables
3. Run VACUUM only after hard-delete to reclaim space
4. Track `pending_deletion_count` metric for operations dashboard

---

### GAP-GC-03 (P1) — No cap on total memories per project

**What the draft says:** Per-session limits (50/session) but no total project cap.

**The gap:** A user who runs 100 agent sessions (realistic for a 6-month project) could
accumulate 5,000 memories even with the per-session limit. At 5,000 vectors × 768 dim ×
4 bytes = 15MB for vectors alone. The draft projects this as "Heavy (1 year): ~5,000
vectors, ~30MB" — which is fine for local SQLite. BUT: search quality degrades as the
memory count grows without curation. A user with 3,000 stale memories from early
exploration will get noisy retrieval results that hurt rather than help.

**Required fix:**
1. Implement automatic quality-based pruning when project memory count exceeds 2,000:
   - Hard-delete deprecated memories older than 90 days
   - Demote memories with `confidenceScore < 0.2` and `accessCount = 0` after 60 days
   - Surface "Your project has 2,340 memories — consider reviewing and pruning" in UI
2. Add `auto_prune_enabled` setting (default: true) in settings
3. Show memory count in the Memory Browser with a color indicator (green/yellow/red)

---

### GAP-GC-04 (P1) — Deduplication threshold 0.92 is not validated for code memory

**What the draft says:** "Cosine similarity > 0.92: merge or skip."

**The gap:** The threshold 0.92 is stated without empirical basis for code-related memory
content. For short memories (e.g., "Use tabs not spaces"), two memories that are semantically
identical but phrased differently may score 0.85-0.88 cosine similarity — below the threshold
— resulting in duplicates. Conversely, for very specific technical memories ("The PKCE flow
requires state parameter validation in redirect handler"), two DIFFERENT gotchas in related
areas may score above 0.92, causing one to be incorrectly skipped.

**Required fix:**
1. Define a validation test suite: 50 pairs of (definitely-duplicate, definitely-different)
   memory strings, verify 0.92 threshold correctly classifies them
2. Implement a three-tier deduplication decision:
   - `> 0.95`: skip (near-exact duplicate)
   - `0.85 - 0.95`: flag for human review ("Similar memory exists — update or keep both?")
   - `< 0.85`: always store as new memory
3. Log deduplication decisions for quality audit

---

### GAP-GC-05 (P2) — No bulk operations in Memory Browser

**What the draft says:** Section 18 UI: "Delete individual memory" (P0).

**The gap:** With potentially thousands of memories, individual deletion is impractical for
maintenance. Users need bulk operations: "Delete all memories older than 90 days", "Delete
all memories from this session", "Delete all deprecated memories." Without these, the Memory
Browser becomes read-only in practice for users with large memory stores.

**Required fix:** Add bulk operations to Memory Browser:
- Select all / deselect all checkbox
- Delete selected
- Filter + delete all matching filter
- Archive (bulk deprecate) selected memories

---

## Focus Area 6: ModuleMap Staleness

### GAP-MM-01 (P0) — No version conflict resolution when multiple agents update the same module

**What the draft says:** Section 6: "When agent discovers a new auth-related file in Session 3
that wasn't in the Session 1 map, it gets added to the authentication module. ModuleMap is
updated transactionally in-place."

**The gap:** The draft does not define what "transactionally in-place" means for concurrent
updates. If two parallel coder subagents both discover new files in the `authentication`
module and both call `update_module_map("authentication", { coreFiles: [...] })` within
the same session, the second write will overwrite the first. The `coreFiles` field is an
array — without merge semantics, concurrent writes will lose data.

**Required fix:** `updateModule()` must use a read-modify-write pattern with optimistic
locking:
```typescript
async updateModule(projectId: string, moduleName: string, updates: Partial<Module>): Promise<void> {
  // In the write queue:
  const current = await this.getModule(projectId, moduleName);
  const merged = {
    ...current,
    coreFiles: Array.from(new Set([...current.coreFiles, ...(updates.coreFiles ?? [])])),
    // Array fields: union, not replace
    // String fields: replace (latest wins)
  };
  await this.saveModule(projectId, moduleName, merged);
}
```

---

### GAP-MM-02 (P0) — ModuleMap JSON column has no size limit

**What the draft says:** ModuleMap stored as `data TEXT NOT NULL` JSON column in SQLite.

**The gap:** For large projects with hundreds of modules (a monorepo with 50 services),
the ModuleMap JSON could grow to 500KB+. SQLite TEXT columns have no practical size limit,
but: (1) loading a 500KB JSON on every `getModuleMap()` call is expensive, (2) injecting
the full ModuleMap into the agent prompt would blow the ~600 token Tier 1 budget, and
(3) serializing/deserializing large JSON on every write is slow. The draft says "condensed
module listing relevant to the task" but doesn't define how condensing works.

**Required fix:**
1. Store modules individually: `module_maps` table stores metadata, `modules` table stores
   individual module rows (one row per module). Load only relevant modules per query.
2. Define a `condense()` function that takes the full ModuleMap and a list of relevant
   module names and returns only those modules (plus dependency links).
3. Add a size warning: if total ModuleMap JSON exceeds 50KB, log a performance warning.

---

### GAP-MM-03 (P1) — File rename/deletion not handled in ModuleMap

**What the draft says:** "File access instrumentation" adds newly-discovered files.
No mention of file removal.

**The gap:** When a developer renames `src/auth/tokens.ts` to `src/auth/jwt-tokens.ts`,
the ModuleMap still references the old path. Agents given the old path will get
"file not found" errors. The draft's incremental update only ADDS files — it never
removes stale paths. Over time, the ModuleMap will accumulate dead file references.

**Required fix:**
1. Post-session extractor should check all files referenced in ModuleMap against the
   filesystem. Files that no longer exist should be removed from `coreFiles`.
2. Alternatively, the `Read` tool executor should emit `file-not-found` events that
   the ModuleMap service listens to, removing stale paths reactively.
3. On `Edit`/`Write` tool calls that create new files, check if the file matches an
   existing module's directory pattern and add it proactively.

---

### GAP-MM-04 (P1) — `confidence: "mapped"` promotion criteria not defined

**What the draft says:**
- `"shallow"` → from static scan
- `"partial"` → LLM classified
- `"mapped"` → agent has worked multiple sessions in this module

**The gap:** "Multiple sessions" is undefined. Is it 2 sessions? 5? Does every file in
`coreFiles` need to have been accessed at least once? A module could be "mapped" with only
2 sessions if both sessions touched all files, or could take 20 sessions if sessions only
touched 1-2 files each. Without clear criteria, `confidence` is meaningless as a signal
to agents.

**Required fix:** Define concrete promotion criteria:
- `"shallow"` → `"partial"`: LLM classification has run AND module description is generated
- `"partial"` → `"mapped"`: at least 3 sessions have accessed files in this module AND
  >80% of `coreFiles` have been accessed at least once AND no agent has called
  `update_module_map` with corrections in the last 5 sessions

---

### GAP-MM-05 (P2) — No mechanism to detect module boundary changes

**What the draft says:** Modules are defined at cold start and updated incrementally.

**The gap:** Over a 6-month project lifetime, the codebase architecture may fundamentally
change. A monolithic `auth` module may be split into `authentication`, `authorization`, and
`sessions`. The ModuleMap has no mechanism to detect this structural change — it will
continue to show the single `auth` module until manually updated. Agents given this stale
map may look in the wrong places for authorization logic.

**Required fix:** Add a monthly "map health check" (background, low-priority):
1. Re-run the LLM classification step on the current file structure
2. Compare new classification against current ModuleMap
3. If >30% of modules have changed (files moved to different modules), surface a
   "Project structure has changed significantly — update your module map?" prompt
4. User can approve, reject, or manually merge the new classification

---

## Focus Area 7: Terminal Integration

### GAP-TI-01 (P0) — Terminal memory injection writes to filesystem, not MemoryService

**What the draft says:** Section 14: "Memory injection happens in
`terminal/claude-integration-handler.ts` → `finalizeClaudeInvoke()` by writing a memory
context file that gets included in the terminal session's system prompt."

**The gap:** This is architecturally inconsistent with the rest of the design. All other
memory reads go through `MemoryService.search()`. Terminal memory injection writes to a
file on disk and reads from it. This means:
1. Terminal sessions bypass the hybrid scorer and MMR reranking
2. Terminal memory injections are not subject to the token budget enforcement
3. If the context file is large, the terminal agent gets poor-quality uncurated context
4. The file-based approach requires a read at session start but has no mechanism for
   the terminal agent to call `search_memory` for T3 on-demand retrieval

**Required fix:** Terminal memory injection must go through `MemoryService` directly (main
thread), not through a filesystem file. Since terminals run as PTY processes (not worker
threads), they communicate via IPC not `postMessage()`. The terminal integration handler
should call `MemoryService.search()` directly (it is in the main process) and format the
result into the system prompt injection, identical to how worker-thread agents receive
it via `injectContext()`.

---

### GAP-TI-02 (P1) — Terminal agents have no `record_memory` tool

**What the draft says:** Section 14: "Memory injection happens in
`finalizeClaudeInvoke()` by writing a memory context file."

**The gap:** The draft describes terminal memory as READ-ONLY from the terminal agent's
perspective. Terminal Claude sessions cannot write new memories. A user who discovers an
important gotcha while working in a terminal cannot capture it to memory. The only way
to add memories from terminal sessions is via the `record_gotcha` file-based tool — which
the draft says "rewired from file write to memory-write message" in Step 5, but this is
written for worker-thread agents, not PTY-based terminal agents.

**Required fix:** Terminal agents need a `record_memory` equivalent. Since terminals use
PTY (not `postMessage()`), the mechanism must be different:
1. Define a special command syntax that `claude-integration-handler.ts` intercepts:
   `@memory: <content>` in the terminal output stream
2. When the integration handler detects this pattern, call `MemoryService.addMemory()`
   directly (same main-thread service)
3. Alternatively, expose `memory:write` IPC channel that the terminal PTY process can
   invoke via a preload bridge

---

### GAP-TI-03 (P1) — Terminal memory injection timing is not defined

**What the draft says:** "Writing a memory context file that gets included in the terminal
session's system prompt."

**The gap:** Terminal Claude sessions can be long-lived (hours). The memory context file
is written at session start. If the user works in a terminal for 3 hours, the memory
context becomes stale mid-session — new memories written by concurrent agent sessions
are not reflected. Unlike agent sessions that complete and restart, terminals are persistent.

**Required fix:** For long-lived terminal sessions:
1. Re-inject updated memory context every N turns (configurable, default: every 10 turns)
2. Detect when memory count has changed since last injection (track `last_injection_count`)
3. Append a "Memory Update" block to the conversation rather than reinserting the full
   system prompt (which cannot be modified mid-conversation in the Claude SDK)

---

### GAP-TI-04 (P2) — Terminal memory scope is not defined

**What the draft says:** "Memory injection happens in `finalizeClaudeInvoke()`."

**The gap:** When a terminal agent is doing general exploration (not a specific task),
which modules should memory retrieval be scoped to? The task-scoped retrieval (Section 5
Tier 2) requires a known task description to identify relevant modules. Terminal sessions
may not have a task description. The draft does not define how to scope terminal memory
retrieval.

**Required fix:** Terminal memory injection should use a simplified scope:
1. If the terminal has an active task context (task ID is set): use task-scoped retrieval
   identical to agent sessions
2. If no task context: inject Tier 1 only (always-on conventions, decisions, pinned
   memories) + top-10 most frequently accessed memories for this project
3. When the terminal user types a command (detectable via PTY output), dynamically add
   module-relevant memories based on which files are mentioned in recent turns

---

## Focus Area 8: Failure Modes

### GAP-FM-01 (P0) — Post-session extractor has no trigger path for crashed/cancelled sessions

**What the draft says:** Section 22 Step 7: "Trigger: Called from `worker-bridge.ts`
after worker thread exits."

**The gap:** The draft assumes workers exit cleanly. In practice:
1. A worker can crash (unhandled exception in a tool executor)
2. A user can cancel a running agent session
3. The Electron app can crash/restart mid-session

In all three cases, the post-session extractor is never triggered. The agent may have
made dozens of valuable observations during the session that are never extracted. The
draft has no recovery path for partially-completed sessions.

**Required fix:**
1. Workers MUST emit a `session-ending` message before any exit path (clean, error, or
   cancellation). The worker should handle `process.on('SIGTERM')` and `uncaughtException`
   to emit this message.
2. Store in-progress session state in SQLite: `{ sessionId, workerId, startedAt, lastToolCall }`
3. On app start, check for sessions with `startedAt` that have no corresponding extractor
   run — trigger extraction on these orphaned sessions from their last known state
4. If session transcript is unavailable (crash lost it), skip extraction gracefully and
   log a metric: `extraction_skipped_reason: "crash"`

---

### GAP-FM-02 (P0) — SQLite corruption recovery is not specified

**What the draft says:** "`PRAGMA integrity_check` on startup (fast for <100MB)."

**The gap:** `integrity_check` detects corruption but the draft has no recovery plan if
corruption is detected. Telling the user "your memory database is corrupted" with no
recovery path is unacceptable. The draft mentions rolling backups but does not connect
backup restoration to the corruption detection path.

**Required fix:** Define the recovery flowchart:
1. `integrity_check` fails on startup
2. Attempt: run `PRAGMA wal_checkpoint(TRUNCATE)` and retry `integrity_check`
3. If still failing: attempt backup restoration from `.bak.1`, `.bak.2`, `.bak.3` in order
4. If all backups fail: delete corrupt DB, create fresh empty DB, log error, notify user
   "Memory database was corrupted and could not be recovered. Starting fresh."
5. If backup restoration succeeds: notify user how many memories were recovered and
   from what date

---

### GAP-FM-03 (P1) — Convex network failure does not have a defined retry strategy

**What the draft says:** Section 9: "If CloudStore call fails with network error, throw
and surface to UI — do NOT silently fall back to local."

**The gap:** Throwing immediately on first failure is too aggressive. A single network
hiccup (DNS timeout, brief outage) should not block the agent from writing memories.
The draft says "agent continues working without memory rather than writing to wrong backend"
— which means any network instability permanently disables memory for the session. No retry,
no backoff, no brief buffering.

**Required fix:** Implement a limited retry strategy for Convex:
1. On failure: buffer memory writes in an in-memory queue (max 50 writes, 5-minute window)
2. Retry with exponential backoff: 1s, 2s, 4s, 8s, give up after 4 retries
3. If all retries fail: THEN throw and notify UI "Cloud memory temporarily unavailable"
4. Flush the buffer when connectivity is restored
5. Surface UI indicator: "Syncing 12 buffered memories..." when flush is in progress

---

### GAP-FM-04 (P1) — Secret scanner failure is not handled

**What the draft says:** "Wire `secret-scanner.ts` to run on ALL `content` strings before
any `addMemory()` call."

**The gap:** The draft does not specify what happens if `secret-scanner.ts` throws an
exception. If the scanner has a bug or encounters malformed content, it could block ALL
memory writes (since every `addMemory()` call must pass through it). The draft also
does not specify what to do if the scanner detects a secret — does it: (a) reject the
memory write entirely, (b) redact and proceed, or (c) ask the user?

**Required fix:**
1. Secret scanner failures must be caught and logged, but MUST NOT block memory writes.
   Use a try-catch that logs the error and continues with the original (unscanned) content
   marked with `secretScanSkipped: true` for audit.
2. Define the detection behavior explicitly: ALWAYS redact (not reject). The memory is
   valuable even without the secret. Rejection would cause agents to lose important context.
3. Surface redaction events to the user in a non-blocking toast: "Sensitive data detected
   and redacted in memory from session XYZ."

---

### GAP-FM-05 (P2) — No circuit breaker for Ollama embedding failures

**What the draft says:** Section 12 describes embedding via Ollama. No failure handling.

**The gap:** If Ollama becomes unresponsive mid-session (e.g., model swap, OOM kill),
every `addMemory()` call will hang waiting for the `embed()` response. With the write queue
from GAP-RC-01, the queue will back up indefinitely. Agents that call `record_memory` will
not return a response (their `postMessage` is fire-and-forget, so they won't block — but
the queue will grow without bound and degrade main-thread performance).

**Required fix:** Implement a circuit breaker for the embedding service:
1. Track consecutive embedding failures
2. After 3 consecutive failures: open the circuit, mark `embeddingAvailable: false`
3. While circuit is open: store memories WITHOUT embeddings (set embedding to null)
4. These embedding-less memories are NOT searchable by vector — only by keyword fallback
5. Re-try circuit every 30 seconds (half-open state)
6. When circuit closes: schedule re-embedding for all memories with null embedding

---

## Focus Area 9: Testing Strategy

### GAP-TS-01 (P0) — No testing strategy defined for the memory system

**What the draft says:** Each step in Section 22 ends with "Test: [brief description]."
No test file structure, test framework usage, or coverage requirements are specified.

**The gap:** The draft says "Test: Create, read, search memories in unit test with in-memory
SQLite" — but does not define:
- Whether to use Vitest (the project's test framework) or a separate test setup
- How to mock Ollama for embedding tests (avoid real HTTP calls in unit tests)
- What the test file structure should be (co-located with source or in `__tests__/`?)
- Whether integration tests should test the full worker-thread → main-thread → SQLite path
- Coverage requirements

**Required fix:** Define a test strategy document covering:
1. Unit tests (Vitest + in-memory SQLite via `better-sqlite3` `:memory:`):
   - `memory-service.test.ts`: CRUD operations, dedup, soft-delete
   - `hybrid-scorer.test.ts`: weight calculation, decay functions
   - `module-map.test.ts`: cold start, incremental update, merge semantics
   - `secret-scanner.test.ts`: detection patterns, redaction
2. Integration tests (Vitest + real SQLite file):
   - Worker thread → main thread memory write flow
   - Embedding → store → search round-trip (mocked embed function)
   - Post-session extractor with fixture session transcript
3. Mocking strategy: mock `embed()` to return deterministic vectors; use
   cosine-similar fixture vectors for search tests

---

### GAP-TS-02 (P1) — No regression tests for hybrid scorer

**What the draft says:** Hybrid scorer formula defined in Section 10.

**The gap:** The hybrid scorer has 4 components: cosine, recency decay, access frequency,
and type-specific decay rates. Each component is a formula. Without automated tests for
these formulas, a change to the scorer (e.g., tuning weights) could break memory retrieval
quality without any failing test. The decay rate table in Section 10 has 7 types — any
miscalculation in `getDecayRate()` would silently return wrong scores.

**Required fix:** Write parameterized unit tests for every decay type:
```typescript
test.each([
  ['convention', 365, 1.0],   // No decay after 1 year
  ['context', 7, 0.5],        // 50% after 7 days (7-day half-life)
  ['gotcha', 60, 0.5],        // 50% after 60 days
])('decay(%s, %i days) = %f', (type, days, expected) => {
  expect(recencyScore(type, days)).toBeCloseTo(expected, 1);
});
```

---

### GAP-TS-03 (P1) — No contract tests for CloudStore / LocalStore interface

**What the draft says:** Both `LocalStore` and `CloudStore` implement the same interface.
`MemoryService` delegates to either.

**The gap:** The shared interface is defined by TypeScript types but there are no contract
tests that verify both implementations satisfy identical behavioral contracts. A bug in
`CloudStore.search()` that returns results in a different order than `LocalStore.search()`
could cause subtle differences in memory injection quality for cloud vs. local users.

**Required fix:** Create a shared `MemoryStoreContractTests` test suite that runs against
both `LocalStore` (with in-memory SQLite) and a mocked `CloudStore`:
```typescript
export function runMemoryStoreContractTests(factory: () => MemoryStore) {
  it('search returns results sorted by hybrid score', async () => { ... });
  it('addMemory respects deduplication threshold', async () => { ... });
  it('soft-delete excludes memories from search', async () => { ... });
}
```

---

### GAP-TS-04 (P2) — No load/performance tests for sqlite-vec

**What the draft says:** Section 7: "10K vectors: ~20-50ms search latency."

**The gap:** These latency numbers are assertions, not measurements. If the Electron app is
running on a 2019 MacBook Air with an encrypted SQLCipher database, real latency may be
3-5x higher than on the benchmark machine. There are no performance regression tests that
would catch a query regression introduced by a schema change (e.g., adding a new WHERE
clause to the search query).

**Required fix:** Add a performance benchmark fixture:
```typescript
// bench/memory-search.bench.ts (Vitest bench API)
bench('search 10K memories (768-dim)', async () => {
  const db = await createFixtureDb({ memoryCount: 10_000 });
  const query = await embed('authentication JWT token refresh');
  await db.search(query, { limit: 20 });
});
```
Assert that p95 latency stays below 100ms on CI (GitHub Actions runner). Fail the build
if this threshold is exceeded.

---

## Focus Area 10: Missing Features

### GAP-MF-01 (P0) — No `search_memory` tool definition in the draft

**What the draft says:** Step 5: "Create: `tools/auto-claude/search-memory.ts` — uses
read-only WAL connection in worker thread."

**The gap:** The tool is referenced but never defined. Its interface is not specified:
- What parameters does it accept? (query string? filters? limit?)
- What does it return? (Memory[] ? formatted string?)
- How does the agent know what format to call it with?
- Is it available to all agent types or only specific ones?

**Required fix:** Define the complete tool interface:
```typescript
const searchMemoryTool = tool({
  description: 'Search project memory for relevant context. Use when encountering something unexpected.',
  inputSchema: z.object({
    query: z.string().describe('Natural language search query'),
    type: z.enum(['gotcha', 'decision', 'convention', ...]).optional(),
    limit: z.number().min(1).max(20).default(5),
  }),
  execute: async ({ query, type, limit }, { dbPath }) => {
    const results = await searchMemoryReadOnly(dbPath, query, { type, limit });
    return formatMemoriesForInjection(results); // Returns ~30 tokens per result
  },
});
```

---

### GAP-MF-02 (P0) — No IPC handler definitions for memory CRUD operations

**What the draft says:** Section 22 Step 8: "IPC handlers — new handlers for memory CRUD
operations."

**The gap:** The IPC handler module is listed as a TODO with no specification. The renderer
calls `window.electronAPI.memory.*` — but the channel names, request shapes, and response
shapes are undefined. Without this specification, the UI team cannot implement the Memory
Browser features (edit, delete, pin) independently.

**Required fix:** Define all IPC channels in the implementation plan:
```typescript
// src/preload/memory-api.ts
electronAPI.memory = {
  search: (query: string, filters: MemoryFilters) => ipcRenderer.invoke('memory:search', query, filters),
  add: (content: string, metadata: MemoryMetadata) => ipcRenderer.invoke('memory:add', content, metadata),
  update: (id: string, updates: Partial<Memory>) => ipcRenderer.invoke('memory:update', id, updates),
  delete: (id: string) => ipcRenderer.invoke('memory:delete', id),
  pin: (id: string, pinned: boolean) => ipcRenderer.invoke('memory:pin', id, pinned),
  getModuleMap: (projectId: string) => ipcRenderer.invoke('memory:getModuleMap', projectId),
  getMetrics: (projectId: string) => ipcRenderer.invoke('memory:getMetrics', projectId),
  exportAll: (projectId: string) => ipcRenderer.invoke('memory:exportAll', projectId),
};
```

---

### GAP-MF-03 (P1) — No settings panel for memory configuration

**What the draft says:** Section 12 mentions "user-selected model (already in the app UI
under Settings → Memory)" and "per-project memory toggle" in Section 18 UI table.

**The gap:** The settings that need to exist for the memory system to be user-configurable
are never enumerated as a complete list. There is no settings schema, no default values,
no validation rules. The draft mentions "already in the app UI" for model selection — but
this may be the Graphiti settings, not the new local SQLite memory settings.

**Required fix:** Define the complete settings schema for the memory system:
```typescript
interface MemorySettings {
  enabled: boolean;                    // Master switch
  embeddingModel: string;              // 'nomic-embed-text' | 'qwen3-embedding:0.6b' | ...
  ollamaHost: string;                  // 'http://localhost:11434'
  maxMemoriesPerSession: number;       // 50 default
  autoExtractPostSession: boolean;     // true default
  autoPruneEnabled: boolean;           // true default
  tokenBudgetTier1: number;            // 600 default
  tokenBudgetTier2: number;            // 1200 default
  disabledProjects: string[];          // project IDs excluded from memory
}
```
Add a new Settings tab "Memory" with controls for all fields.

---

### GAP-MF-04 (P1) — Memory system has no health status IPC channel

**What the draft says:** The draft mentions a "Memory unavailable — offline" status
indicator in Section 9 for cloud offline behavior.

**The gap:** There is no defined IPC channel for the renderer to subscribe to memory system
health status. The renderer cannot know: (a) if Ollama is available, (b) if the embedding
model is loaded, (c) if the SQLite database is healthy, (d) how many memories are pending
in the write queue. Without this, the UI cannot show accurate status to the user.

**Required fix:** Add a memory health IPC subscription:
```typescript
// Main thread emits on state changes:
ipcMain.handle('memory:getHealth', () => memoryService.getHealth());
// Pushed to renderer on changes:
mainWindow.webContents.send('memory:health-changed', {
  status: 'healthy' | 'degraded' | 'unavailable',
  embeddingAvailable: boolean,
  pendingWrites: number,
  dbSizeBytes: number,
  lastError?: string,
});
```

---

### GAP-MF-05 (P1) — Insights, Roadmap, and Ideation runners are not wired

**What the draft says:** Section 16: "These runners write memories with `createdBy:
'runner:insights'` etc." Listed in Phase 3 implementation checklist.

**The gap:** The draft defers all non-coding-agent runner memory integration to Phase 3.
However, Insights and Roadmap runners are frequently used features. Users running Insights
sessions generate valuable architectural observations that should be captured. Deferring
this means months of Insights sessions produce no persistent memory value.

**Required fix:** Move Insights runner memory integration to Phase 1 (core). The
implementation is identical to coding agents — Insights runner sessions are also worker
threads, so they already use `postMessage()`. The only change needed is to add
`record_memory` and `search_memory` tools to the Insights runner's tool registry and
ensure its sessions receive Tier 1 + Tier 2 memory injection.

---

### GAP-MF-06 (P2) — No data export format defined

**What the draft says:** Section 18 UI: "Export as Markdown" (P2). Section 17:
"`exportAllMemories(userId)` for data portability (JSON + Markdown)."

**The gap:** The export format is not defined. For Markdown export, should each memory
be a section header? A bullet point? Should memories be grouped by type or by module?
For JSON export, is it the raw Memory schema (with embedding vectors) or a human-readable
subset? Undefined format means implementation will be inconsistent and unusable.

**Required fix:** Define the export formats:

Markdown format:
```markdown
# Project Memory Export: [project-name]
Generated: [date]

## Decisions
- [decision summary] (recorded: [date], confidence: [score])

## Conventions
- [convention summary]

## Gotchas
### [module-name]
- [gotcha summary] (source: [file])
```

JSON format: raw Memory schema excluding `embedding` field (too large, not portable),
plus a top-level `exportedAt` and `embeddingModel` for reference.

---

### GAP-MF-07 (P2) — No telemetry or analytics for memory system health in production

**What the draft says:** Section 15 defines `MemoryMetrics` interface with per-session
and per-project metrics.

**The gap:** The draft defines the metrics interface but does not specify: (a) how metrics
are collected (event-based? periodic sampling?), (b) where they are stored (same SQLite
DB? in-memory only?), (c) how they are surfaced to the development team for monitoring
(is there any aggregation across users?), (d) what the "Memory saved ~X tokens" UI badge
is based on (actual measurement or estimation?).

**Required fix:**
1. Define `discoveryTokensSaved` calculation method: count `Glob`/`Grep`/`Read` tool
   calls in the session, compare against a baseline "sessions without memory" average.
   This is an estimate, not an exact measurement — document as such in the UI.
2. Metrics storage: add a `memory_metrics` table in SQLite, one row per session.
3. Analytics aggregation: expose `getProjectMetrics()` that aggregates across all sessions
   to show trend over time (memory utility improving as ModuleMap matures).
4. No cross-user telemetry for OSS users (privacy). Cloud-only analytics are opt-in.

---

## Summary Table

| Gap ID | Priority | Area | Title |
|--------|----------|------|-------|
| GAP-RC-01 | P0 | Race Conditions | No write queue in MemoryService singleton |
| GAP-RC-02 | P0 | Race Conditions | Embedding initialization race at first write |
| GAP-RC-03 | P1 | Race Conditions | Worker WAL connection lifetime not defined |
| GAP-RC-04 | P1 | Race Conditions | No acknowledgement protocol for memory-write messages |
| GAP-RC-05 | P2 | Race Conditions | Parallel post-session extractors can race on ModuleMap |
| GAP-CS-01 | P0 | Cold Start | No user feedback during cold start scan |
| GAP-CS-02 | P1 | Cold Start | project_index.json may not exist at ModuleMap build time |
| GAP-CS-03 | P1 | Cold Start | No incremental cold start for large monorepos |
| GAP-CS-04 | P2 | Cold Start | Re-scan trigger not defined |
| GAP-EL-01 | P0 | Embedding Lifecycle | Mixed-dimension vectors crash sqlite-vec |
| GAP-EL-02 | P0 | Embedding Lifecycle | Re-embedding job has no progress tracking or resumability |
| GAP-EL-03 | P1 | Embedding Lifecycle | No Ollama availability check before embedding calls |
| GAP-EL-04 | P1 | Embedding Lifecycle | embeddingModel field not enforced at search time |
| GAP-EL-05 | P2 | Embedding Lifecycle | Cloud-to-local embedding model migration not addressed |
| GAP-SQ-01 | P0 | Search Quality | Hybrid scorer weights are hardcoded with no validation basis |
| GAP-SQ-02 | P0 | Search Quality | MMR reranking has no defined K value |
| GAP-SQ-03 | P1 | Search Quality | Module-scoped search has no fallback for unknown modules |
| GAP-SQ-04 | P1 | Search Quality | Task-to-module matching is not specified |
| GAP-SQ-05 | P2 | Search Quality | No search result quality feedback loop |
| GAP-GC-01 | P0 | Garbage Collection | 50 memories/session limit not enforced globally |
| GAP-GC-02 | P0 | Garbage Collection | 30-day soft-delete conflicts with VACUUM strategy |
| GAP-GC-03 | P1 | Garbage Collection | No cap on total memories per project |
| GAP-GC-04 | P1 | Garbage Collection | Deduplication threshold 0.92 not validated for code memory |
| GAP-GC-05 | P2 | Garbage Collection | No bulk operations in Memory Browser |
| GAP-MM-01 | P0 | ModuleMap Staleness | No version conflict resolution for concurrent module updates |
| GAP-MM-02 | P0 | ModuleMap Staleness | ModuleMap JSON column has no size limit |
| GAP-MM-03 | P1 | ModuleMap Staleness | File rename/deletion not handled |
| GAP-MM-04 | P1 | ModuleMap Staleness | "mapped" confidence promotion criteria not defined |
| GAP-MM-05 | P2 | ModuleMap Staleness | No mechanism to detect module boundary changes |
| GAP-TI-01 | P0 | Terminal Integration | Terminal memory injection bypasses MemoryService |
| GAP-TI-02 | P1 | Terminal Integration | Terminal agents have no record_memory tool |
| GAP-TI-03 | P1 | Terminal Integration | Terminal memory injection timing not defined |
| GAP-TI-04 | P2 | Terminal Integration | Terminal memory scope not defined |
| GAP-FM-01 | P0 | Failure Modes | Post-session extractor has no trigger for crashed sessions |
| GAP-FM-02 | P0 | Failure Modes | SQLite corruption recovery not specified |
| GAP-FM-03 | P1 | Failure Modes | Convex network failure has no retry strategy |
| GAP-FM-04 | P1 | Failure Modes | Secret scanner failure is not handled |
| GAP-FM-05 | P2 | Failure Modes | No circuit breaker for Ollama embedding failures |
| GAP-TS-01 | P0 | Testing Strategy | No testing strategy defined |
| GAP-TS-02 | P1 | Testing Strategy | No regression tests for hybrid scorer |
| GAP-TS-03 | P1 | Testing Strategy | No contract tests for CloudStore/LocalStore interface |
| GAP-TS-04 | P2 | Testing Strategy | No performance tests for sqlite-vec |
| GAP-MF-01 | P0 | Missing Features | search_memory tool interface not defined |
| GAP-MF-02 | P0 | Missing Features | No IPC handler definitions for memory CRUD |
| GAP-MF-03 | P1 | Missing Features | No settings panel for memory configuration |
| GAP-MF-04 | P1 | Missing Features | Memory system has no health status IPC channel |
| GAP-MF-05 | P1 | Missing Features | Insights/Roadmap/Ideation runners not wired |
| GAP-MF-06 | P2 | Missing Features | No data export format defined |
| GAP-MF-07 | P2 | Missing Features | No telemetry/analytics for memory system health |

**P0 count: 17** (blockers — must fix before implementation begins)
**P1 count: 18** (important — must fix before V1 ships)
**P2 count: 12** (nice-to-have — can defer to V1.1)

---

## Recommended Pre-Implementation Actions

Before starting the 8-step implementation plan from the draft, resolve these P0 gaps in
the draft document itself:

1. Add write queue specification to MemoryService design (GAP-RC-01)
2. Add EmbeddingService warm-up and initialization gate (GAP-RC-02)
3. Replace fixed-dimension `memory_vec` table with application-code cosine or per-model
   tables (GAP-EL-01)
4. Add re-embedding job resumability specification (GAP-EL-02)
5. Define hybrid scorer K value and weight validation approach (GAP-SQ-01, GAP-SQ-02)
6. Define per-session memory counter that covers real-time + extraction combined (GAP-GC-01)
7. Add hard-delete background job specification for 30-day grace period (GAP-GC-02)
8. Add `updateModule()` merge semantics for array fields (GAP-MM-01)
9. Rewrite terminal integration to use MemoryService directly (GAP-TI-01)
10. Add post-session extractor trigger for crashed/cancelled sessions (GAP-FM-01)
11. Add SQLite corruption recovery flowchart (GAP-FM-02)
12. Define testing strategy with Vitest + in-memory SQLite approach (GAP-TS-01)
13. Define complete `search_memory` tool interface (GAP-MF-01)
14. Define all IPC handler channel names and request/response shapes (GAP-MF-02)
