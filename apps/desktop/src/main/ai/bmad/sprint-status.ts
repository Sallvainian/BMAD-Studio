/**
 * BMad sprint-status reader/writer
 * ================================
 *
 * Atomic read/write for `_bmad-output/implementation-artifacts/sprint-status.yaml` —
 * the single source of truth for kanban state per ENGINE_SWAP_PROMPT.md KAD-8.
 *
 * Schema sourced from the canonical template at
 * `~/Projects/BMAD-Install-Files/.agents/skills/bmad-sprint-planning/sprint-status-template.yaml`.
 * The Zod schema in `BmadSprintStatusSchema` (see `src/shared/types/bmad.ts`)
 * accepts a slightly wider status union (`BMAD_DEVELOPMENT_STATUSES`) than the
 * Kanban's 5-column shape so retro lanes (`optional` / `done`) and epic-level
 * statuses (`backlog` / `in-progress` / `done`) coexist with story statuses.
 *
 * Atomic writes via `writeFileWithRetry` from
 * `apps/desktop/src/main/utils/atomic-file.ts`: write a temp file, fsync,
 * rename. The watcher's `awaitWriteFinish` debouncing + the temp-file ignore
 * filter mean drag-and-drop interactions in Phase 3 produce exactly one
 * `sprint-status-changed` event per logical write.
 *
 * Per ENGINE_SWAP_PROMPT.md `<engineering_standards>` "Crash-safe writes":
 * partial reads from the renderer side never see a half-written YAML —
 * either the old or the new file is visible at any instant.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { JSON_SCHEMA, dump as dumpYaml, load as parseYaml } from 'js-yaml';

import {
  BmadSprintStatusSchema,
  type BmadDevelopmentStatus,
  type BmadSprintStatus,
} from '../../../shared/types/bmad';
import { writeFileWithRetry } from '../../utils/atomic-file';

// =============================================================================
// Errors
// =============================================================================

export class SprintStatusError extends Error {
  readonly code:
    | 'SPRINT_STATUS_NOT_FOUND'
    | 'YAML_PARSE_ERROR'
    | 'SPRINT_STATUS_VALIDATION_ERROR'
    | 'SPRINT_STATUS_WRITE_FAILED'
    | 'IO_ERROR'
    | 'INVALID_INPUT';
  readonly cause?: unknown;
  readonly details?: unknown;

  constructor(
    code: SprintStatusError['code'],
    message: string,
    options?: { cause?: unknown; details?: unknown },
  ) {
    super(message);
    this.name = 'SprintStatusError';
    this.code = code;
    if (options?.cause !== undefined) this.cause = options.cause;
    if (options?.details !== undefined) this.details = options.details;
  }
}

// =============================================================================
// Path helpers
// =============================================================================

/**
 * Canonical sprint-status.yaml location for a project.
 *   `{projectRoot}/_bmad-output/implementation-artifacts/sprint-status.yaml`
 *
 * Per BMAD docs § "What got installed" — `_bmad-output/` is BMAD's standard
 * output directory; `implementation-artifacts/` is created by `bmad-sprint-planning`.
 */
export function getSprintStatusPath(projectRoot: string): string {
  return path.join(
    path.resolve(projectRoot),
    '_bmad-output',
    'implementation-artifacts',
    'sprint-status.yaml',
  );
}

// =============================================================================
// Public API — read
// =============================================================================

export interface ReadSprintStatusOptions {
  readonly projectRoot: string;
  /**
   * If true, return null when the file is missing instead of throwing
   * `SPRINT_STATUS_NOT_FOUND`. Useful for the kanban which renders a
   * skeleton state before the workflow has been invoked.
   */
  readonly tolerateMissing?: boolean;
}

/**
 * Read + validate `sprint-status.yaml`. The YAML emitted by the
 * `bmad-sprint-planning` skill uses `key: value` mapping for
 * `development_status`; we coerce the snake_case YAML keys to camelCase
 * TypeScript fields via `normalizeRawYaml`.
 */
export async function readSprintStatus(
  options: ReadSprintStatusOptions,
): Promise<BmadSprintStatus | null> {
  const filePath = getSprintStatusPath(options.projectRoot);

  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      if (options.tolerateMissing) return null;
      throw new SprintStatusError(
        'SPRINT_STATUS_NOT_FOUND',
        `sprint-status.yaml not found at ${filePath}`,
      );
    }
    throw new SprintStatusError(
      'IO_ERROR',
      `failed to read sprint-status.yaml: ${(err as Error).message}`,
      { cause: err },
    );
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw, { schema: JSON_SCHEMA });
  } catch (err) {
    throw new SprintStatusError(
      'YAML_PARSE_ERROR',
      `failed to parse sprint-status.yaml: ${(err as Error).message}`,
      { cause: err },
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SprintStatusError(
      'SPRINT_STATUS_VALIDATION_ERROR',
      'sprint-status.yaml root is not a mapping',
    );
  }

  const normalized = normalizeRawYaml(parsed as Record<string, unknown>);
  const result = BmadSprintStatusSchema.safeParse(normalized);
  if (!result.success) {
    throw new SprintStatusError(
      'SPRINT_STATUS_VALIDATION_ERROR',
      'sprint-status.yaml failed schema validation',
      { details: result.error.issues },
    );
  }
  return result.data;
}

// =============================================================================
// Public API — write
// =============================================================================

export interface WriteSprintStatusOptions {
  readonly projectRoot: string;
  readonly status: BmadSprintStatus;
  /** Optional event emitter to fire `sprint-status-written` after the rename. */
  readonly emitter?: SprintStatusEmitter;
}

/**
 * Atomic write. Validates the input against the schema, serializes to YAML
 * with the same `STATUS DEFINITIONS` comment block the template uses, and
 * uses `writeFileWithRetry` (atomic temp+rename) so the watcher fires
 * exactly once.
 *
 * Per BMAD docs § "What got installed" file layout: writes to
 * `_bmad-output/implementation-artifacts/sprint-status.yaml`. Creates the
 * parent directory if missing (greenfield project hasn't run sprint-planning).
 */
export async function writeSprintStatus(options: WriteSprintStatusOptions): Promise<void> {
  const { projectRoot, status, emitter } = options;

  const validation = BmadSprintStatusSchema.safeParse(status);
  if (!validation.success) {
    throw new SprintStatusError(
      'INVALID_INPUT',
      'sprint-status payload failed schema validation',
      { details: validation.error.issues },
    );
  }

  const filePath = getSprintStatusPath(projectRoot);
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  const yaml = serializeSprintStatus(validation.data);

  try {
    await writeFileWithRetry(filePath, yaml, { encoding: 'utf-8' });
  } catch (err) {
    throw new SprintStatusError(
      'SPRINT_STATUS_WRITE_FAILED',
      `failed to write sprint-status.yaml: ${(err as Error).message}`,
      { cause: err },
    );
  }

  emitter?.emit('sprint-status-written', { projectRoot, filePath, status: validation.data });
}

// =============================================================================
// Update helpers — common kanban operations
// =============================================================================

/**
 * Update a single story / epic status. Loads, mutates, writes atomically.
 * Throws `INVALID_INPUT` if the key is missing from `developmentStatus`
 * (don't silently add new entries — the kanban operates on existing rows).
 */
export async function updateStoryStatus(options: {
  readonly projectRoot: string;
  readonly storyKey: string;
  readonly status: BmadDevelopmentStatus;
  readonly now?: Date;
  readonly emitter?: SprintStatusEmitter;
}): Promise<BmadSprintStatus> {
  const current = await readSprintStatus({ projectRoot: options.projectRoot });
  if (!current) {
    throw new SprintStatusError(
      'SPRINT_STATUS_NOT_FOUND',
      `cannot update '${options.storyKey}' — sprint-status.yaml does not exist`,
    );
  }

  if (!Object.hasOwn(current.developmentStatus, options.storyKey)) {
    throw new SprintStatusError(
      'INVALID_INPUT',
      `story key '${options.storyKey}' not found in development_status`,
    );
  }

  const next: BmadSprintStatus = {
    ...current,
    lastUpdated: formatTimestamp(options.now ?? new Date()),
    developmentStatus: {
      ...current.developmentStatus,
      [options.storyKey]: options.status,
    },
  };

  await writeSprintStatus({
    projectRoot: options.projectRoot,
    status: next,
    emitter: options.emitter,
  });
  return next;
}

// =============================================================================
// EventEmitter wrapper
// =============================================================================

export interface SprintStatusWriteEvent {
  readonly projectRoot: string;
  readonly filePath: string;
  readonly status: BmadSprintStatus;
}

export interface SprintStatusEmitter {
  on(
    event: 'sprint-status-written',
    listener: (e: SprintStatusWriteEvent) => void,
  ): SprintStatusEmitter;
  off(
    event: 'sprint-status-written',
    listener: (e: SprintStatusWriteEvent) => void,
  ): SprintStatusEmitter;
  emit(event: 'sprint-status-written', payload: SprintStatusWriteEvent): boolean;
}

/**
 * Construct an `EventEmitter` typed for sprint-status writes. The IPC handler
 * uses one emitter per project; the watcher reuses the file-watcher's
 * `sprint-status-changed` event for external file edits.
 */
export function createSprintStatusEmitter(): SprintStatusEmitter {
  const emitter = new EventEmitter();
  return {
    on(event, listener) {
      emitter.on(event, listener);
      return this;
    },
    off(event, listener) {
      emitter.off(event, listener);
      return this;
    },
    emit(event, payload) {
      return emitter.emit(event, payload);
    },
  };
}

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * Coerce the raw YAML object into the camelCase shape the Zod schema
 * expects. The on-disk file uses `last_updated`, `project_key`,
 * `tracking_system`, `story_location`, `development_status`.
 */
function normalizeRawYaml(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    generated: stringField(raw, 'generated'),
    lastUpdated: stringField(raw, 'last_updated', 'lastUpdated'),
    project: stringField(raw, 'project'),
    projectKey: stringField(raw, 'project_key', 'projectKey'),
    trackingSystem: stringField(raw, 'tracking_system', 'trackingSystem'),
    storyLocation: stringField(raw, 'story_location', 'storyLocation'),
    developmentStatus: raw.development_status ?? raw.developmentStatus ?? {},
  };
  return out;
}

function stringField(
  raw: Record<string, unknown>,
  snakeKey: string,
  camelKey?: string,
): string {
  const candidates = [snakeKey, camelKey].filter((k): k is string => Boolean(k));
  for (const k of candidates) {
    const v = raw[k];
    if (typeof v === 'string') return v;
  }
  return '';
}

/**
 * Serialize back to YAML with the canonical comment block + ordering. The
 * comment block at the top is the `STATUS DEFINITIONS` section from the
 * BMAD template — preserved on every write so external editors see the
 * legend even if the file was emitted by us.
 */
function serializeSprintStatus(status: BmadSprintStatus): string {
  const HEADER = `# Sprint Status
# Managed by BMad Studio + bmad-sprint-planning skill.
#
# STATUS DEFINITIONS:
# ==================
# Epic Status:
#   - backlog: Epic not yet started
#   - in-progress: Epic actively being worked on
#   - done: All stories in epic completed
#
# Story Status:
#   - backlog: Story only exists in epic file
#   - ready-for-dev: Story file created, ready for development
#   - in-progress: Developer actively working on implementation
#   - review: Implementation complete, ready for review
#   - done: Story completed
#
# Retrospective Status:
#   - optional: Can be completed but not required
#   - done: Retrospective has been completed
#
`;

  const body = dumpYaml(
    {
      generated: status.generated,
      last_updated: status.lastUpdated,
      project: status.project,
      project_key: status.projectKey,
      tracking_system: status.trackingSystem,
      story_location: status.storyLocation,
      development_status: status.developmentStatus,
    },
    {
      schema: JSON_SCHEMA,
      lineWidth: 120,
      noRefs: true,
      sortKeys: false,
    },
  );

  return `${HEADER}\n${body}`;
}

/**
 * Format a Date as `MM-DD-YYYY HH:MM` to match the BMAD template's
 * `last_updated` field shape (`05-06-2-2025 21:30` is what the template
 * uses; we standardize on the more conventional `MM-DD-YYYY HH:MM`).
 *
 * This is informational — the schema accepts any string here.
 */
function formatTimestamp(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    `${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${date.getFullYear()} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

// =============================================================================
// Test internals
// =============================================================================

export const __internals = {
  normalizeRawYaml,
  serializeSprintStatus,
  formatTimestamp,
};
