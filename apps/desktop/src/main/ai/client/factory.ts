/**
 * Client Factory
 * ==============
 *
 * Factory functions for creating configured AI clients.
 * Ported from apps/desktop/src/main/ai/client/ (originally from Python core/client).
 *
 * - `createAgentClient()` — Full client with tools, MCP, and security.
 *   Used by planner, coder, QA, and other pipeline agents.
 *
 * - `createSimpleClient()` — Lightweight client for utility runners
 *   (commit messages, PR templates, analysis tasks).
 */

import type { Tool as AITool } from 'ai';

import { resolveAuth } from '../auth/resolver';
import {
  getDefaultThinkingLevel,
  getRequiredMcpServers,
} from '../config/agent-configs';
import type { McpServerResolveOptions } from '../config/agent-configs';
import { resolveModelId } from '../config/phase-config';
import type { ThinkingLevel } from '../config/types';
import { createMcpClientsForAgent, closeAllMcpClients, mergeMcpTools } from '../mcp/client';
import type { McpClientResult } from '../mcp/types';
import { createProviderFromModelId } from '../providers/factory';
import { ToolRegistry } from '../tools/registry';
import type {
  AgentClientConfig,
  AgentClientResult,
  SimpleClientConfig,
  SimpleClientResult,
} from './types';

// =============================================================================
// Default Constants
// =============================================================================

/** Default max steps for agent sessions */
const DEFAULT_MAX_STEPS = 200;

/** Default max steps for simple/utility clients */
const DEFAULT_SIMPLE_MAX_STEPS = 1;

// =============================================================================
// createAgentClient
// =============================================================================

/**
 * Create a fully configured agent client with tools, MCP servers, and security.
 *
 * This is the primary entry point for creating agent sessions.
 * It resolves credentials, initializes MCP connections, binds tools to context,
 * and returns everything needed for `runAgentSession()`.
 *
 * @example
 * ```ts
 * const client = await createAgentClient({
 *   agentType: 'coder',
 *   systemPrompt: coderPrompt,
 *   toolContext: { cwd, projectDir, specDir, securityProfile },
 *   phase: 'coding',
 * });
 *
 * try {
 *   const result = await runAgentSession({ ...client });
 * } finally {
 *   await client.cleanup();
 * }
 * ```
 */
export async function createAgentClient(
  config: AgentClientConfig,
): Promise<AgentClientResult> {
  const {
    agentType,
    systemPrompt,
    toolContext,
    phase,
    modelShorthand,
    thinkingLevel,
    maxSteps = DEFAULT_MAX_STEPS,
    profileId,
    additionalMcpServers,
  } = config;

  // 1. Resolve model ID from shorthand (or use phase default)
  const modelId = resolveModelId(modelShorthand ?? phase);

  // 2. Resolve auth credentials (async — proactively refreshes OAuth token)
  const auth = await resolveAuth({
    provider: 'anthropic',
    profileId,
  });

  const model = createProviderFromModelId(modelId, {
    apiKey: auth?.apiKey,
    baseURL: auth?.baseURL,
    headers: auth?.headers,
  });

  // 3. Resolve thinking level
  const resolvedThinkingLevel: ThinkingLevel =
    thinkingLevel ?? getDefaultThinkingLevel(agentType);

  // 4. Bind builtin tools via ToolRegistry
  const registry = new ToolRegistry();
  const tools: Record<string, AITool> = registry.getToolsForAgent(
    agentType,
    toolContext,
  );

  // 5. Initialize MCP servers and merge tools
  const mcpResolveOptions: McpServerResolveOptions = {};
  let mcpClients: McpClientResult[] = [];

  const mcpServerIds = getRequiredMcpServers(agentType, mcpResolveOptions);
  if (additionalMcpServers) {
    mcpServerIds.push(...additionalMcpServers);
  }

  if (mcpServerIds.length > 0) {
    mcpClients = await createMcpClientsForAgent(agentType, mcpResolveOptions);

    // Merge MCP tools into the tool map
    const mcpTools = mergeMcpTools(mcpClients);
    Object.assign(tools, mcpTools);
  }

  // 6. Build cleanup function
  const cleanup = async (): Promise<void> => {
    await closeAllMcpClients(mcpClients);
  };

  return {
    model,
    tools,
    mcpClients,
    systemPrompt,
    maxSteps,
    thinkingLevel: resolvedThinkingLevel,
    cleanup,
  };
}

// =============================================================================
// createSimpleClient
// =============================================================================

/**
 * Create a lightweight client for utility runners.
 * No MCP servers, minimal tool setup.
 *
 * @example
 * ```ts
 * const client = createSimpleClient({
 *   systemPrompt: 'Generate a commit message...',
 *   modelShorthand: 'haiku',
 * });
 * ```
 */
export async function createSimpleClient(
  config: SimpleClientConfig,
): Promise<SimpleClientResult> {
  const {
    systemPrompt,
    modelShorthand = 'haiku',
    thinkingLevel = 'low',
    profileId,
    maxSteps = DEFAULT_SIMPLE_MAX_STEPS,
    tools = {},
  } = config;

  // Resolve model
  const modelId = resolveModelId(modelShorthand);
  const auth = await resolveAuth({
    provider: 'anthropic',
    profileId,
  });

  const model = createProviderFromModelId(modelId, {
    apiKey: auth?.apiKey,
    baseURL: auth?.baseURL,
    headers: auth?.headers,
  });

  return {
    model,
    tools,
    systemPrompt,
    maxSteps,
    thinkingLevel,
  };
}
