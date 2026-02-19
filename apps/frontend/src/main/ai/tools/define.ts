/**
 * Tool.define() Wrapper
 * =====================
 *
 * Wraps the Vercel AI SDK v6 `tool()` function with:
 * - Zod v3 input schema validation
 * - Security hook integration (pre-execution)
 * - Tool context injection
 *
 * Usage:
 *   const readTool = Tool.define({
 *     metadata: { name: 'Read', description: '...', permission: 'read_only', executionOptions: DEFAULT_EXECUTION_OPTIONS },
 *     inputSchema: z.object({ file_path: z.string() }),
 *     execute: async (input, ctx) => { ... },
 *   });
 *
 *   // Later, bind context and get AI SDK tool:
 *   const aiTool = readTool.bind(toolContext);
 */

import { tool } from 'ai';
import type { Tool as AITool } from 'ai';
import { z } from 'zod/v3';

import { bashSecurityHook } from '../security/bash-validator';
import type {
  ToolContext,
  ToolDefinitionConfig,
  ToolMetadata,
} from './types';
import { ToolPermission } from './types';

// ---------------------------------------------------------------------------
// Defined Tool
// ---------------------------------------------------------------------------

/**
 * A defined tool that can be bound to a ToolContext to produce
 * an AI SDK v6 compatible tool object.
 */
export interface DefinedTool<
  TInput extends z.ZodType = z.ZodType,
  TOutput = unknown,
> {
  /** Tool metadata */
  metadata: ToolMetadata;
  /** Bind a ToolContext to produce an AI SDK tool */
  bind: (context: ToolContext) => AITool<z.infer<TInput>, TOutput>;
  /** Original config for inspection/testing */
  config: ToolDefinitionConfig<TInput, TOutput>;
}

// ---------------------------------------------------------------------------
// Security pre-execution hook
// ---------------------------------------------------------------------------

/**
 * Run security hooks before tool execution.
 * Currently validates Bash commands against the security profile.
 */
function runSecurityHooks(
  toolName: string,
  input: Record<string, unknown>,
  context: ToolContext,
): void {
  const result = bashSecurityHook(
    {
      toolName,
      toolInput: input,
      cwd: context.cwd,
    },
    context.securityProfile,
  );

  if ('hookSpecificOutput' in result) {
    const reason = result.hookSpecificOutput.permissionDecisionReason;
    throw new Error(`Security hook denied ${toolName}: ${reason}`);
  }
}

// ---------------------------------------------------------------------------
// Tool.define()
// ---------------------------------------------------------------------------

/**
 * Define a tool with metadata, Zod input schema, and execute function.
 * Returns a DefinedTool that can be bound to a ToolContext for use with AI SDK.
 */
function define<TInput extends z.ZodType, TOutput>(
  config: ToolDefinitionConfig<TInput, TOutput>,
): DefinedTool<TInput, TOutput> {
  const { metadata, inputSchema, execute } = config;

  return {
    metadata,
    config,
    bind(context: ToolContext): AITool<z.infer<TInput>, TOutput> {
      type Input = z.infer<TInput>;

      // Use type assertion because tool() overloads can't infer
      // from generic TInput/TOutput at the definition site.
      // Concrete types resolve correctly when Tool.define() is called
      // with a specific Zod schema.
      const executeWithHooks = async (input: Input): Promise<TOutput> => {
        if (metadata.permission !== ToolPermission.ReadOnly) {
          runSecurityHooks(
            metadata.name,
            input as Record<string, unknown>,
            context,
          );
        }
        return execute(input as z.infer<TInput>, context) as Promise<TOutput>;
      };

      return tool({
        description: metadata.description,
        parameters: inputSchema,
        execute: executeWithHooks,
      } as unknown as Parameters<typeof tool>[0]) as AITool<Input, TOutput>;
    },
  };
}

/**
 * Tool namespace — entry point for defining tools.
 *
 * @example
 * ```ts
 * import { Tool } from './define';
 *
 * const myTool = Tool.define({
 *   metadata: { name: 'MyTool', ... },
 *   inputSchema: z.object({ ... }),
 *   execute: async (input, ctx) => { ... },
 * });
 * ```
 */
export const Tool = { define } as const;
