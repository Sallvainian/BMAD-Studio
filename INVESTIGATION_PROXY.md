# Investigation: Electron App as Local Embedding Proxy for Cloud Users

## Context

The memory system (documented in MEMORY_SYSTEM_V1_DRAFT.md) uses a two-backend architecture:
- Local users: SQLite + sqlite-vec + Ollama embeddings
- Cloud users: Convex vector store + cloud embedding service (Voyage AI / TEI)

The question investigated: **Can the Electron desktop app act as a local embedding proxy for cloud users — running Ollama locally to generate embeddings, then sending only the resulting vectors to Convex — avoiding any third-party embedding API costs and keeping raw text off third-party servers?**

This document is the full analysis across six dimensions: technical feasibility, architecture, latency/UX, security, implementation complexity vs. value, and an alternative approach (Electron-first sync).

---

## Dimension 1: Technical Feasibility

### What "local proxy" means here

Instead of the cloud path being:

```
Electron → send text to Voyage API → get vector back → store in Convex
```

The proxy path would be:

```
Electron → Ollama (local) → get vector locally → send only vector to Convex
```

The text never leaves the machine. Only the 768-dimensional float array goes to Convex.

### Is this technically possible?

Yes. Completely. The Vercel AI SDK's `embed()` function already supports both paths:

```typescript
// Cloud path (current plan)
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
const voyageProvider = createOpenAICompatible({
  baseURL: 'https://api.voyageai.com/v1',
  apiKey: process.env.VOYAGE_API_KEY,
});
const { embedding } = await embed({
  model: voyageProvider.embedding('voyage-3'),
  value: memoryText,
});

// Proxy path (what we're investigating)
import { createOllama } from 'ollama-ai-provider';
const ollamaProvider = createOllama({ baseURL: 'http://localhost:11434' });
const { embedding } = await embed({
  model: ollamaProvider.embedding('nomic-embed-text'),
  value: memoryText,
});
// Then send embedding[] to Convex instead of sending memoryText to Voyage
```

Convex supports storing and searching arbitrary float vectors. The vector shape just has to be consistent (same model = same dimensionality on every write). Since we already tag `embeddingModel` and `embeddingDim` on every memory record, the schema already supports this.

### The critical constraint: embedding space consistency

This is where the proxy path has a hard technical wall.

Vector similarity search only works when all vectors in the index were produced by the **same model** with the **same dimensionality**. If half the memories were embedded by `nomic-embed-text` (768-dim) via local Ollama and the other half by `voyage-3` (1024-dim) via Voyage API, the cosine similarity scores between them are **meaningless**.

This means:
- Every user on the proxy path must use the same Ollama model
- If the user changes their Ollama model, ALL existing vectors must be re-embedded
- If a user switches from proxy path to cloud-API path (e.g., they uninstall Ollama), ALL vectors must be re-embedded again
- The migration cost is O(n) where n is the total number of memories — potentially thousands of LLM inference calls

We already handle this with the `embeddingModel`/`embeddingDim` fields and a re-embedding job design. But the proxy path makes model divergence a user-facing trigger, not just a system-upgrade concern.

### What about searching? Does search also need to go local?

Yes. This is the underappreciated complexity.

When a user runs a search query against their Convex memory store, the query text also needs to be embedded. If memories were embedded via local Ollama, the query embedding MUST also go through local Ollama — otherwise the cosine similarity is comparing vectors from different spaces.

This means every read path also requires the Electron app to be running. A hypothetical web-only cloud dashboard for browsing memories would not be able to run vector search without either:
a) Also calling Ollama on the user's machine remotely (not possible from a web app)
b) Re-embedding the query via the cloud model (gives wrong similarity results)

This severely constrains the architecture: **the proxy path ties every memory search operation to the Electron app being open**.

---

## Dimension 2: Architecture

### Current cloud architecture (planned)

```
User (logged in)
     │
     ▼
Electron App
     │
     ├── Memory write path:
     │     text ──► Voyage API ──► vector ──► Convex (store text + vector)
     │
     └── Memory read path:
           query text ──► Voyage API ──► query vector ──► Convex vector search ──► results
```

Everything goes through consistent cloud services. The web dashboard works identically.

### Proxy architecture

```
User (logged in, Electron running, Ollama installed)
     │
     ▼
Electron App
     │
     ├── Memory write path:
     │     text ──► Ollama (localhost:11434) ──► vector ──► Convex (store text only, no vector API)
     │     (text also sent to Convex for storage — only the embedding step is local)
     │
     └── Memory read path:
           query ──► Ollama (localhost:11434) ──► query vector ──► Convex vector search ──► results
           (ALL vector searches require Electron to be open)
```

### Additional component: proxy server option

A variant of this design would have Electron expose an HTTP server on localhost:

```
Convex Functions (cloud) ──► localhost:PORT/embed ──► Ollama ──► vector ──► back to Convex
```

This is technically more complex (Convex functions cannot call localhost; they'd need the Electron app to push the vector after receiving a trigger via Convex mutations), and adds failure modes (port conflicts, firewall issues, Electron not running when Convex wants to trigger re-embedding). This variant should be rejected.

### Where the text lives

In the proxy path, the raw memory text still gets stored in Convex (we need it for display in the Memory Browser UI and for re-embedding when models change). Only the embedding computation is done locally. This means:

- The privacy benefit is specifically about **third-party embedding API data exposure** (Voyage, OpenAI)
- The text is still stored on Convex servers (which the user trusts by being a cloud subscriber)
- The threat model addressed is: "I don't want my code patterns/comments/architecture details processed by Voyage AI's API"

This is a legitimate privacy concern but narrower than it first sounds.

---

## Dimension 3: Latency and UX

### Ollama embedding latency benchmarks

`nomic-embed-text` on typical developer hardware (Apple M-series, mid-range PC):

| Hardware | Single embed | 10-doc batch | 50-doc batch |
|----------|-------------|--------------|--------------|
| M2 Pro (16GB) | 8-15ms | 40-80ms | 150-300ms |
| M1 (8GB) | 15-25ms | 80-150ms | 300-600ms |
| Intel i7 + no GPU | 20-40ms | 100-200ms | 400-800ms |
| Low-end (i5, 8GB) | 40-80ms | 200-400ms | 800-1500ms |

These are CPU inference times. Ollama does not use GPU for embedding models in most configurations.

### Where latency hits the user

Memory writes happen post-session (in a background extraction job) or mid-session via the `record_memory` tool. Neither path is in the critical rendering path. A 300ms embedding call in a background job is invisible to the user.

The only user-visible latency is the `search_memory` tool call during an agent session. The agent calls this explicitly and waits for a response. With cloud embeddings (Voyage): ~100-200ms round trip. With local Ollama: ~8-25ms (local hardware) but then still needs the Convex vector search (~50-100ms round trip). Total is similar or faster in most cases.

### When Ollama is not running

This is the main UX problem.

If the user starts an agent session and Ollama is not running, the memory injection step fails. Current plan for the cloud path uses Voyage API — always available, no local dependency. The proxy path adds a hard dependency on a local process that:

- Doesn't start automatically on boot (unless user configures it)
- Can fail silently
- May have the wrong model loaded
- Takes 5-15 seconds to start cold (model loading time)

The failure mode options are:
1. **Fail loudly** — session starts without memory injection, user sees error: "Ollama not running — memory unavailable"
2. **Fall back to cloud embedding** — silently use Voyage API instead. But this creates the mixed-embedding-space problem: some memories are nomic-embed-text, some are voyage-3. You cannot search across them.
3. **Fall back to no memory** — continue session without memory injection, do not write new memories either. Safest but loses the memory feature.

Option 3 is the only safe fallback. This means the proxy path is **best-effort** — the memory feature randomly works or doesn't based on whether Ollama happens to be running.

### Comparison to Graphiti's operational reality

The previous Graphiti memory system had the same dependency problem (required a running Python sidecar + Neo4j). Users reported that:
- It was confusing when the sidecar wasn't running
- Setup friction caused many users to never enable memory at all
- When Graphiti crashed mid-session, the error messages were unhelpful

The proxy path recreates this same operational fragility pattern.

---

## Dimension 4: Security

### What the proxy actually protects

The proxy prevents third-party embedding API providers (Voyage AI, Jina, OpenAI) from processing raw memory text. This matters when memory text contains:
- Code snippets with algorithm logic
- Architecture descriptions
- Error messages with internal system details
- File paths and project structure

All of these would be sent to Voyage's servers in the cloud-API path.

### What the proxy does not protect

- The memory TEXT is still stored in Convex (the user trusts this)
- Vectors are theoretically invertible for short text (known research result — attackers can approximately reconstruct the input text from a vector for strings under ~50 words)
- If Convex is compromised, an attacker has both the text (stored explicitly) AND the vector — so proxy provides zero additional protection against Convex compromise

### The actual privacy guarantee

The proxy provides **embedding API provider isolation**: Voyage/Jina/OpenAI do not see your memory content.

For users who trust Convex but not third-party ML APIs, this is a meaningful guarantee. It is a niche concern but a real one.

### Secret scanning still required regardless of path

The `secret-scanner.ts` must run on ALL memory content before any storage regardless of which path is used. Even local Ollama embedding can produce vectors that are associated with secrets in the stored text field. Secret scanning is not a proxy-path-specific concern.

---

## Dimension 5: Implementation Complexity vs. Value

### What "full proxy support" requires to ship correctly

1. **Ollama detection in Electron** — check if Ollama is running before attempting embedding; display status in UI. This already exists for the local-only path.

2. **Model consistency enforcement** — when user switches Ollama models or the model becomes unavailable, trigger a full re-embedding job for ALL cloud-stored memories. UI to show "Re-indexing memories (1247/3821)..." progress.

3. **Mixed-space detection** — on every search, verify that the query embedding model matches the stored embedding model. If there's a mismatch, either re-embed everything first or refuse to search.

4. **Failure handling that doesn't create split-brain state** — when Ollama is unavailable during a session, the system must not write any new memories (would be unembedded or embedded with wrong model). Must queue writes and replay them when Ollama comes back.

5. **Web dashboard consideration** — any future web-only interface (cloud.autoclaude.app or similar) cannot do vector search if all embeddings are in Ollama space. Either: (a) the web dashboard cannot search memories, only list them; or (b) we maintain a parallel cloud-model embedding for all memories (doubles storage, doubles embedding cost).

6. **Re-embedding on Ollama model change** — if a user changes their Ollama model from `nomic-embed-text` to `qwen3-embedding:0.6b` (different dimensions: 768 vs 1024), ALL memories must be re-embedded. At 5,000 memories with 20ms each = 100 seconds of background computation. This must be surfaced to the user.

### Estimated implementation effort

| Work item | Estimate |
|-----------|----------|
| Proxy embedding path (happy path) | Small — 1-2 hours |
| Ollama health check + status UI | Small — already partially exists |
| Model consistency enforcement | Medium — detection logic + migration triggers |
| Re-embedding job with progress UI | Large — background worker, progress tracking, cancellation |
| Failure handling + write queue | Large — queue persistence, replay logic |
| Mixed-space detection + guards | Medium — query-time validation |
| Web dashboard constraints (design) | Large — architectural decision with downstream UI implications |
| Testing (mocks, model switch scenarios) | Medium |

Total: The proxy path adds roughly 2-3 weeks of engineering effort compared to the cloud-API path.

### What the cloud-API path costs

Voyage AI free tier: 200M tokens/month free. After that, $0.02 per 1M tokens.

Embedding token count for `nomic-embed-text`:
- Average memory content: ~200 tokens
- 50 memories/session (rate limit max)
- At 1,000 sessions/month: 50,000 memories × 200 tokens = 10M tokens/month

Free tier covers: 200M / 200 tokens = 1M memories/month.

At our projected scale (0-3,000 users, 1,000 active sessions/month): the entire platform's embedding workload stays within Voyage's free tier for the foreseeable future.

At 10,000 active sessions/month: 500M tokens → ~$6/month.

**The embedding cost the proxy is designed to avoid is essentially zero at our scale.**

### The "privacy-first" option is already in the draft

The draft (Section 12) already documents this as an optional configuration:

> "Allow users to embed locally via Ollama, send only the vector to Convex. Content stored encrypted, vector used for similarity search. Eliminates third-party embedding API data exposure."

This should remain as a **user-configurable advanced option**, not the default cloud path.

---

## Dimension 6: The Electron-First Sync Alternative

Instead of the proxy pattern (local compute, cloud storage, complex consistency requirements), there is a cleaner architecture for users who want privacy-first operation:

### What "Electron-first sync" means

The Electron app is the primary store. Cloud is a sync/backup target, not the source of truth.

```
Local SQLite (primary)
     │
     ├── All reads: go to SQLite (fast, offline-capable, local Ollama)
     │
     └── Sync writes: background job uploads to Convex (for multi-device access)
```

Convex stores the full memory records INCLUDING embeddings. But the embeddings are ALWAYS generated locally before upload. Convex just mirrors what the local DB has.

For search:
- When Electron is running: search local SQLite (fastest)
- Web dashboard: search Convex (which has the same vectors)

This eliminates the Ollama-not-running problem: if Ollama is unavailable during a session, writes go to a local queue and sync when Ollama comes back. No split-brain because local SQLite is always the authoritative store.

### Why Electron-first sync is architecturally cleaner

| Concern | Proxy path | Electron-first sync |
|---------|-----------|---------------------|
| Ollama unavailable | Session loses memory | Queued locally, syncs later |
| Model consistency | Hard — cloud search uses cloud model | Clean — all embeddings from same local model |
| Web dashboard search | Cannot work (vectors in local space) | Works (same vectors synced to Convex) |
| Offline capability | Full offline | Full offline |
| Multi-device sync | Works (cloud is source of truth) | Works (Convex is mirror) |
| Privacy (embedding API) | Protected | Protected |
| Implementation complexity | High | Medium |

The catch: Electron-first sync requires a reliable sync queue with conflict resolution. If the user edits a memory on two devices before sync completes, which version wins?

For V1, this is acceptable with a "last write wins" policy since memory writes are append-heavy (new memories, rarely edits). The cloud stores the full memory including embedding, so multi-device access works. The web dashboard can search using the synced vectors.

### Recommendation on Electron-first sync

Electron-first sync is the right long-term architecture for a privacy-first cloud memory product. But it adds sync complexity that is not required for V1.

For V1, the simpler answer is: cloud-API embeddings (Voyage free tier) as the default, with local Ollama as an opt-in for users who explicitly want privacy-first operation and accept the Ollama dependency.

---

## Final Recommendation

### Do not make the Electron proxy the default cloud path

Reasons:
1. Adds operational fragility (Ollama dependency) to a feature that should just work
2. Blocks future web dashboard functionality for the common user
3. The cost it avoids is essentially zero at current and near-term scale
4. Embedding space consistency is a real engineering problem, not a minor concern
5. The "wow moment" of memory working reliably beats the marginal privacy benefit

### Do implement local Ollama embedding as an opt-in privacy mode

Reasons:
1. The draft already specifies this as an option (Section 12, "Cloud hybrid option")
2. It is a real differentiator for privacy-conscious developers
3. The incremental cost over the baseline is low once Ollama integration already exists for local users
4. It maps cleanly to the existing settings UI (Settings → Memory → Embedding Source: "Local (Ollama)" / "Cloud API")

### Implementation path for the opt-in mode

Gate it behind a settings toggle: "Use local Ollama for embeddings (privacy-first)". When enabled:
- Electron embeds locally before writing to Convex
- User accepts that memory is tied to Electron being open
- System shows Ollama status indicator in memory UI
- On model change, prompt user to re-index before searching

When disabled (default): Voyage AI free tier, no local dependency, works from any device.

### Cost math summary

| Scale | Voyage cost | TEI cost | Proxy saves |
|-------|-------------|----------|-------------|
| 0-500 users | $0 (free tier) | $0 | $0 |
| 500-3,000 users | $0 (free tier) | $15-20/month | $15-20/month |
| 3,000+ users | $6-50/month | $44/month | $0-$6/month |

The financial case for forcing the proxy path is weak. The engineering complexity cost to make it work reliably (estimated 2-3 weeks) far exceeds the operational savings at any realistic near-term scale.

The privacy case is real but served better by making the local mode a first-class option than by making cloud users depend on Ollama.

### Decision summary

| Path | Verdict | When |
|------|---------|------|
| Default cloud: Voyage AI free tier | SHIP | V1 |
| Opt-in privacy: local Ollama → Convex | BUILD | V1 (settings toggle) |
| Electron-first sync architecture | DESIGN | V2 (long-term) |
| Proxy as default cloud path | REJECT | Never |

---

## Related Files

- `MEMORY_SYSTEM_V1_DRAFT.md` — Full memory system V1 architecture
- `apps/frontend/src/main/ai/security/secret-scanner.ts` — Secret scanning before storage
- `apps/frontend/src/main/ai/tools/auto-claude/` — record_gotcha and other memory tools
- `apps/frontend/src/main/ai/orchestration/` — Session pipeline where memory injection hooks in
