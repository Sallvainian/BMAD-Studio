/**
 * Worker Thread Entry Point
 * =========================
 *
 * Runs in an isolated worker_thread. Receives configuration via `workerData`,
 * executes `runAgentSession()`, and posts structured messages back to the
 * main thread via `parentPort.postMessage()`.
 *
 * Path handling:
 * - Dev: Loaded directly by electron-vite from source
 * - Production: Bundled into app resources (app.isPackaged)
 */

import { parentPort, workerData } from 'worker_threads';

import { runAgentSession } from '../session/runner';
import { createProviderFromModelId } from '../providers/factory';
import type { ToolContext } from '../tools/types';
import type { SecurityProfile } from '../security/bash-validator';
import type {
  WorkerConfig,
  WorkerMessage,
  MainToWorkerMessage,
} from './types';
import type { SessionConfig, StreamEvent, SessionResult } from '../session/types';

// =============================================================================
// Validation
// =============================================================================

if (!parentPort) {
  throw new Error('worker.ts must be run inside a worker_thread');
}

const config = workerData as WorkerConfig;
if (!config?.taskId || !config?.session) {
  throw new Error('worker.ts requires valid WorkerConfig via workerData');
}

// =============================================================================
// Messaging Helpers
// =============================================================================

function postMessage(message: WorkerMessage): void {
  parentPort!.postMessage(message);
}

function postLog(data: string): void {
  postMessage({ type: 'log', taskId: config.taskId, data, projectId: config.projectId });
}

function postError(data: string): void {
  postMessage({ type: 'error', taskId: config.taskId, data, projectId: config.projectId });
}

// =============================================================================
// Abort Handling
// =============================================================================

const abortController = new AbortController();

parentPort.on('message', (msg: MainToWorkerMessage) => {
  if (msg.type === 'abort') {
    abortController.abort();
  }
});

// =============================================================================
// Session Execution
// =============================================================================

async function run(): Promise<void> {
  const { session } = config;

  postLog(`Starting agent session: type=${session.agentType}, model=${session.modelId}`);

  try {
    // Reconstruct the LanguageModel instance in the worker thread
    const model = createProviderFromModelId(session.modelId, {
      apiKey: session.apiKey,
      baseURL: session.baseURL,
    });

    // Reconstruct SecurityProfile from serialized form (Set objects aren't transferable)
    const serialized = session.toolContext.securityProfile;
    const securityProfile: SecurityProfile = {
      baseCommands: new Set(serialized?.baseCommands ?? []),
      stackCommands: new Set(serialized?.stackCommands ?? []),
      scriptCommands: new Set(serialized?.scriptCommands ?? []),
      customCommands: new Set(serialized?.customCommands ?? []),
      customScripts: { shellScripts: serialized?.customScripts?.shellScripts ?? [] },
      getAllAllowedCommands() {
        return new Set([
          ...this.baseCommands,
          ...this.stackCommands,
          ...this.scriptCommands,
          ...this.customCommands,
        ]);
      },
    };

    // Build the full SessionConfig
    const toolContext: ToolContext = {
      cwd: session.toolContext.cwd,
      projectDir: session.toolContext.projectDir,
      specDir: session.toolContext.specDir,
      securityProfile,
    };

    const sessionConfig: SessionConfig = {
      agentType: session.agentType,
      model,
      systemPrompt: session.systemPrompt,
      initialMessages: session.initialMessages,
      toolContext,
      maxSteps: session.maxSteps,
      thinkingLevel: session.thinkingLevel,
      abortSignal: abortController.signal,
      specDir: session.specDir,
      projectDir: session.projectDir,
      phase: session.phase,
      modelShorthand: session.modelShorthand,
      sessionNumber: session.sessionNumber,
      subtaskId: session.subtaskId,
    };

    // Run the session with event forwarding
    const result: SessionResult = await runAgentSession(sessionConfig, {
      onEvent: (event: StreamEvent) => {
        postMessage({
          type: 'stream-event',
          taskId: config.taskId,
          data: event,
          projectId: config.projectId,
        });
      },
    });

    // Post the final result
    postMessage({
      type: 'result',
      taskId: config.taskId,
      data: result,
      projectId: config.projectId,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    postError(`Agent session failed: ${message}`);
  }
}

// Start execution
run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  postError(`Unhandled worker error: ${message}`);
  process.exit(1);
});
