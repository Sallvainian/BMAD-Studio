/**
 * BMad Studio preload bridge
 * ==========================
 *
 * Exposes the BMAD subsystem (Phase 1) as `window.electronAPI.bmad.*`.
 * Every method is a thin wrapper around `ipcRenderer.invoke` against an
 * `IPC_CHANNELS.BMAD_*` channel; payload validation lives in the main-side
 * handler so the renderer can stay simple.
 *
 * Event subscription (`onFileEvent`, `onInstallerStream`) returns a cleanup
 * function — call it on component unmount to avoid orphan listeners.
 */

import { ipcRenderer } from 'electron';

import { IPC_CHANNELS } from '../../shared/constants/ipc';
import type {
  BmadCustomizationScope,
  BmadFileEvent,
  BmadInstallerOptions,
  BmadInstallerResult,
  BmadInstallerStreamChunk,
  BmadIpcResult,
  BmadModule,
  BmadPhaseGraph,
  BmadProjectSummary,
  BmadSkill,
  BmadSkillManifestEntry,
  BmadWorkflowDescriptor,
} from '../../shared/types/bmad';
import { createIpcListener, type IpcListenerCleanup } from './modules/ipc-utils';

export interface BmadAPI {
  // Project + manifest discovery
  detectProject(projectRoot: string): Promise<BmadIpcResult<BmadProjectSummary>>;
  listModules(projectRoot: string): Promise<BmadIpcResult<readonly BmadModule[]>>;
  listWorkflows(
    projectRoot: string,
  ): Promise<BmadIpcResult<readonly BmadWorkflowDescriptor[]>>;
  getPhaseGraph(projectRoot: string): Promise<BmadIpcResult<BmadPhaseGraph>>;

  // Skills
  listSkills(
    projectRoot: string,
  ): Promise<BmadIpcResult<readonly BmadSkillManifestEntry[]>>;
  loadSkill(
    projectRoot: string,
    skillId: string,
  ): Promise<BmadIpcResult<BmadSkill>>;

  // Customization
  readCustomization(
    projectRoot: string,
    skillId: string,
  ): Promise<BmadIpcResult<Record<string, unknown>>>;
  writeCustomization(
    projectRoot: string,
    skillId: string,
    scope: BmadCustomizationScope,
    data: Record<string, unknown>,
  ): Promise<BmadIpcResult<{ filePath: string }>>;

  // Sprint status / story files (read-only in Phase 1)
  readSprintStatus(projectRoot: string): Promise<BmadIpcResult<unknown>>;
  readStoryFile(
    projectRoot: string,
    storyPath: string,
  ): Promise<BmadIpcResult<{ contents: string; absolutePath: string }>>;

  // Installer
  runInstaller(
    args: BmadInstallerOptions,
  ): Promise<BmadIpcResult<BmadInstallerResult>>;
  listInstallerOptions(
    directory: string,
    moduleName?: string,
  ): Promise<BmadIpcResult<unknown>>;

  // File watcher lifecycle
  startWatcher(
    projectRoot: string,
    options?: { debounceMs?: number; usePolling?: boolean },
  ): Promise<BmadIpcResult<{ watching: boolean }>>;
  stopWatcher(projectRoot: string): Promise<BmadIpcResult<{ watching: false }>>;

  // Event streams
  onFileEvent(handler: (event: BmadFileEvent) => void): IpcListenerCleanup;
  onInstallerStream(
    handler: (payload: { senderId: number; chunk: BmadInstallerStreamChunk }) => void,
  ): IpcListenerCleanup;

  // Phase 1 dev affordance
  debugDumpSkills(projectRoot: string): Promise<BmadIpcResult<unknown>>;
}

export const createBmadAPI = (): BmadAPI => ({
  detectProject: (projectRoot) =>
    ipcRenderer.invoke(IPC_CHANNELS.BMAD_DETECT_PROJECT, { projectRoot }),
  listModules: (projectRoot) =>
    ipcRenderer.invoke(IPC_CHANNELS.BMAD_LIST_MODULES, { projectRoot }),
  listWorkflows: (projectRoot) =>
    ipcRenderer.invoke(IPC_CHANNELS.BMAD_LIST_WORKFLOWS, { projectRoot }),
  getPhaseGraph: (projectRoot) =>
    ipcRenderer.invoke(IPC_CHANNELS.BMAD_GET_PHASE_GRAPH, { projectRoot }),

  listSkills: (projectRoot) =>
    ipcRenderer.invoke(IPC_CHANNELS.BMAD_LIST_SKILLS, { projectRoot }),
  loadSkill: (projectRoot, skillId) =>
    ipcRenderer.invoke(IPC_CHANNELS.BMAD_LOAD_SKILL, { projectRoot, skillId }),

  readCustomization: (projectRoot, skillId) =>
    ipcRenderer.invoke(IPC_CHANNELS.BMAD_READ_CUSTOMIZATION, { projectRoot, skillId }),
  writeCustomization: (projectRoot, skillId, scope, data) =>
    ipcRenderer.invoke(IPC_CHANNELS.BMAD_WRITE_CUSTOMIZATION, {
      projectRoot,
      skillId,
      scope,
      data,
    }),

  readSprintStatus: (projectRoot) =>
    ipcRenderer.invoke(IPC_CHANNELS.BMAD_READ_SPRINT_STATUS, { projectRoot }),
  readStoryFile: (projectRoot, storyPath) =>
    ipcRenderer.invoke(IPC_CHANNELS.BMAD_READ_STORY_FILE, { projectRoot, storyPath }),

  runInstaller: (args) =>
    ipcRenderer.invoke(IPC_CHANNELS.BMAD_RUN_INSTALLER, { args }),
  listInstallerOptions: (directory, moduleName) =>
    ipcRenderer.invoke(IPC_CHANNELS.BMAD_LIST_INSTALLER_OPTIONS, {
      directory,
      module: moduleName,
    }),

  startWatcher: (projectRoot, options) =>
    ipcRenderer.invoke(IPC_CHANNELS.BMAD_WATCHER_START, {
      projectRoot,
      debounceMs: options?.debounceMs,
      usePolling: options?.usePolling,
    }),
  stopWatcher: (projectRoot) =>
    ipcRenderer.invoke(IPC_CHANNELS.BMAD_WATCHER_STOP, { projectRoot }),

  onFileEvent: (handler) =>
    createIpcListener<[BmadFileEvent]>(IPC_CHANNELS.BMAD_FILE_EVENT, (event) => {
      handler(event);
    }),
  onInstallerStream: (handler) =>
    createIpcListener<[{ senderId: number; chunk: BmadInstallerStreamChunk }]>(
      IPC_CHANNELS.BMAD_INSTALLER_STREAM,
      (payload) => handler(payload),
    ),

  debugDumpSkills: (projectRoot) =>
    ipcRenderer.invoke(IPC_CHANNELS.BMAD_DEBUG_DUMP_SKILLS, { projectRoot }),
});
