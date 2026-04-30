/**
 * BMad file watcher
 * =================
 *
 * Wraps `chokidar` to surface high-level, debounced events for the BMAD
 * project filesystem. The renderer subscribes via the `BmadAPI.onFileEvent`
 * IPC bridge; the orchestrator and skill registry subscribe in-process.
 *
 * Events emitted (per ENGINE_SWAP_PROMPT.md Phase 1 deliverable §6 +
 * `<bmad_docs_index>` Phase 1):
 *   - `manifest-changed`            — `_bmad/_config/manifest.yaml` or any `_config/*` CSV changed
 *   - `skill-changed`               — any file under `_bmad/{module}/{skill}/` changed
 *   - `customization-changed`       — `_bmad/custom/*.toml` changed
 *   - `sprint-status-changed`       — `_bmad-output/implementation-artifacts/sprint-status.yaml` changed
 *   - `story-file-changed`          — story file under `_bmad-output/implementation-artifacts/` changed
 *   - `epic-file-changed`           — epic file under `_bmad-output/implementation-artifacts/` changed
 *   - `config-changed`              — `_bmad/config.toml`, `_bmad/config.user.toml`, or `_bmad/{module}/config.yaml` changed
 *   - `project-context-changed`     — `_bmad-output/project-context.md` (or anywhere that name lives) changed
 *   - `planning-artifact-changed`   — anything under `_bmad-output/planning-artifacts/`
 *   - `implementation-artifact-changed` — anything under `_bmad-output/implementation-artifacts/`
 *
 * Debounced 250ms per the prompt. Polling fallback is opt-in via
 * `usePolling` for network drives.
 *
 * The watcher is cooperative — `start()` returns a handle; the caller stops
 * it when the project is unloaded. There is no global watcher state.
 */

import path from 'node:path';
import { EventEmitter } from 'node:events';
import chokidar, { FSWatcher } from 'chokidar';

import {
  BMAD_FILE_EVENT_TYPES,
  type BmadFileEvent,
  type BmadFileEventType,
} from '../../../shared/types/bmad';

// =============================================================================
// Types
// =============================================================================

export interface BmadFileWatcherOptions {
  /** Absolute path to the project root (the directory containing `_bmad/`). */
  readonly projectRoot: string;
  /** Debounce window in ms. Defaults to 250 per the prompt. */
  readonly debounceMs?: number;
  /**
   * Use chokidar's polling fallback. Required for some network drives
   * (CIFS / SMB) and Docker bind mounts. Default: false.
   */
  readonly usePolling?: boolean;
  /**
   * Polling interval in ms (only used if `usePolling: true`). Default: 1000.
   */
  readonly pollingIntervalMs?: number;
  /**
   * Optional event sink. Useful in tests + for the IPC bridge. The watcher
   * also exposes a typed EventEmitter API.
   */
  readonly onEvent?: (event: BmadFileEvent) => void;
  /** Optional warning sink (e.g. failed-to-start). */
  readonly onWarn?: (msg: string) => void;
}

/**
 * The watcher emits a single named event `'event'` carrying a typed
 * `BmadFileEvent`. Listeners subscribe via `on('event', cb)` (or via the
 * convenience `start({ onEvent })` callback).
 */
export type BmadFileWatcherEmitter = {
  on(event: 'event', listener: (e: BmadFileEvent) => void): void;
  off(event: 'event', listener: (e: BmadFileEvent) => void): void;
};

export interface BmadFileWatcherHandle extends BmadFileWatcherEmitter {
  /** Stop watching and release the underlying chokidar handle. */
  close(): Promise<void>;
  /** True between `start()` and `close()`. */
  readonly isRunning: boolean;
  /** All event types this watcher can emit. */
  readonly supportedEvents: ReadonlyArray<BmadFileEventType>;
}

// =============================================================================
// start()
// =============================================================================

export async function startBmadFileWatcher(
  options: BmadFileWatcherOptions,
): Promise<BmadFileWatcherHandle> {
  const projectRoot = path.resolve(options.projectRoot);
  const debounceMs = options.debounceMs ?? 250;
  const onWarn =
    options.onWarn ??
    function noopWarn() {
      // intentional no-op default for the optional onWarn callback
    };
  const onEvent = options.onEvent;

  const emitter = new EventEmitter();

  const bmadDir = path.join(projectRoot, '_bmad');
  const outputDir = path.join(projectRoot, '_bmad-output');

  const watcher: FSWatcher = chokidar.watch([bmadDir, outputDir], {
    ignored: (target: string) => shouldIgnore(target, projectRoot),
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: debounceMs,
      pollInterval: 50,
    },
    usePolling: options.usePolling ?? false,
    interval: options.pollingIntervalMs ?? 1000,
  });

  const debouncer = createDebouncer(debounceMs, (events: BmadFileEvent[]) => {
    // Coalesce identical events emitted within the debounce window. We treat
    // (type, path) as the dedup key; chokidar can fire multiple change events
    // for one logical save (write open + atomic rename).
    const seen = new Set<string>();
    for (const ev of events) {
      const key = `${ev.type}::${ev.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      emitter.emit('event', ev);
      onEvent?.(ev);
    }
  });

  const handleRaw = (filePath: string) => {
    const eventType = classifyPath(filePath, projectRoot);
    if (!eventType) return;
    debouncer.push({
      type: eventType,
      path: filePath,
      projectRoot,
      timestamp: Date.now(),
    });
  };

  watcher.on('add', handleRaw);
  watcher.on('change', handleRaw);
  watcher.on('unlink', handleRaw);
  watcher.on('addDir', handleRaw);
  watcher.on('unlinkDir', handleRaw);
  watcher.on('error', (err: unknown) => {
    onWarn(`bmad-file-watcher error: ${err instanceof Error ? err.message : String(err)}`);
  });

  // Wait for chokidar's initial scan to complete so callers know the watcher
  // is ready before they start interacting with the filesystem.
  await new Promise<void>((resolve) => {
    let resolved = false;
    const finalize = () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };
    watcher.once('ready', finalize);
    // Hard timeout in case the dir doesn't exist yet — chokidar still emits
    // 'ready' eventually but only after retrying.
    setTimeout(finalize, 1000);
  });

  let running = true;

  return {
    on: (event: 'event', listener: (e: BmadFileEvent) => void): void => {
      emitter.on(event, listener);
    },
    off: (event: 'event', listener: (e: BmadFileEvent) => void): void => {
      emitter.off(event, listener);
    },
    close: async (): Promise<void> => {
      running = false;
      debouncer.flush();
      await watcher.close();
      emitter.removeAllListeners();
    },
    get isRunning() {
      return running;
    },
    supportedEvents: BMAD_FILE_EVENT_TYPES,
  };
}

// =============================================================================
// Path classification
// =============================================================================

/**
 * Map an absolute path under `_bmad/` or `_bmad-output/` to the
 * `BmadFileEventType` it should emit. Returns null for paths we don't care
 * about (e.g. skill assets we already covered via the manifest, lockfiles,
 * editor temp files).
 *
 * The resolution order matters: the most specific match wins.
 */
export function classifyPath(filePath: string, projectRoot: string): BmadFileEventType | null {
  const rel = path.relative(projectRoot, filePath);
  if (rel.startsWith('..')) return null;

  const segs = rel.split(path.sep);
  const root = segs[0];

  // _bmad/ tree
  if (root === '_bmad') {
    if (segs[1] === '_config') {
      // Any change in _config (manifest.yaml, *.csv) → manifest-changed.
      return 'manifest-changed';
    }
    if (segs[1] === 'custom' && (segs[2]?.endsWith('.toml'))) {
      // Customization overrides — both per-skill and central config sit here.
      // The two are distinguishable by name (`config*.toml` vs `{skill}.toml`)
      // but consumers typically want both; emit `customization-changed` for
      // skill files and `config-changed` for `config*.toml`.
      return segs[2].startsWith('config') ? 'config-changed' : 'customization-changed';
    }
    if (segs[1] === 'config.toml' || segs[1] === 'config.user.toml') {
      return 'config-changed';
    }
    if (segs[2] === 'config.yaml') {
      // _bmad/{module}/config.yaml — module-level config
      return 'config-changed';
    }
    if (segs[1] === 'scripts') {
      // Python resolver scripts — no event (we don't shell out to them
      // per ENGINE_SWAP_PROMPT.md `<anti_patterns>`).
      return null;
    }
    // Everything else under `_bmad/{module}/...` — skill content + customize.
    if (segs.length >= 3) {
      const fileName = segs[segs.length - 1] ?? '';
      if (fileName === 'customize.toml') {
        // The skill's defaults customize.toml lives here. Treat as a
        // customization-changed event so the skill registry invalidates.
        return 'customization-changed';
      }
      return 'skill-changed';
    }
    return null;
  }

  // _bmad-output/ tree
  if (root === '_bmad-output') {
    const sub = segs[1];
    const fileName = segs[segs.length - 1] ?? '';

    if (fileName === 'project-context.md') return 'project-context-changed';

    if (sub === 'planning-artifacts') {
      return 'planning-artifact-changed';
    }
    if (sub === 'implementation-artifacts') {
      if (fileName === 'sprint-status.yaml') return 'sprint-status-changed';
      // story-* / *.story.md / *.story.yaml convention from BMAD's
      // bmad-create-story skill.
      if (/(^|[/-])(story|stories)/i.test(rel) && fileName.endsWith('.md')) {
        return 'story-file-changed';
      }
      if (/(^|[/-])(epic|epics)/i.test(rel) && fileName.endsWith('.md')) {
        return 'epic-file-changed';
      }
      return 'implementation-artifact-changed';
    }
    return null;
  }

  return null;
}

/**
 * Skip noise: hidden files, OS / editor temp files, and chokidar's own race
 * artifacts. Atomic-write temp files (`.{name}.tmp.{hex}`) from
 * `apps/desktop/src/main/utils/atomic-file.ts` are deliberately filtered so
 * the watcher only fires once per logical save.
 */
function shouldIgnore(target: string, projectRoot: string): boolean {
  const base = path.basename(target);
  if (base === '.DS_Store') return true;
  if (base === 'Thumbs.db') return true;
  if (base.startsWith('.swp')) return true;
  if (/^\.[^/]+\.tmp\.[a-f0-9]+$/i.test(base)) return true;

  // We strictly only care about files under _bmad/ and _bmad-output/.
  const rel = path.relative(projectRoot, target);
  if (rel.startsWith('..')) return true;
  // Allow the two top-level dirs themselves so chokidar can recurse into them.
  if (rel === '_bmad' || rel === '_bmad-output' || rel === '') return false;
  if (!rel.startsWith('_bmad') && !rel.startsWith('_bmad-output')) return true;

  // Ignore git internals nested under _bmad-output (some users symlink).
  if (rel.includes(`${path.sep}.git${path.sep}`) || rel.endsWith(`${path.sep}.git`)) return true;
  return false;
}

// =============================================================================
// Debouncer
// =============================================================================

interface Debouncer<T> {
  push(item: T): void;
  flush(): void;
}

function createDebouncer<T>(intervalMs: number, sink: (items: T[]) => void): Debouncer<T> {
  let buffer: T[] = [];
  let timer: NodeJS.Timeout | null = null;

  return {
    push(item: T) {
      buffer.push(item);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const drained = buffer;
        buffer = [];
        sink(drained);
      }, intervalMs);
    },
    flush() {
      if (timer) clearTimeout(timer);
      timer = null;
      if (buffer.length > 0) {
        const drained = buffer;
        buffer = [];
        sink(drained);
      }
    },
  };
}

// Re-export internals for tests.
export const __internals = { classifyPath, shouldIgnore };
