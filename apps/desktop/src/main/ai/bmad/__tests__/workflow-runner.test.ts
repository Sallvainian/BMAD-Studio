/**
 * Vitest fixtures for the workflow runner.
 *
 * These tests focus on:
 *   - System prompt composition (persona + skill body + variables + activation)
 *   - Menu detection heuristics (BMAD's `[CODE]` and `1.` patterns)
 *   - Completion detection heuristics
 *   - Initial user message format
 *   - guessOutputFilePath: skill id → planning_artifacts/<noun>.md
 *
 * Live `streamText()` integration is exercised by the smoke test
 * `workflow-runner-smoke.test.ts` (separate file, gated behind
 * `RUN_BMAD_WORKFLOW_SMOKE=1` to keep CI fast).
 */

import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { __internals } from '../workflow-runner';
import type {
  BmadPersonaIdentity,
  BmadSkill,
  BmadVariableContext,
} from '../../../../shared/types/bmad';

const {
  composeSystemPrompt,
  buildInitialUserMessage,
  buildPersonaSection,
  buildRuntimeContextSection,
  buildActivationReminder,
  detectMenu,
  detectCompletion,
  guessOutputFilePath,
} = __internals;

// =============================================================================
// Fixtures
// =============================================================================

const SAMPLE_VARS: BmadVariableContext = {
  projectRoot: '/proj',
  skillRoot: '/proj/_bmad/bmm/2-plan-workflows/bmad-create-prd',
  skillName: 'bmad-create-prd',
  userName: 'Sallvain',
  communicationLanguage: 'English',
  documentOutputLanguage: 'English',
  planningArtifacts: '/proj/_bmad-output/planning-artifacts',
  implementationArtifacts: '/proj/_bmad-output/implementation-artifacts',
  projectKnowledge: '/proj/docs',
  outputFolder: '/proj/_bmad-output',
  date: '2026-04-30',
  projectName: 'BMad Studio',
};

const SAMPLE_SKILL: BmadSkill = {
  canonicalId: 'bmad-create-prd',
  module: 'bmm',
  skillDir: '/proj/_bmad/bmm/2-plan-workflows/bmad-create-prd',
  manifestPath: '/proj/_bmad/bmm/2-plan-workflows/bmad-create-prd/SKILL.md',
  kind: 'workflow',
  frontmatter: {
    name: 'bmad-create-prd',
    description: 'Create a PRD from scratch.',
    extra: {},
  },
  body: `# PRD Create Workflow\n\nFollow the steps. Output to {planning_artifacts}/prd.md.`,
  stepFiles: [],
  customizationDefaults: null,
  customizationResolved: null,
};

const JOHN_PERSONA: BmadPersonaIdentity = {
  slug: 'john',
  skillId: 'bmad-agent-pm',
  name: 'John',
  title: 'Product Manager',
  module: 'bmm',
  team: 'software-development',
  description: 'PM persona.',
  icon: '📋',
  role: 'Translate vision into a PRD.',
  identity: 'Thinks like Marty Cagan.',
  communicationStyle: "Detective's relentless 'why?'.",
  principles: ['PRDs emerge from user interviews.'],
  persistentFacts: ['file:{project-root}/**/project-context.md'],
  activationStepsPrepend: [],
  activationStepsAppend: [],
  menu: [{ code: 'CP', description: 'Create PRD', skill: 'bmad-create-prd' }],
  phase: '2-planning',
};

// =============================================================================
// composeSystemPrompt
// =============================================================================

describe('composeSystemPrompt', () => {
  it('substitutes variables in the skill body', () => {
    const prompt = composeSystemPrompt({
      skill: SAMPLE_SKILL,
      persona: undefined,
      variables: SAMPLE_VARS,
      args: undefined,
    });
    expect(prompt).toContain('/proj/_bmad-output/planning-artifacts/prd.md');
    expect(prompt).not.toContain('{planning_artifacts}');
  });

  it('includes the persona section when one is supplied', () => {
    const prompt = composeSystemPrompt({
      skill: SAMPLE_SKILL,
      persona: JOHN_PERSONA,
      variables: SAMPLE_VARS,
      args: undefined,
    });
    expect(prompt).toContain('John, Product Manager');
    expect(prompt).toContain('📋');
    expect(prompt).toContain('Thinks like Marty Cagan');
    expect(prompt).toContain('PRDs emerge from user interviews.');
  });

  it('omits the persona section when no persona is supplied', () => {
    const prompt = composeSystemPrompt({
      skill: SAMPLE_SKILL,
      persona: undefined,
      variables: SAMPLE_VARS,
      args: undefined,
    });
    expect(prompt).not.toContain('# Persona:');
  });

  it('appends invocation args when provided', () => {
    const prompt = composeSystemPrompt({
      skill: SAMPLE_SKILL,
      persona: undefined,
      variables: SAMPLE_VARS,
      args: ['--autonomous', 'foo.md'],
    });
    expect(prompt).toContain('# Invocation args');
    expect(prompt).toContain('- --autonomous');
    expect(prompt).toContain('- foo.md');
  });

  it('always includes the activation reminder + JIT step rule (per BMAD docs § "Critical Rules")', () => {
    const prompt = composeSystemPrompt({
      skill: SAMPLE_SKILL,
      persona: undefined,
      variables: SAMPLE_VARS,
      args: undefined,
    });
    expect(prompt).toContain('NEVER load multiple step files simultaneously');
    expect(prompt).toContain('NEVER skip steps');
    expect(prompt).toContain('halt and wait for user input');
  });

  it('includes runtime context (project-root, planning_artifacts, etc.)', () => {
    const prompt = composeSystemPrompt({
      skill: SAMPLE_SKILL,
      persona: undefined,
      variables: SAMPLE_VARS,
      args: undefined,
    });
    expect(prompt).toContain('# Runtime context');
    expect(prompt).toContain('skill-name: bmad-create-prd');
    expect(prompt).toContain('project-root: /proj');
    expect(prompt).toContain('planning_artifacts: /proj/_bmad-output/planning-artifacts');
  });
});

// =============================================================================
// buildPersonaSection — verbatim shape checks
// =============================================================================

describe('buildPersonaSection', () => {
  it('substitutes variables in persistent_facts entries', () => {
    const section = buildPersonaSection(JOHN_PERSONA, SAMPLE_VARS);
    expect(section).toContain('file:/proj/**/project-context.md');
    expect(section).not.toContain('{project-root}');
  });

  it('renders the icon prefix instruction', () => {
    const section = buildPersonaSection(JOHN_PERSONA, SAMPLE_VARS);
    expect(section).toContain('Always prefix your responses with 📋');
  });
});

describe('buildRuntimeContextSection', () => {
  it('emits the variable map as a labeled list', () => {
    const section = buildRuntimeContextSection(SAMPLE_SKILL, SAMPLE_VARS);
    expect(section).toContain('user_name: Sallvain');
    expect(section).toContain('communication_language: English');
    expect(section).toContain('document_output_language: English');
  });

  it('shows "(not configured)" for empty user_name', () => {
    const section = buildRuntimeContextSection(SAMPLE_SKILL, {
      ...SAMPLE_VARS,
      userName: '',
    });
    expect(section).toContain('user_name: (not configured)');
  });
});

describe('buildActivationReminder', () => {
  it('includes the persona-specific line when one is supplied', () => {
    const reminder = buildActivationReminder(JOHN_PERSONA);
    expect(reminder).toContain('You are John, Product Manager');
    expect(reminder).toContain('📋');
  });

  it('omits the persona line for skill-only activation', () => {
    const reminder = buildActivationReminder(undefined);
    expect(reminder).not.toContain('You are');
    expect(reminder).toContain('NEVER load multiple step files');
  });
});

// =============================================================================
// buildInitialUserMessage
// =============================================================================

describe('buildInitialUserMessage', () => {
  it('starts with the skill invocation directive', () => {
    const msg = buildInitialUserMessage({
      skill: SAMPLE_SKILL,
      persona: undefined,
      args: undefined,
    });
    expect(msg.split('\n')[0]).toBe('Begin the `bmad-create-prd` workflow.');
  });

  it('references the persona by name + icon when one is supplied', () => {
    const msg = buildInitialUserMessage({
      skill: SAMPLE_SKILL,
      persona: JOHN_PERSONA,
      args: undefined,
    });
    expect(msg).toContain('John (Product Manager 📋)');
  });

  it('includes args verbatim when provided', () => {
    const msg = buildInitialUserMessage({
      skill: SAMPLE_SKILL,
      persona: undefined,
      args: ['--yolo', 'something'],
    });
    expect(msg).toContain('Args: --yolo something');
  });
});

// =============================================================================
// detectMenu — heuristic
// =============================================================================

describe('detectMenu', () => {
  it('parses BMAD-style `[CODE]` menu options', () => {
    const text = `Setup complete!

[C] Continue - Save this and move to step 2
[E] Edit - Make corrections to the title

Choose option:`;
    const menu = detectMenu(text);
    expect(menu).not.toBeNull();
    expect(menu!.options).toEqual([
      { code: 'C', label: 'Continue - Save this and move to step 2' },
      { code: 'E', label: 'Edit - Make corrections to the title' },
    ]);
  });

  it('parses numbered options (`1. ...`)', () => {
    const text = `1. Run create-story
2. Validate first
3. Specify a path`;
    const menu = detectMenu(text);
    expect(menu).not.toBeNull();
    expect(menu!.options.map((o) => o.code)).toEqual(['1', '2', '3']);
  });

  it('parses parenthesized options (`1) ...`)', () => {
    const text = `1) Continue
2) Cancel`;
    const menu = detectMenu(text);
    expect(menu).not.toBeNull();
    expect(menu!.options.length).toBe(2);
  });

  it('returns null when there is no menu and no question prompt', () => {
    const text = 'Just a plain text response with no halting cue.';
    expect(detectMenu(text)).toBeNull();
  });

  it('returns a free-form prompt (empty options) when text ends with a question mark', () => {
    const text = 'What is the project name?';
    const menu = detectMenu(text);
    expect(menu).not.toBeNull();
    expect(menu!.options).toEqual([]);
    expect(menu!.prompt).toContain('What is the project name?');
  });

  it('returns a free-form prompt when text contains "select" or "choose"', () => {
    const text = 'Please select your preferred approach.';
    const menu = detectMenu(text);
    expect(menu).not.toBeNull();
    expect(menu!.options).toEqual([]);
  });

  it('returns null for empty input', () => {
    expect(detectMenu('')).toBeNull();
    expect(detectMenu('   ')).toBeNull();
  });

  it('deduplicates options with the same code', () => {
    const text = `[C] First
[C] Second mention
[D] Different`;
    const menu = detectMenu(text);
    expect(menu).not.toBeNull();
    expect(menu!.options.map((o) => o.code)).toEqual(['C', 'D']);
  });
});

// =============================================================================
// detectCompletion — heuristic
// =============================================================================

describe('detectCompletion', () => {
  it('matches "workflow complete"', () => {
    expect(detectCompletion('Workflow complete. Output written to prd.md.')).toBe(true);
  });

  it('matches "workflow has finished"', () => {
    expect(detectCompletion('The workflow has finished.')).toBe(true);
  });

  it('matches the green-checkmark "done" / "completed"', () => {
    expect(detectCompletion('✅ Done!')).toBe(true);
    expect(detectCompletion('✅ completed')).toBe(true);
    expect(detectCompletion('✅ finished')).toBe(true);
  });

  it('matches "you can now exit"', () => {
    expect(detectCompletion('You can now close this session.')).toBe(true);
  });

  it('does NOT match when the message ends with a question mark', () => {
    expect(detectCompletion('Workflow complete? Verify before closing?')).toBe(false);
  });

  it('returns false for plain text', () => {
    expect(detectCompletion('Generated draft. Continuing.')).toBe(false);
  });

  it('returns false for empty input', () => {
    expect(detectCompletion('')).toBe(false);
  });
});

// =============================================================================
// guessOutputFilePath
// =============================================================================

describe('guessOutputFilePath', () => {
  it('derives prd.md from bmad-create-prd', () => {
    const skill = { ...SAMPLE_SKILL, canonicalId: 'bmad-create-prd' };
    expect(guessOutputFilePath(skill, SAMPLE_VARS)).toEqual([
      // Use path.join for the expected value so the assertion is cross-platform —
      // path.join on Windows returns backslash-separated paths.
      path.join('/proj/_bmad-output/planning-artifacts', 'prd.md'),
    ]);
  });

  it('derives architecture.md from bmad-create-architecture', () => {
    const skill = { ...SAMPLE_SKILL, canonicalId: 'bmad-create-architecture' };
    expect(guessOutputFilePath(skill, SAMPLE_VARS)).toEqual([
      path.join('/proj/_bmad-output/planning-artifacts', 'architecture.md'),
    ]);
  });

  it('returns [] when planning_artifacts is empty', () => {
    const skill = { ...SAMPLE_SKILL, canonicalId: 'bmad-create-prd' };
    expect(guessOutputFilePath(skill, { ...SAMPLE_VARS, planningArtifacts: '' })).toEqual([]);
  });
});
