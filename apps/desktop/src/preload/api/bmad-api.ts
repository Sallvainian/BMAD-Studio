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
  BmadDevelopmentStatus,
  BmadFileEvent,
  BmadHelpRecommendation,
  BmadInstallerOptions,
  BmadInstallerResult,
  BmadInstallerStreamChunk,
  BmadIpcResult,
  BmadMigrationPlan,
  BmadMigrationResult,
  BmadModule,
  BmadOrchestratorEvent,
  BmadPersonaIdentity,
  BmadPersonaSlug,
  BmadPhaseGraph,
  BmadProjectSummary,
  BmadSkill,
  BmadSkillManifestEntry,
  BmadSprintStatus,
  BmadTrack,
  BmadVariableContext,
  BmadWorkflowDescriptor,
  BmadWorkflowMenu,
  BmadWorkflowResult,
  BmadWorkflowStep,
  BmadWorkflowStreamChunk,
  BmadWorkflowUserChoice,
} from '../../shared/types/bmad';
import type { ClaudeProfile } from '../../shared/types/agent';
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

  // Brownfield migration
  detectLegacyMigration(projectRoot: string): Promise<BmadIpcResult<BmadMigrationPlan>>;
  runLegacyMigration(projectRoot: string): Promise<BmadIpcResult<BmadMigrationResult>>;

  // Sprint status / story files (read-only in Phase 1)
  readSprintStatus(projectRoot: string): Promise<BmadIpcResult<unknown>>;
  readStoryFile(
    projectRoot: string,
    storyPath: string,
  ): Promise<BmadIpcResult<{ contents: string; absolutePath: string }>>;
  // Phase 3: typed sprint-status reader (tolerates missing) + story-file writer + listing
  readSprintStatusTyped(
    projectRoot: string,
  ): Promise<BmadIpcResult<BmadSprintStatus | null>>;
  writeStoryFile(
    projectRoot: string,
    storyPath: string,
    contents: string,
  ): Promise<BmadIpcResult<{ absolutePath: string }>>;
  listStoryFiles(
    projectRoot: string,
  ): Promise<BmadIpcResult<{ files: readonly string[] }>>;

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

  // ─── Phase 2: persona / variables / step / sprint-status / orchestrator / workflow ───
  listPersonas(projectRoot: string): Promise<BmadIpcResult<readonly BmadPersonaIdentity[]>>;
  loadPersona(
    projectRoot: string,
    slug: BmadPersonaSlug,
  ): Promise<BmadIpcResult<BmadPersonaIdentity>>;
  getVariableContext(args: {
    projectRoot: string;
    skillDir: string;
    skillName?: string;
    module?: string;
  }): Promise<BmadIpcResult<BmadVariableContext>>;
  loadStep(args: {
    projectRoot: string;
    skillId: string;
    stepFileName: string;
    outputFilePath?: string;
  }): Promise<BmadIpcResult<BmadWorkflowStep>>;
  writeSprintStatus(
    projectRoot: string,
    status: BmadSprintStatus,
  ): Promise<BmadIpcResult<{ written: true }>>;
  updateStoryStatus(args: {
    projectRoot: string;
    storyKey: string;
    status: BmadDevelopmentStatus;
  }): Promise<BmadIpcResult<BmadSprintStatus>>;
  getHelpRecommendation(
    projectRoot: string,
    track: BmadTrack,
  ): Promise<BmadIpcResult<BmadHelpRecommendation>>;
  getOrchestratorState(
    projectRoot: string,
    track: BmadTrack,
  ): Promise<BmadIpcResult<BmadHelpRecommendation>>;
  runWorkflow(args: {
    projectRoot: string;
    skillName: string;
    personaSlug?: BmadPersonaSlug;
    /**
     * Optional renderer-supplied invocation id. When omitted, the main
     * process generates a UUID. Allowing the renderer to seed it lets the
     * persona chat thread route streamed chunks immediately.
     */
    invocationId?: string;
    activeProfile: ClaudeProfile;
    args?: readonly string[];
    maxTurns?: number;
    initialMessages?: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
  }): Promise<BmadIpcResult<BmadWorkflowResult & { invocationId: string }>>;
  /**
   * AI-augmented help. Streams the bmad-help skill's narrative answer via
   * the same BMAD_WORKFLOW_STREAM channel as runWorkflow. Returns
   * synchronously with the invocationId so the chat thread can subscribe.
   */
  runHelpAI(args: {
    projectRoot: string;
    track: BmadTrack;
    question?: string;
    invocationId?: string;
    activeProfile: ClaudeProfile;
  }): Promise<BmadIpcResult<{ invocationId: string }>>;
  respondToWorkflowMenu(args: {
    invocationId: string;
    menuId: string;
    choice: BmadWorkflowUserChoice;
  }): Promise<BmadIpcResult<{ resolved: boolean }>>;

  onWorkflowStream(
    handler: (payload: {
      invocationId: string;
      senderId: number;
      chunk: BmadWorkflowStreamChunk;
    }) => void,
  ): IpcListenerCleanup;
  onWorkflowMenuRequest(
    handler: (payload: {
      invocationId: string;
      menuId: string;
      menu: BmadWorkflowMenu;
    }) => void,
  ): IpcListenerCleanup;
  onOrchestratorEvent(
    handler: (event: BmadOrchestratorEvent) => void,
  ): IpcListenerCleanup;
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

  detectLegacyMigration: (projectRoot) =>
    ipcRenderer.invoke(IPC_CHANNELS.BMAD_DETECT_LEGACY_MIGRATION, { projectRoot }),
  runLegacyMigration: (projectRoot) =>
    ipcRenderer.invoke(IPC_CHANNELS.BMAD_RUN_LEGACY_MIGRATION, { projectRoot }),

  readSprintStatus: (projectRoot) =>
    ipcRenderer.invoke(IPC_CHANNELS.BMAD_READ_SPRINT_STATUS, { projectRoot }),
  readStoryFile: (projectRoot, storyPath) =>
    ipcRenderer.invoke(IPC_CHANNELS.BMAD_READ_STORY_FILE, { projectRoot, storyPath }),
  readSprintStatusTyped: (projectRoot) =>
    ipcRenderer.invoke(IPC_CHANNELS.BMAD_READ_SPRINT_STATUS_TYPED, { projectRoot }),
  writeStoryFile: (projectRoot, storyPath, contents) =>
    ipcRenderer.invoke(IPC_CHANNELS.BMAD_WRITE_STORY_FILE, {
      projectRoot,
      storyPath,
      contents,
    }),
  listStoryFiles: (projectRoot) =>
    ipcRenderer.invoke(IPC_CHANNELS.BMAD_LIST_STORY_FILES, { projectRoot }),

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

  // ─── Phase 2 ────────────────────────────────────────────────────────────
  listPersonas: (projectRoot) =>
    ipcRenderer.invoke(IPC_CHANNELS.BMAD_LIST_PERSONAS, { projectRoot }),
  loadPersona: (projectRoot, slug) =>
    ipcRenderer.invoke(IPC_CHANNELS.BMAD_LOAD_PERSONA, { projectRoot, slug }),
  getVariableContext: (args) =>
    ipcRenderer.invoke(IPC_CHANNELS.BMAD_GET_VARIABLE_CONTEXT, args),
  loadStep: (args) => ipcRenderer.invoke(IPC_CHANNELS.BMAD_LOAD_STEP, args),
  writeSprintStatus: (projectRoot, status) =>
    ipcRenderer.invoke(IPC_CHANNELS.BMAD_WRITE_SPRINT_STATUS, { projectRoot, status }),
  updateStoryStatus: (args) =>
    ipcRenderer.invoke(IPC_CHANNELS.BMAD_UPDATE_STORY_STATUS, args),
  getHelpRecommendation: (projectRoot, track) =>
    ipcRenderer.invoke(IPC_CHANNELS.BMAD_GET_HELP_RECOMMENDATION, { projectRoot, track }),
  getOrchestratorState: (projectRoot, track) =>
    ipcRenderer.invoke(IPC_CHANNELS.BMAD_GET_ORCHESTRATOR_STATE, { projectRoot, track }),
  runWorkflow: (args) => ipcRenderer.invoke(IPC_CHANNELS.BMAD_RUN_WORKFLOW, args),
  runHelpAI: (args) => ipcRenderer.invoke(IPC_CHANNELS.BMAD_RUN_HELP_AI, args),
  respondToWorkflowMenu: (args) =>
    ipcRenderer.invoke(IPC_CHANNELS.BMAD_WORKFLOW_MENU_RESPONSE, args),

  onWorkflowStream: (handler) =>
    createIpcListener<[
      { invocationId: string; senderId: number; chunk: BmadWorkflowStreamChunk },
    ]>(IPC_CHANNELS.BMAD_WORKFLOW_STREAM, (payload) => handler(payload)),
  onWorkflowMenuRequest: (handler) =>
    createIpcListener<[
      { invocationId: string; menuId: string; menu: BmadWorkflowMenu },
    ]>('bmad:workflowMenuRequest', (payload) => handler(payload)),
  onOrchestratorEvent: (handler) =>
    createIpcListener<[BmadOrchestratorEvent]>(
      IPC_CHANNELS.BMAD_ORCHESTRATOR_EVENT,
      (payload) => handler(payload),
    ),
});
