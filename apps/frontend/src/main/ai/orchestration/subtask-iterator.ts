/**
 * Subtask Iterator
 * ================
 *
 * Replaces the subtask iteration loop in apps/backend/agents/coder.py.
 * Reads implementation_plan.json, finds the next pending subtask, invokes
 * the coder agent session, and tracks completion/retry/stuck state.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { SessionResult } from '../session/types';
import type { SubtaskInfo } from './build-orchestrator';

// =============================================================================
// Types
// =============================================================================

/** Configuration for the subtask iterator */
export interface SubtaskIteratorConfig {
  /** Spec directory containing implementation_plan.json */
  specDir: string;
  /** Project root directory */
  projectDir: string;
  /** Maximum retries per subtask before marking stuck */
  maxRetries: number;
  /** Delay between subtask iterations (ms) */
  autoContinueDelayMs: number;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
  /** Called when a subtask starts */
  onSubtaskStart?: (subtask: SubtaskInfo, attempt: number) => void;
  /** Run the coder session for a subtask; returns the session result */
  runSubtaskSession: (subtask: SubtaskInfo, attempt: number) => Promise<SessionResult>;
  /** Called when a subtask session completes */
  onSubtaskComplete?: (subtask: SubtaskInfo, result: SessionResult) => void;
  /** Called when a subtask is marked stuck */
  onSubtaskStuck?: (subtask: SubtaskInfo, reason: string) => void;
}

/** Result of the full subtask iteration */
export interface SubtaskIteratorResult {
  /** Total subtasks processed */
  totalSubtasks: number;
  /** Number of completed subtasks */
  completedSubtasks: number;
  /** IDs of subtasks marked as stuck */
  stuckSubtasks: string[];
  /** Whether iteration was cancelled */
  cancelled: boolean;
}

/** Single subtask result for internal tracking */
export interface SubtaskResult {
  subtaskId: string;
  success: boolean;
  attempts: number;
  stuck: boolean;
  error?: string;
}

// =============================================================================
// Implementation Plan Types
// =============================================================================

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
// Core Functions
// =============================================================================

/**
 * Iterate through all pending subtasks in the implementation plan.
 *
 * Replaces the inner subtask loop in agents/coder.py:
 * - Reads implementation_plan.json for the next pending subtask
 * - Invokes the coder agent session
 * - Re-reads the plan after each session (the agent updates subtask status)
 * - Tracks retry counts and marks subtasks as stuck after max retries
 * - Continues until all subtasks complete or build is stuck
 */
export async function iterateSubtasks(
  config: SubtaskIteratorConfig,
): Promise<SubtaskIteratorResult> {
  const attemptCounts = new Map<string, number>();
  const stuckSubtasks: string[] = [];
  let completedSubtasks = 0;
  let totalSubtasks = 0;

  while (true) {
    // Check cancellation
    if (config.abortSignal?.aborted) {
      return { totalSubtasks, completedSubtasks, stuckSubtasks, cancelled: true };
    }

    // Load the plan and find next pending subtask
    const plan = await loadImplementationPlan(config.specDir);
    if (!plan) {
      return { totalSubtasks: 0, completedSubtasks: 0, stuckSubtasks, cancelled: false };
    }

    // Count totals
    totalSubtasks = countTotalSubtasks(plan);
    completedSubtasks = countCompletedSubtasks(plan);

    // Find next subtask
    const next = getNextPendingSubtask(plan, stuckSubtasks);
    if (!next) {
      // All subtasks completed or stuck
      break;
    }

    const { subtask, phaseName } = next;
    const subtaskInfo: SubtaskInfo = {
      id: subtask.id,
      description: subtask.description,
      phaseName,
      filesToCreate: subtask.files_to_create,
      filesToModify: subtask.files_to_modify,
      status: subtask.status,
    };

    // Track attempts
    const currentAttempt = (attemptCounts.get(subtask.id) ?? 0) + 1;
    attemptCounts.set(subtask.id, currentAttempt);

    // Check if stuck
    if (currentAttempt > config.maxRetries) {
      stuckSubtasks.push(subtask.id);
      config.onSubtaskStuck?.(
        subtaskInfo,
        `Exceeded max retries (${config.maxRetries})`,
      );
      continue;
    }

    // Notify start
    config.onSubtaskStart?.(subtaskInfo, currentAttempt);

    // Run the session
    const result = await config.runSubtaskSession(subtaskInfo, currentAttempt);

    // Notify complete
    config.onSubtaskComplete?.(subtaskInfo, result);

    // Handle outcomes
    if (result.outcome === 'cancelled') {
      return { totalSubtasks, completedSubtasks, stuckSubtasks, cancelled: true };
    }

    if (result.outcome === 'rate_limited') {
      // Caller (build orchestrator) handles rate limit pausing
      return { totalSubtasks, completedSubtasks, stuckSubtasks, cancelled: false };
    }

    if (result.outcome === 'auth_failure') {
      return { totalSubtasks, completedSubtasks, stuckSubtasks, cancelled: false };
    }

    // For errors, the subtask will be retried on next loop iteration
    // (implementation_plan.json status remains in_progress or pending)

    // Delay before next iteration
    if (config.autoContinueDelayMs > 0) {
      await delay(config.autoContinueDelayMs, config.abortSignal);
    }
  }

  return { totalSubtasks, completedSubtasks, stuckSubtasks, cancelled: false };
}

// =============================================================================
// Plan Queries
// =============================================================================

/**
 * Load and parse implementation_plan.json.
 */
async function loadImplementationPlan(
  specDir: string,
): Promise<ImplementationPlan | null> {
  const planPath = join(specDir, 'implementation_plan.json');
  try {
    const raw = await readFile(planPath, 'utf-8');
    return JSON.parse(raw) as ImplementationPlan;
  } catch {
    return null;
  }
}

/**
 * Get the next pending subtask from the plan.
 * Skips subtasks that are completed, in_progress (may be worked on by another session),
 * or marked as stuck.
 */
function getNextPendingSubtask(
  plan: ImplementationPlan,
  stuckSubtaskIds: string[],
): { subtask: PlanSubtask; phaseName: string } | null {
  for (const phase of plan.phases) {
    for (const subtask of phase.subtasks) {
      if (
        subtask.status === 'pending' &&
        !stuckSubtaskIds.includes(subtask.id)
      ) {
        return { subtask, phaseName: phase.name };
      }
      // Also pick up in_progress subtasks (may need retry after crash)
      if (
        subtask.status === 'in_progress' &&
        !stuckSubtaskIds.includes(subtask.id)
      ) {
        return { subtask, phaseName: phase.name };
      }
    }
  }
  return null;
}

/**
 * Count total subtasks across all phases.
 */
function countTotalSubtasks(plan: ImplementationPlan): number {
  let count = 0;
  for (const phase of plan.phases) {
    count += phase.subtasks.length;
  }
  return count;
}

/**
 * Count completed subtasks across all phases.
 */
function countCompletedSubtasks(plan: ImplementationPlan): number {
  let count = 0;
  for (const phase of plan.phases) {
    for (const subtask of phase.subtasks) {
      if (subtask.status === 'completed') {
        count++;
      }
    }
  }
  return count;
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Delay with abort signal support.
 */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }

    const timer = setTimeout(resolve, ms);

    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
