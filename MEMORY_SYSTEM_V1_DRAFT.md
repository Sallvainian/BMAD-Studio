# Memory System V1 — Architecture Draft (Final)

*Updated with expert panel review, deep-dive agent workflow analysis, concurrency architecture, operational benchmarks, cloud embedding strategy, and product gap analysis.*

---

## 1. The Core Problem

When an AI coding agent starts a session, it knows nothing about the project. It has to traverse files, read code, and discover architecture — burning context window and time. **Every session, it re-discovers the same things.**

The memory system eliminates repeated discovery. It gives agents:
1. **A map** — where things are, how they connect, what files to start with
2. **Experience** — gotchas, decisions, patterns learned from past sessions
3. **Just enough context** — so the agent knows where to go and learn more, without filling its context window

**The goal is NOT to store all the code in memory.** It's to store a navigational map + accumulated wisdom so the agent can jump straight to the relevant files instead of spending 5-10K tokens grepping around.

---

## 2. Two-Layer Memory Model

The V1 architecture uses two distinct layers, each solving a different problem:

### Layer 1: ModuleMap (Structural / Navigational)

**What it is:** A single structured document per project that maps out the codebase architecture — which modules exist, where their files are, how they connect.

**Why it exists:** When a user says *"there's a bug in the auth system"*, the agent needs to instantly know: auth lives in these 7 files, the config is here, the tests are there, and it depends on Redis. Without this, the agent spends the first 5-10K tokens of every session doing `Glob` and `Grep` to re-discover the same file structure.

**How it's stored:** NOT as a vector-searched memory. Fetched by project ID — it's identity-based lookup, not similarity search. One document per project, updated in-place.

```typescript
interface ModuleMap {
  projectId: string;
  modules: Record<string, Module>;
  buildSystem: {
    tool: string;                    // "npm", "cargo", "uv", etc.
    commands: Record<string, string>; // "test": "vitest", "lint": "biome check"
  };
  testFramework: {
    tool: string;                    // "vitest", "pytest", "jest"
    configFile: string;              // "vitest.config.ts"
    runCommand: string;              // "npm test"
  };
  lastUpdated: number;
  version: number;                   // For migration
}

interface Module {
  name: string;              // "authentication"
  description: string;       // "JWT-based auth with Redis session store"
  coreFiles: string[];       // ["src/auth/config.ts", "src/middleware/auth.ts", ...]
  entryPoints: string[];     // ["src/routes/auth.ts"]
  testFiles: string[];       // ["tests/auth/"]
  dependencies: string[];    // ["jsonwebtoken", "redis", "bcrypt"]
  relatedModules: string[];  // ["session", "user-management"]
  confidence: "shallow" | "partial" | "mapped";
}
```

**How it gets built:** See Section 6 (Cold Start + Incremental Learning).

### Layer 2: Memories (Experiential / Wisdom)

**What it is:** Individual memory records accumulated over sessions — gotchas, decisions, conventions, error patterns, user preferences. Vector-searched with hybrid scoring.

**Why it exists:** The ModuleMap tells agents WHERE things are. Memories tell agents WHAT they should know — "the refresh token has a known validation bug", "we chose JWT over sessions because of X", "this test flakes when Redis isn't running."

**How it's stored:** Vector embeddings + metadata in SQLite (local) or Convex (cloud). Retrieved by semantic similarity with hybrid scoring.

```typescript
interface Memory {
  id: string;
  projectId: string | null;   // null = user-level memory (cross-project preferences)
  userId: string;
  createdBy: string;           // Audit trail: "agent:coder" | "agent:qa" | "user"
  type: MemoryType;
  content: string;             // Verbose text for embedding quality (secret-scanned)
  summary: string;             // Pre-computed compressed version for injection (~25-35 tokens)
  embedding: number[];         // Vector from embed()
  embeddingModel: string;      // e.g. "nomic-embed-text", "voyage-3"
  embeddingDim: number;        // 768 recommended
  source: {
    sessionId: string;
    file?: string;
    agent?: string;            // "planner" | "coder" | "qa"
    branch?: string;           // "feature/auth-refactor" — for branch-scoped retrieval
  };
  relations: TypedRelation[];  // Typed edges for contradiction resolution + V2 graph
  confidenceScore: number;     // Starts 0.5, grows with retrieval, drops when deprecated
  deprecated: boolean;         // Soft-delete for contradictions
  pinned: boolean;             // User-pinned, never decays
  visibility: 'private' | 'team' | 'project';  // Access control — default: 'project'
  createdAt: number;
  lastAccessedAt: number;
  accessCount: number;
  deletedAt: number | null;    // Soft-delete with 30-day grace period
}

type MemoryType =
  // Core types
  | "gotcha"               // Watch out for X — moderate decay (60-day half-life)
  | "decision"             // We chose X because Y — no decay
  | "convention"           // This project uses X pattern — no decay
  | "preference"           // User prefers X — slow decay (180-day half-life)
  | "context"              // Recent session context — fast decay (7-day half-life)
  | "error_pattern"        // Error X caused by Y — moderate decay (60-day half-life)
  // Extended types
  | "dependency_relation"  // File A depends on Module B — no decay
  | "environment_quirk"    // This test needs REDIS_URL set — fast decay
  | "human_feedback"       // Explicit user correction — highest weight, no decay
  // PR review types (existing)
  | "pr_review" | "pr_finding" | "pr_pattern" | "pr_gotcha"
  // Session types (existing)
  | "session_insight" | "codebase_discovery" | "codebase_map" | "task_outcome";

interface TypedRelation {
  targetId: string;
  type: "supersedes" | "depends_on" | "caused_by" | "related_to";
}
```

**Key schema additions vs. original draft:**
- `summary` — pre-computed compressed version for token-efficient injection (10:1 compression ratio: store verbose, inject compressed)
- `embeddingModel` + `embeddingDim` — prevents mixed-space search corruption when models change
- `deprecated` + `supersedes` — deterministic contradiction resolution
- `pinned` — user control over permanent memories
- `visibility` — `private` / `team` / `project` access control (P0 for cloud)
- `source.branch` — branch-scoped memory retrieval
- `deletedAt` — soft-delete with 30-day grace period
- `human_feedback` type — ground truth from user, highest weight
- `projectId: null` — user-level preferences that apply across all projects

---

## 3. How It Works: A Real Scenario

User says: *"We're having a bug in the auth system — users get logged out after 5 minutes instead of 24 hours."*

### Step 1: ModuleMap Lookup (~0 tokens spent discovering)

Agent receives the task. The system matches "auth" against the ModuleMap:

```
Module: authentication
├── Core: src/auth/config.ts, src/middleware/auth.ts, src/auth/tokens.ts
├── Entry: src/routes/auth.ts
├── Frontend: stores/auth-store.ts, api/auth.ts
├── Tests: tests/auth/ (mock Redis)
├── Deps: jsonwebtoken, redis, bcrypt
└── Related: session, user-management
```

The agent instantly knows which files to read. Zero grepping.

### Step 2: Scoped Memory Retrieval (~1,200 tokens)

Vector search scoped to memories whose `source.file` overlaps with auth module files:

```
[GOTCHA] middleware/auth.ts
! Refresh token not validated against Redis session store

[DECISION] auth/config.ts
! JWT over session cookies — API-first architecture, 24h expiry

[ERROR] stores/auth-store.ts
! Token refresh race condition with multiple tabs — fixed v2.3 with mutex
```

### Step 3: Agent Starts Working

The agent has:
- **WHERE to look** — 7 specific files, no discovery needed
- **WHAT to watch out for** — 3 relevant memories about known auth issues
- **Full context window** available for actually reading code and fixing the bug

Total memory injection: ~600 tokens (ModuleMap) + ~1,200 tokens (memories) = **~1,800 tokens** — less than 1% of a 200K context window.

---

## 4. Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                        Worker Threads                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │ Agent Session │  │ Agent Session │  │ Agent Session │           │
│  │              │  │              │  │              │           │
│  │ READ: WAL    │  │ READ: WAL    │  │ READ: WAL    │           │
│  │ WRITE: post  │  │ WRITE: post  │  │ WRITE: post  │           │
│  │   Message()  │  │   Message()  │  │   Message()  │           │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘           │
│         └─────────────────┼─────────────────┘                    │
│                           ▼ { type: 'memory-write' }             │
├──────────────────────────────────────────────────────────────────┤
│              MemoryService (main thread singleton)                │
│                                                                  │
│  Layer 1: getModuleMap(projectId) → ModuleMap                    │
│  Layer 1: updateModule(projectId, module)                        │
│                                                                  │
│  Layer 2: addMemory(text, metadata) → secret-scan → embed → store│
│  Layer 2: search(query, filters) → Memory[]                      │
│  Layer 2: forget(memoryId) → soft-delete                         │
│  Layer 2: exportAll(userId) → Memory[]                           │
├──────────────────────────────────────────────────────────────────┤
│              Embedding Layer                                      │
│  AI SDK embed() — Ollama local (768-dim nomic-embed-text)        │
│                 — Cloud: Voyage / TEI (same 768-dim)              │
├──────────────────────────────────────────────────────────────────┤
│              Hybrid Retrieval Scorer                              │
│  score = 0.6*cosine + 0.25*recency + 0.15*access_frequency      │
│  + MMR reranking for diversity                                    │
│  + branch-scoped filtering                                       │
├───────────────────┬──────────────────────────────────────────────┤
│  LocalStore       │  CloudStore                                   │
│  SQLite +         │  Convex                                       │
│  sqlite-vec       │  (vector search + docs + real-time sync)      │
│  SQLCipher        │                                               │
│  (brute-force,    │  ModuleMap: Convex document                   │
│   768-dim,        │  Memories: Convex documents + vector index    │
│   20-50ms @10K)   │  Tenant: ctx.auth scoped                     │
│                   │                                               │
│  ModuleMap: JSON  │  Embedding: Voyage free tier → TEI at scale   │
│  Memories: rows   │                                               │
│  + vec0 table     │                                               │
└───────────────────┴──────────────────────────────────────────────┘
```

---

## 5. Context Injection Strategy (Three Tiers)

Memory needs to give agents enough context to be useful without displacing the actual task. Storage format and injection format differ: **store verbose (for better embedding search), inject compressed (for token efficiency).**

### Tier 1: Always-On (~600 tokens)
- **ModuleMap summary** — condensed module listing relevant to the task
- **Pinned memories** — user-marked permanent knowledge
- **Active conventions/decisions** — no-decay memories
- Injected into system prompt at session start

### Tier 2: Task-Scoped (~1,200 tokens)
- **Hybrid-scored memories** matching the task description
- Scoped to modules identified from the task via ModuleMap
- Uses compressed `summary` field (not full `content`)
- Injected after Tier 1 in system prompt

### Tier 3: On-Demand (via `search_memory` tool)
- Agent calls `search_memory("refresh token validation")` mid-session
- Returns ~30 tokens per result
- Used when agent encounters something unexpected during execution
- Session-scoped deduplication prevents re-retrieving the same memory

**Injection format (compressed reference):**
```
## Project Memory: Authentication Module
Files: auth/config.ts (JWT config), middleware/auth.ts (refresh logic),
       stores/auth-store.ts (frontend), routes/auth.ts (endpoints)
Tests: tests/auth/ (mock Redis) | Deps: jsonwebtoken, redis, bcrypt

[GOTCHA] middleware/auth.ts
! Refresh token not validated against Redis session store

[DECISION] auth/config.ts
! JWT over session cookies — API-first, 24h expiry, 1h refresh window

[ERROR] stores/auth-store.ts
! Token refresh race condition with multiple tabs — mutex fix in v2.3
```

**Total budget: ~1,800 tokens** — 0.9% of a 200K context window. The real context consumers are file reads (20-50K) and tool call history (30-50K). Memory injection is negligible.

---

## 6. Cold Start + Incremental Learning

### Day 0 — Automated Project Scan

When a new project is added, two things happen automatically:

**Static analysis (no LLM, ~10 seconds):**
1. Walk directory tree, group files by folder structure
2. Detect frameworks from `package.json` / `pyproject.toml` / `Cargo.toml`
3. Classify files by extension and path patterns (routes, tests, config, etc.)
4. Detect build system, test framework, linting config
5. Result: ModuleMap with `confidence: "shallow"`

**Fast LLM classification (~30 seconds):**
1. Send file list to small model (Haiku/Flash-equivalent)
2. "Group these files into semantic modules: auth, database, API, frontend, etc."
3. Result: module boundaries with `confidence: "partial"`

**Configuration seeding:**
1. Scan `README.md` → extract tech stack, setup conventions as memories
2. Scan `package.json` / `pyproject.toml` → detect frameworks, create convention memories
3. Scan `.eslintrc` / `biome.json` / `prettier.config` → extract code style preferences
4. Scan any project instruction files (`.cursorrules`, `.windsurfrules`, `AGENTS.md`, etc.) → extract conventions
5. Present seeded memories to user: "I found 12 conventions in your project. Review?"

**By the time the first agent session starts:** there is a partial but usable ModuleMap + initial memories.

### Sessions 1-5 — Incremental Refinement

**File access instrumentation:**
- Every `Read` / `Edit` / `Write` tool call is a signal about file relationships
- Side effect: track which files the agent accesses during each task
- Post-session: add newly-discovered files to the correct module

**Module confidence promotion:**
- `"shallow"` → agent hasn't worked in this module yet (from static scan)
- `"partial"` → agent has accessed some files, LLM classified the module
- `"mapped"` → agent has worked multiple sessions in this module, file list is validated

**Incremental updates, not rewrites:**
- When agent discovers a new auth-related file in Session 3 that wasn't in the Session 1 map, it gets added to the authentication module
- ModuleMap is updated transactionally in-place, not appended as a new memory
- Agent can trigger explicit map update: `update_module_map("authentication", { coreFiles: [...] })`

---

## 7. What Fits OSS (Electron + Next.js Web App)?

**Local/OSS user requirements:**
- Embedded in Electron — no Docker, no external processes, no servers to start
- Works with Next.js web app running locally — same machine, same data
- Free, zero configuration
- Stores: ModuleMap (structured JSON) + Memories (text + embeddings)

**SQLite + sqlite-vec** — SQLite is the most deployed database on Earth. `better-sqlite3` is a top-tier Node.js binding. `sqlite-vec` adds vector search. One `.db` file. Works in Electron. Works in Next.js. No processes to manage.

**Important: sqlite-vec uses brute-force scan, not HNSW.** As of 2025, sqlite-vec does NOT have HNSW indexing — it performs brute-force cosine similarity. This is adequate for our scale:
- 1K vectors (light project): ~2-5ms
- 10K vectors (heavy project after 1 year): ~20-50ms
- 100K vectors (extreme, multi-project): ~200ms — would need sharding

**To keep brute-force fast, use 768-dim embeddings** (nomic-embed-text), NOT 2560-dim (qwen3-4b). 768-dim is 3x faster search, 3x less storage, with negligible quality difference for code memory retrieval.

**Why SQLite over LanceDB:** sqlite-vec keeps everything in one SQLite file (simpler), `better-sqlite3` is already in the project's dependency tree, and LanceDB would add ~50MB bundle size via Arrow dependency.

**Two tables in the same SQLite DB:**
- `module_maps` — JSON column, indexed by project_id
- `memories` — rows with embedding vectors, brute-force vec search

**Storage projections (768-dim embeddings):**
| Usage | Vectors | DB Size | Search Latency |
|-------|---------|---------|----------------|
| Light (3 months) | ~500 | ~5 MB | ~2ms |
| Moderate (6 months) | ~2,000 | ~15 MB | ~8ms |
| Heavy (1 year) | ~5,000 | ~30 MB | ~20ms |
| Power user (1 year) | ~10,000 | ~46 MB | ~50ms |

---

## 8. The Cloud Architecture

**Key constraint:** When the user is inside the Electron app and logged in, memories come from the cloud. The Electron app is just a client.

```
User logged in?
├── YES → All memory ops go to Cloud API (Convex)
│         Works from: Electron, Web App, anywhere
│
└── NO  → All memory ops go to Local DB (SQLite)
          Works from: Electron, local Next.js

User logs in for first time with local memories?
└── Show migration preview → User approves → Migrate to Cloud
```

**For cloud, we already have Convex.** Convex handles:
- Native vector search (cosine similarity, HNSW)
- Structured document storage (ModuleMap as a Convex document)
- Multi-tenancy by design (every query scoped by auth context)
- TypeScript-native SDK
- Real-time subscriptions (memories update live across devices)

---

## 9. Login-Based Routing (Reactive)

```typescript
class MemoryService {
  private backend: LocalStore | CloudStore;

  // Reactive: re-initializes on auth state changes
  initialize(authState: AuthState): void {
    if (authState.isLoggedIn && authState.hasCloudSubscription) {
      this.backend = new CloudStore(authState.convexClient);
    } else {
      this.backend = new LocalStore(getLocalDbPath());
    }
  }

  // Called from auth state change handler in Electron main process
  onAuthStateChanged(newAuthState: AuthState): void {
    this.initialize(newAuthState);
  }

  // All methods delegate to this.backend
  // Interface is identical regardless of backend
}
```

**Offline behavior for cloud users:**
- If CloudStore call fails with network error, **throw and surface to UI** — do NOT silently fall back to local
- Falling back to local creates split-brain state where memories diverge
- UI shows "Memory unavailable — offline" status indicator
- Agent continues working without memory rather than writing to wrong backend

**Migration flow (local → cloud, first login):**
1. Run `SecretScanner` on ALL local memories before migration
2. Show user a preview: "127 memories across 3 projects — review before uploading"
3. Allow users to exclude specific projects from migration
4. Re-embed with cloud embedding model (dimensions may differ from local)
5. Upload ModuleMap + Memories to Convex
6. Mark local DB as "synced, cloud-primary"
7. Future ops go to cloud

---

## 10. Retrieval & Ranking

**Hybrid scoring (not pure cosine similarity):**

```typescript
function scoreMemory(memory: Memory, queryEmbedding: number[], now: number): number {
  const cosineSim = cosineSimilarity(memory.embedding, queryEmbedding);
  const daysSinceAccess = (now - memory.lastAccessedAt) / (1000 * 60 * 60 * 24);
  const decayRate = getDecayRate(memory.type);
  const recencyScore = Math.exp(-decayRate * daysSinceAccess);
  const frequencyScore = Math.min(memory.accessCount / 20, 1.0);

  return 0.6 * cosineSim + 0.25 * recencyScore + 0.15 * frequencyScore;
}
```

**Type-specific decay rates:**
| Type | Half-life | Rationale |
|------|-----------|-----------|
| `convention`, `decision`, `dependency_relation` | Never | Architectural truths persist |
| `human_feedback` | Never | Ground truth from user |
| `gotcha`, `error_pattern` | 60 days | Environments change |
| `preference` | 180 days | User preferences drift slowly |
| `context`, `environment_quirk` | 7 days | Stale context misleads |
| `session_insight`, `task_outcome` | 30 days | Recent sessions matter more |
| `pr_review`, `pr_finding` | 90 days | PR lessons age slowly |

**Pinned memories:** `pinned: true` overrides decay — always scored at full recency weight.

**MMR reranking:** After top-K selection, apply Maximal Marginal Relevance to ensure diversity. Prevents injecting 5 memories that all say the same thing.

---

## 11. Memory Extraction Strategy

**Two-phase approach:**

**Phase 1: Explicit tool calls during session**
- Agent uses `record_memory` / `record_gotcha` tools (already implemented in `apps/frontend/src/main/ai/tools/auto-claude/`)
- High precision, agent decides what's worth remembering
- `summary` field auto-generated at write time (compressed version for injection)

**Phase 2: Post-session summarization**
- After each agent session ends, run a lightweight extraction pass
- Uses a small fast model over a compressed session summary (not full transcript)
- Structured output matching the Memory schema
- Catches things the agent didn't explicitly record
- Also updates ModuleMap with any newly-accessed files

**Semantic deduplication on write:**
- Before storing, query top-3 most similar existing memories
- Cosine similarity > 0.92: merge or skip
- Prevents bloat and duplicate injection

**Conflict detection on write:**
- Check for high-similarity memories with contradicting content
- Set `deprecated: true` on old memory, add `supersedes` relation on new one
- Surface to user: "Updated: 'use tabs' → 'use spaces'"

**Rate limiting:**
- Max 50 memories per agent session
- Max 2KB per memory content field

---

## 12. Embedding Strategy

**Local (OSS):**
- Ollama with user-selected model (already in the app UI under Settings → Memory)
- **Recommended: `nomic-embed-text` (768 dimensions)** — best tradeoff of quality, speed, and storage
- Also available: `qwen3-embedding:0.6b` (1024 dim), `embeddinggemma` (768 dim)
- **NOT recommended: `qwen3-embedding:4b` (2560 dim)** — 3x more storage, 3x slower search, marginal quality gain for code retrieval
- Via Vercel AI SDK: `embed()` / `embedMany()` with Ollama provider

**Cloud — phased approach by scale:**

| Scale | Solution | Cost | Notes |
|-------|----------|------|-------|
| 0–500 users | Voyage AI / Jina free tier | $0–2.40/month | Via `@ai-sdk/openai-compatible` |
| 500–3,000 users | Cloud Run + HuggingFace TEI | $15–20/month | CPU-only, auto-scale to zero |
| 3,000+ users | Fly.io dedicated TEI | $44/month | 4 vCPU / 8GB, persistent |

**Why TEI over Ollama for cloud:** HuggingFace Text Embeddings Inference (TEI) is purpose-built for embedding serving. Benchmarks show 2-4x higher throughput than Ollama on CPU for embedding workloads. TEI supports batching, OpenAI-compatible `/v1/embeddings` endpoint, and integrates with Vercel AI SDK via `@ai-sdk/openai-compatible`.

**Why CPU-only for embeddings:** Embedding models are small enough that GPU is overkill. TEI on 4-vCPU handles ~100 req/s with `nomic-embed-text`. GPU instances cost 10-50x more with no meaningful latency improvement for our batch sizes.

**Post-session extraction cost:** Using a small fast model (Haiku/Flash) over compressed session summary costs ~$0.0035/session. At 1,000 sessions/month = $3.50/month. Negligible.

**Embedding model change handling:**
- `embeddingModel` + `embeddingDim` stored on every memory
- On retrieval, filter to memories embedded with the current active model
- On model switch, trigger background re-embedding job
- Never mix embeddings from different models in the same similarity search

**Cloud hybrid option (privacy-first):**
- Allow users to embed locally via Ollama, send only the vector to Convex
- Content stored encrypted, vector used for similarity search
- Eliminates third-party embedding API data exposure

---

## 13. Security

### Secret Filtering (BLOCKER)

Wire `secret-scanner.ts` to run on ALL `content` strings before any `addMemory()` call:
- Entropy-based detection + known pattern regex (AWS keys, API keys, connection strings, PEM, JWT)
- Redact with `[REDACTED: <type>]` before storage
- Surface warning to user when redaction occurs
- Log detection events for user review

### Local SQLite Encryption

- SQLCipher extension (or `@journeyapps/sqlcipher`) for encryption at rest
- Derive key from OS keychain (Keychain / Credential Manager / libsecret)
- Prevents backup tool sync of unencrypted DB, physical access exfil

### Memory Poisoning Defense

- Enforce `projectId` binding server-side (Convex derives from `ctx.auth`)
- Content length limits: 2KB max
- Rate limiting: 50 memories per session
- Agent can only write to the project it's currently running in

### Embedding Vector Privacy

- Vectors are derived personal data under GDPR
- Apply same access controls as content
- Approximate text reconstruction IS possible for short text

---

## 14. Concurrency Architecture

Agent sessions run in `worker_threads` — they MUST NOT write to SQLite directly (WAL mode allows only one writer). The architecture uses a **main-thread write proxy**.

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Worker Thread   │     │  Worker Thread   │     │  Worker Thread   │
│  (Agent Session) │     │  (Agent Session) │     │  (Agent Session) │
│                  │     │                  │     │                  │
│ READ: own WAL    │     │ READ: own WAL    │     │ READ: own WAL    │
│ connection       │     │ connection       │     │ connection       │
│                  │     │                  │     │                  │
│ WRITE: postMsg() │     │ WRITE: postMsg() │     │ WRITE: postMsg() │
│ { type:          │     │ { type:          │     │ { type:          │
│   'memory-write',│     │   'memory-write',│     │   'memory-write',│
│   memory: {...}  │     │   memory: {...}  │     │   memory: {...}  │
│ }                │     │ }                │     │ }                │
└────────┬─────────┘     └────────┬─────────┘     └────────┬─────────┘
         │                        │                        │
         └────────────┬───────────┴────────────────────────┘
                      ▼
         ┌─────────────────────────┐
         │   Electron Main Thread  │
         │   MemoryService         │
         │   (singleton writer)    │
         │                         │
         │   handleWorkerMessage() │
         │   → addMemory()         │
         │   → updateModule()      │
         │   → secret-scan first   │
         └─────────────────────────┘
```

**How it works:**
1. `worker-bridge.ts` listens for `memory-write` messages from worker threads
2. Main-thread `MemoryService` singleton handles ALL writes (both SQLite and Convex)
3. Workers open **read-only WAL connections** for `search_memory` tool calls — safe for concurrent reads
4. `SerializableSessionConfig` passes `dbPath` to workers so they can open read connections
5. Workers NEVER import `better-sqlite3` in write mode

**Key files to modify:**
- `agent/types.ts` — add `memory-write` to `WorkerMessage` union type
- `agent/worker-bridge.ts` — handle `memory-write` in `handleWorkerMessage()`
- `agent/worker.ts` — pass `dbPath` via `SerializableSessionConfig`
- `session/runner.ts` — inject memory context at prompt generation time, not pipeline start

**Pipeline memory flow:**

```
Planner Agent
├── Receives: T1 always-on + T2 task-scoped memories
├── Writes: plan decisions as "decision" memories
│
Coder Agent (may be parallel subagents)
├── Receives: T1 + T2 (scoped to subtask modules)
├── Has: search_memory tool for on-demand T3
├── Writes: gotchas, error patterns via postMessage()
│
QA Agent
├── Receives: T1 + T2 (full task scope)
├── Writes: test failures, validation patterns
│
Post-Session Extraction
└── Runs on main thread after agent completes
    Uses compressed session summary → Haiku/Flash → structured memories
    Also updates ModuleMap with newly-accessed files
```

**Memory for Terminal sessions:**
Terminal agents (Claude in terminals) don't use worker threads — they use PTY processes. Memory injection happens in `terminal/claude-integration-handler.ts` → `finalizeClaudeInvoke()` by writing a memory context file that gets included in the terminal session's system prompt.

---

## 15. Operations & Maintenance

### Backup Strategy

**Local SQLite:**
- Use `better-sqlite3`'s `.backup()` API — the ONLY safe way to backup a WAL-mode database
- **NEVER use `fs.copyFile()`** on a WAL-mode SQLite DB — results in corrupt backups
- Keep 3 rolling backups: `memory.db.bak.1`, `.bak.2`, `.bak.3`
- Trigger backup on app quit and every 24 hours
- Store backups in `~/.auto-claude/backups/memory/`

```typescript
// Safe backup pattern
const db = new Database(dbPath, { readonly: false });
db.backup(`${dbPath}.bak.1`).then(() => {
  // Rotate .bak.2 → .bak.3, .bak.1 → .bak.2
});
```

### Project Deletion

**Soft-delete with 30-day grace period:**
1. User deletes project in UI → mark all memories with `deletedAt: Date.now()`
2. Memories stop appearing in search results (filtered out)
3. After 30 days, background job permanently deletes rows + vacuums DB
4. User can "Restore project memories" within 30 days from settings
5. ModuleMap deleted immediately (cheap to rebuild)

### Database Maintenance

- Run `VACUUM` quarterly or when DB exceeds 100MB
- `PRAGMA integrity_check` on startup (fast for <100MB)
- Auto-compact conversation log if session extraction fails (retry once)

### Metrics & Instrumentation (P0)

**Cannot prove memory system value without these metrics:**

```typescript
interface MemoryMetrics {
  // Per-session
  discoveryTokensSaved: number;    // Estimated tokens NOT spent on file traversal
  memoriesInjected: number;        // Count of T1+T2 memories injected
  searchMemoryCalls: number;       // T3 on-demand tool calls
  memoryHits: number;              // Memories referenced in agent output

  // Per-project
  moduleMapCoverage: number;       // % of modules at "mapped" confidence
  totalMemories: number;
  avgConfidenceScore: number;

  // System-wide
  embeddingLatencyMs: number;      // Track Ollama/API response times
  searchLatencyMs: number;         // sqlite-vec query time
  writeLatencyMs: number;          // Main-thread write time
}
```

**`discoveryTokens` is the killer metric.** Compare tokens spent on Glob/Grep/Read tool calls in sessions WITH memory vs WITHOUT. This proves the value proposition: "Memory saved your agent 8,000 tokens of file traversal on this task."

Surface in UI: "Memory saved ~X tokens of exploration this session" badge after each session.

---

## 16. Product Gaps & Additional Schema Fields

### Privacy: `visibility` field (P0 — must ship before team cloud)

```typescript
interface Memory {
  // ... existing fields ...
  visibility: 'private' | 'team' | 'project';  // NEW
}
```

- `private` — only the creator can see this memory
- `team` — visible to all team members on the project
- `project` — visible to anyone with project access
- Default: `private` for user-created, `project` for agent-created
- **Must ship in V1** — adding visibility after users have created memories requires backfill migration

### Branch awareness

Memories should track which git branch they were created on:
```typescript
source: {
  sessionId: string;
  file?: string;
  agent?: string;
  branch?: string;  // NEW — "feature/auth-refactor"
}
```

This allows scoping memory retrieval to the current branch context. A memory about a WIP refactor on a feature branch shouldn't pollute main branch sessions.

### Rollback mechanism

If a memory is causing agent misbehavior (wrong convention, outdated gotcha):
1. User clicks "This memory is wrong" in the Memory Browser
2. Memory gets `deprecated: true` + `deprecatedReason: "user_flagged"`
3. All memories with `supersedes` relation to it also get reviewed
4. Agent stops receiving this memory in injection
5. User can restore if it was a mistake

### Non-coding feature coverage

The memory system should also support:
- **Insights runner** — memories about codebase patterns, architecture observations
- **Roadmap runner** — memories about feature prioritization decisions
- **PR Review runner** — already covered with `pr_*` types
- **Ideation runner** — memories about improvement ideas, technical debt

These runners write memories with `createdBy: "runner:insights"` etc.

---

## 17. Multi-Tenant Safety (Cloud)

**Server-side enforcement:**
- ALL Convex queries derive `userId`/`teamId` from `ctx.auth` — never from client args
- Middleware auto-injects tenant context into every query
- Integration tests assert cross-tenant reads return empty

**RBAC:**
- `owner`: Full CRUD on own memories
- `team-member`: Read all team memories, write own, cannot delete others'
- `team-admin`: Full CRUD + audit log
- Agents write as `createdBy: "agent:<type>"`, scoped to current user/team

**GDPR:**
- `exportAllMemories(userId)` for data portability (JSON + Markdown)
- "Delete All My Data" workflow: cascades to embeddings, content, metadata
- Consent capture at memory feature activation

---

## 18. Existing UI (Context → Memories Tab)

The Memory Browser UI **already exists** in the Electron app:
- **Navigation:** Context → Memories tab
- **Components:** `MemoriesTab.tsx`, `MemoryCard.tsx`, `PRReviewCard.tsx`
- **Store:** `context-store.ts`
- **Types:** `project.ts` → `MemoryEpisode`, `GraphitiMemoryStatus`

**Current capabilities:** status card, stats summary, search with scores, filter pills (All, PR Reviews, Sessions, Codebase, Patterns, Gotchas), expandable cards with structured content, PR review cards.

**UI enhancements for V1:**

| Feature | Priority | Description |
|---------|----------|-------------|
| Edit memory content | P0 | Inline editing with save |
| Delete individual memory | P0 | Delete button with confirmation |
| ModuleMap viewer | P0 | Show project module structure — clickable modules expand to file lists |
| Pin/unpin memory | P1 | Toggle pin icon — pinned memories never decay |
| Session-end summary | P1 | "Here's what I learned" — 3-5 bullets after each session |
| Confidence indicator | P1 | Visual badge showing memory strength (access frequency) |
| Per-project memory toggle | P1 | Disable memory for sensitive projects |
| Export as Markdown | P2 | Export all project memories as structured markdown |
| Memory conflict notification | P2 | Toast when new memory supersedes old one |
| Migration preview | P2 | Preview before local-to-cloud sync |
| Cloud sync status | P2 | Sync indicator in status card |

**Filter categories to extend:** Add Decisions, Preferences, Human Feedback, Module Map.

---

## 19. The "Wow Moment"

> User returns to a project after two weeks. Starts a new task. Agent opens with: *"Last time we worked on auth, we hit a JWT expiration edge case — I've already accounted for that in this plan."*

**Making it happen:**
1. ModuleMap identifies relevant modules from the task description
2. Scoped memory search retrieves top memories for those modules
3. Compressed injection into system prompt (Tier 1 + Tier 2)
4. Agent naturally references relevant memories in its response
5. `search_memory` tool available if agent needs more context mid-session

---

## 20. Competitive Positioning

No major AI coding tool has transparent, structured, cross-session memory with a navigational project map. Cursor uses rules files. Windsurf has basic memories (not project-scoped). GitHub Copilot has nothing comparable.

**The differentiator:** Memory that's transparent, user-controlled, and feels like a living knowledge base co-authored by user and agent. Invisible AI memory feels spooky. Visible, editable memory that developers can trust and verify becomes a switching reason.

**Cloud premium value props:**
- **Team memory** — shared conventions, onboarding, institutional knowledge
- **Cross-project search** — patterns across all projects
- **No local compute** — cloud embeddings, no Ollama/GPU needed
- **Memory analytics** — team's most common gotchas (engagement hook)

---

## 21. Schema Migration Strategy

**Local (SQLite):**
- `PRAGMA user_version` for schema versioning
- Migration runner at app startup — ship in V1 even if only v1→v1 (no-op)

**Cloud (Convex):**
- Document fields are additive by default
- Migration job pattern for backfilling new fields

---

## 22. Implementation Order (8 Steps)

Ordered by dependency chain. Each step is independently testable.

### Step 1: MemoryService Singleton + SQLite Schema

**Create `apps/frontend/src/main/ai/memory/memory-service.ts`** — main-thread singleton.

```typescript
// Schema (SQLite)
CREATE TABLE IF NOT EXISTS module_maps (
  project_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,  -- JSON ModuleMap
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  user_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  summary TEXT NOT NULL,
  embedding BLOB,          -- sqlite-vec float32 array
  embedding_model TEXT,
  embedding_dim INTEGER,
  source_json TEXT,        -- JSON { sessionId, file?, agent?, branch? }
  relations_json TEXT,     -- JSON TypedRelation[]
  confidence_score REAL DEFAULT 0.5,
  deprecated INTEGER DEFAULT 0,
  pinned INTEGER DEFAULT 0,
  visibility TEXT DEFAULT 'project',
  created_at INTEGER NOT NULL,
  last_accessed_at INTEGER NOT NULL,
  access_count INTEGER DEFAULT 0,
  deleted_at INTEGER       -- soft-delete
);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_vec USING vec0(
  id TEXT PRIMARY KEY,
  embedding float[768]     -- nomic-embed-text default
);
```

**Files:** New `memory/memory-service.ts`, `memory/local-store.ts`, `memory/types.ts`
**Test:** Create, read, search memories in unit test with in-memory SQLite

### Step 2: Embedding Integration

Wire `embed()` / `embedMany()` from Vercel AI SDK with Ollama provider.

**Files:** New `memory/embedding.ts`
**Key:** Use `@ai-sdk/openai-compatible` for both Ollama local and cloud TEI endpoints
**Test:** Embed a string, verify 768-dim output, store in sqlite-vec, search retrieves it

### Step 3: Worker Thread Memory Bridge

Add `memory-write` message type to worker thread communication.

**Files to modify:**
- `agent/types.ts` — add `MemoryWriteMessage` to `WorkerMessage` union
- `agent/worker-bridge.ts` — handle `memory-write` in `handleWorkerMessage()`
- `agent/worker.ts` — pass `dbPath` via `SerializableSessionConfig`
- `session/runner.ts` — open read-only WAL connection for `search_memory` tool

**Test:** Worker posts memory-write, main thread receives and stores in SQLite

### Step 4: Memory Injection into Prompts

Wire memory retrieval into the prompt generation pipeline.

**Files to modify:**
- `prompts/types.ts` — add `memoryContext?: string` to `PromptContext`
- `prompts/prompt-loader.ts` → `injectContext()` — inject between project instructions and base prompt
- `session/runner.ts` — query memories at prompt generation time (NOT pipeline start)

**Implementation:**
```typescript
// In injectContext(), add after CLAUDE.md section:
if (context.memoryContext) {
  sections.push(
    `## PROJECT MEMORY\n\n` +
    `${context.memoryContext}\n\n` +
    `---\n\n`
  );
}
```

**Test:** Mock memories, verify they appear in assembled prompt between project instructions and base prompt

### Step 5: Agent Tools (record_memory + search_memory)

**Modify existing:** `tools/auto-claude/record-gotcha.ts` — change from file write to `postMessage({ type: 'memory-write', ... })`

**Create:** `tools/auto-claude/search-memory.ts` — uses read-only WAL connection in worker thread

**Create:** `tools/auto-claude/record-memory.ts` — general-purpose memory recording tool

**Test:** Agent calls record_memory → memory appears in SQLite. Agent calls search_memory → returns relevant results.

### Step 6: ModuleMap (Cold Start + Incremental)

**Build on existing `project-indexer.ts`** — the `buildProjectIndex()` function already produces `ProjectIndex` with services, frameworks, dependencies, key_directories. ModuleMap is a layer ON TOP of this.

**Files:** New `memory/module-map.ts`
**Key:** `loadProjectIndex()` in `prompt-loader.ts` already reads `project_index.json` — ModuleMap enriches this

**Cold start flow:**
1. Read existing `project_index.json` (already generated by project-indexer)
2. Transform services → modules (group files by service boundaries)
3. Run fast LLM classification for module descriptions
4. Store as ModuleMap in SQLite `module_maps` table

**Incremental:** Post-session, check which files the agent accessed (from tool call log). Add newly-discovered files to the appropriate module.

### Step 7: Post-Session Extraction

After each agent session completes, extract memories from the session.

**Files:** New `memory/session-extractor.ts`
**Trigger:** Called from `worker-bridge.ts` after worker thread exits

**Flow:**
1. Compress session transcript to ~2K tokens (already have `conversation-compactor.ts`)
2. Send to small fast model with structured output schema
3. Deduplicate against existing memories (cosine > 0.92 = skip)
4. Store via `MemoryService.addMemory()`
5. Update ModuleMap with newly-accessed files

### Step 8: UI Integration

Wire the new memory system to the existing Memory Browser UI.

**Files to modify:**
- `renderer/stores/context-store.ts` — add `moduleMap` field, switch from Graphiti types to new Memory types
- `renderer/components/context/MemoriesTab.tsx` — add edit/delete/pin actions
- `renderer/components/context/MemoryCard.tsx` — add edit button, pin toggle, confidence indicator
- `renderer/components/context/constants.ts` — extend with new memory types (decision, convention, preference, etc.)
- `shared/types/project.ts` — update `MemoryEpisode` → `Memory` types
- IPC handlers — new handlers for memory CRUD operations

**New components:**
- ModuleMap viewer (tree of modules → expand to file list)
- Session-end summary panel ("Here's what I learned" after each session)
- Memory metrics badge ("Memory saved ~X tokens of exploration")

---

## 23. Implementation Checklist

### Phase 1 — Core (must ship)

**Infrastructure (Steps 1-3):**
- [ ] `MemoryService` singleton on main thread
- [ ] SQLite schema with sqlite-vec virtual table
- [ ] `embed()` integration via Vercel AI SDK + Ollama
- [ ] Worker thread `memory-write` message bridge
- [ ] Read-only WAL connections in workers for search
- [ ] Secret scanner wired to `addMemory()`
- [ ] Schema migration runner (`PRAGMA user_version`)
- [ ] SQLite encryption via SQLCipher + OS keychain
- [ ] `discoveryTokens` metric instrumentation
- [ ] `visibility` field on Memory schema
- [ ] `.backup()` strategy with 3 rolling backups

**Memory Pipeline (Steps 4-5):**
- [ ] Three-tier injection pipeline (T1 always-on + T2 task-scoped + T3 on-demand)
- [ ] `memoryContext` field in `PromptContext`
- [ ] `injectContext()` integration in prompt-loader.ts
- [ ] Hybrid retrieval scorer (cosine + recency + access frequency)
- [ ] MMR reranking for diversity
- [ ] Semantic deduplication on write (cosine > 0.92)
- [ ] `record_memory` + `search_memory` agent tools
- [ ] `record_gotcha` rewired from file write to memory-write message

**ModuleMap (Step 6):**
- [ ] `ModuleMap` schema + SQLite table
- [ ] Cold start from existing `project_index.json`
- [ ] LLM-based module classification
- [ ] Configuration seeding from README, package.json, lint config, project instruction files
- [ ] File access instrumentation on Read/Edit/Write tools
- [ ] Post-session ModuleMap update

**Extraction (Step 7):**
- [ ] Post-session extraction via small fast model
- [ ] Compressed session summary → structured Memory output
- [ ] Conflict detection (supersedes relation)

**UI (Step 8):**
- [ ] Memory Browser: edit + delete + pin
- [ ] ModuleMap viewer (module list → file expansion)
- [ ] Session-end memory summary panel
- [ ] Per-project memory toggle
- [ ] Memory metrics badge (tokens saved)
- [ ] Extended filter categories (decisions, preferences, etc.)

### Phase 2 — Cloud
- [ ] `CloudStore` backend (Convex) for ModuleMap + Memories
- [ ] Server-side tenant context enforcement (`ctx.auth`)
- [ ] Cloud embedding via Voyage AI / TEI
- [ ] Migration flow with preview UI (local → cloud)
- [ ] Offline detection — throw, don't fall back to local
- [ ] Cross-tenant isolation integration tests
- [ ] GDPR: Delete All Data + data export
- [ ] Consent capture + embedding API disclosure
- [ ] Soft-delete with 30-day grace period

### Phase 3 — Team & Polish
- [ ] RBAC model (owner/member/admin)
- [ ] Team memory vs personal memory (`visibility` field routing)
- [ ] Memory conflict notification UI
- [ ] Confidence/decay visual indicators
- [ ] Cross-project search
- [ ] Memory analytics (cloud)
- [ ] Branch-scoped memory retrieval
- [ ] Non-coding runner memory support (insights, roadmap, ideation)
