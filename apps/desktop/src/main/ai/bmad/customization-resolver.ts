/**
 * Customization resolver
 * ======================
 *
 * Faithful TypeScript port of `_bmad/scripts/resolve_customization.py`.
 *
 * Per ENGINE_SWAP_PROMPT.md KAD-5 + BMAD docs § "Three-Layer Override Model" +
 * § "Merge Rules (by shape, not by field name)" + § "How Resolution Works":
 *
 *   Priority 1 (wins): _bmad/custom/{skill-name}.user.toml  (personal, gitignored)
 *   Priority 2:        _bmad/custom/{skill-name}.toml        (team/org, committed)
 *   Priority 3 (last): {skill-root}/customize.toml           (defaults)
 *
 * The four shape-driven merge rules (per docs, applied recursively):
 *   1. Scalars (string, int, bool, float):    override wins
 *   2. Tables (objects):                      deep merge
 *   3. Arrays of tables where every item shares the SAME identifier field
 *      (every item has `code`, OR every item has `id`):
 *                                             merge by that key
 *      — matching keys REPLACE in place
 *      — new keys APPEND at the end
 *   4. Any other array (scalars, mixed-key tables, no-id tables):
 *                                             append (base then override)
 *
 * **Field names are never special-cased** — behavior is purely structural per
 * BMAD docs § "Merge Rules (by shape, not by field name)". The resolver does
 * not know the difference between `agent.menu` and `agent.principles`; it just
 * inspects the value's shape.
 *
 * No removal mechanism — overrides cannot delete base items. To suppress a
 * default, override it by `code` with a no-op description / prompt, or fork
 * the skill (per BMAD docs § "Merge Rules (by shape, not by field name)").
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';

// =============================================================================
// Types
// =============================================================================

/**
 * Result of `_detect_keyed_merge_field` — `'code'`, `'id'`, or `null` (use
 * append fallback). Mirrors the Python's `_KEYED_MERGE_FIELDS` constant.
 */
const KEYED_MERGE_FIELDS = ['code', 'id'] as const;
type KeyedMergeField = (typeof KEYED_MERGE_FIELDS)[number];

/**
 * Generic JSON-shaped value the resolver works with after TOML parse. We keep
 * the type wide because TOML can produce any of {string, number, boolean,
 * Date, array, object}; the merger doesn't care about the leaf type.
 */
type TomlValue = unknown;
type TomlObject = Record<string, TomlValue>;

/**
 * Custom error thrown when a layer file fails to parse and the caller marked
 * the read as "required" (defaults / customize.toml). Optional layers (team /
 * user overrides) silently degrade to `{}` per the Python resolver.
 */
export class CustomizationResolverError extends Error {
  readonly cause?: unknown;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'CustomizationResolverError';
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

/**
 * Options for `resolveCustomization`.
 * `keys` — when provided, return a sparse result with only those dotted-key
 * extractions (mirrors Python's `--key` repeatable flag).
 */
export interface ResolveCustomizationOptions {
  /** Absolute path to the skill directory (must contain `customize.toml`). */
  readonly skillDir: string;
  /**
   * Optional explicit project root. If omitted, we walk up from `skillDir`
   * looking for a directory containing `_bmad/` or `.git/` (matches the
   * Python's `find_project_root` behavior).
   */
  readonly projectRoot?: string;
  /**
   * Repeatable dotted-key extractions. Empty / undefined → return the full
   * merged tree. Mirrors `--key` in the Python CLI.
   */
  readonly keys?: readonly string[];
}

// =============================================================================
// Internal helpers — direct ports of the Python functions (line-for-line shape)
// =============================================================================

/**
 * Walk up from `start` looking for a directory that contains either `_bmad/`
 * or `.git/`. Mirrors `find_project_root` from `resolve_customization.py`.
 *
 * Returns null if no such ancestor exists. Marked async because we use
 * `fs.access`; the Python version uses `Path.exists()` synchronously, but
 * sync FS in the main process blocks the renderer.
 */
async function findProjectRoot(start: string): Promise<string | null> {
  let current = path.resolve(start);
  while (true) {
    if (await pathExists(path.join(current, '_bmad'))) return current;
    if (await pathExists(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load a TOML file. Returns `{}` if the file is missing OR fails to parse
 * (when `required: false`). Throws `CustomizationResolverError` when missing
 * or unparseable AND `required: true` (mirrors Python's `sys.exit(1)`).
 *
 * The Python version warns on stderr for non-required parse failures; we
 * surface the warning via the optional `onWarn` callback so callers can pipe
 * it into `appLog.warn` without coupling the resolver to the logger.
 */
export async function loadToml(
  filePath: string,
  options: { required?: boolean; onWarn?: (msg: string) => void } = {},
): Promise<TomlObject> {
  const required = options.required ?? false;
  const onWarn = options.onWarn ?? noopWarn;

  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      if (required) {
        throw new CustomizationResolverError(
          `required customization file not found: ${filePath}`,
          { cause: err },
        );
      }
      return {};
    }
    if (required) {
      throw new CustomizationResolverError(
        `failed to read ${filePath}: ${(err as Error).message}`,
        { cause: err },
      );
    }
    onWarn(`failed to read ${filePath}: ${(err as Error).message}`);
    return {};
  }

  try {
    const parsed = parseToml(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      if (required) {
        throw new CustomizationResolverError(
          `${filePath} did not parse to a table`,
        );
      }
      return {};
    }
    return parsed as TomlObject;
  } catch (err) {
    if (err instanceof CustomizationResolverError) throw err;
    if (required) {
      throw new CustomizationResolverError(
        `failed to parse ${filePath}: ${(err as Error).message}`,
        { cause: err },
      );
    }
    onWarn(`failed to parse ${filePath}: ${(err as Error).message}`);
    return {};
  }
}

/**
 * Return `'code'` or `'id'` if **every** table item carries that same field,
 * else `null`. Mixed arrays (some items use `code`, others `id`, or some items
 * are missing both) fall through to append.
 *
 * Mirrors `_detect_keyed_merge_field` from the Python resolver.
 *
 * The "non-null check" matches Python's `is not None` test: a value of `0`,
 * empty string, or `false` qualifies as a present key. Only `null` /
 * `undefined` disqualify.
 */
function detectKeyedMergeField(items: readonly TomlValue[]): KeyedMergeField | null {
  if (items.length === 0) return null;
  if (!items.every((item) => isPlainObject(item))) return null;

  for (const candidate of KEYED_MERGE_FIELDS) {
    const allHaveKey = items.every(
      (item) => (item as TomlObject)[candidate] !== undefined && (item as TomlObject)[candidate] !== null,
    );
    if (allHaveKey) return candidate;
  }
  return null;
}

/**
 * In-place key merge: matching keys REPLACE base items at their original
 * index; new keys APPEND at the end. Mirrors `_merge_by_key` from the Python.
 */
function mergeByKey(
  base: readonly TomlValue[],
  override: readonly TomlValue[],
  keyName: KeyedMergeField,
): TomlValue[] {
  const result: TomlValue[] = [];
  const indexByKey = new Map<unknown, number>();

  for (const item of base) {
    if (!isPlainObject(item)) continue;
    const value = (item as TomlObject)[keyName];
    if (value !== null && value !== undefined) {
      indexByKey.set(value, result.length);
    }
    result.push({ ...(item as TomlObject) });
  }

  for (const item of override) {
    if (!isPlainObject(item)) {
      result.push(item);
      continue;
    }
    const itemKey = (item as TomlObject)[keyName];
    if (
      itemKey !== null &&
      itemKey !== undefined &&
      indexByKey.has(itemKey)
    ) {
      // Replace in place; subsequent base items keep their relative order.
      const existingIndex = indexByKey.get(itemKey);
      // existingIndex is guaranteed non-undefined here; the .has() check above guards it.
      result[existingIndex as number] = { ...(item as TomlObject) };
    } else {
      if (itemKey !== null && itemKey !== undefined) {
        indexByKey.set(itemKey, result.length);
      }
      result.push({ ...(item as TomlObject) });
    }
  }

  return result;
}

/**
 * Shape-aware array merge — mirrors `_merge_arrays` from the Python.
 * Considers BOTH base and override items when deciding whether keyed-merge
 * applies; if any item from either side lacks the candidate key, falls back
 * to append.
 */
function mergeArrays(base: TomlValue, override: TomlValue): TomlValue[] {
  const baseArr = Array.isArray(base) ? base : [];
  const overrideArr = Array.isArray(override) ? override : [];
  const combined = [...baseArr, ...overrideArr];
  const keyedField = detectKeyedMergeField(combined);
  if (keyedField) {
    return mergeByKey(baseArr, overrideArr, keyedField);
  }
  return [...baseArr, ...overrideArr];
}

/**
 * Recursively merge `override` into `base` using the four structural rules.
 * Mirrors `deep_merge` from the Python.
 *
 * Rule 1 (scalars + non-matching types): `override` wins.
 * Rule 2 (table + table): deep merge.
 * Rule 3 / 4 (array + array): shape-aware via `mergeArrays`.
 */
export function deepMerge(base: TomlValue, override: TomlValue): TomlValue {
  if (isPlainObject(base) && isPlainObject(override)) {
    const result: TomlObject = { ...(base as TomlObject) };
    for (const key of Object.keys(override as TomlObject)) {
      const overrideVal = (override as TomlObject)[key];
      if (key in result) {
        result[key] = deepMerge(result[key], overrideVal);
      } else {
        result[key] = overrideVal;
      }
    }
    return result;
  }
  if (Array.isArray(base) && Array.isArray(override)) {
    return mergeArrays(base, override);
  }
  return override;
}

/**
 * Extract a dotted-key path from a parsed TOML object. Returns `undefined`
 * when any path segment is missing. Mirrors `extract_key` from the Python.
 *
 * The Python uses a sentinel (`_MISSING`); TS uses `undefined` — callers
 * must treat `undefined` as "not present" rather than "explicitly null"
 * (TOML cannot encode null anyway).
 */
export function extractKey(data: TomlValue, dottedKey: string): TomlValue | undefined {
  const parts = dottedKey.split('.');
  let current: TomlValue = data;
  for (const part of parts) {
    if (!isPlainObject(current)) return undefined;
    if (!(part in (current as TomlObject))) return undefined;
    current = (current as TomlObject)[part];
  }
  return current;
}

function noopWarn(_msg: string): void {
  // intentional no-op default for the optional onWarn callback
}

function isPlainObject(value: unknown): value is TomlObject {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    // Reject things like Date / Map that smol-toml can produce. We treat
    // anything with a non-Object prototype as a scalar (override-wins).
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Three-layer customization resolution. Reads `customize.toml` in the skill
 * directory (required), then `_bmad/custom/{skill}.toml` (optional, team) and
 * `_bmad/custom/{skill}.user.toml` (optional, user) from the project root.
 *
 * The skill name is derived from the directory's basename — same as Python.
 *
 * Returns the merged tree, or a sparse `{key: value}` object if `keys` was
 * provided (matching the Python's `--key` CLI flag).
 *
 * @example
 *   const merged = await resolveCustomization({
 *     skillDir: '/proj/_bmad/bmm/2-plan-workflows/bmad-agent-pm',
 *     projectRoot: '/proj',
 *   });
 *   merged.agent?.icon === '🏥'   // user override applied
 */
export async function resolveCustomization(
  options: ResolveCustomizationOptions,
): Promise<TomlObject> {
  const skillDir = path.resolve(options.skillDir);
  const skillName = path.basename(skillDir);
  const defaultsPath = path.join(skillDir, 'customize.toml');

  const defaults = await loadToml(defaultsPath, { required: true });

  const projectRoot =
    options.projectRoot ?? (await findProjectRoot(skillDir)) ?? null;

  let team: TomlObject = {};
  let user: TomlObject = {};
  if (projectRoot) {
    const customDir = path.join(projectRoot, '_bmad', 'custom');
    team = await loadToml(path.join(customDir, `${skillName}.toml`));
    user = await loadToml(path.join(customDir, `${skillName}.user.toml`));
  }

  let merged = deepMerge(defaults, team) as TomlObject;
  merged = deepMerge(merged, user) as TomlObject;

  if (options.keys && options.keys.length > 0) {
    const sparse: TomlObject = {};
    for (const key of options.keys) {
      const value = extractKey(merged, key);
      if (value !== undefined) {
        sparse[key] = value;
      }
    }
    return sparse;
  }

  return merged;
}

// Re-export internal helpers for unit tests. Keeping them named-exports here
// (rather than via a `__test__` namespace) lets the test file stay simple
// without changing module shape between dev and prod.
export const __internals = {
  detectKeyedMergeField,
  mergeArrays,
  mergeByKey,
  isPlainObject,
  findProjectRoot,
};
