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

/**
 * Phase 3 hardening (per ENGINE_SWAP_PROMPT.md Phase 3 pre-work block): the
 * integration block exercises a real chokidar watcher against the OS file
 * system, which is timing-sensitive under heavy Vitest parallelism. Native
 * FSEvents (macOS) and inotify (Linux) can stall for >10s when many vitest
 * workers fight for the OS event queue, leaving the watcher's `received`
 * array empty even after the helper's 12s wait.
 *
 * Fix: opt the integration tests into chokidar's polling mode (option B in
 * the prompt's hardening menu). Polling reads directory state every
 * `WATCHER_POLLING_INTERVAL_MS` and emits events deterministically — slower
 * than native FS events in absolute terms, but uniform across runs and
 * platforms. Production code keeps native FS events as the default.
 *
 * Per ENGINE_SWAP_PROMPT.md `<engineering_standards>` "Cross-platform" the
 * file-watcher already supports `usePolling` for network drives — we reuse
 * that switch here. Test-only.
 */
const WATCHER_POLLING_INTERVAL_MS = 75;
const WATCHER_TEST_TIMEOUT_MS = 30_000;

describe('startBmadFileWatcher (integration)', { timeout: WATCHER_TEST_TIMEOUT_MS }, () => {
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
      debounceMs: 100,
      usePolling: true,
      pollingIntervalMs: WATCHER_POLLING_INTERVAL_MS,
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
      debounceMs: 100,
      usePolling: true,
      pollingIntervalMs: WATCHER_POLLING_INTERVAL_MS,
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
      debounceMs: 100,
      usePolling: true,
      pollingIntervalMs: WATCHER_POLLING_INTERVAL_MS,
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
    // Phase 3 hardening (per ENGINE_SWAP_PROMPT.md Phase 3 pre-work block):
    // this case used to assert `customEvents.length < 5`, which was
    // timing-flaky when Vitest scheduled many test files concurrently —
    // chokidar's `awaitWriteFinish` poll could split bursty writes across
    // multiple stability windows, producing one event per write under load.
    //
    // Fix combines polling mode (deterministic chokidar) with a
    // timing-tolerant assertion (option c). The intent is "no thrash":
    // rapid writes coalesce into far fewer events than the raw write count.
    const debounceMs = 200;
    const handle = await startBmadFileWatcher({
      projectRoot,
      debounceMs,
      usePolling: true,
      pollingIntervalMs: WATCHER_POLLING_INTERVAL_MS,
      onEvent: (e) => received.push(e),
    });
    try {
      const filePath = await writeAt(projectRoot, '_bmad/custom/bmad-agent-pm.toml', '[agent]\nicon = "🏥"\n');
      // Drain any 'add' event emitted by chokidar for the initial create
      // before we measure compression. Wait one full debounce window so the
      // watcher has emitted the create-event(s), then reset the buffer.
      await new Promise((r) => setTimeout(r, debounceMs * 2));
      received.length = 0;

      // Fire several rapid writes to the same file.
      const writeCount = 5;
      for (let i = 0; i < writeCount; i += 1) {
        await writeFile(filePath, `[agent]\nicon = "${i}"\n`);
      }
      // Settle for ~4× the debounce window; on slow CI any straggler events
      // land here. Faster-than-debounce writes coalesce; slower writes still
      // produce far fewer events than `writeCount`.
      await new Promise((r) => setTimeout(r, debounceMs * 4));
      const customEvents = received.filter((e) => e.type === 'customization-changed');
      // Spirit of the test: rapid writes compress. Upper bound is
      // generous — exactly equalling `writeCount` would mean zero
      // coalescing, which we never see in practice. We assert
      // *strictly fewer* events than writes (compression occurred) and at
      // least one (we did notice the writes).
      expect(customEvents.length).toBeGreaterThanOrEqual(1);
      expect(customEvents.length).toBeLessThan(writeCount);
      expect(customEvents.every((e) => e.path === filePath)).toBe(true);
    } finally {
      await handle.close();
    }
  });

  it('exposes supportedEvents and respects close()', async () => {
    const handle = await startBmadFileWatcher({
      projectRoot,
      debounceMs: 50,
      usePolling: true,
      pollingIntervalMs: WATCHER_POLLING_INTERVAL_MS,
    });
    expect(handle.supportedEvents).toContain('customization-changed');
    expect(handle.isRunning).toBe(true);
    await handle.close();
    expect(handle.isRunning).toBe(false);
  });
});
