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
  BmadDevelopmentStatus,
  BmadFileEvent,
  BmadHelpRecommendation,
  BmadPersonaIdentity,
  BmadPhaseGraph,
  BmadProjectSummary,
  BmadSprintStatus,
  BmadTrack,
} from '../../shared/types/bmad';
import {
  groupSprintStatusIntoEpics,
  parseSprintStatusKey,
  parseStoryFile,
  speculativeStoryPath,
  toggleAcceptanceCriterion,
  type ParsedKey,
} from '../../shared/types/bmad-kanban-helpers';

type ParsedStory = ReturnType<typeof parseStoryFile>;

const DEFAULT_TRACK: BmadTrack = 'method';

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
};

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
      set({ ...initialState });
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
