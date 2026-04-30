/**
 * BMad step loader (just-in-time)
 * ===============================
 *
 * Enforces BMAD's "NEVER load multiple step files simultaneously" rule per
 * `bmad-create-prd/SKILL.md` § "Critical Rules (NO EXCEPTIONS)" and
 * `bmad-dev-story/SKILL.md` `<critical>Execute ALL steps in exact order; do
 * NOT skip steps</critical>`. Loading is idempotent for the current step
 * (re-reading is fine — the model can re-load the same file) but advances
 * are gated on the previous step appearing in the workflow's output-file
 * frontmatter `stepsCompleted` array.
 *
 * The loader is two things at once:
 *
 *   1. A safety mechanism: tests + IPC introspection callers use it to
 *      verify the workflow runner respects the JIT rule. A pre-load
 *      attempt throws `STEP_LOAD_VIOLATION`.
 *
 *   2. A convenience for the runner: it returns the resolved step file
 *      content with variable substitution already applied, so the runner
 *      can inject it as a system addendum without re-parsing.
 *
 * The runner does NOT have to call this on every model turn — most BMAD
 * workflows use the Read tool inside the model's context. But invoking
 * the loader provides stronger guarantees and structured progress events.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { JSON_SCHEMA, load as parseYaml } from 'js-yaml';

import type {
  BmadSkill,
  BmadStepFile,
  BmadVariableContext,
  BmadWorkflowStep,
} from '../../../shared/types/bmad';
import { substituteVariables } from './variables';

// =============================================================================
// Errors
// =============================================================================

export class StepLoaderError extends Error {
  readonly code:
    | 'STEP_FILE_NOT_FOUND'
    | 'STEP_LOAD_VIOLATION'
    | 'YAML_PARSE_ERROR'
    | 'IO_ERROR'
    | 'INVALID_INPUT';
  readonly cause?: unknown;
  readonly details?: unknown;

  constructor(
    code: StepLoaderError['code'],
    message: string,
    options?: { cause?: unknown; details?: unknown },
  ) {
    super(message);
    this.name = 'StepLoaderError';
    this.code = code;
    if (options?.cause !== undefined) this.cause = options.cause;
    if (options?.details !== undefined) this.details = options.details;
  }
}

// =============================================================================
// Public API
// =============================================================================

export interface LoadCurrentStepOptions {
  readonly skill: BmadSkill;
  /**
   * Index into `skill.stepFiles` (0-based after the registry's stable sort).
   * The loader refuses to advance past index N+1 unless the file at N is
   * recorded in the output file's `stepsCompleted` frontmatter array.
   */
  readonly stepIndex: number;
  /**
   * Path to the workflow's output file (whose frontmatter holds
   * `stepsCompleted`). Optional — only required when `stepIndex > 0`. Most
   * workflows write `prd.md`, `architecture.md`, `epics.md` etc. into
   * `_bmad-output/planning-artifacts/`.
   */
  readonly outputFilePath?: string;
  /** Variable context for substitution. Skipped if undefined. */
  readonly variables?: BmadVariableContext;
  /**
   * Bypass the JIT enforcement. Test-only. NEVER set this from production
   * code — it defeats the safety guarantee.
   */
  readonly __unsafeBypass?: boolean;
}

/**
 * Load one step file at the given index. Throws `STEP_LOAD_VIOLATION` when:
 *   - `stepIndex > 0` and prior steps are NOT all listed in the output
 *     file's `stepsCompleted` frontmatter array.
 *   - `stepIndex < 0` or beyond the skill's `stepFiles` length.
 *
 * Returns the file's body with variables substituted (if a context was
 * provided), packaged as a `BmadWorkflowStep`.
 */
export async function loadCurrentStep(
  options: LoadCurrentStepOptions,
): Promise<BmadWorkflowStep> {
  const { skill, stepIndex, outputFilePath, variables, __unsafeBypass } = options;

  if (stepIndex < 0 || stepIndex >= skill.stepFiles.length) {
    throw new StepLoaderError(
      'INVALID_INPUT',
      `stepIndex ${stepIndex} out of range (skill has ${skill.stepFiles.length} step files)`,
    );
  }

  const targetStep = skill.stepFiles[stepIndex];
  if (!targetStep) {
    throw new StepLoaderError(
      'INVALID_INPUT',
      `stepIndex ${stepIndex} resolved to an undefined step entry (skill malformed?)`,
    );
  }

  // JIT gate: if we're advancing past index 0, prior steps must be marked
  // complete in the output file's frontmatter.
  if (stepIndex > 0 && !__unsafeBypass) {
    if (!outputFilePath) {
      throw new StepLoaderError(
        'STEP_LOAD_VIOLATION',
        `cannot load step ${stepIndex} (${targetStep.fileName}) without outputFilePath ` +
          `to verify the prior step was completed (per BMAD docs § "Critical Rules ` +
          `(NO EXCEPTIONS)" — stepsCompleted gate)`,
      );
    }

    const completed = await readStepsCompleted(outputFilePath);
    const expectedPriorStep = skill.stepFiles[stepIndex - 1];
    if (!expectedPriorStep) {
      throw new StepLoaderError(
        'INVALID_INPUT',
        `prior step at index ${stepIndex - 1} resolved to undefined (skill malformed?)`,
      );
    }
    const priorStepName = stripExtension(expectedPriorStep.fileName);
    if (!completed.includes(priorStepName)) {
      throw new StepLoaderError(
        'STEP_LOAD_VIOLATION',
        `cannot load step ${stepIndex} (${targetStep.fileName}) — prior step ` +
          `'${priorStepName}' is not in stepsCompleted (got [${completed.join(', ')}]) ` +
          `at ${outputFilePath}`,
        { details: { completed, expectedPriorStep: priorStepName } },
      );
    }
  }

  return loadStepFile(targetStep, variables);
}

/**
 * Load a step file by its filename within a skill. Convenience wrapper
 * around `loadCurrentStep` that resolves the index from the filename.
 *
 * Used by the workflow runner when the model writes "load
 * `step-02-discovery.md` next" — the runner finds the matching index, then
 * defers to `loadCurrentStep` for the JIT gate.
 */
export async function loadStepByName(
  options: Omit<LoadCurrentStepOptions, 'stepIndex'> & { fileName: string },
): Promise<BmadWorkflowStep> {
  const idx = options.skill.stepFiles.findIndex((s) => s.fileName === options.fileName);
  if (idx < 0) {
    throw new StepLoaderError(
      'STEP_FILE_NOT_FOUND',
      `step file '${options.fileName}' not found in skill ${options.skill.canonicalId}`,
    );
  }
  return loadCurrentStep({ ...options, stepIndex: idx });
}

/**
 * Read just the `stepsCompleted` array from a workflow output file's YAML
 * frontmatter. Returns `[]` if the file doesn't exist (workflow hasn't
 * started yet) or has no frontmatter.
 */
export async function readStepsCompleted(filePath: string): Promise<readonly string[]> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new StepLoaderError(
      'IO_ERROR',
      `failed to read output file ${filePath}: ${(err as Error).message}`,
      { cause: err },
    );
  }

  const FRONTMATTER_RE = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/;
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return [];

  let parsed: unknown;
  try {
    parsed = parseYaml(match[1] ?? '', { schema: JSON_SCHEMA });
  } catch (err) {
    throw new StepLoaderError(
      'YAML_PARSE_ERROR',
      `failed to parse frontmatter in ${filePath}: ${(err as Error).message}`,
      { cause: err },
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const completed = (parsed as Record<string, unknown>).stepsCompleted;
  if (!Array.isArray(completed)) return [];
  return completed.filter((s): s is string => typeof s === 'string');
}

/**
 * Compute which step file the workflow should load next. Reads the output
 * file's `stepsCompleted` array, finds the highest-index entry that matches
 * a step file in the skill, and returns the next index (or 0 if no steps
 * are completed yet, or `null` if the workflow is fully done).
 */
export async function nextStepIndex(
  skill: BmadSkill,
  outputFilePath: string | undefined,
): Promise<number | null> {
  if (skill.stepFiles.length === 0) return null;
  if (!outputFilePath) return 0;

  const completed = await readStepsCompleted(outputFilePath);
  if (completed.length === 0) return 0;

  // Walk the skill's step list in order; return the first index NOT in
  // `completed`. This matches BMAD's "execute in order" rule even when
  // the output file's stepsCompleted array is out of sequence (defensive).
  for (let i = 0; i < skill.stepFiles.length; i++) {
    const stepFile = skill.stepFiles[i];
    if (!stepFile) continue;
    const stepName = stripExtension(stepFile.fileName);
    if (!completed.includes(stepName)) return i;
  }

  // Every step completed.
  return null;
}

// =============================================================================
// Internal helpers
// =============================================================================

async function loadStepFile(
  step: BmadStepFile,
  variables: BmadVariableContext | undefined,
): Promise<BmadWorkflowStep> {
  let body: string;
  try {
    body = await fs.readFile(step.absolutePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new StepLoaderError(
        'STEP_FILE_NOT_FOUND',
        `step file missing on disk: ${step.absolutePath}`,
        { cause: err },
      );
    }
    throw new StepLoaderError(
      'IO_ERROR',
      `failed to read step file ${step.absolutePath}: ${(err as Error).message}`,
      { cause: err },
    );
  }

  const substituted = variables ? substituteVariables(body, variables) : body;

  return {
    index: step.index ?? 0,
    fileName: step.fileName,
    absolutePath: step.absolutePath,
    category: step.category,
    body: substituted,
  };
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.md$/i, '');
}

// =============================================================================
// Test internals
// =============================================================================

export const __internals = {
  loadStepFile,
  stripExtension,
};

// Re-export path so tests can construct fake outputFilePaths cross-platform
// without importing 'node:path' directly.
export { path as __pathForTests };
