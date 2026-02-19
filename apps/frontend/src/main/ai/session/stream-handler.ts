/**
 * Stream Handler
 * ==============
 *
 * Processes AI SDK v6 fullStream events and emits structured StreamEvent objects.
 * Bridges the raw AI SDK stream into the session event system.
 *
 * AI SDK v6 fullStream parts handled:
 * - text-delta: Incremental text output
 * - reasoning: Extended thinking / reasoning output
 * - tool-call: Model initiates a tool call
 * - tool-result: Tool execution completed
 * - step-finish: An agentic step completed
 * - error: Stream-level error
 */

import type {
  SessionEventCallback,
  StreamEvent,
  TokenUsage,
} from './types';
import { classifyError, classifyToolError } from './error-classifier';

// =============================================================================
// Types
// =============================================================================

/**
 * AI SDK v6 fullStream part types we handle.
 * These match the shape emitted by `streamText().fullStream`.
 */
export interface TextDeltaPart {
  type: 'text-delta';
  textDelta: string;
}

export interface ReasoningPart {
  type: 'reasoning';
  textDelta: string;
}

export interface ToolCallPart {
  type: 'tool-call';
  toolName: string;
  toolCallId: string;
  args: Record<string, unknown>;
}

export interface ToolResultPart {
  type: 'tool-result';
  toolName: string;
  toolCallId: string;
  result: unknown;
  isError?: boolean;
}

export interface StepFinishPart {
  type: 'step-finish';
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  isContinued: boolean;
}

export interface ErrorPart {
  type: 'error';
  error: unknown;
}

export type FullStreamPart =
  | TextDeltaPart
  | ReasoningPart
  | ToolCallPart
  | ToolResultPart
  | StepFinishPart
  | ErrorPart;

// =============================================================================
// Stream Handler State
// =============================================================================

interface StreamHandlerState {
  stepNumber: number;
  toolCallCount: number;
  cumulativeUsage: TokenUsage;
  /** Track tool call start times for duration calculation */
  toolCallTimestamps: Map<string, number>;
}

function createInitialState(): StreamHandlerState {
  return {
    stepNumber: 0,
    toolCallCount: 0,
    cumulativeUsage: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    },
    toolCallTimestamps: new Map(),
  };
}

// =============================================================================
// Stream Handler
// =============================================================================

/**
 * Creates a stream handler that processes AI SDK v6 fullStream parts
 * and emits structured StreamEvents via the callback.
 *
 * Usage:
 * ```ts
 * const handler = createStreamHandler(onEvent);
 * for await (const part of result.fullStream) {
 *   handler.processPart(part);
 * }
 * const summary = handler.getSummary();
 * ```
 */
export function createStreamHandler(onEvent: SessionEventCallback) {
  const state = createInitialState();

  function emit(event: StreamEvent): void {
    onEvent(event);
  }

  function processPart(part: FullStreamPart): void {
    switch (part.type) {
      case 'text-delta':
        handleTextDelta(part);
        break;
      case 'reasoning':
        handleReasoning(part);
        break;
      case 'tool-call':
        handleToolCall(part);
        break;
      case 'tool-result':
        handleToolResult(part);
        break;
      case 'step-finish':
        handleStepFinish(part);
        break;
      case 'error':
        handleError(part);
        break;
    }
  }

  function handleTextDelta(part: TextDeltaPart): void {
    emit({ type: 'text-delta', text: part.textDelta });
  }

  function handleReasoning(part: ReasoningPart): void {
    emit({ type: 'thinking-delta', text: part.textDelta });
  }

  function handleToolCall(part: ToolCallPart): void {
    state.toolCallCount++;
    state.toolCallTimestamps.set(part.toolCallId, Date.now());
    emit({
      type: 'tool-call',
      toolName: part.toolName,
      toolCallId: part.toolCallId,
      args: part.args,
    });
  }

  function handleToolResult(part: ToolResultPart): void {
    const startTime = state.toolCallTimestamps.get(part.toolCallId);
    const durationMs = startTime ? Date.now() - startTime : 0;
    state.toolCallTimestamps.delete(part.toolCallId);

    const isError = part.isError ?? false;

    emit({
      type: 'tool-result',
      toolName: part.toolName,
      toolCallId: part.toolCallId,
      result: part.result,
      durationMs,
      isError,
    });

    // Also emit a classified error event for tool failures
    if (isError) {
      const toolError = classifyToolError(
        part.toolName,
        part.toolCallId,
        part.result,
      );
      emit({ type: 'error', error: toolError });
    }
  }

  function handleStepFinish(part: StepFinishPart): void {
    state.stepNumber++;

    // Accumulate usage
    state.cumulativeUsage.promptTokens += part.usage.promptTokens;
    state.cumulativeUsage.completionTokens += part.usage.completionTokens;
    state.cumulativeUsage.totalTokens += part.usage.totalTokens;

    const stepUsage: TokenUsage = {
      promptTokens: part.usage.promptTokens,
      completionTokens: part.usage.completionTokens,
      totalTokens: part.usage.totalTokens,
    };

    emit({
      type: 'step-finish',
      stepNumber: state.stepNumber,
      usage: stepUsage,
    });

    emit({
      type: 'usage-update',
      usage: { ...state.cumulativeUsage },
    });
  }

  function handleError(part: ErrorPart): void {
    const { sessionError } = classifyError(part.error);
    emit({ type: 'error', error: sessionError });
  }

  /**
   * Returns a summary of the stream processing state.
   * Call after the stream is fully consumed.
   */
  function getSummary() {
    return {
      stepsExecuted: state.stepNumber,
      toolCallCount: state.toolCallCount,
      usage: { ...state.cumulativeUsage },
    };
  }

  return {
    processPart,
    getSummary,
  };
}

export type StreamHandler = ReturnType<typeof createStreamHandler>;
