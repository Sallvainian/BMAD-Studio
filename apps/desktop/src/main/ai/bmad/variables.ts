/**
 * BMad variable substitution
 * ==========================
 *
 * Resolves the variable surface every BMAD skill assumes is available, per
 * BMAD docs § "Step 4: Load Config" (the activation flow's variable load):
 *
 *   {project-root}              project working directory (absolute)
 *   {skill-root}                this skill's installed directory
 *   {skill-name}                skill directory basename (e.g. bmad-create-prd)
 *   {user_name}                 from _bmad/config.toml [core] user_name
 *   {communication_language}    from [core] communication_language
 *   {document_output_language}  from [core] document_output_language
 *   {planning_artifacts}        from [modules.{module}] planning_artifacts
 *   {implementation_artifacts}  from [modules.{module}] implementation_artifacts
 *   {project_knowledge}         from [modules.{module}] project_knowledge
 *   {output_folder}             from [core] output_folder
 *   {date}                      runtime: ISO-8601 system date
 *   {project_name}              from [core] project_name
 *   {user_skill_level}          optional, from [core] (only bmad-dev-story uses it)
 *
 * Per ENGINE_SWAP_PROMPT.md Phase 2 deliverable §3: "Resolved from config +
 * active worktree." The resolver also chains substitutions: a value like
 * `{project-root}/_bmad-output` is fully expanded, not partially.
 *
 * Substitution is recursive but bounded: cycles are detected and reported
 * as `CYCLIC_VARIABLE` so a misconfigured config can't hang the runner.
 */

import path from 'node:path';
import { resolveConfig } from './config-resolver';
import type { BmadVariableContext } from '../../../shared/types/bmad';

// =============================================================================
// Errors
// =============================================================================

export class VariableSubstitutionError extends Error {
  readonly code: 'CYCLIC_VARIABLE' | 'INVALID_INPUT' | 'IO_ERROR';
  readonly cause?: unknown;

  constructor(
    code: VariableSubstitutionError['code'],
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = 'VariableSubstitutionError';
    this.code = code;
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Recognized BMAD variable names. Any `{name}` not in this set is left
 * unsubstituted (so model-side templating like `{{user_name}}` Mustache
 * placeholders survive — those are interpreted by the model, not the runner).
 *
 * Per BMAD docs § "Step 4: Load Config" of every workflow's activation flow
 * + the conventions block in every SKILL.md.
 */
export const BMAD_KNOWN_VARIABLES = [
  'project-root',
  'skill-root',
  'skill-name',
  'user_name',
  'communication_language',
  'document_output_language',
  'planning_artifacts',
  'implementation_artifacts',
  'project_knowledge',
  'output_folder',
  'date',
  'project_name',
  'user_skill_level',
] as const;

export type BmadKnownVariable = (typeof BMAD_KNOWN_VARIABLES)[number];

const MAX_SUBSTITUTION_DEPTH = 8;

export interface BuildVariableContextOptions {
  readonly projectRoot: string;
  readonly skillDir: string;
  /**
   * Override the skill basename (defaults to `path.basename(skillDir)`).
   * Useful when the runner wants to substitute against a logical skill
   * id that differs from the directory name.
   */
  readonly skillName?: string;
  /**
   * Module name for resolving `[modules.{module}]` paths from
   * `_bmad/config.toml`. Defaults to `bmm` (the only Phase 1/2 module
   * with workflows that require it).
   */
  readonly module?: string;
  /** Optional override for `{date}`; defaults to ISO-8601 of now. */
  readonly date?: Date;
}

/**
 * Build a fully-populated variable context from the project's central config.
 * Reads `_bmad/config.toml` + `_bmad/config.user.toml` + the two
 * `_bmad/custom/config*.toml` overlays through the four-layer resolver.
 *
 * Throws `IO_ERROR` if `_bmad/config.toml` is missing — the variable
 * surface needs at least the base layer to be meaningful.
 */
export async function buildVariableContext(
  options: BuildVariableContextOptions,
): Promise<BmadVariableContext> {
  const projectRoot = path.resolve(options.projectRoot);
  const skillDir = path.resolve(options.skillDir);
  const skillName = options.skillName ?? path.basename(skillDir);
  const module = options.module ?? 'bmm';

  let config: Record<string, unknown>;
  try {
    config = await resolveConfig({ projectRoot });
  } catch (err) {
    throw new VariableSubstitutionError(
      'IO_ERROR',
      `failed to resolve _bmad/config.toml for variable context: ${(err as Error).message}`,
      { cause: err },
    );
  }

  const core = (config.core ?? {}) as Record<string, unknown>;
  const modules = (config.modules ?? {}) as Record<string, unknown>;
  const moduleBlock = (modules[module] ?? {}) as Record<string, unknown>;

  // Raw values — may still contain `{project-root}` etc. We expand them
  // below via `expand()` against the partial context built so far.
  const raw: Record<BmadKnownVariable, string> = {
    'project-root': projectRoot,
    'skill-root': skillDir,
    'skill-name': skillName,
    user_name: stringField(core, 'user_name', ''),
    communication_language: stringField(core, 'communication_language', 'English'),
    document_output_language: stringField(core, 'document_output_language', 'English'),
    planning_artifacts: stringField(moduleBlock, 'planning_artifacts', ''),
    implementation_artifacts: stringField(moduleBlock, 'implementation_artifacts', ''),
    project_knowledge: stringField(moduleBlock, 'project_knowledge', ''),
    output_folder: stringField(core, 'output_folder', ''),
    date: (options.date ?? new Date()).toISOString().slice(0, 10),
    project_name: stringField(core, 'project_name', path.basename(projectRoot)),
    user_skill_level: stringField(core, 'user_skill_level', ''),
  };

  // Two-pass expansion: substitute `{project-root}` and `{skill-root}`
  // (which never depend on other variables) into every other value first,
  // then expand the rest. Bounded depth + cycle detection.
  const ctxScalars = expandAll(raw);

  const ctx: BmadVariableContext = {
    projectRoot: ctxScalars['project-root'],
    skillRoot: ctxScalars['skill-root'],
    skillName: ctxScalars['skill-name'],
    userName: ctxScalars['user_name'],
    communicationLanguage: ctxScalars['communication_language'],
    documentOutputLanguage: ctxScalars['document_output_language'],
    planningArtifacts: ctxScalars['planning_artifacts'],
    implementationArtifacts: ctxScalars['implementation_artifacts'],
    projectKnowledge: ctxScalars['project_knowledge'],
    outputFolder: ctxScalars['output_folder'],
    date: ctxScalars['date'],
    projectName: ctxScalars['project_name'],
    ...(ctxScalars['user_skill_level']
      ? { userSkillLevel: ctxScalars['user_skill_level'] }
      : {}),
  };

  return ctx;
}

/**
 * Substitute every `{variable}` reference in `text` with the corresponding
 * value from `ctx`. Unknown variables (not in `BMAD_KNOWN_VARIABLES`) are
 * left unsubstituted — they're the model's job (e.g. Mustache `{{...}}`
 * placeholders the SKILL.md tells the model to fill in).
 *
 * Recursive: `{a}` resolving to `{b}` triggers another expansion pass on
 * the result. Bounded by `MAX_SUBSTITUTION_DEPTH` to short-circuit cycles.
 */
export function substituteVariables(text: string, ctx: BmadVariableContext): string {
  const lookup = contextToLookup(ctx);
  return expandText(text, lookup, 0, new Set());
}

/**
 * Substitute variables across an entire structured object (used by the
 * workflow runner for `persistent_facts`, `activation_steps_*`, menu items,
 * etc.). Recursively walks the object, substituting strings in place.
 * Returns a new structure (the input is not mutated).
 */
export function substituteVariablesInTree<T>(value: T, ctx: BmadVariableContext): T {
  return walkAndSubstitute(value, ctx) as T;
}

function walkAndSubstitute(value: unknown, ctx: BmadVariableContext): unknown {
  if (typeof value === 'string') return substituteVariables(value, ctx);
  if (Array.isArray(value)) return value.map((item) => walkAndSubstitute(item, ctx));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = walkAndSubstitute(v, ctx);
    }
    return out;
  }
  return value;
}

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * Match `{variable_name}` ONLY when not surrounded by another brace. This
 * preserves model-side Mustache templates (`{{user_name}}`) and double-brace
 * placeholders the SKILL.md tells the model to fill in itself.
 *
 * Pattern: `(?<!\{)` rejects a leading `{` (so `{{` doesn't match),
 *          `(?!\})` rejects a trailing `}` (so `}}` doesn't match).
 */
const VARIABLE_RE = /(?<!\{)\{([a-zA-Z][a-zA-Z0-9_-]*)\}(?!\})/g;

function stringField(obj: Record<string, unknown>, key: string, fallback: string): string {
  const value = obj[key];
  return typeof value === 'string' ? value : fallback;
}

function contextToLookup(ctx: BmadVariableContext): Record<string, string> {
  const out: Record<string, string> = {
    'project-root': ctx.projectRoot,
    'skill-root': ctx.skillRoot,
    'skill-name': ctx.skillName,
    user_name: ctx.userName,
    communication_language: ctx.communicationLanguage,
    document_output_language: ctx.documentOutputLanguage,
    planning_artifacts: ctx.planningArtifacts,
    implementation_artifacts: ctx.implementationArtifacts,
    project_knowledge: ctx.projectKnowledge,
    output_folder: ctx.outputFolder,
    date: ctx.date,
    project_name: ctx.projectName,
  };
  if (ctx.userSkillLevel !== undefined) out.user_skill_level = ctx.userSkillLevel;
  return out;
}

function expandText(
  text: string,
  lookup: Record<string, string>,
  depth: number,
  inFlight: Set<string>,
): string {
  if (depth > MAX_SUBSTITUTION_DEPTH) {
    throw new VariableSubstitutionError(
      'CYCLIC_VARIABLE',
      `variable expansion exceeded depth ${MAX_SUBSTITUTION_DEPTH} (cycle?) in text: ${text.slice(0, 80)}`,
    );
  }

  let changed = false;
  const replaced = text.replace(VARIABLE_RE, (match, name: string) => {
    if (!(name in lookup)) return match;
    if (inFlight.has(name)) {
      throw new VariableSubstitutionError(
        'CYCLIC_VARIABLE',
        `cycle detected expanding variable {${name}}`,
      );
    }
    const value = lookup[name];
    if (value === match) return match;
    changed = true;
    if (VARIABLE_RE.test(value)) {
      VARIABLE_RE.lastIndex = 0;
      inFlight.add(name);
      const inner = expandText(value, lookup, depth + 1, inFlight);
      inFlight.delete(name);
      return inner;
    }
    return value;
  });

  if (changed && VARIABLE_RE.test(replaced)) {
    VARIABLE_RE.lastIndex = 0;
    return expandText(replaced, lookup, depth + 1, inFlight);
  }
  VARIABLE_RE.lastIndex = 0;
  return replaced;
}

function expandAll(
  raw: Record<BmadKnownVariable, string>,
): Record<BmadKnownVariable, string> {
  const out: Record<string, string> = { ...raw };
  // Multiple passes until stable or max depth hit. This handles dependencies
  // like `output_folder = "{project-root}/_bmad-output"` and
  // `planning_artifacts = "{project-root}/_bmad-output/planning-artifacts"`.
  for (let pass = 0; pass < MAX_SUBSTITUTION_DEPTH; pass++) {
    let changed = false;
    for (const key of Object.keys(out)) {
      const before = out[key] ?? '';
      const after = expandText(before, out, 0, new Set([key]));
      if (after !== before) {
        out[key] = after;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return out as Record<BmadKnownVariable, string>;
}

// =============================================================================
// Test internals
// =============================================================================

export const __internals = {
  expandText,
  expandAll,
  contextToLookup,
  walkAndSubstitute,
  VARIABLE_RE,
  MAX_SUBSTITUTION_DEPTH,
};
