import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createStreamHandler } from '../stream-handler';
import type { FullStreamPart } from '../stream-handler';
import type { StreamEvent } from '../types';

describe('createStreamHandler', () => {
  let events: StreamEvent[];
  let onEvent: (event: StreamEvent) => void;

  beforeEach(() => {
    events = [];
    onEvent = (event) => events.push(event);
  });

  // ===========================================================================
  // Text Delta
  // ===========================================================================

  describe('text-delta', () => {
    it('should emit text-delta events', () => {
      const handler = createStreamHandler(onEvent);
      handler.processPart({ type: 'text-delta', textDelta: 'Hello' });

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: 'text-delta', text: 'Hello' });
    });

    it('should emit multiple text-delta events', () => {
      const handler = createStreamHandler(onEvent);
      handler.processPart({ type: 'text-delta', textDelta: 'Hello' });
      handler.processPart({ type: 'text-delta', textDelta: ' world' });

      expect(events).toHaveLength(2);
      expect(events[1]).toEqual({ type: 'text-delta', text: ' world' });
    });
  });

  // ===========================================================================
  // Reasoning
  // ===========================================================================

  describe('reasoning', () => {
    it('should emit thinking-delta events for reasoning parts', () => {
      const handler = createStreamHandler(onEvent);
      handler.processPart({ type: 'reasoning', textDelta: 'Let me think...' });

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: 'thinking-delta', text: 'Let me think...' });
    });
  });

  // ===========================================================================
  // Tool Call
  // ===========================================================================

  describe('tool-call', () => {
    it('should emit tool-call events and increment tool count', () => {
      const handler = createStreamHandler(onEvent);
      handler.processPart({
        type: 'tool-call',
        toolName: 'Bash',
        toolCallId: 'call-1',
        args: { command: 'ls' },
      });

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: 'tool-call',
        toolName: 'Bash',
        toolCallId: 'call-1',
        args: { command: 'ls' },
      });
      expect(handler.getSummary().toolCallCount).toBe(1);
    });

    it('should track multiple tool calls', () => {
      const handler = createStreamHandler(onEvent);
      handler.processPart({ type: 'tool-call', toolName: 'Bash', toolCallId: 'c1', args: {} });
      handler.processPart({ type: 'tool-call', toolName: 'Read', toolCallId: 'c2', args: {} });
      handler.processPart({ type: 'tool-call', toolName: 'Write', toolCallId: 'c3', args: {} });

      expect(handler.getSummary().toolCallCount).toBe(3);
    });
  });

  // ===========================================================================
  // Tool Result
  // ===========================================================================

  describe('tool-result', () => {
    it('should emit tool-result with duration from matching tool call', () => {
      const handler = createStreamHandler(onEvent);
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValueOnce(now).mockReturnValueOnce(now + 150);

      handler.processPart({ type: 'tool-call', toolName: 'Bash', toolCallId: 'c1', args: {} });
      events.length = 0; // clear tool-call event

      handler.processPart({
        type: 'tool-result',
        toolName: 'Bash',
        toolCallId: 'c1',
        result: 'output',
      });

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'tool-result',
        toolName: 'Bash',
        toolCallId: 'c1',
        result: 'output',
        durationMs: 150,
        isError: false,
      });

      vi.restoreAllMocks();
    });

    it('should emit error event for tool failures', () => {
      const handler = createStreamHandler(onEvent);
      handler.processPart({ type: 'tool-call', toolName: 'Bash', toolCallId: 'c1', args: {} });
      events.length = 0;

      handler.processPart({
        type: 'tool-result',
        toolName: 'Bash',
        toolCallId: 'c1',
        result: 'command not found',
        isError: true,
      });

      // tool-result + error event
      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({ type: 'tool-result', isError: true });
      expect(events[1]).toMatchObject({ type: 'error' });
      expect((events[1] as { type: 'error'; error: { code: string } }).error.code).toBe('tool_execution_error');
    });

    it('should handle tool-result without matching tool-call (durationMs = 0)', () => {
      const handler = createStreamHandler(onEvent);
      handler.processPart({
        type: 'tool-result',
        toolName: 'Bash',
        toolCallId: 'unknown',
        result: 'ok',
      });

      expect(events[0]).toMatchObject({ type: 'tool-result', durationMs: 0 });
    });
  });

  // ===========================================================================
  // Step Finish
  // ===========================================================================

  describe('step-finish', () => {
    it('should increment step count and accumulate usage', () => {
      const handler = createStreamHandler(onEvent);

      handler.processPart({
        type: 'step-finish',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        isContinued: false,
      });

      // step-finish + usage-update
      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({ type: 'step-finish', stepNumber: 1 });
      expect(events[1]).toMatchObject({
        type: 'usage-update',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      });
      expect(handler.getSummary().stepsExecuted).toBe(1);
    });

    it('should accumulate usage across multiple steps', () => {
      const handler = createStreamHandler(onEvent);

      handler.processPart({
        type: 'step-finish',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        isContinued: false,
      });
      handler.processPart({
        type: 'step-finish',
        usage: { promptTokens: 200, completionTokens: 80, totalTokens: 280 },
        isContinued: false,
      });

      const summary = handler.getSummary();
      expect(summary.stepsExecuted).toBe(2);
      expect(summary.usage).toEqual({
        promptTokens: 300,
        completionTokens: 130,
        totalTokens: 430,
      });
    });
  });

  // ===========================================================================
  // Error
  // ===========================================================================

  describe('error', () => {
    it('should classify and emit error events', () => {
      const handler = createStreamHandler(onEvent);
      handler.processPart({ type: 'error', error: new Error('429 too many requests') });

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: 'error' });
      expect((events[0] as { type: 'error'; error: { code: string } }).error.code).toBe('rate_limited');
    });
  });

  // ===========================================================================
  // Summary
  // ===========================================================================

  describe('getSummary', () => {
    it('should return initial state when no parts processed', () => {
      const handler = createStreamHandler(onEvent);
      expect(handler.getSummary()).toEqual({
        stepsExecuted: 0,
        toolCallCount: 0,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      });
    });
  });

  // ===========================================================================
  // Multi-step conversation with tool calls
  // ===========================================================================

  describe('multi-step conversation', () => {
    it('should track a full multi-step conversation with tool calls', () => {
      const handler = createStreamHandler(onEvent);

      // Step 1: text + tool call + tool result + step finish
      handler.processPart({ type: 'text-delta', textDelta: 'Let me check...' });
      handler.processPart({ type: 'tool-call', toolName: 'Bash', toolCallId: 'c1', args: { command: 'ls' } });
      handler.processPart({ type: 'tool-result', toolName: 'Bash', toolCallId: 'c1', result: 'file.ts' });
      handler.processPart({
        type: 'step-finish',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        isContinued: true,
      });

      // Step 2: another tool call
      handler.processPart({ type: 'tool-call', toolName: 'Read', toolCallId: 'c2', args: { file_path: 'file.ts' } });
      handler.processPart({ type: 'tool-result', toolName: 'Read', toolCallId: 'c2', result: 'content' });
      handler.processPart({
        type: 'step-finish',
        usage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 },
        isContinued: false,
      });

      // Step 3: text only
      handler.processPart({ type: 'text-delta', textDelta: 'Here is the result.' });
      handler.processPart({
        type: 'step-finish',
        usage: { promptTokens: 150, completionTokens: 60, totalTokens: 210 },
        isContinued: false,
      });

      const summary = handler.getSummary();
      expect(summary.stepsExecuted).toBe(3);
      expect(summary.toolCallCount).toBe(2);
      expect(summary.usage).toEqual({
        promptTokens: 450,
        completionTokens: 210,
        totalTokens: 660,
      });
    });
  });
});
