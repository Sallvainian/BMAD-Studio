/**
 * Tool Registry
 * =============
 *
 * Ported from apps/backend/agents/tools_pkg/models.py.
 *
 * Single source of truth for tool name constants, agent-to-tool mappings,
 * and the ToolRegistry class that resolves tools for a given agent type.
 */

import type { Tool as AITool } from 'ai';

import type { ThinkingLevel } from '../config/types';
import type { DefinedTool } from './define';
import type { ToolContext } from './types';

// =============================================================================
// Base Tools (Built-in Claude Code tools)
// =============================================================================

/** Core file-reading tools */
export const BASE_READ_TOOLS = ['Read', 'Glob', 'Grep'] as const;

/** Core file-writing tools */
export const BASE_WRITE_TOOLS = ['Write', 'Edit', 'Bash'] as const;

/** Web tools for documentation lookup and research */
export const WEB_TOOLS = ['WebFetch', 'WebSearch'] as const;

// =============================================================================
// Auto-Claude MCP Tools (Custom build management)
// =============================================================================

export const TOOL_UPDATE_SUBTASK_STATUS = 'mcp__auto-claude__update_subtask_status';
export const TOOL_GET_BUILD_PROGRESS = 'mcp__auto-claude__get_build_progress';
export const TOOL_RECORD_DISCOVERY = 'mcp__auto-claude__record_discovery';
export const TOOL_RECORD_GOTCHA = 'mcp__auto-claude__record_gotcha';
export const TOOL_GET_SESSION_CONTEXT = 'mcp__auto-claude__get_session_context';
export const TOOL_UPDATE_QA_STATUS = 'mcp__auto-claude__update_qa_status';

// =============================================================================
// External MCP Tools
// =============================================================================

export const CONTEXT7_TOOLS = [
  'mcp__context7__resolve-library-id',
  'mcp__context7__query-docs',
] as const;

export const LINEAR_TOOLS = [
  'mcp__linear-server__list_teams',
  'mcp__linear-server__get_team',
  'mcp__linear-server__list_projects',
  'mcp__linear-server__get_project',
  'mcp__linear-server__create_project',
  'mcp__linear-server__update_project',
  'mcp__linear-server__list_issues',
  'mcp__linear-server__get_issue',
  'mcp__linear-server__create_issue',
  'mcp__linear-server__update_issue',
  'mcp__linear-server__list_comments',
  'mcp__linear-server__create_comment',
  'mcp__linear-server__list_issue_statuses',
  'mcp__linear-server__list_issue_labels',
  'mcp__linear-server__list_users',
  'mcp__linear-server__get_user',
] as const;

export const GRAPHITI_MCP_TOOLS = [
  'mcp__graphiti-memory__search_nodes',
  'mcp__graphiti-memory__search_facts',
  'mcp__graphiti-memory__add_episode',
  'mcp__graphiti-memory__get_episodes',
  'mcp__graphiti-memory__get_entity_edge',
] as const;

export const PUPPETEER_TOOLS = [
  'mcp__puppeteer__puppeteer_connect_active_tab',
  'mcp__puppeteer__puppeteer_navigate',
  'mcp__puppeteer__puppeteer_screenshot',
  'mcp__puppeteer__puppeteer_click',
  'mcp__puppeteer__puppeteer_fill',
  'mcp__puppeteer__puppeteer_select',
  'mcp__puppeteer__puppeteer_hover',
  'mcp__puppeteer__puppeteer_evaluate',
] as const;

export const ELECTRON_TOOLS = [
  'mcp__electron__get_electron_window_info',
  'mcp__electron__take_screenshot',
  'mcp__electron__send_command_to_electron',
  'mcp__electron__read_electron_logs',
] as const;

// =============================================================================
// Agent Type
// =============================================================================

export type AgentType =
  | 'spec_gatherer'
  | 'spec_researcher'
  | 'spec_writer'
  | 'spec_critic'
  | 'spec_discovery'
  | 'spec_context'
  | 'spec_validation'
  | 'spec_compaction'
  | 'spec_orchestrator'
  | 'build_orchestrator'
  | 'planner'
  | 'coder'
  | 'qa_reviewer'
  | 'qa_fixer'
  | 'insights'
  | 'merge_resolver'
  | 'commit_message'
  | 'pr_template_filler'
  | 'pr_reviewer'
  | 'pr_orchestrator_parallel'
  | 'pr_followup_parallel'
  | 'pr_followup_extraction'
  | 'pr_finding_validator'
  | 'analysis'
  | 'batch_analysis'
  | 'batch_validation'
  | 'roadmap_discovery'
  | 'competitor_analysis'
  | 'ideation';

// =============================================================================
// Agent Config Shape
// =============================================================================

export interface AgentConfig {
  /** Built-in tool names allowed for this agent */
  tools: readonly string[];
  /** MCP servers to start */
  mcpServers: readonly string[];
  /** Optional MCP servers (conditionally enabled) */
  mcpServersOptional?: readonly string[];
  /** Auto-claude MCP tool names available */
  autoClaudeTools: readonly string[];
  /** Default thinking level */
  thinkingDefault: ThinkingLevel;
}

// =============================================================================
// Agent Configuration Registry
// =============================================================================

const _readTools: string[] = [...BASE_READ_TOOLS];
const _writeTools: string[] = [...BASE_WRITE_TOOLS];
const _webTools: string[] = [...WEB_TOOLS];
const _readWeb: string[] = [..._readTools, ..._webTools];
const _readWriteWeb: string[] = [..._readTools, ..._writeTools, ..._webTools];
const _readWrite: string[] = [..._readTools, ..._writeTools];

export const AGENT_CONFIGS: Record<AgentType, AgentConfig> = {
  // ── Spec Creation Phases ──
  spec_gatherer: {
    tools: _readWeb,
    mcpServers: [],
    autoClaudeTools: [],
    thinkingDefault: 'medium',
  },
  spec_researcher: {
    tools: _readWeb,
    mcpServers: ['context7'],
    autoClaudeTools: [],
    thinkingDefault: 'medium',
  },
  spec_writer: {
    tools: _readWrite,
    mcpServers: [],
    autoClaudeTools: [],
    thinkingDefault: 'high',
  },
  spec_critic: {
    tools: _readTools,
    mcpServers: [],
    autoClaudeTools: [],
    thinkingDefault: 'high',
  },
  spec_discovery: {
    tools: _readWeb,
    mcpServers: [],
    autoClaudeTools: [],
    thinkingDefault: 'medium',
  },
  spec_context: {
    tools: _readTools,
    mcpServers: [],
    autoClaudeTools: [],
    thinkingDefault: 'medium',
  },
  spec_validation: {
    tools: _readTools,
    mcpServers: [],
    autoClaudeTools: [],
    thinkingDefault: 'high',
  },
  spec_compaction: {
    tools: _readWrite,
    mcpServers: [],
    autoClaudeTools: [],
    thinkingDefault: 'medium',
  },
  // ── Orchestrators — entry points for full pipelines ──
  spec_orchestrator: {
    tools: _readWriteWeb,
    mcpServers: ['context7'],
    autoClaudeTools: [],
    thinkingDefault: 'high',
  },
  build_orchestrator: {
    tools: _readWriteWeb,
    mcpServers: ['context7', 'graphiti', 'auto-claude'],
    mcpServersOptional: ['linear'],
    autoClaudeTools: [
      TOOL_GET_BUILD_PROGRESS,
      TOOL_GET_SESSION_CONTEXT,
      TOOL_RECORD_DISCOVERY,
      TOOL_UPDATE_SUBTASK_STATUS,
    ],
    thinkingDefault: 'high',
  },
  // ── Build Phases ──
  planner: {
    tools: _readWriteWeb,
    mcpServers: ['context7', 'graphiti', 'auto-claude'],
    mcpServersOptional: ['linear'],
    autoClaudeTools: [
      TOOL_GET_BUILD_PROGRESS,
      TOOL_GET_SESSION_CONTEXT,
      TOOL_RECORD_DISCOVERY,
    ],
    thinkingDefault: 'high',
  },
  coder: {
    tools: _readWriteWeb,
    mcpServers: ['context7', 'graphiti', 'auto-claude'],
    mcpServersOptional: ['linear'],
    autoClaudeTools: [
      TOOL_UPDATE_SUBTASK_STATUS,
      TOOL_GET_BUILD_PROGRESS,
      TOOL_RECORD_DISCOVERY,
      TOOL_RECORD_GOTCHA,
      TOOL_GET_SESSION_CONTEXT,
    ],
    thinkingDefault: 'low',
  },
  // ── QA Phases ──
  qa_reviewer: {
    tools: _readWriteWeb,
    mcpServers: ['context7', 'graphiti', 'auto-claude', 'browser'],
    mcpServersOptional: ['linear'],
    autoClaudeTools: [
      TOOL_GET_BUILD_PROGRESS,
      TOOL_UPDATE_QA_STATUS,
      TOOL_GET_SESSION_CONTEXT,
    ],
    thinkingDefault: 'high',
  },
  qa_fixer: {
    tools: _readWriteWeb,
    mcpServers: ['context7', 'graphiti', 'auto-claude', 'browser'],
    mcpServersOptional: ['linear'],
    autoClaudeTools: [
      TOOL_UPDATE_SUBTASK_STATUS,
      TOOL_GET_BUILD_PROGRESS,
      TOOL_UPDATE_QA_STATUS,
      TOOL_RECORD_GOTCHA,
    ],
    thinkingDefault: 'medium',
  },
  // ── Utility Phases ──
  insights: {
    tools: _readWeb,
    mcpServers: [],
    autoClaudeTools: [],
    thinkingDefault: 'low',
  },
  merge_resolver: {
    tools: [],
    mcpServers: [],
    autoClaudeTools: [],
    thinkingDefault: 'low',
  },
  commit_message: {
    tools: [],
    mcpServers: [],
    autoClaudeTools: [],
    thinkingDefault: 'low',
  },
  pr_template_filler: {
    tools: _readTools,
    mcpServers: [],
    autoClaudeTools: [],
    thinkingDefault: 'low',
  },
  pr_reviewer: {
    tools: _readWeb,
    mcpServers: ['context7'],
    autoClaudeTools: [],
    thinkingDefault: 'high',
  },
  pr_orchestrator_parallel: {
    tools: _readWeb,
    mcpServers: ['context7'],
    autoClaudeTools: [],
    thinkingDefault: 'high',
  },
  pr_followup_parallel: {
    tools: _readWeb,
    mcpServers: ['context7'],
    autoClaudeTools: [],
    thinkingDefault: 'high',
  },
  pr_followup_extraction: {
    tools: [],
    mcpServers: [],
    autoClaudeTools: [],
    thinkingDefault: 'low',
  },
  pr_finding_validator: {
    tools: _readTools,
    mcpServers: [],
    autoClaudeTools: [],
    thinkingDefault: 'medium',
  },
  // ── Analysis Phases ──
  analysis: {
    tools: _readWeb,
    mcpServers: ['context7'],
    autoClaudeTools: [],
    thinkingDefault: 'medium',
  },
  batch_analysis: {
    tools: _readWeb,
    mcpServers: [],
    autoClaudeTools: [],
    thinkingDefault: 'low',
  },
  batch_validation: {
    tools: _readTools,
    mcpServers: [],
    autoClaudeTools: [],
    thinkingDefault: 'low',
  },
  // ── Roadmap & Ideation ──
  roadmap_discovery: {
    tools: _readWeb,
    mcpServers: ['context7'],
    autoClaudeTools: [],
    thinkingDefault: 'high',
  },
  competitor_analysis: {
    tools: _readWeb,
    mcpServers: ['context7'],
    autoClaudeTools: [],
    thinkingDefault: 'high',
  },
  ideation: {
    tools: _readWeb,
    mcpServers: [],
    autoClaudeTools: [],
    thinkingDefault: 'high',
  },
};

// =============================================================================
// MCP Server Name Mapping
// =============================================================================

const MCP_SERVER_NAME_MAP: Record<string, string> = {
  context7: 'context7',
  'graphiti-memory': 'graphiti',
  graphiti: 'graphiti',
  linear: 'linear',
  electron: 'electron',
  puppeteer: 'puppeteer',
  'auto-claude': 'auto-claude',
};

/**
 * Map a user-friendly MCP server name to an internal identifier.
 * Also accepts custom server IDs directly if provided.
 */
function mapMcpServerName(
  name: string,
  customServerIds?: readonly string[],
): string | null {
  if (!name) return null;
  const mapped = MCP_SERVER_NAME_MAP[name.toLowerCase().trim()];
  if (mapped) return mapped;
  if (customServerIds?.includes(name)) return name;
  return null;
}

// =============================================================================
// MCP Config for dynamic server resolution
// =============================================================================

export interface McpConfig {
  CONTEXT7_ENABLED?: string;
  LINEAR_MCP_ENABLED?: string;
  ELECTRON_MCP_ENABLED?: string;
  PUPPETEER_MCP_ENABLED?: string;
  CUSTOM_MCP_SERVERS?: Array<{ id: string }>;
  [key: string]: unknown;
}

export interface ProjectCapabilities {
  is_electron?: boolean;
  is_web_frontend?: boolean;
}

// =============================================================================
// ToolRegistry
// =============================================================================

/**
 * Registry for AI tools.
 *
 * Manages tool registration and provides agent-type-aware tool resolution
 * using the AGENT_CONFIGS mapping ported from Python.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, DefinedTool>();

  /**
   * Register a tool by name.
   */
  registerTool(name: string, definedTool: DefinedTool): void {
    this.tools.set(name, definedTool);
  }

  /**
   * Get a registered tool by name, or undefined if not found.
   */
  getTool(name: string): DefinedTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all registered tool names.
   */
  getRegisteredNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Get the AI SDK tool map for a given agent type, bound to the provided context.
   *
   * Filters registered tools to only those allowed by AGENT_CONFIGS for the
   * specified agent type. Returns a Record<string, AITool> suitable for passing
   * to the Vercel AI SDK `generateText` / `streamText` calls.
   */
  getToolsForAgent(
    agentType: AgentType,
    context: ToolContext,
  ): Record<string, AITool> {
    const config = getAgentConfig(agentType);
    const allowedNames = new Set(config.tools);
    const result: Record<string, AITool> = {};

    for (const [name, definedTool] of Array.from(this.tools.entries())) {
      if (allowedNames.has(name)) {
        result[name] = definedTool.bind(context);
      }
    }

    return result;
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get full configuration for an agent type.
 *
 * @throws {Error} If agent_type is not found in AGENT_CONFIGS
 */
export function getAgentConfig(agentType: AgentType): AgentConfig {
  const config = AGENT_CONFIGS[agentType];
  if (!config) {
    const validTypes = Object.keys(AGENT_CONFIGS).sort().join(', ');
    throw new Error(
      `Unknown agent type: '${agentType}'. Valid types: ${validTypes}`,
    );
  }
  return config;
}

/**
 * Get default thinking level for an agent type.
 */
export function getDefaultThinkingLevel(agentType: AgentType): ThinkingLevel {
  return getAgentConfig(agentType).thinkingDefault;
}

/**
 * Get MCP servers required for an agent type.
 *
 * Handles dynamic server selection:
 * - "browser" → electron (if is_electron) or puppeteer (if is_web_frontend)
 * - "linear" → only if in mcpServersOptional AND linearEnabled is true
 * - "graphiti" → only if graphitiEnabled is true
 * - Applies per-agent ADD/REMOVE overrides from mcpConfig
 */
export function getRequiredMcpServers(
  agentType: AgentType,
  options: {
    projectCapabilities?: ProjectCapabilities;
    linearEnabled?: boolean;
    graphitiEnabled?: boolean;
    mcpConfig?: McpConfig;
  } = {},
): string[] {
  const {
    projectCapabilities,
    linearEnabled = false,
    graphitiEnabled = false,
    mcpConfig = {},
  } = options;

  const config = getAgentConfig(agentType);
  let servers = [...config.mcpServers];

  // Filter context7 if explicitly disabled
  if (servers.includes('context7')) {
    const enabled = mcpConfig.CONTEXT7_ENABLED ?? 'true';
    if (String(enabled).toLowerCase() === 'false') {
      servers = servers.filter((s) => s !== 'context7');
    }
  }

  // Handle optional servers (e.g., Linear)
  const optional = config.mcpServersOptional ?? [];
  if (optional.includes('linear') && linearEnabled) {
    const linearMcpEnabled = mcpConfig.LINEAR_MCP_ENABLED ?? 'true';
    if (String(linearMcpEnabled).toLowerCase() !== 'false') {
      servers.push('linear');
    }
  }

  // Handle dynamic "browser" → electron/puppeteer
  if (servers.includes('browser')) {
    servers = servers.filter((s) => s !== 'browser');
    if (projectCapabilities) {
      const { is_electron, is_web_frontend } = projectCapabilities;
      const electronEnabled = mcpConfig.ELECTRON_MCP_ENABLED ?? 'false';
      const puppeteerEnabled = mcpConfig.PUPPETEER_MCP_ENABLED ?? 'false';

      if (is_electron && String(electronEnabled).toLowerCase() === 'true') {
        servers.push('electron');
      } else if (is_web_frontend && !is_electron) {
        if (String(puppeteerEnabled).toLowerCase() === 'true') {
          servers.push('puppeteer');
        }
      }
    }
  }

  // Filter graphiti if not enabled
  if (servers.includes('graphiti') && !graphitiEnabled) {
    servers = servers.filter((s) => s !== 'graphiti');
  }

  // Per-agent MCP overrides: AGENT_MCP_<agent>_ADD / AGENT_MCP_<agent>_REMOVE
  const customServerIds =
    mcpConfig.CUSTOM_MCP_SERVERS?.map((s) => s.id).filter(Boolean) ?? [];

  const addKey = `AGENT_MCP_${agentType}_ADD`;
  const addValue = mcpConfig[addKey];
  if (typeof addValue === 'string') {
    const additions = addValue.split(',').map((s) => s.trim()).filter(Boolean);
    for (const server of additions) {
      const mapped = mapMcpServerName(server, customServerIds);
      if (mapped && !servers.includes(mapped)) {
        servers.push(mapped);
      }
    }
  }

  const removeKey = `AGENT_MCP_${agentType}_REMOVE`;
  const removeValue = mcpConfig[removeKey];
  if (typeof removeValue === 'string') {
    const removals = removeValue.split(',').map((s) => s.trim()).filter(Boolean);
    for (const server of removals) {
      const mapped = mapMcpServerName(server, customServerIds);
      if (mapped && mapped !== 'auto-claude') {
        servers = servers.filter((s) => s !== mapped);
      }
    }
  }

  return servers;
}
