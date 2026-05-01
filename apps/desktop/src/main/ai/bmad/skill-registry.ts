/**
 * Skill registry
 * ==============
 *
 * Loads any installed BMAD skill into a typed `BmadSkill`:
 *   - parses `SKILL.md` YAML frontmatter (`name`, `description`, plus extras)
 *   - captures the markdown body
 *   - enumerates step files in `steps/`, `steps-c/`, `steps-e/`, `steps-v/`
 *   - parses `customize.toml` defaults
 *   - resolves the three-layer customization tree for the active project
 *
 * Caches per-skill in memory; the file watcher (`file-watcher.ts`) calls
 * `invalidate(skillId)` on `customization-changed` / `skill-changed` events.
 *
 * Per ENGINE_SWAP_PROMPT.md KAD-4 (workflow execution is generic; skill files
 * fully describe behavior) + BMAD docs § "How Skills Are Generated" +
 * § "Where Skill Files Live".
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { JSON_SCHEMA, load as parseYaml } from 'js-yaml';

import {
  BMAD_STEP_CATEGORIES,
  type BmadSkill,
  type BmadSkillFrontmatter,
  type BmadSkillKind,
  type BmadSkillManifestEntry,
  type BmadStepFile,
} from '../../../shared/types/bmad';
import { resolveCustomization } from './customization-resolver';
import { loadSkillManifest } from './manifest-loader';

// =============================================================================
// Errors
// =============================================================================

export class SkillRegistryError extends Error {
  readonly code:
    | 'SKILL_NOT_FOUND'
    | 'SKILL_PARSE_ERROR'
    | 'IO_ERROR';
  readonly cause?: unknown;
  readonly details?: unknown;

  constructor(
    code: SkillRegistryError['code'],
    message: string,
    options?: { cause?: unknown; details?: unknown },
  ) {
    super(message);
    this.name = 'SkillRegistryError';
    this.code = code;
    if (options?.cause !== undefined) this.cause = options.cause;
    if (options?.details !== undefined) this.details = options.details;
  }
}

// =============================================================================
// Public API
// =============================================================================

export interface SkillRegistryOptions {
  /** Absolute path to the project root (the directory containing `_bmad/`). */
  readonly projectRoot: string;
  /**
   * If true, skip resolution of three-layer customization (just return
   * `customizationDefaults`). Useful when the renderer only wants the
   * skill's body and step list.
   */
  readonly skipCustomizationResolve?: boolean;
}

/**
 * In-memory skill cache. Keyed by `${projectRoot}::${skillId}` so multi-project
 * scenarios don't collide. Public methods are async to keep the interface
 * uniform — the cache hit path is still `Promise.resolve(cached)`.
 */
export class SkillRegistry {
  private readonly cache = new Map<string, BmadSkill>();

  /**
   * Resolve a single skill by canonical id. Reads the skill-manifest to find
   * the path, then loads + parses + resolves customization.
   */
  async load(skillId: string, options: SkillRegistryOptions): Promise<BmadSkill> {
    const cacheKey = makeCacheKey(options.projectRoot, skillId);
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const manifest = await loadSkillManifest(options.projectRoot);
    const entry = manifest.find((m) => m.canonicalId === skillId);
    if (!entry) {
      throw new SkillRegistryError(
        'SKILL_NOT_FOUND',
        `skill '${skillId}' not present in skill-manifest.csv`,
      );
    }

    const skill = await loadSkillFromEntry(entry, options);
    this.cache.set(cacheKey, skill);
    return skill;
  }

  /**
   * Load every skill in the install. Used by the dev debug command + Phase 5
   * Customization Panel.
   */
  async loadAll(options: SkillRegistryOptions): Promise<readonly BmadSkill[]> {
    const manifest = await loadSkillManifest(options.projectRoot);
    const results: BmadSkill[] = [];
    for (const entry of manifest) {
      const cacheKey = makeCacheKey(options.projectRoot, entry.canonicalId);
      let skill = this.cache.get(cacheKey);
      if (!skill) {
        skill = await loadSkillFromEntry(entry, options);
        this.cache.set(cacheKey, skill);
      }
      results.push(skill);
    }
    return results;
  }

  /**
   * Drop a single skill from the cache. Called by the file watcher on
   * `customization-changed` (project-root-scoped) or `skill-changed`.
   */
  invalidate(projectRoot: string, skillId: string): void {
    this.cache.delete(makeCacheKey(projectRoot, skillId));
  }

  /** Drop every entry for a project root. Called on `manifest-changed`. */
  invalidateProject(projectRoot: string): void {
    const prefix = `${path.resolve(projectRoot)}::`;
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(prefix)) this.cache.delete(key);
    }
  }

  /** Drop everything. Used by tests. */
  clear(): void {
    this.cache.clear();
  }

  /** Cache stats for diagnostics. */
  getStats(): { entries: number; keys: string[] } {
    return { entries: this.cache.size, keys: [...this.cache.keys()] };
  }
}

// Singleton — cheap to share across IPC handlers in the main process.
let sharedRegistry: SkillRegistry | undefined;
export function getSharedSkillRegistry(): SkillRegistry {
  if (!sharedRegistry) sharedRegistry = new SkillRegistry();
  return sharedRegistry;
}

// =============================================================================
// Internal — the loading pipeline
// =============================================================================

async function loadSkillFromEntry(
  entry: BmadSkillManifestEntry,
  options: SkillRegistryOptions,
): Promise<BmadSkill> {
  const projectRoot = path.resolve(options.projectRoot);
  const manifestPath = path.resolve(projectRoot, entry.path);
  const skillDir = path.dirname(manifestPath);

  let raw: string;
  try {
    raw = await fs.readFile(manifestPath, 'utf-8');
  } catch (err) {
    throw new SkillRegistryError(
      'IO_ERROR',
      `failed to read SKILL.md at ${manifestPath}: ${(err as Error).message}`,
      { cause: err },
    );
  }

  const { frontmatter, body } = parseSkillMarkdown(raw, manifestPath);
  const stepFiles = await enumerateStepFiles(skillDir);

  const customizationDefaults = await readCustomizationDefaults(skillDir);
  let customizationResolved: Readonly<Record<string, unknown>> | null = null;
  if (!options.skipCustomizationResolve && customizationDefaults) {
    try {
      customizationResolved = await resolveCustomization({
        skillDir,
        projectRoot,
      });
    } catch (err) {
      // Resolver throws when defaults are missing. We already verified above
      // by reading customizationDefaults, so this only fires on a corrupt
      // override file. Surface the parse error rather than swallowing.
      throw new SkillRegistryError(
        'SKILL_PARSE_ERROR',
        `failed to resolve customization for ${entry.canonicalId}: ${(err as Error).message}`,
        { cause: err },
      );
    }
  }

  const kind = classifySkill(entry);

  return {
    canonicalId: entry.canonicalId,
    module: entry.module,
    skillDir,
    manifestPath,
    kind,
    frontmatter,
    body,
    stepFiles,
    customizationDefaults,
    customizationResolved,
  };
}

/**
 * Classify a skill into agent / workflow / task. Heuristics:
 *   - id starts with `bmad-agent-` → agent (loads a persona)
 *   - in module 'core' and is a "task" per docs § "Skill Categories" → task
 *   - everything else → workflow
 *
 * The classification isn't carried in skill-manifest.csv, so we derive it from
 * the canonical id pattern. The result is mostly informational — the
 * orchestrator routes by `bmad-help.csv` row, not by skill kind.
 */
function classifySkill(entry: BmadSkillManifestEntry): BmadSkillKind {
  if (entry.canonicalId.startsWith('bmad-agent-')) return 'agent';
  if (entry.module === 'core') {
    // Core has both workflows (brainstorming, party-mode) and tasks (help,
    // distillator, editorial-*, review-*, shard-doc, index-docs, customize).
    const TASK_IDS = new Set([
      'bmad-help',
      'bmad-customize',
      'bmad-distillator',
      'bmad-advanced-elicitation',
      'bmad-review-adversarial-general',
      'bmad-review-edge-case-hunter',
      'bmad-editorial-review-prose',
      'bmad-editorial-review-structure',
      'bmad-shard-doc',
      'bmad-index-docs',
    ]);
    return TASK_IDS.has(entry.canonicalId) ? 'task' : 'workflow';
  }
  return 'workflow';
}

/**
 * Parse a SKILL.md file. Frontmatter is YAML between leading `---` lines per
 * BMAD docs § "How Skills Are Generated"; body is everything after the closing
 * `---`. Skills without frontmatter are tolerated (we'd rather show them in
 * the UI with empty frontmatter than 500 the registry).
 */
export function parseSkillMarkdown(
  raw: string,
  sourcePath: string,
): { frontmatter: BmadSkillFrontmatter; body: string } {
  const FRONTMATTER_RE = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/;
  const match = raw.match(FRONTMATTER_RE);

  if (!match) {
    return {
      frontmatter: { name: '', description: '', extra: {} },
      body: raw,
    };
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(match[1] ?? '', { schema: JSON_SCHEMA });
  } catch (err) {
    throw new SkillRegistryError(
      'SKILL_PARSE_ERROR',
      `failed to parse SKILL.md frontmatter at ${sourcePath}: ${(err as Error).message}`,
      { cause: err },
    );
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      frontmatter: { name: '', description: '', extra: {} },
      body: raw.slice(match[0].length),
    };
  }

  const obj = parsed as Record<string, unknown>;
  const { name, description, ...extra } = obj;

  return {
    frontmatter: {
      name: typeof name === 'string' ? name : '',
      description: typeof description === 'string' ? description : '',
      extra: Object.freeze(extra),
    },
    body: raw.slice(match[0].length),
  };
}

/**
 * Walk the four step subdirectories — `steps/`, `steps-c/`, `steps-e/`,
 * `steps-v/` — and produce a flat list of `BmadStepFile` records. Files
 * named like `1-foo.md`, `step-1.md`, `01_intro.md` get their leading numeric
 * prefix parsed into `index`; everything else has `index: null` (sorts last).
 */
async function enumerateStepFiles(skillDir: string): Promise<readonly BmadStepFile[]> {
  const result: BmadStepFile[] = [];
  for (const category of BMAD_STEP_CATEGORIES) {
    const dir = path.join(skillDir, category);
    let entries: string[];
    try {
      entries = (await fs.readdir(dir)).sort();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw new SkillRegistryError(
        'IO_ERROR',
        `failed to enumerate ${dir}: ${(err as Error).message}`,
        { cause: err },
      );
    }
    for (const fileName of entries) {
      if (!fileName.endsWith('.md')) continue;
      result.push({
        category,
        fileName,
        absolutePath: path.join(dir, fileName),
        index: parseStepIndex(fileName),
      });
    }
  }
  // Stable order: by category, then by index (nulls last), then by name.
  result.sort((a, b) => {
    if (a.category !== b.category) {
      return BMAD_STEP_CATEGORIES.indexOf(a.category) - BMAD_STEP_CATEGORIES.indexOf(b.category);
    }
    if (a.index !== null && b.index !== null && a.index !== b.index) {
      return a.index - b.index;
    }
    if (a.index === null && b.index !== null) return 1;
    if (a.index !== null && b.index === null) return -1;
    return a.fileName.localeCompare(b.fileName);
  });
  return result;
}

function parseStepIndex(fileName: string): number | null {
  // Match leading digits, optionally prefixed with "step-" / "step_".
  const match = /^(?:step[-_])?(\d+)/i.exec(fileName);
  if (!match) return null;
  return Number.parseInt(match[1] ?? '', 10);
}

/**
 * Read the skill's `customize.toml` defaults. Returns null when missing
 * (skills like `bmad-help` ship without one).
 */
async function readCustomizationDefaults(
  skillDir: string,
): Promise<Readonly<Record<string, unknown>> | null> {
  const filePath = path.join(skillDir, 'customize.toml');
  try {
    await fs.access(filePath);
  } catch {
    return null;
  }
  // Re-use the resolver's loader for consistent error semantics.
  const { loadToml } = await import('./customization-resolver');
  return loadToml(filePath);
}

function makeCacheKey(projectRoot: string, skillId: string): string {
  return `${path.resolve(projectRoot)}::${skillId}`;
}

export function buildPersonaSkillKey(skillId: string): string {
  return skillId;
}

export const __internals = {
  classifySkill,
  parseStepIndex,
  enumerateStepFiles,
};

/**
 * Map an agent skill id (`bmad-agent-pm`) to the persona slug (`john`). Used
 * by the persona registry (Phase 2) but exposed here so Phase 1's debug
 * command can show "this is John's skill" alongside the resolved customize
 * block. Per BMAD docs § "Default Agents" + § "What Named Agents Buy You"
 * (slug ↔ skillId mapping is hardcoded; only customizable fields surround it).
 */
export function personaSlugForSkillId(skillId: string): string | null {
  const map: Record<string, string> = {
    'bmad-agent-analyst': 'mary',
    'bmad-agent-tech-writer': 'paige',
    'bmad-agent-pm': 'john',
    'bmad-agent-ux-designer': 'sally',
    'bmad-agent-architect': 'winston',
    'bmad-agent-dev': 'amelia',
  };
  return map[skillId] ?? null;
}
