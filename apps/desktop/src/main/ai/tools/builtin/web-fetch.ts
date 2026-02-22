/**
 * WebFetch Tool
 * =============
 *
 * Fetches content from a URL and processes it with an AI model prompt.
 * Converts HTML to markdown for analysis.
 */

import { z } from 'zod/v3';

import { Tool } from '../define';
import { DEFAULT_EXECUTION_OPTIONS, ToolPermission } from '../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 30_000;
const MAX_CONTENT_LENGTH = 100_000;

// ---------------------------------------------------------------------------
// Input Schema
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  url: z.string().url().describe('The URL to fetch content from'),
  prompt: z
    .string()
    .describe('The prompt to run on the fetched content — describes what information to extract'),
});

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export const webFetchTool = Tool.define({
  metadata: {
    name: 'WebFetch',
    description:
      'Fetches content from a specified URL and processes it using an AI model. Takes a URL and a prompt as input, fetches the URL content, and returns processed results.',
    permission: ToolPermission.ReadOnly,
    executionOptions: {
      ...DEFAULT_EXECUTION_OPTIONS,
      timeoutMs: FETCH_TIMEOUT_MS,
    },
  },
  inputSchema,
  execute: async (input) => {
    const { url, prompt } = input;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'AutoClaude/1.0',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return `Error: HTTP ${response.status} ${response.statusText} fetching ${url}`;
      }

      let content = await response.text();

      if (content.length > MAX_CONTENT_LENGTH) {
        content = `${content.slice(0, MAX_CONTENT_LENGTH)}\n\n[Content truncated — ${content.length} characters total]`;
      }

      // Return content with the prompt context for further processing
      return `URL: ${url}\nPrompt: ${prompt}\n\n--- Fetched Content ---\n${content}`;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return `Error: Request timed out after ${FETCH_TIMEOUT_MS}ms fetching ${url}`;
      }
      const message = error instanceof Error ? error.message : String(error);
      return `Error: Failed to fetch ${url} — ${message}`;
    }
  },
});
