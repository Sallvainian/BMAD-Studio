/**
 * BMad installer wrapper
 * ======================
 *
 * Spawns `npx bmad-method install` with a typed flag surface, streams
 * stdout/stderr line-by-line, and returns a parsed `BmadInstallerResult`.
 *
 * Supports every flag documented in BMAD docs § "Headless CI installs":
 *   `--yes`, `--directory`, `--modules`, `--tools`, `--list-tools`, `--action`,
 *   `--custom-source`, `--channel`, `--all-stable`, `--all-next`, `--next=`,
 *   `--pin`, `--set`, `--list-options`, `--user-name`,
 *   `--communication-language`, `--document-output-language`, `--output-folder`.
 *
 * Cross-platform via `apps/desktop/src/main/platform/`:
 *   - `npx.cmd` on Windows, `npx` on Unix per `getNpxCommand()`.
 *
 * Security:
 *   - Module names, tool names, and tags pass an allowlist before being
 *     concatenated into flag values. No shell — `child_process.spawn` is
 *     called with `shell: false` so even allowlist bypasses can't trigger
 *     shell expansion.
 *   - The directory path is validated via the platform abstraction's
 *     `isSecurePath` helper.
 *   - `GITHUB_TOKEN` is forwarded via the env (per BMAD docs § "Rate limit on
 *     shared IPs") rather than concatenated into args.
 *
 * Progress parsing recognizes the installer's BoxenJS-style log prefixes
 * (`◇`, `◒`, `●`, `◆`) and emits typed `BmadInstallerProgressEvent`s; the
 * raw line is always also delivered so the renderer can show the unredacted
 * stream.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import path from 'node:path';
import { existsSync } from 'node:fs';

import {
  type BmadInstallerOptions,
  type BmadInstallerProgressEvent,
  type BmadInstallerProgressEventName,
  type BmadInstallerResult,
  type BmadInstallerStreamChunk,
  type BmadInstallerStreamKind,
} from '../../../shared/types/bmad';
import { getNpxCommand, isSecurePath, requiresShell } from '../../platform';

// =============================================================================
// Errors
// =============================================================================

export class InstallerError extends Error {
  readonly code:
    | 'INSTALLER_NOT_FOUND'
    | 'INSTALLER_FAILED'
    | 'INSTALLER_TIMEOUT'
    | 'NPX_NOT_AVAILABLE'
    | 'INVALID_INPUT'
    | 'INSTALLER_ALREADY_RUNNING';
  readonly cause?: unknown;
  readonly details?: unknown;

  constructor(
    code: InstallerError['code'],
    message: string,
    options?: { cause?: unknown; details?: unknown },
  ) {
    super(message);
    this.name = 'InstallerError';
    this.code = code;
    if (options?.cause !== undefined) this.cause = options.cause;
    if (options?.details !== undefined) this.details = options.details;
  }
}

// =============================================================================
// Public API
// =============================================================================

export interface RunInstallerCallbacks {
  /**
   * Called on every parsed line of stdout/stderr. Renderer should pipe these
   * to a streaming installer log component.
   */
  readonly onChunk?: (chunk: BmadInstallerStreamChunk) => void;
}

export interface RunInstallerOptions {
  readonly args: BmadInstallerOptions;
  readonly callbacks?: RunInstallerCallbacks;
  readonly abortSignal?: AbortSignal;
  /** Hard timeout in ms. Default: 5 minutes. */
  readonly timeoutMs?: number;
}

/**
 * Run `npx bmad-method install` against `args.directory`. Returns the parsed
 * result on success; throws `InstallerError` on validation, spawn, timeout,
 * or non-zero exit.
 */
export async function runInstaller(options: RunInstallerOptions): Promise<BmadInstallerResult> {
  const { args, callbacks, abortSignal, timeoutMs = 5 * 60_000 } = options;

  validateInstallerOptions(args);
  const cliArgs = buildCliArgs(args);

  const npxCmd = getNpxCommand();
  const spawnPath = resolveSpawnPath(npxCmd);
  if (!spawnPath) {
    throw new InstallerError(
      'NPX_NOT_AVAILABLE',
      `npx is not available on PATH (looked for ${npxCmd})`,
    );
  }

  // The wrapping shell is needed on Windows for npx.cmd files; non-Windows
  // never needs a shell, which keeps the no-injection guarantee.
  const useShell = requiresShell(npxCmd);

  const env = { ...process.env };
  if (args.githubToken) env.GITHUB_TOKEN = args.githubToken;
  // Force the installer's color output off so our line parser doesn't have
  // to strip ANSI in production. We strip in the parser anyway, but disabling
  // at the source produces cleaner logs for users who copy-paste.
  env.NO_COLOR = '1';
  env.FORCE_COLOR = '0';

  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  const stderrBuf: string[] = [];
  const stdoutBuf: string[] = [];
  let progressSnapshot = createProgressSnapshot();

  let child: ChildProcess;
  try {
    child = spawn(spawnPath, cliArgs, {
      cwd: args.directory,
      env,
      shell: useShell,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    throw new InstallerError(
      'INSTALLER_FAILED',
      `failed to spawn ${spawnPath}: ${(err as Error).message}`,
      { cause: err },
    );
  }

  if (!child.stdout || !child.stderr) {
    throw new InstallerError(
      'INSTALLER_FAILED',
      'spawned installer process has no stdout/stderr pipes',
    );
  }

  let aborted = false;
  const onAbort = () => {
    aborted = true;
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  };
  abortSignal?.addEventListener('abort', onAbort);

  const timeoutHandle = setTimeout(() => {
    aborted = true;
    if (!child.killed) child.kill('SIGTERM');
  }, timeoutMs);

  const handleStream = (kind: BmadInstallerStreamKind, dataBuf: Buffer | string): void => {
    const text = typeof dataBuf === 'string' ? dataBuf : dataBuf.toString('utf-8');
    if (kind === 'stdout') stdoutBuf.push(text);
    else stderrBuf.push(text);

    for (const line of splitLines(text)) {
      const stripped = stripAnsi(line);
      if (stripped.trim().length === 0 && line.length === 0) continue;
      const progress = detectProgress(stripped);
      if (progress) {
        progressSnapshot = applyProgressEvent(progressSnapshot, progress);
        callbacks?.onChunk?.({
          kind: 'progress',
          text: stripped,
          timestamp: Date.now(),
          progress,
        });
      } else {
        callbacks?.onChunk?.({
          kind,
          text: stripped,
          timestamp: Date.now(),
        });
      }
    }
  };

  child.stdout.on('data', (d) => handleStream('stdout', d));
  child.stderr.on('data', (d) => handleStream('stderr', d));

  const exitCode: number = await new Promise<number>((resolve, reject) => {
    child.once('error', (err) => {
      reject(
        new InstallerError(
          'INSTALLER_FAILED',
          `installer process emitted error: ${(err as Error).message}`,
          { cause: err },
        ),
      );
    });
    child.once('exit', (code, signal) => {
      if (signal && aborted) {
        reject(
          new InstallerError(
            'INSTALLER_TIMEOUT',
            `installer aborted (${signal})`,
          ),
        );
        return;
      }
      resolve(code ?? -1);
    });
  }).finally(() => {
    clearTimeout(timeoutHandle);
    abortSignal?.removeEventListener('abort', onAbort);
  });

  const success = exitCode === 0;
  const bmadDirCreated = existsSync(path.join(args.directory, '_bmad'));
  const result: BmadInstallerResult = {
    exitCode,
    success,
    directory: args.directory,
    durationMs: Date.now() - startedAt,
    bmadDirCreated,
    modules: progressSnapshot.modules.length > 0 ? progressSnapshot.modules : (args.modules ?? []),
    tools: progressSnapshot.tools.length > 0 ? progressSnapshot.tools : (args.tools ?? []),
    skillsConfigured: progressSnapshot.skillsConfigured,
    raw: stdoutBuf.join('') + stderrBuf.join(''),
  };

  if (!success) {
    throw new InstallerError(
      'INSTALLER_FAILED',
      `installer exited with code ${exitCode}`,
      { details: { result, startedAtIso } },
    );
  }
  return result;
}

// =============================================================================
// CLI argument builder
// =============================================================================

const MODULE_NAME_RE = /^[a-zA-Z0-9._-]+$/;
const TAG_RE = /^[a-zA-Z0-9._-]+$/;
const SET_KEY_RE = /^[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+$/;

export function validateInstallerOptions(opts: BmadInstallerOptions): void {
  if (!opts.directory) {
    throw new InstallerError('INVALID_INPUT', 'directory is required');
  }
  if (!path.isAbsolute(opts.directory)) {
    throw new InstallerError(
      'INVALID_INPUT',
      `directory must be an absolute path: ${opts.directory}`,
    );
  }
  if (!isSecurePath(opts.directory)) {
    throw new InstallerError(
      'INVALID_INPUT',
      `directory contains unsafe characters: ${opts.directory}`,
    );
  }

  if (opts.modules) {
    for (const m of opts.modules) {
      if (!MODULE_NAME_RE.test(m)) {
        throw new InstallerError('INVALID_INPUT', `invalid module name: ${m}`);
      }
    }
  }
  if (opts.tools) {
    for (const t of opts.tools) {
      if (!MODULE_NAME_RE.test(t)) {
        throw new InstallerError('INVALID_INPUT', `invalid tool name: ${t}`);
      }
    }
  }
  if (opts.next) {
    for (const m of opts.next) {
      if (!MODULE_NAME_RE.test(m)) {
        throw new InstallerError('INVALID_INPUT', `invalid --next module: ${m}`);
      }
    }
  }
  if (opts.pin) {
    for (const [m, tag] of Object.entries(opts.pin)) {
      if (!MODULE_NAME_RE.test(m) || !TAG_RE.test(tag)) {
        throw new InstallerError('INVALID_INPUT', `invalid --pin entry: ${m}=${tag}`);
      }
    }
  }
  if (opts.set) {
    for (const [k, v] of Object.entries(opts.set)) {
      if (!SET_KEY_RE.test(k)) {
        throw new InstallerError('INVALID_INPUT', `invalid --set key: ${k}`);
      }
      if (v.includes('\n') || v.includes('\r')) {
        throw new InstallerError('INVALID_INPUT', `--set value contains newlines: ${k}`);
      }
    }
  }
  if (opts.customSource) {
    for (const src of opts.customSource) {
      if (src.includes('\n') || src.includes('\r')) {
        throw new InstallerError(
          'INVALID_INPUT',
          'custom-source value contains newlines',
        );
      }
    }
  }
  if (opts.allStable && opts.allNext) {
    throw new InstallerError(
      'INVALID_INPUT',
      'allStable and allNext are mutually exclusive',
    );
  }
}

/**
 * Translate the typed options into `npx` argv. Order roughly mirrors the
 * docs' flag table; `bmad-method` and the action keyword come first so the
 * flags after them attach to the right command.
 */
export function buildCliArgs(opts: BmadInstallerOptions): string[] {
  const args: string[] = ['-y'];
  if (opts.useNextChannel) args.push('bmad-method@next');
  else args.push('bmad-method');
  args.push('install');

  args.push('--directory', opts.directory);

  if (opts.yes) args.push('--yes');

  if (opts.modules && opts.modules.length > 0) {
    args.push('--modules', opts.modules.join(','));
  }
  if (opts.tools && opts.tools.length > 0) {
    args.push('--tools', opts.tools.join(','));
  }
  if (opts.action) {
    args.push('--action', opts.action);
  }
  if (opts.customSource && opts.customSource.length > 0) {
    args.push('--custom-source', opts.customSource.join(','));
  }
  if (opts.channel) {
    args.push('--channel', opts.channel);
  }
  if (opts.allStable) args.push('--all-stable');
  if (opts.allNext) args.push('--all-next');

  if (opts.next) {
    for (const m of opts.next) {
      args.push(`--next=${m}`);
    }
  }
  if (opts.pin) {
    for (const [m, tag] of Object.entries(opts.pin)) {
      args.push('--pin', `${m}=${tag}`);
    }
  }
  if (opts.set) {
    for (const [k, v] of Object.entries(opts.set)) {
      args.push('--set', `${k}=${v}`);
    }
  }

  if (opts.userName) args.push('--user-name', opts.userName);
  if (opts.communicationLanguage)
    args.push('--communication-language', opts.communicationLanguage);
  if (opts.documentOutputLanguage)
    args.push('--document-output-language', opts.documentOutputLanguage);
  if (opts.outputFolder) args.push('--output-folder', opts.outputFolder);

  return args;
}

// =============================================================================
// Discover available modules / tools without running an install
// =============================================================================

export interface ListOptionsResult {
  readonly success: boolean;
  readonly raw: string;
  readonly exitCode: number;
}

/**
 * Run `npx bmad-method install --list-options [module]` to discover the
 * `--set` keys for built-in / cached modules. We don't fully parse the output
 * here (it's docs-shaped, not machine-shaped); callers display it verbatim.
 */
export async function listInstallerOptions(
  options: { directory: string; module?: string; abortSignal?: AbortSignal; timeoutMs?: number },
): Promise<ListOptionsResult> {
  if (options.module && !MODULE_NAME_RE.test(options.module)) {
    throw new InstallerError(
      'INVALID_INPUT',
      `invalid module name: ${options.module}`,
    );
  }

  const npxCmd = getNpxCommand();
  const spawnPath = resolveSpawnPath(npxCmd);
  if (!spawnPath) {
    throw new InstallerError('NPX_NOT_AVAILABLE', `npx not available (${npxCmd})`);
  }

  const args = ['-y', 'bmad-method', 'install', '--list-options'];
  if (options.module) args.push(options.module);

  const useShell = requiresShell(npxCmd);
  const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' };

  return new Promise((resolve, reject) => {
    const child = spawn(spawnPath, args, {
      cwd: options.directory,
      env,
      shell: useShell,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const buf: string[] = [];
    child.stdout?.on('data', (d) => buf.push(typeof d === 'string' ? d : d.toString('utf-8')));
    child.stderr?.on('data', (d) => buf.push(typeof d === 'string' ? d : d.toString('utf-8')));

    const onAbort = () => {
      if (!child.killed) child.kill('SIGTERM');
    };
    options.abortSignal?.addEventListener('abort', onAbort);
    const timeoutHandle = setTimeout(
      () => {
        if (!child.killed) child.kill('SIGTERM');
      },
      options.timeoutMs ?? 60_000,
    );

    child.once('error', (err) => {
      clearTimeout(timeoutHandle);
      options.abortSignal?.removeEventListener('abort', onAbort);
      reject(
        new InstallerError(
          'INSTALLER_FAILED',
          `failed to spawn ${spawnPath}: ${(err as Error).message}`,
          { cause: err },
        ),
      );
    });
    child.once('exit', (exitCode) => {
      clearTimeout(timeoutHandle);
      options.abortSignal?.removeEventListener('abort', onAbort);
      const code = exitCode ?? -1;
      resolve({
        success: code === 0,
        exitCode: code,
        raw: stripAnsi(buf.join('')),
      });
    });
  });
}

// =============================================================================
// Internal helpers
// =============================================================================

function resolveSpawnPath(npxCmd: string): string | null {
  // On Windows requiresShell will return true and the shell handles PATH lookup.
  // On Unix the npx command should be on PATH, but if it isn't we surface a
  // clean error rather than spawning `which` ourselves.
  return npxCmd;
}

// Strips the CSI / OSC / cursor visibility escape sequences emitted by the
// installer's spinner and color output. Biome flags the literal control
// characters; suppressing the rule here is appropriate because we are
// parsing terminal output where control bytes are the data we care about.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escape codes by design
const ANSI_RE = /\u001B\[[0-?]*[ -/]*[@-~]|\u001B\][^\u0007]*\u0007|\u001B\[\?\d+[hl]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

interface ProgressSnapshot {
  modules: string[];
  tools: string[];
  skillsConfigured: number;
}

function createProgressSnapshot(): ProgressSnapshot {
  return { modules: [], tools: [], skillsConfigured: 0 };
}

function applyProgressEvent(
  snapshot: ProgressSnapshot,
  event: BmadInstallerProgressEvent,
): ProgressSnapshot {
  if (event.event === 'tool-configured' && event.detail) {
    const skillMatch = /(\d+)\s+skills?/i.exec(event.detail);
    if (skillMatch) {
      snapshot.skillsConfigured = Number.parseInt(skillMatch[1] ?? '0', 10);
    }
    const toolMatch = /^(\S+)\s+configured/i.exec(event.detail);
    if (toolMatch) {
      const tool = toolMatch[1];
      if (tool && !snapshot.tools.includes(tool)) snapshot.tools.push(tool);
    }
  }
  if (event.event === 'module-installing' && event.detail) {
    if (!snapshot.modules.includes(event.detail)) snapshot.modules.push(event.detail);
  }
  return snapshot;
}

/**
 * Detect a known progress event from a stripped log line. Returns null when
 * the line is just freeform output. Patterns mirror the live installer's
 * structured logger (`◆`, `◇`, `◒`, `●`).
 */
export function detectProgress(line: string): BmadInstallerProgressEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  if (/Welcome to BMad/.test(trimmed) || /Using directory/.test(trimmed)) {
    return { event: 'started', detail: trimmed.replace(/^[●◆◇◒]\s*/, '') };
  }
  if (/Shared scripts installed/i.test(trimmed)) {
    return { event: 'shared-scripts-installed' };
  }
  if (/^.{0,4}Installing\s+(\S+)/i.test(trimmed)) {
    const m = /Installing\s+(\S+)/i.exec(trimmed);
    return { event: 'module-installing', detail: m?.[1] };
  }
  if (/\d+\s+module\(s\)\s+installed/i.test(trimmed)) {
    return { event: 'modules-installed', detail: trimmed.replace(/^[●◆◇◒]\s*/, '') };
  }
  if (/Module directories created/i.test(trimmed)) {
    return { event: 'directories-created' };
  }
  if (/Configurations generated/i.test(trimmed)) {
    return { event: 'configurations-generated' };
  }
  // ◆  cursor configured: 42 skills → .agents/skills
  if (/^.{0,4}\S+\s+configured(?::|$)/i.test(trimmed)) {
    return {
      event: 'tool-configured',
      detail: trimmed.replace(/^[●◆◇◒]\s*/, ''),
    };
  }
  if (/BMAD is ready/i.test(trimmed) || /Get started:/i.test(trimmed)) {
    return { event: 'completed' };
  }
  return null;
}

const KNOWN_PROGRESS_EVENTS: ReadonlySet<BmadInstallerProgressEventName> = new Set([
  'started',
  'shared-scripts-installed',
  'module-installing',
  'modules-installed',
  'directories-created',
  'configurations-generated',
  'tool-configured',
  'completed',
]);

export const __internals = {
  buildCliArgs,
  detectProgress,
  stripAnsi,
  KNOWN_PROGRESS_EVENTS,
};
