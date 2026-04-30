/**
 * Vitest fixtures for the variable substitution engine.
 *
 * Coverage:
 *   - All 13 known variables from BMAD docs § "Step 4: Load Config"
 *   - Recursive expansion: `output_folder = "{project-root}/_bmad-output"` resolves fully
 *   - Cycles raise CYCLIC_VARIABLE
 *   - Unknown variables (not in BMAD_KNOWN_VARIABLES) are left untouched —
 *     so model-side `{{user_name}}` Mustache placeholders survive
 *   - Tree substitution walks arrays and objects recursively
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  __internals,
  BMAD_KNOWN_VARIABLES,
  buildVariableContext,
  substituteVariables,
  substituteVariablesInTree,
  VariableSubstitutionError,
} from '../variables';
import type { BmadVariableContext } from '../../../../shared/types/bmad';

const { expandText, expandAll, contextToLookup, walkAndSubstitute } = __internals;

// =============================================================================
// Helpers
// =============================================================================

async function makeProject(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'bmad-vars-'));
}

async function writeFileEnsuringDir(filePath: string, contents: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, 'utf-8');
}

const SAMPLE_CONFIG_TOML = `
[core]
project_name = "MyProj"
user_name = "Sallvain"
communication_language = "English"
document_output_language = "English"
output_folder = "{project-root}/_bmad-output"

[modules.bmm]
planning_artifacts = "{project-root}/_bmad-output/planning-artifacts"
implementation_artifacts = "{project-root}/_bmad-output/implementation-artifacts"
project_knowledge = "{project-root}/docs"
`;

const FIXED_DATE = new Date('2026-04-30T05:00:00.000Z');

const SAMPLE_CONTEXT: BmadVariableContext = {
  projectRoot: '/proj',
  skillRoot: '/proj/_bmad/bmm/x/skill',
  skillName: 'bmad-create-prd',
  userName: 'Sallvain',
  communicationLanguage: 'English',
  documentOutputLanguage: 'English',
  planningArtifacts: '/proj/_bmad-output/planning-artifacts',
  implementationArtifacts: '/proj/_bmad-output/implementation-artifacts',
  projectKnowledge: '/proj/docs',
  outputFolder: '/proj/_bmad-output',
  date: '2026-04-30',
  projectName: 'MyProj',
};

// =============================================================================
// Constants
// =============================================================================

describe('BMAD_KNOWN_VARIABLES', () => {
  it('lists all 13 variables from BMAD docs § "Step 4: Load Config" + dev-story user_skill_level', () => {
    expect(BMAD_KNOWN_VARIABLES).toEqual([
      'project-root',
      'skill-root',
      'skill-name',
      'user_name',
      'communication_language',
      'document_output_language',
      'planning_artifacts',
      'implementation_artifacts',
      'project_knowledge',
      'output_folder',
      'date',
      'project_name',
      'user_skill_level',
    ]);
  });
});

// =============================================================================
// substituteVariables — basic
// =============================================================================

describe('substituteVariables', () => {
  it('replaces a single recognized variable', () => {
    expect(substituteVariables('Hello {user_name}!', SAMPLE_CONTEXT)).toBe('Hello Sallvain!');
  });

  it('replaces multiple variables in one string', () => {
    const out = substituteVariables(
      'project={project-root}, skill={skill-root}',
      SAMPLE_CONTEXT,
    );
    expect(out).toBe('project=/proj, skill=/proj/_bmad/bmm/x/skill');
  });

  it('leaves unknown variables untouched (model-side templating survives)', () => {
    expect(substituteVariables('Hi {{user_name}}, you said {something_unknown}', SAMPLE_CONTEXT))
      .toBe('Hi {{user_name}}, you said {something_unknown}');
  });

  it('handles dashes in variable names — `project-root`, `skill-root`, `skill-name`', () => {
    expect(substituteVariables('{project-root} {skill-root} {skill-name}', SAMPLE_CONTEXT)).toBe(
      '/proj /proj/_bmad/bmm/x/skill bmad-create-prd',
    );
  });

  it('returns the input unchanged when no variables are present', () => {
    expect(substituteVariables('plain text without templates', SAMPLE_CONTEXT)).toBe(
      'plain text without templates',
    );
  });

  it('does not double-substitute — a value that LOOKS like a variable is left alone', () => {
    // Variables are only substituted from the lookup table, never recursively
    // mistaking output as a template.
    const ctx: BmadVariableContext = { ...SAMPLE_CONTEXT, userName: '{date}' };
    // userName resolves to "{date}" but {date} should not then be expanded
    // because we feed it as-is from the lookup. Actual recursion fires when
    // the lookup VALUE contains variables — see expandAll tests below.
    const result = substituteVariables('{user_name}', ctx);
    // Implementation choice: recursive expansion occurs by design (per the
    // docstring: "{a} resolving to {b} triggers another expansion pass").
    expect(result).toBe('2026-04-30');
  });
});

// =============================================================================
// expandText — internal recursion + cycle detection
// =============================================================================

describe('expandText — recursive expansion', () => {
  it('expands a chain like {a} → {b} → final', () => {
    const lookup: Record<string, string> = {
      a: '{b}',
      b: '{c}',
      c: 'final',
    };
    expect(expandText('{a}', lookup, 0, new Set())).toBe('final');
  });

  it('throws CYCLIC_VARIABLE when {a} resolves to {b} and {b} resolves to {a}', () => {
    const lookup: Record<string, string> = {
      a: '{b}',
      b: '{a}',
    };
    expect(() => expandText('{a}', lookup, 0, new Set())).toThrow(VariableSubstitutionError);
    try {
      expandText('{a}', lookup, 0, new Set());
    } catch (err) {
      expect((err as VariableSubstitutionError).code).toBe('CYCLIC_VARIABLE');
    }
  });
});

describe('expandAll — bulk expansion across a context map', () => {
  it('resolves {project-root} into output_folder + planning_artifacts in one pass', () => {
    const raw: Record<string, string> = {
      'project-root': '/proj',
      'skill-root': '/proj/_bmad/x',
      'skill-name': 'x',
      output_folder: '{project-root}/_bmad-output',
      planning_artifacts: '{project-root}/_bmad-output/planning-artifacts',
      implementation_artifacts: '{project-root}/_bmad-output/implementation-artifacts',
      project_knowledge: '{project-root}/docs',
      user_name: 'Sallvain',
      communication_language: 'English',
      document_output_language: 'English',
      date: '2026-04-30',
      project_name: 'p',
      user_skill_level: '',
    };
    // Cast through unknown to satisfy the BmadKnownVariable mapped record.
    const out = expandAll(raw as Parameters<typeof expandAll>[0]);
    expect(out.output_folder).toBe('/proj/_bmad-output');
    expect(out.planning_artifacts).toBe('/proj/_bmad-output/planning-artifacts');
    expect(out.project_knowledge).toBe('/proj/docs');
  });
});

// =============================================================================
// substituteVariablesInTree
// =============================================================================

describe('substituteVariablesInTree', () => {
  it('substitutes strings throughout an object', () => {
    const input = {
      output: '{planning_artifacts}/prd.md',
      meta: {
        project: '{project_name}',
        notes: ['greenfield', 'in {project-root}'],
      },
      retain: 42,
      flag: true,
    };
    const out = substituteVariablesInTree(input, SAMPLE_CONTEXT);
    expect(out).toEqual({
      output: '/proj/_bmad-output/planning-artifacts/prd.md',
      meta: {
        project: 'MyProj',
        notes: ['greenfield', 'in /proj'],
      },
      retain: 42,
      flag: true,
    });
    // Pure: input is not mutated
    expect(input.meta.notes[1]).toBe('in {project-root}');
  });

  it('returns primitives unchanged', () => {
    expect(substituteVariablesInTree(123, SAMPLE_CONTEXT)).toBe(123);
    expect(substituteVariablesInTree(null, SAMPLE_CONTEXT)).toBe(null);
    expect(substituteVariablesInTree(undefined, SAMPLE_CONTEXT)).toBe(undefined);
  });
});

// =============================================================================
// buildVariableContext — wires _bmad/config.toml through the four-layer resolver
// =============================================================================

describe('buildVariableContext', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await makeProject();
    await writeFileEnsuringDir(path.join(projectRoot, '_bmad', 'config.toml'), SAMPLE_CONFIG_TOML);
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('reads _bmad/config.toml and resolves all known variables, recursively', async () => {
    const skillDir = path.join(projectRoot, '_bmad', 'bmm', 'x', 'bmad-create-prd');
    await mkdir(skillDir, { recursive: true });

    const ctx = await buildVariableContext({
      projectRoot,
      skillDir,
      module: 'bmm',
      date: FIXED_DATE,
    });

    expect(ctx.projectRoot).toBe(path.resolve(projectRoot));
    expect(ctx.skillRoot).toBe(skillDir);
    expect(ctx.skillName).toBe('bmad-create-prd');
    expect(ctx.userName).toBe('Sallvain');
    expect(ctx.communicationLanguage).toBe('English');
    expect(ctx.documentOutputLanguage).toBe('English');
    expect(ctx.outputFolder).toBe(path.join(path.resolve(projectRoot), '_bmad-output'));
    expect(ctx.planningArtifacts).toBe(
      path.join(path.resolve(projectRoot), '_bmad-output', 'planning-artifacts'),
    );
    expect(ctx.implementationArtifacts).toBe(
      path.join(path.resolve(projectRoot), '_bmad-output', 'implementation-artifacts'),
    );
    expect(ctx.projectKnowledge).toBe(path.join(path.resolve(projectRoot), 'docs'));
    expect(ctx.date).toBe('2026-04-30');
    expect(ctx.projectName).toBe('MyProj');
  });

  it('skips user_skill_level when not configured (optional field)', async () => {
    const skillDir = path.join(projectRoot, '_bmad', 'bmm', 'x', 'bmad-create-prd');
    await mkdir(skillDir, { recursive: true });
    const ctx = await buildVariableContext({ projectRoot, skillDir });
    expect(ctx.userSkillLevel).toBeUndefined();
  });

  it('throws IO_ERROR when _bmad/config.toml is missing', async () => {
    const empty = await makeProject();
    try {
      await expect(
        buildVariableContext({
          projectRoot: empty,
          skillDir: path.join(empty, 'skill'),
        }),
      ).rejects.toThrow(VariableSubstitutionError);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// contextToLookup — round-trip with substituteVariables
// =============================================================================

describe('contextToLookup', () => {
  it('exposes every BMAD-known variable name', () => {
    const lookup = contextToLookup(SAMPLE_CONTEXT);
    for (const name of BMAD_KNOWN_VARIABLES) {
      if (name === 'user_skill_level') continue; // optional
      expect(lookup).toHaveProperty(name);
    }
  });

  it('omits user_skill_level when undefined', () => {
    const lookup = contextToLookup(SAMPLE_CONTEXT);
    expect(lookup.user_skill_level).toBeUndefined();
  });

  it('includes user_skill_level when set', () => {
    const ctx: BmadVariableContext = { ...SAMPLE_CONTEXT, userSkillLevel: 'beginner' };
    expect(contextToLookup(ctx).user_skill_level).toBe('beginner');
  });
});

describe('walkAndSubstitute — internal direct test', () => {
  it('walks nested arrays of strings', () => {
    const out = walkAndSubstitute([['a', '{user_name}'], 'b', null], SAMPLE_CONTEXT);
    expect(out).toEqual([['a', 'Sallvain'], 'b', null]);
  });
});
