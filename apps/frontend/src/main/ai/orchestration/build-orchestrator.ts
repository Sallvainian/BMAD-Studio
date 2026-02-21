/**
 * Build Orchestrator
 * ==================
 *
 * Replaces apps/backend/run.py main build loop.
 * Drives the full build lifecycle through phase progression:
 *   planning → coding → qa_review → qa_fixing → complete/failed
 *
 * Each phase invokes `runAgentSession()` with the appropriate agent type,
 * system prompt, and configuration. Phase transitions follow the ordering
 * defined in phase-protocol.ts.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EventEmitter } from 'events';

import type { ExecutionPhase } from '../../../shared/constants/phase-protocol';
import {
  isTerminalPhase,
  isValidPhaseTransition,
  type CompletablePhase,
} from '../../../shared/constants/phase-protocol';
import type { AgentType } from '../config/agent-configs';
import type { Phase } from '../config/types';
import type { SessionResult } from '../session/types';
import { iterateSubtasks } from './subtask-iterator';
import type { SubtaskIteratorConfig, SubtaskResult } from './subtask-iterator';

// =============================================================================
// Constants
// =============================================================================

/** Delay between iterations when auto-continuing (ms) */
const AUTO_CONTINUE_DELAY_MS = 3_000;

/** Maximum planning validation retries before failing */
const MAX_PLANNING_VALIDATION_RETRIES = 3;

/** Maximum retries for a single subtask before marking stuck */
const MAX_SUBTASK_RETRIES = 3;

/** Delay before retrying after an error (ms) */
const ERROR_RETRY_DELAY_MS = 5_000;

// =============================================================================
// Types
// =============================================================================

/** Build phase mapped to agent type */
type BuildPhase = 'planning' | 'coding' | 'qa_review' | 'qa_fixing';

/** Maps build phases to their agent types */
const PHASE_AGENT_MAP: Record<BuildPhase, AgentType> = {
  planning: 'planner',
  coding: 'coder',
  qa_review: 'qa_reviewer',
  qa_fixing: 'qa_fixer',
} as const;

/** Maps build phases to config phase keys */
const PHASE_CONFIG_MAP: Record<BuildPhase, Phase> = {
  planning: 'planning',
  coding: 'coding',
  qa_review: 'qa',
  qa_fixing: 'qa',
} as const;

/** Configuration for the build orchestrator */
export interface BuildOrchestratorConfig {
  /** Spec directory path (e.g., .auto-claude/specs/001-feature/) */
  specDir: string;
  /** Project root directory */
  projectDir: string;
  /** Source spec directory in main project (for worktree syncing) */
  sourceSpecDir?: string;
  /** CLI model override */
  cliModel?: string;
  /** CLI thinking level override */
  cliThinking?: string;
  /** Maximum iterations (0 = unlimited) */
  maxIterations?: number;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
  /** Callback to generate the system prompt for a given agent type and phase */
  generatePrompt: (agentType: AgentType, phase: BuildPhase, context: PromptContext) => Promise<string>;
  /** Callback to run an agent session */
  runSession: (config: SessionRunConfig) => Promise<SessionResult>;
  /** Optional callback for syncing spec to source (worktree mode) */
  syncSpecToSource?: (specDir: string, sourceSpecDir: string) => Promise<boolean>;
}

/** Context passed to prompt generation */
export interface PromptContext {
  /** Current iteration number */
  iteration: number;
  /** Current subtask (if in coding phase) */
  subtask?: SubtaskInfo;
  /** Planning retry context (if replanning after validation failure) */
  planningRetryContext?: string;
  /** Recovery hints for subtask retries */
  recoveryHints?: string;
  /** Number of previous attempts on current subtask */
  attemptCount: number;
}

/** Minimal subtask info for prompt generation */
export interface SubtaskInfo {
  id: string;
  description: string;
  phaseName?: string;
  filesToCreate?: string[];
  filesToModify?: string[];
  status: string;
}

/** Configuration passed to runSession callback */
export interface SessionRunConfig {
  agentType: AgentType;
  phase: Phase;
  systemPrompt: string;
  specDir: string;
  projectDir: string;
  subtaskId?: string;
  sessionNumber: number;
  abortSignal?: AbortSignal;
  cliModel?: string;
  cliThinking?: string;
}

/** Events emitted by the build orchestrator */
export interface BuildOrchestratorEvents {
  /** Phase transition */
  'phase-change': (phase: ExecutionPhase, message: string) => void;
  /** Iteration started */
  'iteration-start': (iteration: number, phase: BuildPhase) => void;
  /** Session completed */
  'session-complete': (result: SessionResult, phase: BuildPhase) => void;
  /** Build finished (success or failure) */
  'build-complete': (outcome: BuildOutcome) => void;
  /** Log message */
  'log': (message: string) => void;
  /** Error occurred */
  'error': (error: Error, phase: BuildPhase) => void;
}

/** Final build outcome */
export interface BuildOutcome {
  /** Whether the build succeeded */
  success: boolean;
  /** Final phase reached */
  finalPhase: ExecutionPhase;
  /** Total iterations executed */
  totalIterations: number;
  /** Total duration in ms */
  durationMs: number;
  /** Error message if failed */
  error?: string;
}

// =============================================================================
// Implementation Plan Types
// =============================================================================

/** Structure of implementation_plan.json */
interface ImplementationPlan {
  feature?: string;
  workflow_type?: string;
  phases: PlanPhase[];
}

interface PlanPhase {
  id?: string;
  phase?: number;
  name: string;
  subtasks: PlanSubtask[];
}

interface PlanSubtask {
  id: string;
  description: string;
  status: string;
  files_to_create?: string[];
  files_to_modify?: string[];
}

// =============================================================================
// BuildOrchestrator
// =============================================================================

/**
 * Orchestrates the full build lifecycle through phase progression.
 *
 * Replaces the Python `run_autonomous_agent()` main loop in `agents/coder.py`.
 * Manages transitions between planning, coding, QA review, and QA fixing phases.
 */
export class BuildOrchestrator extends EventEmitter {
  private config: BuildOrchestratorConfig;
  private currentPhase: ExecutionPhase = 'idle';
  private completedPhases: CompletablePhase[] = [];
  private iteration = 0;
  private aborted = false;

  constructor(config: BuildOrchestratorConfig) {
    super();
    this.config = config;

    // Listen for abort
    config.abortSignal?.addEventListener('abort', () => {
      this.aborted = true;
    });
  }

  /**
   * Run the full build lifecycle.
   *
   * Phase progression:
   * 1. Check if implementation_plan.json exists
   *    - No: Run planning phase to create it
   *    - Yes: Skip to coding
   * 2. Run coding phase (iterate subtasks)
   * 3. Run QA review
   * 4. If QA fails: run QA fixing, then re-review
   * 5. Complete or fail
   */
  async run(): Promise<BuildOutcome> {
    const startTime = Date.now();

    try {
      // Determine starting phase
      const isFirstRun = await this.isFirstRun();

      if (isFirstRun) {
        // Planning phase
        const planResult = await this.runPlanningPhase();
        if (!planResult.success) {
          return this.buildOutcome(false, Date.now() - startTime, planResult.error);
        }
      }

      // Check if build is already complete
      if (await this.isBuildComplete()) {
        this.transitionPhase('complete', 'Build already complete');
        return this.buildOutcome(true, Date.now() - startTime);
      }

      // Coding phase
      const codingResult = await this.runCodingPhase();
      if (!codingResult.success) {
        return this.buildOutcome(false, Date.now() - startTime, codingResult.error);
      }

      // QA review phase
      const qaResult = await this.runQAPhase();
      return this.buildOutcome(qaResult.success, Date.now() - startTime, qaResult.error);

    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.transitionPhase('failed', `Build failed: ${message}`);
      return this.buildOutcome(false, Date.now() - startTime, message);
    }
  }

  // ===========================================================================
  // Phase Runners
  // ===========================================================================

  /**
   * Run the planning phase: invoke planner agent to create implementation_plan.json.
   */
  private async runPlanningPhase(): Promise<{ success: boolean; error?: string }> {
    this.transitionPhase('planning', 'Creating implementation plan');
    let planningRetryContext: string | undefined;
    let validationFailures = 0;

    for (let attempt = 0; attempt < MAX_PLANNING_VALIDATION_RETRIES + 1; attempt++) {
      if (this.aborted) {
        return { success: false, error: 'Build cancelled' };
      }

      this.iteration++;
      this.emitTyped('iteration-start', this.iteration, 'planning');

      const prompt = await this.config.generatePrompt('planner', 'planning', {
        iteration: this.iteration,
        planningRetryContext,
        attemptCount: attempt,
      });

      const result = await this.config.runSession({
        agentType: 'planner',
        phase: 'planning',
        systemPrompt: prompt,
        specDir: this.config.specDir,
        projectDir: this.config.projectDir,
        sessionNumber: this.iteration,
        abortSignal: this.config.abortSignal,
        cliModel: this.config.cliModel,
        cliThinking: this.config.cliThinking,
      });

      this.emitTyped('session-complete', result, 'planning');

      if (result.outcome === 'cancelled') {
        return { success: false, error: 'Build cancelled' };
      }

      if (result.outcome === 'error' || result.outcome === 'auth_failure' || result.outcome === 'rate_limited') {
        return { success: false, error: result.error?.message ?? 'Planning session failed' };
      }

      // Normalize subtask IDs before validation: some LLMs write "subtask_id" not "id"
      await this.normalizeSubtaskIds();

      // Validate the implementation plan
      const validation = await this.validateImplementationPlan();
      if (validation.valid) {
        // Sync to source if in worktree mode
        if (this.config.sourceSpecDir && this.config.syncSpecToSource) {
          await this.config.syncSpecToSource(this.config.specDir, this.config.sourceSpecDir);
        }
        this.markPhaseCompleted('planning');
        return { success: true };
      }

      // Plan is invalid — retry
      validationFailures++;
      if (validationFailures >= MAX_PLANNING_VALIDATION_RETRIES) {
        return {
          success: false,
          error: `Implementation plan validation failed after ${validationFailures} attempts: ${validation.errors.join(', ')}`,
        };
      }

      planningRetryContext =
        '## IMPLEMENTATION PLAN VALIDATION ERRORS\n\n' +
        'The previous `implementation_plan.json` is INVALID.\n' +
        'You MUST rewrite it to match the required schema:\n' +
        '- Top-level: `feature`, `workflow_type`, `phases`\n' +
        '- Each phase: `id` (or `phase`) and `name`, and `subtasks`\n' +
        '- Each subtask: `id`, `description`, `status` (use `pending` for not started)\n\n' +
        'Validation errors:\n' +
        validation.errors.map((e) => `- ${e}`).join('\n');

      this.emitTyped('log', `Plan validation failed (attempt ${validationFailures}), retrying...`);
    }

    return { success: false, error: 'Planning exhausted all retries' };
  }

  /**
   * Run the coding phase: iterate through subtasks and invoke coder agent.
   */
  private async runCodingPhase(): Promise<{ success: boolean; error?: string }> {
    this.transitionPhase('coding', 'Starting implementation');

    const iteratorConfig: SubtaskIteratorConfig = {
      specDir: this.config.specDir,
      projectDir: this.config.projectDir,
      maxRetries: MAX_SUBTASK_RETRIES,
      autoContinueDelayMs: AUTO_CONTINUE_DELAY_MS,
      abortSignal: this.config.abortSignal,
      onSubtaskStart: (subtask, attempt) => {
        this.iteration++;
        this.emitTyped('iteration-start', this.iteration, 'coding');
        this.emitTyped('log', `Working on ${subtask.id}: ${subtask.description} (attempt ${attempt})`);
      },
      runSubtaskSession: async (subtask, attempt) => {
        const prompt = await this.config.generatePrompt('coder', 'coding', {
          iteration: this.iteration,
          subtask,
          attemptCount: attempt,
        });

        return this.config.runSession({
          agentType: 'coder',
          phase: 'coding',
          systemPrompt: prompt,
          specDir: this.config.specDir,
          projectDir: this.config.projectDir,
          subtaskId: subtask.id,
          sessionNumber: this.iteration,
          abortSignal: this.config.abortSignal,
          cliModel: this.config.cliModel,
          cliThinking: this.config.cliThinking,
        });
      },
      onSubtaskComplete: (subtask, result) => {
        this.emitTyped('session-complete', result, 'coding');
      },
      onSubtaskStuck: (subtask, reason) => {
        this.emitTyped('log', `Subtask ${subtask.id} stuck: ${reason}`);
      },
    };

    const iteratorResult = await iterateSubtasks(iteratorConfig);

    if (iteratorResult.cancelled) {
      return { success: false, error: 'Build cancelled' };
    }

    if (iteratorResult.stuckSubtasks.length > 0 && iteratorResult.completedSubtasks === 0) {
      return {
        success: false,
        error: `All subtasks stuck: ${iteratorResult.stuckSubtasks.join(', ')}`,
      };
    }

    // Sync after coding
    if (this.config.sourceSpecDir && this.config.syncSpecToSource) {
      await this.config.syncSpecToSource(this.config.specDir, this.config.sourceSpecDir);
    }

    this.markPhaseCompleted('coding');
    return { success: true };
  }

  /**
   * Run QA review and optional QA fixing loop.
   */
  private async runQAPhase(): Promise<{ success: boolean; error?: string }> {
    // QA review
    this.transitionPhase('qa_review', 'Running QA review');

    const maxQACycles = 3;
    for (let cycle = 0; cycle < maxQACycles; cycle++) {
      if (this.aborted) {
        return { success: false, error: 'Build cancelled' };
      }

      this.iteration++;
      this.emitTyped('iteration-start', this.iteration, 'qa_review');

      const reviewPrompt = await this.config.generatePrompt('qa_reviewer', 'qa_review', {
        iteration: this.iteration,
        attemptCount: cycle,
      });

      const reviewResult = await this.config.runSession({
        agentType: 'qa_reviewer',
        phase: 'qa',
        systemPrompt: reviewPrompt,
        specDir: this.config.specDir,
        projectDir: this.config.projectDir,
        sessionNumber: this.iteration,
        abortSignal: this.config.abortSignal,
        cliModel: this.config.cliModel,
        cliThinking: this.config.cliThinking,
      });

      this.emitTyped('session-complete', reviewResult, 'qa_review');

      if (reviewResult.outcome === 'cancelled') {
        return { success: false, error: 'Build cancelled' };
      }

      // Check QA result
      const qaStatus = await this.readQAStatus();

      if (qaStatus === 'passed') {
        this.markPhaseCompleted('qa_review');
        this.transitionPhase('complete', 'Build complete - QA passed');
        return { success: true };
      }

      if (qaStatus === 'failed' && cycle < maxQACycles - 1) {
        // Run QA fixer
        this.transitionPhase('qa_fixing', 'Fixing QA issues');
        this.markPhaseCompleted('qa_review');

        this.iteration++;
        this.emitTyped('iteration-start', this.iteration, 'qa_fixing');

        const fixPrompt = await this.config.generatePrompt('qa_fixer', 'qa_fixing', {
          iteration: this.iteration,
          attemptCount: cycle,
        });

        const fixResult = await this.config.runSession({
          agentType: 'qa_fixer',
          phase: 'qa',
          systemPrompt: fixPrompt,
          specDir: this.config.specDir,
          projectDir: this.config.projectDir,
          sessionNumber: this.iteration,
          abortSignal: this.config.abortSignal,
          cliModel: this.config.cliModel,
          cliThinking: this.config.cliThinking,
        });

        this.emitTyped('session-complete', fixResult, 'qa_fixing');
        this.markPhaseCompleted('qa_fixing');

        // Loop back to QA review
        this.transitionPhase('qa_review', 'Re-running QA review after fixes');
        continue;
      }

      // QA failed and no more cycles
      this.transitionPhase('failed', 'QA review failed after maximum fix cycles');
      return { success: false, error: 'QA review failed after maximum fix cycles' };
    }

    return { success: false, error: 'QA exhausted all cycles' };
  }

  // ===========================================================================
  // Phase Transition
  // ===========================================================================

  /**
   * Transition to a new execution phase with validation.
   */
  private transitionPhase(phase: ExecutionPhase, message: string): void {
    if (isTerminalPhase(this.currentPhase) && !isTerminalPhase(phase)) {
      return; // Cannot leave terminal phase
    }

    if (!isValidPhaseTransition(this.currentPhase, phase, this.completedPhases)) {
      this.emitTyped('log', `Blocked phase transition: ${this.currentPhase} -> ${phase}`);
      return;
    }

    this.currentPhase = phase;
    this.emitTyped('phase-change', phase, message);
  }

  /**
   * Mark a build phase as completed.
   */
  private markPhaseCompleted(phase: CompletablePhase): void {
    if (!this.completedPhases.includes(phase)) {
      this.completedPhases.push(phase);
    }
  }

  // ===========================================================================
  // Plan Validation
  // ===========================================================================

  /**
   * Normalize subtask ID fields written by the planner.
   *
   * Some LLMs write "subtask_id" instead of "id". This step runs after each
   * planner session and before validation so the subtask iterator can reliably
   * look up subtasks by their "id" field.
   *
   * Only ADD/UPDATE fields — never removes existing data.
   */
  private async normalizeSubtaskIds(): Promise<void> {
    const planPath = join(this.config.specDir, 'implementation_plan.json');
    try {
      const raw = await readFile(planPath, 'utf-8');
      const plan = JSON.parse(raw) as ImplementationPlan;
      let updated = false;

      for (const phase of plan.phases) {
        // Normalize phase_id → id
        const phaseAny = phase as PlanPhase & { phase_id?: string };
        if (phaseAny.phase_id && !phase.id && phase.phase === undefined) {
          phase.id = phaseAny.phase_id;
          updated = true;
        }
        // Ensure phase has a name (fall back to title or id)
        if (!phase.name) {
          const anyPhase = phase as PlanPhase & { title?: string };
          phase.name = anyPhase.title ?? phase.id ?? 'Phase';
          updated = true;
        }

        if (!Array.isArray(phase.subtasks)) continue;

        for (const subtask of phase.subtasks) {
          // Normalize subtask_id → id
          const withLegacyId = subtask as PlanSubtask & { subtask_id?: string };
          if (withLegacyId.subtask_id && !subtask.id) {
            subtask.id = withLegacyId.subtask_id;
            updated = true;
          }
          // Add default status if missing (critical for subtask iterator)
          if (!subtask.status) {
            subtask.status = 'pending';
            updated = true;
          }
          // Normalize file_paths → files_to_modify for iterator compatibility
          const withFilePaths = subtask as PlanSubtask & { file_paths?: string[] };
          if (withFilePaths.file_paths && !subtask.files_to_modify) {
            subtask.files_to_modify = withFilePaths.file_paths;
            updated = true;
          }
        }
      }

      if (updated) {
        await writeFile(planPath, JSON.stringify(plan, null, 2));
        console.warn('[BuildOrchestrator] Normalized implementation plan schema');
      }
    } catch {
      // Non-fatal: if the plan doesn't exist yet validation will catch it
    }
  }

  /**
   * Validate the implementation plan exists and has correct structure.
   */
  private async validateImplementationPlan(): Promise<{ valid: boolean; errors: string[] }> {
    const planPath = join(this.config.specDir, 'implementation_plan.json');
    const errors: string[] = [];

    try {
      const raw = await readFile(planPath, 'utf-8');
      const plan = JSON.parse(raw) as ImplementationPlan;

      if (!plan.phases || !Array.isArray(plan.phases)) {
        errors.push('Missing or invalid "phases" array');
        return { valid: false, errors };
      }

      if (plan.phases.length === 0) {
        errors.push('No phases defined');
        return { valid: false, errors };
      }

      for (const phase of plan.phases) {
        if (!phase.name) {
          errors.push('Phase missing "name"');
        }
        if (!phase.id && phase.phase === undefined) {
          errors.push(`Phase "${phase.name ?? 'unknown'}" missing "id" or "phase" field`);
        }
        if (!Array.isArray(phase.subtasks)) {
          errors.push(`Phase "${phase.name ?? 'unknown'}" missing "subtasks" array`);
          continue;
        }
        for (const subtask of phase.subtasks) {
          if (!subtask.id) {
            errors.push(`Subtask in phase "${phase.name ?? 'unknown'}" missing "id"`);
          }
          if (!subtask.description) {
            errors.push(`Subtask "${subtask.id ?? 'unknown'}" missing "description"`);
          }
          if (!subtask.status) {
            errors.push(`Subtask "${subtask.id ?? 'unknown'}" missing "status"`);
          }
        }
      }

      return { valid: errors.length === 0, errors };
    } catch (error: unknown) {
      if (error instanceof SyntaxError) {
        errors.push(`Invalid JSON: ${error.message}`);
      } else {
        errors.push('implementation_plan.json not found');
      }
      return { valid: false, errors };
    }
  }

  // ===========================================================================
  // State Queries
  // ===========================================================================

  /**
   * Check if this is a first run (no implementation plan exists).
   */
  private async isFirstRun(): Promise<boolean> {
    const planPath = join(this.config.specDir, 'implementation_plan.json');
    try {
      await readFile(planPath, 'utf-8');
      return false;
    } catch {
      return true;
    }
  }

  /**
   * Check if all subtasks in the implementation plan are completed.
   */
  private async isBuildComplete(): Promise<boolean> {
    const planPath = join(this.config.specDir, 'implementation_plan.json');
    try {
      const raw = await readFile(planPath, 'utf-8');
      const plan = JSON.parse(raw) as ImplementationPlan;

      for (const phase of plan.phases) {
        for (const subtask of phase.subtasks) {
          if (subtask.status !== 'completed') {
            return false;
          }
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Read QA status from the spec directory.
   * Returns 'passed', 'failed', or 'unknown'.
   */
  private async readQAStatus(): Promise<'passed' | 'failed' | 'unknown'> {
    const qaReportPath = join(this.config.specDir, 'qa_report.md');
    try {
      const content = await readFile(qaReportPath, 'utf-8');
      const lower = content.toLowerCase();
      if (lower.includes('status: passed') || lower.includes('status: approved')) {
        return 'passed';
      }
      if (lower.includes('status: failed') || lower.includes('status: issues')) {
        return 'failed';
      }
      return 'unknown';
    } catch {
      return 'unknown';
    }
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private buildOutcome(success: boolean, durationMs: number, error?: string): BuildOutcome {
    const outcome: BuildOutcome = {
      success,
      finalPhase: this.currentPhase,
      totalIterations: this.iteration,
      durationMs,
      error,
    };

    if (!success && !isTerminalPhase(this.currentPhase)) {
      this.transitionPhase('failed', error ?? 'Build failed');
    }

    this.emitTyped('build-complete', outcome);
    return outcome;
  }

  /**
   * Typed event emitter helper.
   */
  private emitTyped<K extends keyof BuildOrchestratorEvents>(
    event: K,
    ...args: Parameters<BuildOrchestratorEvents[K]>
  ): void {
    this.emit(event, ...args);
  }
}
