/**
 * Manifest loader
 * ===============
 *
 * Parses the four BMAD manifest files written by the installer into typed,
 * Zod-validated structures.
 *
 *   _bmad/_config/manifest.yaml         → modules + versions + IDEs
 *   _bmad/_config/skill-manifest.csv    → every installed skill
 *   _bmad/_config/bmad-help.csv         → phase / dependency graph (KAD-3)
 *   _bmad/_config/files-manifest.csv    → installer-side per-file SHA-256s
 *
 * All four are install-time outputs — they regenerate on every install / update
 * and the loader treats their absence as `PROJECT_NOT_BMAD` (for manifest.yaml)
 * or "empty registry" (for the CSVs).
 *
 * Per BMAD docs § "What got installed" + `bmad-help/SKILL.md` § "CSV Interpretation".
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse as parseCsv } from 'csv-parse/sync';
import { JSON_SCHEMA, load as parseYaml } from 'js-yaml';
import { z } from 'zod';

import {
  BMAD_PHASES,
  BmadFilesManifestEntrySchema,
  BmadHelpRowSchema,
  BmadManifestSchema,
  BmadSkillManifestEntrySchema,
  type BmadFilesManifestEntry,
  type BmadHelpDependency,
  type BmadHelpRow,
  type BmadHelpRowKind,
  type BmadManifest,
  type BmadPhase,
  type BmadSkillManifestEntry,
} from '../../../shared/types/bmad';

// =============================================================================
// Errors
// =============================================================================

/**
 * Thrown when a manifest file fails to parse or validate. The `code` field
 * lines up with `BmadErrorCode` so callers can re-throw it as a typed
 * `BmadError` without re-classification.
 */
export class ManifestLoadError extends Error {
  readonly code:
    | 'PROJECT_NOT_BMAD'
    | 'MANIFEST_PARSE_ERROR'
    | 'CSV_PARSE_ERROR'
    | 'YAML_PARSE_ERROR'
    | 'IO_ERROR';
  readonly cause?: unknown;
  readonly details?: unknown;

  constructor(
    code: ManifestLoadError['code'],
    message: string,
    options?: { cause?: unknown; details?: unknown },
  ) {
    super(message);
    this.name = 'ManifestLoadError';
    this.code = code;
    if (options?.cause !== undefined) this.cause = options.cause;
    if (options?.details !== undefined) this.details = options.details;
  }
}

// =============================================================================
// Path helpers
// =============================================================================

/** Standard paths relative to a project root. */
export interface BmadManifestPaths {
  readonly manifestYaml: string;
  readonly skillManifestCsv: string;
  readonly bmadHelpCsv: string;
  readonly filesManifestCsv: string;
}

export function getManifestPaths(projectRoot: string): BmadManifestPaths {
  const configDir = path.join(projectRoot, '_bmad', '_config');
  return {
    manifestYaml: path.join(configDir, 'manifest.yaml'),
    skillManifestCsv: path.join(configDir, 'skill-manifest.csv'),
    bmadHelpCsv: path.join(configDir, 'bmad-help.csv'),
    filesManifestCsv: path.join(configDir, 'files-manifest.csv'),
  };
}

/**
 * Detect whether a directory looks like a BMAD project. Cheap check —
 * presence of `_bmad/_config/manifest.yaml` per BMAD docs § "What got installed".
 */
export async function isBmadProject(projectRoot: string): Promise<boolean> {
  try {
    await fs.access(getManifestPaths(projectRoot).manifestYaml);
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// manifest.yaml
// =============================================================================

/**
 * Read + validate `_bmad/_config/manifest.yaml`.
 * Returns null (not throw) when the file is missing — callers decide whether
 * that means "not a BMAD project" or an error condition.
 */
export async function loadManifest(projectRoot: string): Promise<BmadManifest | null> {
  const filePath = getManifestPaths(projectRoot).manifestYaml;
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new ManifestLoadError(
      'IO_ERROR',
      `failed to read ${filePath}: ${(err as Error).message}`,
      { cause: err },
    );
  }

  let parsed: unknown;
  try {
    // JSON_SCHEMA keeps ISO-8601 timestamps as strings (DEFAULT_SCHEMA would
    // coerce them to Date, which doesn't survive the Zod string()s in
    // BmadManifestSchema).
    parsed = parseYaml(raw, { schema: JSON_SCHEMA });
  } catch (err) {
    throw new ManifestLoadError(
      'YAML_PARSE_ERROR',
      `failed to parse ${filePath}: ${(err as Error).message}`,
      { cause: err },
    );
  }

  const result = BmadManifestSchema.safeParse(parsed);
  if (!result.success) {
    throw new ManifestLoadError(
      'MANIFEST_PARSE_ERROR',
      `manifest.yaml failed schema validation (${path.basename(filePath)})`,
      { details: result.error.issues },
    );
  }
  return result.data;
}

// =============================================================================
// skill-manifest.csv
// =============================================================================

/**
 * Parse `_bmad/_config/skill-manifest.csv`. Header row:
 *   `canonicalId,name,description,module,path`
 *
 * Returns `[]` when the file is missing.
 */
export async function loadSkillManifest(
  projectRoot: string,
): Promise<readonly BmadSkillManifestEntry[]> {
  const filePath = getManifestPaths(projectRoot).skillManifestCsv;
  const raw = await readOptionalCsv(filePath);
  if (raw === null) return [];

  let rows: Record<string, string>[];
  try {
    rows = parseCsv(raw, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Record<string, string>[];
  } catch (err) {
    throw new ManifestLoadError(
      'CSV_PARSE_ERROR',
      `failed to parse skill-manifest.csv: ${(err as Error).message}`,
      { cause: err },
    );
  }

  const entries: BmadSkillManifestEntry[] = [];
  const issues: { row: number; issues: z.ZodIssue[] }[] = [];
  rows.forEach((row, idx) => {
    const candidate = {
      canonicalId: row.canonicalId,
      name: row.name,
      description: row.description ?? '',
      module: row.module,
      path: row.path,
    };
    const result = BmadSkillManifestEntrySchema.safeParse(candidate);
    if (result.success) {
      entries.push(result.data);
    } else {
      issues.push({ row: idx + 2, issues: result.error.issues });
    }
  });

  if (issues.length > 0) {
    throw new ManifestLoadError(
      'CSV_PARSE_ERROR',
      `skill-manifest.csv has ${issues.length} invalid row(s)`,
      { details: issues },
    );
  }

  return entries;
}

// =============================================================================
// bmad-help.csv
// =============================================================================

/**
 * Parse `_bmad/_config/bmad-help.csv`. Header row:
 *   `module,skill,display-name,menu-code,description,action,args,phase,after,before,required,output-location,outputs`
 *
 * Per `bmad-help/SKILL.md` § "CSV Interpretation":
 *   - `_meta` rows hold module-level docs URLs (returned with kind: 'meta')
 *   - `phase` ∈ {1-analysis, 2-planning, 3-solutioning, 4-implementation, anytime}
 *   - `after` / `before` are comma-separated dep refs of the form `skill[:action]`
 *   - `required` is the literal `true` / `false`
 *   - `outputs` is pipe-separated
 *
 * Rows with unknown phase values are reported as CSV_PARSE_ERROR with details.
 */
export async function loadBmadHelp(projectRoot: string): Promise<readonly BmadHelpRow[]> {
  const filePath = getManifestPaths(projectRoot).bmadHelpCsv;
  const raw = await readOptionalCsv(filePath);
  if (raw === null) return [];

  let rows: Record<string, string>[];
  try {
    rows = parseCsv(raw, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Record<string, string>[];
  } catch (err) {
    throw new ManifestLoadError(
      'CSV_PARSE_ERROR',
      `failed to parse bmad-help.csv: ${(err as Error).message}`,
      { cause: err },
    );
  }

  const result: BmadHelpRow[] = [];
  const issues: { row: number; reason: string }[] = [];

  rows.forEach((row, idx) => {
    const phase = row.phase as BmadPhase;
    const kind: BmadHelpRowKind = row.skill === '_meta' ? 'meta' : 'workflow';
    if (kind === 'workflow' && !BMAD_PHASES.includes(phase)) {
      issues.push({ row: idx + 2, reason: `unknown phase: ${row.phase}` });
      return;
    }

    const candidate: BmadHelpRow = {
      module: row.module,
      skill: row.skill,
      displayName: row['display-name'] ?? '',
      menuCode: row['menu-code'] ?? '',
      description: row.description ?? '',
      action: row.action ?? '',
      args: row.args ?? '',
      phase: kind === 'meta' ? 'anytime' : phase,
      after: parseDependencyList(row.after ?? ''),
      before: parseDependencyList(row.before ?? ''),
      required: parseBooleanLiteral(row.required ?? 'false'),
      outputLocation: row['output-location'] ?? '',
      outputs: parsePipeList(row.outputs ?? ''),
      kind,
    };

    const validation = BmadHelpRowSchema.safeParse(candidate);
    if (validation.success) {
      result.push(validation.data);
    } else {
      issues.push({
        row: idx + 2,
        reason: validation.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      });
    }
  });

  if (issues.length > 0) {
    throw new ManifestLoadError(
      'CSV_PARSE_ERROR',
      `bmad-help.csv has ${issues.length} invalid row(s)`,
      { details: issues },
    );
  }

  return result;
}

// =============================================================================
// files-manifest.csv
// =============================================================================

/**
 * Parse `_bmad/_config/files-manifest.csv`. Header row: `type,name,module,path,hash`.
 *
 * Used by the installer to detect drift; the runtime exposes the typed list
 * for diagnostics (e.g. "your install differs from the snapshot at ...").
 */
export async function loadFilesManifest(
  projectRoot: string,
): Promise<readonly BmadFilesManifestEntry[]> {
  const filePath = getManifestPaths(projectRoot).filesManifestCsv;
  const raw = await readOptionalCsv(filePath);
  if (raw === null) return [];

  let rows: Record<string, string>[];
  try {
    rows = parseCsv(raw, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Record<string, string>[];
  } catch (err) {
    throw new ManifestLoadError(
      'CSV_PARSE_ERROR',
      `failed to parse files-manifest.csv: ${(err as Error).message}`,
      { cause: err },
    );
  }

  const entries: BmadFilesManifestEntry[] = [];
  const issues: { row: number; issues: z.ZodIssue[] }[] = [];

  rows.forEach((row, idx) => {
    const result = BmadFilesManifestEntrySchema.safeParse(row);
    if (result.success) {
      entries.push(result.data);
    } else {
      issues.push({ row: idx + 2, issues: result.error.issues });
    }
  });

  if (issues.length > 0) {
    throw new ManifestLoadError(
      'CSV_PARSE_ERROR',
      `files-manifest.csv has ${issues.length} invalid row(s)`,
      { details: issues },
    );
  }

  return entries;
}

// =============================================================================
// Aggregator
// =============================================================================

export interface BmadManifestBundle {
  readonly projectRoot: string;
  readonly manifest: BmadManifest;
  readonly skills: readonly BmadSkillManifestEntry[];
  readonly help: readonly BmadHelpRow[];
  readonly files: readonly BmadFilesManifestEntry[];
}

/**
 * Load all four manifest files in one call. Throws `PROJECT_NOT_BMAD` if
 * `manifest.yaml` is missing — callers should run the installer instead.
 *
 * The CSVs are read in parallel since they're independent.
 */
export async function loadAllManifests(projectRoot: string): Promise<BmadManifestBundle> {
  const manifest = await loadManifest(projectRoot);
  if (!manifest) {
    throw new ManifestLoadError(
      'PROJECT_NOT_BMAD',
      `${projectRoot} is not a BMAD project (missing _bmad/_config/manifest.yaml)`,
    );
  }
  const [skills, help, files] = await Promise.all([
    loadSkillManifest(projectRoot),
    loadBmadHelp(projectRoot),
    loadFilesManifest(projectRoot),
  ]);
  return { projectRoot, manifest, skills, help, files };
}

// =============================================================================
// Internal helpers
// =============================================================================

async function readOptionalCsv(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new ManifestLoadError(
      'IO_ERROR',
      `failed to read ${filePath}: ${(err as Error).message}`,
      { cause: err },
    );
  }
}

function parseDependencyList(raw: string): readonly BmadHelpDependency[] {
  if (!raw.trim()) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const colonIdx = entry.indexOf(':');
      if (colonIdx === -1) return { skill: entry, action: null };
      return {
        skill: entry.slice(0, colonIdx).trim(),
        action: entry.slice(colonIdx + 1).trim() || null,
      };
    });
}

function parseBooleanLiteral(raw: string): boolean {
  const value = raw.trim().toLowerCase();
  return value === 'true' || value === '1' || value === 'yes';
}

function parsePipeList(raw: string): readonly string[] {
  if (!raw.trim()) return [];
  return raw
    .split('|')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

// Re-export for tests
export const __internals = {
  parseDependencyList,
  parseBooleanLiteral,
  parsePipeList,
};
