import { describe, it, expect } from 'vitest';

import {
  AGENT_CONFIGS,
  getAgentConfig,
  getDefaultThinkingLevel,
  getRequiredMcpServers,
  mapMcpServerName,
  CONTEXT7_TOOLS,
  LINEAR_TOOLS,
  MEMORY_MCP_TOOLS,
  PUPPETEER_TOOLS,
  ELECTRON_TOOLS,
  type AgentType,
} from '../agent-configs';

// =============================================================================
// All retained non-BMad agent types
// =============================================================================

const ALL_AGENT_TYPES: AgentType[] = [
  'insights',
  'merge_resolver',
  'commit_message',
  'pr_template_filler',
  'pr_reviewer',
  'pr_orchestrator_parallel',
  'pr_followup_parallel',
  'pr_followup_extraction',
  'pr_finding_validator',
  'pr_security_specialist',
  'pr_quality_specialist',
  'pr_logic_specialist',
  'pr_codebase_fit_specialist',
  'analysis',
  'batch_analysis',
  'batch_validation',
  'roadmap_discovery',
  'competitor_analysis',
  'ideation',
];

describe('AGENT_CONFIGS', () => {
  it('should have all expected agent types configured', () => {
    expect(Object.keys(AGENT_CONFIGS)).toHaveLength(ALL_AGENT_TYPES.length);
  });

  it('should contain all expected agent types', () => {
    for (const agentType of ALL_AGENT_TYPES) {
      expect(AGENT_CONFIGS).toHaveProperty(agentType);
    }
  });

  it('should have valid thinking defaults for all agents', () => {
    const validLevels = new Set(['low', 'medium', 'high']);
    for (const config of Object.values(AGENT_CONFIGS)) {
      expect(validLevels.has(config.thinkingDefault)).toBe(true);
    }
  });

  it('should have tools as arrays for all agents', () => {
    for (const config of Object.values(AGENT_CONFIGS)) {
      expect(Array.isArray(config.tools)).toBe(true);
      expect(Array.isArray(config.mcpServers)).toBe(true);
      expect(Array.isArray(config.autoClaudeTools)).toBe(true);
    }
  });

  it('should configure roadmap discovery with read+write+web tools and context7', () => {
    const config = AGENT_CONFIGS.roadmap_discovery;
    expect(config.tools).toContain('Read');
    expect(config.tools).toContain('Write');
    expect(config.tools).toContain('Edit');
    expect(config.tools).toContain('Bash');
    expect(config.tools).toContain('WebFetch');
    expect(config.tools).toContain('Glob');
    expect(config.tools).toContain('Grep');
    expect(config.mcpServers).toContain('context7');
    expect(config.thinkingDefault).toBe('high');
  });

  it('should configure analysis with context7 MCP', () => {
    const config = AGENT_CONFIGS.analysis;
    expect(config.mcpServers).toContain('context7');
    expect(config.thinkingDefault).toBe('medium');
  });

  it('should configure PR specialists with read-only tools', () => {
    const config = AGENT_CONFIGS.pr_security_specialist;
    expect(config.tools).toContain('Read');
    expect(config.tools).toContain('Glob');
    expect(config.tools).toContain('Grep');
    expect(config.tools).not.toContain('Write');
    expect(config.tools).not.toContain('Edit');
    expect(config.tools).not.toContain('Bash');
  });

  it('should configure merge_resolver with no tools', () => {
    const config = AGENT_CONFIGS.merge_resolver;
    expect(config.tools).toHaveLength(0);
    expect(config.mcpServers).toHaveLength(0);
  });

  it('should not configure the deleted SpawnSubagent tool for any agent', () => {
    for (const config of Object.values(AGENT_CONFIGS)) {
      expect(config.tools).not.toContain('SpawnSubagent');
    }
  });
});

describe('MCP tool arrays', () => {
  it('CONTEXT7_TOOLS should have 2 tools', () => {
    expect(CONTEXT7_TOOLS).toHaveLength(2);
    expect(CONTEXT7_TOOLS).toContain('mcp__context7__resolve-library-id');
  });

  it('LINEAR_TOOLS should have 16 tools', () => {
    expect(LINEAR_TOOLS).toHaveLength(16);
  });

  it('MEMORY_MCP_TOOLS should have 5 tools', () => {
    expect(MEMORY_MCP_TOOLS).toHaveLength(5);
  });

  it('PUPPETEER_TOOLS should have 8 tools', () => {
    expect(PUPPETEER_TOOLS).toHaveLength(8);
  });

  it('ELECTRON_TOOLS should have 4 tools', () => {
    expect(ELECTRON_TOOLS).toHaveLength(4);
  });
});

describe('getAgentConfig', () => {
  it('should return config for valid agent types', () => {
    const config = getAgentConfig('analysis');
    expect(config).toBeDefined();
    expect(config.tools).toBeDefined();
    expect(config.mcpServers).toBeDefined();
  });

  it('should throw for unknown agent type', () => {
    expect(() => getAgentConfig('unknown_agent' as AgentType)).toThrow(
      /Unknown agent type/,
    );
  });
});

describe('getDefaultThinkingLevel', () => {
  it.each([
    ['analysis', 'medium'],
    ['roadmap_discovery', 'high'],
    ['competitor_analysis', 'high'],
    ['pr_reviewer', 'high'],
    ['pr_finding_validator', 'medium'],
    ['ideation', 'high'],
    ['insights', 'low'],
  ] as [AgentType, string][])(
    'should return %s thinking level for %s',
    (agentType, expected) => {
      expect(getDefaultThinkingLevel(agentType)).toBe(expected);
    },
  );
});

describe('mapMcpServerName', () => {
  it('should map known server names', () => {
    expect(mapMcpServerName('context7')).toBe('context7');
    expect(mapMcpServerName('graphiti')).toBe('memory');
    expect(mapMcpServerName('graphiti-memory')).toBe('memory');
    expect(mapMcpServerName('linear')).toBe('linear');
    expect(mapMcpServerName('auto-claude')).toBe('auto-claude');
  });

  it('should return null for unknown names', () => {
    expect(mapMcpServerName('unknown')).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(mapMcpServerName('')).toBeNull();
  });

  it('should be case-insensitive', () => {
    expect(mapMcpServerName('Context7')).toBe('context7');
    expect(mapMcpServerName('GRAPHITI')).toBe('memory');
  });

  it('should accept custom server IDs', () => {
    expect(mapMcpServerName('my-custom-server', ['my-custom-server'])).toBe(
      'my-custom-server',
    );
  });
});

describe('getRequiredMcpServers', () => {
  it('should return base MCP servers for an agent', () => {
    const servers = getRequiredMcpServers('analysis');
    expect(servers).toContain('context7');
  });

  it('should return empty array for agents with no MCP', () => {
    const servers = getRequiredMcpServers('merge_resolver');
    expect(servers).toEqual([]);
  });

  it('should filter memory when not enabled', () => {
    const servers = getRequiredMcpServers('analysis', { memoryEnabled: false });
    expect(servers).not.toContain('memory');
  });

  it('should filter context7 when explicitly disabled', () => {
    const servers = getRequiredMcpServers('analysis', {
      context7Enabled: false,
    });
    expect(servers).not.toContain('context7');
  });

  it('should support per-agent MCP additions', () => {
    const servers = getRequiredMcpServers('insights', {
      agentMcpAdd: 'context7',
    });
    expect(servers).toContain('context7');
  });

  it('should support per-agent MCP removals but never remove protected auto-claude additions', () => {
    const servers = getRequiredMcpServers('analysis', {
      agentMcpAdd: 'auto-claude',
      agentMcpRemove: 'auto-claude,context7',
    });
    expect(servers).toContain('auto-claude');
    expect(servers).not.toContain('context7');
  });
});
