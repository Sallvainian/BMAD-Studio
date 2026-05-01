/**
 * BMad workflow runner
 * ====================
 *
 * Generic runtime that executes any installed BMAD skill via Vercel AI SDK
 * v6 `streamText()`. Implements BMAD docs § "The Activation Flow" verbatim
 * (8-step sequence: resolve → prepend → adopt persona → load facts → load
 * config → greet → append → dispatch) and surfaces interactive menus to the
 * caller as they appear in the model's responses.
 *
 * Per ENGINE_SWAP_PROMPT.md KAD-4: the runner is **agnostic** to which skill
 * it's running — the skill's `SKILL.md` body + step files + customize.toml
 * fully describe behavior. Adding a new BMAD module adds zero code here.
 *
 * Per KAD-7: a persona persists across runs (the caller manages persona
 * persistence in a worker thread); each `runWorkflow()` call starts a fresh
 * `streamText()` conversation. Persona system prompt is layered onto the
 * workflow body when one is supplied.
 *
 * Flow:
 *   1. Resolve workflow customization via skill registry (already cached)
 *   2. Build variable context from `_bmad/config.toml`
 *   3. Build the system prompt:
 *        - persona block (if supplied)
 *        - SKILL.md body (variable-substituted)
 *        - persistent_facts (loaded if `file:` prefix; verbatim otherwise)
 *        - args injected as initial user message
 *   4. Construct AI SDK client + tools (Read, Write, Edit, Glob, Grep, Bash)
 *   5. Loop: streamText() → check for completion / menu → call `onMenu` if
 *      menu detected → reinject user choice → continue. Bound by
 *      `maxTurns` to prevent runaway sessions.
 *   6. Capture file writes the model performed (for `outputFiles` result)
 *
 * Per BMAD docs § "Why Not Just a Menu?": the model decides when to halt
 * and present a menu — we detect those halts heuristically (numbered/lettered
 * options at end of message). When detection fails, the runner still surfaces
 * the raw text to `onMenu` with no parsed options, and the UI degrades to
 * a free-form input box.
 */

import path from 'node:path';
import { stepCountIs, streamText } from 'ai';
import type { LanguageModel, Tool as AITool } from 'ai';

import type { ClaudeProfile } from '../../../shared/types/agent';
import {
  bmadFail,
  bmadOk,
  type BmadError,
  type BmadIpcResult,
  type BmadPersonaIdentity,
  type BmadSkill,
  type BmadVariableContext,
  type BmadWorkflowMenu,
  type BmadWorkflowMenuOption,
  type BmadWorkflowOutcome,
  type BmadWorkflowResult,
  type BmadWorkflowStep,
  type BmadWorkflowStreamChunk,
  type BmadWorkflowUserChoice,
} from '../../../shared/types/bmad';
import { createSimpleClient } from '../client/factory';
import { getSecurityProfile } from '../security/security-profile';
import { buildToolRegistry } from '../tools/build-registry';
import type { ToolContext } from '../tools/types';
import { getSharedSkillRegistry, SkillRegistry } from './skill-registry';
import { buildVariableContext, substituteVariables } from './variables';
import { loadCurrentStep, nextStepIndex, StepLoaderError } from './step-loader';

// =============================================================================
// Errors
// =============================================================================

export class WorkflowRunnerError extends Error {
  readonly code:
    | 'SKILL_NOT_FOUND'
    | 'SKILL_PARSE_ERROR'
    | 'PERSONA_MISMATCH'
    | 'STEP_LOAD_VIOLATION'
    | 'STEP_FILE_NOT_FOUND'
    | 'PROVIDER_ERROR'
    | 'INVALID_INPUT'
    | 'IO_ERROR'
    | 'UNKNOWN';
  readonly cause?: unknown;
  readonly details?: unknown;

  constructor(
    code: WorkflowRunnerError['code'],
    message: string,
    options?: { cause?: unknown; details?: unknown },
  ) {
    super(message);
    this.name = 'WorkflowRunnerError';
    this.code = code;
    if (options?.cause !== undefined) this.cause = options.cause;
    if (options?.details !== undefined) this.details = options.details;
  }
}

// =============================================================================
// Public API — RunWorkflowOptions
// =============================================================================

export interface RunWorkflowCallbacks {
  /** One streamed chunk (text delta, tool call, step transition). */
  readonly onStreamChunk?: (chunk: BmadWorkflowStreamChunk) => void;
  /**
   * Called when the runner advances to a new step file (just-in-time loaded
   * via `step-loader.ts`). Skipped for skills without numbered step files
   * (e.g. `bmad-help`, `bmad-dev-story` — workflow body is in SKILL.md).
   */
  readonly onStepStart?: (step: BmadWorkflowStep) => void;
  /**
   * Called when the model halts and waits for user input. The runner detects
   * this heuristically — when streamText() finishes without a tool call AND
   * the model's response either ends with a menu pattern or asks a question.
   *
   * The promise resolves with the user's choice. Returning a `text` field
   * with empty string aborts the workflow.
   */
  readonly onMenu?: (menu: BmadWorkflowMenu) => Promise<BmadWorkflowUserChoice>;
  /** Called once when the workflow signals completion or aborts. */
  readonly onComplete?: (result: BmadWorkflowResult) => void;
}

export interface RunWorkflowOptions extends RunWorkflowCallbacks {
  /** Canonical id of the skill to execute. */
  readonly skillName: string;
  /**
   * Optional persona for agent-skill execution. When supplied, the persona's
   * identity + customizable surface (icon/role/principles) is layered on top
   * of the skill body in the system prompt. Per KAD-7, the caller is
   * responsible for persona persistence across calls.
   */
  readonly persona?: BmadPersonaIdentity;
  /** Absolute path to the project root. */
  readonly projectRoot: string;
  /** Active Claude/AI profile for provider+credential resolution. */
  readonly activeProfile: ClaudeProfile;
  /**
   * Optional skill args from the `bmad-help.csv` `args` column. Injected
   * as the initial user message ("invoking with args: …") so the skill's
   * activation logic can branch (e.g. autonomous vs guided mode).
   */
  readonly args?: readonly string[];
  /**
   * Maximum number of conversational turns before the runner halts and
   * returns `outcome: 'max_turns'`. Defaults to 50 — generous enough for
   * `bmad-create-prd` (12 steps × 1-3 turns each) but bounded.
   */
  readonly maxTurns?: number;
  /**
   * Maximum agentic steps per `streamText()` call. Defaults to 25 — enough
   * for the model to do a few file reads + a write + a menu render before
   * yielding back to the runner.
   */
  readonly maxStepsPerTurn?: number;
  /** Caller-supplied abort signal. */
  readonly abortSignal?: AbortSignal;
  /** Optional skill registry override (defaults to the shared singleton). */
  readonly skillRegistry?: SkillRegistry;
  /**
   * Optional override for the language model. When supplied, the runner
   * skips `createSimpleClient` and uses this model directly. Useful for
   * tests with a mock model.
   */
  readonly model?: LanguageModel;
  /** Override builtin tools (test-only). */
  readonly tools?: Record<string, AITool>;
  /**
   * Initial messages injected before the first model turn (besides the
   * activation greeting). The default is empty; callers that resume an
   * in-flight conversation pass the prior messages.
   */
  readonly initialMessages?: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
}

// =============================================================================
// runWorkflow
// =============================================================================

/**
 * Execute a BMAD skill end-to-end. Returns when the workflow completes,
 * aborts, errors, or hits `maxTurns`. The activation sequence per BMAD docs
 * § "The Activation Flow" runs once at the start; the workflow body then
 * loops with menu interactions until completion.
 */
export async function runWorkflow(options: RunWorkflowOptions): Promise<BmadWorkflowResult> {
  const startedAt = Date.now();
  const skillRegistry = options.skillRegistry ?? getSharedSkillRegistry();
  const projectRoot = path.resolve(options.projectRoot);

  // 1. Resolve skill (activation flow Step 1: resolve workflow/agent block)
  const skill = await skillRegistry
    .load(options.skillName, { projectRoot })
    .catch((err) => {
      throw new WorkflowRunnerError(
        'SKILL_NOT_FOUND',
        `failed to load skill ${options.skillName}: ${(err as Error).message}`,
        { cause: err },
      );
    });

  // 2. Build variable context (activation flow Step 5: load config)
  const variables = await buildVariableContext({
    projectRoot,
    skillDir: skill.skillDir,
    skillName: skill.canonicalId,
    module: skill.module,
  });

  // 3. Compose the system prompt (activation flow Steps 2,3,6,7 are encoded
  //    into the prompt as instructions; the model executes them).
  const systemPrompt = composeSystemPrompt({
    skill,
    persona: options.persona,
    variables,
    args: options.args,
  });

  // 4. Resolve provider + tools
  const { model, tools } = await resolveModelAndTools({
    activeProfile: options.activeProfile,
    projectRoot,
    abortSignal: options.abortSignal,
    modelOverride: options.model,
    toolsOverride: options.tools,
  });

  // 5. Conversation state
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    ...(options.initialMessages ?? []).map((m) => ({ role: m.role, content: m.content })),
  ];

  // Inject the initial dispatch message so the model starts its activation flow.
  if (messages.length === 0) {
    messages.push({
      role: 'user',
      content: buildInitialUserMessage({ skill, persona: options.persona, args: options.args }),
    });
  }

  const maxTurns = options.maxTurns ?? 50;
  const maxStepsPerTurn = options.maxStepsPerTurn ?? 25;
  const outputFiles = new Set<string>();
  let turn = 0;
  let outcome: BmadWorkflowOutcome = 'completed';
  let error: BmadError | undefined;
  let seq = 0;

  try {
    while (turn < maxTurns) {
      if (options.abortSignal?.aborted) {
        outcome = 'aborted';
        break;
      }

      turn += 1;

      const turnResult = await runOneTurn({
        model,
        tools,
        systemPrompt,
        messages,
        maxSteps: maxStepsPerTurn,
        abortSignal: options.abortSignal,
        emit: (chunk) =>
          options.onStreamChunk?.({ ...chunk, seq: seq++, timestamp: Date.now() }),
      });

      // Record any file writes the model performed via Write/Edit tools.
      for (const filePath of turnResult.fileWrites) {
        outputFiles.add(filePath);
      }

      // Push the assistant's text response into the conversation history
      // so the next turn sees the model's commitments + menu prompt.
      if (turnResult.responseText) {
        messages.push({ role: 'assistant', content: turnResult.responseText });
      }

      // Step transition detection: if the workflow has step files and the
      // output file's `stepsCompleted` advanced, surface the new step.
      const stepInfo = await detectStepTransition({
        skill,
        variables,
        previousSeen: outputFiles,
      });
      if (stepInfo) {
        options.onStepStart?.(stepInfo);
        options.onStreamChunk?.({
          kind: 'step-start',
          stepFileName: stepInfo.fileName,
          seq: seq++,
          timestamp: Date.now(),
          text: stepInfo.body,
        });
      }

      // Completion detection: model explicitly signals "workflow complete"
      // or there are no more pending steps.
      if (detectCompletion(turnResult.responseText)) {
        outcome = 'completed';
        break;
      }

      // Menu detection: if the model paused for input, surface to onMenu.
      const menu = detectMenu(turnResult.responseText);
      if (menu) {
        options.onStreamChunk?.({
          kind: 'menu',
          text: menu.prompt,
          seq: seq++,
          timestamp: Date.now(),
        });

        if (!options.onMenu) {
          // No menu callback — caller doesn't want interactive runs. Stop
          // here so the renderer can pick up via its own session manager.
          outcome = 'completed';
          break;
        }

        const choice = await options.onMenu(menu);
        if (!choice.text || choice.text.trim() === '') {
          outcome = 'aborted';
          break;
        }

        messages.push({
          role: 'user',
          content: choice.optionCode
            ? `${choice.optionCode} ${choice.text}`.trim()
            : choice.text,
        });
        continue;
      }

      // No menu detected, no completion signal — assume the model finished
      // its work for now. Loop one more time to give it a chance to wrap up.
      // If it reaches max-turns we'll bail out at the top of the loop.
      if (turnResult.toolCallCount === 0 && !turnResult.responseText.trim()) {
        outcome = 'completed';
        break;
      }
    }

    if (turn >= maxTurns && outcome === 'completed') {
      outcome = 'max_turns';
    }
  } catch (err) {
    outcome = 'error';
    if (err instanceof WorkflowRunnerError) {
      error = { code: 'IO_ERROR', message: err.message, details: err.details };
    } else if (err instanceof StepLoaderError) {
      error = {
        code: err.code === 'STEP_LOAD_VIOLATION' ? 'STEP_LOAD_VIOLATION' : 'IO_ERROR',
        message: err.message,
        details: err.details,
      };
    } else if (err instanceof Error) {
      error = { code: 'UNKNOWN', message: err.message };
    } else {
      error = { code: 'UNKNOWN', message: String(err) };
    }
    options.onStreamChunk?.({
      kind: 'error',
      text: error.message,
      seq: seq++,
      timestamp: Date.now(),
    });
  }

  const result: BmadWorkflowResult = {
    outcome,
    skillId: options.skillName,
    turns: turn,
    durationMs: Date.now() - startedAt,
    outputFiles: [...outputFiles],
    ...(error ? { error } : {}),
  };

  options.onStreamChunk?.({
    kind: 'done',
    seq: seq++,
    timestamp: Date.now(),
  });
  options.onComplete?.(result);
  return result;
}

/**
 * Convenience wrapper that returns the runner's result wrapped in the BMAD
 * IPC envelope. Used by `bmad-handlers.ts` so the handler stays terse.
 */
export async function runWorkflowSafe(
  options: RunWorkflowOptions,
): Promise<BmadIpcResult<BmadWorkflowResult>> {
  try {
    const result = await runWorkflow(options);
    return bmadOk(result);
  } catch (err) {
    if (err instanceof WorkflowRunnerError) {
      const code = err.code === 'UNKNOWN' ? 'UNKNOWN' : err.code;
      return bmadFail(code === 'PERSONA_MISMATCH' ? 'INVALID_INPUT' : code, err.message);
    }
    if (err instanceof Error) return bmadFail('UNKNOWN', err.message);
    return bmadFail('UNKNOWN', 'workflow runner threw a non-Error value');
  }
}

// =============================================================================
// Internals — system prompt composition
// =============================================================================

interface ComposeSystemPromptOptions {
  readonly skill: BmadSkill;
  readonly persona: BmadPersonaIdentity | undefined;
  readonly variables: BmadVariableContext;
  readonly args: readonly string[] | undefined;
}

/**
 * Build the system prompt consumed by `streamText()`. Layout:
 *
 *   PART 1 — Persona block (only when a persona is supplied)
 *           Identity, role, communication style, principles, persistent_facts.
 *
 *   PART 2 — Skill body (the SKILL.md content with variables substituted)
 *
 *   PART 3 — Runtime context (skill-name, project-root, output paths)
 *
 *   PART 4 — Activation note (mirrors BMAD's 8-step activation flow per
 *           BMAD docs § "The Activation Flow"; reminds the model not to
 *           pre-load step files per § "Critical Rules (NO EXCEPTIONS)")
 */
export function composeSystemPrompt(options: ComposeSystemPromptOptions): string {
  const { skill, persona, variables, args } = options;

  const sections: string[] = [];

  if (persona) {
    sections.push(buildPersonaSection(persona, variables));
  }

  sections.push(`# Skill: ${skill.canonicalId}`);
  sections.push(`Module: ${skill.module}`);
  sections.push(`Description: ${skill.frontmatter.description || skill.canonicalId}`);
  sections.push('');

  // Workflow / agent body — variable-substituted.
  sections.push(substituteVariables(skill.body, variables));

  // Runtime context (a small block the model can reference).
  sections.push(buildRuntimeContextSection(skill, variables));

  // Activation reminder.
  sections.push(buildActivationReminder(persona));

  if (args && args.length > 0) {
    sections.push(`# Invocation args\n\n${args.map((a) => `- ${a}`).join('\n')}\n`);
  }

  return sections.join('\n\n');
}

function buildPersonaSection(
  persona: BmadPersonaIdentity,
  variables: BmadVariableContext,
): string {
  const persistentFacts = persona.persistentFacts
    .map((f) => `- ${substituteVariables(f, variables)}`)
    .join('\n');

  return [
    `# Persona: ${persona.name}, ${persona.title}`,
    `Icon: ${persona.icon}`,
    `Module: ${persona.module}`,
    `Description: ${persona.description}`,
    '',
    `## Identity`,
    persona.identity || '(no extended identity beyond name/title)',
    '',
    `## Role`,
    persona.role || '(role inherited from skill body)',
    '',
    `## Communication style`,
    persona.communicationStyle || '(default — match the user\'s tone)',
    '',
    persona.principles.length > 0
      ? `## Principles\n\n${persona.principles.map((p) => `- ${p}`).join('\n')}`
      : '',
    persistentFacts ? `## Persistent facts\n\n${persistentFacts}` : '',
    '',
    `**Always prefix your responses with ${persona.icon} so the user can see who is speaking.**`,
  ]
    .filter(Boolean)
    .join('\n');
}

function buildRuntimeContextSection(
  skill: BmadSkill,
  variables: BmadVariableContext,
): string {
  return [
    `# Runtime context`,
    `- skill-name: ${skill.canonicalId}`,
    `- skill-root: ${variables.skillRoot}`,
    `- project-root: ${variables.projectRoot}`,
    `- planning_artifacts: ${variables.planningArtifacts}`,
    `- implementation_artifacts: ${variables.implementationArtifacts}`,
    `- project_knowledge: ${variables.projectKnowledge}`,
    `- output_folder: ${variables.outputFolder}`,
    `- communication_language: ${variables.communicationLanguage}`,
    `- document_output_language: ${variables.documentOutputLanguage}`,
    `- user_name: ${variables.userName || '(not configured)'}`,
    `- date: ${variables.date}`,
  ].join('\n');
}

function buildActivationReminder(persona: BmadPersonaIdentity | undefined): string {
  const personaLine = persona
    ? `- You are ${persona.name}, ${persona.title}. Stay in character; prefix replies with ${persona.icon}.`
    : '';

  return [
    `# Activation rules (BMAD docs § "The Activation Flow")`,
    personaLine,
    `- Execute the 8-step activation flow described in this prompt (resolve customization → prepend → adopt persona → load facts → load config → greet → append → dispatch).`,
    `- **NEVER load multiple step files simultaneously.** Read one step file at a time, complete it, mark it in the output file's \`stepsCompleted\` frontmatter array, then read the next.`,
    `- **NEVER skip steps** or optimize the sequence.`,
    `- **ALWAYS halt and wait for user input** when a menu is presented; never auto-proceed past a menu.`,
    `- All file operations must stay within \`{project-root}\`. Use the supplied Read/Write/Edit/Glob/Grep/Bash tools.`,
  ]
    .filter(Boolean)
    .join('\n');
}

function buildInitialUserMessage(options: {
  readonly skill: BmadSkill;
  readonly persona: BmadPersonaIdentity | undefined;
  readonly args: readonly string[] | undefined;
}): string {
  const lines: string[] = [`Begin the \`${options.skill.canonicalId}\` workflow.`];
  if (options.persona) {
    lines.push(
      `You are ${options.persona.name} (${options.persona.title} ${options.persona.icon}).`,
    );
  }
  if (options.args && options.args.length > 0) {
    lines.push(`Args: ${options.args.join(' ')}`);
  }
  lines.push('Follow the activation flow, then begin the workflow body.');
  return lines.join('\n');
}

// =============================================================================
// Internals — provider + tools resolution
// =============================================================================

interface ResolveModelOptions {
  readonly activeProfile: ClaudeProfile;
  readonly projectRoot: string;
  readonly abortSignal?: AbortSignal;
  readonly modelOverride?: LanguageModel;
  readonly toolsOverride?: Record<string, AITool>;
}

interface ResolvedRunner {
  readonly model: LanguageModel;
  readonly tools: Record<string, AITool>;
}

async function resolveModelAndTools(options: ResolveModelOptions): Promise<ResolvedRunner> {
  if (options.modelOverride && options.toolsOverride) {
    return { model: options.modelOverride, tools: options.toolsOverride };
  }

  const client = await createSimpleClient({
    systemPrompt: '',
    profileId: options.activeProfile.id,
  }).catch((err) => {
    throw new WorkflowRunnerError(
      'PROVIDER_ERROR',
      `failed to resolve provider for profile '${options.activeProfile.id}': ${(err as Error).message}`,
      { cause: err },
    );
  });

  // Build the BMAD-flavored ToolContext: cwd + projectDir = projectRoot,
  // specDir is unused (BMAD has no spec-dir concept — outputs land under
  // _bmad-output/), securityProfile defaults from the project's profile file.
  const toolContext: ToolContext = {
    cwd: options.projectRoot,
    projectDir: options.projectRoot,
    specDir: options.projectRoot,
    securityProfile: getSecurityProfile(options.projectRoot),
    ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
    allowedWritePaths: [options.projectRoot],
  };

  const registry = options.toolsOverride
    ? null
    : buildToolRegistry();

  const tools: Record<string, AITool> = options.toolsOverride
    ? { ...options.toolsOverride }
    : {};

  if (registry) {
    for (const name of ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebFetch', 'WebSearch']) {
      const defined = registry.getTool(name);
      if (defined) tools[name] = defined.bind(toolContext);
    }
  }

  return { model: options.modelOverride ?? client.model, tools };
}

// =============================================================================
// Internals — turn execution
// =============================================================================

interface RunOneTurnOptions {
  readonly model: LanguageModel;
  readonly tools: Record<string, AITool>;
  readonly systemPrompt: string;
  readonly messages: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
  readonly maxSteps: number;
  readonly abortSignal?: AbortSignal;
  readonly emit: (chunk: Omit<BmadWorkflowStreamChunk, 'seq' | 'timestamp'>) => void;
}

interface RunOneTurnResult {
  readonly responseText: string;
  readonly toolCallCount: number;
  readonly fileWrites: readonly string[];
}

async function runOneTurn(options: RunOneTurnOptions): Promise<RunOneTurnResult> {
  const result = streamText({
    model: options.model,
    system: options.systemPrompt,
    messages: options.messages.map((m) => ({ role: m.role, content: m.content })),
    tools: options.tools,
    stopWhen: stepCountIs(options.maxSteps),
    ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
  });

  let toolCallCount = 0;
  const fileWrites = new Set<string>();
  const textParts: string[] = [];

  // Consume the full stream. We surface text deltas and tool calls to the
  // caller; we also extract Write / Edit tool inputs to track output files.
  for await (const part of result.fullStream) {
    switch (part.type) {
      case 'text-delta': {
        const delta = (part as { textDelta?: string; text?: string }).textDelta
          ?? (part as { text?: string }).text
          ?? '';
        if (delta) {
          textParts.push(delta);
          options.emit({ kind: 'text-delta', text: delta });
        }
        break;
      }
      case 'reasoning-delta': {
        const delta = (part as { textDelta?: string; text?: string }).textDelta
          ?? (part as { text?: string }).text
          ?? '';
        if (delta) options.emit({ kind: 'reasoning', text: delta });
        break;
      }
      case 'tool-call': {
        const toolCall = part as {
          toolName: string;
          input?: Record<string, unknown>;
          args?: Record<string, unknown>;
        };
        const toolName = toolCall.toolName;
        const args = toolCall.input ?? toolCall.args ?? {};
        toolCallCount += 1;
        options.emit({ kind: 'tool-call', toolName, toolArgs: args });
        // Track file writes for the result's outputFiles list.
        if (toolName === 'Write' || toolName === 'Edit') {
          const filePath = (args as { file_path?: string }).file_path;
          if (typeof filePath === 'string') fileWrites.add(filePath);
        }
        break;
      }
      case 'tool-result': {
        const toolResult = part as {
          toolName: string;
          output?: unknown;
          result?: unknown;
        };
        options.emit({
          kind: 'tool-result',
          toolName: toolResult.toolName,
          toolResult: toolResult.output ?? toolResult.result,
        });
        break;
      }
      case 'finish': {
        options.emit({ kind: 'step-finish' });
        break;
      }
      default:
        break;
    }
  }

  // Capture the final concatenated text from the stream. We don't await
  // `result.text` because some providers hang; the deltas we collected
  // above are sufficient.
  const responseText = textParts.join('');

  return {
    responseText,
    toolCallCount,
    fileWrites: [...fileWrites],
  };
}

// =============================================================================
// Internals — menu / completion / step detection
// =============================================================================

const COMPLETION_PATTERNS = [
  /workflow (?:is\s+)?complete/i,
  /workflow (?:has\s+)?finished/i,
  /✅\s*(?:done|completed?|finished)/i,
  /you can now (close|exit|move on)/i,
];

/**
 * Heuristic completion detection. Triggered when the model's text contains
 * one of the patterns AND the message doesn't end with a question mark
 * (we don't want "are you done?" to count).
 */
export function detectCompletion(text: string): boolean {
  if (!text || text.trim().endsWith('?')) return false;
  return COMPLETION_PATTERNS.some((re) => re.test(text));
}

/**
 * Heuristic menu detection. BMAD step files use patterns like:
 *
 *   ### MENU OPTIONS
 *   "[C] Continue - Save this..."
 *   "[1] Pick this option"
 *   "1. First choice"
 *   "1) First choice"
 *
 * We scan the last ~30 lines of the message for any of these patterns.
 * Returns null when no menu is detected; the caller should treat that as
 * a free-form prompt.
 */
export function detectMenu(text: string): BmadWorkflowMenu | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  const lines = trimmed.split('\n');
  const tailWindow = lines.slice(Math.max(0, lines.length - 40));
  const options: BmadWorkflowMenuOption[] = [];

  // Pattern A: lines starting with `[CODE]` or `[N]` (BMAD's convention)
  const PATTERN_A = /^\s*\[([A-Z0-9]{1,6})\]\s+(.+?)$/i;
  // Pattern B: lines starting with `N. ` or `N) ` (numbered)
  const PATTERN_B = /^\s*(\d+)[.)]\s+(.+?)$/;

  for (const line of tailWindow) {
    const matchA = PATTERN_A.exec(line);
    if (matchA) {
      const [, code, label] = matchA;
      if (code && label && !options.some((o) => o.code === code)) {
        options.push({ code, label: label.trim() });
        continue;
      }
    }
    const matchB = PATTERN_B.exec(line);
    if (matchB) {
      const [, code, label] = matchB;
      if (code && label && !options.some((o) => o.code === code)) {
        options.push({ code, label: label.trim() });
      }
    }
  }

  if (options.length === 0) {
    // No menu — surface as a free-form prompt only when the model clearly
    // halted (response ends with a question mark or the word "select").
    const endsWithQuestion = /\?\s*$/.test(trimmed);
    const looksLikePrompt = /\b(select|choose|pick|which|please)\b/i.test(trimmed);
    if (endsWithQuestion || looksLikePrompt) {
      return { prompt: trimmed, options: [] };
    }
    return null;
  }

  return { prompt: trimmed, options };
}

interface DetectStepTransitionOptions {
  readonly skill: BmadSkill;
  readonly variables: BmadVariableContext;
  readonly previousSeen: Set<string>;
}

/**
 * Detect that the model loaded a new step file by checking the workflow's
 * output file for a freshly-incremented `stepsCompleted` array. Returns
 * the step descriptor (with body) if a new step was loaded; null otherwise.
 *
 * Uses `nextStepIndex` from `step-loader.ts` for the JIT-safe lookup.
 */
async function detectStepTransition(
  options: DetectStepTransitionOptions,
): Promise<BmadWorkflowStep | null> {
  if (options.skill.stepFiles.length === 0) return null;

  // Heuristic: the workflow's output file lives at one of these paths.
  // We check the most common ones — `prd.md` for bmad-create-prd, etc.
  const outputCandidates = guessOutputFilePath(options.skill, options.variables);
  for (const candidate of outputCandidates) {
    if (options.previousSeen.has(candidate)) {
      try {
        const idx = await nextStepIndex(options.skill, candidate);
        if (idx === null) return null;
        if (idx > 0) {
          const step = await loadCurrentStep({
            skill: options.skill,
            stepIndex: idx,
            outputFilePath: candidate,
            variables: options.variables,
          });
          return step;
        }
      } catch (err) {
        if (err instanceof StepLoaderError && err.code === 'STEP_LOAD_VIOLATION') {
          // The runner shouldn't crash on transient disagreements between
          // the output file's frontmatter and the disk state. Surface as a
          // non-event so the runner keeps streaming and the model can fix
          // its own state on the next turn.
          return null;
        }
        throw err;
      }
    }
  }

  return null;
}

function guessOutputFilePath(skill: BmadSkill, variables: BmadVariableContext): string[] {
  // Heuristic only: most BMM workflows write to `<planning_artifacts>/<noun>.md`
  // where the noun is derived from the skill id (`bmad-create-prd` → `prd.md`).
  const noun = skill.canonicalId.replace(/^bmad-(create-)?/, '').replace(/-/g, '-');
  if (!variables.planningArtifacts) return [];
  return [path.join(variables.planningArtifacts, `${noun}.md`)];
}

// =============================================================================
// Test internals
// =============================================================================

export const __internals = {
  composeSystemPrompt,
  buildInitialUserMessage,
  buildPersonaSection,
  buildRuntimeContextSection,
  buildActivationReminder,
  detectMenu,
  detectCompletion,
  guessOutputFilePath,
};
