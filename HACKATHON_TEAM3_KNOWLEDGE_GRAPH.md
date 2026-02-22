# Team 3: Living Knowledge Graph — Enhanced Design

## Beyond the Two-Layer Model: A Dynamic Structural Code Intelligence System

**Team:** Team 3 — Living Knowledge Graph
**Date:** 2026-02-22
**Version:** 2.0 (Enhanced from V1 Foundation)
**Audience:** Hackathon panel — feeds into Memory System V4 design
**Builds on:** V3 Draft (2026-02-21) + Team 3 V1 document

---

## 1. Executive Summary — Why Knowledge Graphs Are Essential for AI Coding

AI coding agents have a fundamental problem that neither flat file listings nor embedding-based semantic search fully solves: they cannot reason about *structural relationships* without re-reading code.

Consider what a senior engineer knows that an agent must re-discover every session:

- "If you change `verifyJwt()`, three route handlers break silently — they do not import the function directly but depend on its behavior through the auth middleware"
- "User input from the login form travels through five layers before hitting the database — and layer three has no validation"
- "The payments module uses an event bus pattern internally — you cannot call its functions directly from the API layer without going through the event system"
- "There are 47 test files but only 11 of them cover the auth module — these are the ones to run before merging auth changes"

These are not semantic facts retrievable by embedding similarity. They are structural facts about how code elements relate to each other. A knowledge graph externalizes these structural relationships so agents can query them instantly, without re-reading thousands of lines of code on every session.

**The core claim of this document:** Adding a structural knowledge graph layer to the V3 memory system reduces agent re-discovery cost by 40-60% for tasks that touch well-connected parts of the codebase, while enabling capabilities — impact analysis, data flow tracing, test coverage mapping — that flat memory systems fundamentally cannot provide.

**The Electron constraint shapes every design decision in this document.** We are not building Sourcegraph. We are building a local-first, SQLite-backed, incremental code intelligence system that starts with file-level import graphs and grows into function-level call graphs over time. Every architectural choice must work on a developer's laptop without a network connection, without a compiler server process running continuously, and without adding more than 10MB of bundle size to the Electron app in the first phase.

---

## 2. Production Code Intelligence Survey

Understanding what production systems do at scale informs what we should adapt (versus what we must scope out) for an embedded local context.

### 2.1 CodeQL (GitHub / Microsoft)

CodeQL is the gold standard of static analysis. It extracts source code into three interconnected representations:

**Abstract Syntax Tree (AST):** The syntactic structure of the program — every statement, expression, declaration, and their nesting relationships.

**Control Flow Graph (CFG):** Every possible execution path through the program. Conditional branches create branching paths; loops create cycles.

**Data Flow Graph (DFG):** How values propagate through the program at runtime. This is CodeQL's primary differentiator — it enables taint analysis: "does user input reach a SQL query without sanitization?"

The DFG is built by composing SSA (Static Single Assignment) forms for individual functions, then linking function-level DFGs through call edges to produce interprocedural data flow paths.

**What is portable to Electron:** The architecture of separating syntactic structure from semantic relationships. The insight that a DFG answers different questions than an AST or CFG, and all three are useful. The concept of taint sources and taint sinks as graph query endpoints.

**What is not portable:** CodeQL requires compiler-instrumented extraction — for TypeScript it runs the TypeScript compiler with CodeQL hooks, producing a database that can be 500MB-2GB for large projects. It requires a continuous analysis server. It is designed for CI environments, not interactive local use. Runtimes of minutes to hours are acceptable in CI; they are not acceptable for an Electron app that opens a project for the first time.

**Our adaptation:** We borrow the DFG concept at a shallower level — function-to-function data flow via explicit argument passing, not full interprocedural taint analysis. This is achievable with tree-sitter queries and heuristics, and it answers 80% of the questions agents ask about data flow without requiring compiler-level analysis.

### 2.2 Sourcegraph SCIP (Source Code Intelligence Protocol)

SCIP replaces LSIF as Sourcegraph's language-agnostic cross-reference format. The key technical details:

**Symbol identity:** SCIP uses human-readable string IDs for symbols. Example: `scip-typescript npm react 18.0.0 src/hooks.ts/useEffect().` This means symbol IDs are stable across indexer runs and can be stored as strings in SQLite without a separate symbol table.

**Index structure:** An SCIP index is a protobuf file containing a list of documents. Each document has a list of occurrences — each occurrence records a range (line, character) and a symbol string, tagged as a definition or reference. Occurrences also carry semantic role flags (definition, reference, implementation, etc.).

**Size advantage:** SCIP indexes average 4-5x smaller than equivalent LSIF indexes because SCIP deduplicates symbol definitions across files and uses delta encoding for ranges.

**Performance:** The `scip-typescript` indexer reports a 10x speedup over `lsif-node` for the same TypeScript projects, enabled by processing in a single compiler pass rather than multiple file-by-file passes.

**What is portable:** SCIP's symbol ID scheme is directly adoptable. We can generate SCIP-compatible symbol IDs from the TypeScript compiler API and store them as node identifiers in our SQLite graph — this gives us SCIP-compatible cross-reference data without requiring the full Sourcegraph infrastructure. The `scip-typescript` indexer itself can be run as a subprocess and its output parsed into our graph schema.

**What is not portable:** SCIP is designed for upload to Sourcegraph's servers. The entire toolchain assumes a network upload step. We use only the extraction logic.

**Practical approach:** For TypeScript projects, run `npx scip-typescript index` as a one-time background process at project open. Parse the output protobuf into SQLite `graph_nodes` and `graph_edges` rows. This gives us precise go-to-definition data without implementing the TypeScript compiler API integration ourselves.

### 2.3 Meta Glean — The Incremental Architecture Reference

Glean is Meta's open-source code indexing system (open-sourced December 2024). It is the most relevant architectural reference for our incremental update strategy.

**Key architectural insight:** Glean does not rebuild the index on every commit. It operates on diffs — "diff sketches" that describe what changed structurally in a pull request. Only changed files are re-indexed. The fact store is append-only: new facts are added, old facts are marked stale with a staleness timestamp, queries automatically filter by staleness.

**The fact store model:** Glean stores "facts" rather than nodes and edges. A fact is a tuple of (predicate, key, value). Predicates define what kind of fact it is (e.g., `src.File`, `python.Name.Declaration`, `cxx1.FunctionDefinition`). Multiple languages share the same fact store — a cross-language reference from a Python file to a C extension is just two facts with a relationship predicate.

**Performance at scale:** Glean runs at Meta scale (billions of lines, many languages) with incremental latency of seconds for diff-based updates versus minutes for full re-indexing.

**Our adaptation:** We adopt Glean's `stale_at` timestamp pattern on every edge and node. When files change, we mark affected edges stale immediately (synchronous, O(edges_per_file)), then schedule re-indexing asynchronously. Agents always see fresh results filtered by `stale_at IS NULL`. This is the core of our incremental update strategy.

### 2.4 Google Kythe — The Edge Type Vocabulary

Kythe defines the most comprehensive open-source edge type vocabulary for code cross-references. Key edge types from the Kythe schema that we adopt:

```
defines/binding   — Symbol definition with binding
ref               — Reference to a symbol (usage)
ref/call          — Call reference (a specific kind of ref)
ref/imports       — Import reference
childof           — Symbol is a child of (e.g., method of class)
typed             — Expression has a type
satisfies         — Type satisfies an interface
overrides         — Method overrides a parent method
```

**Our adaptation:** We use a subset of Kythe's edge types as our `EdgeType` enum values, extending them with semantic edge types that Kythe does not have (e.g., `applies_pattern`, `flows_to`, `handles_errors_from`). This gives our schema well-tested semantics for the structural edges while adding agent-discovered semantic edges on top.

### 2.5 Semgrep — Pattern-Based Static Analysis

Semgrep is a fast, multi-language static analysis tool that matches patterns against ASTs without building a full type-resolved IR. It uses a unified abstract syntax representation called the "Generic AST" that normalizes across languages, so a pattern written for one language can often match equivalent constructs in another.

**Relevance to our design:** Semgrep's pattern matching approach is how we can build cross-language structural extraction without implementing separate tree-sitter queries for every language. For the structural layer (import detection, function definition extraction), Semgrep-style generic patterns work across TypeScript, Python, Go, Rust, and Java.

**Limitation:** Semgrep does not build a persistent graph. It matches on-demand. For our use case, we need the results persisted in SQLite so agents can query without re-running analysis.

**Our adaptation:** We use tree-sitter (not Semgrep) for extraction but adopt Semgrep's insight about language-agnostic query patterns. Our tree-sitter queries for function extraction, import detection, and call detection follow the same structural patterns across language grammars.

### 2.6 How Cursor Indexes Codebases (and What It Lacks)

Based on published research (January 2026), Cursor's codebase indexing is:

1. **Local chunking:** Code is split into semantically meaningful chunks (functions, classes, logical blocks) using AST boundaries — not character-count splits.
2. **Hash tree tracking:** A Merkle tree of file hashes tracks which chunks have changed since the last index run, enabling incremental embedding updates.
3. **Embedding generation:** Each chunk is embedded using a custom code-specific embedding model trained on agent sessions.
4. **Vector storage:** Embeddings stored in Turbopuffer (cloud) with only metadata on the local machine.
5. **Hybrid search:** Combines vector search with grep for exact patterns.

**What Cursor does NOT do:** Cursor does not build a structural graph of function call relationships, dependency chains, or impact radius. Its intelligence is entirely embedding-based — it can find semantically similar code but it cannot answer "what breaks if I change this function?" without the agent reading the callers manually.

**Our opportunity:** This is the precise gap the knowledge graph fills. Cursor's approach (embeddings + vector search) answers "what code is conceptually related to this?" Our approach answers "what code is structurally dependent on this?" These are complementary, not competing.

---

## 3. Architecture Design

### 3.1 Three-Layer Graph Architecture

The knowledge graph has three distinct layers that build on each other:

```
LAYER 3: KNOWLEDGE (agent-discovered + LLM-analyzed)
+---------------------------------------------------------+
|  [Pattern: Repository]     [Decision: JWT over sessions] |
|       | applies_pattern          | documents             |
|       v                          v                       |
|  [Module: auth]           [Function: verifyJwt()]        |
|       | handles_errors_from                              |
|       v                                                  |
|  [Module: database]                                      |
+---------------------------------------------------------+
         | is_entrypoint_for    | owns_data_for
LAYER 2: SEMANTIC (LLM-derived module relationships)
+---------------------------------------------------------+
|  [Module: auth]  --is_entrypoint_for-->  [File: routes/auth.ts]
|  [Module: auth]  --handles_errors_from-> [Module: database]   |
|  [Fn: login()]   --flows_to-->           [Fn: validateCreds()] |
+---------------------------------------------------------+
         | calls/imports/defines_in
LAYER 1: STRUCTURAL (AST-extracted via tree-sitter / TypeScript API)
+---------------------------------------------------------+
|  [File: routes/auth.ts]                                  |
|       | imports                                          |
|       v                                                  |
|  [File: middleware/auth.ts] --calls--> [Fn: verifyJwt()]|
|       | imports                               | defined_in
|       v                                       v          |
|  [File: auth/tokens.ts] <---------- [Fn: verifyJwt()]   |
+---------------------------------------------------------+
```

**Layer 1 (Structural)** is computed from code — fast, accurate, automatically maintained.
**Layer 2 (Semantic)** is computed by LLM analysis of Layer 1 subgraphs — slower, scheduled asynchronously.
**Layer 3 (Knowledge)** accumulates from agent sessions and user input — continuous, incremental.

### 3.2 Complete Node Schema

```typescript
type NodeType =
  // Structural nodes (computed from code)
  | "file"           // Source file — primary unit of change tracking
  | "directory"      // Filesystem directory (for module boundary detection)
  | "module"         // Semantic module (one or many files, LLM-classified)
  | "function"       // Function or method definition
  | "class"          // Class definition
  | "interface"      // TypeScript interface or abstract type
  | "type_alias"     // Type alias (TypeScript: type X = ...)
  | "variable"       // Module-level exported variable or constant
  | "enum"           // Enum definition
  | "package"        // External npm/pip/cargo/go package dependency
  // Concept nodes (agent-discovered and LLM-analyzed)
  | "pattern"        // Architectural pattern (repository, event bus, CQRS, etc.)
  | "dataflow"       // Named data flow path (e.g., "user-input-to-db")
  | "invariant"      // Behavioral constraint ("must validate before persisting")
  | "decision";      // Architectural decision (linked to Memory system decisions)

interface GraphNode {
  id: string;              // Stable ID — see Section 3.5 for ID scheme
  projectId: string;
  type: NodeType;
  label: string;           // Human-readable: "verifyJwt" or "src/auth/tokens.ts"
  filePath?: string;       // For file/function/class/interface nodes
  language?: string;       // "typescript" | "python" | "rust" | "go" | "java" etc.
  startLine?: number;      // Source location for function/class nodes
  endLine?: number;
  metadata: Record<string, unknown>;  // Type-specific extra data
  // Layer tracking
  layer: 1 | 2 | 3;       // Which layer produced this node
  source: "ast" | "compiler" | "scip" | "llm" | "agent" | "user";
  confidence: "inferred" | "verified" | "agent-confirmed";
  // Lifecycle
  createdAt: number;       // Unix ms
  updatedAt: number;       // Unix ms
  staleAt: number | null;  // Glean-style: set when source file changes
  lastAnalyzedAt?: number; // For LLM-analyzed nodes: last pattern scan
  // Memory system link
  associatedMemoryIds: string[];  // Fast path to related memories
}
```

### 3.3 Complete Edge Schema

```typescript
type EdgeType =
  // Layer 1: Structural edges (AST-derived)
  | "imports"           // File A imports from File B (file-level)
  | "imports_symbol"    // File A imports symbol S from File B (symbol-level)
  | "calls"             // Function A calls Function B
  | "calls_external"    // Function A calls external package API
  | "implements"        // Class A implements Interface B
  | "extends"           // Class A extends Class B
  | "overrides"         // Method A overrides Method B in superclass
  | "instantiates"      // Function A creates instance of Class B (new X())
  | "exports"           // File A exports Symbol B
  | "defined_in"        // Symbol A is defined in File B
  | "childof"           // Method/property A is child of Class/Interface B
  | "typed_as"          // Expression A has type T
  | "tested_by"         // Function/file A is covered by test file B
  // Layer 2: Semantic edges (LLM-derived)
  | "depends_logically" // Module A logically depends on Module B (beyond imports)
  | "is_entrypoint_for" // File A is the public entry point for Module B
  | "handles_errors_from" // Module A handles errors thrown by Module B
  | "owns_data_for"     // Module A owns the data model for concept C
  | "applies_pattern"   // Module/class A applies architectural pattern P
  | "flows_to"          // Data flows from node A to node B
  // Layer 3: Knowledge edges (agent-discovered or user-annotated)
  | "is_impact_of"      // Changing A impacts B (cached impact analysis result)
  | "documents"         // Memory/decision node documents a code node
  | "violates"          // This code element violates invariant I
  | "supersedes";       // New edge type supersedes old interpretation

interface GraphEdge {
  id: string;
  projectId: string;
  fromId: string;          // Source node ID
  toId: string;            // Target node ID
  type: EdgeType;
  layer: 1 | 2 | 3;
  weight: number;          // 0.0-1.0: call frequency, confidence level, or impact weight
  metadata: Record<string, unknown>;
  source: "ast" | "compiler" | "scip" | "llm" | "agent" | "user";
  confidence: number;      // 0.0-1.0
  createdAt: number;
  updatedAt: number;
  staleAt: number | null;  // Set when either endpoint's source file changes
}
```

### 3.4 Complete SQLite Schema

This schema extends the V3 SQLite database described in the memory system draft. All tables live in the same `memory.db` database.

```sql
-- ============================================================
-- GRAPH NODES
-- ============================================================
CREATE TABLE IF NOT EXISTS graph_nodes (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL,
  type         TEXT NOT NULL,        -- NodeType enum
  label        TEXT NOT NULL,
  file_path    TEXT,                 -- NULL for concept nodes
  language     TEXT,                 -- 'typescript' | 'python' | 'rust' | 'go' etc.
  start_line   INTEGER,
  end_line     INTEGER,
  layer        INTEGER NOT NULL DEFAULT 1,  -- 1 | 2 | 3
  source       TEXT NOT NULL,        -- 'ast' | 'compiler' | 'scip' | 'llm' | 'agent'
  confidence   TEXT DEFAULT 'inferred',
  metadata     TEXT,                 -- JSON blob
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  stale_at     INTEGER,              -- NULL = current; set = stale
  last_analyzed_at INTEGER
);

CREATE INDEX idx_gn_project_type   ON graph_nodes(project_id, type);
CREATE INDEX idx_gn_project_label  ON graph_nodes(project_id, label);
CREATE INDEX idx_gn_file_path      ON graph_nodes(project_id, file_path) WHERE file_path IS NOT NULL;
CREATE INDEX idx_gn_stale          ON graph_nodes(project_id, stale_at)  WHERE stale_at IS NOT NULL;

-- ============================================================
-- GRAPH EDGES
-- ============================================================
CREATE TABLE IF NOT EXISTS graph_edges (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL,
  from_id      TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  to_id        TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,        -- EdgeType enum
  layer        INTEGER NOT NULL DEFAULT 1,
  weight       REAL DEFAULT 1.0,
  source       TEXT NOT NULL,
  confidence   REAL DEFAULT 1.0,
  metadata     TEXT,                 -- JSON blob
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  stale_at     INTEGER
);

CREATE INDEX idx_ge_from_type  ON graph_edges(from_id, type)      WHERE stale_at IS NULL;
CREATE INDEX idx_ge_to_type    ON graph_edges(to_id, type)        WHERE stale_at IS NULL;
CREATE INDEX idx_ge_project    ON graph_edges(project_id, type)   WHERE stale_at IS NULL;
CREATE INDEX idx_ge_stale      ON graph_edges(project_id, stale_at) WHERE stale_at IS NOT NULL;

-- ============================================================
-- TRANSITIVE CLOSURE TABLE (pre-computed for O(1) impact queries)
-- ============================================================
-- Updated incrementally via SQLite AFTER INSERT / AFTER DELETE triggers on graph_edges.
-- ancestor_id = the node being changed; descendant_id = nodes affected by that change.
-- This captures the REVERSE direction: "what depends on ancestor_id?"
CREATE TABLE IF NOT EXISTS graph_closure (
  ancestor_id   TEXT NOT NULL,
  descendant_id TEXT NOT NULL,
  depth         INTEGER NOT NULL,    -- Hop count: 1 = direct, 2 = one intermediary, etc.
  path          TEXT NOT NULL,       -- JSON array of node IDs along shortest path
  edge_types    TEXT NOT NULL,       -- JSON array of edge types along path (for weight scoring)
  total_weight  REAL NOT NULL,       -- Product of edge weights along path
  PRIMARY KEY (ancestor_id, descendant_id),
  FOREIGN KEY (ancestor_id)   REFERENCES graph_nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (descendant_id) REFERENCES graph_nodes(id) ON DELETE CASCADE
);

CREATE INDEX idx_gc_ancestor   ON graph_closure(ancestor_id, depth);
CREATE INDEX idx_gc_descendant ON graph_closure(descendant_id, depth);

-- ============================================================
-- INDEX STATE TRACKING (for incremental updates)
-- ============================================================
CREATE TABLE IF NOT EXISTS graph_index_state (
  project_id       TEXT PRIMARY KEY,
  last_indexed_at  INTEGER NOT NULL,
  last_commit_sha  TEXT,
  node_count       INTEGER DEFAULT 0,
  edge_count       INTEGER DEFAULT 0,
  stale_edge_count INTEGER DEFAULT 0,
  index_version    INTEGER DEFAULT 1  -- Bump to force full re-index
);

-- ============================================================
-- SCIP SYMBOL REGISTRY (optional: populated when scip-typescript run)
-- ============================================================
-- Maps SCIP symbol strings to graph node IDs for precise cross-references.
CREATE TABLE IF NOT EXISTS scip_symbols (
  symbol_id  TEXT PRIMARY KEY,      -- SCIP string: "scip-typescript npm ... path/Fn()."
  node_id    TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL
);
CREATE INDEX idx_scip_node ON scip_symbols(node_id);
```

### 3.5 Node ID Scheme

Stable, collision-resistant node IDs that survive file renames and refactors:

```typescript
function makeNodeId(params: {
  projectId: string;
  type: NodeType;
  filePath?: string;
  symbolName?: string;
  startLine?: number;
}): string {
  const { projectId, type, filePath, symbolName, startLine } = params;

  if (type === "file" || type === "directory") {
    // File nodes: hash of project ID + normalized file path
    // Stable across moves if we also track renames
    return `${projectId}:${type}:${hashPath(filePath!)}`;
  }

  if (filePath && symbolName) {
    // Symbol nodes: project + file path hash + symbol name
    // startLine is NOT included — it changes on every refactor
    return `${projectId}:${type}:${hashPath(filePath)}:${symbolName}`;
  }

  if (type === "package") {
    // External packages: project + package name (no path)
    return `${projectId}:package:${symbolName}`;
  }

  // Concept nodes (patterns, decisions, invariants): UUID
  return `${projectId}:${type}:${generateUUID()}`;
}

function hashPath(filePath: string): string {
  // Normalize: remove project root prefix, use forward slashes
  const normalized = filePath.replace(/\\/g, '/').replace(/^.*?\/src\//, 'src/');
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}
```

### 3.6 Memory System Link

The knowledge graph connects to the V3 memory system via two cross-reference fields:

```typescript
// In Memory interface (extends V3 schema):
interface Memory {
  // ... existing V3 fields ...
  targetNodeId?: string;         // Links this memory to a specific graph node
  impactedNodeIds?: string[];    // Nodes whose impact analysis should include this memory
}

// In GraphNode:
interface GraphNode {
  // ... graph fields ...
  associatedMemoryIds: string[]; // Fast path: IDs of memories about this node
}
```

When a memory is stored with `targetNodeId`, the graph node's `associatedMemoryIds` is updated atomically. When an agent queries impact analysis for a node, associated memories (gotchas, invariants, decisions) are bundled with the structural impact results.

---

## 4. tree-sitter Integration

### 4.1 Why tree-sitter for Electron

tree-sitter is the correct parsing foundation for our Electron context for three reasons:

**Speed:** tree-sitter parses a 10,000-line TypeScript file in under 100ms. The TypeScript compiler API takes 5-30 seconds for the same file (with type checking). For cold-start indexing, tree-sitter can process an entire medium-sized project (500 files) in under 30 seconds.

**Incremental reparse:** tree-sitter is designed for incremental parsing. When a file changes, it computes the diff between old and new source text and only re-parses the changed subtrees. A 5-character edit in a 5,000-line file takes under 5ms to re-parse. This makes file-watcher-triggered updates practically instantaneous.

**Multi-language with WASM:** tree-sitter grammars compile to `.wasm` files via Emscripten. The `web-tree-sitter` package loads these WASM files in any JavaScript environment including Electron. A single uniform API (`Parser.parse(sourceText)`) works across TypeScript, Python, Rust, Go, Java, and 40+ other languages.

**No native rebuild required:** Unlike Node.js native addons that must be rebuilt for each Electron version (a maintenance nightmare), WASM grammars are architecture-independent and do not require rebuild when Electron updates. VS Code uses tree-sitter WASM grammars for syntax highlighting for precisely this reason.

### 4.2 WASM Grammar Bundling in Electron

The bundling strategy for `electron-vite` (which this project uses):

**Step 1: Install the grammar packages:**
```bash
npm install --save web-tree-sitter
# Grammars: these are separate packages providing .wasm files
npm install --save tree-sitter-wasms
# Or individually:
# npm install --save tree-sitter-typescript tree-sitter-python tree-sitter-rust
```

**Step 2: Configure `electron.vite.config.ts` to copy WASM files:**
```typescript
// electron.vite.config.ts
import { defineConfig } from 'electron-vite';
import { resolve } from 'path';

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: ['web-tree-sitter'],  // Do not bundle — use as-is
      }
    }
  }
});
```

**Step 3: Load grammars at runtime:**
```typescript
// apps/frontend/src/main/ai/graph/parser/tree-sitter-loader.ts
import Parser from 'web-tree-sitter';
import { app } from 'electron';
import { join } from 'path';

interface LanguageGrammar {
  language: Parser.Language;
  name: string;
}

const GRAMMAR_PATHS: Record<string, string> = {
  typescript:  'tree-sitter-typescript.wasm',
  tsx:         'tree-sitter-tsx.wasm',
  python:      'tree-sitter-python.wasm',
  rust:        'tree-sitter-rust.wasm',
  go:          'tree-sitter-go.wasm',
  java:        'tree-sitter-java.wasm',
  javascript:  'tree-sitter-javascript.wasm',
  json:        'tree-sitter-json.wasm',
};

export class TreeSitterLoader {
  private static instance: TreeSitterLoader | null = null;
  private parser: Parser | null = null;
  private grammars = new Map<string, LanguageGrammar>();
  private initialized = false;

  static getInstance(): TreeSitterLoader {
    if (!this.instance) this.instance = new TreeSitterLoader();
    return this.instance;
  }

  private getWasmDir(): string {
    // Dev: node_modules/.../; Prod: app.getPath('userData')/grammars/
    if (app.isPackaged) {
      return join(process.resourcesPath, 'grammars');
    }
    return join(__dirname, '..', '..', '..', '..', 'node_modules', 'tree-sitter-wasms');
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    await Parser.init({
      // Critical for Electron renderer process: provide WASM binary path
      locateFile: (filename: string) => join(this.getWasmDir(), filename),
    });

    this.parser = new Parser();
    this.initialized = true;
  }

  async loadGrammar(languageName: string): Promise<Parser.Language | null> {
    if (this.grammars.has(languageName)) {
      return this.grammars.get(languageName)!.language;
    }

    const wasmFile = GRAMMAR_PATHS[languageName];
    if (!wasmFile) return null;

    const wasmPath = join(this.getWasmDir(), wasmFile);
    try {
      const lang = await Parser.Language.load(wasmPath);
      this.grammars.set(languageName, { language: lang, name: languageName });
      return lang;
    } catch (err) {
      console.error(`Failed to load grammar for ${languageName}:`, err);
      return null;
    }
  }

  getParser(): Parser {
    if (!this.parser) throw new Error('TreeSitterLoader not initialized');
    return this.parser;
  }

  detectLanguage(filePath: string): string | null {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const extMap: Record<string, string> = {
      ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'javascript',
      py: 'python', rs: 'rust', go: 'go', java: 'java',
    };
    return extMap[ext ?? ''] ?? null;
  }
}
```

**Performance characteristics for Electron:**

| Operation | WASM tree-sitter | Native tree-sitter | TypeScript Compiler API |
|---|---|---|---|
| Cold parse, 1K-line file | ~15ms | ~5ms | ~2,000ms |
| Cold parse, 10K-line file | ~80ms | ~25ms | ~8,000ms |
| Incremental re-parse (100 char change) | ~3ms | ~1ms | ~8,000ms |
| Grammar load (first time) | ~50ms/grammar | N/A | N/A |
| Memory per grammar | ~5-15MB | ~5MB | ~100MB+ |
| Bundle size impact | ~5-15MB/grammar | N/A | N/A |

For cold-start indexing of a 500-file TypeScript project:
- WASM tree-sitter: ~40-60 seconds (single-threaded, background worker)
- TypeScript Compiler API: ~300-600 seconds
- Regex-based import parsing (fallback): ~3-5 seconds (less accurate)

**Grammar bundle strategy:** Ship 4 core grammars by default (TypeScript, JavaScript, Python, Rust). Load additional grammars on-demand when the project's languages are detected. Each grammar WASM file is 2-8MB; the default bundle adds ~20MB to the packaged app.

### 4.3 tree-sitter Query Examples

Tree-sitter queries use S-expression syntax with captures. These are the core queries for our structural extraction:

**TypeScript — Extract import edges:**
```scheme
; Matches: import { X } from 'module'
;          import * as X from 'module'
;          import X from 'module'
(import_declaration
  source: (string (string_fragment) @import.source))

; Matches: require('module')
(call_expression
  function: (identifier) @fn (#eq? @fn "require")
  arguments: (arguments (string (string_fragment) @import.source)))

; Dynamic imports: import('module')
(await_expression
  (call_expression
    function: (import)
    arguments: (arguments (string (string_fragment) @import.source))))
```

**TypeScript — Extract function definitions:**
```scheme
; Named function declarations
(function_declaration
  name: (identifier) @fn.name
  parameters: (formal_parameters) @fn.params) @fn.def

; Arrow function assigned to variable
(lexical_declaration
  (variable_declarator
    name: (identifier) @fn.name
    value: (arrow_function) @fn.def))

; Class methods
(method_definition
  name: (property_identifier) @fn.name
  parameters: (formal_parameters) @fn.params
  body: (statement_block) @fn.body) @fn.def
```

**TypeScript — Extract function call edges:**
```scheme
; Direct function calls: foo()
(call_expression
  function: (identifier) @call.name) @call

; Method calls: obj.method()
(call_expression
  function: (member_expression
    property: (property_identifier) @call.name)) @call

; Chained calls: obj.a().b()
(call_expression
  function: (member_expression
    object: (call_expression)
    property: (property_identifier) @call.name)) @call
```

**TypeScript — Extract class definitions and inheritance:**
```scheme
; Class with extends
(class_declaration
  name: (type_identifier) @class.name
  (class_heritage
    (extends_clause
      value: (identifier) @class.extends))) @class.def

; Interface with extends
(interface_declaration
  name: (type_identifier) @iface.name
  (extends_type_clause
    (type_identifier) @iface.extends)) @iface.def

; Class implementing interface
(class_declaration
  name: (type_identifier) @class.name
  (class_heritage
    (implements_clause
      (type_identifier) @class.implements))) @class.def
```

**Python — Extract import edges (different grammar):**
```scheme
; import module
(import_statement
  (dotted_name) @import.name)

; from module import X
(import_from_statement
  module_name: (dotted_name) @import.source
  name: (import_from_names
    (dotted_name) @import.symbol))

; from . import X (relative)
(import_from_statement
  module_name: (relative_import) @import.relative
  name: (import_from_names
    (dotted_name) @import.symbol))
```

### 4.4 Incremental Re-parse with File Watchers

```typescript
// apps/frontend/src/main/ai/graph/indexer/file-watcher.ts
import { FSWatcher, watch } from 'chokidar';
import { TreeSitterExtractor } from './extractor';
import { GraphDatabase } from '../storage/database';

export class IncrementalIndexer {
  private watcher: FSWatcher | null = null;
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private DEBOUNCE_MS = 500;  // Wait 500ms after last change before re-indexing

  start(projectRoot: string, db: GraphDatabase, extractor: TreeSitterExtractor): void {
    this.watcher = watch(projectRoot, {
      ignored: [
        /node_modules/,
        /\.git/,
        /dist/,
        /build/,
        /\.auto-claude/,
        /.*\.test\.(ts|js)$/,  // Optionally exclude tests from structural graph
      ],
      persistent: true,
      ignoreInitial: true,    // Don't fire for existing files at startup
    });

    this.watcher.on('change', (filePath) => {
      this.scheduleReindex(filePath, db, extractor, 'change');
    });

    this.watcher.on('add', (filePath) => {
      this.scheduleReindex(filePath, db, extractor, 'add');
    });

    this.watcher.on('unlink', (filePath) => {
      // File deleted — immediately remove nodes and mark edges stale
      db.deleteNodesForFile(filePath).catch(console.error);
    });

    this.watcher.on('rename', (oldPath: string, newPath: string) => {
      db.renameFileNode(oldPath, newPath).catch(console.error);
    });
  }

  private scheduleReindex(
    filePath: string,
    db: GraphDatabase,
    extractor: TreeSitterExtractor,
    event: 'change' | 'add'
  ): void {
    // Debounce: cancel pending timer for this file
    const existing = this.debounceTimers.get(filePath);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      this.debounceTimers.delete(filePath);

      // Glean-style: mark existing edges stale BEFORE re-indexing
      // This ensures agents never see stale + fresh edges in the same query
      await db.markFileEdgesStale(filePath);

      // Re-extract structural edges for the changed file
      const newEdges = await extractor.extractFile(filePath);
      await db.upsertEdges(newEdges);

      // Update closure table for affected subgraph
      await db.rebuildClosureForNodes(newEdges.map(e => e.fromId));
    }, this.DEBOUNCE_MS);

    this.debounceTimers.set(filePath, timer);
  }

  async stop(): Promise<void> {
    for (const timer of this.debounceTimers.values()) clearTimeout(timer);
    await this.watcher?.close();
  }
}
```

### 4.5 Performance Characteristics at Scale

Based on tree-sitter benchmarks and our Electron constraints:

**Small project (< 100 files):**
- Cold-start indexing: 5-10 seconds (background)
- File change re-index: < 100ms
- Memory for loaded grammars: 30-60MB

**Medium project (100-500 files, ~50K LOC):**
- Cold-start indexing: 30-60 seconds (background, progressive)
- File change re-index: < 500ms
- Graph storage: 5-20MB SQLite
- Closure table: 10-50MB SQLite

**Large project (500-2000 files, ~200K LOC):**
- Cold-start indexing: 2-5 minutes (background, progressive)
- File change re-index: < 1 second
- Graph storage: 20-80MB SQLite
- Closure table: 50-200MB SQLite (closure grows quadratically with connectivity)

**Very large project (2000+ files, 500K+ LOC):**
- Cold-start indexing: 10-20 minutes (background) — acceptable since it is one-time
- Memory pressure: closure table may exceed 500MB
- Recommendation: at this scale, disable closure table for deep dependencies (>3 hops), use lazy recursive CTE instead
- Future: migrate to Kuzu at this scale

**Worker thread architecture:** All indexing runs in a dedicated worker thread (`worker_threads`), never on the Electron main thread. Agents query the already-built graph via synchronous SQLite reads on a read-only connection. Writes (updates from indexing or agent-discovered edges) go through the main thread write proxy defined in the V3 concurrency architecture.

---

## 5. Query Patterns for Agents

Agents never write raw SQL or S-expressions against the graph. All graph access goes through a set of typed tool functions that translate natural language requests into graph traversals.

### 5.1 Complete Tool Inventory

```typescript
// All agent graph tools — defined in apps/frontend/src/main/ai/tools/graph-tools.ts
import { tool } from 'ai';
import { z } from 'zod';

// ── IMPACT ANALYSIS ──────────────────────────────────────────────────────────

export const analyzeImpactTool = tool({
  description: `Analyze what would be affected by changing a file, function, class, or module.
    Run BEFORE making significant changes to understand the blast radius.
    Returns: direct dependents, transitive dependents (up to maxDepth hops),
    relevant test files, known invariants, and a risk assessment.
    The result includes associated memories (gotchas, decisions) for affected nodes.`,
  inputSchema: z.object({
    target: z.string().describe(
      'File path (relative), function name, class name, or module name to analyze. ' +
      'Examples: "src/auth/tokens.ts", "verifyJwt", "AuthModule"'
    ),
    maxDepth: z.number().min(1).max(5).default(3).describe(
      'How many dependency hops to traverse. 2 = direct callers + their callers. ' +
      'Use 1 for quick check, 3 for full blast radius.'
    ),
    edgeFilter: z.array(z.string()).optional().describe(
      'Only follow these edge types. Omit to follow all structural edges. ' +
      'Options: imports, calls, implements, extends, instantiates'
    ),
  }),
  execute: async ({ target, maxDepth, edgeFilter }) => {
    return knowledgeGraph.analyzeImpact(target, { maxDepth, edgeFilter });
  },
});

// ── DEPENDENCY TRAVERSAL ──────────────────────────────────────────────────────

export const getDependenciesTool = tool({
  description: `Get all files, functions, and modules that a given target depends on.
    Direction "dependencies": what does this code USE?
    Direction "dependents": what USES this code?
    Use "dependents" to understand who calls a function before changing its signature.
    Use "dependencies" to understand what to import before using a module.`,
  inputSchema: z.object({
    target: z.string().describe('File path, function name, or module name'),
    direction: z.enum(['dependencies', 'dependents']).default('dependencies'),
    maxHops: z.number().min(1).max(4).default(2),
    groupByModule: z.boolean().default(true).describe(
      'If true, group results by module rather than listing individual files'
    ),
  }),
  execute: async ({ target, direction, maxHops, groupByModule }) => {
    return knowledgeGraph.getDependencies(target, { direction, maxHops, groupByModule });
  },
});

// ── DATA FLOW TRACING ─────────────────────────────────────────────────────────

export const traceDataFlowTool = tool({
  description: `Trace the flow of data from a source to a destination through the codebase.
    Use to understand: "Where does user input go?", "How does data reach the database?",
    "What transforms happen between the API and storage layer?"
    Returns the sequence of functions/files data passes through, with edge types.
    Requires the knowledge graph to have data flow edges (flows_to) — these accumulate
    as agents discover and register them. Early results may be incomplete.`,
  inputSchema: z.object({
    from: z.string().describe(
      'Data source: UI component, API endpoint, IPC handler. ' +
      'Example: "renderer/components/LoginForm.tsx", "api/auth/login"'
    ),
    to: z.string().describe(
      'Data destination: database function, external API call, file write. ' +
      'Example: "database/users.ts", "stripe/charge"'
    ),
    includeTransformations: z.boolean().default(true).describe(
      'If true, include intermediate nodes that transform the data'
    ),
  }),
  execute: async ({ from, to, includeTransformations }) => {
    return knowledgeGraph.traceDataFlow(from, to, { includeTransformations });
  },
});

// ── ARCHITECTURAL PATTERNS ────────────────────────────────────────────────────

export const getArchitecturalPatternsTool = tool({
  description: `Get the architectural patterns detected in a module or file.
    Returns patterns like: repository, event-bus, CQRS, facade, adapter, observer,
    factory, singleton, command, decorator, strategy.
    Patterns are detected by LLM analysis and accumulate over time.
    Use before adding to a module to understand its conventions.`,
  inputSchema: z.object({
    target: z.string().describe('Module name or file path'),
  }),
  execute: async ({ target }) => {
    return knowledgeGraph.getPatterns(target);
  },
});

// ── TEST COVERAGE GRAPH ───────────────────────────────────────────────────────

export const getTestCoverageTool = tool({
  description: `Find which test files cover a given source file, function, or module.
    Returns test files with coverage scope (unit/integration/e2e) and uncovered functions.
    Use before modifying code to know which tests to run.
    Also returns if any functions appear to have NO test coverage.`,
  inputSchema: z.object({
    target: z.string().describe('File path, function name, or module name'),
  }),
  execute: async ({ target }) => {
    return knowledgeGraph.getTestCoverage(target);
  },
});

// ── REGISTER DISCOVERED RELATIONSHIP ─────────────────────────────────────────

export const registerRelationshipTool = tool({
  description: `Register a structural or semantic relationship you discovered between two code elements.
    Use when you find: a non-obvious dependency, a data flow path, an invariant,
    or a pattern that is not captured by imports alone.
    These discoveries persist across sessions and help future agents.`,
  inputSchema: z.object({
    from: z.string().describe('File path or function/class name of the source'),
    to: z.string().describe('File path or function/class name of the target'),
    type: z.enum([
      'depends_logically', 'handles_errors_from', 'owns_data_for',
      'applies_pattern', 'flows_to', 'violates', 'is_entrypoint_for'
    ]).describe('The type of relationship'),
    description: z.string().describe(
      'Why this relationship exists — stored as edge metadata for future agents'
    ),
    confidence: z.number().min(0).max(1).default(0.7),
  }),
  execute: async ({ from, to, type, description, confidence }) => {
    await knowledgeGraph.addEdge({ from, to, type, description, confidence, source: 'agent' });
    return `Registered: ${from} --[${type}]--> ${to}. This relationship will be used in future impact analyses.`;
  },
});

// ── FIND BY DESCRIPTION ───────────────────────────────────────────────────────

export const findByDescriptionTool = tool({
  description: `Find code elements (files, functions, modules) matching a natural language description.
    Uses graph node labels and metadata for keyword matching.
    More accurate than grep for finding "where is the payment processing" type of questions.`,
  inputSchema: z.object({
    query: z.string().describe('Natural language description of what to find'),
    nodeTypes: z.array(z.enum([
      'file', 'function', 'class', 'interface', 'module', 'pattern'
    ])).optional().describe('Limit results to these node types'),
    limit: z.number().min(1).max(20).default(5),
  }),
  execute: async ({ query, nodeTypes, limit }) => {
    return knowledgeGraph.findByDescription(query, { nodeTypes, limit });
  },
});
```

### 5.2 Real Agent Query Examples with Output

**Query 1: "What does this function depend on?"**

```
Agent: getDependencies({ target: "auth/tokens.ts:verifyJwt", direction: "dependencies" })

Graph Response:
DEPENDENCIES OF: verifyJwt() [auth/tokens.ts:45]

DIRECT (1 hop):
  jsonwebtoken.verify()           [calls_external, package: jsonwebtoken]
  config/auth.ts:getJwtSecret()   [calls, verified]
  types/user.ts:UserPayload       [typed_as, inferred]

TRANSITIVE (2 hops via jsonwebtoken):
  [External package — no further traversal]

TRANSITIVE (2 hops via config/auth.ts):
  config/env.ts:getEnv()          [calls, inferred]

SUMMARY: verifyJwt() has 2 direct dependencies.
Both are internal — no external API calls except jsonwebtoken.
```

**Query 2: "What breaks if I change this?"**

```
Agent: analyzeImpact({ target: "auth/tokens.ts:verifyJwt", maxDepth: 3 })

Impact Analysis: verifyJwt() [auth/tokens.ts:45]

DIRECT CALLERS (1 hop, high confidence):
  middleware/auth.ts:authenticate()  [calls, weight: 0.9, verified]
  routes/auth.ts:refreshToken()      [calls, weight: 0.9, verified]
  tests/auth/jwt.test.ts             [tested_by, weight: 0.4]

INDIRECT (2 hops via authenticate()):
  routes/api.ts:applyAuthMiddleware  [calls, weight: 0.81, verified]
  routes/protected.ts:mountRoutes    [calls, weight: 0.81, verified]
  tests/auth/middleware.test.ts      [tested_by, weight: 0.36]

INDIRECT (3 hops via applyAuthMiddleware):
  app.ts:setupRoutes                 [calls, weight: 0.73, inferred]

ASSOCIATED MEMORIES (2 memories linked to verifyJwt):
  [INVARIANT] verifyJwt must check token expiry before signature validation
              Source: agent-session-abc, confidence: 0.9
  [GOTCHA] refresh token requests use a different secret key — not getJwtSecret()
           Source: observer_inferred, session-xyz, confidence: 0.8

TESTS TO RUN:
  tests/auth/jwt.test.ts         [covers verifyJwt directly]
  tests/auth/middleware.test.ts  [covers via authenticate()]

RISK ASSESSMENT: HIGH
Reasons:
  - 2 route handlers depend on this through auth middleware
  - app.ts startup depends on this (transitive)
  - Known invariant exists (must be preserved)
  - Known gotcha about refresh tokens (different secret)
```

**Query 3: "Where does user input flow?"**

```
Agent: traceDataFlow({
  from: "renderer/components/auth/LoginForm.tsx",
  to: "main/database/user-repository.ts"
})

Data Flow: LoginForm -> UserRepository

PATH FOUND (5 hops):
  LoginForm.tsx
    --[api_call / flows_to]--> main/ipc-handlers/auth-handlers.ts:handleLogin()
    --[calls / flows_to]-----> main/ai/security/validators.ts:validateCredentials()
    --[calls / flows_to]-----> main/auth/session-manager.ts:authenticateUser()
    --[calls / flows_to]-----> main/database/user-repository.ts:findByEmail()

EDGE SOURCES:
  LoginForm -> auth-handlers: agent-discovered (session-def, confidence: 0.85)
  auth-handlers -> validators: ast-extracted (verified)
  validators -> session-manager: ast-extracted (verified)
  session-manager -> findByEmail: ast-extracted (verified)

TRANSFORMATION POINTS:
  validators.ts: Input sanitization occurs here
  session-manager.ts: Password hash comparison occurs here — raw password does NOT reach DB

MISSING LINKS: None detected in this path.
```

**Query 4: "What pattern does this module use?"**

```
Agent: getArchitecturalPatterns({ target: "payments" })

Patterns for Module: payments

DETECTED PATTERNS:
  Repository Pattern (confidence: 0.92)
    Applied by: payments/stripe-client.ts, payments/payment-repository.ts
    Evidence: "PaymentRepository class with findById/save/delete methods"
    Detected: LLM analysis, session 2026-01-15

  Event Bus / Observer (confidence: 0.78)
    Applied by: payments/event-emitter.ts
    Evidence: "PaymentEventEmitter extends EventEmitter; events: payment.success, payment.failed"
    Detected: LLM analysis, session 2026-01-15

  Command Pattern (confidence: 0.65)
    Applied by: payments/commands/
    Evidence: "ProcessPaymentCommand, RefundCommand classes with execute() method"
    Detected: agent-discovered, session 2026-01-22

CONVENTIONS:
  - All external API calls go through stripe-client.ts (not called directly from handlers)
  - Events are emitted AFTER successful DB write, not before
  Source: agent-session-ghi, confidence: 0.88
```

### 5.3 Pre-Task Injection in the Orchestration Pipeline

Impact analysis is most valuable as a pre-task hook — injected automatically before the coder agent starts work, not requiring the agent to think to call it:

```typescript
// apps/frontend/src/main/ai/orchestration/pre-task-context.ts
export async function buildGraphEnrichedContext(
  task: AgentTask,
  moduleMap: ModuleMap,
  knowledgeGraph: KnowledgeGraph,
): Promise<string> {
  // Infer which files the task will likely touch (from task description + module map)
  const predictedFiles = await inferTargetFiles(task, moduleMap);

  if (predictedFiles.length === 0) return '';  // No graph enrichment if no targets

  // Run impact analysis for top 3 predicted files (more would exceed token budget)
  const analyses = await Promise.all(
    predictedFiles.slice(0, 3).map(f =>
      knowledgeGraph.analyzeImpact(f, { maxDepth: 2 })
    )
  );

  // Format as compact injection (budget: ~300-400 tokens)
  return formatCompactImpactContext(analyses);
}

function formatCompactImpactContext(analyses: ImpactAnalysis[]): string {
  const lines: string[] = ['## Change Impact Pre-Analysis'];

  for (const analysis of analyses) {
    if (analysis.estimatedRisk === 'low' && analysis.directDependents.length === 0) {
      lines.push(`${analysis.targetNode.label}: isolated, low risk`);
      continue;
    }

    lines.push(`\n### ${analysis.targetNode.label} [${analysis.estimatedRisk.toUpperCase()} RISK]`);

    if (analysis.directDependents.length > 0) {
      lines.push(`Callers/importers (${analysis.directDependents.length}): ${
        analysis.directDependents.slice(0, 4).map(n => n.label).join(', ')
      }`);
    }

    if (analysis.testFiles.length > 0) {
      lines.push(`Tests to run: ${analysis.testFiles.map(t => t.label).join(', ')}`);
    }

    // Include linked memories (max 2 per node, highest confidence first)
    const memories = analysis.associatedMemories.slice(0, 2);
    for (const m of memories) {
      lines.push(`[${m.type.toUpperCase()}] ${m.content.slice(0, 120)}`);
    }
  }

  return lines.join('\n');
}
```

This injection adds 200-400 tokens per task — well within the V3 T1 token budget — but prevents entire categories of regression bugs by surfacing callers, tests, and associated gotchas before the agent writes a single line of code.

---

## 6. Integration with the V3 Memory System

### 6.1 How the Graph Enriches Memory Retrieval

The knowledge graph improves memory retrieval in two ways:

**Structural expansion:** When retrieving memories for file `A`, also retrieve memories for files that `A` imports and that import `A`. This surfaces gotchas about modules you will inevitably touch — before you touch them.

```typescript
// In retrieval-engine.ts — graph-augmented file expansion
async function expandFilesViaGraph(
  relatedFiles: string[],
  knowledgeGraph: KnowledgeGraph,
): Promise<string[]> {
  const expanded = new Set(relatedFiles);

  for (const file of relatedFiles) {
    // Add direct imports (files this file depends on)
    const deps = await knowledgeGraph.getDirectNeighbors(file, 'imports', 'outgoing');
    deps.slice(0, 3).forEach(n => expanded.add(n.filePath ?? ''));

    // Add direct importers (files that use this file)
    const importers = await knowledgeGraph.getDirectNeighbors(file, 'imports', 'incoming');
    importers.slice(0, 2).forEach(n => expanded.add(n.filePath ?? ''));
  }

  return [...expanded].filter(Boolean);
}
```

**Impact-aware memory scoring:** When computing memory relevance scores, boost memories linked to nodes in the impact radius of the current target:

```typescript
// Modified scoring in retrieval-engine.ts
function scoreMemory(
  memory: Memory,
  context: RetrievalContext,
  impactNodeIds: Set<string>,  // NEW: nodes in impact radius
): number {
  let score = baseScore(memory, context);

  // Boost if this memory is linked to an impacted node
  if (memory.targetNodeId && impactNodeIds.has(memory.targetNodeId)) {
    score *= 1.5;
  }

  // Boost if this memory's impacted nodes overlap with current impact radius
  if (memory.impactedNodeIds?.some(id => impactNodeIds.has(id))) {
    score *= 1.3;
  }

  return Math.min(score, 1.0);
}
```

### 6.2 File Staleness Detection via the Graph

The graph's `stale_at` mechanism gives the memory system a better model of "is this module still structured as described?" than mtime alone:

```typescript
// When serving a module_insight or workflow_recipe memory:
async function isMemoryStillValid(memory: Memory): Promise<boolean> {
  if (!memory.relatedFiles || memory.relatedFiles.length === 0) return true;

  // Check if any of the related files have stale edges in the graph
  for (const filePath of memory.relatedFiles) {
    const fileNode = await knowledgeGraph.getNodeByFilePath(filePath);
    if (!fileNode) return false;  // File deleted
    if (fileNode.staleAt !== null) return false;  // File changed, graph not yet updated

    // Count stale edges connected to this file
    const staleEdgeCount = await knowledgeGraph.countStaleEdgesForFile(filePath);
    if (staleEdgeCount > 5) return false;  // Major restructuring detected
  }

  return true;
}
```

When a memory is determined to be stale, it receives `needsReview: true` and a lower relevance score rather than being immediately discarded. The agent may still see it but is warned that the code structure has changed.

### 6.3 Module Boundary Auto-Detection

One of the most expensive parts of the first-session setup is determining module boundaries. The V3 draft describes an LLM-powered semantic scan for this. The graph can bootstrap this with zero LLM calls:

**Algorithm: Louvain Community Detection on Import Graph**

Import edges form a graph. Modules are communities — groups of files that import each other densely but import the rest of the codebase sparsely. Louvain modularity optimization finds these communities automatically.

```typescript
// apps/frontend/src/main/ai/graph/analysis/community-detection.ts
export async function detectModuleBoundaries(
  db: GraphDatabase,
  projectId: string,
): Promise<ModuleBoundary[]> {
  // Load all import edges into adjacency list
  const edges = await db.getEdgesByType(projectId, 'imports');
  const adjacency = buildAdjacencyList(edges);

  // Louvain modularity optimization
  // We use a simplified version: iterative label propagation
  // Full Louvain is O(n log n) — acceptable for projects up to 10K files
  const communities = labelPropagation(adjacency, { iterations: 50 });

  // Map communities to module boundaries
  return communities.map(community => ({
    files: community.nodes.map(id => db.getNodeById(id).filePath),
    centroid: findCentroid(community, edges),  // Most-imported file in community
    externalImports: findExternalDependencies(community, edges),
    suggestedName: null,  // LLM names this in the semantic scan
  }));
}
```

This gives the semantic scan (and the user) a pre-computed community structure to name and label, rather than asking the LLM to guess boundaries from scratch. Combined, the graph-computed communities + LLM naming produces better module maps than LLM analysis alone, because the LLM only needs to name communities whose files it already knows, not discover them.

### 6.4 Cross-System Query: "Show memories about nodes in impact radius"

The linked-but-separate design enables a powerful compound query:

```typescript
// Executed as part of impact analysis enrichment:
async function getMemoriesForImpactRadius(
  targetNodeId: string,
  maxDepth: number,
  memoryService: MemoryService,
  knowledgeGraph: KnowledgeGraph,
): Promise<Memory[]> {
  // Step 1: Get all node IDs in impact radius (fast SQLite closure lookup)
  const impactedNodes = await knowledgeGraph.getImpactRadius(targetNodeId, maxDepth);
  const nodeIds = new Set([targetNodeId, ...impactedNodes.map(n => n.id)]);

  // Step 2: Fetch memories linked to any of these nodes
  // This is a SQL IN query on the targetNodeId column — indexed, fast
  const linkedMemories = await memoryService.getMemoriesForNodeIds([...nodeIds]);

  // Step 3: Also fetch file-based memories for the file paths of impacted nodes
  const filePaths = impactedNodes.map(n => n.filePath).filter(Boolean) as string[];
  const fileMemories = await memoryService.getMemoriesForFiles(filePaths, {
    types: ['gotcha', 'error_pattern', 'invariant', 'decision'],
    limit: 10,
  });

  // Merge, deduplicate, and sort by confidence
  return deduplicateAndRank([...linkedMemories, ...fileMemories]);
}
```

---

## 7. Performance and Scalability

### 7.1 Memory Budget in Electron

Electron's main process shares memory with the OS. On a developer's laptop with 16GB RAM, a reasonable budget:

| Component | Memory Budget |
|---|---|
| SQLite in-memory cache (WAL mode) | 50-100MB |
| tree-sitter WASM runtime | 30-50MB |
| Loaded grammars (4 default) | 30-60MB |
| Graph query result buffers | 10-20MB |
| **Total graph system budget** | **120-230MB** |

This is acceptable. VS Code uses 400-800MB for language server processes that provide similar structural intelligence.

**Optimization: Lazy grammar loading.** Do not load all 4 grammars at startup. Detect languages present in the project (scan file extensions), then load only needed grammars. A pure TypeScript project only needs the TypeScript grammar (~15MB).

**Optimization: Closure table size management.** For the closure table, limit to 3-hop depth in the default configuration. At 3 hops, the table size is bounded by O(n * avg_fan_in^3) — manageable for most projects. For large monorepos, set depth limit to 2 and use lazy CTE for deeper queries.

### 7.2 Query Latency Targets

All agent-facing queries must complete in under 100ms to avoid breaking the agent's execution flow:

| Query Type | Target Latency | Implementation |
|---|---|---|
| Direct neighbors (1 hop) | < 2ms | Indexed edge lookup |
| Impact radius (3 hops) | < 15ms | Closure table join |
| File-level import graph | < 5ms | Indexed edge scan |
| Pattern lookup for module | < 5ms | Node type + label index |
| Test coverage for function | < 10ms | tested_by edge lookup |
| Data flow path (any→any) | < 50ms | Bidirectional BFS on edges |
| Find by description (keyword) | < 20ms | FTS5 on node labels |
| Find by description (semantic) | < 50ms | sqlite-vec nearest neighbor |

**Achieving these targets:**
- All queries filter by `stale_at IS NULL` using partial indexes (already defined in schema)
- Closure table handles all multi-hop traversals
- Node label FTS5 virtual table for keyword search:

```sql
CREATE VIRTUAL TABLE graph_nodes_fts USING fts5(
  label, metadata,    -- Searchable columns
  content='graph_nodes',
  content_rowid='rowid'
);
-- Trigger to keep FTS in sync
CREATE TRIGGER graph_nodes_fts_insert AFTER INSERT ON graph_nodes BEGIN
  INSERT INTO graph_nodes_fts(rowid, label, metadata) VALUES (new.rowid, new.label, new.metadata);
END;
```

### 7.3 Background Indexing Strategy

Cold-start indexing runs in a background worker thread with a priority queue:

```typescript
// Priority order for initial indexing:
const INDEXING_PRIORITY = [
  // 1. Files in the current task's target module (immediate need)
  'task_target_files',
  // 2. Entry points (package.json main, src/index.ts, src/main.ts)
  'entry_points',
  // 3. Files modified in the last 30 git commits (recent = likely to be touched)
  'recently_modified',
  // 4. Files with the most imports (hubs — high impact)
  'most_imported',
  // 5. Remaining files in alphabetical order
  'remaining',
];
```

**Progressive disclosure to agents:** The graph is queryable from the moment the first batch of files is indexed. Agents that start working while indexing is in progress will see partial results — clearly marked as "indexing in progress, results may be incomplete." The graph transitions from incomplete to complete silently as indexing finishes.

**Background indexing does not block:** The worker thread runs at `nice` priority (or equivalent on Windows). File reads during indexing go through Node.js async fs APIs. The Electron main thread is never touched.

### 7.4 Storage Scalability and the SQLite vs. Kuzu Decision

**When SQLite is sufficient (V1 and V2):**

For the vast majority of Auto Claude users — projects under 2,000 files, single-language or dual-language codebases — SQLite with closure tables is sufficient:

- Impact queries complete in < 15ms
- Closure table size stays under 200MB
- WAL mode SQLite handles concurrent reads (agent queries) and writes (indexer) without contention

**When to consider Kuzu migration (V3+ scope):**

| Signal | Threshold | Action |
|---|---|---|
| Node count | > 50,000 | Profile closure table query times |
| Closure table size | > 500MB | Reduce depth limit to 2, profile impact |
| P99 query latency | > 100ms | Evaluate Kuzu migration |
| Multi-project workspace | > 3 active projects | Consider Kuzu for shared graph |

**Kuzu migration path:**

Kuzu 0.8.x has full Node.js support and native Electron compatibility (native binary, no WASM needed for the main process). The migration path:

1. Export SQLite graph tables to CSV: `graph_nodes.csv`, `graph_edges.csv`
2. Import to Kuzu using its COPY FROM CSV command
3. Replace SQLite query functions with equivalent Cypher queries
4. Remove closure table (Kuzu handles multi-hop natively with Cypher)

The agent tool interface (`analyzeImpactTool`, etc.) does not change — storage is an implementation detail.

**Kuzu bundle size impact:** The `kuzu` npm package is 35-60MB (native binaries). This is significant but acceptable for users with 50K+ node codebases who have already opted into a premium indexing experience. Ship as an optional dependency that is activated automatically when the node count threshold is crossed.

---

## 8. Phased Implementation Plan

This plan is additive — it does not block V3 memory system work. Graph phases run in parallel with memory system development.

### Phase 1: File-Level Import Graph (Foundation)
**Target: 4-6 weeks | No new npm dependencies (uses regex for import parsing)**

**What gets built:**
- SQLite schema: `graph_nodes`, `graph_edges`, `graph_closure`, `graph_index_state`
- Regex-based import extractor (fast, no grammar loading): parse `import from 'X'` and `require('X')` via regex across TypeScript, Python, Go, Rust
- File-level nodes and `imports` edges
- Closure table with incremental maintenance (SQLite triggers)
- File watcher integration (uses existing chokidar dependency) for `stale_at` updates
- Impact radius query via closure table
- IPC handlers: `graph:analyzeImpact`, `graph:getDependencies`
- Agent tools: `analyzeImpactTool`, `getDependenciesTool`
- Pre-task injection hook in `orchestration/pre-task-context.ts`
- Test-to-source mapping via file path heuristics (files in `tests/auth/` map to nodes in `src/auth/`)

**What agents can do at end of Phase 1:**
- Get instant file-level impact analysis before any modification
- Understand which test files cover a target module
- Navigate module boundaries via import graph

**Accuracy:** File-level only, no function-level resolution. Import edges from regex may include false positives (commented-out imports, string templates). Accuracy: ~85-90%.

---

### Phase 2: tree-sitter Structural Extraction
**Target: 3-4 weeks | New: `web-tree-sitter` + grammar WASM files (~25MB)**

**What gets built:**
- `TreeSitterLoader` with dev/prod WASM path resolution
- Grammar loading for TypeScript, JavaScript, Python, Rust, Go (5 default languages)
- Extraction pipeline: function definitions, class definitions, interface definitions
- Function-level `calls` edges (name-based, not type-resolved)
- `defined_in` edges (symbol → file)
- `childof` edges (method → class)
- `extends` and `implements` edges (class → superclass / interface)
- Upgrade Phase 1 import edges from regex to tree-sitter (more accurate)
- Incremental re-parse triggered by file watcher (tree-sitter's incremental update)
- Language auto-detection from file extensions
- Multi-language support: each language uses its own grammar and query set

**What agents can do at end of Phase 2:**
- Function-level impact analysis (which functions call `verifyJwt`, not just which files)
- Class hierarchy traversal (what implements Interface X)
- Multi-language project support (TypeScript frontend + Python backend)

**Accuracy:** Function call names resolved by node label matching within the same file or same module (heuristic). Cross-module symbol resolution without type information: ~70-80% for TypeScript (common name collisions), ~85-90% for Python and Go.

---

### Phase 3: Semantic Layer and Pattern Detection
**Target: 3-4 weeks | No new dependencies**

**What gets built:**
- LLM-powered module boundary classification (replaces community detection heuristic or validates it)
- Architectural pattern detection via LLM analysis of module subgraphs
- `applies_pattern` edges with pattern nodes
- `is_entrypoint_for` and `handles_errors_from` edges from LLM analysis
- `depends_logically` edges from LLM-detected soft dependencies
- Background pattern refresh job (trigger conditions from V3 design)
- `getArchitecturalPatternsTool` agent tool
- Module summary generation feeding into ModuleMap (replaces Phase 1 LLM semantic scan)
- Co-access graph bootstrap from `git log` history

**What agents can do at end of Phase 3:**
- "What pattern does the payments module use?" → repository + event bus + command
- "What logically depends on the auth module?" (beyond imports)
- Module map is graph-derived, not LLM-from-scratch

---

### Phase 4: TypeScript Compiler Integration (Optional Enhancement)
**Target: 4-6 weeks | New: `ts-morph` (~2MB, uses project's existing TypeScript compiler)**

**What gets built:**
- TypeScript Compiler API call graph extractor (via ts-morph)
- Type-resolved symbol imports (upgrades Phase 2 heuristic edges to verified)
- `typed_as` edges for variable and expression types
- `overrides` edges (method → overridden method in superclass)
- `instantiates` edges (constructor calls)
- Upgrade Phase 2 function call edges from name-based to type-resolved
- SCIP symbol ID integration (optional: run `scip-typescript` as subprocess for precise cross-references)

**What agents can do at end of Phase 4:**
- Fully type-resolved call graph ("this `validateToken()` call refers to the one in auth/tokens.ts, not the test stub")
- Impact analysis accurate at signature level
- Full TypeScript project analysis with VS Code-level cross-reference quality

**Why this is Phase 4, not Phase 2:** ts-morph requires running the TypeScript compiler with full type checking. For large TypeScript projects, this is a 5-30 second startup cost per indexing run. Phase 2's tree-sitter approach is faster for cold start and sufficient for most use cases. Phase 4 upgrades accuracy but is not required for core value delivery.

---

### Phase 5: Data Flow Tracing
**Target: 4-6 weeks | No new dependencies**

**What gets built:**
- Data flow annotation tool for agents (`traceDataFlowTool`)
- Persistence of agent-discovered `flows_to` edges
- Automatic heuristic data flow detection (function argument tracing within single function bodies, using tree-sitter)
- Data source/sink annotation (agents and users can tag a node as "data source" or "data sink")
- `traceDataFlowTool` agent tool
- Security-focused query: "where does user input reach without validation?"

**Note:** Full interprocedural data flow analysis (CodeQL-style taint tracking) remains out of scope. Phase 5 provides shallow data flow tracing: direct argument passing and explicit `flows_to` edges registered by agents. This answers 80% of the questions agents ask about data flow, without the complexity of full taint analysis.

---

## 9. TypeScript Interfaces and Code Examples

### 9.1 Complete KnowledgeGraph Service Interface

```typescript
// apps/frontend/src/main/ai/graph/knowledge-graph.ts

export interface ImpactAnalysis {
  targetNode: GraphNode;
  directDependents: ImpactNode[];    // 1-hop dependents
  transitiveDependents: ImpactNode[]; // 2+ hop dependents
  testFiles: GraphNode[];             // tested_by edges
  associatedMemories: Memory[];       // memories linked to impacted nodes
  invariants: Memory[];               // invariant memories for target
  estimatedRisk: 'low' | 'medium' | 'high' | 'critical';
  riskReasons: string[];
}

export interface ImpactNode {
  node: GraphNode;
  depth: number;          // Hop count from target
  edgePath: GraphEdge[];  // Edges traversed to reach this node
  impactWeight: number;   // Product of edge weights along path (0.0-1.0)
}

export interface DataFlowPath {
  found: boolean;
  path: GraphNode[];           // Sequence of nodes from source to sink
  edges: GraphEdge[];          // Edges connecting the nodes
  transformationPoints: GraphNode[]; // Nodes where data is modified
  confidence: number;
  warnings: string[];          // e.g., "path may be incomplete — some edges are agent-inferred"
}

export interface DependencyResult {
  target: GraphNode;
  direct: GraphNode[];
  transitive: GraphNode[];
  byModule?: Record<string, GraphNode[]>;  // Grouped by module when groupByModule=true
}

// Edge impact weights for blast radius scoring
export const EDGE_IMPACT_WEIGHTS: Record<string, number> = {
  // High impact: signature changes break callers
  calls:        0.90,
  implements:   0.88,
  extends:      0.87,
  overrides:    0.85,
  instantiates: 0.80,
  // Medium impact: dependency exists but may not use changed symbol
  imports:      0.65,
  imports_symbol: 0.80,  // Higher: specific symbol imported is definitely used
  flows_to:     0.75,
  depends_logically: 0.70,
  is_entrypoint_for: 0.80,
  // Lower impact: less direct connection
  handles_errors_from: 0.50,
  tested_by:    0.40,  // Tests are impact-aware, not impact-broken
  childof:      0.30,  // Child of class — structural, not behavioral
  applies_pattern: 0.25,
};

export class KnowledgeGraph {
  constructor(
    private db: GraphDatabase,
    private memoryService: MemoryService,
  ) {}

  async analyzeImpact(target: string, options: {
    maxDepth?: number;
    edgeFilter?: string[];
  } = {}): Promise<ImpactAnalysis> {
    const { maxDepth = 3, edgeFilter } = options;

    // Resolve target string to node ID
    const targetNode = await this.resolveTarget(target);
    if (!targetNode) throw new Error(`Target not found: ${target}`);

    // O(1) closure table lookup — returns all dependents within maxDepth hops
    const closureRows = await this.db.queryAll<{
      descendant_id: string;
      depth: number;
      path: string;
      edge_types: string;
      total_weight: number;
    }>(`
      SELECT gc.descendant_id, gc.depth, gc.path, gc.edge_types, gc.total_weight
      FROM graph_closure gc
      JOIN graph_nodes gn ON gc.descendant_id = gn.id
      WHERE gc.ancestor_id = ?
        AND gc.depth <= ?
        AND gn.stale_at IS NULL
      ORDER BY gc.depth ASC, gc.total_weight DESC
    `, [targetNode.id, maxDepth]);

    // Load full node data for all impacted nodes
    const impactNodes: ImpactNode[] = await Promise.all(
      closureRows.map(async (row) => {
        const node = await this.db.getNode(row.descendant_id);
        return {
          node,
          depth: row.depth,
          edgePath: JSON.parse(row.path),
          impactWeight: row.total_weight,
        };
      })
    );

    // Separate direct (depth=1) from transitive (depth>1)
    const direct = impactNodes.filter(n => n.depth === 1);
    const transitive = impactNodes.filter(n => n.depth > 1);

    // Extract test files
    const testFiles = impactNodes
      .filter(n => n.node.type === 'file' &&
        (n.node.filePath?.includes('.test.') || n.node.filePath?.includes('/tests/')))
      .map(n => n.node);

    // Fetch associated memories for all impacted node IDs
    const allNodeIds = [targetNode.id, ...impactNodes.map(n => n.node.id)];
    const associatedMemories = await this.memoryService.getMemoriesForNodeIds(allNodeIds);
    const invariants = associatedMemories.filter(m => m.type === 'invariant');

    // Compute risk score
    const { risk, reasons } = this.computeRisk(targetNode, direct, transitive, invariants);

    return {
      targetNode,
      directDependents: direct,
      transitiveDependents: transitive,
      testFiles,
      associatedMemories,
      invariants,
      estimatedRisk: risk,
      riskReasons: reasons,
    };
  }

  private computeRisk(
    target: GraphNode,
    direct: ImpactNode[],
    transitive: ImpactNode[],
    invariants: Memory[],
  ): { risk: 'low' | 'medium' | 'high' | 'critical'; reasons: string[] } {
    const reasons: string[] = [];
    let score = 0;

    if (direct.length > 5) { score += 3; reasons.push(`${direct.length} direct dependents`); }
    else if (direct.length > 2) { score += 2; reasons.push(`${direct.length} direct dependents`); }
    else if (direct.length > 0) { score += 1; }

    if (transitive.length > 20) { score += 2; reasons.push(`${transitive.length} transitive dependents`); }
    else if (transitive.length > 5) { score += 1; }

    if (invariants.length > 0) {
      score += 2;
      reasons.push(`${invariants.length} behavioral invariant(s) must be preserved`);
    }

    // Entry points are always high risk
    if (target.type === 'file' && target.metadata?.isEntryPoint) {
      score += 3;
      reasons.push('entry point — changes affect all dependents');
    }

    const risk = score >= 6 ? 'critical' : score >= 4 ? 'high' : score >= 2 ? 'medium' : 'low';
    return { risk, reasons };
  }

  // ... additional methods for getDependencies(), traceDataFlow(), etc.
}
```

### 9.2 Closure Table Maintenance Triggers

The closure table must be maintained atomically with edge insertions and deletions:

```sql
-- After inserting an edge A -> B, update closure to include:
-- 1. The direct edge: (A, B, depth=1)
-- 2. All (X, B, depth+1) where X is an ancestor of A (X->A already in closure)
-- 3. All (A, Y, depth+1) where Y is a descendant of B (B->Y already in closure)

CREATE TRIGGER gc_insert_edge AFTER INSERT ON graph_edges
WHEN new.stale_at IS NULL
BEGIN
  -- Direct edge
  INSERT OR REPLACE INTO graph_closure
    (ancestor_id, descendant_id, depth, path, edge_types, total_weight)
  VALUES
    (new.from_id, new.to_id, 1,
     json_array(new.from_id, new.to_id),
     json_array(new.type),
     new.weight * new.confidence);

  -- Extend upward: all nodes that reach from_id now also reach to_id
  INSERT OR IGNORE INTO graph_closure
    (ancestor_id, descendant_id, depth, path, edge_types, total_weight)
  SELECT
    gc_up.ancestor_id,
    new.to_id,
    gc_up.depth + 1,
    json_patch(gc_up.path, json_array(new.to_id)),
    json_patch(gc_up.edge_types, json_array(new.type)),
    gc_up.total_weight * new.weight * new.confidence
  FROM graph_closure gc_up
  WHERE gc_up.descendant_id = new.from_id
    AND gc_up.depth < 4;  -- Cap at depth 4 to bound closure size

  -- Extend downward: from_id now reaches all nodes reachable from to_id
  INSERT OR IGNORE INTO graph_closure
    (ancestor_id, descendant_id, depth, path, edge_types, total_weight)
  SELECT
    new.from_id,
    gc_down.descendant_id,
    gc_down.depth + 1,
    json_array(new.from_id, gc_down.descendant_id),
    json_patch(json_array(new.type), gc_down.edge_types),
    new.weight * new.confidence * gc_down.total_weight
  FROM graph_closure gc_down
  WHERE gc_down.ancestor_id = new.to_id
    AND gc_down.depth < 4;
END;

-- After marking an edge stale, invalidate dependent closure entries
CREATE TRIGGER gc_stale_edge AFTER UPDATE ON graph_edges
WHEN new.stale_at IS NOT NULL AND old.stale_at IS NULL
BEGIN
  -- Mark all closure entries that traversed this edge as stale
  -- Simple approach: remove closure entries for the from/to nodes and rebuild
  DELETE FROM graph_closure
  WHERE (ancestor_id = old.from_id AND depth <= 4)
     OR (descendant_id = old.to_id AND depth <= 4);
  -- Rebuild will be triggered by indexer after re-extraction
END;
```

### 9.3 Incremental Closure Rebuild

When a file is re-indexed after a change, rebuild only the closure entries affected:

```typescript
// After re-indexing a file and upserting its new edges:
async function rebuildClosureForFile(
  filePath: string,
  db: GraphDatabase,
): Promise<void> {
  const fileNode = await db.getNodeByFilePath(filePath);
  if (!fileNode) return;

  // Delete all closure entries where this node is an intermediate
  // (These are stale because edges from/to this node changed)
  await db.run(`
    DELETE FROM graph_closure
    WHERE ancestor_id = ? OR descendant_id = ?
  `, [fileNode.id, fileNode.id]);

  // Re-insert direct edges (triggers handle transitive expansion)
  const edges = await db.getEdgesForNode(fileNode.id);
  for (const edge of edges) {
    if (edge.staleAt === null) {
      // Re-insert triggers gc_insert_edge, which rebuilds transitive closure
      await db.run(`UPDATE graph_edges SET updated_at = ? WHERE id = ?`,
        [Date.now(), edge.id]);
    }
  }
}
```

---

## 10. Recommendations for V4

Based on the research conducted for this document, the following capabilities represent the most valuable V4 investments:

### 10.1 Tighter SCIP Integration

Run `scip-typescript` as a project-level background process (subprocess spawned once at project open). Parse the SCIP protobuf output and store in the `scip_symbols` table. This gives us VS Code-quality go-to-definition data for TypeScript projects without implementing the full TypeScript Compiler API ourselves.

Priority: High. SCIP indexing for a typical TypeScript project completes in 10-30 seconds (not 5+ minutes like full TypeScript compiler type checking). The `scip-typescript` package is maintained by Sourcegraph and is production-quality.

### 10.2 Cross-Language Symbol Resolution

For projects with TypeScript frontend + Python backend communicating via IPC/REST, build cross-language edges. An IPC call in TypeScript (`ipcMain.handle('auth:login', ...)`) corresponds to a handler in the same TypeScript codebase, but in a Python-backed architecture it corresponds to a Python function. Detecting these cross-language links requires pattern matching on IPC event names — achievable with tree-sitter queries + a simple event name registry.

Priority: Medium. This is high-value for Auto Claude specifically (Electron app with TypeScript + Python), but complex to implement correctly.

### 10.3 Kuzu Migration Tooling

Build a structured migration path from SQLite to Kuzu with:
- Automatic trigger: when graph exceeds 50K nodes, prompt user to upgrade
- One-click migration: export, import, validate, switch
- Rollback path: keep SQLite backup for 7 days after migration

Priority: Medium. Most projects will not reach 50K nodes. But for power users with large monorepos, this is a significant quality-of-life upgrade.

### 10.4 Agent-Learned Invariants from Test Assertions

When QA agents observe test assertions (especially property-based tests and invariant tests), automatically extract and store them as `invariant` type memories with graph node links. Example:

```typescript
// A test assertion like:
expect(verifyJwt(token)).toHaveProperty('exp');
// Would produce invariant: "verifyJwt() return value must have 'exp' field"
// Linked to: graph node for verifyJwt()
```

This makes the invariant system self-populating from the existing test suite rather than requiring agents to explicitly register invariants.

Priority: High for quality. The correctness guarantees this enables are significant.

### 10.5 Full Interprocedural Data Flow (Long-Term)

Full CodeQL-style taint analysis for "does user input reach a SQL query?" is a V4+ investment. It requires:
- Complete function-level call graph (Phase 4)
- SSA-form data flow within each function body
- Interprocedural linking via call edges

This is 6-12 months of engineering work for a correct implementation. The V3 approach (agent-discovered `flows_to` edges + heuristic argument tracing) covers 80% of use cases with 20% of the implementation complexity. Full taint analysis is the right long-term investment for security-focused users.

---

## Sources

**tree-sitter WASM and Electron integration:**
- [web-tree-sitter on npm](https://www.npmjs.com/package/web-tree-sitter)
- [tree-sitter WASM bundling guide](https://github.com/tree-sitter/tree-sitter/blob/master/lib/binding_web/README.md)
- [Incremental Parsing with tree-sitter — Strumenta](https://tomassetti.me/incremental-parsing-using-tree-sitter/)
- [tree-sitter query syntax documentation](https://tree-sitter.github.io/tree-sitter/using-parsers/queries/1-syntax.html)
- [tree-sitter TypeScript grammar](https://github.com/tree-sitter/tree-sitter-typescript)
- [tree-sitter Rust grammar](https://github.com/tree-sitter/tree-sitter-rust)
- [AST Parsing with tree-sitter — Dropstone Research](https://www.dropstone.io/blog/ast-parsing-tree-sitter-40-languages)

**Sourcegraph SCIP:**
- [SCIP GitHub repository](https://github.com/sourcegraph/scip)
- [Announcing SCIP — Sourcegraph Blog](https://sourcegraph.com/blog/announcing-scip)
- [Precise code navigation — Sourcegraph docs](https://docs.sourcegraph.com/code_intelligence/explanations/precise_code_intelligence)

**Meta Glean:**
- [Glean open source code indexing — Meta Engineering](https://engineering.fb.com/2024/12/19/developer-tools/glean-open-source-code-indexing/)

**Google Kythe:**
- [Kythe schema reference](https://kythe.io/docs/schema/)
- [Kythe overview](https://kythe.io/docs/kythe-overview.html)

**Kuzu embedded graph database:**
- [Kuzu GitHub](https://github.com/kuzudb/kuzu)
- [Embedded DB comparison — The Data Quarry](https://thedataquarry.com/blog/embedded-db-2/)
- [Kuzu fast graph database — brightcoding.dev](https://www.blog.brightcoding.dev/2025/09/24/kuzu-the-embedded-graph-database-for-fast-scalable-analytics-and-seamless-integration/)

**Cursor codebase indexing:**
- [How Cursor indexes codebases — Towards Data Science](https://towardsdatascience.com/how-cursor-actually-indexes-your-codebase/)
- [How Cursor Indexes Codebases Fast — Engineer's Codex](https://read.engineerscodex.com/p/how-cursor-indexes-codebases-fast)

**Code knowledge graphs:**
- [Code-Graph-RAG on GitHub](https://github.com/vitali87/code-graph-rag)
- [Knowledge Graph Based Repository-Level Code Generation](https://arxiv.org/html/2505.14394v1)
- [GraphRAG for Devs — Memgraph](https://memgraph.com/blog/graphrag-for-devs-coding-assistant)

**ts-morph TypeScript AST:**
- [ts-morph GitHub](https://github.com/dsherret/ts-morph)
- [ts-morph AST traversal guide](https://ts-morph.com/navigation/)
- [ts-morph performance documentation](https://ts-morph.com/manipulation/performance)

**SQLite graph patterns:**
- [SQLite recursive CTEs](https://sqlite.org/lang_with.html)
- [Closure table patterns — Charles Leifer](https://charlesleifer.com/blog/querying-tree-structures-in-sqlite-using-python-and-the-transitive-closure-extension/)
- [Simple graph in SQLite](https://github.com/dpapathanasiou/simple-graph)

**Semgrep:**
- [Semgrep static analysis journey](https://semgrep.dev/blog/2021/semgrep-a-static-analysis-journey/)
- [Semgrep GitHub](https://github.com/semgrep/semgrep)

**VS Code Language Server Protocol:**
- [VS Code Language Server Extension Guide](https://code.visualstudio.com/api/language-extensions/language-server-extension-guide)
- [LSP Specification 3.17](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/)

**Impact analysis concepts:**
- [Blast Radius — blast-radius.dev](https://blast-radius.dev/)
- [Understanding blast radius — DevCookies](https://devcookies.medium.com/understanding-blast-radius-in-software-development-system-design-0d994aff5060)
