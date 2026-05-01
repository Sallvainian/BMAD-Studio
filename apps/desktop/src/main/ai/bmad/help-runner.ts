/**
 * BMad help runner
 * ================
 *
 * Wraps the `bmad-help` skill so the renderer can ask "what now?" and
 * receive a structured `BmadHelpRecommendation` instead of free-form
 * markdown. Two execution paths:
 *
 *   1. **Synchronous (default)**: compute the recommendation directly from
 *      the project's manifest + filesystem state (via `orchestrator.ts`).
 *      No model call — instant. This matches the IPC sidebar's < 50ms
 *      perceived-latency budget per ENGINE_SWAP_PROMPT.md
 *      `<engineering_standards>` "Performance budgets".
 *
 *   2. **AI-augmented (opt-in)**: invoke the `bmad-help` skill via
 *      `workflow-runner.ts`, which lets the model add narrative reasoning
 *      and grounded answers from `_meta` rows (per `bmad-help/SKILL.md`
 *      § "Data Sources"). Returns the same structured shape; the model's
 *      free-form text is captured as `narrative`.
 *
 * Per BMAD docs § "Meet BMad-Help: Your Intelligent Guide": the help skill's
 * three affordances are "Show your options", "Recommend what's next", and
 * "Answer questions". The synchronous path covers (1) and (2); the
 * AI-augmented path covers (3) when the user types a question that doesn't
 * map to an obvious skill.
 *
 * Per ENGINE_SWAP_PROMPT.md `<anti_patterns>` "Don't reimplement BMAD's
 * logic": the synchronous path replicates only the orchestrator's *routing*
 * logic (which is the BMAD's CSV interpretation, already specified in
 * `bmad-help/SKILL.md` § "CSV Interpretation"). It does NOT replicate the
 * skill's prose reasoning — that's exactly when the AI-augmented path
 * delegates to the skill itself.
 */

import type { ClaudeProfile } from '../../../shared/types/agent';
import {
  bmadFail,
  bmadOk,
  type BmadHelpRecommendation,
  type BmadIpcResult,
  type BmadTrack,
  type BmadWorkflowResult,
  type BmadWorkflowStreamChunk,
} from '../../../shared/types/bmad';
import { computeOrchestratorState, OrchestratorError } from './orchestrator';
import { runWorkflow } from './workflow-runner';

// =============================================================================
// Errors
// =============================================================================

export class HelpRunnerError extends Error {
  readonly code:
    | 'PROJECT_NOT_BMAD'
    | 'CONFIG_LOAD_FAILED'
    | 'INVALID_INPUT'
    | 'UNSUPPORTED_TRACK'
    | 'IO_ERROR';
  readonly cause?: unknown;

  constructor(code: HelpRunnerError['code'], message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'HelpRunnerError';
    this.code = code;
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

// =============================================================================
// Public API — synchronous (no AI)
// =============================================================================

export interface RunHelpOptions {
  readonly projectRoot: string;
  /** Phases 1–5 only: 'method' or 'enterprise' (D-005). */
  readonly track: BmadTrack;
}

/**
 * Compute the help recommendation directly from manifests + filesystem state.
 * Fast path — never invokes the model. Returns the same shape as the
 * AI-augmented path so the renderer's data binding doesn't switch on it.
 */
export async function runHelpSync(
  options: RunHelpOptions,
): Promise<BmadHelpRecommendation> {
  try {
    return await computeOrchestratorState({
      projectRoot: options.projectRoot,
      track: options.track,
    });
  } catch (err) {
    if (err instanceof OrchestratorError) {
      throw new HelpRunnerError(err.code === 'UNSUPPORTED_TRACK' ? 'UNSUPPORTED_TRACK' : err.code, err.message, {
        cause: err,
      });
    }
    throw err;
  }
}

/**
 * IPC-friendly wrapper: returns `BmadIpcResult<BmadHelpRecommendation>`.
 * Used by `bmad-handlers.ts` for the sidebar's primary refresh path.
 */
export async function runHelpSyncSafe(
  options: RunHelpOptions,
): Promise<BmadIpcResult<BmadHelpRecommendation>> {
  try {
    const data = await runHelpSync(options);
    return bmadOk(data);
  } catch (err) {
    if (err instanceof HelpRunnerError) {
      return bmadFail(err.code === 'CONFIG_LOAD_FAILED' ? 'IO_ERROR' : err.code, err.message);
    }
    if (err instanceof Error) return bmadFail('UNKNOWN', err.message);
    return bmadFail('UNKNOWN', 'help runner threw a non-Error value');
  }
}

// =============================================================================
// Public API — AI-augmented (free-form question answering)
// =============================================================================

export interface RunHelpAIOptions extends RunHelpOptions {
  readonly activeProfile: ClaudeProfile;
  /**
   * Free-form question to surface to the `bmad-help` skill. When omitted,
   * the skill defaults to the "what's my next step" prompt per its SKILL.md.
   */
  readonly question?: string;
  /** Optional event sink for streamed chunks of the model's narrative. */
  readonly onStreamChunk?: (chunk: BmadWorkflowStreamChunk) => void;
  /** Optional abort signal. */
  readonly abortSignal?: AbortSignal;
}

export interface BmadHelpResponse {
  readonly recommendation: BmadHelpRecommendation;
  /** Free-form text from the bmad-help skill's response. */
  readonly narrative: string;
  /** Underlying workflow result (turns / duration / outcome / output files). */
  readonly workflowResult: BmadWorkflowResult;
}

/**
 * Invoke the `bmad-help` skill via the workflow runner. Captures the
 * streamed text into `narrative`; pairs it with the synchronous
 * recommendation so the renderer can render both at once. Useful when the
 * user types a question that doesn't map to a single skill (per BMAD docs
 * § "Module docs": `bmad-help` consults `_meta` rows for grounded answers).
 */
export async function runHelpAI(options: RunHelpAIOptions): Promise<BmadHelpResponse> {
  // Compute the synchronous recommendation in parallel — we want it back
  // even if the model run errors so the sidebar shows something useful.
  const recommendationPromise = runHelpSync(options).catch((err) => {
    // Re-throw the original error type so the caller's catch block sees
    // the right shape; runHelpAI is intentionally less forgiving than
    // runHelpSync because it also requires AI auth.
    throw err;
  });

  let narrative = '';
  const captureChunk = (chunk: BmadWorkflowStreamChunk) => {
    if (chunk.kind === 'text-delta' && chunk.text) {
      narrative += chunk.text;
    }
    options.onStreamChunk?.(chunk);
  };

  const runOpts = {
    skillName: 'bmad-help',
    projectRoot: options.projectRoot,
    activeProfile: options.activeProfile,
    onStreamChunk: captureChunk,
    ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
    ...(options.question ? { args: [options.question] } : {}),
  };

  const workflowResult = await runWorkflow(runOpts);
  const recommendation = await recommendationPromise;

  return {
    recommendation,
    narrative,
    workflowResult,
  };
}

/**
 * IPC-friendly wrapper for `runHelpAI`. Captures errors and returns the
 * BMAD envelope.
 */
export async function runHelpAISafe(
  options: RunHelpAIOptions,
): Promise<BmadIpcResult<BmadHelpResponse>> {
  try {
    const data = await runHelpAI(options);
    return bmadOk(data);
  } catch (err) {
    if (err instanceof HelpRunnerError) {
      return bmadFail(err.code === 'CONFIG_LOAD_FAILED' ? 'IO_ERROR' : err.code, err.message);
    }
    if (err instanceof Error) return bmadFail('UNKNOWN', err.message);
    return bmadFail('UNKNOWN', 'help runner threw a non-Error value');
  }
}
