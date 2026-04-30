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
  type BmadIpcResult,
  type BmadModule,
  type BmadPhaseGraph,
  type BmadProjectSummary,
  type BmadSkill,
  type BmadSkillManifestEntry,
  type BmadWorkflowDescriptor,
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
  if (err instanceof Error) {
    appLog.error('[bmad-handlers] unhandled error:', err);
    return bmadFail('UNKNOWN', err.message);
  }
  appLog.error('[bmad-handlers] non-error throw:', err);
  return bmadFail('UNKNOWN', 'Non-Error value thrown', err);
}

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

