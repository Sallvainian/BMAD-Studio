/**
 * Vitest fixtures for the step loader.
 *
 * Coverage:
 *   - loadCurrentStep returns the step body, with variable substitution
 *   - JIT enforcement: loading step N+1 throws STEP_LOAD_VIOLATION when
 *     step N is not in the output file's `stepsCompleted` frontmatter
 *   - JIT enforcement: loading step 0 always succeeds (no prior step)
 *   - readStepsCompleted handles missing files (returns []), files without
 *     frontmatter (returns []), and well-formed frontmatter
 *   - nextStepIndex computes the next step index correctly across
 *     completed/incomplete states
 *   - loadStepByName resolves a filename to an index, then defers to
 *     loadCurrentStep for the JIT gate
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  loadCurrentStep,
  loadStepByName,
  nextStepIndex,
  readStepsCompleted,
  StepLoaderError,
} from '../step-loader';
import type {
  BmadSkill,
  BmadStepFile,
  BmadVariableContext,
} from '../../../../shared/types/bmad';

// =============================================================================
// Helpers
// =============================================================================

async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'bmad-step-loader-'));
}

async function writeStepFile(dir: string, fileName: string, body: string): Promise<string> {
  const fullPath = path.join(dir, fileName);
  await writeFile(fullPath, body, 'utf-8');
  return fullPath;
}

async function buildFakeSkill(opts: {
  readonly skillDir: string;
  readonly stepNames: readonly string[];
  readonly stepBodies?: readonly string[];
  readonly category?: 'steps' | 'steps-c' | 'steps-e' | 'steps-v';
}): Promise<BmadSkill> {
  const category = opts.category ?? 'steps';
  const stepDir = path.join(opts.skillDir, category);
  await mkdir(stepDir, { recursive: true });

  const stepFiles: BmadStepFile[] = [];
  for (let i = 0; i < opts.stepNames.length; i++) {
    const fileName = opts.stepNames[i]!;
    const body = opts.stepBodies?.[i] ?? `# Step ${i + 1}\n\nbody for ${fileName}`;
    const absolutePath = await writeStepFile(stepDir, fileName, body);
    stepFiles.push({
      category,
      fileName,
      absolutePath,
      index: i + 1,
    });
  }

  return {
    canonicalId: 'fake-skill',
    module: 'bmm',
    skillDir: opts.skillDir,
    manifestPath: path.join(opts.skillDir, 'SKILL.md'),
    kind: 'workflow',
    frontmatter: { name: 'fake-skill', description: 'fake', extra: {} },
    body: '',
    stepFiles,
    customizationDefaults: null,
    customizationResolved: null,
  };
}

const SAMPLE_VAR_CTX: BmadVariableContext = {
  projectRoot: '/proj',
  skillRoot: '/proj/skill',
  skillName: 'skill',
  userName: 'Sally',
  communicationLanguage: 'English',
  documentOutputLanguage: 'English',
  planningArtifacts: '/proj/_bmad-output/planning',
  implementationArtifacts: '/proj/_bmad-output/impl',
  projectKnowledge: '/proj/docs',
  outputFolder: '/proj/_bmad-output',
  date: '2026-04-30',
  projectName: 'demo',
};

// =============================================================================
// readStepsCompleted
// =============================================================================

describe('readStepsCompleted', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns [] when the file is missing', async () => {
    const result = await readStepsCompleted(path.join(dir, 'missing.md'));
    expect(result).toEqual([]);
  });

  it('returns [] when the file has no frontmatter', async () => {
    const filePath = path.join(dir, 'no-fm.md');
    await writeFile(filePath, '# Just a heading\n\nno frontmatter\n', 'utf-8');
    expect(await readStepsCompleted(filePath)).toEqual([]);
  });

  it('returns [] when frontmatter has no `stepsCompleted` array', async () => {
    const filePath = path.join(dir, 'no-array.md');
    await writeFile(filePath, '---\ntitle: foo\n---\nbody\n', 'utf-8');
    expect(await readStepsCompleted(filePath)).toEqual([]);
  });

  it('returns the parsed array of step names', async () => {
    const filePath = path.join(dir, 'with-array.md');
    await writeFile(
      filePath,
      `---
stepsCompleted:
  - step-01-init
  - step-02-discovery
---

# PRD body
`,
      'utf-8',
    );
    expect(await readStepsCompleted(filePath)).toEqual(['step-01-init', 'step-02-discovery']);
  });

  it('throws STEP_PARSE_ERROR for malformed YAML frontmatter', async () => {
    const filePath = path.join(dir, 'bad.md');
    await writeFile(filePath, '---\n  : invalid yaml :\n  bad - syntax\n---\nbody\n', 'utf-8');
    await expect(readStepsCompleted(filePath)).rejects.toThrow(StepLoaderError);
  });
});

// =============================================================================
// loadCurrentStep — happy path + variable substitution
// =============================================================================

describe('loadCurrentStep', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('loads step 0 without an outputFilePath (no JIT gate)', async () => {
    const skill = await buildFakeSkill({
      skillDir: dir,
      stepNames: ['step-01-init.md', 'step-02-discovery.md'],
    });
    const result = await loadCurrentStep({ skill, stepIndex: 0 });
    expect(result.fileName).toBe('step-01-init.md');
    expect(result.body).toContain('body for step-01-init.md');
    expect(result.category).toBe('steps');
  });

  it('substitutes variables in the body when context is provided', async () => {
    const skill = await buildFakeSkill({
      skillDir: dir,
      stepNames: ['step-01-init.md'],
      stepBodies: ['Welcome {user_name} to {project_name}!'],
    });
    const result = await loadCurrentStep({
      skill,
      stepIndex: 0,
      variables: SAMPLE_VAR_CTX,
    });
    expect(result.body).toBe('Welcome Sally to demo!');
  });

  it('returns the raw body when no variables context is provided', async () => {
    const skill = await buildFakeSkill({
      skillDir: dir,
      stepNames: ['step-01-init.md'],
      stepBodies: ['Welcome {user_name}!'],
    });
    const result = await loadCurrentStep({ skill, stepIndex: 0 });
    expect(result.body).toBe('Welcome {user_name}!');
  });

  it('throws INVALID_INPUT for stepIndex out of range', async () => {
    const skill = await buildFakeSkill({ skillDir: dir, stepNames: ['s.md'] });
    await expect(loadCurrentStep({ skill, stepIndex: -1 })).rejects.toThrow(StepLoaderError);
    await expect(loadCurrentStep({ skill, stepIndex: 99 })).rejects.toThrow(StepLoaderError);
  });
});

// =============================================================================
// loadCurrentStep — JIT gate (the safety guarantee)
// =============================================================================

describe('loadCurrentStep — JIT gate (per BMAD docs § "Critical Rules (NO EXCEPTIONS)")', () => {
  let dir: string;
  let outputDir: string;
  let outputPath: string;

  beforeEach(async () => {
    dir = await makeTempDir();
    outputDir = await makeTempDir();
    outputPath = path.join(outputDir, 'prd.md');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    await rm(outputDir, { recursive: true, force: true });
  });

  it('refuses to load step 1 without an outputFilePath', async () => {
    const skill = await buildFakeSkill({
      skillDir: dir,
      stepNames: ['step-01-init.md', 'step-02-discovery.md'],
    });
    await expect(
      loadCurrentStep({ skill, stepIndex: 1 }),
    ).rejects.toMatchObject({ code: 'STEP_LOAD_VIOLATION' });
  });

  it('refuses to load step 1 when prior step is not in stepsCompleted', async () => {
    const skill = await buildFakeSkill({
      skillDir: dir,
      stepNames: ['step-01-init.md', 'step-02-discovery.md'],
    });
    await writeFile(outputPath, '---\nstepsCompleted: []\n---\n', 'utf-8');
    await expect(
      loadCurrentStep({ skill, stepIndex: 1, outputFilePath: outputPath }),
    ).rejects.toMatchObject({ code: 'STEP_LOAD_VIOLATION' });
  });

  it('allows step 1 when prior step IS in stepsCompleted', async () => {
    const skill = await buildFakeSkill({
      skillDir: dir,
      stepNames: ['step-01-init.md', 'step-02-discovery.md'],
    });
    await writeFile(
      outputPath,
      '---\nstepsCompleted:\n  - step-01-init\n---\n',
      'utf-8',
    );
    const result = await loadCurrentStep({
      skill,
      stepIndex: 1,
      outputFilePath: outputPath,
    });
    expect(result.fileName).toBe('step-02-discovery.md');
  });

  it('allows step 2 when both prior steps are in stepsCompleted', async () => {
    const skill = await buildFakeSkill({
      skillDir: dir,
      stepNames: ['step-01-init.md', 'step-02-discovery.md', 'step-03-success.md'],
    });
    await writeFile(
      outputPath,
      '---\nstepsCompleted:\n  - step-01-init\n  - step-02-discovery\n---\n',
      'utf-8',
    );
    const result = await loadCurrentStep({
      skill,
      stepIndex: 2,
      outputFilePath: outputPath,
    });
    expect(result.fileName).toBe('step-03-success.md');
  });

  it('refuses to load step 2 when only step-01 is in stepsCompleted (gap detected)', async () => {
    const skill = await buildFakeSkill({
      skillDir: dir,
      stepNames: ['step-01-init.md', 'step-02-discovery.md', 'step-03-success.md'],
    });
    await writeFile(
      outputPath,
      '---\nstepsCompleted:\n  - step-01-init\n---\n',
      'utf-8',
    );
    await expect(
      loadCurrentStep({ skill, stepIndex: 2, outputFilePath: outputPath }),
    ).rejects.toMatchObject({ code: 'STEP_LOAD_VIOLATION' });
  });

  it('respects __unsafeBypass for tests but never in production paths', async () => {
    const skill = await buildFakeSkill({
      skillDir: dir,
      stepNames: ['step-01.md', 'step-02.md'],
    });
    const result = await loadCurrentStep({
      skill,
      stepIndex: 1,
      __unsafeBypass: true,
    });
    expect(result.fileName).toBe('step-02.md');
  });
});

// =============================================================================
// loadStepByName
// =============================================================================

describe('loadStepByName', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('resolves the filename to its index and defers to loadCurrentStep', async () => {
    const skill = await buildFakeSkill({
      skillDir: dir,
      stepNames: ['step-01-init.md', 'step-02-discovery.md'],
    });
    const result = await loadStepByName({
      skill,
      fileName: 'step-01-init.md',
    });
    expect(result.fileName).toBe('step-01-init.md');
    expect(result.index).toBe(1);
  });

  it('throws STEP_FILE_NOT_FOUND for an unknown filename', async () => {
    const skill = await buildFakeSkill({
      skillDir: dir,
      stepNames: ['step-01.md'],
    });
    await expect(
      loadStepByName({ skill, fileName: 'nope.md' }),
    ).rejects.toMatchObject({ code: 'STEP_FILE_NOT_FOUND' });
  });
});

// =============================================================================
// nextStepIndex
// =============================================================================

describe('nextStepIndex', () => {
  let dir: string;
  let outputDir: string;
  let outputPath: string;

  beforeEach(async () => {
    dir = await makeTempDir();
    outputDir = await makeTempDir();
    outputPath = path.join(outputDir, 'out.md');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    await rm(outputDir, { recursive: true, force: true });
  });

  it('returns 0 when no output file exists yet', async () => {
    const skill = await buildFakeSkill({
      skillDir: dir,
      stepNames: ['step-01.md', 'step-02.md'],
    });
    expect(await nextStepIndex(skill, outputPath)).toBe(0);
  });

  it('returns null when there are no step files', async () => {
    const skill = await buildFakeSkill({ skillDir: dir, stepNames: [] });
    expect(await nextStepIndex(skill, outputPath)).toBeNull();
  });

  it('returns 1 when step-01 is completed', async () => {
    const skill = await buildFakeSkill({
      skillDir: dir,
      stepNames: ['step-01.md', 'step-02.md', 'step-03.md'],
    });
    await writeFile(outputPath, '---\nstepsCompleted:\n  - step-01\n---\n', 'utf-8');
    expect(await nextStepIndex(skill, outputPath)).toBe(1);
  });

  it('returns null when every step is completed', async () => {
    const skill = await buildFakeSkill({
      skillDir: dir,
      stepNames: ['step-01.md', 'step-02.md'],
    });
    await writeFile(
      outputPath,
      '---\nstepsCompleted:\n  - step-01\n  - step-02\n---\n',
      'utf-8',
    );
    expect(await nextStepIndex(skill, outputPath)).toBeNull();
  });

  it('detects skipped intermediate steps', async () => {
    const skill = await buildFakeSkill({
      skillDir: dir,
      stepNames: ['step-01.md', 'step-02.md', 'step-03.md'],
    });
    // Out-of-order: step-03 marked complete, step-02 skipped. nextStepIndex
    // should return 1 (step-02), respecting the canonical order.
    await writeFile(
      outputPath,
      '---\nstepsCompleted:\n  - step-01\n  - step-03\n---\n',
      'utf-8',
    );
    expect(await nextStepIndex(skill, outputPath)).toBe(1);
  });
});
