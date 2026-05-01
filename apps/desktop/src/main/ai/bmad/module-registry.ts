/**
 * Module registry
 * ===============
 *
 * Discovers installed BMAD modules + the workflow catalog they expose.
 * Reads from the four manifest files (via `manifest-loader.ts`) and joins them
 * into the shapes the orchestrator (Phase 2) and Kanban (Phase 3) consume.
 *
 * Per ENGINE_SWAP_PROMPT.md KAD-3 (`bmad-help.csv` is the phase-graph database)
 * + KAD-9 (modules first-class) + BMAD docs § "How Module Discovery Works".
 *
 * The registry is cache-free by design — every public method re-reads the
 * manifests. The file watcher (`file-watcher.ts`) invalidates downstream
 * caches by re-emitting `manifest-changed`; consumers re-call the registry.
 * If we add caching later it must be a pure read-side optimization with
 * watcher invalidation, not a parallel database (per ENGINE_SWAP_PROMPT.md
 * `<anti_patterns>`: "Don't write a parallel task DB").
 */

import {
  loadAllManifests,
  loadBmadHelp,
  loadManifest,
  loadSkillManifest,
  type BmadManifestBundle,
} from './manifest-loader';
import {
  BMAD_PHASES,
  type BmadHelpRow,
  type BmadModule,
  type BmadPhase,
  type BmadPhaseGraph,
  type BmadPhaseSlice,
  type BmadSkillManifestEntry,
  type BmadTrack,
  type BmadWorkflowDescriptor,
} from '../../../shared/types/bmad';

// =============================================================================
// Public API
// =============================================================================

/**
 * Return the list of installed modules per `_bmad/_config/manifest.yaml`.
 * Returns `[]` (not throws) when the file is missing — caller decides whether
 * to treat that as "not a BMAD project" or just an empty install.
 */
export async function listInstalledModules(projectRoot: string): Promise<readonly BmadModule[]> {
  const manifest = await loadManifest(projectRoot);
  return manifest?.modules ?? [];
}

/**
 * List every workflow that belongs to a module. Joins `skill-manifest.csv`
 * with `bmad-help.csv` rows so the resulting descriptors carry both the
 * skill's path AND its phase / dependencies / required flag.
 *
 * `_meta` rows are excluded — they're docs pointers, not workflows.
 */
export async function getWorkflowsForModule(
  projectRoot: string,
  moduleName: string,
): Promise<readonly BmadWorkflowDescriptor[]> {
  const skills = await loadSkillManifest(projectRoot);
  const help = await loadBmadHelp(projectRoot);
  return joinHelpWithSkills(help, skills).filter((w) => w.module === moduleName);
}

/**
 * List every workflow in the install regardless of module. Useful for the
 * Module Manager (Phase 5) and the Kanban's "anytime" lane.
 */
export async function listAllWorkflows(
  projectRoot: string,
): Promise<readonly BmadWorkflowDescriptor[]> {
  const skills = await loadSkillManifest(projectRoot);
  const help = await loadBmadHelp(projectRoot);
  return joinHelpWithSkills(help, skills);
}

/**
 * Return the full phase graph the orchestrator consumes. Slices for the four
 * lifecycle phases (`1-analysis` … `4-implementation`) plus the `anytime`
 * sidebar.
 */
export async function getPhaseGraph(projectRoot: string): Promise<BmadPhaseGraph> {
  const bundle = await loadAllManifests(projectRoot);
  return buildPhaseGraph(bundle);
}

/**
 * Return the workflows that are required-gates for a given (phase, track)
 * combination. Quick Flow ships in Phase 6 per D-005 — calling this with
 * `track: 'quick'` throws today; `'method'` and `'enterprise'` use the same
 * required set in Phase 1 (Quick Flow's special-case skip happens in the
 * orchestrator, Phase 2).
 */
export async function getRequiredWorkflowsForPhase(
  projectRoot: string,
  phase: BmadPhase,
  track: BmadTrack,
): Promise<readonly BmadWorkflowDescriptor[]> {
  if (track === 'quick') {
    throw new Error(
      'Quick Flow track ships in Phase 6 (per D-005). Use "method" or "enterprise".',
    );
  }
  const all = await listAllWorkflows(projectRoot);
  return all.filter((w) => w.phase === phase && w.required);
}

/**
 * Synchronous-style "build the graph from a pre-loaded bundle" — used by the
 * file watcher when it already has the bundle in hand and wants to compute a
 * graph without re-reading from disk.
 */
export function buildPhaseGraph(bundle: BmadManifestBundle): BmadPhaseGraph {
  const all = joinHelpWithSkills(bundle.help, bundle.skills);
  const slices: BmadPhaseSlice[] = [];
  for (const phase of BMAD_PHASES) {
    if (phase === 'anytime') continue;
    const inPhase = all.filter((w) => w.phase === phase);
    slices.push({
      phase,
      requiredWorkflows: inPhase.filter((w) => w.required),
      optionalWorkflows: inPhase.filter((w) => !w.required),
    });
  }
  const anytimeWorkflows = all.filter((w) => w.phase === 'anytime');
  return { slices, anytimeWorkflows };
}

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * Join `bmad-help.csv` rows with `skill-manifest.csv` entries into the unified
 * `BmadWorkflowDescriptor` shape. `_meta` rows are dropped.
 *
 * The resolution rules:
 * - Match `helpRow.skill` against `skillManifest.canonicalId` for the path.
 * - When a skill has multiple help rows (different actions, e.g.
 *   bmad-create-story:create vs :validate), each row produces its own
 *   descriptor — the orchestrator dispatches based on `(skill, action)`.
 * - When a help row has no matching skill manifest entry, we still emit a
 *   descriptor with `skillPath = ''` so the UI can flag it (probable install
 *   drift between bmad-help.csv and skill-manifest.csv).
 */
function joinHelpWithSkills(
  help: readonly BmadHelpRow[],
  skills: readonly BmadSkillManifestEntry[],
): BmadWorkflowDescriptor[] {
  const skillIndex = new Map<string, BmadSkillManifestEntry>();
  for (const skill of skills) {
    skillIndex.set(skill.canonicalId, skill);
  }

  const descriptors: BmadWorkflowDescriptor[] = [];
  for (const row of help) {
    if (row.kind !== 'workflow') continue;
    const skill = skillIndex.get(row.skill);
    descriptors.push({
      skillId: row.skill,
      module: skill?.module ?? row.module.toLowerCase(),
      displayName: row.displayName,
      description: row.description,
      menuCode: row.menuCode,
      action: row.action,
      args: row.args,
      phase: row.phase,
      required: row.required,
      after: row.after,
      before: row.before,
      outputLocation: row.outputLocation,
      outputs: row.outputs,
      skillPath: skill?.path ?? '',
    });
  }

  return descriptors;
}

export const __internals = { joinHelpWithSkills };
