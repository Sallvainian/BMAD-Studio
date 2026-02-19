/**
 * Spec Orchestrator
 * =================
 *
 * Replaces apps/backend/runners/spec_runner.py and apps/backend/spec/pipeline/orchestrator.py.
 *
 * Drives the spec creation pipeline through dynamic complexity-based phase selection:
 *   discovery → requirements → complexity_assessment → [research] → context →
 *   spec_writing → [self_critique] → planning → validation
 *
 * Each phase invokes `runSession()` with the appropriate agent type and prompt.
 * Complexity assessment determines which phases to run:
 *   - SIMPLE: discovery → requirements → quick_spec → validation (3 phases)
 *   - STANDARD: discovery → requirements → context → spec_writing → planning → validation
 *   - COMPLEX: Full pipeline including research and self-critique
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EventEmitter } from 'events';

import type { AgentType } from '../config/agent-configs';
import type { Phase } from '../config/types';
import type { SessionResult } from '../session/types';

// =============================================================================
// Constants
// =============================================================================

/** Maximum retries for a single phase */
const MAX_PHASE_RETRIES = 2;

// =============================================================================
// Types
// =============================================================================

/** Complexity tiers (matches Python spec/complexity.py) */
export type ComplexityTier = 'simple' | 'standard' | 'complex';

/** Spec creation phases (ordered) */
export type SpecPhase =
  | 'discovery'
  | 'requirements'
  | 'complexity_assessment'
  | 'historical_context'
  | 'research'
  | 'context'
  | 'spec_writing'
  | 'self_critique'
  | 'planning'
  | 'validation'
  | 'quick_spec';

/** Maps spec phases to their agent types */
const PHASE_AGENT_MAP: Record<SpecPhase, AgentType> = {
  discovery: 'spec_discovery',
  requirements: 'spec_gatherer',
  complexity_assessment: 'spec_gatherer',
  historical_context: 'spec_context',
  research: 'spec_researcher',
  context: 'spec_context',
  spec_writing: 'spec_writer',
  self_critique: 'spec_critic',
  planning: 'spec_writer',
  validation: 'spec_validation',
  quick_spec: 'spec_writer',
} as const;

/** Phases to run for each complexity tier */
const COMPLEXITY_PHASES: Record<ComplexityTier, SpecPhase[]> = {
  simple: ['discovery', 'requirements', 'quick_spec', 'validation'],
  standard: ['discovery', 'requirements', 'context', 'spec_writing', 'planning', 'validation'],
  complex: [
    'discovery',
    'requirements',
    'research',
    'context',
    'spec_writing',
    'self_critique',
    'planning',
    'validation',
  ],
} as const;

/** Configuration for the spec orchestrator */
export interface SpecOrchestratorConfig {
  /** Spec directory path */
  specDir: string;
  /** Project root directory */
  projectDir: string;
  /** Task description (what to build) */
  taskDescription?: string;
  /** Complexity override (skip AI assessment) */
  complexityOverride?: ComplexityTier;
  /** Whether to use AI for complexity assessment (default: true) */
  useAiAssessment?: boolean;
  /** CLI model override */
  cliModel?: string;
  /** CLI thinking level override */
  cliThinking?: string;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
  /** Callback to generate the system prompt for a given agent type and phase */
  generatePrompt: (agentType: AgentType, phase: SpecPhase, context: SpecPromptContext) => Promise<string>;
  /** Callback to run an agent session */
  runSession: (config: SpecSessionRunConfig) => Promise<SessionResult>;
}

/** Context passed to prompt generation */
export interface SpecPromptContext {
  /** Current phase number (1-indexed) */
  phaseNumber: number;
  /** Total phases to run */
  totalPhases: number;
  /** Current phase name */
  phaseName: SpecPhase;
  /** Task description */
  taskDescription?: string;
  /** Complexity tier (after assessment) */
  complexity?: ComplexityTier;
  /** Summaries from prior phases (for conversation compaction) */
  priorPhaseSummaries?: Record<string, string>;
  /** Retry attempt number (0 = first try) */
  attemptCount: number;
}

/** Configuration passed to runSession callback */
export interface SpecSessionRunConfig {
  agentType: AgentType;
  phase: Phase;
  systemPrompt: string;
  specDir: string;
  projectDir: string;
  sessionNumber: number;
  abortSignal?: AbortSignal;
  cliModel?: string;
  cliThinking?: string;
}

/** Result of a single phase execution */
export interface SpecPhaseResult {
  phase: SpecPhase;
  success: boolean;
  errors: string[];
  retries: number;
}

/** Events emitted by the spec orchestrator */
export interface SpecOrchestratorEvents {
  /** Phase started */
  'phase-start': (phase: SpecPhase, phaseNumber: number, totalPhases: number) => void;
  /** Phase completed */
  'phase-complete': (phase: SpecPhase, result: SpecPhaseResult) => void;
  /** Session completed within a phase */
  'session-complete': (result: SessionResult, phase: SpecPhase) => void;
  /** Spec creation finished */
  'spec-complete': (outcome: SpecOutcome) => void;
  /** Log message */
  'log': (message: string) => void;
  /** Error occurred */
  'error': (error: Error, phase: SpecPhase) => void;
}

/** Final spec creation outcome */
export interface SpecOutcome {
  success: boolean;
  complexity?: ComplexityTier;
  phasesExecuted: SpecPhase[];
  durationMs: number;
  error?: string;
}

/** Complexity assessment result (matches Python spec/complexity.py) */
interface ComplexityAssessment {
  complexity: ComplexityTier;
  confidence: number;
  reasoning: string;
  needs_research?: boolean;
  needs_self_critique?: boolean;
}

// =============================================================================
// SpecOrchestrator
// =============================================================================

/**
 * Orchestrates the spec creation pipeline with dynamic complexity adaptation.
 *
 * Replaces the Python `SpecOrchestrator` class from `spec/pipeline/orchestrator.py`.
 * Manages spec creation through a series of AI-driven phases that adapt based on
 * task complexity assessment.
 */
export class SpecOrchestrator extends EventEmitter {
  private config: SpecOrchestratorConfig;
  private sessionNumber = 0;
  private aborted = false;
  private assessment: ComplexityAssessment | null = null;
  private phaseSummaries: Record<string, string> = {};

  constructor(config: SpecOrchestratorConfig) {
    super();
    this.config = config;

    config.abortSignal?.addEventListener('abort', () => {
      this.aborted = true;
    });
  }

  /**
   * Run the full spec creation pipeline.
   *
   * Phase progression:
   * 1. Discovery — analyze project structure and gather context
   * 2. Requirements — gather and validate user requirements
   * 3. Complexity assessment — determine task complexity
   * 4. Remaining phases based on complexity tier
   * 5. Validation — validate the final spec
   */
  async run(): Promise<SpecOutcome> {
    const startTime = Date.now();
    const phasesExecuted: SpecPhase[] = [];

    try {
      // Determine complexity and phases to run
      const complexity = this.config.complexityOverride ?? 'standard';
      let phasesToRun = [...COMPLEXITY_PHASES[complexity]];

      // Run initial phases: discovery + requirements
      for (const phase of ['discovery', 'requirements'] as SpecPhase[]) {
        if (this.aborted) {
          return this.outcome(false, phasesExecuted, Date.now() - startTime, 'Cancelled');
        }

        const result = await this.runPhase(phase, phasesExecuted.length + 1, phasesToRun.length);
        phasesExecuted.push(phase);

        if (!result.success) {
          return this.outcome(false, phasesExecuted, Date.now() - startTime, result.errors.join('; '));
        }
      }

      // Run complexity assessment (if not overridden)
      if (!this.config.complexityOverride) {
        if (this.config.useAiAssessment !== false) {
          const assessResult = await this.runComplexityAssessment(phasesExecuted.length + 1);
          phasesExecuted.push('complexity_assessment');

          if (!assessResult.success) {
            // Fall back to standard complexity on assessment failure
            this.assessment = {
              complexity: 'standard',
              confidence: 0.5,
              reasoning: 'Fallback: AI assessment failed',
            };
          }
        } else {
          // Heuristic: default to standard
          this.assessment = {
            complexity: 'standard',
            confidence: 0.5,
            reasoning: 'Heuristic assessment (AI disabled)',
          };
          phasesExecuted.push('complexity_assessment');
        }

        // Update phases based on assessment
        const assessedComplexity = this.assessment?.complexity ?? 'standard';
        phasesToRun = [...COMPLEXITY_PHASES[assessedComplexity]];

        // Add research phase if needed but not already included
        if (this.assessment?.needs_research && !phasesToRun.includes('research')) {
          const contextIdx = phasesToRun.indexOf('context');
          if (contextIdx !== -1) {
            phasesToRun.splice(contextIdx, 0, 'research');
          }
        }

        // Add self-critique if needed but not already included
        if (this.assessment?.needs_self_critique && !phasesToRun.includes('self_critique')) {
          const planningIdx = phasesToRun.indexOf('planning');
          if (planningIdx !== -1) {
            phasesToRun.splice(planningIdx, 0, 'self_critique');
          }
        }
      }

      // Run remaining phases (skip already-executed discovery + requirements)
      const remainingPhases = phasesToRun.filter(
        (p) => !phasesExecuted.includes(p) && p !== 'complexity_assessment',
      );

      this.emitTyped('log', `Running ${this.assessment?.complexity ?? complexity} workflow: ${remainingPhases.join(' → ')}`);

      for (const phase of remainingPhases) {
        if (this.aborted) {
          return this.outcome(false, phasesExecuted, Date.now() - startTime, 'Cancelled');
        }

        const result = await this.runPhase(phase, phasesExecuted.length + 1, phasesToRun.length);
        phasesExecuted.push(phase);

        if (!result.success) {
          return this.outcome(false, phasesExecuted, Date.now() - startTime, result.errors.join('; '));
        }
      }

      return this.outcome(true, phasesExecuted, Date.now() - startTime);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return this.outcome(false, phasesExecuted, Date.now() - startTime, message);
    }
  }

  // ===========================================================================
  // Phase Execution
  // ===========================================================================

  /**
   * Run a single spec phase with retries.
   */
  private async runPhase(
    phase: SpecPhase,
    phaseNumber: number,
    totalPhases: number,
  ): Promise<SpecPhaseResult> {
    const agentType = PHASE_AGENT_MAP[phase];
    const errors: string[] = [];

    this.emitTyped('phase-start', phase, phaseNumber, totalPhases);

    for (let attempt = 0; attempt <= MAX_PHASE_RETRIES; attempt++) {
      if (this.aborted) {
        return { phase, success: false, errors: ['Cancelled'], retries: attempt };
      }

      this.sessionNumber++;

      const prompt = await this.config.generatePrompt(agentType, phase, {
        phaseNumber,
        totalPhases,
        phaseName: phase,
        taskDescription: this.config.taskDescription,
        complexity: this.assessment?.complexity,
        priorPhaseSummaries: Object.keys(this.phaseSummaries).length > 0 ? this.phaseSummaries : undefined,
        attemptCount: attempt,
      });

      const result = await this.config.runSession({
        agentType,
        phase: 'spec',
        systemPrompt: prompt,
        specDir: this.config.specDir,
        projectDir: this.config.projectDir,
        sessionNumber: this.sessionNumber,
        abortSignal: this.config.abortSignal,
        cliModel: this.config.cliModel,
        cliThinking: this.config.cliThinking,
      });

      this.emitTyped('session-complete', result, phase);

      if (result.outcome === 'cancelled') {
        return { phase, success: false, errors: ['Cancelled'], retries: attempt };
      }

      if (result.outcome === 'completed' || result.outcome === 'max_steps') {
        const phaseResult: SpecPhaseResult = { phase, success: true, errors: [], retries: attempt };
        this.emitTyped('phase-complete', phase, phaseResult);
        return phaseResult;
      }

      // Error — collect and maybe retry
      const errorMsg = result.error?.message ?? `Phase ${phase} failed with outcome: ${result.outcome}`;
      errors.push(errorMsg);

      // Non-retryable errors
      if (result.outcome === 'auth_failure') {
        return { phase, success: false, errors, retries: attempt };
      }

      if (attempt < MAX_PHASE_RETRIES) {
        this.emitTyped('log', `Phase ${phase} failed (attempt ${attempt + 1}), retrying...`);
      }
    }

    const failResult: SpecPhaseResult = { phase, success: false, errors, retries: MAX_PHASE_RETRIES };
    this.emitTyped('phase-complete', phase, failResult);
    return failResult;
  }

  /**
   * Run AI complexity assessment by invoking the complexity assessor agent.
   */
  private async runComplexityAssessment(
    phaseNumber: number,
  ): Promise<SpecPhaseResult> {
    this.emitTyped('phase-start', 'complexity_assessment', phaseNumber, 0);
    this.sessionNumber++;

    const prompt = await this.config.generatePrompt('spec_gatherer', 'complexity_assessment', {
      phaseNumber,
      totalPhases: 0,
      phaseName: 'complexity_assessment',
      taskDescription: this.config.taskDescription,
      attemptCount: 0,
    });

    const result = await this.config.runSession({
      agentType: 'spec_gatherer',
      phase: 'spec',
      systemPrompt: prompt,
      specDir: this.config.specDir,
      projectDir: this.config.projectDir,
      sessionNumber: this.sessionNumber,
      abortSignal: this.config.abortSignal,
      cliModel: this.config.cliModel,
      cliThinking: this.config.cliThinking,
    });

    this.emitTyped('session-complete', result, 'complexity_assessment');

    if (result.outcome === 'cancelled') {
      return { phase: 'complexity_assessment', success: false, errors: ['Cancelled'], retries: 0 };
    }

    // Try to load assessment from file
    try {
      const assessmentPath = join(this.config.specDir, 'complexity_assessment.json');
      const raw = await readFile(assessmentPath, 'utf-8');
      const parsed = JSON.parse(raw) as ComplexityAssessment;

      // Validate
      if (['simple', 'standard', 'complex'].includes(parsed.complexity)) {
        this.assessment = parsed;
        this.emitTyped('log', `Complexity assessed: ${parsed.complexity} (confidence: ${(parsed.confidence * 100).toFixed(0)}%)`);
        return { phase: 'complexity_assessment', success: true, errors: [], retries: 0 };
      }
    } catch {
      // Assessment file not found or invalid — fall through
    }

    // If assessment file wasn't written, treat as failure (caller will fallback)
    return {
      phase: 'complexity_assessment',
      success: false,
      errors: ['Complexity assessment file not created or invalid'],
      retries: 0,
    };
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private outcome(
    success: boolean,
    phasesExecuted: SpecPhase[],
    durationMs: number,
    error?: string,
  ): SpecOutcome {
    const outcome: SpecOutcome = {
      success,
      complexity: this.assessment?.complexity,
      phasesExecuted,
      durationMs,
      error,
    };

    this.emitTyped('spec-complete', outcome);
    return outcome;
  }

  /**
   * Typed event emitter helper.
   */
  private emitTyped<K extends keyof SpecOrchestratorEvents>(
    event: K,
    ...args: Parameters<SpecOrchestratorEvents[K]>
  ): void {
    this.emit(event, ...args);
  }
}
