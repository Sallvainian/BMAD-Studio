/**
 * BMad project store — Phase 3
 *
 * Holds everything the BMad Kanban needs from a single project: detection
 * metadata, sprint status, phase graph, help recommendation, personas,
 * cached story file details, and the optimistic-status overrides used to
 * keep drag-and-drop snappy.
 *
 * Per ENGINE_SWAP_PROMPT.md KAD-2 the filesystem is the contract — this
 * store is a pure read-side cache. Writes go straight to disk via the
 * Phase 2 IPC handlers (`updateStoryStatus`, `writeStoryFile`); the
 * file-watcher then re-emits and the store reconciles.
 *
 * Per ENGINE_SWAP_PROMPT.md Phase 3 deliverable §6 (drag-and-drop with
 * optimistic update + rollback) the store maintains a temporary override
 * map keyed by sprint-status key. Once the watcher event lands the
 * override is dropped — the YAML is the truth.
 */

import { create } from 'zustand';

import type {
  BmadChatMessage,
  BmadChatThread,
  BmadDevelopmentStatus,
  BmadFileEvent,
  BmadHelpRecommendation,
  BmadPersonaIdentity,
  BmadPersonaSlug,
  BmadPhaseGraph,
  BmadProjectSummary,
  BmadSprintStatus,
  BmadStartHelpAIArgs,
  BmadStartWorkflowArgs,
  BmadTrack,
  BmadWorkflowMenu,
  BmadWorkflowStreamChunk,
  BmadWorkflowUserChoice,
} from '../../shared/types/bmad';
import {
  groupSprintStatusIntoEpics,
  parseSprintStatusKey,
  parseStoryFile,
  speculativeStoryPath,
  toggleAcceptanceCriterion,
  type ParsedKey,
} from '../../shared/types/bmad-kanban-helpers';
import type { ClaudeProfile } from '../../shared/types/agent';

type ParsedStory = ReturnType<typeof parseStoryFile>;

const DEFAULT_TRACK: BmadTrack = 'method';

// =============================================================================
// Chat thread helpers
// =============================================================================

/**
 * Generates a tiny non-cryptographic id. Crypto.randomUUID is preferred when
 * available (Electron + modern browsers), but tests run under jsdom which
 * also exposes it. Falls back to a Math.random + Date.now combo to keep the
 * store usable in synthetic environments.
 */
function generateInvocationId(): string {
  const c =
    (typeof crypto !== 'undefined' ? (crypto as Crypto & { randomUUID?: () => string }) : null) ??
    null;
  if (c && typeof c.randomUUID === 'function') {
    return `bmad-${c.randomUUID()}`;
  }
  return `bmad-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function newMessageId(): string {
  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Persona ownership of a workflow. Matches BMAD docs § "Default Agents" —
 * Mary owns analysis, John owns planning, Winston owns architecture, Amelia
 * owns implementation. Used to default the chat thread's persona when the
 * caller doesn't supply one explicitly.
 */
function inferPersonaForSkill(skillName: string): BmadPersonaSlug | null {
  if (skillName.startsWith('bmad-agent-')) {
    switch (skillName) {
      case 'bmad-agent-analyst':
        return 'mary';
      case 'bmad-agent-tech-writer':
        return 'paige';
      case 'bmad-agent-pm':
        return 'john';
      case 'bmad-agent-ux-designer':
        return 'sally';
      case 'bmad-agent-architect':
        return 'winston';
      case 'bmad-agent-dev':
        return 'amelia';
      default:
        return null;
    }
  }
  // Workflow skills — match by phase ownership.
  if (skillName === 'bmad-create-prd') return 'john';
  if (skillName === 'bmad-validate-prd') return 'john';
  if (skillName === 'bmad-edit-prd') return 'john';
  if (skillName === 'bmad-create-epics-and-stories') return 'john';
  if (skillName === 'bmad-correct-course') return 'john';
  if (skillName === 'bmad-create-architecture') return 'winston';
  if (skillName === 'bmad-check-implementation-readiness') return 'winston';
  if (skillName === 'bmad-generate-project-context') return 'winston';
  if (skillName === 'bmad-create-ux-design') return 'sally';
  if (skillName === 'bmad-product-brief') return 'mary';
  if (skillName === 'bmad-prfaq') return 'mary';
  if (skillName === 'bmad-brainstorming') return 'mary';
  if (skillName === 'bmad-domain-research') return 'mary';
  if (skillName === 'bmad-market-research') return 'mary';
  if (skillName === 'bmad-technical-research') return 'mary';
  if (skillName === 'bmad-document-project') return 'mary';
  if (skillName.startsWith('bmad-dev-')) return 'amelia';
  if (skillName === 'bmad-sprint-planning') return 'amelia';
  if (skillName === 'bmad-sprint-status') return 'amelia';
  if (skillName === 'bmad-create-story') return 'amelia';
  if (skillName === 'bmad-code-review') return 'amelia';
  if (skillName === 'bmad-quick-dev') return 'amelia';
  if (skillName === 'bmad-retrospective') return 'amelia';
  if (skillName === 'bmad-checkpoint-preview') return 'amelia';
  if (skillName === 'bmad-qa-generate-e2e-tests') return 'amelia';
  return null;
}

// =============================================================================
// State shape
// =============================================================================

export type BmadLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

interface BmadStoryDetailEntry {
  readonly storyKey: string;
  readonly storyPath: string;
  readonly raw: string;
  readonly parsed: ParsedStory;
  readonly absolutePath: string;
  readonly loadedAt: number;
}

export interface BmadStoreState {
  /** Active project root the renderer is currently viewing. */
  activeProjectRoot: string | null;
  /** Active track. Phase 3 only wires `'method'` (per D-005). */
  track: BmadTrack;
  /** True after detectProject + initial fetches complete. */
  loadStatus: BmadLoadStatus;
  /** Last error message from the load pipeline (renderer-displayable). */
  lastError: string | null;

  // Cached IPC payloads
  projectSummary: BmadProjectSummary | null;
  sprintStatus: BmadSprintStatus | null;
  phaseGraph: BmadPhaseGraph | null;
  recommendation: BmadHelpRecommendation | null;
  personas: readonly BmadPersonaIdentity[];
  storyFiles: readonly string[];

  /**
   * Optimistic status overrides keyed by sprint-status key. Used during
   * drag-and-drop while the IPC `updateStoryStatus` write completes and
   * the watcher echoes the change back. Dropped on watcher event arrival.
   */
  optimisticStatus: Readonly<Record<string, BmadDevelopmentStatus>>;

  /** Story-detail cache keyed by sprint-status key. */
  storyDetails: Readonly<Record<string, BmadStoryDetailEntry>>;

  /** Currently-open story key (slide-in detail panel). */
  activeStoryKey: string | null;

  /** Workflow invocation currently driving a story (subscribed via stream events). */
  activeInvocation:
    | {
        readonly invocationId: string;
        readonly storyKey: string;
        readonly skillName: string;
      }
    | null;

  // ─── Phase 4: chat threads ───────────────────────────────────────────────
  /** All chat threads (active + completed) for the current project session. */
  chatThreads: Readonly<Record<string, BmadChatThread>>;
  /** Currently displayed chat thread in the persona chat dock. */
  activeChatId: string | null;
  /**
   * Persona slug to use for the next free-form chat. Persists across thread
   * boundaries so the user's persona switcher selection survives chat ends.
   */
  preferredPersona: BmadPersonaSlug | null;
  /**
   * True once the global workflow-stream + menu-request listeners are wired.
   * Idempotent guard so the listeners don't accumulate when the consuming
   * hook re-mounts (e.g. project switch, dev-mode HMR).
   */
  streamListenersAttached: boolean;
  /** Tutorial overlay flag — true when the user hasn't dismissed it yet. */
  tutorialDismissed: boolean;
}

// =============================================================================
// Actions
// =============================================================================

interface BmadStoreActions {
  /** Initialize the store for a project. Loads everything in parallel. */
  loadProject(projectRoot: string, track?: BmadTrack): Promise<void>;
  /** Stop the watcher, clear all state. */
  unloadProject(): Promise<void>;
  /** Re-pull only the slices invalidated by a watcher event. */
  applyFileEvent(event: BmadFileEvent): Promise<void>;
  /** Drag-and-drop write path — optimistic update + rollback on failure. */
  setStoryStatus(storyKey: string, status: BmadDevelopmentStatus): Promise<{
    success: boolean;
    error?: string;
  }>;
  /** Open the slide-in detail panel for a story. Loads + caches the file. */
  selectStory(storyKey: string): Promise<{ success: boolean; error?: string }>;
  closeStoryDetail(): void;
  /** Toggle one acceptance criterion in the active story. */
  toggleAcceptance(
    storyKey: string,
    acIndex: number,
    done: boolean,
  ): Promise<{ success: boolean; error?: string }>;
  /** Track which workflow invocation is driving a card (for Run button visuals). */
  setActiveInvocation(
    invocation: BmadStoreState['activeInvocation'],
  ): void;
  /** Reset error state without changing other slices. */
  clearError(): void;

  // ─── Phase 4: chat thread + workflow lifecycle ─────────────────────────
  /**
   * Wire the global workflow-stream and menu-request listeners. Idempotent.
   * Called by `useBmadProject` on mount; does nothing if already wired.
   */
  attachStreamListeners(): void;
  /**
   * Tear down the stream listeners. Called when the renderer unloads.
   * Idempotent. Used in tests and on hard project teardown.
   */
  detachStreamListeners(): void;
  /**
   * Append a streamed chunk to the matching thread. Public so the listeners
   * + tests can drive it; not normally invoked from UI code.
   */
  appendStreamChunk(invocationId: string, chunk: BmadWorkflowStreamChunk): void;
  /**
   * Surface a menu request to the chat. Public for the same reason as above.
   */
  setPendingMenu(invocationId: string, menuId: string, menu: BmadWorkflowMenu): void;
  /**
   * Start a workflow as a fresh chat thread. Generates a renderer-side
   * invocation id, creates the thread, and fires `bmad.runWorkflow`.
   * Resolves with the thread id when the IPC call returns its final result.
   */
  startWorkflow(
    args: BmadStartWorkflowArgs,
    activeProfile: ClaudeProfile,
  ): Promise<{ success: boolean; invocationId?: string; error?: string }>;
  /**
   * Start a free-form bmad-help question as a chat thread. Streams the
   * model's narrative answer back via the same chunk infrastructure.
   */
  startHelpAI(
    args: BmadStartHelpAIArgs,
    activeProfile: ClaudeProfile,
  ): Promise<{ success: boolean; invocationId?: string; error?: string }>;
  /**
   * Resolve a pending menu by sending the user's choice back to the runner.
   * Appends the user's pick as a chat message and clears the pending menu.
   */
  respondToMenu(
    invocationId: string,
    choice: BmadWorkflowUserChoice,
  ): Promise<{ success: boolean; error?: string }>;
  /** Switch which chat thread is shown in the dock. Pass null to close. */
  selectChat(invocationId: string | null): void;
  /** Drop a thread (after completion). Removes from the chatThreads map. */
  closeChat(invocationId: string): void;
  /** Set the user's persona pick for the next free-form chat. */
  setPreferredPersona(slug: BmadPersonaSlug | null): void;
  /** Mark the first-run tutorial as dismissed. */
  dismissTutorial(): void;
}

/**
 * Persistent flag for the first-launch tutorial. Stored in localStorage so
 * dismissing it survives app restarts. Reads return `false` when running
 * outside a browser (e.g., main-process Vitest) so the tutorial behaves
 * correctly on its first render.
 */
const TUTORIAL_DISMISSED_STORAGE_KEY = 'bmad.tutorial.dismissed';

function readTutorialDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(TUTORIAL_DISMISSED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeTutorialDismissed(value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      TUTORIAL_DISMISSED_STORAGE_KEY,
      value ? 'true' : 'false',
    );
  } catch {
    // localStorage may be disabled (private browsing); fall through.
  }
}

const initialState: BmadStoreState = {
  activeProjectRoot: null,
  track: DEFAULT_TRACK,
  loadStatus: 'idle',
  lastError: null,
  projectSummary: null,
  sprintStatus: null,
  phaseGraph: null,
  recommendation: null,
  personas: [],
  storyFiles: [],
  optimisticStatus: {},
  storyDetails: {},
  activeStoryKey: null,
  activeInvocation: null,
  chatThreads: {},
  activeChatId: null,
  preferredPersona: null,
  streamListenersAttached: false,
  tutorialDismissed: readTutorialDismissed(),
};

/**
 * Module-level cleanup handles for the global stream listeners. Hoisted out
 * of the store so the create() factory doesn't run them again on HMR.
 */
let streamListenerCleanup: (() => void) | null = null;
let menuListenerCleanup: (() => void) | null = null;

// =============================================================================
// Store
// =============================================================================

const bmad = (): BmadAPIShape => {
  const api = (
    typeof window !== 'undefined'
      ? window.electronAPI?.bmad
      : undefined
  ) as BmadAPIShape | undefined;
  if (!api) {
    throw new Error('BMad IPC unavailable — running outside Electron?');
  }
  return api;
};

/**
 * Type alias for the slice of `BmadAPI` this store uses. Re-declared here
 * to avoid a circular runtime dependency on `apps/desktop/src/preload/api/bmad-api.ts`.
 * The renderer-side `window.electronAPI.bmad` exposes everything below.
 */
type BmadAPIShape = {
  detectProject: typeof window.electronAPI.bmad.detectProject;
  readSprintStatusTyped: typeof window.electronAPI.bmad.readSprintStatusTyped;
  getPhaseGraph: typeof window.electronAPI.bmad.getPhaseGraph;
  getHelpRecommendation: typeof window.electronAPI.bmad.getHelpRecommendation;
  listPersonas: typeof window.electronAPI.bmad.listPersonas;
  listStoryFiles: typeof window.electronAPI.bmad.listStoryFiles;
  startWatcher: typeof window.electronAPI.bmad.startWatcher;
  stopWatcher: typeof window.electronAPI.bmad.stopWatcher;
  updateStoryStatus: typeof window.electronAPI.bmad.updateStoryStatus;
  readStoryFile: typeof window.electronAPI.bmad.readStoryFile;
  writeStoryFile: typeof window.electronAPI.bmad.writeStoryFile;
  onFileEvent: typeof window.electronAPI.bmad.onFileEvent;
  onOrchestratorEvent: typeof window.electronAPI.bmad.onOrchestratorEvent;
  // Phase 4 additions
  runWorkflow: typeof window.electronAPI.bmad.runWorkflow;
  runHelpAI: typeof window.electronAPI.bmad.runHelpAI;
  respondToWorkflowMenu: typeof window.electronAPI.bmad.respondToWorkflowMenu;
  onWorkflowStream: typeof window.electronAPI.bmad.onWorkflowStream;
  onWorkflowMenuRequest: typeof window.electronAPI.bmad.onWorkflowMenuRequest;
};

export const useBmadStore = create<BmadStoreState & BmadStoreActions>(
  (set, get) => ({
    ...initialState,

    clearError: () => set({ lastError: null }),

    setActiveInvocation: (invocation) => set({ activeInvocation: invocation }),

    loadProject: async (projectRoot, track = DEFAULT_TRACK) => {
      const current = get();
      if (
        current.activeProjectRoot === projectRoot &&
        current.loadStatus === 'ready'
      ) {
        return;
      }

      set({
        activeProjectRoot: projectRoot,
        track,
        loadStatus: 'loading',
        lastError: null,
        sprintStatus: null,
        phaseGraph: null,
        recommendation: null,
        personas: [],
        storyFiles: [],
        optimisticStatus: {},
        storyDetails: {},
        activeStoryKey: null,
      });

      try {
        const api = bmad();
        const detect = await api.detectProject(projectRoot);
        if (!detect.success) {
          set({
            loadStatus: 'error',
            lastError: detect.error.message,
          });
          return;
        }
        if (!detect.data.isBmadProject) {
          set({
            projectSummary: detect.data,
            loadStatus: 'ready',
            sprintStatus: null,
            phaseGraph: null,
            recommendation: null,
            personas: [],
          });
          return;
        }

        const [
          sprintStatusResp,
          phaseGraphResp,
          recommendationResp,
          personasResp,
          storyFilesResp,
        ] = await Promise.all([
          api.readSprintStatusTyped(projectRoot),
          api.getPhaseGraph(projectRoot),
          api.getHelpRecommendation(projectRoot, track),
          api.listPersonas(projectRoot),
          api.listStoryFiles(projectRoot),
        ]);

        const next: Partial<BmadStoreState> = {
          projectSummary: detect.data,
          loadStatus: 'ready',
        };

        if (sprintStatusResp.success) {
          next.sprintStatus = sprintStatusResp.data;
        }
        if (phaseGraphResp.success) {
          next.phaseGraph = phaseGraphResp.data;
        }
        if (recommendationResp.success) {
          next.recommendation = recommendationResp.data;
        }
        if (personasResp.success) {
          next.personas = personasResp.data;
        }
        if (storyFilesResp.success) {
          next.storyFiles = storyFilesResp.data.files;
        }

        // Surface the first failure to the user — but don't tear down the
        // whole load (a missing sprint-status is normal pre-sprint-planning).
        const firstFailure =
          (!phaseGraphResp.success && phaseGraphResp.error.message) ||
          (!recommendationResp.success && recommendationResp.error.message) ||
          (!personasResp.success && personasResp.error.message) ||
          null;
        if (firstFailure) {
          next.lastError = firstFailure;
        }

        set(next);

        // Spin up the file-watcher last; failure here is non-fatal.
        await api.startWatcher(projectRoot, { debounceMs: 250 });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Unknown BMad load error';
        set({ loadStatus: 'error', lastError: message });
      }
    },

    unloadProject: async () => {
      const root = get().activeProjectRoot;
      if (root) {
        try {
          await bmad().stopWatcher(root);
        } catch {
          // Best-effort — main process may have already torn down.
        }
      }
      // Detach Phase 4 stream listeners before resetting state, otherwise the
      // module-level cleanup handles leak across project switches and a
      // subsequent re-attach creates a second IPC subscriber.
      streamListenerCleanup?.();
      menuListenerCleanup?.();
      streamListenerCleanup = null;
      menuListenerCleanup = null;
      // Re-read the persisted tutorial flag so dismissal survives the reset.
      set({ ...initialState, tutorialDismissed: readTutorialDismissed() });
    },

    applyFileEvent: async (event) => {
      const { activeProjectRoot, track } = get();
      if (!activeProjectRoot || event.projectRoot !== activeProjectRoot) return;

      const api = bmad();

      switch (event.type) {
        case 'sprint-status-changed': {
          const resp = await api.readSprintStatusTyped(activeProjectRoot);
          if (resp.success) {
            set({
              sprintStatus: resp.data,
              optimisticStatus: {},
            });
          }
          // Fall through to refresh the recommendation as well — completion
          // detection in the orchestrator depends on artifact files which
          // sprint-status changes can imply.
          const rec = await api.getHelpRecommendation(activeProjectRoot, track);
          if (rec.success) set({ recommendation: rec.data });
          break;
        }
        case 'manifest-changed': {
          const graph = await api.getPhaseGraph(activeProjectRoot);
          if (graph.success) set({ phaseGraph: graph.data });
          const rec = await api.getHelpRecommendation(activeProjectRoot, track);
          if (rec.success) set({ recommendation: rec.data });
          break;
        }
        case 'story-file-changed':
        case 'epic-file-changed':
        case 'implementation-artifact-changed': {
          const files = await api.listStoryFiles(activeProjectRoot);
          if (files.success) set({ storyFiles: files.data.files });
          // Drop any cached story detail for this path so the next read
          // pulls a fresh copy.
          const cache = { ...get().storyDetails };
          for (const [k, entry] of Object.entries(cache)) {
            if (event.path.endsWith(entry.storyPath)) {
              delete cache[k];
            }
          }
          set({ storyDetails: cache });
          break;
        }
        case 'planning-artifact-changed': {
          const rec = await api.getHelpRecommendation(activeProjectRoot, track);
          if (rec.success) set({ recommendation: rec.data });
          break;
        }
        case 'customization-changed':
        case 'config-changed':
        case 'project-context-changed':
        case 'skill-changed':
          // Renderer caches don't depend on these for the kanban view; the
          // orchestrator picks them up on its next compute. Re-pull help
          // for personas/customization-driven recommendations.
          {
            const rec = await api.getHelpRecommendation(activeProjectRoot, track);
            if (rec.success) set({ recommendation: rec.data });
          }
          break;
        default: {
          // Exhaustiveness guard — unhandled event types fall through to a
          // help recompute as a safe default.
          const rec = await api.getHelpRecommendation(activeProjectRoot, track);
          if (rec.success) set({ recommendation: rec.data });
        }
      }
    },

    setStoryStatus: async (storyKey, status) => {
      const { activeProjectRoot, sprintStatus } = get();
      if (!activeProjectRoot) {
        return { success: false, error: 'No active BMad project' };
      }
      if (!sprintStatus) {
        return {
          success: false,
          error: 'sprint-status.yaml is missing — run sprint-planning first',
        };
      }
      const previous = sprintStatus.developmentStatus[storyKey];
      if (!previous) {
        return {
          success: false,
          error: `Story key '${storyKey}' not found in sprint-status`,
        };
      }
      if (previous === status) return { success: true };

      // Optimistic update: paint the new status into the override map so
      // the kanban re-renders synchronously.
      set((state) => ({
        optimisticStatus: { ...state.optimisticStatus, [storyKey]: status },
      }));

      try {
        const resp = await bmad().updateStoryStatus({
          projectRoot: activeProjectRoot,
          storyKey,
          status,
        });
        if (!resp.success) {
          set((state) => {
            const next = { ...state.optimisticStatus };
            delete next[storyKey];
            return {
              optimisticStatus: next,
              lastError: resp.error.message,
            };
          });
          return { success: false, error: resp.error.message };
        }
        // Synchronously reflect the canonical YAML the writer returned —
        // the watcher will fire its own sprint-status-changed shortly and
        // applyFileEvent will reconcile.
        set({ sprintStatus: resp.data });
        return { success: true };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Unknown setStoryStatus error';
        set((state) => {
          const next = { ...state.optimisticStatus };
          delete next[storyKey];
          return { optimisticStatus: next, lastError: message };
        });
        return { success: false, error: message };
      }
    },

    selectStory: async (storyKey) => {
      const { activeProjectRoot } = get();
      if (!activeProjectRoot) {
        return { success: false, error: 'No active BMad project' };
      }
      set({ activeStoryKey: storyKey });

      // If we already cached this story, no IPC needed.
      const cached = get().storyDetails[storyKey];
      if (cached) {
        return { success: true };
      }

      const parsed = parseSprintStatusKey(storyKey);
      const storyPath = pathForKey(parsed);
      if (!storyPath) {
        return { success: true }; // epic / retro — no file to open
      }
      try {
        const resp = await bmad().readStoryFile(activeProjectRoot, storyPath);
        if (!resp.success) {
          // 404 or out-of-tree: leave the panel open with no body so the user
          // sees the empty state. The card can still link to "Run dev-story."
          if (resp.error.code !== 'IO_ERROR') {
            set({ lastError: resp.error.message });
          }
          return { success: false, error: resp.error.message };
        }
        const detail: BmadStoryDetailEntry = {
          storyKey,
          storyPath,
          raw: resp.data.contents,
          parsed: parseStoryFile(resp.data.contents, {
            fallbackTitle:
              parsed.kind === 'story' ? parsed.slug : storyKey,
          }),
          absolutePath: resp.data.absolutePath,
          loadedAt: Date.now(),
        };
        set((state) => ({
          storyDetails: { ...state.storyDetails, [storyKey]: detail },
        }));
        return { success: true };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Unknown selectStory error';
        set({ lastError: message });
        return { success: false, error: message };
      }
    },

    closeStoryDetail: () => set({ activeStoryKey: null }),

    // ─── Phase 4: chat thread + workflow lifecycle ────────────────────
    attachStreamListeners: () => {
      if (get().streamListenersAttached) return;
      const api = bmad();
      streamListenerCleanup = api.onWorkflowStream((payload) => {
        get().appendStreamChunk(payload.invocationId, payload.chunk);
      });
      menuListenerCleanup = api.onWorkflowMenuRequest((payload) => {
        get().setPendingMenu(payload.invocationId, payload.menuId, payload.menu);
      });
      set({ streamListenersAttached: true });
    },

    detachStreamListeners: () => {
      streamListenerCleanup?.();
      menuListenerCleanup?.();
      streamListenerCleanup = null;
      menuListenerCleanup = null;
      set({ streamListenersAttached: false });
    },

    appendStreamChunk: (invocationId, chunk) => {
      set((state) => {
        const thread = state.chatThreads[invocationId];
        if (!thread) return state;

        // 'done' marks the workflow as finished — the runWorkflow Promise
        // result will land separately and refine the outcome. We finalize
        // the streaming flag here so the bubble stops pulsing.
        if (chunk.kind === 'done') {
          const messages = thread.messages.map((m) =>
            m.streaming ? { ...m, streaming: false } : m,
          );
          // Don't override 'completed' / 'errored' if those already landed
          // from the menu path or the IPC result; keep streaming threads
          // open until the final status update arrives.
          const nextStatus =
            thread.status === 'awaiting-menu' ||
            thread.status === 'awaiting-response' ||
            thread.status === 'completed' ||
            thread.status === 'aborted' ||
            thread.status === 'errored'
              ? thread.status
              : ('completed' as const);
          return {
            chatThreads: {
              ...state.chatThreads,
              [invocationId]: {
                ...thread,
                messages,
                status: nextStatus,
                endedAt: thread.endedAt ?? Date.now(),
              },
            },
          };
        }

        if (chunk.kind === 'error') {
          const messages = appendSystemMessage(
            thread.messages,
            chunk.text ?? 'Workflow errored',
          );
          return {
            chatThreads: {
              ...state.chatThreads,
              [invocationId]: {
                ...thread,
                messages,
                status: 'errored',
                error: chunk.text ?? 'Workflow errored',
                endedAt: Date.now(),
              },
            },
          };
        }

        if (chunk.kind === 'step-start') {
          // Surface step transitions as a system message so the UI can
          // show "Loaded step: foo.md" inline. Per BMAD's just-in-time
          // step file rule (per BMAD docs § "The Activation Flow") only
          // one step is ever active at a time.
          const stepText = chunk.stepFileName
            ? `Step loaded: ${chunk.stepFileName}`
            : (chunk.text ?? 'Step loaded');
          return {
            chatThreads: {
              ...state.chatThreads,
              [invocationId]: {
                ...thread,
                messages: appendSystemMessage(thread.messages, stepText),
              },
            },
          };
        }

        if (chunk.kind === 'tool-call') {
          // Surface tool calls as compact system messages so the user can
          // see "Read /path", "Write /path" etc. without parsing the
          // full agent output.
          const callDescription = describeToolCall(chunk);
          return {
            chatThreads: {
              ...state.chatThreads,
              [invocationId]: {
                ...thread,
                messages: appendSystemMessage(thread.messages, callDescription),
              },
            },
          };
        }

        if (chunk.kind === 'text-delta' && chunk.text) {
          const messages = appendAssistantDelta(
            thread.messages,
            chunk.text,
            thread.personaSlug ?? undefined,
          );
          return {
            chatThreads: {
              ...state.chatThreads,
              [invocationId]: {
                ...thread,
                messages,
                status: thread.status === 'starting' ? 'streaming' : thread.status,
              },
            },
          };
        }

        // 'menu' is handled by the dedicated menu listener; ignore here.
        // 'reasoning' deltas + tool-result chunks are intentionally dropped
        // from the chat history (they're noise for end-users; can be
        // surfaced via a debug toggle in Phase 6).
        return state;
      });
    },

    setPendingMenu: (invocationId, menuId, menu) => {
      set((state) => {
        const thread = state.chatThreads[invocationId];
        if (!thread) return state;
        // Mark the in-progress assistant message as no longer streaming —
        // the model has halted and is waiting for input.
        const messages = thread.messages.map((m) =>
          m.streaming ? { ...m, streaming: false } : m,
        );
        return {
          chatThreads: {
            ...state.chatThreads,
            [invocationId]: {
              ...thread,
              messages,
              status: 'awaiting-menu',
              pendingMenu: { menuId, menu, receivedAt: Date.now() },
            },
          },
        };
      });
    },

    startWorkflow: async (args, activeProfile) => {
      const { activeProjectRoot } = get();
      if (!activeProjectRoot) {
        return { success: false, error: 'No active BMad project' };
      }

      const invocationId = generateInvocationId();
      const personaSlug = args.personaSlug ?? inferPersonaForSkill(args.skillName);
      // Ensure listeners are wired before the IPC fires; the runner emits
      // chunks immediately so we can't afford a registration race.
      get().attachStreamListeners();

      const thread: BmadChatThread = {
        invocationId,
        skillName: args.skillName,
        personaSlug,
        storyKey: args.storyKey ?? null,
        title: args.title ?? null,
        messages: [],
        status: 'starting',
        pendingMenu: null,
        startedAt: Date.now(),
      };

      set((state) => ({
        chatThreads: { ...state.chatThreads, [invocationId]: thread },
        activeChatId: invocationId,
        ...(args.storyKey
          ? {
              activeInvocation: {
                invocationId,
                storyKey: args.storyKey,
                skillName: args.skillName,
              },
            }
          : {}),
      }));

      // Optimistic story-status transition to 'in-progress' when running on
      // a 'ready-for-dev' or 'backlog' story card. Watcher will reconcile
      // once the workflow writes sprint-status.yaml.
      if (args.storyKey) {
        const current = get().sprintStatus?.developmentStatus[args.storyKey];
        if (current === 'ready-for-dev' || current === 'backlog') {
          set((state) => ({
            optimisticStatus: {
              ...state.optimisticStatus,
              [args.storyKey as string]: 'in-progress',
            },
          }));
        }
      }

      try {
        const resp = await bmad().runWorkflow({
          projectRoot: activeProjectRoot,
          skillName: args.skillName,
          ...(personaSlug ? { personaSlug } : {}),
          invocationId,
          activeProfile,
          ...(args.args ? { args: args.args } : {}),
          ...(args.maxTurns !== undefined ? { maxTurns: args.maxTurns } : {}),
          ...(args.initialMessages ? { initialMessages: args.initialMessages } : {}),
        });

        if (!resp.success) {
          set((state) => {
            const t = state.chatThreads[invocationId];
            if (!t) return state;
            return {
              chatThreads: {
                ...state.chatThreads,
                [invocationId]: {
                  ...t,
                  status: 'errored',
                  error: resp.error.message,
                  endedAt: Date.now(),
                },
              },
              lastError: resp.error.message,
              ...(args.storyKey
                ? rollbackOptimisticStatus(state, args.storyKey)
                : {}),
              activeInvocation:
                state.activeInvocation?.invocationId === invocationId
                  ? null
                  : state.activeInvocation,
            };
          });
          return { success: false, invocationId, error: resp.error.message };
        }

        // Final outcome. The 'done' chunk may have already finalized the
        // streaming flag; we just merge the outcome here.
        set((state) => {
          const t = state.chatThreads[invocationId];
          if (!t) return state;
          const finalStatus: BmadChatThread['status'] =
            resp.data.outcome === 'completed'
              ? 'completed'
              : resp.data.outcome === 'aborted'
                ? 'aborted'
                : 'errored';
          return {
            chatThreads: {
              ...state.chatThreads,
              [invocationId]: {
                ...t,
                status: finalStatus,
                outcome: resp.data.outcome,
                endedAt: t.endedAt ?? Date.now(),
                ...(resp.data.error ? { error: resp.data.error.message } : {}),
              },
            },
            activeInvocation:
              state.activeInvocation?.invocationId === invocationId
                ? null
                : state.activeInvocation,
          };
        });
        return { success: true, invocationId };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'startWorkflow failed';
        set((state) => {
          const t = state.chatThreads[invocationId];
          if (!t) return state;
          return {
            chatThreads: {
              ...state.chatThreads,
              [invocationId]: {
                ...t,
                status: 'errored',
                error: message,
                endedAt: Date.now(),
              },
            },
            lastError: message,
            ...(args.storyKey
              ? rollbackOptimisticStatus(state, args.storyKey)
              : {}),
            activeInvocation:
              state.activeInvocation?.invocationId === invocationId
                ? null
                : state.activeInvocation,
          };
        });
        return { success: false, invocationId, error: message };
      }
    },

    startHelpAI: async (args, activeProfile) => {
      const { activeProjectRoot, track } = get();
      if (!activeProjectRoot) {
        return { success: false, error: 'No active BMad project' };
      }

      const invocationId = generateInvocationId();
      get().attachStreamListeners();

      const userMessage: BmadChatMessage | null = args.question
        ? {
            id: newMessageId(),
            role: 'user',
            content: args.question,
            timestamp: Date.now(),
          }
        : null;

      const thread: BmadChatThread = {
        invocationId,
        skillName: 'bmad-help',
        personaSlug: null,
        storyKey: null,
        title: null,
        messages: userMessage ? [userMessage] : [],
        status: 'starting',
        pendingMenu: null,
        startedAt: Date.now(),
      };

      set((state) => ({
        chatThreads: { ...state.chatThreads, [invocationId]: thread },
        activeChatId: invocationId,
      }));

      try {
        const resp = await bmad().runHelpAI({
          projectRoot: activeProjectRoot,
          track: args.track ?? track,
          ...(args.question ? { question: args.question } : {}),
          invocationId,
          activeProfile,
        });

        if (!resp.success) {
          set((state) => {
            const t = state.chatThreads[invocationId];
            if (!t) return state;
            return {
              chatThreads: {
                ...state.chatThreads,
                [invocationId]: {
                  ...t,
                  status: 'errored',
                  error: resp.error.message,
                  endedAt: Date.now(),
                },
              },
              lastError: resp.error.message,
            };
          });
          return { success: false, invocationId, error: resp.error.message };
        }
        // runHelpAI is fire-and-forget — completion arrives via the
        // 'done' stream chunk. Nothing else to do here.
        return { success: true, invocationId };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'startHelpAI failed';
        set((state) => {
          const t = state.chatThreads[invocationId];
          if (!t) return state;
          return {
            chatThreads: {
              ...state.chatThreads,
              [invocationId]: {
                ...t,
                status: 'errored',
                error: message,
                endedAt: Date.now(),
              },
            },
            lastError: message,
          };
        });
        return { success: false, invocationId, error: message };
      }
    },

    respondToMenu: async (invocationId, choice) => {
      const thread = get().chatThreads[invocationId];
      if (!thread || !thread.pendingMenu) {
        return { success: false, error: 'No pending menu' };
      }
      const menuId = thread.pendingMenu.menuId;
      const userText =
        choice.optionCode && choice.text
          ? `${choice.optionCode} ${choice.text}`.trim()
          : choice.text || (choice.optionCode ?? '');

      // Append the user's pick as a chat message and clear the pending menu.
      set((state) => ({
        chatThreads: {
          ...state.chatThreads,
          [invocationId]: {
            ...thread,
            pendingMenu: null,
            status: 'streaming',
            messages: [
              ...thread.messages,
              {
                id: newMessageId(),
                role: 'user',
                content: userText,
                timestamp: Date.now(),
              },
            ],
          },
        },
      }));

      try {
        const resp = await bmad().respondToWorkflowMenu({
          invocationId,
          menuId,
          choice,
        });
        if (!resp.success) {
          set((state) => ({ lastError: resp.error.message }));
          return { success: false, error: resp.error.message };
        }
        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'respondToMenu failed';
        set({ lastError: message });
        return { success: false, error: message };
      }
    },

    selectChat: (invocationId) => set({ activeChatId: invocationId }),

    closeChat: (invocationId) => {
      set((state) => {
        const next = { ...state.chatThreads };
        delete next[invocationId];
        return {
          chatThreads: next,
          activeChatId:
            state.activeChatId === invocationId ? null : state.activeChatId,
          activeInvocation:
            state.activeInvocation?.invocationId === invocationId
              ? null
              : state.activeInvocation,
        };
      });
    },

    setPreferredPersona: (slug) => set({ preferredPersona: slug }),

    dismissTutorial: () => {
      writeTutorialDismissed(true);
      set({ tutorialDismissed: true });
    },

    toggleAcceptance: async (storyKey, acIndex, done) => {
      const { activeProjectRoot, storyDetails } = get();
      if (!activeProjectRoot) {
        return { success: false, error: 'No active BMad project' };
      }
      const cached = storyDetails[storyKey];
      if (!cached) {
        return {
          success: false,
          error: `Story '${storyKey}' is not loaded — open it before toggling acceptance.`,
        };
      }
      let nextRaw: string;
      try {
        nextRaw = toggleAcceptanceCriterion(cached.raw, acIndex, done);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to toggle AC';
        return { success: false, error: message };
      }

      // Optimistic cache update before write.
      const optimisticParsed = parseStoryFile(nextRaw, {
        fallbackTitle: cached.parsed.title,
      });
      set((state) => ({
        storyDetails: {
          ...state.storyDetails,
          [storyKey]: {
            ...cached,
            raw: nextRaw,
            parsed: optimisticParsed,
            loadedAt: Date.now(),
          },
        },
      }));

      try {
        const resp = await bmad().writeStoryFile(
          activeProjectRoot,
          cached.storyPath,
          nextRaw,
        );
        if (!resp.success) {
          // Roll back the cache.
          set((state) => ({
            storyDetails: { ...state.storyDetails, [storyKey]: cached },
            lastError: resp.error.message,
          }));
          return { success: false, error: resp.error.message };
        }
        return { success: true };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Unknown writeStoryFile error';
        set((state) => ({
          storyDetails: { ...state.storyDetails, [storyKey]: cached },
          lastError: message,
        }));
        return { success: false, error: message };
      }
    },
  }),
);

// =============================================================================
// Helpers (renderer-side)
// =============================================================================

function pathForKey(parsed: ParsedKey): string | null {
  return speculativeStoryPath(parsed);
}

/**
 * Append a text-delta chunk to the trailing assistant message. Creates a
 * fresh assistant message when the previous one isn't streaming (i.e. the
 * model just halted for a menu and is now starting a new turn).
 */
function appendAssistantDelta(
  messages: readonly BmadChatMessage[],
  text: string,
  personaSlug: BmadPersonaSlug | undefined,
): readonly BmadChatMessage[] {
  const last = messages[messages.length - 1];
  if (last && last.role === 'assistant' && last.streaming) {
    const updated: BmadChatMessage = {
      ...last,
      content: last.content + text,
    };
    return [...messages.slice(0, -1), updated];
  }
  const next: BmadChatMessage = {
    id: newMessageId(),
    role: 'assistant',
    content: text,
    ...(personaSlug ? { personaSlug } : {}),
    timestamp: Date.now(),
    streaming: true,
  };
  return [...messages, next];
}

/**
 * Append a UI-only system message (step transitions, tool calls, errors).
 */
function appendSystemMessage(
  messages: readonly BmadChatMessage[],
  text: string,
): readonly BmadChatMessage[] {
  return [
    ...messages,
    {
      id: newMessageId(),
      role: 'system',
      content: text,
      timestamp: Date.now(),
    },
  ];
}

/**
 * Render a tool-call chunk as a compact human-readable string.
 */
function describeToolCall(chunk: BmadWorkflowStreamChunk): string {
  const tool = chunk.toolName ?? 'tool';
  const args = chunk.toolArgs ?? {};
  if (
    (tool === 'Read' || tool === 'Write' || tool === 'Edit') &&
    typeof (args as { file_path?: unknown }).file_path === 'string'
  ) {
    return `${tool} ${(args as { file_path: string }).file_path}`;
  }
  if (tool === 'Bash' && typeof (args as { command?: unknown }).command === 'string') {
    const cmd = (args as { command: string }).command;
    const trimmed = cmd.length > 80 ? `${cmd.slice(0, 77)}…` : cmd;
    return `Bash ${trimmed}`;
  }
  if (
    (tool === 'Glob' || tool === 'Grep') &&
    typeof (args as { pattern?: unknown }).pattern === 'string'
  ) {
    return `${tool} ${(args as { pattern: string }).pattern}`;
  }
  return tool;
}

/**
 * Build the partial state update that rolls back an optimistic status
 * override. Used when a workflow start fails — the optimistic 'in-progress'
 * paint gets undone so the kanban returns the card to its prior column.
 */
function rollbackOptimisticStatus(
  state: BmadStoreState,
  storyKey: string,
): Partial<BmadStoreState> {
  if (!(storyKey in state.optimisticStatus)) return {};
  const next = { ...state.optimisticStatus };
  delete next[storyKey];
  return { optimisticStatus: next };
}

/**
 * Compute the displayed status for a story key. Optimistic overrides win
 * until the file watcher reconciles back to YAML.
 */
export function selectDisplayedStatus(
  state: BmadStoreState,
  storyKey: string,
): BmadDevelopmentStatus | null {
  const override = state.optimisticStatus[storyKey];
  if (override) return override;
  return state.sprintStatus?.developmentStatus[storyKey] ?? null;
}

/**
 * Selector: epic groups derived from sprint status + story-file titles
 * (when we have them in cache).
 */
export function selectEpicViews(state: BmadStoreState) {
  const titleOverrides = new Map<string, string>();
  for (const [k, detail] of Object.entries(state.storyDetails)) {
    titleOverrides.set(k, detail.parsed.title);
  }
  // Apply optimistic overrides on top of the sprint-status snapshot before
  // grouping so the kanban paints the new column instantly.
  const merged = state.sprintStatus
    ? {
        ...state.sprintStatus,
        developmentStatus: {
          ...state.sprintStatus.developmentStatus,
          ...state.optimisticStatus,
        },
      }
    : null;
  return groupSprintStatusIntoEpics(merged, { titleOverrides });
}

export function selectActiveStoryDetail(
  state: BmadStoreState,
): BmadStoryDetailEntry | null {
  if (!state.activeStoryKey) return null;
  return state.storyDetails[state.activeStoryKey] ?? null;
}
