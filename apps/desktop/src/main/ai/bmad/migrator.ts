/**
 * BMad brownfield migrator
 * ========================
 *
 * One-shot migration for existing Aperant projects that still have
 * legacy `.auto-claude/specs` data. Per BMAD docs § "Existing Projects" +
 * § "Step 2: Create Project Context", the migrator treats old specs as
 * brownfield context: preserve the original, seed BMAD planning artifacts,
 * and create a sprint-status.yaml that users can review before running BMAD
 * workflows.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { BmadDevelopmentStatus, BmadSprintStatus } from '../../../shared/types/bmad';
import { writeFileWithRetry } from '../../utils/atomic-file';
import { writeSprintStatus } from './sprint-status';

export interface BmadMigrationCandidate {
  readonly id: string;
  readonly title: string;
  readonly sourceDir: string;
  readonly hasSpec: boolean;
  readonly hasImplementationPlan: boolean;
  readonly hasRequirements: boolean;
}

export interface BmadMigrationPlan {
  readonly projectRoot: string;
  readonly hasLegacySpecs: boolean;
  readonly specsDir: string;
  readonly backupDir: string;
  readonly candidates: readonly BmadMigrationCandidate[];
}

export interface BmadMigrationResult extends BmadMigrationPlan {
  readonly migrated: boolean;
  readonly planningFiles: readonly string[];
  readonly implementationFiles: readonly string[];
  readonly sprintStatusPath: string | null;
}

export class BmadMigratorError extends Error {
  readonly code:
    | 'PROJECT_NOT_FOUND'
    | 'MIGRATION_NOT_FOUND'
    | 'MIGRATION_BACKUP_FAILED'
    | 'MIGRATION_WRITE_FAILED'
    | 'IO_ERROR';
  readonly cause?: unknown;

  constructor(
    code: BmadMigratorError['code'],
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = 'BmadMigratorError';
    this.code = code;
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

export async function detectLegacySpecs(projectRoot: string): Promise<BmadMigrationPlan> {
  const root = path.resolve(projectRoot);
  if (!(await pathExists(root))) {
    throw new BmadMigratorError('PROJECT_NOT_FOUND', `project not found: ${root}`);
  }

  const specsDir = path.join(root, '.auto-claude', 'specs');
  const backupDir = path.join(root, '.auto-claude.backup');
  if (await pathExists(migrationMarkerPath(root))) {
    return {
      projectRoot: root,
      hasLegacySpecs: false,
      specsDir,
      backupDir,
      candidates: [],
    };
  }

  const entries = await safeReaddir(specsDir);
  const candidates: BmadMigrationCandidate[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sourceDir = path.join(specsDir, entry.name);
    candidates.push({
      id: entry.name,
      title: titleFromSpecId(entry.name),
      sourceDir,
      hasSpec: await pathExists(path.join(sourceDir, 'spec.md')),
      hasImplementationPlan: await pathExists(path.join(sourceDir, 'implementation_plan.json')),
      hasRequirements: await pathExists(path.join(sourceDir, 'requirements.json')),
    });
  }

  candidates.sort((a, b) => a.id.localeCompare(b.id));

  return {
    projectRoot: root,
    hasLegacySpecs: candidates.length > 0,
    specsDir,
    backupDir,
    candidates,
  };
}

export async function migrateLegacySpecs(projectRoot: string): Promise<BmadMigrationResult> {
  const plan = await detectLegacySpecs(projectRoot);
  if (!plan.hasLegacySpecs) {
    return {
      ...plan,
      migrated: false,
      planningFiles: [],
      implementationFiles: [],
      sprintStatusPath: null,
    };
  }

  try {
    await backupLegacyAutoClaude(plan.projectRoot);
  } catch (err) {
    throw new BmadMigratorError(
      'MIGRATION_BACKUP_FAILED',
      `failed to back up .auto-claude before migration: ${(err as Error).message}`,
      { cause: err },
    );
  }

  const planningDir = path.join(plan.projectRoot, '_bmad-output', 'planning-artifacts');
  const implementationDir = path.join(
    plan.projectRoot,
    '_bmad-output',
    'implementation-artifacts',
  );
  await fs.mkdir(planningDir, { recursive: true });
  await fs.mkdir(implementationDir, { recursive: true });

  const planningFiles: string[] = [];
  const implementationFiles: string[] = [];
  const developmentStatus: Record<string, BmadDevelopmentStatus> = {};

  for (const candidate of plan.candidates) {
    if (candidate.hasSpec) {
      const source = path.join(candidate.sourceDir, 'spec.md');
      const target = path.join(planningDir, `${candidate.id}-product-brief.md`);
      const raw = await fs.readFile(source, 'utf-8');
      await writeFileWithRetry(target, addMigrationHeader(candidate, raw), { encoding: 'utf-8' });
      planningFiles.push(relativePath(plan.projectRoot, target));
    }

    if (candidate.hasImplementationPlan) {
      const source = path.join(candidate.sourceDir, 'implementation_plan.json');
      const raw = await fs.readFile(source, 'utf-8');
      const stories = extractStories(raw, candidate);
      const epicKey = `epic-${candidate.id}`;
      developmentStatus[epicKey] = 'backlog';
      for (const story of stories) {
        developmentStatus[story.key] = story.status;
        const target = path.join(implementationDir, `${story.key}.md`);
        await writeFileWithRetry(target, story.markdown, { encoding: 'utf-8' });
        implementationFiles.push(relativePath(plan.projectRoot, target));
      }
    }
  }

  if (Object.keys(developmentStatus).length === 0) {
    for (const candidate of plan.candidates) {
      developmentStatus[`epic-${candidate.id}`] = 'backlog';
    }
  }

  const now = formatMigrationTimestamp(new Date());
  const status: BmadSprintStatus = {
    generated: now,
    lastUpdated: now,
    project: path.basename(plan.projectRoot),
    projectKey: projectKeyFromName(path.basename(plan.projectRoot)),
    trackingSystem: 'file-system',
    storyLocation: '_bmad-output/implementation-artifacts',
    developmentStatus,
  };

  await writeSprintStatus({ projectRoot: plan.projectRoot, status });
  await writeMigrationMarker(plan.projectRoot, {
    migratedAt: new Date().toISOString(),
    candidates: plan.candidates.map((candidate) => candidate.id),
    planningFiles,
    implementationFiles,
  });

  return {
    ...plan,
    migrated: true,
    planningFiles,
    implementationFiles,
    sprintStatusPath: relativePath(
      plan.projectRoot,
      path.join(implementationDir, 'sprint-status.yaml'),
    ),
  };
}

async function backupLegacyAutoClaude(projectRoot: string): Promise<void> {
  const source = path.join(projectRoot, '.auto-claude');
  const backup = path.join(projectRoot, '.auto-claude.backup');
  if (!(await pathExists(source))) return;
  await fs.rm(backup, { recursive: true, force: true });
  await fs.cp(source, backup, { recursive: true });
}

async function writeMigrationMarker(
  projectRoot: string,
  payload: {
    readonly migratedAt: string;
    readonly candidates: readonly string[];
    readonly planningFiles: readonly string[];
    readonly implementationFiles: readonly string[];
  },
): Promise<void> {
  const marker = migrationMarkerPath(projectRoot);
  await fs.mkdir(path.dirname(marker), { recursive: true });
  await writeFileWithRetry(marker, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: 'utf-8',
  });
}

function migrationMarkerPath(projectRoot: string): string {
  return path.join(projectRoot, '.auto-claude', '.bmad-migration-complete.json');
}

async function safeReaddir(dir: string): Promise<import('node:fs').Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new BmadMigratorError(
      'IO_ERROR',
      `failed to read legacy specs directory: ${(err as Error).message}`,
      { cause: err },
    );
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function extractStories(
  rawJson: string,
  candidate: BmadMigrationCandidate,
): Array<{ key: string; status: BmadDevelopmentStatus; markdown: string }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return [
      {
        key: `${candidate.id}-1-manual-review`,
        status: 'backlog',
        markdown: storyMarkdown(candidate.title, 'Manual review', [
          'Review the legacy implementation plan JSON; it could not be parsed automatically.',
        ]),
      },
    ];
  }

  const tasks = collectTaskLikeObjects(parsed);
  if (tasks.length === 0) {
    return [
      {
        key: `${candidate.id}-1-review-plan`,
        status: 'backlog',
        markdown: storyMarkdown(candidate.title, 'Review migrated implementation plan', [
          'Read the migrated product brief and split it into BMAD stories.',
        ]),
      },
    ];
  }

  return tasks.slice(0, 50).map((task, index) => {
    const title = task.title || task.name || task.description || `Migrated task ${index + 1}`;
    const status = statusFromLegacy(task.status);
    return {
      key: `${candidate.id}-${index + 1}-${slugify(title)}`,
      status,
      markdown: storyMarkdown(candidate.title, title, [
        task.description,
        task.acceptanceCriteria,
        task.details,
      ].filter((v): v is string => typeof v === 'string' && v.trim().length > 0)),
    };
  });
}

function collectTaskLikeObjects(value: unknown): Array<Record<string, string>> {
  if (!value || typeof value !== 'object') return [];
  const out: Array<Record<string, string>> = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    const title = firstString(record, ['title', 'name', 'summary', 'description']);
    if (title) {
      out.push({
        title,
        ...(typeof record.description === 'string' ? { description: record.description } : {}),
        ...(typeof record.status === 'string' ? { status: record.status } : {}),
        ...(typeof record.acceptanceCriteria === 'string'
          ? { acceptanceCriteria: record.acceptanceCriteria }
          : {}),
        ...(typeof record.details === 'string' ? { details: record.details } : {}),
      });
    }
    for (const child of Object.values(record)) {
      if (typeof child === 'object' && child !== null) visit(child);
    }
  };
  visit(value);
  return dedupeByTitle(out);
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

function dedupeByTitle(tasks: Array<Record<string, string>>): Array<Record<string, string>> {
  const seen = new Set<string>();
  return tasks.filter((task) => {
    const key = (task.title ?? '').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function statusFromLegacy(status: string | undefined): BmadDevelopmentStatus {
  const normalized = status?.toLowerCase().replace(/[_\s]+/g, '-') ?? '';
  if (normalized.includes('done') || normalized.includes('complete')) return 'done';
  if (normalized.includes('review') || normalized.includes('qa')) return 'review';
  if (normalized.includes('progress') || normalized.includes('coding')) return 'in-progress';
  if (normalized.includes('ready')) return 'ready-for-dev';
  return 'backlog';
}

function addMigrationHeader(candidate: BmadMigrationCandidate, body: string): string {
  return [
    `# Migrated Product Brief: ${candidate.title}`,
    '',
    '> Migrated from `.auto-claude/specs/` for manual BMAD review.',
    '> Run `bmad-generate-project-context` for brownfield context before continuing.',
    '',
    body.trim(),
    '',
  ].join('\n');
}

function storyMarkdown(epicTitle: string, storyTitle: string, notes: readonly string[]): string {
  return [
    `# ${storyTitle}`,
    '',
    `Epic: ${epicTitle}`,
    '',
    '## Story',
    '',
    notes.length > 0 ? notes.join('\n\n') : 'Review this migrated story and refine it with BMAD.',
    '',
    '## Acceptance Criteria',
    '',
    '- [ ] Reviewed and accepted after BMAD migration',
    '',
  ].join('\n');
}

function titleFromSpecId(id: string): string {
  return id.replace(/^\d+[-_]?/, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'story';
}

function projectKeyFromName(name: string): string {
  const letters = name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6);
  return letters || 'BMAD';
}

function relativePath(projectRoot: string, target: string): string {
  return path.relative(projectRoot, target).split(path.sep).join('/');
}

function formatMigrationTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
