/**
 * Session Runner
 * ==============
 *
 * Core agent session runtime. Replaces Python's `run_agent_session()`.
 *
 * Uses Vercel AI SDK v6:
 * - `streamText()` with `stopWhen: stepCountIs(N)` for agentic looping
 * - `onStepFinish` callbacks for progress tracking
 * - `fullStream` for text-delta, tool-call, tool-result, reasoning events
 *
 * Handles:
 * - Token refresh mid-session (catch 401 → reactive refresh → retry)
 * - Cancellation via AbortSignal
 * - Structured SessionResult with usage, outcome, messages
 */

import { streamText, stepCountIs } from 'ai';
import type { Tool as AITool } from 'ai';

import { createStreamHandler } from './stream-handler';
import type { FullStreamPart } from './stream-handler';
import { classifyError, isAuthenticationError } from './error-classifier';
import { ProgressTracker } from './progress-tracker';
import type {
  SessionConfig,
  SessionResult,
  SessionOutcome,
  SessionError,
  SessionEventCallback,
  TokenUsage,
  SessionMessage,
} from './types';

// =============================================================================
// Constants
// =============================================================================

/** Maximum number of auth refresh retries before giving up */
const MAX_AUTH_RETRIES = 1;

/** Default max steps if not specified in config */
const DEFAULT_MAX_STEPS = 200;

// =============================================================================
// Runner Options
// =============================================================================

/**
 * Options for `runAgentSession()` beyond the core SessionConfig.
 */
export interface RunnerOptions {
  /** Callback for streaming events (text, tool calls, progress) */
  onEvent?: SessionEventCallback;
  /** Callback to refresh auth token on 401; returns new API key or null */
  onAuthRefresh?: () => Promise<string | null>;
  /**
   * Optional factory to recreate the model with a fresh token after auth refresh.
   * If provided, called after a successful onAuthRefresh to replace the stale model.
   * Without this, the retry uses the old model instance (which carries the revoked token).
   */
  onModelRefresh?: (newToken: string) => import('ai').LanguageModel;
  /** Tools resolved for this session (from client factory) */
  tools?: Record<string, AITool>;
}

// =============================================================================
// runAgentSession
// =============================================================================

/**
 * Run an agent session using AI SDK v6 `streamText()`.
 *
 * This is the main entry point for executing an agent. It:
 * 1. Configures `streamText()` with tools, system prompt, and stop conditions
 * 2. Processes the full stream for events (text, tool calls, reasoning)
 * 3. Tracks progress via `ProgressTracker`
 * 4. Handles auth failures with token refresh + retry
 * 5. Returns a structured `SessionResult`
 *
 * @param config - Session configuration (model, prompts, tools, limits)
 * @param options - Runner options (event callback, auth refresh)
 * @returns SessionResult with outcome, usage, messages, and error info
 */
export async function runAgentSession(
  config: SessionConfig,
  options: RunnerOptions = {},
): Promise<SessionResult> {
  const { onEvent, onAuthRefresh, onModelRefresh, tools } = options;
  const startTime = Date.now();

  let authRetries = 0;
  let lastError: SessionError | undefined;
  let activeConfig = config;

  // Retry loop for auth refresh
  while (authRetries <= MAX_AUTH_RETRIES) {
    try {
      const result = await executeStream(activeConfig, tools, onEvent);
      return {
        ...result,
        durationMs: Date.now() - startTime,
      };
    } catch (error: unknown) {
      // Check for auth failure — attempt token refresh
      if (
        isAuthenticationError(error) &&
        authRetries < MAX_AUTH_RETRIES &&
        onAuthRefresh
      ) {
        authRetries++;
        const newToken = await onAuthRefresh();
        if (!newToken) {
          // Refresh failed — return auth failure
          const { sessionError } = classifyError(error);
          return buildErrorResult(
            'auth_failure',
            sessionError,
            startTime,
          );
        }
        // Recreate model with the fresh token if a factory is provided.
        // Without this, the retry would use the old model with the revoked token.
        if (onModelRefresh) {
          activeConfig = { ...activeConfig, model: onModelRefresh(newToken) };
        }
        continue;
      }

      // Non-auth error or retries exhausted
      const { sessionError, outcome } = classifyError(error);
      lastError = sessionError;
      return buildErrorResult(outcome, sessionError, startTime);
    }
  }

  // Should not reach here, but guard against it
  return buildErrorResult(
    'auth_failure',
    lastError ?? {
      code: 'auth_failure',
      message: 'Authentication failed after retries',
      retryable: false,
    },
    startTime,
  );
}

// =============================================================================
// Stream Execution
// =============================================================================

/**
 * Execute the AI SDK streamText call and process the full stream.
 *
 * @returns Partial SessionResult (without durationMs, added by caller)
 */
async function executeStream(
  config: SessionConfig,
  tools: Record<string, AITool> | undefined,
  onEvent: SessionEventCallback | undefined,
): Promise<Omit<SessionResult, 'durationMs'>> {
  const maxSteps = config.maxSteps ?? DEFAULT_MAX_STEPS;
  const progressTracker = new ProgressTracker();
  const messages: SessionMessage[] = [...config.initialMessages];

  // Build the event callback that also feeds the progress tracker
  const emitEvent: SessionEventCallback = (event) => {
    // Feed progress tracker
    progressTracker.processEvent(event);
    // Forward to external listener
    onEvent?.(event);
  };

  const streamHandler = createStreamHandler(emitEvent);

  // Build messages array for AI SDK (system prompt is separate)
  const aiMessages = config.initialMessages.map((msg) => ({
    role: msg.role as 'user' | 'assistant',
    content: msg.content,
  }));

  // Execute streamText
  const result = streamText({
    model: config.model,
    system: config.systemPrompt,
    messages: aiMessages,
    tools: tools ?? {},
    stopWhen: stepCountIs(maxSteps),
    abortSignal: config.abortSignal,
    onStepFinish: (_stepResult) => {
      // onStepFinish is called after each agentic step.
      // Step results (tool calls, usage) are handled via the fullStream handler.
    },
  });

  // Consume the full stream
  try {
    for await (const part of result.fullStream) {
      streamHandler.processPart(part as FullStreamPart);
    }
  } catch (error: unknown) {
    // Stream-level errors (network, abort, etc.)
    // Check if it's an abort
    if (config.abortSignal?.aborted) {
      return {
        outcome: 'cancelled',
        stepsExecuted: streamHandler.getSummary().stepsExecuted,
        usage: streamHandler.getSummary().usage,
        error: {
          code: 'aborted',
          message: 'Session was cancelled',
          retryable: false,
        },
        messages,
        toolCallCount: streamHandler.getSummary().toolCallCount,
      };
    }
    // Re-throw for classification in the outer try/catch
    throw error;
  }

  // Gather final summary from stream handler
  const summary = streamHandler.getSummary();

  // Determine outcome
  let outcome: SessionOutcome = 'completed';
  if (summary.stepsExecuted >= maxSteps) {
    outcome = 'max_steps';
  }

  // Collect response text from the stream result
  const responseText = await result.text;

  // Add assistant response to messages
  if (responseText) {
    messages.push({ role: 'assistant', content: responseText });
  }

  // Get total usage from AI SDK result
  // AI SDK v6 uses inputTokens/outputTokens naming
  const totalUsage = await result.totalUsage;
  const usage: TokenUsage = {
    promptTokens: totalUsage?.inputTokens ?? summary.usage.promptTokens,
    completionTokens: totalUsage?.outputTokens ?? summary.usage.completionTokens,
    totalTokens:
      (totalUsage?.inputTokens ?? 0) + (totalUsage?.outputTokens ?? 0) ||
      summary.usage.totalTokens,
  };

  return {
    outcome,
    stepsExecuted: summary.stepsExecuted,
    usage,
    messages,
    toolCallCount: summary.toolCallCount,
  };
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Build an error SessionResult.
 */
function buildErrorResult(
  outcome: SessionOutcome,
  error: SessionError,
  startTime: number,
): SessionResult {
  return {
    outcome,
    stepsExecuted: 0,
    usage: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    },
    error,
    messages: [],
    toolCallCount: 0,
    durationMs: Date.now() - startTime,
  };
}
