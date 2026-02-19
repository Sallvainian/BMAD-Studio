/**
 * WebSearch Tool
 * ==============
 *
 * Performs web searches and returns results.
 * Supports domain filtering (allow/block lists).
 */

import { z } from 'zod/v3';

import { Tool } from '../define';
import { DEFAULT_EXECUTION_OPTIONS, ToolPermission } from '../types';

// ---------------------------------------------------------------------------
// Input Schema
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  query: z.string().min(2).describe('The search query to use'),
  allowed_domains: z
    .array(z.string())
    .optional()
    .describe('Only include search results from these domains'),
  blocked_domains: z
    .array(z.string())
    .optional()
    .describe('Never include search results from these domains'),
});

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export const webSearchTool = Tool.define({
  metadata: {
    name: 'WebSearch',
    description:
      'Searches the web and returns results to inform responses. Provides up-to-date information for current events and recent data. Supports domain filtering.',
    permission: ToolPermission.ReadOnly,
    executionOptions: DEFAULT_EXECUTION_OPTIONS,
  },
  inputSchema,
  execute: async (input) => {
    const { query, allowed_domains, blocked_domains } = input;

    // Web search is a provider-side capability (Anthropic handles the actual search).
    // This tool definition serves as the schema/interface for the AI SDK.
    // The actual search execution is delegated to the model provider.
    const parts: string[] = [`Search query: ${query}`];

    if (allowed_domains?.length) {
      parts.push(`Allowed domains: ${allowed_domains.join(', ')}`);
    }

    if (blocked_domains?.length) {
      parts.push(`Blocked domains: ${blocked_domains.join(', ')}`);
    }

    return parts.join('\n');
  },
});
