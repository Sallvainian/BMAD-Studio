/**
 * BMad Studio IPC handlers
 * ========================
 *
 * Surface the Phase 1 BMad subsystem (`apps/desktop/src/main/ai/bmad/`) over
 * IPC. Every handler:
 *   - validates inputs with Zod
 *   - returns the BMAD-specific structured-error envelope
 *     (`{ success: true, data } | { success: false, error: { code, message, details } }`)
 *   - drops Sentry breadcrumbs around external CLI invocations (per
 *     ENGINE_SWAP_PROMPT.md `<engineering_standards>` "Error handling")
 *   - never lets a thrown exception escape (raw stack traces would land in
 *     the renderer)
 *
 * Per D-007: we use `success`/`data`/`error` to match Aperant's existing
 * `IPCResult<T>` envelope verb but elevate `error` from string → structured
 * `{ code, message, details }`. New BMAD handlers return `BmadIpcResult<T>`
 * from `apps/desktop/src/shared/types/bmad.ts`; existing handlers keep
 * `IPCResult<T>`.
 */

import { ipcMain, type BrowserWindow } from 'electron';
import { z } from 'zod';

import { IPC_CHANNELS } from '../../shared/constants/ipc';
import { appLog } from '../app-logger';
import { safeBreadcrumb } from '../sentry';
import { writeFileWithRetry } from '../utils/atomic-file';
import { stringify as stringifyToml } from 'smol-toml';
import { JSON_SCHEMA, load as parseYaml } from 'js-yaml';
import { existsSync, promises as fsPromises } from 'node:fs';
import path from 'node:path';

import {
  bmadFail,
  bmadOk,
  BMAD_CUSTOMIZATION_SCOPES,
  BMAD_DEVELOPMENT_STATUSES,
  BMAD_PERSONA_SLUGS,
  BMAD_TRACKS,
  type BmadHelpRecommendation,
  type BmadIpcResult,
  type BmadModule,
  type BmadOrchestratorEvent,
  type BmadPersonaIdentity,
  type BmadPersonaSlug,
  type BmadPhaseGraph,
  type BmadProjectSummary,
  type BmadSkill,
  type BmadSkillManifestEntry,
  type BmadSprintStatus,
  type BmadVariableContext,
  type BmadWorkflowDescriptor,
  type BmadWorkflowMenu,
  type BmadWorkflowResult,
  type BmadWorkflowStep,
  type BmadWorkflowStreamChunk,
  type BmadWorkflowUserChoice,
} from '../../shared/types/bmad';

import {
  isBmadProject,
  loadAllManifests,
  loadManifest,
  loadSkillManifest,
  ManifestLoadError,
} from '../ai/bmad/manifest-loader';
import {
  getPhaseGraph,
  listAllWorkflows,
  listInstalledModules,
} from '../ai/bmad/module-registry';
import {
  getSharedSkillRegistry,
  personaSlugForSkillId,
  SkillRegistry,
  SkillRegistryError,
} from '../ai/bmad/skill-registry';
import {
  resolveCustomization,
  CustomizationResolverError,
} from '../ai/bmad/customization-resolver';
import {
  InstallerError,
  listInstallerOptions,
  runInstaller,
} from '../ai/bmad/installer';
import {
  startBmadFileWatcher,
  type BmadFileWatcherHandle,
} from '../ai/bmad/file-watcher';
import { loadAllPersonas, loadPersona, PersonaError } from '../ai/bmad/persona';
import { buildVariableContext, VariableSubstitutionError } from '../ai/bmad/variables';
import { loadStepByName, StepLoaderError } from '../ai/bmad/step-loader';
import {
  readSprintStatus,
  SprintStatusError,
  updateStoryStatus,
  writeSprintStatus,
} from '../ai/bmad/sprint-status';
import {
  computeOrchestratorState,
  createOrchestratorEmitter,
  OrchestratorError,
} from '../ai/bmad/orchestrator';
import { runHelpAI, runHelpSync, HelpRunnerError } from '../ai/bmad/help-runner';
import { runWorkflow, WorkflowRunnerError } from '../ai/bmad/workflow-runner';
import type { ClaudeProfile } from '../../shared/types/agent';
import { randomUUID } from 'node:crypto';

// =============================================================================
// Input schemas
// =============================================================================

const ProjectRootInput = z.object({ projectRoot: z.string().min(1) });

const SkillInput = z.object({
  projectRoot: z.string().min(1),
  skillId: z.string().min(1),
});

const ReadCustomizationInput = z.object({
  projectRoot: z.string().min(1),
  skillId: z.string().min(1),
});

const WriteCustomizationInput = z.object({
  projectRoot: z.string().min(1),
  skillId: z.string().min(1),
  scope: z.enum(BMAD_CUSTOMIZATION_SCOPES),
  data: z.record(z.string(), z.unknown()),
});

const ReadStoryFileInput = z.object({
  projectRoot: z.string().min(1),
  storyPath: z.string().min(1),
});

const WriteStoryFileInput = z.object({
  projectRoot: z.string().min(1),
  storyPath: z.string().min(1),
  contents: z.string(),
});

const RunInstallerInput = z.object({
  args: z.object({
    directory: z.string().min(1),
    yes: z.boolean().optional(),
    modules: z.array(z.string()).optional(),
    tools: z.array(z.string()).optional(),
    action: z.enum(['install', 'update', 'quick-update']).optional(),
    customSource: z.array(z.string()).optional(),
    channel: z.enum(['stable', 'next', 'pinned']).optional(),
    allStable: z.boolean().optional(),
    allNext: z.boolean().optional(),
    next: z.array(z.string()).optional(),
    pin: z.record(z.string(), z.string()).optional(),
    set: z.record(z.string(), z.string()).optional(),
    userName: z.string().optional(),
    communicationLanguage: z.string().optional(),
    documentOutputLanguage: z.string().optional(),
    outputFolder: z.string().optional(),
    githubToken: z.string().optional(),
    useNextChannel: z.boolean().optional(),
  }),
});

const ListInstallerOptionsInput = z.object({
  directory: z.string().min(1),
  module: z.string().optional(),
});

const WatcherStartInput = z.object({
  projectRoot: z.string().min(1),
  debounceMs: z.number().int().positive().optional(),
  usePolling: z.boolean().optional(),
});

// ─── Phase 2 input schemas ─────────────────────────────────────────────────

const LoadPersonaInput = z.object({
  projectRoot: z.string().min(1),
  slug: z.enum(BMAD_PERSONA_SLUGS),
});

const VariableContextInput = z.object({
  projectRoot: z.string().min(1),
  skillDir: z.string().min(1),
  skillName: z.string().min(1).optional(),
  module: z.string().min(1).optional(),
});

const LoadStepInput = z.object({
  projectRoot: z.string().min(1),
  skillId: z.string().min(1),
  stepFileName: z.string().min(1),
  outputFilePath: z.string().min(1).optional(),
});

const WriteSprintStatusInput = z.object({
  projectRoot: z.string().min(1),
  status: z.object({
    generated: z.string(),
    lastUpdated: z.string(),
    project: z.string(),
    projectKey: z.string(),
    trackingSystem: z.string(),
    storyLocation: z.string(),
    developmentStatus: z.record(z.string(), z.enum(BMAD_DEVELOPMENT_STATUSES)),
  }),
});

const UpdateStoryStatusInput = z.object({
  projectRoot: z.string().min(1),
  storyKey: z.string().min(1),
  status: z.enum(BMAD_DEVELOPMENT_STATUSES),
});

const TrackInput = z.object({
  projectRoot: z.string().min(1),
  track: z.enum(BMAD_TRACKS),
});

const RunHelpAIInput = z.object({
  projectRoot: z.string().min(1),
  track: z.enum(BMAD_TRACKS),
  question: z.string().optional(),
  invocationId: z.string().min(1).optional(),
  activeProfile: z.object({
    id: z.string().min(1),
  }).passthrough(),
});

const RunWorkflowInput = z.object({
  projectRoot: z.string().min(1),
  skillName: z.string().min(1),
  personaSlug: z.enum(BMAD_PERSONA_SLUGS).optional(),
  /**
   * Optional renderer-supplied invocation id. When omitted, a UUID is
   * generated server-side. Allowing the renderer to pass it lets the chat
   * UI route streamed chunks to a thread it created synchronously, rather
   * than waiting for the runWorkflow Promise to resolve at workflow end.
   * Per Phase 4 deliverable §1 (BmadPersonaChat must show streaming).
   */
  invocationId: z.string().min(1).optional(),
  activeProfile: z.object({
    id: z.string().min(1),
  }).passthrough(), // ClaudeProfile has many optional fields; we trust shape upstream.
  args: z.array(z.string()).optional(),
  maxTurns: z.number().int().positive().optional(),
  initialMessages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      }),
    )
    .optional(),
});

const MenuResponseInput = z.object({
  invocationId: z.string().min(1),
  menuId: z.string().min(1),
  choice: z.object({
    optionCode: z.string().optional(),
    text: z.string(),
  }),
});

// =============================================================================
// Watcher registry (one per project)
// =============================================================================

const activeWatchers = new Map<string, BmadFileWatcherHandle>();

function watcherKey(projectRoot: string): string {
  return path.resolve(projectRoot);
}

// =============================================================================
// Helpers
// =============================================================================

function validate<T>(
  schema: z.ZodType<T>,
  value: unknown,
): { ok: true; data: T } | { ok: false; result: BmadIpcResult<never> } {
  const parsed = schema.safeParse(value);
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    result: bmadFail(
      'INVALID_INPUT',
      'IPC payload failed schema validation',
      parsed.error.issues,
    ),
  };
}

function classifyError(err: unknown): BmadIpcResult<never> {
  if (err instanceof ManifestLoadError) {
    return bmadFail(err.code, err.message, err.details);
  }
  if (err instanceof CustomizationResolverError) {
    // Map any Customization* failure into TOML/IO categories. The resolver
    // class is generic; we only get here for parse / IO problems since the
    // structural merge is pure.
    return bmadFail('TOML_PARSE_ERROR', err.message, undefined);
  }
  if (err instanceof SkillRegistryError) {
    return bmadFail(err.code, err.message, err.details);
  }
  if (err instanceof InstallerError) {
    return bmadFail(err.code, err.message, err.details);
  }
  if (err instanceof PersonaError) {
    return bmadFail(err.code, err.message, err.details);
  }
  if (err instanceof VariableSubstitutionError) {
    return bmadFail(err.code, err.message, undefined);
  }
  if (err instanceof StepLoaderError) {
    return bmadFail(err.code, err.message, err.details);
  }
  if (err instanceof SprintStatusError) {
    return bmadFail(err.code, err.message, err.details);
  }
  if (err instanceof OrchestratorError) {
    return bmadFail(err.code === 'CONFIG_LOAD_FAILED' ? 'IO_ERROR' : err.code, err.message);
  }
  if (err instanceof HelpRunnerError) {
    return bmadFail(err.code === 'CONFIG_LOAD_FAILED' ? 'IO_ERROR' : err.code, err.message);
  }
  if (err instanceof WorkflowRunnerError) {
    const code = err.code === 'PERSONA_MISMATCH' ? 'INVALID_INPUT' : err.code;
    return bmadFail(code, err.message, err.details);
  }
  if (err instanceof Error) {
    appLog.error('[bmad-handlers] unhandled error:', err);
    return bmadFail('UNKNOWN', err.message);
  }
  appLog.error('[bmad-handlers] non-error throw:', err);
  return bmadFail('UNKNOWN', 'Non-Error value thrown', err);
}

// =============================================================================
// Phase 2 — pending menu request registry
// =============================================================================

interface PendingMenu {
  readonly menuId: string;
  readonly resolver: (choice: BmadWorkflowUserChoice) => void;
  readonly timeoutHandle: NodeJS.Timeout;
}

/**
 * Pending menu requests indexed by `${invocationId}::${menuId}`. The runner
 * registers a resolver here when `onMenu` fires; the renderer's
 * `BMAD_WORKFLOW_MENU_RESPONSE` handler retrieves and resolves it.
 *
 * Menus expire after 10 minutes by default — if the renderer never replies
 * (window closed, etc.) the runner aborts cleanly.
 */
const pendingMenus = new Map<string, PendingMenu>();
const MENU_RESPONSE_TIMEOUT_MS = 10 * 60 * 1000;

// =============================================================================
// registerBmadHandlers
// =============================================================================

export interface RegisterBmadHandlersDeps {
  readonly getMainWindow: () => BrowserWindow | null;
  /** Optional skill registry for testing; defaults to the shared singleton. */
  readonly skillRegistry?: SkillRegistry;
}

/**
 * Wire up every BMAD-related IPC channel. Idempotent: re-registration is a no-op
 * if `removeAllListeners` is called first by the caller (the central
 * `setupIpcHandlers` does this implicitly per its existing convention — handlers
 * are only registered once at app startup).
 */
export function registerBmadHandlers(deps: RegisterBmadHandlersDeps): void {
  const skillRegistry = deps.skillRegistry ?? getSharedSkillRegistry();

  // ───── Project detection ──────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.BMAD_DETECT_PROJECT,
    async (_e, payload): Promise<BmadIpcResult<BmadProjectSummary>> => {
      const v = validate(ProjectRootInput, payload);
      if (!v.ok) return v.result;
      try {
        const { projectRoot } = v.data;
        const manifest = await loadManifest(projectRoot);
        const skills = manifest ? await loadSkillManifest(projectRoot) : [];
        return bmadOk<BmadProjectSummary>({
          projectRoot,
          isBmadProject: manifest !== null,
          manifest,
          skillCount: skills.length,
          moduleCount: manifest?.modules.length ?? 0,
        });
      } catch (err) {
        return classifyError(err);
      }
    },
  );

  // ───── Module / workflow listing ──────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.BMAD_LIST_MODULES,
    async (_e, payload): Promise<BmadIpcResult<readonly BmadModule[]>> => {
      const v = validate(ProjectRootInput, payload);
      if (!v.ok) return v.result;
      try {
        const modules = await listInstalledModules(v.data.projectRoot);
        return bmadOk(modules);
      } catch (err) {
        return classifyError(err);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.BMAD_LIST_WORKFLOWS,
    async (
      _e,
      payload,
    ): Promise<BmadIpcResult<readonly BmadWorkflowDescriptor[]>> => {
      const v = validate(ProjectRootInput, payload);
      if (!v.ok) return v.result;
      try {
        const workflows = await listAllWorkflows(v.data.projectRoot);
        return bmadOk(workflows);
      } catch (err) {
        return classifyError(err);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.BMAD_GET_PHASE_GRAPH,
    async (_e, payload): Promise<BmadIpcResult<BmadPhaseGraph>> => {
      const v = validate(ProjectRootInput, payload);
      if (!v.ok) return v.result;
      try {
        const graph = await getPhaseGraph(v.data.projectRoot);
        return bmadOk(graph);
      } catch (err) {
        return classifyError(err);
      }
    },
  );

  // ───── Skills ─────────────────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.BMAD_LIST_SKILLS,
    async (
      _e,
      payload,
    ): Promise<BmadIpcResult<readonly BmadSkillManifestEntry[]>> => {
      const v = validate(ProjectRootInput, payload);
      if (!v.ok) return v.result;
      try {
        const entries = await loadSkillManifest(v.data.projectRoot);
        return bmadOk(entries);
      } catch (err) {
        return classifyError(err);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.BMAD_LOAD_SKILL,
    async (_e, payload): Promise<BmadIpcResult<BmadSkill>> => {
      const v = validate(SkillInput, payload);
      if (!v.ok) return v.result;
      try {
        const skill = await skillRegistry.load(v.data.skillId, {
          projectRoot: v.data.projectRoot,
        });
        return bmadOk(skill);
      } catch (err) {
        return classifyError(err);
      }
    },
  );

  // ───── Customization ──────────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.BMAD_READ_CUSTOMIZATION,
    async (_e, payload): Promise<BmadIpcResult<Record<string, unknown>>> => {
      const v = validate(ReadCustomizationInput, payload);
      if (!v.ok) return v.result;
      try {
        const skill = await skillRegistry.load(v.data.skillId, {
          projectRoot: v.data.projectRoot,
        });
        const merged = await resolveCustomization({
          skillDir: skill.skillDir,
          projectRoot: v.data.projectRoot,
        });
        return bmadOk(merged);
      } catch (err) {
        return classifyError(err);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.BMAD_WRITE_CUSTOMIZATION,
    async (_e, payload): Promise<BmadIpcResult<{ filePath: string }>> => {
      const v = validate(WriteCustomizationInput, payload);
      if (!v.ok) return v.result;
      try {
        // Path containment: refuse to write outside `_bmad/custom/`.
        const projectRoot = path.resolve(v.data.projectRoot);
        const fileName =
          v.data.scope === 'team'
            ? `${v.data.skillId}.toml`
            : `${v.data.skillId}.user.toml`;
        const target = path.resolve(projectRoot, '_bmad', 'custom', fileName);
        const customDir = path.resolve(projectRoot, '_bmad', 'custom');
        if (!target.startsWith(customDir + path.sep)) {
          return bmadFail(
            'PATH_OUT_OF_PROJECT',
            `refusing to write outside _bmad/custom/: ${target}`,
          );
        }

        const tomlText = stringifyToml(v.data.data);
        await writeFileWithRetry(target, tomlText, { encoding: 'utf-8' });
        // Invalidate any cached resolution for this skill.
        skillRegistry.invalidate(projectRoot, v.data.skillId);
        return bmadOk({ filePath: target });
      } catch (err) {
        return classifyError(err);
      }
    },
  );

  // ───── Sprint status / story files (read-only in Phase 1) ────────────────
  ipcMain.handle(
    IPC_CHANNELS.BMAD_READ_SPRINT_STATUS,
    async (_e, payload): Promise<BmadIpcResult<unknown>> => {
      const v = validate(ProjectRootInput, payload);
      if (!v.ok) return v.result;
      try {
        const filePath = path.join(
          path.resolve(v.data.projectRoot),
          '_bmad-output',
          'implementation-artifacts',
          'sprint-status.yaml',
        );
        if (!existsSync(filePath)) {
          return bmadFail(
            'IO_ERROR',
            `sprint-status.yaml not found at ${filePath}`,
          );
        }
        const raw = await fsPromises.readFile(filePath, 'utf-8');
        const parsed = parseYaml(raw, { schema: JSON_SCHEMA });
        return bmadOk(parsed);
      } catch (err) {
        return classifyError(err);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.BMAD_READ_STORY_FILE,
    async (
      _e,
      payload,
    ): Promise<BmadIpcResult<{ contents: string; absolutePath: string }>> => {
      const v = validate(ReadStoryFileInput, payload);
      if (!v.ok) return v.result;
      try {
        const projectRoot = path.resolve(v.data.projectRoot);
        const target = path.resolve(projectRoot, v.data.storyPath);
        // Path containment: must stay under the project's
        // _bmad-output/implementation-artifacts/ tree.
        const allowedDir = path.resolve(
          projectRoot,
          '_bmad-output',
          'implementation-artifacts',
        );
        if (!target.startsWith(allowedDir + path.sep)) {
          return bmadFail(
            'PATH_OUT_OF_PROJECT',
            `story file must live under _bmad-output/implementation-artifacts/: ${v.data.storyPath}`,
          );
        }
        if (!existsSync(target)) {
          return bmadFail('IO_ERROR', `story file not found: ${target}`);
        }
        const contents = await fsPromises.readFile(target, 'utf-8');
        return bmadOk({ contents, absolutePath: target });
      } catch (err) {
        return classifyError(err);
      }
    },
  );

  /**
   * Atomic story-file write. Used by the Phase 3 BmadStoryDetail panel when
   * the user toggles an acceptance-criteria checkbox. Path-contained to
   * `_bmad-output/implementation-artifacts/` (same envelope as the read
   * handler). Atomic via `writeFileWithRetry` so chokidar fires exactly
   * one `story-file-changed` event per logical save.
   */
  ipcMain.handle(
    IPC_CHANNELS.BMAD_WRITE_STORY_FILE,
    async (
      _e,
      payload,
    ): Promise<BmadIpcResult<{ absolutePath: string }>> => {
      const v = validate(WriteStoryFileInput, payload);
      if (!v.ok) return v.result;
      try {
        const projectRoot = path.resolve(v.data.projectRoot);
        const target = path.resolve(projectRoot, v.data.storyPath);
        const allowedDir = path.resolve(
          projectRoot,
          '_bmad-output',
          'implementation-artifacts',
        );
        if (!target.startsWith(allowedDir + path.sep)) {
          return bmadFail(
            'PATH_OUT_OF_PROJECT',
            `story file must live under _bmad-output/implementation-artifacts/: ${v.data.storyPath}`,
          );
        }
        await fsPromises.mkdir(path.dirname(target), { recursive: true });
        await writeFileWithRetry(target, v.data.contents, { encoding: 'utf-8' });
        return bmadOk({ absolutePath: target });
      } catch (err) {
        return classifyError(err);
      }
    },
  );

  /**
   * Phase 3: enumerate every `*.md` file under `_bmad-output/implementation-artifacts/`.
   * Returns relative paths (relative to the project root) so the renderer
   * can map sprint-status keys to existing story files. Best-effort; an
   * empty directory (or missing tree) yields an empty array — no error,
   * because not every BMAD project has run sprint-planning yet.
   */
  ipcMain.handle(
    IPC_CHANNELS.BMAD_LIST_STORY_FILES,
    async (
      _e,
      payload,
    ): Promise<BmadIpcResult<{ files: readonly string[] }>> => {
      const v = validate(ProjectRootInput, payload);
      if (!v.ok) return v.result;
      try {
        const projectRoot = path.resolve(v.data.projectRoot);
        const baseDir = path.resolve(
          projectRoot,
          '_bmad-output',
          'implementation-artifacts',
        );
        if (!existsSync(baseDir)) {
          return bmadOk({ files: [] });
        }
        const entries = await fsPromises.readdir(baseDir, { withFileTypes: true });
        const files = entries
          .filter((e) => e.isFile() && e.name.endsWith('.md'))
          .map((e) =>
            path
              .relative(projectRoot, path.join(baseDir, e.name))
              .split(path.sep)
              .join('/'),
          )
          .sort();
        return bmadOk({ files });
      } catch (err) {
        return classifyError(err);
      }
    },
  );

  // ───── Installer ──────────────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.BMAD_RUN_INSTALLER,
    async (event, payload): Promise<BmadIpcResult<unknown>> => {
      const v = validate(RunInstallerInput, payload);
      if (!v.ok) return v.result;
      try {
        safeBreadcrumb({
          category: 'bmad.installer',
          level: 'info',
          message: 'runInstaller invoked',
          data: {
            directory: v.data.args.directory,
            modules: v.data.args.modules,
            action: v.data.args.action,
          },
        });
        const senderId = event.sender.id;
        const window = deps.getMainWindow();
        const result = await runInstaller({
          args: v.data.args,
          callbacks: {
            onChunk: (chunk) => {
              if (window && !window.isDestroyed()) {
                window.webContents.send(IPC_CHANNELS.BMAD_INSTALLER_STREAM, {
                  senderId,
                  chunk,
                });
              }
            },
          },
        });
        return bmadOk(result);
      } catch (err) {
        return classifyError(err);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.BMAD_LIST_INSTALLER_OPTIONS,
    async (_e, payload): Promise<BmadIpcResult<unknown>> => {
      const v = validate(ListInstallerOptionsInput, payload);
      if (!v.ok) return v.result;
      try {
        const result = await listInstallerOptions(v.data);
        return bmadOk(result);
      } catch (err) {
        return classifyError(err);
      }
    },
  );

  // ───── File watcher lifecycle ─────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.BMAD_WATCHER_START,
    async (_e, payload): Promise<BmadIpcResult<{ watching: boolean }>> => {
      const v = validate(WatcherStartInput, payload);
      if (!v.ok) return v.result;
      try {
        const key = watcherKey(v.data.projectRoot);
        const existing = activeWatchers.get(key);
        if (existing?.isRunning) {
          return bmadOk({ watching: true });
        }

        const handle = await startBmadFileWatcher({
          projectRoot: v.data.projectRoot,
          debounceMs: v.data.debounceMs ?? 250,
          usePolling: v.data.usePolling ?? false,
          onEvent: (fileEvent) => {
            const window = deps.getMainWindow();
            if (window && !window.isDestroyed()) {
              window.webContents.send(IPC_CHANNELS.BMAD_FILE_EVENT, fileEvent);
            }
            // Phase 1: invalidate the skill registry on customization-changed
            // and skill-changed so stale resolutions don't leak out.
            if (fileEvent.type === 'customization-changed') {
              const fileName = path.basename(fileEvent.path);
              const skillId = fileName
                .replace(/\.user\.toml$/, '')
                .replace(/\.toml$/, '')
                .replace(/^customize$/, '');
              if (skillId) skillRegistry.invalidate(fileEvent.projectRoot, skillId);
            }
            if (
              fileEvent.type === 'manifest-changed' ||
              fileEvent.type === 'skill-changed'
            ) {
              skillRegistry.invalidateProject(fileEvent.projectRoot);
            }
          },
          onWarn: (msg) => {
            appLog.warn('[bmad.watcher]', msg);
          },
        });
        activeWatchers.set(key, handle);
        return bmadOk({ watching: true });
      } catch (err) {
        return classifyError(err);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.BMAD_WATCHER_STOP,
    async (_e, payload): Promise<BmadIpcResult<{ watching: false }>> => {
      const v = validate(ProjectRootInput, payload);
      if (!v.ok) return v.result;
      try {
        const key = watcherKey(v.data.projectRoot);
        const existing = activeWatchers.get(key);
        if (!existing) return bmadOk({ watching: false });
        await existing.close();
        activeWatchers.delete(key);
        return bmadOk({ watching: false });
      } catch (err) {
        return classifyError(err);
      }
    },
  );

  // ───── Phase 1 dev affordance ─────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.BMAD_DEBUG_DUMP_SKILLS,
    async (_e, payload): Promise<BmadIpcResult<unknown>> => {
      const v = validate(ProjectRootInput, payload);
      if (!v.ok) return v.result;
      try {
        return bmadOk(await dumpSkills(v.data.projectRoot, skillRegistry));
      } catch (err) {
        return classifyError(err);
      }
    },
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Phase 2 — Persona / variable / step / sprint-status / orchestrator / help
  // ──────────────────────────────────────────────────────────────────────────

  ipcMain.handle(
    IPC_CHANNELS.BMAD_LIST_PERSONAS,
    async (_e, payload): Promise<BmadIpcResult<readonly BmadPersonaIdentity[]>> => {
      const v = validate(ProjectRootInput, payload);
      if (!v.ok) return v.result;
      try {
        const personas = await loadAllPersonas({
          projectRoot: v.data.projectRoot,
          skillRegistry,
        });
        return bmadOk(personas);
      } catch (err) {
        return classifyError(err);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.BMAD_LOAD_PERSONA,
    async (_e, payload): Promise<BmadIpcResult<BmadPersonaIdentity>> => {
      const v = validate(LoadPersonaInput, payload);
      if (!v.ok) return v.result;
      try {
        const persona = await loadPersona(v.data.slug, {
          projectRoot: v.data.projectRoot,
          skillRegistry,
        });
        return bmadOk(persona);
      } catch (err) {
        return classifyError(err);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.BMAD_GET_VARIABLE_CONTEXT,
    async (_e, payload): Promise<BmadIpcResult<BmadVariableContext>> => {
      const v = validate(VariableContextInput, payload);
      if (!v.ok) return v.result;
      try {
        const ctx = await buildVariableContext(v.data);
        return bmadOk(ctx);
      } catch (err) {
        return classifyError(err);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.BMAD_LOAD_STEP,
    async (_e, payload): Promise<BmadIpcResult<BmadWorkflowStep>> => {
      const v = validate(LoadStepInput, payload);
      if (!v.ok) return v.result;
      try {
        const skill = await skillRegistry.load(v.data.skillId, {
          projectRoot: v.data.projectRoot,
        });
        const variables = await buildVariableContext({
          projectRoot: v.data.projectRoot,
          skillDir: skill.skillDir,
          skillName: skill.canonicalId,
          module: skill.module,
        });
        const step = await loadStepByName({
          skill,
          fileName: v.data.stepFileName,
          variables,
          ...(v.data.outputFilePath ? { outputFilePath: v.data.outputFilePath } : {}),
        });
        return bmadOk(step);
      } catch (err) {
        return classifyError(err);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.BMAD_WRITE_SPRINT_STATUS,
    async (_e, payload): Promise<BmadIpcResult<{ written: true }>> => {
      const v = validate(WriteSprintStatusInput, payload);
      if (!v.ok) return v.result;
      try {
        // Cast: zod's record schema produces a type narrower than the union
        // form expected by writeSprintStatus.
        await writeSprintStatus({
          projectRoot: v.data.projectRoot,
          status: v.data.status as BmadSprintStatus,
        });
        return bmadOk({ written: true });
      } catch (err) {
        return classifyError(err);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.BMAD_UPDATE_STORY_STATUS,
    async (_e, payload): Promise<BmadIpcResult<BmadSprintStatus>> => {
      const v = validate(UpdateStoryStatusInput, payload);
      if (!v.ok) return v.result;
      try {
        const next = await updateStoryStatus({
          projectRoot: v.data.projectRoot,
          storyKey: v.data.storyKey,
          status: v.data.status,
        });
        return bmadOk(next);
      } catch (err) {
        return classifyError(err);
      }
    },
  );

  // Re-read the sprint-status file (separate from BMAD_READ_SPRINT_STATUS,
  // which returns the raw YAML; this returns the typed shape).
  ipcMain.handle(
    IPC_CHANNELS.BMAD_READ_SPRINT_STATUS_TYPED,
    async (_e, payload): Promise<BmadIpcResult<BmadSprintStatus | null>> => {
      const v = validate(ProjectRootInput, payload);
      if (!v.ok) return v.result;
      try {
        const status = await readSprintStatus({
          projectRoot: v.data.projectRoot,
          tolerateMissing: true,
        });
        return bmadOk(status);
      } catch (err) {
        return classifyError(err);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.BMAD_GET_HELP_RECOMMENDATION,
    async (_e, payload): Promise<BmadIpcResult<BmadHelpRecommendation>> => {
      const v = validate(TrackInput, payload);
      if (!v.ok) return v.result;
      try {
        const rec = await runHelpSync({
          projectRoot: v.data.projectRoot,
          track: v.data.track,
        });
        return bmadOk(rec);
      } catch (err) {
        return classifyError(err);
      }
    },
  );

  /**
   * AI-augmented bmad-help. Streams the model's free-form narrative back via
   * BMAD_WORKFLOW_STREAM (the same channel `runWorkflow` uses) so the
   * persona chat UI can render the response with the same plumbing.
   * Per BMAD docs § "Meet BMad-Help: Your Intelligent Guide" — the third
   * affordance is "Answer questions" via the bmad-help skill itself.
   */
  ipcMain.handle(
    IPC_CHANNELS.BMAD_RUN_HELP_AI,
    async (event, payload): Promise<BmadIpcResult<{ invocationId: string }>> => {
      const v = validate(RunHelpAIInput, payload);
      if (!v.ok) return v.result;
      const invocationId = v.data.invocationId ?? randomUUID();

      try {
        const window = deps.getMainWindow();
        const senderId = event.sender.id;
        const sendChunk = (chunk: BmadWorkflowStreamChunk) => {
          if (window && !window.isDestroyed()) {
            window.webContents.send(IPC_CHANNELS.BMAD_WORKFLOW_STREAM, {
              invocationId,
              senderId,
              chunk,
            });
          }
        };

        const profile = v.data.activeProfile as unknown as ClaudeProfile;
        // Fire-and-forget: stream events do the heavy lifting. The Promise
        // resolves at the end but the renderer doesn't need to await it —
        // it tracks completion via the 'done' chunk.
        runHelpAI({
          projectRoot: v.data.projectRoot,
          track: v.data.track,
          ...(v.data.question ? { question: v.data.question } : {}),
          activeProfile: profile,
          onStreamChunk: sendChunk,
        }).catch((err) => {
          // Surface the error as an `error` chunk so the renderer can
          // render it inline instead of needing a separate failure channel.
          sendChunk({
            kind: 'error',
            text: err instanceof Error ? err.message : String(err),
            seq: -1,
            timestamp: Date.now(),
          });
          sendChunk({
            kind: 'done',
            seq: -1,
            timestamp: Date.now(),
          });
        });

        return bmadOk({ invocationId });
      } catch (err) {
        return classifyError(err);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.BMAD_GET_ORCHESTRATOR_STATE,
    async (_e, payload): Promise<BmadIpcResult<BmadHelpRecommendation>> => {
      const v = validate(TrackInput, payload);
      if (!v.ok) return v.result;
      try {
        const emitter = createOrchestratorEmitter();
        emitter.on('phase-progressed', (event: BmadOrchestratorEvent) => {
          const window = deps.getMainWindow();
          if (window && !window.isDestroyed()) {
            window.webContents.send(IPC_CHANNELS.BMAD_ORCHESTRATOR_EVENT, event);
          }
        });
        const state = await computeOrchestratorState({
          projectRoot: v.data.projectRoot,
          track: v.data.track,
          emitter,
        });
        return bmadOk(state);
      } catch (err) {
        return classifyError(err);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.BMAD_RUN_WORKFLOW,
    async (event, payload): Promise<BmadIpcResult<BmadWorkflowResult & { invocationId: string }>> => {
      const v = validate(RunWorkflowInput, payload);
      if (!v.ok) return v.result;
      const invocationId = v.data.invocationId ?? randomUUID();

      try {
        const window = deps.getMainWindow();
        const senderId = event.sender.id;
        const sendChunk = (chunk: BmadWorkflowStreamChunk) => {
          if (window && !window.isDestroyed()) {
            window.webContents.send(IPC_CHANNELS.BMAD_WORKFLOW_STREAM, {
              invocationId,
              senderId,
              chunk,
            });
          }
        };

        let persona: BmadPersonaIdentity | undefined;
        if (v.data.personaSlug) {
          persona = await loadPersona(v.data.personaSlug as BmadPersonaSlug, {
            projectRoot: v.data.projectRoot,
            skillRegistry,
          });
        }

        // Bridge `onMenu` callbacks through the IPC layer. The runner's
        // promise resolves when the renderer responds via
        // BMAD_WORKFLOW_MENU_RESPONSE for this (invocationId, menuId) pair.
        const onMenu = async (menu: BmadWorkflowMenu): Promise<BmadWorkflowUserChoice> => {
          const menuId = randomUUID();
          const key = `${invocationId}::${menuId}`;
          const promise = new Promise<BmadWorkflowUserChoice>((resolve) => {
            const timeoutHandle = setTimeout(() => {
              pendingMenus.delete(key);
              resolve({ text: '' }); // empty text → runner treats as abort
            }, MENU_RESPONSE_TIMEOUT_MS);
            pendingMenus.set(key, { menuId, resolver: resolve, timeoutHandle });
          });
          // Surface the menu to the renderer via the stream channel —
          // the menu IS one kind of stream chunk (already covered by
          // `kind: 'menu'`) but we attach the menuId so the renderer can
          // reply via BMAD_WORKFLOW_MENU_RESPONSE.
          sendChunk({
            kind: 'menu',
            text: menu.prompt,
            seq: -1,
            timestamp: Date.now(),
          });
          // Plus an additional sentinel chunk carrying the menu structure.
          // The renderer tracks (invocationId, menuId) pairs to resolve.
          if (window && !window.isDestroyed()) {
            window.webContents.send('bmad:workflowMenuRequest', {
              invocationId,
              menuId,
              menu,
            });
          }
          return promise;
        };

        const profile = v.data.activeProfile as unknown as ClaudeProfile;
        const result = await runWorkflow({
          skillName: v.data.skillName,
          ...(persona ? { persona } : {}),
          projectRoot: v.data.projectRoot,
          activeProfile: profile,
          ...(v.data.args ? { args: v.data.args } : {}),
          ...(v.data.maxTurns !== undefined ? { maxTurns: v.data.maxTurns } : {}),
          ...(v.data.initialMessages ? { initialMessages: v.data.initialMessages } : {}),
          onStreamChunk: sendChunk,
          onMenu,
          skillRegistry,
        });

        // Clean up any orphaned pending menus from this invocation.
        for (const [key, pending] of [...pendingMenus.entries()]) {
          if (key.startsWith(`${invocationId}::`)) {
            clearTimeout(pending.timeoutHandle);
            pendingMenus.delete(key);
          }
        }

        return bmadOk({ ...result, invocationId });
      } catch (err) {
        return classifyError(err);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.BMAD_WORKFLOW_MENU_RESPONSE,
    async (_e, payload): Promise<BmadIpcResult<{ resolved: boolean }>> => {
      const v = validate(MenuResponseInput, payload);
      if (!v.ok) return v.result;
      const key = `${v.data.invocationId}::${v.data.menuId}`;
      const pending = pendingMenus.get(key);
      if (!pending) return bmadOk({ resolved: false });
      clearTimeout(pending.timeoutHandle);
      pendingMenus.delete(key);
      pending.resolver(v.data.choice);
      return bmadOk({ resolved: true });
    },
  );
}

// =============================================================================
// Phase 1 debug command — logs every installed skill with its resolved persona block
// =============================================================================

/**
 * Per Phase 1 acceptance: "A debug command in dev mode logs every installed
 * skill with resolved persona block." This dumps a summary list (id, kind,
 * resolved icon if persona, step file count) to `appLog` and returns the
 * structured payload to the caller for inspection.
 */
export async function dumpSkills(
  projectRoot: string,
  skillRegistry: SkillRegistry = getSharedSkillRegistry(),
): Promise<{
  projectRoot: string;
  isBmadProject: boolean;
  skills: Array<{
    canonicalId: string;
    kind: BmadSkill['kind'];
    module: string;
    persona: string | null;
    icon: string | null;
    stepFileCount: number;
    customizationKeys: number;
  }>;
}> {
  if (!(await isBmadProject(projectRoot))) {
    appLog.warn('[bmad.debug] dumpSkills: not a BMAD project →', projectRoot);
    return { projectRoot, isBmadProject: false, skills: [] };
  }
  const bundle = await loadAllManifests(projectRoot);
  const skills = await skillRegistry.loadAll({ projectRoot });

  const dump = skills.map((s) => {
    const personaSlug = personaSlugForSkillId(s.canonicalId);
    const agentBlock = s.customizationResolved?.agent as
      | { icon?: unknown }
      | undefined;
    const icon = typeof agentBlock?.icon === 'string' ? agentBlock.icon : null;
    return {
      canonicalId: s.canonicalId,
      kind: s.kind,
      module: s.module,
      persona: personaSlug,
      icon,
      stepFileCount: s.stepFiles.length,
      customizationKeys: s.customizationResolved
        ? Object.keys(s.customizationResolved).length
        : 0,
    };
  });

  appLog.info(
    `[bmad.debug] dumpSkills (${path.basename(projectRoot)}, ${bundle.manifest.modules.length} modules, ${dump.length} skills)`,
  );
  for (const entry of dump) {
    if (entry.persona) {
      appLog.info(
        `  ${entry.kind.toUpperCase().padStart(8)}  ${entry.canonicalId.padEnd(40)} ${entry.icon ?? '?'}  (${entry.persona})`,
      );
    } else {
      appLog.info(
        `  ${entry.kind.toUpperCase().padStart(8)}  ${entry.canonicalId.padEnd(40)}    [${entry.stepFileCount} steps, ${entry.customizationKeys} customize keys]`,
      );
    }
  }

  return {
    projectRoot,
    isBmadProject: true,
    skills: dump,
  };
}

