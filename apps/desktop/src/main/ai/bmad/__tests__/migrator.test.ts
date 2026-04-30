import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, afterEach, beforeEach } from 'vitest';

import { detectLegacySpecs, migrateLegacySpecs } from '../migrator';
import { readSprintStatus } from '../sprint-status';

describe('BMad legacy migrator', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), 'bmad-migrator-'));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('detects legacy .auto-claude spec directories', async () => {
    await writeLegacySpec(projectRoot, '001-foo');

    const plan = await detectLegacySpecs(projectRoot);

    expect(plan.hasLegacySpecs).toBe(true);
    expect(plan.candidates).toHaveLength(1);
    expect(plan.candidates[0]?.id).toBe('001-foo');
    expect(plan.candidates[0]?.hasSpec).toBe(true);
    expect(plan.candidates[0]?.hasImplementationPlan).toBe(true);
  });

  it('backs up legacy data and seeds BMad output artifacts', async () => {
    await writeLegacySpec(projectRoot, '001-foo');

    const result = await migrateLegacySpecs(projectRoot);

    expect(result.migrated).toBe(true);
    expect(result.planningFiles).toEqual([
      '_bmad-output/planning-artifacts/001-foo-product-brief.md',
    ]);
    expect(result.implementationFiles).toContain(
      '_bmad-output/implementation-artifacts/001-foo-1-create-login.md',
    );
    expect(result.sprintStatusPath).toBe(
      '_bmad-output/implementation-artifacts/sprint-status.yaml',
    );

    const backupSpec = await readFile(
      path.join(projectRoot, '.auto-claude.backup', 'specs', '001-foo', 'spec.md'),
      'utf-8',
    );
    expect(backupSpec).toContain('Legacy Spec');
    const marker = await readFile(
      path.join(projectRoot, '.auto-claude', '.bmad-migration-complete.json'),
      'utf-8',
    );
    expect(marker).toContain('001-foo');

    const brief = await readFile(
      path.join(projectRoot, '_bmad-output', 'planning-artifacts', '001-foo-product-brief.md'),
      'utf-8',
    );
    expect(brief).toContain('Migrated Product Brief');

    const sprint = await readSprintStatus({ projectRoot });
    expect(sprint?.developmentStatus['epic-001-foo']).toBe('backlog');
    expect(sprint?.developmentStatus['001-foo-1-create-login']).toBe('ready-for-dev');
  });

  it('does not offer or rerun migration after a successful migration marker exists', async () => {
    await writeLegacySpec(projectRoot, '001-foo');

    await migrateLegacySpecs(projectRoot);
    const plan = await detectLegacySpecs(projectRoot);
    const secondRun = await migrateLegacySpecs(projectRoot);

    expect(plan.hasLegacySpecs).toBe(false);
    expect(plan.candidates).toEqual([]);
    expect(secondRun.migrated).toBe(false);
    expect(secondRun.planningFiles).toEqual([]);
    expect(secondRun.implementationFiles).toEqual([]);
  });

  it('returns a no-op result when no legacy specs exist', async () => {
    const result = await migrateLegacySpecs(projectRoot);

    expect(result.migrated).toBe(false);
    expect(result.hasLegacySpecs).toBe(false);
    expect(result.planningFiles).toEqual([]);
  });
});

async function writeLegacySpec(projectRoot: string, id: string): Promise<void> {
  const dir = path.join(projectRoot, '.auto-claude', 'specs', id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'spec.md'), '# Legacy Spec\n\nOld requirements.', 'utf-8');
  await writeFile(
    path.join(dir, 'implementation_plan.json'),
    JSON.stringify({
      tasks: [
        {
          title: 'Create login',
          description: 'Implement the login screen.',
          status: 'ready',
        },
        {
          title: 'Review auth state',
          description: 'Check persistence.',
          status: 'review',
        },
      ],
    }),
    'utf-8',
  );
  await writeFile(
    path.join(dir, 'requirements.json'),
    JSON.stringify({ goal: 'Ship login' }),
    'utf-8',
  );
}
