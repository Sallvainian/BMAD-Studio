/**
 * BMad orchestrator
 * =================
 *
 * Reads the BMAD phase graph from `bmad-help.csv` (per ENGINE_SWAP_PROMPT.md
 * KAD-3 + `bmad-help/SKILL.md` § "CSV Interpretation") and computes the
 * project's lifecycle state: which phase is active, which workflows have
 * completed (by inspecting `_bmad-output/`), what's required next, and
 * what's recommended.
 *
 * Per ENGINE_SWAP_PROMPT.md KAD-9: the orchestrator's logic is the spec for
 * how `bmad-help.csv` `phase`, `after`, `before`, `required`, `output-location`,
 * and `outputs` columns are interpreted. The same routing the `bmad-help`
 * skill performs (the AI-side computation) is mirrored here in TypeScript so
 * the renderer's "what now?" sidebar can render without invoking the model.
 *
 * Phase progression rules (mirrors BMAD docs § "Step 1: Create Your Plan" +
 * § "Step 2: Build Your Project"):
 *
 *   - A phase is *complete* when every `required=true` workflow for that
 *     phase has produced its declared `outputs` files at `output-location`.
 *   - Phase 1 (Analysis) has zero required workflows by definition — the
 *     project may proceed to Phase 2 without producing any phase-1 output.
 *   - The "current phase" is the first phase whose required set is not yet
 *     complete. Once a phase completes, the orchestrator advances.
 *
 * Track behavior (per D-005):
 *   - `'method'` and `'enterprise'` use the full required set from the CSV.
 *   - `'quick'` is rejected by `module-registry.getRequiredWorkflowsForPhase`
 *     until Phase 6 ships Quick Flow support.
 */

import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

import {
  BMAD_PHASES,
  type BmadHelpRecommendation,
  type BmadHelpRow,
  type BmadOrchestratorEvent,
  type BmadOrchestratorEventKind,
  type BmadPersonaSlug,
  type BmadPhase,
  type BmadTrack,
  type BmadVariableContext,
  type BmadWorkflowAction,
  type BmadWorkflowDescriptor,
} from '../../../shared/types/bmad';
import { loadAllManifests } from './manifest-loader';
import { buildPhaseGraph } from './module-registry';
import { personaSlugFromSkillId } from './persona';
import { buildVariableContext } from './variables';

// =============================================================================
// Errors
// =============================================================================

export class OrchestratorError extends Error {
  readonly code:
    | 'PROJECT_NOT_BMAD'
    | 'CONFIG_LOAD_FAILED'
    | 'INVALID_INPUT'
    | 'UNSUPPORTED_TRACK'
    | 'IO_ERROR';
  readonly cause?: unknown;

  constructor(
    code: OrchestratorError['code'],
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = 'OrchestratorError';
    this.code = code;
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

// =============================================================================
// Public API
// =============================================================================

export interface OrchestratorEmitter {
  on(
    event: BmadOrchestratorEventKind,
    listener: (e: BmadOrchestratorEvent) => void,
  ): OrchestratorEmitter;
  off(
    event: BmadOrchestratorEventKind,
    listener: (e: BmadOrchestratorEvent) => void,
  ): OrchestratorEmitter;
  emit(event: BmadOrchestratorEventKind, payload: BmadOrchestratorEvent): boolean;
  removeAllListeners(): OrchestratorEmitter;
}

export interface ComputeStateOptions {
  readonly projectRoot: string;
  /** BMad track. Phases 1–5 only support `'method'`/`'enterprise'` (D-005). */
  readonly track: BmadTrack;
  /** Optional emitter — if supplied, state-change events fire as state shifts. */
  readonly emitter?: OrchestratorEmitter;
}

/**
 * Compute the project's lifecycle state once. Returns a structured
 * recommendation matching the `bmad-help` skill's response shape per
 * `bmad-help/SKILL.md` § "Response Format".
 */
export async function computeOrchestratorState(
  options: ComputeStateOptions,
): Promise<BmadHelpRecommendation> {
  if (options.track === 'quick') {
    throw new OrchestratorError(
      'UNSUPPORTED_TRACK',
      'Quick Flow ships in Phase 6 (per D-005). Use "method" or "enterprise".',
    );
  }

  const projectRoot = path.resolve(options.projectRoot);
  const bundle = await loadAllManifests(projectRoot).catch((err) => {
    throw new OrchestratorError(
      'PROJECT_NOT_BMAD',
      `not a BMAD project: ${(err as Error).message}`,
      { cause: err },
    );
  });

  const variables = await buildVariableContext({
    projectRoot,
    skillDir: projectRoot,
    skillName: 'orchestrator',
  }).catch((err) => {
    throw new OrchestratorError(
      'CONFIG_LOAD_FAILED',
      `failed to build variable context: ${(err as Error).message}`,
      { cause: err },
    );
  });

  const graph = buildPhaseGraph(bundle);
  const allWorkflows = [
    ...graph.slices.flatMap((s) => [...s.requiredWorkflows, ...s.optionalWorkflows]),
    ...graph.anytimeWorkflows,
  ];

  // Compute completion status for every workflow by checking its declared
  // outputs at the resolved output-location path.
  const completionMap = await Promise.all(
    allWorkflows.map(async (w) => ({
      skillId: w.skillId,
      action: w.action,
      isComplete: await isWorkflowComplete(w, variables),
    })),
  ).then((entries) =>
    new Map<string, boolean>(
      entries.map((e) => [`${e.skillId}::${e.action}`, e.isComplete]),
    ),
  );

  const currentPhase = computeCurrentPhase(graph, completionMap);

  // Required action for the current phase: the first incomplete required
  // workflow whose `after` predecessors are all complete.
  const required = findRequiredAction(currentPhase, graph, bundle.help, completionMap);
  const recommended = findRecommendedActions(currentPhase, graph, bundle.help, completionMap);
  const completed = findCompletedActions(graph, bundle.help, completionMap);

  const recommendation: BmadHelpRecommendation = {
    currentPhase,
    required,
    recommended,
    completed,
    track: options.track,
  };

  // Fire events when state shifts. Callers that don't pass an emitter still
  // get the recommendation back; the emitter is purely a notification surface.
  if (options.emitter) {
    options.emitter.emit('phase-progressed', {
      kind: 'phase-progressed',
      projectRoot,
      currentPhase,
      timestamp: Date.now(),
    });
    if (required) {
      options.emitter.emit('workflow-required', {
        kind: 'workflow-required',
        projectRoot,
        currentPhase,
        action: required,
        timestamp: Date.now(),
      });
    }
    for (const rec of recommended) {
      options.emitter.emit('workflow-recommended', {
        kind: 'workflow-recommended',
        projectRoot,
        currentPhase,
        action: rec,
        timestamp: Date.now(),
      });
    }
  }

  return recommendation;
}

// =============================================================================
// Internal helpers — completion detection
// =============================================================================

/**
 * Per BMAD docs § "Quick Reference" + `bmad-help/SKILL.md` § "Completion
 * detection": a workflow is "complete" when its declared `outputs` files
 * are present at the resolved `output-location` path.
 *
 * The `output-location` field is one of the variable names from the
 * variable surface (e.g. `planning_artifacts`). The `outputs` field is a
 * pipe-separated list of file basenames or globs. We resolve each output
 * and check `existsSync` — fast, no parsing.
 *
 * Anytime workflows (`bmad-help`, `bmad-document-project`, etc.) and
 * workflows with empty `outputs` always return false (they aren't gated).
 */
async function isWorkflowComplete(
  workflow: BmadWorkflowDescriptor,
  variables: BmadVariableContext,
): Promise<boolean> {
  if (workflow.outputs.length === 0) return false;
  if (!workflow.outputLocation) return false;
  // Some help.csv rows have a literal phrase like "prd validation report"
  // or "research documents" — those aren't filenames, they're output
  // descriptors. Treat anything that looks like a filename (contains . or /)
  // as a real output; otherwise look for any file in the resolved location
  // whose basename loosely matches.
  const baseDir = resolveLocationVariable(workflow.outputLocation, variables);
  if (!baseDir || !existsSync(baseDir)) return false;

  for (const out of workflow.outputs) {
    if (out === '*') {
      // Catch-all (e.g. bmad-document-project): any file in baseDir counts.
      const entries = await fs.readdir(baseDir).catch(() => [] as string[]);
      if (entries.length > 0) return true;
    }
    const cleaned = out.trim();
    if (!cleaned) continue;
    if (cleaned.includes('/') || cleaned.includes('.')) {
      const candidate = path.join(baseDir, cleaned);
      if (existsSync(candidate)) return true;
    } else {
      // Loose match: scan the directory for any file whose name contains
      // the descriptor as a substring (e.g. "prd" → "prd.md").
      const entries = await fs.readdir(baseDir).catch(() => [] as string[]);
      const noun = cleaned.toLowerCase().split(/\s+/)[0] ?? '';
      if (noun && entries.some((f) => f.toLowerCase().includes(noun))) return true;
    }
  }
  return false;
}

function resolveLocationVariable(
  location: string,
  variables: BmadVariableContext,
): string | null {
  // The CSV uses bare variable names like `planning_artifacts` (no curly
  // braces). Map them onto the resolved paths from BmadVariableContext.
  const trimmed = location.trim();
  if (!trimmed) return null;
  // Ignore anything that looks like a URL (e.g. _meta rows).
  if (/^https?:\/\//i.test(trimmed)) return null;
  switch (trimmed) {
    case 'planning_artifacts':
    case 'planning-artifacts':
      return variables.planningArtifacts || null;
    case 'implementation_artifacts':
    case 'implementation-artifacts':
      return variables.implementationArtifacts || null;
    case 'project_knowledge':
    case 'project-knowledge':
      return variables.projectKnowledge || null;
    case 'output_folder':
      return variables.outputFolder || null;
    default:
      // Some rows (mostly Core/internal sidecar workflows) use absolute or
      // braced paths. Substitute braces against `{output_folder}` if needed.
      if (trimmed.startsWith('{') || trimmed.startsWith('/')) return trimmed;
      return null;
  }
}

// =============================================================================
// Internal helpers — phase progression
// =============================================================================

interface PhaseGraphSnapshot {
  readonly slices: readonly {
    readonly phase: BmadPhase;
    readonly requiredWorkflows: readonly BmadWorkflowDescriptor[];
    readonly optionalWorkflows: readonly BmadWorkflowDescriptor[];
  }[];
  readonly anytimeWorkflows: readonly BmadWorkflowDescriptor[];
}

/**
 * The current phase is the first phase whose required set is not yet
 * complete. If all phases are complete, we report `4-implementation`
 * (terminal state) — the renderer can detect track-complete by inspecting
 * the recommendation's `required: null` + `recommended: []` shape.
 */
function computeCurrentPhase(
  graph: PhaseGraphSnapshot,
  completionMap: ReadonlyMap<string, boolean>,
): BmadPhase {
  for (const phase of BMAD_PHASES) {
    if (phase === 'anytime') continue;
    const slice = graph.slices.find((s) => s.phase === phase);
    if (!slice) continue;
    if (slice.requiredWorkflows.length === 0) {
      // Phase has no required workflows — proceed only if the next phase
      // has not yet started, otherwise we're already past this phase.
      // Concrete rule: if any *later* phase has a started workflow, this
      // phase is implicitly complete; otherwise this is current.
      if (!hasAnyLaterPhaseStarted(graph, completionMap, phase)) {
        return phase;
      }
      continue;
    }
    const incomplete = slice.requiredWorkflows.some(
      (w) => completionMap.get(`${w.skillId}::${w.action}`) !== true,
    );
    if (incomplete) return phase;
  }
  return '4-implementation';
}

/** Tighten the array element type after stripping the `'anytime'` sentinel. */
const NUMBERED_PHASES: ReadonlyArray<Exclude<BmadPhase, 'anytime'>> = BMAD_PHASES.filter(
  (p): p is Exclude<BmadPhase, 'anytime'> => p !== 'anytime',
);

function hasAnyLaterPhaseStarted(
  graph: PhaseGraphSnapshot,
  completionMap: ReadonlyMap<string, boolean>,
  phase: BmadPhase,
): boolean {
  const idx = NUMBERED_PHASES.indexOf(phase as Exclude<BmadPhase, 'anytime'>);
  if (idx < 0) return false;
  for (let i = idx + 1; i < NUMBERED_PHASES.length; i++) {
    const targetPhase = NUMBERED_PHASES[i];
    if (!targetPhase) continue;
    const slice = graph.slices.find((s) => s.phase === targetPhase);
    if (!slice) continue;
    const started = [...slice.requiredWorkflows, ...slice.optionalWorkflows].some(
      (w) => completionMap.get(`${w.skillId}::${w.action}`) === true,
    );
    if (started) return true;
  }
  return false;
}

// =============================================================================
// Internal helpers — action selection
// =============================================================================

/**
 * Pick the next required action for the current phase. The action is the
 * first incomplete required workflow whose `after` deps are all complete.
 */
function findRequiredAction(
  phase: BmadPhase,
  graph: PhaseGraphSnapshot,
  help: readonly BmadHelpRow[],
  completionMap: ReadonlyMap<string, boolean>,
): BmadWorkflowAction | null {
  const slice = graph.slices.find((s) => s.phase === phase);
  if (!slice) return null;
  for (const workflow of slice.requiredWorkflows) {
    const key = `${workflow.skillId}::${workflow.action}`;
    if (completionMap.get(key) === true) continue;
    // Check `after` dependencies — every dep must be complete or skippable.
    const allDepsMet = workflow.after.every((dep) => {
      const depKey = `${dep.skill}::${dep.action ?? ''}`;
      return completionMap.get(depKey) === true;
    });
    if (!allDepsMet) continue;
    return toAction(workflow, help, 'required');
  }
  return null;
}

/**
 * Recommended actions: optional workflows in the current phase + anytime
 * workflows that haven't yet been used. Doesn't include required actions
 * (those go in `required`).
 */
function findRecommendedActions(
  phase: BmadPhase,
  graph: PhaseGraphSnapshot,
  help: readonly BmadHelpRow[],
  completionMap: ReadonlyMap<string, boolean>,
): readonly BmadWorkflowAction[] {
  const slice = graph.slices.find((s) => s.phase === phase);
  const recommendations: BmadWorkflowAction[] = [];

  if (slice) {
    for (const workflow of slice.optionalWorkflows) {
      const key = `${workflow.skillId}::${workflow.action}`;
      if (completionMap.get(key) === true) continue;
      recommendations.push(toAction(workflow, help, 'optional in current phase'));
    }
  }

  // Anytime workflows (bmad-help, bmad-document-project, bmad-correct-course,
  // bmad-quick-dev, bmad-generate-project-context). Always surface these.
  for (const workflow of graph.anytimeWorkflows) {
    const key = `${workflow.skillId}::${workflow.action}`;
    if (completionMap.get(key) === true) continue;
    recommendations.push(toAction(workflow, help, 'anytime'));
  }

  return recommendations;
}

function findCompletedActions(
  graph: PhaseGraphSnapshot,
  help: readonly BmadHelpRow[],
  completionMap: ReadonlyMap<string, boolean>,
): readonly BmadWorkflowAction[] {
  const completed: BmadWorkflowAction[] = [];
  const all = [
    ...graph.slices.flatMap((s) => [...s.requiredWorkflows, ...s.optionalWorkflows]),
    ...graph.anytimeWorkflows,
  ];
  for (const workflow of all) {
    const key = `${workflow.skillId}::${workflow.action}`;
    if (completionMap.get(key) === true) {
      completed.push(toAction(workflow, help, 'completed'));
    }
  }
  return completed;
}

function toAction(
  workflow: BmadWorkflowDescriptor,
  help: readonly BmadHelpRow[],
  reason: string,
): BmadWorkflowAction {
  const helpRow = help.find(
    (r) => r.skill === workflow.skillId && r.action === workflow.action,
  );
  const persona: BmadPersonaSlug | null =
    inferPersonaForWorkflow(workflow.skillId) ?? personaSlugFromSkillId(workflow.skillId);

  return {
    skillId: workflow.skillId,
    action: workflow.action,
    displayName: helpRow?.displayName || workflow.displayName,
    menuCode: helpRow?.menuCode || workflow.menuCode,
    description: helpRow?.description || workflow.description,
    phase: workflow.phase,
    required: workflow.required,
    persona,
    rationale: reason,
  };
}

/**
 * Map a workflow skill id to the persona who owns it. Sourced from
 * INVENTORY.md §4 (mapping table) — Mary owns analysis workflows, John
 * owns planning workflows, Winston owns solutioning workflows, Amelia
 * owns implementation workflows. Returns null for skills without a
 * canonical persona (core utility skills).
 */
function inferPersonaForWorkflow(skillId: string): BmadPersonaSlug | null {
  // Direct persona skills (handled by the persona module too).
  if (skillId === 'bmad-agent-analyst') return 'mary';
  if (skillId === 'bmad-agent-tech-writer') return 'paige';
  if (skillId === 'bmad-agent-pm') return 'john';
  if (skillId === 'bmad-agent-ux-designer') return 'sally';
  if (skillId === 'bmad-agent-architect') return 'winston';
  if (skillId === 'bmad-agent-dev') return 'amelia';

  // Workflow → persona ownership per INVENTORY.md §4 mapping table.
  const PERSONA_OWNERSHIP: Record<string, BmadPersonaSlug> = {
    'bmad-product-brief': 'mary',
    'bmad-prfaq': 'mary',
    'bmad-domain-research': 'mary',
    'bmad-market-research': 'mary',
    'bmad-technical-research': 'mary',
    'bmad-document-project': 'mary',
    'bmad-create-prd': 'john',
    'bmad-validate-prd': 'john',
    'bmad-edit-prd': 'john',
    'bmad-create-epics-and-stories': 'john',
    'bmad-check-implementation-readiness': 'john',
    'bmad-create-ux-design': 'sally',
    'bmad-create-architecture': 'winston',
    'bmad-generate-project-context': 'winston',
    'bmad-sprint-planning': 'amelia',
    'bmad-sprint-status': 'amelia',
    'bmad-create-story': 'amelia',
    'bmad-dev-story': 'amelia',
    'bmad-code-review': 'amelia',
    'bmad-quick-dev': 'amelia',
    'bmad-checkpoint-preview': 'amelia',
    'bmad-qa-generate-e2e-tests': 'amelia',
    'bmad-retrospective': 'amelia',
    'bmad-correct-course': 'amelia',
  };

  return PERSONA_OWNERSHIP[skillId] ?? null;
}

// =============================================================================
// Public — typed event emitter constructor
// =============================================================================

/**
 * Construct a typed `OrchestratorEmitter`. Used by the IPC bridge to
 * surface state-change events to the renderer.
 */
export function createOrchestratorEmitter(): OrchestratorEmitter {
  const emitter = new EventEmitter();
  return {
    on(event, listener) {
      emitter.on(event, listener as (e: BmadOrchestratorEvent) => void);
      return this;
    },
    off(event, listener) {
      emitter.off(event, listener as (e: BmadOrchestratorEvent) => void);
      return this;
    },
    emit(event, payload) {
      return emitter.emit(event, payload);
    },
    removeAllListeners() {
      emitter.removeAllListeners();
      return this;
    },
  };
}

// =============================================================================
// Test internals
// =============================================================================

export const __internals = {
  computeCurrentPhase,
  isWorkflowComplete,
  resolveLocationVariable,
  findRequiredAction,
  findRecommendedActions,
  findCompletedActions,
  inferPersonaForWorkflow,
};
