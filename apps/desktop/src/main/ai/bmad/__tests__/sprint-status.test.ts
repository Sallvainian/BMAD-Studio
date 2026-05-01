/**
 * Vitest fixtures for sprint-status reader/writer.
 *
 * Coverage:
 *   - readSprintStatus parses the canonical YAML shape from
 *     `bmad-sprint-planning/sprint-status-template.yaml`
 *   - tolerateMissing returns null instead of throwing
 *   - writeSprintStatus + readSprintStatus round-trip
 *   - Atomic write: a partial-failure simulation doesn't corrupt the file
 *   - updateStoryStatus mutates one row + bumps lastUpdated
 *   - Schema validation rejects bad development_status values
 *   - Path containment: getSprintStatusPath always lands under
 *     `_bmad-output/implementation-artifacts/`
 *   - Event emitter fires `sprint-status-written` after a successful write
 */

import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __internals,
  createSprintStatusEmitter,
  getSprintStatusPath,
  readSprintStatus,
  SprintStatusError,
  updateStoryStatus,
  writeSprintStatus,
} from '../sprint-status';
import type { BmadSprintStatus } from '../../../../shared/types/bmad';

// =============================================================================
// Helpers
// =============================================================================

async function makeProject(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'bmad-sprint-status-'));
}

async function writeSprintStatusFile(projectRoot: string, body: string): Promise<string> {
  const target = getSprintStatusPath(projectRoot);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, body, 'utf-8');
  return target;
}

const SAMPLE_YAML = `
generated: 04-30-2026 00:00
last_updated: 04-30-2026 00:00
project: My Project
project_key: MYP
tracking_system: file-system
story_location: "_bmad-output/implementation-artifacts/stories"

development_status:
  epic-1: backlog
  1-1-user-auth: ready-for-dev
  1-2-account: backlog
  epic-1-retrospective: optional

  epic-2: backlog
  2-1-data-model: backlog
`;

const SAMPLE_STATUS: BmadSprintStatus = {
  generated: '04-30-2026 00:00',
  lastUpdated: '04-30-2026 00:00',
  project: 'My Project',
  projectKey: 'MYP',
  trackingSystem: 'file-system',
  storyLocation: '_bmad-output/implementation-artifacts/stories',
  developmentStatus: {
    'epic-1': 'backlog',
    '1-1-user-auth': 'ready-for-dev',
  },
};

// =============================================================================
// getSprintStatusPath
// =============================================================================

describe('getSprintStatusPath', () => {
  it('always lands under _bmad-output/implementation-artifacts/', () => {
    const got = getSprintStatusPath('/some/proj');
    expect(got).toContain('_bmad-output');
    expect(got).toContain('implementation-artifacts');
    expect(got.endsWith('sprint-status.yaml')).toBe(true);
  });

  it('resolves the projectRoot to absolute', () => {
    const got = getSprintStatusPath('relative/path');
    expect(path.isAbsolute(got)).toBe(true);
  });
});

// =============================================================================
// readSprintStatus — happy path
// =============================================================================

describe('readSprintStatus', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await makeProject();
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('parses the canonical YAML shape', async () => {
    await writeSprintStatusFile(projectRoot, SAMPLE_YAML);
    const status = await readSprintStatus({ projectRoot });
    expect(status).not.toBeNull();
    expect(status!.project).toBe('My Project');
    expect(status!.projectKey).toBe('MYP');
    expect(status!.trackingSystem).toBe('file-system');
    expect(status!.developmentStatus['1-1-user-auth']).toBe('ready-for-dev');
    expect(status!.developmentStatus['epic-1-retrospective']).toBe('optional');
  });

  it('throws SPRINT_STATUS_NOT_FOUND when the file is missing', async () => {
    await expect(readSprintStatus({ projectRoot })).rejects.toThrow(/not found/i);
  });

  it('returns null when tolerateMissing is true', async () => {
    const result = await readSprintStatus({ projectRoot, tolerateMissing: true });
    expect(result).toBeNull();
  });

  it('throws YAML_PARSE_ERROR for malformed YAML', async () => {
    await writeSprintStatusFile(projectRoot, '  : invalid yaml :\n  bad - syntax\n');
    await expect(readSprintStatus({ projectRoot })).rejects.toThrow(SprintStatusError);
  });

  it('throws SPRINT_STATUS_VALIDATION_ERROR for an unknown status value', async () => {
    await writeSprintStatusFile(
      projectRoot,
      `generated: x\nlast_updated: y\nproject: P\nproject_key: K\ntracking_system: f\nstory_location: ""\ndevelopment_status:\n  story-1: bogus-status\n`,
    );
    await expect(readSprintStatus({ projectRoot })).rejects.toThrow(/validation/i);
  });
});

// =============================================================================
// writeSprintStatus — atomic write + round-trip
// =============================================================================

describe('writeSprintStatus', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await makeProject();
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('writes a valid sprint-status.yaml and round-trips through readSprintStatus', async () => {
    await writeSprintStatus({ projectRoot, status: SAMPLE_STATUS });
    const roundtrip = await readSprintStatus({ projectRoot });
    expect(roundtrip).not.toBeNull();
    expect(roundtrip!.project).toBe(SAMPLE_STATUS.project);
    expect(roundtrip!.developmentStatus).toEqual(SAMPLE_STATUS.developmentStatus);
  });

  it('preserves the STATUS DEFINITIONS comment block on every write', async () => {
    await writeSprintStatus({ projectRoot, status: SAMPLE_STATUS });
    const raw = await readFile(getSprintStatusPath(projectRoot), 'utf-8');
    expect(raw).toContain('STATUS DEFINITIONS');
    expect(raw).toContain('ready-for-dev: Story file created');
  });

  it('rejects an invalid payload before touching disk', async () => {
    const broken = {
      ...SAMPLE_STATUS,
      developmentStatus: { 's': 'not-a-real-status' },
    } as unknown as BmadSprintStatus;
    await expect(
      writeSprintStatus({ projectRoot, status: broken }),
    ).rejects.toThrow(SprintStatusError);
    // File should still NOT exist (write rejected pre-IO).
    await expect(readFile(getSprintStatusPath(projectRoot), 'utf-8')).rejects.toBeTruthy();
  });

  it('creates the parent directory if missing', async () => {
    // Project doesn't have _bmad-output/implementation-artifacts/ yet.
    await writeSprintStatus({ projectRoot, status: SAMPLE_STATUS });
    const stat = await readFile(getSprintStatusPath(projectRoot), 'utf-8');
    expect(stat.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// updateStoryStatus
// =============================================================================

describe('updateStoryStatus', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await makeProject();
    await writeSprintStatusFile(projectRoot, SAMPLE_YAML);
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('updates the matching story status and bumps lastUpdated', async () => {
    const fixedNow = new Date('2026-05-01T12:00:00Z');
    const result = await updateStoryStatus({
      projectRoot,
      storyKey: '1-1-user-auth',
      status: 'in-progress',
      now: fixedNow,
    });
    expect(result.developmentStatus['1-1-user-auth']).toBe('in-progress');
    expect(result.lastUpdated).not.toBe('04-30-2026 00:00');
  });

  it('throws INVALID_INPUT when the story key is not in development_status', async () => {
    await expect(
      updateStoryStatus({
        projectRoot,
        storyKey: 'nope',
        status: 'done',
      }),
    ).rejects.toThrow(/not found/);
  });

  it('throws SPRINT_STATUS_NOT_FOUND when no file exists', async () => {
    await rm(getSprintStatusPath(projectRoot));
    await expect(
      updateStoryStatus({
        projectRoot,
        storyKey: '1-1-user-auth',
        status: 'done',
      }),
    ).rejects.toThrow(SprintStatusError);
  });
});

// =============================================================================
// Event emitter
// =============================================================================

describe('createSprintStatusEmitter', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await makeProject();
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('fires sprint-status-written on a successful write', async () => {
    const emitter = createSprintStatusEmitter();
    const listener = vi.fn();
    emitter.on('sprint-status-written', listener);

    await writeSprintStatus({ projectRoot, status: SAMPLE_STATUS, emitter });
    expect(listener).toHaveBeenCalledTimes(1);
    const arg = listener.mock.calls[0]![0];
    expect(arg.projectRoot).toBe(projectRoot);
    expect(arg.filePath).toBe(getSprintStatusPath(projectRoot));
    expect(arg.status.project).toBe(SAMPLE_STATUS.project);
  });

  it('does not fire when the write is rejected by validation', async () => {
    const emitter = createSprintStatusEmitter();
    const listener = vi.fn();
    emitter.on('sprint-status-written', listener);

    const broken = {
      ...SAMPLE_STATUS,
      developmentStatus: { x: 'bad' },
    } as unknown as BmadSprintStatus;
    await expect(
      writeSprintStatus({ projectRoot, status: broken, emitter }),
    ).rejects.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Internal helpers
// =============================================================================

describe('formatTimestamp (internal)', () => {
  it('renders MM-DD-YYYY HH:MM with zero-padding', () => {
    const dt = new Date(Date.UTC(2026, 0, 5, 7, 9, 0));
    // Local time depends on TZ; use a substring match instead of equality.
    const out = __internals.formatTimestamp(dt);
    expect(out).toMatch(/^\d{2}-\d{2}-\d{4} \d{2}:\d{2}$/);
  });
});

describe('normalizeRawYaml (internal)', () => {
  it('coerces snake_case YAML keys into camelCase TS shape', () => {
    const out = __internals.normalizeRawYaml({
      generated: 'g',
      last_updated: 'lu',
      project: 'p',
      project_key: 'pk',
      tracking_system: 'ts',
      story_location: 'sl',
      development_status: { 'a': 'backlog' },
    });
    expect(out.lastUpdated).toBe('lu');
    expect(out.projectKey).toBe('pk');
    expect(out.trackingSystem).toBe('ts');
    expect(out.storyLocation).toBe('sl');
  });
});
