/**
 * Vitest fixtures for the BMad file watcher.
 *
 * The acceptance line in ENGINE_SWAP_PROMPT.md Phase 1 is "File watcher fires
 * correctly when a skill's customize.toml changes" — that's the `it('emits
 * customization-changed when ...')` case below. The rest are coverage for the
 * other event types and the path-classification logic.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __internals, startBmadFileWatcher } from '../file-watcher';
import type { BmadFileEvent, BmadFileEventType } from '../../../../shared/types/bmad';

const { classifyPath, shouldIgnore } = __internals;

async function makeProject(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'bmad-watcher-'));
}

async function writeAt(projectRoot: string, rel: string, contents: string): Promise<string> {
  const filePath = path.join(projectRoot, rel);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, 'utf-8');
  return filePath;
}

function waitForEvent(
  events: BmadFileEvent[],
  predicate: (e: BmadFileEvent) => boolean,
  timeoutMs = 12_000,
): Promise<BmadFileEvent> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const found = events.find(predicate);
      if (found) {
        resolve(found);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`timeout waiting for event after ${timeoutMs}ms; saw: ${events.map((e) => e.type).join(',')}`));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

/**
 * Some test runners over-subscribe the file system when many vitest workers
 * are active concurrently — chokidar's ~50ms `awaitWriteFinish` poll can miss
 * a small write under load. Adding a 100ms breathing room after the write
 * stabilizes the event ordering at the cost of a tiny test-runtime budget.
 */
async function settleAfterWrite(): Promise<void> {
  await new Promise((r) => setTimeout(r, 100));
}

describe('classifyPath', () => {
  const root = '/proj';
  const cases: { rel: string; expected: BmadFileEventType | null }[] = [
    { rel: '_bmad/_config/manifest.yaml', expected: 'manifest-changed' },
    { rel: '_bmad/_config/skill-manifest.csv', expected: 'manifest-changed' },
    { rel: '_bmad/_config/bmad-help.csv', expected: 'manifest-changed' },
    { rel: '_bmad/config.toml', expected: 'config-changed' },
    { rel: '_bmad/config.user.toml', expected: 'config-changed' },
    { rel: '_bmad/bmm/config.yaml', expected: 'config-changed' },
    { rel: '_bmad/custom/bmad-agent-pm.toml', expected: 'customization-changed' },
    { rel: '_bmad/custom/bmad-agent-pm.user.toml', expected: 'customization-changed' },
    { rel: '_bmad/custom/config.toml', expected: 'config-changed' },
    { rel: '_bmad/custom/config.user.toml', expected: 'config-changed' },
    { rel: '_bmad/bmm/2-plan-workflows/bmad-agent-pm/customize.toml', expected: 'customization-changed' },
    { rel: '_bmad/bmm/2-plan-workflows/bmad-create-prd/SKILL.md', expected: 'skill-changed' },
    { rel: '_bmad/bmm/2-plan-workflows/bmad-create-prd/steps/1-intro.md', expected: 'skill-changed' },
    { rel: '_bmad/scripts/resolve_customization.py', expected: null },
    { rel: '_bmad-output/planning-artifacts/PRD.md', expected: 'planning-artifact-changed' },
    { rel: '_bmad-output/implementation-artifacts/sprint-status.yaml', expected: 'sprint-status-changed' },
    { rel: '_bmad-output/implementation-artifacts/epic-1.md', expected: 'epic-file-changed' },
    { rel: '_bmad-output/implementation-artifacts/story-1-1.md', expected: 'story-file-changed' },
    { rel: '_bmad-output/implementation-artifacts/whatever.md', expected: 'implementation-artifact-changed' },
    { rel: '_bmad-output/project-context.md', expected: 'project-context-changed' },
    { rel: 'somewhere-else/file.md', expected: null },
  ];

  for (const { rel, expected } of cases) {
    it(`classifies ${rel} → ${expected ?? '<ignored>'}`, () => {
      expect(classifyPath(path.join(root, rel), root)).toBe(expected);
    });
  }
});

describe('shouldIgnore', () => {
  const root = '/proj';
  it('ignores .DS_Store and editor swap files', () => {
    expect(shouldIgnore(path.join(root, '_bmad', '.DS_Store'), root)).toBe(true);
    expect(shouldIgnore(path.join(root, '_bmad', '.swp'), root)).toBe(true);
  });

  it('ignores atomic-write temp files (matches apps/.../atomic-file.ts)', () => {
    expect(
      shouldIgnore(
        path.join(root, '_bmad', 'custom', '.bmad-agent-pm.toml.tmp.0123456789abcdef'),
        root,
      ),
    ).toBe(true);
  });

  it('does not ignore real customization files', () => {
    expect(shouldIgnore(path.join(root, '_bmad', 'custom', 'bmad-agent-pm.toml'), root)).toBe(false);
  });

  it('ignores anything outside _bmad/ and _bmad-output/', () => {
    expect(shouldIgnore(path.join(root, 'src', 'foo.ts'), root)).toBe(true);
  });
});

describe('startBmadFileWatcher (integration)', () => {
  let projectRoot: string;
  let received: BmadFileEvent[];

  beforeEach(async () => {
    projectRoot = await makeProject();
    received = [];
    // Pre-create the dirs so chokidar has somewhere to watch.
    await mkdir(path.join(projectRoot, '_bmad', '_config'), { recursive: true });
    await mkdir(path.join(projectRoot, '_bmad', 'custom'), { recursive: true });
    await mkdir(path.join(projectRoot, '_bmad', 'bmm', '2-plan-workflows', 'bmad-agent-pm'), { recursive: true });
    await mkdir(path.join(projectRoot, '_bmad-output', 'implementation-artifacts'), { recursive: true });
    await mkdir(path.join(projectRoot, '_bmad-output', 'planning-artifacts'), { recursive: true });
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('emits customization-changed when _bmad/custom/{skill}.toml changes (Phase 1 acceptance criterion)', async () => {
    const handle = await startBmadFileWatcher({
      projectRoot,
      debounceMs: 50,
      onEvent: (e) => received.push(e),
    });
    try {
      await writeAt(projectRoot, '_bmad/custom/bmad-agent-pm.toml', '[agent]\nicon = "🏥"\n');
      await settleAfterWrite();
      const ev = await waitForEvent(received, (e) => e.type === 'customization-changed');
      expect(ev.path.endsWith('bmad-agent-pm.toml')).toBe(true);
      expect(ev.projectRoot).toBe(projectRoot);
    } finally {
      await handle.close();
    }
  });

  it('emits manifest-changed when _bmad/_config/manifest.yaml changes', async () => {
    const handle = await startBmadFileWatcher({
      projectRoot,
      debounceMs: 50,
      onEvent: (e) => received.push(e),
    });
    try {
      await writeAt(projectRoot, '_bmad/_config/manifest.yaml', 'modules: []\n');
      await settleAfterWrite();
      const ev = await waitForEvent(received, (e) => e.type === 'manifest-changed');
      expect(ev.path.endsWith('manifest.yaml')).toBe(true);
    } finally {
      await handle.close();
    }
  });

  it('emits sprint-status-changed when _bmad-output/implementation-artifacts/sprint-status.yaml changes', async () => {
    const handle = await startBmadFileWatcher({
      projectRoot,
      debounceMs: 50,
      onEvent: (e) => received.push(e),
    });
    try {
      await writeAt(
        projectRoot,
        '_bmad-output/implementation-artifacts/sprint-status.yaml',
        'epics: []\n',
      );
      await settleAfterWrite();
      const ev = await waitForEvent(received, (e) => e.type === 'sprint-status-changed');
      expect(ev.path.endsWith('sprint-status.yaml')).toBe(true);
    } finally {
      await handle.close();
    }
  });

  it('coalesces duplicate events within the debounce window', async () => {
    const handle = await startBmadFileWatcher({
      projectRoot,
      debounceMs: 100,
      onEvent: (e) => received.push(e),
    });
    try {
      const filePath = await writeAt(projectRoot, '_bmad/custom/bmad-agent-pm.toml', '[agent]\nicon = "🏥"\n');
      // Fire several rapid writes to the same file.
      for (let i = 0; i < 5; i += 1) {
        await writeFile(filePath, `[agent]\nicon = "${i}"\n`);
      }
      // Wait long enough for debounce to flush.
      await new Promise((r) => setTimeout(r, 400));
      const customEvents = received.filter((e) => e.type === 'customization-changed');
      // Atomic writes from different chokidar event types (add/change) can
      // emit twice but never N=5+ — the debouncer collapses them.
      expect(customEvents.length).toBeLessThan(5);
      expect(customEvents.length).toBeGreaterThanOrEqual(1);
    } finally {
      await handle.close();
    }
  });

  it('exposes supportedEvents and respects close()', async () => {
    const handle = await startBmadFileWatcher({
      projectRoot,
      debounceMs: 50,
    });
    expect(handle.supportedEvents).toContain('customization-changed');
    expect(handle.isRunning).toBe(true);
    await handle.close();
    expect(handle.isRunning).toBe(false);
  });
});
