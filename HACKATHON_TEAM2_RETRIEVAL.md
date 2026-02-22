# HACKATHON TEAM 2: Retrieval Engine and Competitive Intelligence

*Definitive competitive analysis of AI coding memory systems and next-generation retrieval design*

*Version 2.0 — Enhanced edition based on 2026 research and market analysis*

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Comprehensive Competitive Analysis](#2-comprehensive-competitive-analysis)
3. [Embedding Model Landscape 2026](#3-embedding-model-landscape-2026)
4. [Next-Generation Retrieval Architecture](#4-next-generation-retrieval-architecture)
5. [Context Window Optimization](#5-context-window-optimization)
6. [Caching and Performance](#6-caching-and-performance)
7. [TypeScript Interfaces and Code Examples](#7-typescript-interfaces-and-code-examples)
8. [Recommendations for V4](#8-recommendations-for-v4)

---

## 1. Executive Summary

Every major AI coding tool in 2026 has converged on some form of persistent context or memory. But the quality gap between the best and worst implementations is enormous — from flat markdown files manually maintained by developers to real-time semantic graphs processing millions of tokens. Auto Claude V3 has a sophisticated architecture. This document establishes where it sits in the competitive landscape and defines what a world-class retrieval engine looks like for V4.

### The Core Insight

The retrieval problem for an AI coding assistant is fundamentally different from general-purpose RAG:

1. **Code has explicit structure**: Import graphs, call chains, and symbol references are first-class signals that cosine similarity on text embeddings misses entirely.
2. **Context is temporal**: What matters during the `implement` phase is different from what matters during `validate`. The same gotcha can be noise or critical information depending on phase.
3. **The best memories are never searched for**: Proactive injection at the file-access level — not reactive search — is where the highest-value recall happens.
4. **Trust degrades over time**: Code changes. A gotcha about `auth/config.ts` from 6 months ago may be dangerously incorrect if the module was refactored. Stale memories with high confidence scores are worse than no memory at all.

### Where Auto Claude V3 Stands

V3 is the only OSS/local AI coding tool with:
- Full typed memory schema (15+ memory types)
- Phase-aware retrieval scoring (6 universal phases)
- Proactive gotcha injection at tool-result level
- Scratchpad-to-validated promotion pipeline
- Knowledge graph with impact radius analysis
- E2E observation memory from MCP tool use
- Methodology-agnostic plugin architecture

**The gap to close for V4**: V3's retrieval engine is semantic-only. Adding BM25 hybrid search, a cross-encoder reranker, Matryoshka dimension optimization, and a ColBERT-inspired late-interaction layer for exact code token matching would bring it from competitive to definitively best-in-class.

---

## 2. Comprehensive Competitive Analysis

### 2.1 Cursor

**Memory Mechanism**: Static scoped rules in `.cursor/rules/*.mdc` files. Notepads for user-curated sticky notes.

**Retrieval Architecture**:
- Cursor uses its own proprietary embedding model to chunk code via tree-sitter (AST-aware, not character-based)
- Chunks are stored in Turbopuffer — a serverless vector and full-text search engine backed by object storage, optimized for 100B+ vector scale
- Only embeddings and metadata (obfuscated relative file path, line range) are stored server-side; source code never leaves the local machine
- Query-time: user query is embedded and compared against code chunk embeddings in Turbopuffer; candidates returned in ranked order
- Merkle tree of file hashes for efficient incremental indexing — checks every few minutes, uploads only modified files
- Rules system (`.mdc`) is static inclusion — NO embedding-based retrieval for rules

**Specific Technical Details**:
- Embedding model: Cursor's own proprietary model (not public)
- Vector store: Turbopuffer (turbopuffer.com/customers/cursor)
- Chunking: tree-sitter AST-aware semantic chunks (functions, classes, logical blocks)
- Storage: cloud-side embeddings, client-side source code
- Incremental indexing via Merkle tree comparison

**Their Clever Insight**: Separating indexing (embeddings, metadata) from source code satisfies enterprise privacy requirements while enabling server-side vector search at scale. The Merkle-tree-based incremental sync is architecturally elegant.

**Their Critical Limitation**: Memory is entirely structural-positional, not experiential. Cursor never learns that "we decided to use JWT because of X" or "this test flakes when Redis is down." Rules are manual maintenance burden. After fixing 20 bugs in the auth module, Cursor still knows nothing about auth unless a developer manually wrote it down. No cross-session learning, no confidence scoring, no decay.

**Auto Claude Advantage**: Experiential memory (gotchas, decisions, error patterns) accumulated automatically from agent behavior. Cursor's approach gives you a code search engine; Auto Claude gives you accumulated wisdom.

---

### 2.2 Windsurf (Codeium)

**Memory Mechanism**: Two types — user-defined rules and automatically generated memories from Cascade's action stream observation.

**Retrieval Architecture**:
- Codebase indexing done on AST representation (superior to file-level or naive chunking)
- Local semantic indexing engine generates embeddings capturing code meaning
- Indexing Engine pre-scans entire repository; retrieves context on-the-fly, not just from currently open files
- Cascade's "Flows" concept: real-time action tracking (edits, terminal commands, clipboard, conversation history) infers developer intent
- Memories stored at `~/.codeium/windsurf/memories/` — workspace-scoped
- Auto-generated memories do not consume API credits
- Enterprise: system-level rules deployable across all workspaces

**Specific Technical Details**:
- Index type: AST-based semantic indexing
- Memory location: `~/.codeium/windsurf/memories/` (local)
- Scope: workspace-scoped memories (no cross-workspace contamination)
- Automatic memory trigger: Cascade determines when context is worth remembering

**Their Clever Insight**: Action-stream awareness — Cascade observes the full action stream (terminal commands, file edits, clipboard contents) rather than just conversation history. This passive capture approach is the closest any competitor comes to Auto Claude's Observer pattern.

**Their Critical Limitation**: Black-box opacity. Users cannot inspect, edit, or understand what Cascade has remembered. There is no way to verify correctness, correct wrong memories, or understand why a specific memory was triggered. No structured schema — no distinction between gotcha, decision, preference, or convention. Memory debugging is impossible.

**Auto Claude Advantage**: Full transparency. Users can browse, edit, and verify every memory. Typed schema means structured reasoning about what type of knowledge is being retrieved and at what confidence level.

---

### 2.3 GitHub Copilot (Chat + Workspace)

**Memory Mechanism**:
- `.github/copilot-instructions.md` — single flat markdown file (recommended under 1000 lines)
- `.github/instructions/*.instructions.md` — scoped instruction files by file type or path
- Persistent Memory (2025, early access): repository-level context retained across interactions, available on Pro/Pro+ plans
- Remote index for GitHub/Azure DevOps-hosted repos: proprietary transformer-based embedding system for semantic code search
- `@workspace` context: semantic index of local workspace

**Retrieval Architecture**:
- Remote repo indexing: GitHub's proprietary embedding system; VS Code workspace indexing stored locally
- Context orchestration: Copilot Chat uses multiple context providers (editor selection, recently accessed files, workspace index) and merges them
- Symbol-level context: classes, functions, global variables can be explicitly attached (`@` symbol in chat)
- Context size: 100K characters in chat as of April 2025

**Their Clever Insight**: The `.copilot-instructions.md` pattern is the most widely adopted convention in the industry because zero setup is required — create one markdown file and you're done. The team-shareable, version-controlled, diffable nature means everyone gets the same instructions.

**Their Critical Limitation**: Persistent memory is brand-new (late 2025, early access) and appears to be repository-level context without experiential learning. Static instruction files are maintenance burden. No automatic capture, no decay, no confidence scoring. Context window limit causes degradation on large projects.

**Auto Claude Advantage**: V3 has had cross-session experiential memory since V1. Automatic capture via Observer means zero developer maintenance burden. Phase-aware scoring ensures the right memories reach the right agent at the right time.

---

### 2.4 Sourcegraph Cody

**Memory Mechanism**: Repo-level Semantic Graph (RSG) — maps entities, symbols, and dependencies. No traditional vector embeddings (deprecated in favor of RSG + code search).

**Retrieval Architecture**:
- RSG encapsulates core repository elements and their dependencies as a graph structure
- "Expand and Refine" method: graph expansion (traverse RSG to related nodes) + link prediction (infer likely-relevant nodes not directly linked)
- Three context layers: local file -> local repo -> remote repos via code search
- Ranking phase uses RSG to score relevance of retrieved chunks
- 1 million-token context via Gemini 1.5 Flash for enterprise tier
- Up to 100,000 lines fed to LLM from semantic search across repositories
- RAG can occur entirely within enterprise network perimeter (on-premise)

**Specific Technical Details**:
- Graph type: RSG (Repo-level Semantic Graph) — proprietary
- Context layers: 3 (local file, local repo, remote repos)
- Max LLM input: 100K lines from semantic search
- Max context window: 1M tokens (Gemini 1.5 Flash, enterprise)
- Architecture: search-first RAG

**Their Clever Insight**: Replacing embeddings with a semantic code graph is architecturally correct for code specifically. Code has explicit call graphs and import chains that are first-class structural signals. The RSG treats code as a graph-native structure rather than text to embed. "Search-first philosophy" — Cody searches the full codebase before generating, not just the open files.

**Their Critical Limitation**: RSG requires Sourcegraph's enterprise infrastructure — not available for local/OSS users. Zero experiential memory layer. "We decided to use JWT because of security requirement X" or "this test flakes when Redis is down" — these facts are invisible to the RSG because they are not structural code relationships.

**Auto Claude Advantage**: Auto Claude has both the Knowledge Graph (structural, like RSG) AND the experiential memory layer (gotchas, decisions, error patterns). Cody solves structural context; Auto Claude solves both structural and wisdom.

---

### 2.5 Augment Code

**Memory Mechanism**: Semantic index of entire codebase (400,000+ files processed). "Memories" layer storing prior interactions, diagnostic breadcrumbs, and code snippets. Real-time re-indexing as files change.

**Retrieval Architecture**:
- Full semantic search across entire repository via Context Engine
- 200K token context window as primary differentiator
- Context Engine: "a full search engine for code" — semantically indexes and maps code, understands relationships between hundreds of thousands of files
- Real-time indexing: processes changes instantly across distributed codebases
- Memory efficiency: 24.4 GB vs. 122 GB for million-token approaches
- Cost efficiency: $0.08/query vs. competitors at $0.42-$0.38
- 70.6% SWE-bench score vs. GitHub Copilot's 54%
- ISO/IEC 42001 certified (AI management system standard, May 2025)

**Their Clever Insight**: Treating the entire codebase as a live index queried in real-time, rather than pre-seeding context at session start. The 200K context window lets Augment be less discriminating about what to include — less retrieval precision needed when you can fit more. Their enterprise story: reducing developer onboarding from 4-5 months to 6 weeks is a killer use case with measurable ROI.

**Their Critical Limitation**: Cloud-only, enterprise-priced. The "Memories" layer lacks transparency — no structured schema. Real-time indexing at 400K+ files is expensive infrastructure. No typed distinction between gotcha vs. decision vs. preference. Memory opacity makes debugging incorrect behavior impossible.

**Auto Claude Advantage**: OSS/local-first. Structured memory schema with confidence scoring, decay, and user editability. Auto Claude's approach is architectural-level more sophisticated for accumulated wisdom, even if Augment's code search infrastructure is more impressive.

---

### 2.6 Cline (formerly Claude Dev)

**Memory Mechanism**: Memory Bank — 6 structured markdown files per project:
1. `projectBrief.md` — project foundation and goals
2. `productContext.md` — why the project exists
3. `systemPatterns.md` — architecture and technical decisions
4. `techContext.md` — tech stack and setup guide
5. `activeContext.md` — current work focus and recent changes
6. `progress.md` — completion status

`.clinerules/` — behavioral protocols Cline follows during task execution.

**Retrieval Architecture**:
- ALL 6 Memory Bank files loaded at the start of EVERY task — mandatory, not selective
- Zero semantic retrieval — pure file inclusion
- Hierarchical loading order (foundation -> contextual -> working state)
- Cline writes to the Memory Bank files during sessions; user can also edit directly
- `.clinerules` provides behavioral context, not retrieval context

**Their Clever Insight**: The Memory Bank pattern forces explicit structure on project knowledge. Naming the six files and their purposes creates discipline around what gets recorded. The `activeContext.md` + `progress.md` separation (persistent architecture vs. current state) is a useful distinction that most competitors don't have.

**Their Critical Limitation**: Full context load every time — a task touching one module loads full context for all modules. Memory bloat over time with no deduplication or decay. No semantic matching. Cline frequently forgets to update the Memory Bank without explicit instruction. No automatic capture — purely manual.

**Auto Claude Advantage**: Selective semantic retrieval instead of full load. Automatic capture via Observer. Structured typing with decay means memory stays relevant over time. Cline's approach is a structured convention layered on top of the context window; Auto Claude is a real memory system.

---

### 2.7 Aider

**Memory Mechanism**: Repository map — condensed representation of classes, functions, call signatures, and type annotations generated via tree-sitter/ctags. `.aiderignore` for exclusions.

**Retrieval Architecture**:
- Graph ranking algorithm: files as nodes, dependencies as edges, ranked by PageRank-style importance
- Files everything-depends-on rank highest; isolated utility files rank lower
- Token-budget optimization: default 1K tokens for map, remainder for conversation
- "Lazy loading": full file content only when being actively edited; condensed summary for referenced files
- No persistent memory across sessions — repo map regenerated fresh each session
- Automatically adds related files based on current edit context via graph traversal

**Their Clever Insight**: The PageRank-style graph ranking for repo map selection is technically elegant. It uses the actual import/dependency graph to surface structurally important files. For a fresh codebase with no session history, this is the best cold-start context selection approach available. It's free (no embedding cost) and requires no setup.

**Their Critical Limitation**: No persistent experiential memory. Every session starts from scratch. The repo map is structural-only — nothing about "last time we changed auth, we hit this timing issue." No gotchas, no decisions, no user corrections persist.

**Auto Claude Advantage**: V3's Knowledge Graph provides the same structural analysis Aider gets from its repo map, PLUS the experiential memory layer that accumulates across sessions. Aider solves the navigational problem; Auto Claude solves both navigation and wisdom.

---

### 2.8 Continue.dev

**Memory Mechanism**: Context Providers — modular plugin system for context sources (files, docs sites, code symbols, GitHub issues, web URLs, terminal output, etc.). `.continue/rules/*.md` for project-level rules. Documentation indexing via embedding provider if configured.

**Retrieval Architecture**:
- `@` mentions trigger context provider retrieval (e.g., `@docs`, `@codebase`, `@file`)
- Documentation sites indexed via local embeddings — user-triggered semantic search
- Codebase retrieval uses local embeddings for semantic file search
- Modular: each context source is a plugin; community-built providers exist for Linear, Notion, Jira
- `.continuerules` files in project root or subdirectories trigger config reloads

**Their Clever Insight**: The modular context provider system is architecturally clean. Each source of context is a plugin — extensible and community-expandable. The developer controls exactly what goes into context rather than having an opaque system decide. This is the most transparent context system in the market.

**Their Critical Limitation**: Retrieval is user-triggered, not automatic. If you don't type `@docs`, you don't get docs. No session learning, no automatic capture, no cross-session memory. Documentation indexing requires explicit setup per site.

**Auto Claude Advantage**: Automatic retrieval triggered by agent behavior (file access, task description, phase). No developer effort required to get relevant context.

---

### 2.9 Devin (Cognition)

**Memory Mechanism**: Knowledge base with entries, machine state snapshots (filesystem + environment), and session restoration (revert to previous states in 15-second increments).

**Retrieval Architecture**:
- Knowledge entries are retrieved based on "Trigger" settings — triggers specify which file, repo, or task type makes the entry relevant
- Pinned Knowledge: applied to all repositories or scoped to a specific repo
- Unpinned Knowledge: only used when triggered by matching conditions
- Devin proactively suggests adding Knowledge during sessions ("I think I should remember this")
- DeepWiki: separate product that indexes repos with RAG (code parsing engine + LLM-generated Markdown docs)
- Devin Search: agentic tool for codebase exploration with cited code answers
- Auto-indexing: repositories re-indexed every couple hours

**Their Clever Insight**: Proactive Knowledge suggestion during sessions is the right UX model — Devin surfaces "I think I should remember this" moments rather than requiring explicit user triggers. The machine state snapshot system (15-second granularity) enables genuine long-running task continuity that no other tool has.

**Their Critical Limitation**: Knowledge management is flat (untyped list of tips). No distinction between "never do X" vs. "usually prefer Y" vs. "always required Z." Very expensive ($500+/month). The opacity of what gets remembered and why is a significant UX problem for debugging incorrect behavior.

**Auto Claude Advantage**: Typed schema with 15+ memory types. OSS/local, not $500/month. Confidence scoring and decay mean Auto Claude knows which memories to trust. Full user editability and transparency.

---

### 2.10 Amazon Q Developer

**Memory Mechanism**: Local workspace index of code files, configuration, and project structure (filtered by `.gitignore`). Index persisted to disk, refreshed if >24 hours old.

**Retrieval Architecture**:
- `@workspace` context: full workspace semantic search via local vector index
- Symbol-level context: classes, functions, global variables attachable via `@` in chat
- Folder/file-level context: specific paths attachable via `@` symbol
- 100K character context limit (updated April 2025)
- Initial indexing: 5-20 minutes for new workspace
- Incremental update: triggered when file is closed or tab changed
- Transformation knowledge: legacy code patterns, Java version upgrades, .NET migration paths
- Resource management: indexing stops at memory threshold or hard size limit

**Specific Technical Details**:
- Context limit: 100K characters in chat
- Index persistence: disk, refreshed every 24 hours or on change
- Initial build time: 5-20 minutes
- Incremental trigger: file close or tab change

**Their Clever Insight**: AWS-native transformation capabilities — upgrading Java versions, migrating .NET Framework to .NET Core, converting Oracle SQL to PostgreSQL. These aren't code generation; they're structured transformations backed by patterns learned from millions of repositories. The MCP integration (April 2025) for CLI context extension is architecturally forward-thinking.

**Their Critical Limitation**: Workspace index solves structural context but has zero experiential layer. No cross-session learning of gotchas or decisions. 5-20 minute initial indexing is unacceptable for developer workflow. Monorepo support is reportedly problematic. Tied entirely to AWS ecosystem.

**Auto Claude Advantage**: Near-instant memory recall (SQLite vector search vs. cloud round-trip). Cross-session experiential memory. No AWS dependency.

---

### 2.11 Tabnine

**Memory Mechanism**: RAG index of organizational repositories. Local workspace context. Team-wide code patterns. Enterprise: fine-tuned private models trained on organization code.

**Retrieval Architecture**:
- RAG: retrieves relevant code from connected organization repositories
- Fine-tuning (Enterprise): team patterns baked into model weights — zero retrieval overhead for conventions, but requires expensive training data curation
- Local file context + related file inference for real-time completion
- Privacy-first: all data can remain on-premises; no code sent to external servers
- Team-level patterns from connected repos for consistency across developers

**Their Clever Insight**: Fine-tuning on private codebase data is the most powerful form of "memory" — conventions baked into model weights require zero retrieval. For a team that follows consistent patterns, fine-tuning means the model already knows what you do before you ask. Privacy-first architecture is a genuine competitive differentiator in regulated industries.

**Their Critical Limitation**: Fine-tuning is Enterprise-only, expensive, slow to update (training cycles), and requires curated training data curation. RAG index is team-level — individual session gotchas don't persist. Primarily a code completion tool, not an agentic assistant with multi-step task memory.

**Auto Claude Advantage**: Session-level experiential memory that accumulates from every agent run, automatically, without training. No fine-tuning cost or lag.

---

### 2.12 JetBrains AI Assistant

**Memory Mechanism**: Advanced RAG for project understanding using recently accessed files and project analysis. `.aiignore` file for privacy control. User can explicitly attach files, folders, images, symbols as context.

**Retrieval Architecture**:
- Advanced RAG: surfaces most relevant files, methods, and classes for current query
- Recently accessed files automatically included for workflow relevance
- Symbol-level context: attach classes, functions, global variables directly
- Context trimming: automatic trim if attachments exceed percentage of model context window
- `.aiignore`: developer controls what AI can and cannot access
- IDE-native: context is IDE state (open editor, selection, recent navigation)

**Their Clever Insight**: IDE-native context (editor state, recent navigation, IDE actions) is extremely high signal for what the developer is actively working on. JetBrains' deep AST and static analysis integration means the RAG surface covers semantic code structure that text-only approaches miss.

**Their Critical Limitation**: No cross-session memory. RAG is session-local — there is no accumulated wisdom layer. No automatic capture of gotchas or decisions. Each session restarts with zero historical knowledge about the project.

**Auto Claude Advantage**: Persistent cross-session memory. Automatic capture means historical knowledge accumulates without developer effort.

---

### 2.13 Kiro (Amazon AWS)

**Memory Mechanism**: Spec-driven persistent context via SpecMem. Kiro autonomous agent maintains context across the full development lifecycle, not session-by-session.

**Retrieval Architecture**:
- Spec-Driven Development: prompts -> Requirements (EARS notation) -> Design -> Tasks — formal specifications are the primary context
- SpecMem (plugin): persistent memory for specs, impact analysis, context-aware suggestions based on full project history
- "Always on" context: not session-based — feedback on one PR is remembered and applied to subsequent changes
- When Kiro encounters architectural decisions, it considers existing implementations and preferences from history
- SpecMem enables cross-spec querying and real-time impact analysis

**Their Clever Insight**: Spec-driven development as the memory substrate — formalizing requirements into EARS notation before coding gives the agent structured, unambiguous memory about intent. This sidesteps the "what did we intend?" problem that plagues all free-form memory systems.

**Their Critical Limitation**: Very new (AWS product launched 2025). SpecMem is an add-on plugin, not core architecture. Limited public information about underlying retrieval technology.

**Auto Claude Advantage**: Auto Claude's workflow_recipe memory type is functionally similar to Kiro specs but emerges automatically from observed patterns rather than requiring explicit specification authoring.

---

### 2.14 Replit Agent

**Memory Mechanism**: Long-running multi-agent architecture with memory compression. LLM-compressed memory trajectories that condense ever-growing context.

**Retrieval Architecture**:
- Multi-agent: manager, editor, verifier agents with distinct roles
- Memory compression: LLMs themselves compress long memory trajectories, retaining only most relevant information for subsequent interactions
- Human-in-the-loop workflows for reliability at long task horizons
- Prompt engineering techniques for context management across turns

**Their Clever Insight**: Using LLMs to compress their own memory trajectories is architecturally interesting — the model decides what's important enough to retain, which may be better calibrated than rule-based compression. The multi-agent manager/editor/verifier pattern provides built-in verification.

**Their Critical Limitation**: The compression approach has no structured schema — important technical facts can be lost in the summarization. No persistent cross-session memory beyond the current task. Web-native focus means desktop/local use cases are not the target.

**Auto Claude Advantage**: Structured memory schema that persists across sessions. No compression loss of critical technical facts.

---

### 2.15 Competitive Comparison Matrix

| Tool | Structured Schema | Auto-Capture | Semantic Search | Code Graph | Cross-Session | Decay/Confidence | Transparent | OSS/Local | Phase-Aware |
|------|------------------|--------------|-----------------|------------|---------------|-----------------|-------------|-----------|-------------|
| Cursor | None (flat rules) | No | Yes (code chunks) | No | No | No | Yes (rules) | Yes | No |
| Windsurf | None (flat) | Yes (opaque) | Yes (AST index) | No | Yes (opaque) | No | No | No | No |
| GitHub Copilot | None (flat) | Partial (new) | Yes (remote) | No | Partial (new) | No | Yes | No | No |
| Cody | None | No | Yes (RSG graph) | Yes (RSG) | No | No | No | Enterprise | No |
| Augment Code | Unknown | Yes (opaque) | Yes | No | Yes | No | No | No | No |
| Cline | 6-file typed | Yes (manual) | No | No | Yes (flat) | No | Yes | Yes | No |
| Aider | None (repo map) | No | No (PageRank) | Yes (structural) | No | No | No | Yes | No |
| Continue | None (providers) | No | Yes (on-demand) | No | No | No | Yes | Yes | No |
| Devin | Flat list | Yes (suggested) | Trigger-based | No | Yes | No | Partial | No ($500+) | No |
| Amazon Q | None (workspace) | No | Yes (local) | No | No | No | No | No | No |
| Tabnine | None (RAG) | No | Yes (org repos) | No | No | No | No | Enterprise | No |
| JetBrains AI | None | No | Yes (RAG) | No | No | No | Yes | No | No |
| Kiro | Spec-based | Partial | Unknown | No | Yes | No | Partial | No | No |
| Replit Agent | None | No | No | No | Task-local | No | No | No | No |
| Claude Code | Flat files | Yes (auto) | No | No | Yes (flat) | No | Yes | Yes | No |
| **Auto Claude V3** | **15+ types** | **Yes (Observer)** | **Yes (vector)** | **Yes (K-graph)** | **Yes** | **Yes** | **Yes** | **Yes** | **Yes (6 phases)** |

### Key Differentiators Where Auto Claude V3 Leads

1. Only tool with 15+ typed memory schema with structured relations
2. Only tool with phase-aware retrieval scoring (6 universal phases)
3. Only tool with a Knowledge Graph plus experiential memory layer
4. Only OSS/local tool with semantic vector search and automatic capture
5. Only tool with confidence propagation from human feedback along relation edges
6. Only tool with causal chain retrieval (file co-occurrence patterns)
7. Only tool with scratchpad-to-validated promotion pipeline
8. Only tool with E2E observation memory from MCP tool use

---

## 3. Embedding Model Landscape 2026

### 3.1 The Model Decision in V3

V3 uses `qwen3-embedding:4b` via Ollama — 1024-dim output, 32K context window, local execution, no API cost. This was a strong choice at design time. Let us validate it against the 2026 market.

### 3.2 Code Embedding Model Benchmark Comparison

| Model | Params | Dims | Context | MTEB Code | Deployment | Cost | MRL Support |
|-------|--------|------|---------|-----------|------------|------|-------------|
| `qwen3-embedding:8b` | 8B | up to 4096 | 32K | 80.68 | Local (Ollama) | Free | Yes |
| `qwen3-embedding:4b` | 4B | up to 2560 | 32K | ~76 (est.) | Local (Ollama) | Free | Yes |
| `qwen3-embedding:0.6b` | 0.6B | 1024 | 32K | ~68 (est.) | Local (Ollama) | Free | Yes |
| `nomic-embed-code` | 7B | 768 | 8K | SOTA CodeSearchNet | Local/API | Free/Paid | No |
| `voyage-code-3` | N/A | 2048/1024/512/256 | N/A | SOTA (32 datasets) | API only | Paid | Yes (MRL) |
| `voyage-4-large` | N/A | MoE | N/A | SOTA (2026) | API only | Paid | Yes |
| `text-embedding-3-large` | N/A | 3072 | 8K | Strong | API only | Paid | Yes (MRL) |
| `snowflake-arctic-embed-l-v2.0` | N/A | 32-4096 | 32K | MTEB multilingual #1 | API/Local | Paid | Yes |

**Key findings**:

- Qwen3-Embedding-8B achieves 80.68 on MTEB Code benchmark — currently state-of-the-art for local models
- Nomic Embed Code (7B, Apache-2.0) outperforms Voyage Code-3 and OpenAI-v3-large on CodeSearchNet — and is fully open source
- Voyage-code-3 outperforms OpenAI-v3-large and CodeSage-large by 13.80% and 16.81% respectively across 32 code retrieval datasets — but requires API access
- Voyage 4 series (January 2026) introduces shared embedding spaces and MoE architecture — 40% lower serving cost than comparable dense models
- All top models now support Matryoshka Representation Learning (MRL) for flexible dimension reduction

### 3.3 V3 Embedding Choice Verdict

**Verdict: Qwen3-embedding:4b is a defensible choice for local execution, but the 8B variant is superior where memory allows.**

Specific recommendations:
- **Local, memory-constrained (<16GB RAM available for model)**: Keep `qwen3-embedding:4b` — solid performance, 32K context, free, MRL support
- **Local, memory-rich (>32GB RAM)**: Upgrade to `qwen3-embedding:8b` — 80.68 MTEB Code is definitively best-in-class for local models
- **Cloud/API tier**: Use `voyage-code-3` for code-specific retrieval or `voyage-4` for general memory retrieval — higher accuracy, Matryoshka flexibility
- **Hybrid strategy (V4 recommendation)**: Use a 0.6B quantized model for high-frequency operations (proactive gotcha injection on every file read) and the 8B model for low-frequency, high-value searches (HyDE, session-end extraction)

### 3.4 Matryoshka Representation Learning (MRL) — Why It Matters

MRL trains a single embedding model to produce representations where the first N dimensions are independently meaningful. This enables:

1. **Tiered search**: Use 256-dim embeddings for broad candidate retrieval (14x faster), then 1024-dim for precise reranking — same model, different prefixes
2. **Storage optimization**: Memories stored at 1024-dim; search with 256-dim; only rerank candidates with full 1024-dim
3. **Dimension matching**: When switching between embedding models (e.g., upgrading from 4B to 8B), MRL's 1024-dim representations can be compared with older 1024-dim memories stored under the previous model, limiting re-embedding costs

MRL achieves 16:1 dimensionality reduction (4096 -> 256) while retaining ~90-95% of retrieval accuracy. A 2025 hybrid framework combining MRL with Morton Code indexing reports ~32:1 compression at >90% accuracy retention.

**V4 implementation**: Use Qwen3's MRL output. Store at `dimensions: 1024` for memory records. Run candidate generation at `dimensions: 256` for speed, then precision reranking at full dimensionality.

### 3.5 Multilingual Support

Qwen3-Embedding supports 100+ natural languages and programming languages — this matters for two reasons:

1. Multi-language codebases (TypeScript + Python + SQL + bash) are common; embeddings that understand code semantics across languages produce better cross-language retrieval
2. Non-English developer teams (a significant portion of Auto Claude's potential user base) benefit from instruction-aware multilingual embeddings

Qwen3's instruction-aware embedding (providing task-specific instructions before the text) yields 1-5% improvement on downstream retrieval tasks compared to no-instruction baseline.

---

## 4. Next-Generation Retrieval Architecture

### 4.1 Current V3 Retrieval Pipeline (Baseline)

The V3 pipeline:
```
Task description
    -> Embed with qwen3-embedding:4b (1024-dim)
    -> Vector search in SQLite (sqlite-vec)
    -> Phase-aware score: score * PHASE_WEIGHTS[phase][type]
    -> MMR reranking for diversity
    -> Inject top-N into system prompt
```

Score formula:
```
score = 0.6 * cosine_similarity
      + 0.25 * recency_score (exp(-days/30))
      + 0.15 * access_frequency (log normalized)

final = score * PHASE_WEIGHTS[universalPhase][memoryType]
```

This is solid. Three things it lacks that V4 should add:

1. **BM25 keyword search**: Cosine similarity misses exact technical terms — function names, error message strings, file paths. When an agent searches for "useTerminalStore", BM25 finds it exactly; cosine similarity may not if the embedding space doesn't cluster it near the query.
2. **Cross-encoder reranker**: The bi-encoder (embed -> compare) is fast but imprecise. A cross-encoder sees query+candidate together and produces a much more accurate relevance score — use it for final reranking of the top-50 candidates.
3. **Code-token-aware late interaction**: ColBERT-style token-level matching for exact code symbol matching within memory content.

### 4.2 Multi-Stage V4 Retrieval Pipeline

The V4 pipeline is a four-stage funnel:

```
Stage 1: CANDIDATE GENERATION (fast, broad, high recall)
    - BM25 keyword retrieval (top-100 candidates)
    - Dense vector search — 256-dim MRL (top-100 candidates)
    - File-scoped retrieval for proactive gotchas (all memories tagged to file)
    - Reciprocal Rank Fusion to merge BM25 + dense ranked lists

Stage 2: FILTERING (rule-based, milliseconds)
    - Phase filter: PHASE_WEIGHTS[phase][type] threshold >= 0.3
    - Staleness filter: stale_at set -> penalize, never proactively inject
    - Confidence filter: minConfidence (default 0.4, proactive injection 0.65)
    - Dedup: cosine similarity > 0.95 to already-selected -> drop lower-scored

Stage 3: RERANKING (expensive, run on top-50 only)
    - Phase-aware scoring: full 1024-dim cosine + recency + frequency
    - Cross-encoder reranker for top-50 candidates (query + candidate text)
    - Causal chain expansion: add causally linked memories for selected top results
    - HyDE fallback: if fewer than 3 results above 0.5 confidence, run HyDE

Stage 4: CONTEXT PACKING (token budget management)
    - Token budget allocation: type-priority packing
    - MMR diversity enforcement: no two memories with cosine > 0.85 both included
    - Citation chip format: [memory_id|type|confidence] appended to each injection
    - Final output: formatted injection string within token budget
```

### 4.3 BM25 Hybrid Search Implementation

BM25 retrieves memories where specific technical terms appear — function names, error messages, file paths, configuration keys. Cosine similarity often misses these because embedding spaces cluster by semantic meaning, not literal string content.

**When BM25 matters most**:
- Agent searches for `useTerminalStore` — exact function name should surface related memories
- Agent searches for `ELECTRON_MCP_ENABLED` — exact config key
- Agent searches for error message text: `"Cannot read properties of undefined"`
- Agent searches for a specific file path: `src/main/terminal/pty-daemon.ts`

```typescript
interface BM25Index {
  // SQLite FTS5 table with BM25 ranking
  // schema: CREATE VIRTUAL TABLE memories_fts USING fts5(
  //   memory_id,
  //   content,
  //   tags,
  //   related_files,
  //   tokenize='porter unicode61'
  // );

  search(query: string, projectId: string, limit: number): Promise<BM25Result[]>;
}

interface BM25Result {
  memoryId: string;
  bm25Score: number;  // BM25 rank (negative in SQLite FTS5 — lower is better)
  matchedTerms: string[];
}

// SQLite FTS5 BM25 query
async function bm25Search(
  query: string,
  projectId: string,
  limit: number = 100,
): Promise<BM25Result[]> {
  // SQLite FTS5 provides bm25() function natively
  const results = await db.all(`
    SELECT
      m.id as memoryId,
      bm25(memories_fts) as bm25Score,
      snippet(memories_fts, 1, '<b>', '</b>', '...', 32) as snippet
    FROM memories_fts
    JOIN memories m ON memories_fts.memory_id = m.id
    WHERE memories_fts MATCH ?
      AND m.project_id = ?
      AND m.deprecated = FALSE
    ORDER BY bm25Score  -- lower BM25 score = higher relevance in SQLite
    LIMIT ?
  `, [query, projectId, limit]);

  return results.map(r => ({
    memoryId: r.memoryId,
    bm25Score: Math.abs(r.bm25Score),  // normalize to positive
    matchedTerms: extractMatchedTerms(r.snippet),
  }));
}
```

**Reciprocal Rank Fusion (RRF)**: Merges the BM25 ranked list and the dense vector ranked list without requiring score normalization:

```typescript
function reciprocalRankFusion(
  bm25Results: BM25Result[],
  denseResults: VectorSearchResult[],
  k: number = 60,  // standard RRF constant
): Map<string, number> {
  const scores = new Map<string, number>();

  // BM25 contribution
  bm25Results.forEach((result, rank) => {
    const current = scores.get(result.memoryId) ?? 0;
    scores.set(result.memoryId, current + 1 / (k + rank + 1));
  });

  // Dense vector contribution
  denseResults.forEach((result, rank) => {
    const current = scores.get(result.memoryId) ?? 0;
    scores.set(result.memoryId, current + 1 / (k + rank + 1));
  });

  return scores;  // Sort by score descending for merged ranked list
}
```

### 4.4 Cross-Encoder Reranking

A bi-encoder embeds query and document independently and computes dot product — fast, but imprecise. A cross-encoder sees query+document together and computes a relevance score with full attention across both — slow, but significantly more accurate.

The standard production pattern: retrieve 50-100 candidates with bi-encoder, rerank top-50 with cross-encoder, inject top-5 to 10.

```typescript
interface CrossEncoderReranker {
  // Runs locally — use Qwen3-Reranker-0.6B or similar small model
  // Or via API — Voyage Rerank 2, Cohere Rerank 3
  score(query: string, candidates: string[]): Promise<number[]>;
}

class LocalCrossEncoderReranker implements CrossEncoderReranker {
  // Uses Qwen3-Reranker-0.6B (Ollama) — small enough for local, accurate enough for production
  async score(query: string, candidates: string[]): Promise<number[]> {
    // Batch inference — pass all candidates in one call
    const pairs = candidates.map(c => `query: ${query}\ndocument: ${c}`);
    const scores = await this.model.classify(pairs);
    return scores.map(s => s.score);  // 0-1 relevance probability
  }
}

async function rerankWithCrossEncoder(
  query: string,
  candidates: Memory[],
  reranker: CrossEncoderReranker,
  topK: number = 10,
): Promise<Memory[]> {
  if (candidates.length <= topK) return candidates;  // No need to rerank small sets

  const candidateTexts = candidates.map(m =>
    `[${m.type}] ${m.relatedFiles.join(', ')}: ${m.content}`
  );

  const scores = await reranker.score(query, candidateTexts);

  const ranked = candidates
    .map((memory, i) => ({ memory, rerankerScore: scores[i] }))
    .sort((a, b) => b.rerankerScore - a.rerankerScore)
    .slice(0, topK);

  return ranked.map(r => r.memory);
}
```

**Reranker Model Options**:

| Model | Deployment | Latency | Quality | Cost |
|-------|------------|---------|---------|------|
| `Qwen3-Reranker-0.6B` | Local (Ollama) | ~50ms | Good | Free |
| `Qwen3-Reranker-4B` | Local (Ollama, 8GB+) | ~200ms | Excellent | Free |
| `Voyage Rerank 2` | API | ~100ms | SOTA | Paid |
| `Cohere Rerank 3` | API | ~150ms | SOTA | Paid |

**Recommendation for V4**: `Qwen3-Reranker-0.6B` local for standard retrieval; `Voyage Rerank 2` as optional cloud tier for users who want maximum accuracy.

**When to run the cross-encoder**: Only for T3 (on-demand search_memory tool calls) and T1 (session-start injection). NOT for T2 proactive gotcha injection — proactive injection is file-scoped and already high precision. Running a reranker on every file read would add unacceptable latency to the agentic loop.

### 4.5 Phase-Aware Scoring (V3 Extended)

V3 already has the right PHASE_WEIGHTS structure. V4 extends it with two additions:

**Extension 1: Source Trust Multiplier**

```typescript
const SOURCE_TRUST_MULTIPLIERS: Record<MemorySource, number> = {
  user_taught: 1.4,       // User explicitly taught this — highest trust
  agent_explicit: 1.2,    // Agent called remember_this consciously
  qa_auto: 1.1,           // Extracted from QA failure — verified by test
  mcp_auto: 1.0,          // MCP tool observation — factual but unverified
  commit_auto: 1.0,       // Auto-tagged at commit — weak signal
  observer_inferred: 0.85, // Inferred from behavior — may have false positives
};

// Final score adds source trust to the existing formula
final_score = (cosine_score * PHASE_WEIGHTS[phase][type])
            * SOURCE_TRUST_MULTIPLIERS[memory.source]
            * memory.confidence;
```

**Extension 2: Recency-Volatility Adjustment**

Different file types change at different rates. A gotcha about a UI component changes faster than a gotcha about a database schema. Adjust recency decay based on file type:

```typescript
const VOLATILITY_DECAY_RATES: Record<string, number> = {
  // high volatility — UI components change frequently
  '.tsx': 0.05,    // half-life ~14 days
  '.css': 0.05,
  '.json': 0.04,   // config files change often
  // medium volatility
  '.ts': 0.03,     // half-life ~23 days
  '.js': 0.03,
  // low volatility — infrastructure rarely changes
  '.sql': 0.01,    // half-life ~69 days
  '.proto': 0.008,
  'Dockerfile': 0.008,
  // defaults
  'default': 0.03,
};

function getVolatilityDecayRate(relatedFiles: string[]): number {
  if (relatedFiles.length === 0) return VOLATILITY_DECAY_RATES.default;
  const rates = relatedFiles.map(f => {
    const ext = path.extname(f) || 'default';
    return VOLATILITY_DECAY_RATES[ext] ?? VOLATILITY_DECAY_RATES.default;
  });
  return Math.max(...rates);  // Use highest volatility among related files
}
```

### 4.6 ColBERT-Inspired Late Interaction for Code Tokens

ColBERT encodes query and document independently but computes relevance via MaxSim — matching each query token against the most similar document token. This is significantly more accurate than dot product for exact technical term matching.

The key insight for memory retrieval: when an agent searches for `"useTerminalStore hook"`, ColBERT-style late interaction correctly surfaces memories mentioning `useTerminalStore` even if the surrounding context is semantically different from the query.

**Lightweight V4 implementation** — full ColBERT is expensive. A simplified token-overlap boost achieves most of the benefit:

```typescript
interface TokenOverlapBooster {
  boost(query: string, memoryContent: string, baseScore: number): number;
}

class CodeTokenBooster implements TokenOverlapBooster {
  // Tokenize using the same rules as code parsers (camelCase splitting, etc.)
  private tokenize(text: string): Set<string> {
    return new Set(
      text
        .replace(/([A-Z])/g, ' $1')  // camelCase split
        .toLowerCase()
        .split(/[\s\W]+/)
        .filter(t => t.length > 2)
    );
  }

  boost(query: string, content: string, baseScore: number): number {
    const queryTokens = this.tokenize(query);
    const contentTokens = this.tokenize(content);

    const overlap = [...queryTokens].filter(t => contentTokens.has(t)).length;
    const overlapRatio = overlap / queryTokens.size;

    // Boost up to 15% for high token overlap (exact technical term matches)
    const boost = Math.min(overlapRatio * 0.15, 0.15);
    return Math.min(baseScore + boost, 1.0);
  }
}
```

For projects with larger memory stores (>10K memories) where full ColBERT is justified, use `colbert-ir/colbertv2.0` via a local inference server — it can run on CPU with reasonable latency for retrieval over thousands of memories.

### 4.7 Graph-Augmented Retrieval

V3 has a Knowledge Graph but does not fully exploit it during retrieval. V4 adds graph traversal as a retrieval source:

```typescript
interface GraphAugmentedRetriever {
  // When a memory for file A is retrieved, also retrieve memories for
  // files that have strong graph edges to A (imports, calls, implements)
  expandViaGraph(
    seedMemories: Memory[],
    graph: KnowledgeGraph,
    maxHops: number,
    minEdgeWeight: number,
  ): Promise<Memory[]>;
}

async function graphAugmentedExpansion(
  seedMemories: Memory[],
  graph: KnowledgeGraph,
): Promise<Memory[]> {
  const seedFiles = new Set(seedMemories.flatMap(m => m.relatedFiles));
  const expandedFiles = new Set<string>(seedFiles);

  for (const file of seedFiles) {
    const node = await graph.getNodeByPath(file);
    if (!node) continue;

    // Get files strongly linked (imports, calls, implements) — high impact weight
    const linkedNodes = await graph.getLinkedNodes(node.id, {
      edgeTypes: ['imports', 'calls', 'implements', 'extends'],
      minWeight: 0.7,
      maxDepth: 2,
    });

    for (const linked of linkedNodes) {
      expandedFiles.add(linked.label);
    }
  }

  // Retrieve memories for the expanded file set that weren't in seed
  const newFiles = [...expandedFiles].filter(f => !seedFiles.has(f));
  if (newFiles.length === 0) return [];

  return memoryService.search({
    relatedFiles: newFiles,
    types: ['gotcha', 'error_pattern', 'causal_dependency', 'dead_end'],
    limit: 6,
    minConfidence: 0.5,
  });
}
```

---

## 5. Context Window Optimization

### 5.1 The Token Budget Problem

Every memory injection competes for the same limited token budget. A typical auto-injected context block:

| Tier | Content | Typical Tokens |
|------|---------|----------------|
| T0 | System prompt (base) | 4,000-8,000 |
| T0 | CLAUDE.md injection | 1,000-3,000 |
| T1 | Session-start memories | 1,500-3,000 |
| T2 | Proactive gotchas (per file) | 50-200 per file, up to 1,000 total |
| T3 | On-demand search results | 500-1,000 per call |
| Body | Conversation history | Varies widely |
| Body | Task description | 200-500 |

For agents running long multi-step sessions, T2 injections accumulate significantly. Without budget management, memory injections can consume 5,000-10,000+ tokens per session.

### 5.2 Type-Priority Context Packing

Instead of fixed token limits, allocate budget by priority:

```typescript
interface ContextPackingConfig {
  totalBudget: number;  // tokens available for memory injection
  allocation: Record<MemoryType | 'workflow_recipe', number>; // fraction of budget
}

const DEFAULT_PACKING_CONFIG: Record<UniversalPhase, ContextPackingConfig> = {
  define: {
    totalBudget: 2500,
    allocation: {
      workflow_recipe: 0.30,   // 750 tokens — procedural guidance first
      requirement: 0.20,       // 500 tokens
      decision: 0.20,          // 500 tokens
      dead_end: 0.15,          // 375 tokens
      task_calibration: 0.10,  // 250 tokens
      other: 0.05,             // 125 tokens catch-all
    },
  },
  implement: {
    totalBudget: 3000,
    allocation: {
      gotcha: 0.30,            // 900 tokens — highest priority during coding
      error_pattern: 0.25,     // 750 tokens
      causal_dependency: 0.15, // 450 tokens
      pattern: 0.15,           // 450 tokens
      dead_end: 0.10,          // 300 tokens
      other: 0.05,             // 150 tokens
    },
  },
  validate: {
    totalBudget: 2500,
    allocation: {
      error_pattern: 0.30,     // 750 tokens
      requirement: 0.25,       // 625 tokens
      e2e_observation: 0.25,   // 625 tokens
      work_unit_outcome: 0.15, // 375 tokens
      other: 0.05,             // 125 tokens
    },
  },
  // ... refine, explore, reflect
};

function packContext(
  memories: Memory[],
  phase: UniversalPhase,
  config: ContextPackingConfig = DEFAULT_PACKING_CONFIG[phase],
): string {
  const budgets = new Map<string, number>();
  for (const [typeKey, fraction] of Object.entries(config.allocation)) {
    budgets.set(typeKey, Math.floor(fraction * config.totalBudget));
  }

  const packed: Memory[] = [];
  const tokenCounts = new Map<string, number>();

  // Sort memories by final score, then pack greedily by type budget
  const sorted = [...memories].sort((a, b) => b.finalScore - a.finalScore);

  for (const memory of sorted) {
    const typeKey = config.allocation[memory.type] ? memory.type : 'other';
    const used = tokenCounts.get(typeKey) ?? 0;
    const budget = budgets.get(typeKey) ?? 0;
    const memoryTokens = estimateTokens(memory.content);

    if (used + memoryTokens <= budget) {
      packed.push(memory);
      tokenCounts.set(typeKey, used + memoryTokens);
    }
  }

  return formatMemoriesForInjection(packed);
}
```

### 5.3 Hierarchical Compression for Older Memories

Memories older than 30 days that are still frequently accessed should be compressed. Full content is stored in the database; a shorter summary is used for injection:

```typescript
interface MemoryCompression {
  originalContent: string;       // Full content (in DB)
  compressedContent: string;     // Summary for injection (~50% shorter)
  compressionRatio: number;
  compressedAt: string;
}

async function compressMemoryForInjection(
  memory: Memory,
  targetTokens: number = 60,
): Promise<string> {
  const currentTokens = estimateTokens(memory.content);
  if (currentTokens <= targetTokens) return memory.content;

  // Use LLMLingua-style compression or simple extractive summarization
  // For local-first: use Qwen3 0.5B as summarizer
  // Target: extract the single most important fact from the memory
  const compressed = await generateText({
    model: fastModel,
    prompt: `Compress this developer memory to under ${targetTokens} tokens, keeping the single most important technical fact:

Memory: ${memory.content}

Compressed (one sentence):`,
    maxTokens: targetTokens + 10,
  });

  return compressed.text;
}
```

### 5.4 Deduplication Within Context

Before injecting, check for near-duplicate memories. Cosine similarity > 0.92 between two selected memories means one should be dropped:

```typescript
function deduplicateForInjection(
  memories: Memory[],
  similarityThreshold: number = 0.92,
): Memory[] {
  const selected: Memory[] = [];
  const selectedEmbeddings: number[][] = [];

  for (const memory of memories) {
    let isDuplicate = false;
    for (const existingEmb of selectedEmbeddings) {
      if (cosineSimilarity(memory.embedding, existingEmb) > similarityThreshold) {
        isDuplicate = true;
        break;
      }
    }
    if (!isDuplicate) {
      selected.push(memory);
      selectedEmbeddings.push(memory.embedding);
    }
  }

  return selected;
}
```

### 5.5 Adaptive Budget Based on Context Cost Memories

V3 introduces `context_cost` memory type — tracking token consumption per module. V4 uses these proactively to adjust injection budgets:

```typescript
async function getAdaptiveBudget(
  relevantModules: string[],
  basePhase: UniversalPhase,
  totalContextWindow: number,
): Promise<number> {
  // Get context cost profiles for relevant modules
  const costMemories = await memoryService.search({
    types: ['context_cost'],
    relatedModules: relevantModules,
    limit: relevantModules.length,
  });

  if (costMemories.length === 0) {
    // No profile yet — use default allocation (15% of context for memories)
    return Math.floor(totalContextWindow * 0.15);
  }

  const avgModuleCost = costMemories.reduce(
    (sum, m) => sum + (m as ContextCostMemory).p90TokensPerSession,
    0
  ) / costMemories.length;

  // Reduce memory budget when working in expensive modules
  // to leave more room for conversation and tool results
  const costRatio = Math.min(avgModuleCost / totalContextWindow, 0.6);
  const memoryFraction = 0.15 * (1 - costRatio * 0.5);

  return Math.floor(totalContextWindow * memoryFraction);
}
```

---

## 6. Caching and Performance

### 6.1 Embedding Cache

Embedding generation is the most expensive operation in the retrieval pipeline. Cache aggressively:

```typescript
interface EmbeddingCache {
  // LRU cache keyed by sha256(text + modelId + dimensions)
  get(text: string, modelId: string, dimensions: number): number[] | null;
  set(text: string, modelId: string, dimensions: number, embedding: number[]): void;
  evict(oldestK: number): void;
}

class SQLiteEmbeddingCache implements EmbeddingCache {
  // Store in SQLite alongside memories — same file, different table
  // Cache up to 10,000 embeddings (typical text length: 50-500 chars)
  // Memory overhead: 10K * 1024 dims * 4 bytes = ~40MB — acceptable

  get(text: string, modelId: string, dimensions: number): number[] | null {
    const key = sha256(`${text}:${modelId}:${dimensions}`);
    const row = this.db.prepare(
      'SELECT embedding FROM embedding_cache WHERE key = ? AND expires_at > ?'
    ).get(key, Date.now());
    return row ? JSON.parse(row.embedding) : null;
  }

  set(text: string, modelId: string, dimensions: number, embedding: number[]): void {
    const key = sha256(`${text}:${modelId}:${dimensions}`);
    const ttl = 7 * 24 * 3600 * 1000; // 7-day TTL
    this.db.prepare(
      'INSERT OR REPLACE INTO embedding_cache (key, embedding, expires_at) VALUES (?, ?, ?)'
    ).run(key, JSON.stringify(embedding), Date.now() + ttl);
  }
}
```

**Cache hit rate targets**:
- Task description embeddings: high variability, ~30% cache hit rate
- Memory content embeddings: stored permanently alongside memory record — 100% "cache hit" (embedded once at promotion, never re-embedded)
- File-scoped proactive gotcha queries: often identical across tool calls — ~60% cache hit rate

### 6.2 Session-Level Injection Deduplication

Track which memory IDs have already been injected in the current session. Never inject the same memory twice:

```typescript
class SessionInjectionTracker {
  private injected = new Set<string>();

  hasBeenInjected(memoryId: string): boolean {
    return this.injected.has(memoryId);
  }

  markInjected(memoryId: string): void {
    this.injected.add(memoryId);
    // Also update lastAccessedAt and increment accessCount in DB
  }

  clearForNewSession(): void {
    this.injected.clear();
  }
}
```

### 6.3 Prefetch Pattern Exploitation

V3's `prefetch_pattern` memories identify files accessed in >80% of sessions touching a module. V4 pre-warms the proactive gotcha cache for these files at session start:

```typescript
async function prefetchGotchasForSession(
  module: string,
  projectId: string,
  injectionTracker: SessionInjectionTracker,
): Promise<Map<string, Memory[]>> {
  // Get prefetch patterns for this module
  const prefetchMemory = await memoryService.search({
    types: ['prefetch_pattern'],
    relatedModules: [module],
    limit: 1,
  });

  if (!prefetchMemory.length) return new Map();

  const pattern = prefetchMemory[0] as PrefetchPattern;
  const filesToPrefetch = [
    ...pattern.alwaysReadFiles,
    ...pattern.frequentlyReadFiles,
  ];

  // Pre-load gotchas for all likely-to-be-accessed files
  const cache = new Map<string, Memory[]>();
  await Promise.all(
    filesToPrefetch.map(async (filePath) => {
      const gotchas = await memoryService.search({
        types: ['gotcha', 'error_pattern', 'dead_end'],
        relatedFiles: [filePath],
        limit: 3,
        minConfidence: 0.6,
      });
      // Filter out already-injected memories
      const fresh = gotchas.filter(g => !injectionTracker.hasBeenInjected(g.id));
      if (fresh.length > 0) cache.set(filePath, fresh);
    })
  );

  return cache;  // O(1) lookup when agent reads these files
}
```

### 6.4 Latency Budget Per Retrieval Tier

| Tier | Operation | Target Latency | Acceptable Max |
|------|-----------|---------------|----------------|
| T0 | CLAUDE.md + base prompt | <5ms | 10ms |
| T1 | Session-start vector search | <80ms | 150ms |
| T1 | Phase-aware scoring + MMR | <20ms | 50ms |
| T1 | Cross-encoder reranking (top-50) | <200ms | 400ms |
| T2 | Proactive gotcha lookup (file-scoped) | <15ms | 30ms |
| T2 | Cache hit (prefetched) | <1ms | 5ms |
| T3 | HyDE generation (fast model) | <500ms | 1000ms |
| T3 | HyDE embedding + search | <100ms | 200ms |
| T3 | Cross-encoder reranking | <200ms | 400ms |

Total T1 session-start budget: <300ms including all reranking
Total T2 per-file proactive injection: <15ms (must not slow agentic loop)
Total T3 on-demand search: <1000ms (agent expects slightly slower tool result)

---

## 7. TypeScript Interfaces and Code Examples

### 7.1 Complete V4 Retrieval Engine Interface

```typescript
// Core V4 retrieval engine interface
interface RetrievalEngineV4 {
  // T1: Session-start injection — called once per session before agent starts
  getSessionStartContext(
    request: SessionStartRequest,
  ): Promise<RetrievalResult>;

  // T2: Proactive file-access injection — called on every Read/Edit tool call
  getProactiveGotchas(
    filePath: string,
    operation: 'read' | 'write' | 'edit',
    sessionTracker: SessionInjectionTracker,
  ): Promise<ProactiveResult>;

  // T3: On-demand agent search — called when agent explicitly calls search_memory
  search(
    query: string,
    options: SearchOptions,
    temporal?: TemporalSearchOptions,
  ): Promise<RetrievalResult>;

  // Workflow recipe lookup — called at planning time
  searchWorkflowRecipe(
    taskDescription: string,
    limit?: number,
  ): Promise<WorkflowRecipe[]>;
}

interface SessionStartRequest {
  taskDescription: string;
  universalPhase: UniversalPhase;
  relevantFiles: string[];
  relevantModules: string[];
  projectId: string;
  tokenBudget: number;
}

interface RetrievalResult {
  memories: ScoredMemory[];
  formattedContext: string;     // Ready-to-inject string
  tokensUsed: number;
  retrievalMetadata: {
    bm25Candidates: number;
    vectorCandidates: number;
    afterFiltering: number;
    afterReranking: number;
    hydeUsed: boolean;
    graphExpanded: boolean;
    durationMs: number;
  };
}

interface ScoredMemory extends Memory {
  finalScore: number;
  bm25Score?: number;
  vectorScore: number;
  phaseMultiplier: number;
  crossEncoderScore?: number;
  sourceTrustMultiplier: number;
  citationChip: string;  // "[abc12345|gotcha|0.85]"
}

interface ProactiveResult {
  memories: Memory[];
  formattedInjection: string;  // Ready to prepend to tool result
  durationMs: number;
  cacheHit: boolean;
}
```

### 7.2 Full V4 Retrieval Engine Implementation

```typescript
class RetrievalEngineV4Impl implements RetrievalEngineV4 {
  constructor(
    private readonly vectorStore: VectorStore,
    private readonly bm25Index: BM25Index,
    private readonly crossEncoder: CrossEncoderReranker,
    private readonly graphRetriever: GraphAugmentedRetriever,
    private readonly hydeSearch: HyDEMemorySearch,
    private readonly embeddingCache: EmbeddingCache,
    private readonly prefetchCache: Map<string, Memory[]>,
  ) {}

  async getSessionStartContext(
    request: SessionStartRequest,
  ): Promise<RetrievalResult> {
    const start = Date.now();
    const { taskDescription, universalPhase, projectId, tokenBudget } = request;

    // Stage 1: Candidate generation (parallel BM25 + dense)
    const [bm25Candidates, vectorCandidates] = await Promise.all([
      this.bm25Index.search(taskDescription, projectId, 100),
      this.vectorSearch(taskDescription, projectId, 100, 256),  // 256-dim MRL for speed
    ]);

    // Merge via RRF
    const rrfScores = reciprocalRankFusion(bm25Candidates, vectorCandidates);
    const mergedIds = [...rrfScores.entries()]
      .sort(([, a], [, b]) => b - a)
      .slice(0, 80)
      .map(([id]) => id);

    const candidates = await this.vectorStore.getByIds(mergedIds);

    // Stage 2: Filtering
    const filtered = candidates.filter(m =>
      !m.staleAt &&
      m.confidence >= 0.4 &&
      (PHASE_WEIGHTS[universalPhase][m.type] ?? 1.0) >= 0.3 &&
      !m.deprecated
    );

    // Stage 3: Phase-aware scoring with full 1024-dim cosine
    const queryEmbedding = await this.embed(taskDescription, 1024);
    const scored = filtered.map(m => ({
      ...m,
      vectorScore: cosineSimilarity(m.embedding, queryEmbedding),
      bm25Score: rrfScores.get(m.id) ?? 0,
      phaseMultiplier: PHASE_WEIGHTS[universalPhase][m.type] ?? 1.0,
      sourceTrustMultiplier: SOURCE_TRUST_MULTIPLIERS[m.source],
      finalScore: this.computeFinalScore(m, queryEmbedding, universalPhase),
      citationChip: `[${m.id.slice(0, 8)}|${m.type}|${m.confidence.toFixed(2)}]`,
    }));

    // Cross-encoder reranking on top-50
    const top50 = scored.sort((a, b) => b.finalScore - a.finalScore).slice(0, 50);
    const reranked = await this.rerankWithCrossEncoder(taskDescription, top50);

    // Graph expansion for top results
    const graphExpanded = await this.graphRetriever.expandViaGraph(
      reranked.slice(0, 10),
      this.graph,
    );
    const withGraph = deduplicateAndMerge(reranked, graphExpanded);

    // HyDE fallback if fewer than 3 high-confidence results
    const highConfidence = reranked.filter(m => m.finalScore > 0.5);
    let finalCandidates = withGraph;
    let hydeUsed = false;

    if (highConfidence.length < 3) {
      const hydeResults = await this.hydeSearch.search(
        taskDescription, projectId, universalPhase, { limit: 20 }
      );
      finalCandidates = deduplicateAndMerge(withGraph, hydeResults as ScoredMemory[]);
      hydeUsed = true;
    }

    // Stage 4: Context packing within token budget
    const deduped = deduplicateForInjection(finalCandidates);
    const packed = packContext(deduped, universalPhase, {
      totalBudget: tokenBudget,
      allocation: DEFAULT_PACKING_CONFIG[universalPhase].allocation,
    });

    return {
      memories: deduped.slice(0, 15),
      formattedContext: packed,
      tokensUsed: estimateTokens(packed),
      retrievalMetadata: {
        bm25Candidates: bm25Candidates.length,
        vectorCandidates: vectorCandidates.length,
        afterFiltering: filtered.length,
        afterReranking: reranked.length,
        hydeUsed,
        graphExpanded: graphExpanded.length > 0,
        durationMs: Date.now() - start,
      },
    };
  }

  async getProactiveGotchas(
    filePath: string,
    operation: 'read' | 'write' | 'edit',
    sessionTracker: SessionInjectionTracker,
  ): Promise<ProactiveResult> {
    const start = Date.now();

    // Check prefetch cache first
    const cached = this.prefetchCache.get(filePath);
    if (cached) {
      const fresh = cached.filter(m => !sessionTracker.hasBeenInjected(m.id));
      if (fresh.length > 0) {
        fresh.forEach(m => sessionTracker.markInjected(m.id));
        return {
          memories: fresh,
          formattedInjection: formatProactiveInjection(fresh, filePath),
          durationMs: Date.now() - start,
          cacheHit: true,
        };
      }
      return { memories: [], formattedInjection: '', durationMs: 0, cacheHit: true };
    }

    // File-scoped query — no embedding needed, pure filter
    const gotchas = await this.vectorStore.queryByRelatedFile(filePath, {
      types: ['gotcha', 'error_pattern', 'dead_end', 'e2e_observation'],
      minConfidence: 0.65,
      deprecated: false,
      limit: 5,
    });

    const fresh = gotchas
      .filter(m => !sessionTracker.hasBeenInjected(m.id))
      .slice(0, 3);  // Max 3 proactive injections per file

    fresh.forEach(m => sessionTracker.markInjected(m.id));

    return {
      memories: fresh,
      formattedInjection: fresh.length > 0 ? formatProactiveInjection(fresh, filePath) : '',
      durationMs: Date.now() - start,
      cacheHit: false,
    };
  }

  private computeFinalScore(
    memory: Memory,
    queryEmbedding: number[],
    phase: UniversalPhase,
    now: number = Date.now(),
  ): number {
    const cosine = cosineSimilarity(memory.embedding, queryEmbedding);
    const daysSinceAccess = (now - new Date(memory.lastAccessedAt).getTime()) / 86_400_000;
    const volatilityRate = getVolatilityDecayRate(memory.relatedFiles);
    const recency = Math.exp(-volatilityRate * 30 * daysSinceAccess);
    const frequency = Math.log1p(memory.accessCount) / Math.log1p(100);  // normalize to [0,1]

    const baseScore = 0.6 * cosine + 0.25 * recency + 0.15 * frequency;
    const phaseMultiplier = PHASE_WEIGHTS[phase][memory.type] ?? 1.0;
    const sourceTrust = SOURCE_TRUST_MULTIPLIERS[memory.source];

    // Token overlap boost (ColBERT-inspired)
    const tokenBoost = this.codeTokenBooster.boost(
      this.lastQueryText,
      memory.content,
      0,  // additive boost only
    );

    return Math.min((baseScore * phaseMultiplier * sourceTrust * memory.confidence) + tokenBoost, 1.0);
  }

  private async embed(text: string, dimensions: number): Promise<number[]> {
    const cached = this.embeddingCache.get(text, 'qwen3-embedding:4b', dimensions);
    if (cached) return cached;

    const result = await embed({
      model: this.embeddingModel,
      value: text,
      // Qwen3 instruction-aware embedding
      ...(dimensions < 1024 ? { dimensions } : {}),
    });

    this.embeddingCache.set(text, 'qwen3-embedding:4b', dimensions, result.embedding);
    return result.embedding;
  }
}
```

### 7.3 Formatted Injection Output

```typescript
function formatProactiveInjection(memories: Memory[], filePath: string): string {
  const fileName = path.basename(filePath);
  const sections: string[] = [];

  const byType = {
    gotcha: memories.filter(m => m.type === 'gotcha'),
    error_pattern: memories.filter(m => m.type === 'error_pattern'),
    dead_end: memories.filter(m => m.type === 'dead_end'),
    e2e_observation: memories.filter(m => m.type === 'e2e_observation'),
  };

  if (byType.gotcha.length || byType.error_pattern.length || byType.dead_end.length || byType.e2e_observation.length) {
    sections.push(`\n---\n**Memory context for ${fileName}:**`);

    byType.gotcha.forEach(m =>
      sections.push(`  WATCH OUT [${m.id.slice(0, 8)}]: ${m.content}`)
    );
    byType.error_pattern.forEach(m =>
      sections.push(`  KNOWN ERROR [${m.id.slice(0, 8)}]: ${m.content}`)
    );
    byType.dead_end.forEach(m =>
      sections.push(`  DEAD END [${m.id.slice(0, 8)}]: ${m.content}`)
    );
    byType.e2e_observation.forEach(m =>
      sections.push(`  E2E [${m.id.slice(0, 8)}]: ${m.content}`)
    );
  }

  return sections.join('\n');
}

// Example output when agent reads auth/tokens.ts:
// ---
// Memory context for tokens.ts:
//   WATCH OUT [a3f8bc12]: Refresh tokens must use httpOnly cookies — never localStorage (XSS vector)
//   KNOWN ERROR [d7e4921a]: Token expiry check uses server time — client Date.now() is unreliable across timezones
//   DEAD END [f2c81b44]: Attempted to use Redis TTL for token expiry — fails during Redis restarts; use JWT exp claim instead
```

### 7.4 V4 SQLite Schema Extensions

```sql
-- Existing memories table (V3) — no changes needed

-- New: BM25 full-text search index (FTS5)
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  memory_id UNINDEXED,
  content,
  tags,
  related_files,
  tokenize='porter unicode61'
);

-- Keep FTS5 in sync with memories table via triggers
CREATE TRIGGER IF NOT EXISTS memories_fts_insert
AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(memory_id, content, tags, related_files)
  VALUES (new.id, new.content, new.tags, new.related_files);
END;

CREATE TRIGGER IF NOT EXISTS memories_fts_update
AFTER UPDATE ON memories BEGIN
  UPDATE memories_fts
  SET content = new.content, tags = new.tags, related_files = new.related_files
  WHERE memory_id = new.id;
END;

CREATE TRIGGER IF NOT EXISTS memories_fts_delete
AFTER DELETE ON memories BEGIN
  DELETE FROM memories_fts WHERE memory_id = old.id;
END;

-- Embedding cache table
CREATE TABLE IF NOT EXISTS embedding_cache (
  key TEXT PRIMARY KEY,
  embedding TEXT NOT NULL,       -- JSON array of floats
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_embedding_cache_expires ON embedding_cache(expires_at);

-- Session injection tracking
CREATE TABLE IF NOT EXISTS session_injection_log (
  session_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  injected_at INTEGER NOT NULL,
  tier TEXT NOT NULL,            -- 'T1' | 'T2' | 'T3'
  PRIMARY KEY (session_id, memory_id)
);

-- V4 scoring metadata stored alongside memory
ALTER TABLE memories ADD COLUMN IF NOT EXISTS source_trust_score REAL DEFAULT 1.0;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS volatility_decay_rate REAL;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS last_cross_encoder_score REAL;
```

---

## 8. Recommendations for V4

### 8.1 Priority-Ordered Implementation Plan

**Priority 1 — BM25 Hybrid Search** (highest ROI, lowest effort)
- Add `memories_fts` FTS5 table with triggers to SQLite (SQLite natively supports BM25 via FTS5)
- Implement `bm25Search()` and `reciprocalRankFusion()` functions
- Wire into session-start retrieval (T1) and on-demand search (T3)
- Expected outcome: catches exact technical term queries that cosine similarity misses; 20-30% improvement in T3 search precision
- Effort: 1-2 days

**Priority 2 — Matryoshka Dimension Strategy**
- Switch from `qwen3-embedding:4b` at 1024-dim to 256-dim for candidate generation, 1024-dim for reranking
- Implement `embed(text, dimensions)` with MRL prefix truncation
- Add embedding cache with 7-day TTL
- Expected outcome: 4-6x faster candidate generation with minimal accuracy loss; enables more memories to be candidate-considered within latency budget
- Effort: 1 day

**Priority 3 — Cross-Encoder Reranker**
- Deploy `Qwen3-Reranker-0.6B` via Ollama alongside embedding model
- Run reranker only on T1 (session-start, top-50 candidates) and T3 (on-demand, top-30)
- Skip for T2 (proactive injection — file-scoped queries are already precise)
- Expected outcome: significantly more accurate final rankings; reduces noise in session-start context injection
- Effort: 2-3 days (Ollama model + TypeScript integration)

**Priority 4 — Source Trust Multipliers**
- Add `source_trust_score` field to scoring pipeline
- Implement `SOURCE_TRUST_MULTIPLIERS` weighting
- Expected outcome: user-taught and QA-validated memories surface above observer-inferred memories in ranking
- Effort: half a day

**Priority 5 — Volatility-Adjusted Recency Decay**
- Add file extension to decay rate mapping
- Apply `getVolatilityDecayRate()` to recency calculation
- Expected outcome: gotchas about rapidly-changing UI components decay faster; infrastructure gotchas remain relevant longer
- Effort: half a day

**Priority 6 — Type-Priority Context Packing**
- Implement `packContext()` with phase-specific allocation budgets
- Replace current fixed-count injection with token-budget-aware packing
- Expected outcome: same information injected in fewer tokens; more room for conversation and tool results
- Effort: 1-2 days

**Priority 7 — Graph-Augmented Retrieval**
- Add `graphRetriever.expandViaGraph()` call in session-start pipeline
- Retrieve memories for structurally linked files (imports, calls, implements)
- Expected outcome: agent automatically gets context for files it is about to touch based on knowledge graph expansion
- Effort: 2-3 days

**Priority 8 — Embedding Model Upgrade**
- Switch from `qwen3-embedding:4b` to `qwen3-embedding:8b` as default recommendation
- Make model configurable in settings (small/medium/large preset)
- Expected outcome: MTEB Code score improves from ~76 to 80.68; better multilingual support
- Effort: 1 day (mostly settings UI + documentation)

### 8.2 The One Thing That Would Make Auto Claude Legendary

Every competitor has some form of code indexing. No competitor has what Auto Claude is building: **an AI coding platform that gets measurably smarter about your specific project with every session.**

The retrieval engine improvements above are important. But the experience that would make developers evangelize Auto Claude is this:

> "Session 1: It doesn't know anything about my project. Session 5: It's starting to know the tricky parts. Session 20: It codes this codebase like a senior dev who built it."

That trajectory — cold to expert — is what the V3 Observer + V4 retrieval engine enables. The technology exists. The focus for V4 should be on making that learning trajectory *visible* to the user.

**Concrete UX feature**: A "Memory Health" panel in the sidebar showing:
- Sessions logged: 12
- Memories accumulated: 84
- Most-cited gotchas: "refresh token race condition", "IPC handler must be registered in main process"
- Estimated context token savings this week: 8,400 tokens
- Modules with best coverage: auth (12 memories), terminal (8 memories)
- Modules with no coverage yet: gitlab integration (0 memories) — "Work on this module to build up coverage"

Developers who can *see* their memory system growing will trust it. Developers who trust it will use Auto Claude exclusively for projects where that memory has accumulated.

### 8.3 Embedding Model Decision Tree

```
Does the user have >32GB RAM available?
  YES -> Use qwen3-embedding:8b (SOTA local, 80.68 MTEB Code)
  NO
    Does the user have >16GB RAM?
      YES -> Use qwen3-embedding:4b (current V3 default, strong performance)
      NO
        Is API access acceptable?
          YES -> Use voyage-code-3 (SOTA cloud, 32 dataset benchmark winner)
          NO -> Use qwen3-embedding:0.6b (lightweight local, adequate for basic retrieval)
```

### 8.4 What V4 Should NOT Do

1. **Do not add a separate vector database** (Qdrant, Weaviate, Chroma): SQLite with sqlite-vec handles up to 1M+ vectors efficiently for a single-project desktop app. Adding a vector DB adds deployment complexity, port management, and memory overhead for marginal gains.

2. **Do not run cross-encoder on T2 proactive injections**: Adding a 50-200ms reranker call on every file-read tool result would make the agentic loop feel sluggish. File-scoped queries are already high-precision; the cross-encoder overhead is not justified here.

3. **Do not store source code in the memory system**: The memory system stores *accumulated wisdom about the codebase*, not the codebase itself. Cursor-style code chunk indexing is a different product. Auto Claude's competitive advantage is experiential memory, not code search.

4. **Do not make memory mandatory or always-visible**: The best interface is invisible. Memory injection should feel like the agent already knows your project, not like it's reading from a visible database. The "Memory Health" panel satisfies the transparency need without cluttering the default UI.

### 8.5 Final Assessment: Where Auto Claude V3 Wins, Where V4 Must Improve

**Wins clearly against all competitors**:
- Structured typed schema with 15+ memory types
- Phase-aware retrieval (no competitor has 6 universal phases)
- Knowledge Graph + experiential memory (only Cody has a graph, but no experiential layer)
- OSS/local-first (no cloud dependency, no $500/month SaaS)
- Full user transparency and editability

**Must improve to be definitively best-in-class**:
- Hybrid BM25 + semantic retrieval (Cursor and Augment have more complete code search)
- Cross-encoder reranking (Voyage Rerank and Cohere Rerank are available; Auto Claude should use one)
- Embedding model flexibility (let users choose small/medium/large preset based on hardware)
- Visible memory growth trajectory (make the "getting smarter" story visible in the UI)

V4 retrieval engine + the V3 structured memory foundation = the most sophisticated memory system available in any AI coding tool, OSS or commercial, local or cloud.

---

*Research sources for this document:*
- [How Cursor Actually Indexes Your Codebase — Towards Data Science](https://towardsdatascience.com/how-cursor-actually-indexes-your-codebase/)
- [Cursor scales code retrieval to 100B+ vectors with turbopuffer](https://turbopuffer.com/customers/cursor)
- [Sourcegraph Cody: Expand and Refine Retrieval Method](https://sourcegraph.com/blog/how-cody-provides-remote-repository-context)
- [Qwen3 Embedding: Advancing Text Embedding Through Foundation Models](https://qwenlm.github.io/blog/qwen3-embedding/)
- [Voyage-code-3: More Accurate Code Retrieval](https://blog.voyageai.com/2024/12/04/voyage-code-3/)
- [Voyage 4 model family: shared embedding space with MoE architecture](https://blog.voyageai.com/2026/01/15/voyage-4/)
- [Nomic Embed Code: State-of-the-Art Code Embedder](https://www.nomic.ai/blog/posts/introducing-state-of-the-art-nomic-embed-code)
- [Cascade Memories — Windsurf Documentation](https://docs.windsurf.com/windsurf/cascade/memories)
- [Amazon Q Developer Workspace Context](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/workspace-context.html)
- [Augment Code Context Engine](https://www.augmentcode.com/context-engine)
- [Building Production RAG Systems in 2026](https://brlikhon.engineer/blog/building-production-rag-systems-in-2026-complete-architecture-guide)
- [ColBERT Late Interaction Overview — Weaviate](https://weaviate.io/blog/late-interaction-overview)
- [Matryoshka Representation Learning — NeurIPS 2022](https://arxiv.org/abs/2205.13147)
- [Ultimate Guide to Reranking Models 2026 — ZeroEntropy](https://www.zeroentropy.dev/articles/ultimate-guide-to-choosing-the-best-reranking-model-in-2025)
- [Knowledge Onboarding — Devin Docs](https://docs.devin.ai/onboard-devin/knowledge-onboarding)
- [Kiro: Spec-Driven Development](https://kiro.dev/blog/introducing-kiro-autonomous-agent/)
