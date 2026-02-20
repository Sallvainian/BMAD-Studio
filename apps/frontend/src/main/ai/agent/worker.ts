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
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { runAgentSession } from '../session/runner';
import { createProviderFromModelId } from '../providers/factory';
import { refreshOAuthTokenReactive } from '../auth/resolver';
import { ToolRegistry } from '../tools/registry';
import type { DefinedTool } from '../tools/define';
import { readTool } from '../tools/builtin/read';
import { writeTool } from '../tools/builtin/write';
import { editTool } from '../tools/builtin/edit';
import { bashTool } from '../tools/builtin/bash';
import { globTool } from '../tools/builtin/glob';
import { grepTool } from '../tools/builtin/grep';
import { webFetchTool } from '../tools/builtin/web-fetch';
import { webSearchTool } from '../tools/builtin/web-search';
import type { ToolContext } from '../tools/types';
import type { SecurityProfile } from '../security/bash-validator';
import type {
  WorkerConfig,
  WorkerMessage,
  MainToWorkerMessage,
  SerializableSessionConfig,
} from './types';
import type { SessionConfig, StreamEvent, SessionResult } from '../session/types';
import { BuildOrchestrator } from '../orchestration/build-orchestrator';
import { QALoop } from '../orchestration/qa-loop';
import type { AgentType } from '../config/agent-configs';
import type { Phase } from '../config/types';
import { getPhaseModel, getPhaseThinking } from '../config/phase-config';

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
// Shared Helpers
// =============================================================================

/**
 * Reconstruct the SecurityProfile from the serialized form in session config.
 * SecurityProfile uses Set objects that can't cross worker boundaries.
 */
function buildSecurityProfile(session: SerializableSessionConfig): SecurityProfile {
  const serialized = session.toolContext.securityProfile;
  return {
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
}

/**
 * Build a ToolContext for the given session config.
 */
function buildToolContext(session: SerializableSessionConfig, securityProfile: SecurityProfile): ToolContext {
  return {
    cwd: session.toolContext.cwd,
    projectDir: session.toolContext.projectDir,
    specDir: session.toolContext.specDir,
    securityProfile,
    abortSignal: abortController.signal,
  };
}

/**
 * Build and return a tool registry with all builtin tools registered.
 */
function buildToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const asDefined = (t: unknown): DefinedTool => t as DefinedTool;
  registry.registerTool('Read', asDefined(readTool));
  registry.registerTool('Write', asDefined(writeTool));
  registry.registerTool('Edit', asDefined(editTool));
  registry.registerTool('Bash', asDefined(bashTool));
  registry.registerTool('Glob', asDefined(globTool));
  registry.registerTool('Grep', asDefined(grepTool));
  registry.registerTool('WebFetch', asDefined(webFetchTool));
  registry.registerTool('WebSearch', asDefined(webSearchTool));
  return registry;
}

/**
 * Load a prompt file from the prompts directory.
 * The prompts dir is expected relative to the worker file's location.
 * In dev and production, the worker sits in the main/ output folder.
 */
function loadPrompt(promptName: string): string | null {
  // Try to find the prompts directory relative to common locations
  const candidateBases: string[] = [
    // Standard: apps/backend/prompts/ relative to project root
    // The worker runs in the Electron main process — __dirname is in out/main/
    // We need to traverse up to find apps/backend/prompts/
    join(__dirname, '..', '..', '..', '..', 'apps', 'backend', 'prompts'),
    join(__dirname, '..', '..', '..', 'apps', 'backend', 'prompts'),
    join(__dirname, '..', '..', 'apps', 'backend', 'prompts'),
    join(__dirname, 'prompts'),
  ];

  for (const base of candidateBases) {
    const promptPath = join(base, `${promptName}.md`);
    try {
      if (existsSync(promptPath)) {
        return readFileSync(promptPath, 'utf-8');
      }
    } catch {
      // Try next
    }
  }
  return null;
}

/**
 * Run a single agent session and return the result.
 * Used as the runSession callback for BuildOrchestrator and QALoop.
 */
async function runSingleSession(
  agentType: AgentType,
  phase: Phase,
  systemPrompt: string,
  specDir: string,
  projectDir: string,
  sessionNumber: number,
  subtaskId: string | undefined,
  baseSession: SerializableSessionConfig,
  toolContext: ToolContext,
  registry: ToolRegistry,
  initialUserMessage?: string,
): Promise<SessionResult> {
  // Resolve phase-specific model
  const phaseModelId = await getPhaseModel(specDir, phase);
  const phaseThinking = await getPhaseThinking(specDir, phase);

  const model = createProviderFromModelId(phaseModelId, {
    apiKey: baseSession.apiKey,
    baseURL: baseSession.baseURL,
  });

  const tools = registry.getToolsForAgent(agentType, toolContext);

  // Build initial messages: use provided kickoff message, or fall back to session messages
  const initialMessages = initialUserMessage
    ? [{ role: 'user' as const, content: initialUserMessage }]
    : baseSession.initialMessages;

  const sessionConfig: SessionConfig = {
    agentType,
    model,
    systemPrompt,
    initialMessages,
    toolContext,
    maxSteps: baseSession.maxSteps,
    thinkingLevel: phaseThinking as SessionConfig['thinkingLevel'],
    abortSignal: abortController.signal,
    specDir,
    projectDir,
    phase,
    modelShorthand: undefined,
    sessionNumber,
    subtaskId,
  };

  return runAgentSession(sessionConfig, {
    tools,
    onEvent: (event: StreamEvent) => {
      postMessage({
        type: 'stream-event',
        taskId: config.taskId,
        data: event,
        projectId: config.projectId,
      });
    },
    onAuthRefresh: baseSession.configDir
      ? () => refreshOAuthTokenReactive(baseSession.configDir as string)
      : undefined,
    onModelRefresh: baseSession.configDir
      ? (newToken: string) => createProviderFromModelId(phaseModelId, {
          apiKey: newToken,
          baseURL: baseSession.baseURL,
        })
      : undefined,
  });
}

// =============================================================================
// Session Execution
// =============================================================================

async function run(): Promise<void> {
  const { session } = config;

  postLog(`Starting agent session: type=${session.agentType}, model=${session.modelId}`);

  try {
    const securityProfile = buildSecurityProfile(session);
    const toolContext = buildToolContext(session, securityProfile);
    const registry = buildToolRegistry();

    // Route to orchestrator for build_orchestrator agent type
    if (session.agentType === 'build_orchestrator') {
      await runBuildOrchestrator(session, toolContext, registry);
      return;
    }

    // Route to QA loop for qa_reviewer agent type
    if (session.agentType === 'qa_reviewer') {
      await runQALoop(session, toolContext, registry);
      return;
    }

    // Default: single session for all other agent types
    await runDefaultSession(session, toolContext, registry);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    postError(`Agent session failed: ${message}`);
  }
}

/**
 * Run a single agent session (default path for spec_orchestrator, etc.)
 */
async function runDefaultSession(
  session: SerializableSessionConfig,
  toolContext: ToolContext,
  registry: ToolRegistry,
): Promise<void> {
  const model = createProviderFromModelId(session.modelId, {
    apiKey: session.apiKey,
    baseURL: session.baseURL,
  });

  const tools = registry.getToolsForAgent(session.agentType, toolContext);

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

  const result: SessionResult = await runAgentSession(sessionConfig, {
    tools,
    onEvent: (event: StreamEvent) => {
      postMessage({
        type: 'stream-event',
        taskId: config.taskId,
        data: event,
        projectId: config.projectId,
      });
    },
    onAuthRefresh: session.configDir
      ? () => refreshOAuthTokenReactive(session.configDir as string)
      : undefined,
    onModelRefresh: session.configDir
      ? (newToken: string) => createProviderFromModelId(session.modelId, {
          apiKey: newToken,
          baseURL: session.baseURL,
        })
      : undefined,
  });

  postMessage({
    type: 'result',
    taskId: config.taskId,
    data: result,
    projectId: config.projectId,
  });
}

/**
 * Run the full build orchestration pipeline:
 * planning → coding (per subtask) → QA review → QA fixing
 */
async function runBuildOrchestrator(
  session: SerializableSessionConfig,
  toolContext: ToolContext,
  registry: ToolRegistry,
): Promise<void> {
  postLog('Starting BuildOrchestrator pipeline (planning → coding → QA)');

  const orchestrator = new BuildOrchestrator({
    specDir: session.specDir,
    projectDir: session.projectDir,
    abortSignal: abortController.signal,

    generatePrompt: async (agentType, _phase, _context) => {
      // Load prompt from prompts directory; fall back to a minimal default
      const promptName = agentType === 'coder' ? 'coder' : agentType;
      return loadPrompt(promptName) ?? buildFallbackPrompt(agentType, session.specDir, session.projectDir);
    },

    runSession: async (runConfig) => {
      postLog(`Running ${runConfig.agentType} session (phase=${runConfig.phase}, session=${runConfig.sessionNumber})`);
      // Build a kickoff message for the agent so it has a task to act on
      const kickoffMessage = buildKickoffMessage(runConfig.agentType, runConfig.specDir, runConfig.projectDir);
      return runSingleSession(
        runConfig.agentType,
        runConfig.phase,
        runConfig.systemPrompt,
        runConfig.specDir,
        runConfig.projectDir,
        runConfig.sessionNumber,
        runConfig.subtaskId,
        session,
        toolContext,
        registry,
        kickoffMessage,
      );
    },
  });

  orchestrator.on('phase-change', (phase: string, message: string) => {
    postLog(`Phase: ${phase} — ${message}`);
  });

  orchestrator.on('log', (message: string) => {
    postLog(message);
  });

  orchestrator.on('error', (error: Error, phase: string) => {
    postLog(`Error in ${phase} phase: ${error.message}`);
  });

  const outcome = await orchestrator.run();

  // Map outcome to a SessionResult-compatible result for the bridge
  const result: SessionResult = {
    outcome: outcome.success ? 'completed' : 'error',
    stepsExecuted: outcome.totalIterations,
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    messages: [],
    toolCallCount: 0,
    durationMs: outcome.durationMs,
    error: outcome.error
      ? { code: 'error', message: outcome.error, retryable: false }
      : undefined,
  };

  postMessage({
    type: 'result',
    taskId: config.taskId,
    data: result,
    projectId: config.projectId,
  });
}

/**
 * Run the QA validation loop: qa_reviewer → qa_fixer → re-review
 */
async function runQALoop(
  session: SerializableSessionConfig,
  toolContext: ToolContext,
  registry: ToolRegistry,
): Promise<void> {
  postLog('Starting QA validation loop');

  const qaLoop = new QALoop({
    specDir: session.specDir,
    projectDir: session.projectDir,
    abortSignal: abortController.signal,

    generatePrompt: async (agentType, _context) => {
      const promptName = agentType === 'qa_fixer' ? 'qa_fixer' : 'qa_reviewer';
      return loadPrompt(promptName) ?? buildFallbackPrompt(agentType, session.specDir, session.projectDir);
    },

    runSession: async (runConfig) => {
      postLog(`Running ${runConfig.agentType} session (session=${runConfig.sessionNumber})`);
      const kickoffMessage = buildKickoffMessage(runConfig.agentType, runConfig.specDir, runConfig.projectDir);
      return runSingleSession(
        runConfig.agentType,
        runConfig.phase,
        runConfig.systemPrompt,
        runConfig.specDir,
        runConfig.projectDir,
        runConfig.sessionNumber,
        undefined,
        session,
        toolContext,
        registry,
        kickoffMessage,
      );
    },
  });

  qaLoop.on('log', (message: string) => {
    postLog(message);
  });

  const outcome = await qaLoop.run();

  const result: SessionResult = {
    outcome: outcome.approved ? 'completed' : 'error',
    stepsExecuted: outcome.totalIterations,
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    messages: [],
    toolCallCount: 0,
    durationMs: outcome.durationMs,
    error: outcome.error
      ? { code: 'error', message: outcome.error, retryable: false }
      : undefined,
  };

  postMessage({
    type: 'result',
    taskId: config.taskId,
    data: result,
    projectId: config.projectId,
  });
}

/**
 * Build a kickoff user message for an agent session.
 * The AI SDK requires at least one user message; this provides a concrete task directive.
 */
function buildKickoffMessage(agentType: AgentType, specDir: string, projectDir: string): string {
  switch (agentType) {
    case 'planner':
      return `Read the spec at ${specDir}/spec.md and create a detailed implementation plan at ${specDir}/implementation_plan.json. Project root: ${projectDir}`;
    case 'coder':
      return `Read ${specDir}/implementation_plan.json and implement the next pending subtask. Project root: ${projectDir}. After completing the subtask, update its status to "completed" in implementation_plan.json.`;
    case 'qa_reviewer':
      return `Review the implementation in ${projectDir} against the specification in ${specDir}/spec.md. Write your findings to ${specDir}/qa_report.md with a clear "Status: PASSED" or "Status: FAILED" line.`;
    case 'qa_fixer':
      return `Read ${specDir}/qa_report.md for the issues found by QA review. Fix all issues in ${projectDir}. After fixing, update ${specDir}/qa_report.md to indicate fixes have been applied.`;
    default:
      return `Complete the task described in your system prompt. Spec directory: ${specDir}. Project directory: ${projectDir}`;
  }
}

/**
 * Build a minimal fallback prompt when the prompts directory is not found.
 */
function buildFallbackPrompt(agentType: AgentType, specDir: string, projectDir: string): string {
  switch (agentType) {
    case 'planner':
      return `You are a planning agent. Read spec.md in ${specDir} and create implementation_plan.json with phases and subtasks. Each subtask must have id, description, and status fields. Set all statuses to "pending".`;
    case 'coder':
      return `You are a coding agent. Implement the current pending subtask from implementation_plan.json in ${specDir}. Project root: ${projectDir}. After completing the subtask, update its status to "completed" in implementation_plan.json.`;
    case 'qa_reviewer':
      return `You are a QA reviewer. Review the implementation in ${projectDir} against the spec in ${specDir}/spec.md. Write your findings to ${specDir}/qa_report.md with "Status: PASSED" or "Status: FAILED".`;
    case 'qa_fixer':
      return `You are a QA fixer. Read ${specDir}/qa_report.md for the issues found by QA review. Fix the issues in ${projectDir}. After fixing, update ${specDir}/implementation_plan.json qa_signoff status to "fixes_applied".`;
    default:
      return `You are an AI agent. Complete the task described in ${specDir}/spec.md for the project at ${projectDir}.`;
  }
}

// Start execution
run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  postError(`Unhandled worker error: ${message}`);
});
