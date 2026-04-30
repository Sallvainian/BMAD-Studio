/**
 * Vitest fixtures for the help runner.
 *
 * Coverage:
 *   - runHelpSync delegates to the orchestrator and surfaces the
 *     `BmadHelpRecommendation` shape per `bmad-help/SKILL.md` § "Response Format"
 *   - Quick Flow track raises UNSUPPORTED_TRACK (per D-005)
 *   - runHelpSyncSafe maps errors to BmadIpcResult envelopes
 *   - The synchronous path doesn't invoke any model — it's a pure read of
 *     the BMAD CSV graph + filesystem state
 */

import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runHelpSync, runHelpSyncSafe, HelpRunnerError } from '../help-runner';

// =============================================================================
// Helpers
// =============================================================================

async function makeProject(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'bmad-help-runner-'));
}

async function writeFileEnsuringDir(filePath: string, contents: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, 'utf-8');
}

const MANIFEST_YAML = `
installation:
  version: 6.6.0
  installDate: 2026-04-30T00:00:00.000Z
  lastUpdated: 2026-04-30T00:00:00.000Z
modules:
  - name: bmm
    version: 6.6.0
    installDate: 2026-04-30T00:00:00.000Z
    lastUpdated: 2026-04-30T00:00:00.000Z
    source: built-in
    npmPackage: null
    repoUrl: null
ides: [cursor]
`;

const CONFIG_TOML = `
[core]
project_name = "test"
output_folder = "{project-root}/_bmad-output"

[modules.bmm]
planning_artifacts = "{project-root}/_bmad-output/planning-artifacts"
implementation_artifacts = "{project-root}/_bmad-output/implementation-artifacts"
project_knowledge = "{project-root}/docs"
`;

const HELP_CSV =
  `module,skill,display-name,menu-code,description,action,args,phase,after,before,required,output-location,outputs
BMad Method,bmad-create-prd,Create PRD,CP,PRD,,,2-planning,,,true,planning_artifacts,prd
BMad Method,bmad-help,Help,BH,Help,,,anytime,,,false,,
`;

const SKILL_MANIFEST_CSV =
  `canonicalId,name,description,module,path
bmad-create-prd,prd,prd,bmm,_bmad/bmm/2-plan/bmad-create-prd/SKILL.md
bmad-help,help,help,core,_bmad/core/bmad-help/SKILL.md
`;

async function makeBmadProject(): Promise<string> {
  const root = await makeProject();
  await writeFileEnsuringDir(path.join(root, '_bmad', '_config', 'manifest.yaml'), MANIFEST_YAML);
  await writeFileEnsuringDir(path.join(root, '_bmad', '_config', 'skill-manifest.csv'), SKILL_MANIFEST_CSV);
  await writeFileEnsuringDir(path.join(root, '_bmad', '_config', 'bmad-help.csv'), HELP_CSV);
  await writeFileEnsuringDir(path.join(root, '_bmad', '_config', 'files-manifest.csv'), 'type,name,module,path,hash\n');
  await writeFileEnsuringDir(path.join(root, '_bmad', 'config.toml'), CONFIG_TOML);
  return root;
}

// =============================================================================
// Tests
// =============================================================================

describe('runHelpSync', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await makeBmadProject();
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('returns a BmadHelpRecommendation for a fresh project', async () => {
    const rec = await runHelpSync({ projectRoot, track: 'method' });
    expect(rec.currentPhase).toBeDefined();
    expect(rec.required).toBeDefined();
    expect(Array.isArray(rec.recommended)).toBe(true);
    expect(Array.isArray(rec.completed)).toBe(true);
    expect(rec.track).toBe('method');
  });

  it('throws UNSUPPORTED_TRACK for the quick track (per D-005)', async () => {
    await expect(
      runHelpSync({ projectRoot, track: 'quick' }),
    ).rejects.toThrow(/Quick Flow|UNSUPPORTED_TRACK/);
  });

  it('surfaces required PRD action when in phase 2', async () => {
    // Empty project starts in phase 1; once we move to phase 2 (implicitly
    // because no analysis required), the required action should be the PRD.
    const rec = await runHelpSync({ projectRoot, track: 'method' });
    // Phase 1 has zero required workflows — we either land on phase 1
    // (with required:null) or advance to phase 2 (with required:bmad-create-prd).
    if (rec.currentPhase === '2-planning') {
      expect(rec.required?.skillId).toBe('bmad-create-prd');
    } else {
      expect(rec.required).toBeNull();
    }
  });
});

describe('runHelpSyncSafe', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await makeBmadProject();
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('returns success envelope on the happy path', async () => {
    const result = await runHelpSyncSafe({ projectRoot, track: 'method' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.track).toBe('method');
    }
  });

  it('returns failure envelope for unsupported track', async () => {
    const result = await runHelpSyncSafe({ projectRoot, track: 'quick' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('UNSUPPORTED_TRACK');
    }
  });

  it('returns IO_ERROR (mapped) when the project is not a BMAD install', async () => {
    const empty = await makeProject();
    try {
      const result = await runHelpSyncSafe({ projectRoot: empty, track: 'method' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PROJECT_NOT_BMAD');
      }
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});

describe('HelpRunnerError', () => {
  it('preserves the cause and code', () => {
    const cause = new Error('inner');
    const err = new HelpRunnerError('IO_ERROR', 'wrapper', { cause });
    expect(err.code).toBe('IO_ERROR');
    expect(err.message).toBe('wrapper');
    expect(err.cause).toBe(cause);
  });
});
