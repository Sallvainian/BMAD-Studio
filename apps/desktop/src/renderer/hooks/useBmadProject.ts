/**
 * useBmadProject — Phase 3 reactive hook for the BMad Kanban.
 *
 * Loads a project into `useBmadStore` on mount, subscribes to file-watcher
 * events for the lifetime of the component, tears down on unmount.
 *
 * Per ENGINE_SWAP_PROMPT.md Phase 3 deliverable §7 — `useBmadProject`
 * returns `{ project, sprintStatus, storyFiles, epicFiles, phaseGraph,
 * isLoading, error }` for any active project. This hook returns the
 * Zustand-selected slice + helpers; the Kanban consumes it directly.
 *
 * Per KAD-2 ("filesystem is the contract") the hook never caches anything
 * the store doesn't — the store reconciles on every watcher event.
 */

import { useEffect, useMemo } from 'react';

import {
  selectDisplayedStatus,
  selectEpicViews,
  useBmadStore,
} from '../stores/bmad-store';
import type { BmadTrack } from '../../shared/types/bmad';

export interface UseBmadProjectResult {
  /** True while the initial parallel fetch + watcher start is in flight. */
  readonly isLoading: boolean;
  /** True after detection completes and the project has a `_bmad/` tree. */
  readonly isBmadProject: boolean;
  /** Renderer-displayable error string (translated upstream when shown). */
  readonly error: string | null;
  /** Active project root (matches the input to the hook). */
  readonly projectRoot: string | null;
  /** Grouped epic + story view tree. Empty when no sprint-status exists. */
  readonly epics: ReturnType<typeof selectEpicViews>;
  /** Computed effective status for a given key (handles optimistic overrides). */
  readonly displayedStatus: (storyKey: string) => ReturnType<
    typeof selectDisplayedStatus
  >;
}

/**
 * Memoized epics selector. The base selector returns a new array on every
 * call, which would loop with React 19 + Zustand's `Object.is` equality.
 * Subscribe to the *atoms* the grouper depends on, then recompute via
 * `useMemo` so the array identity is stable across unrelated store updates.
 */
function useEpicViews(): ReturnType<typeof selectEpicViews> {
  const sprintStatus = useBmadStore((s) => s.sprintStatus);
  const optimisticStatus = useBmadStore((s) => s.optimisticStatus);
  const storyDetails = useBmadStore((s) => s.storyDetails);
  return useMemo(
    () =>
      selectEpicViews({
        sprintStatus,
        optimisticStatus,
        storyDetails,
        // Other state slices are unused by the selector — pass minimal stub.
      } as unknown as Parameters<typeof selectEpicViews>[0]),
    [sprintStatus, optimisticStatus, storyDetails],
  );
}

/**
 * Subscribe a component to a BMad project. Pass `null` to load nothing —
 * useful when the active sidebar view is not the kanban yet.
 */
export function useBmadProject(
  projectRoot: string | null,
  options: { track?: BmadTrack } = {},
): UseBmadProjectResult {
  const loadProject = useBmadStore((s) => s.loadProject);
  const unloadProject = useBmadStore((s) => s.unloadProject);
  const applyFileEvent = useBmadStore((s) => s.applyFileEvent);

  const activeProjectRootSelector = useBmadStore((s) => s.activeProjectRoot);
  const loadStatus = useBmadStore((s) => s.loadStatus);
  const lastError = useBmadStore((s) => s.lastError);
  const projectSummary = useBmadStore((s) => s.projectSummary);

  const track = options.track ?? 'method';

  // Load + reload when the project root changes. We intentionally read the
  // store imperatively for `activeProjectRoot` so this effect doesn't re-run
  // every time the store updates — that would deadlock with `loadProject`
  // (which mutates `activeProjectRoot`).
  useEffect(() => {
    if (!projectRoot) {
      const current = useBmadStore.getState();
      if (current.activeProjectRoot) {
        void unloadProject();
      }
      return;
    }
    void loadProject(projectRoot, track);
    // unloadProject is intentionally NOT called on cleanup — switching
    // projects calls loadProject which reuses the same store; the watcher
    // is restarted via the IPC handler's idempotent guard.
  }, [projectRoot, track, loadProject, unloadProject]);

  // Subscribe to watcher events for the active project's lifetime.
  useEffect(() => {
    if (!projectRoot) return;
    const cleanup = window.electronAPI.bmad.onFileEvent((event) => {
      if (event.projectRoot !== projectRoot) return;
      void applyFileEvent(event);
    });
    return cleanup;
  }, [projectRoot, applyFileEvent]);

  // Final teardown when the consumer unmounts entirely.
  useEffect(() => {
    return () => {
      // Only unload if THIS hook owns the active project — switching
      // between two consumers shouldn't kill state mid-flight.
      const current = useBmadStore.getState();
      if (current.activeProjectRoot === projectRoot) {
        void unloadProject();
      }
    };
  }, [projectRoot, unloadProject]);

  const epics = useEpicViews();

  const displayedStatus = useMemo(
    () => (storyKey: string) =>
      selectDisplayedStatus(useBmadStore.getState(), storyKey),
    [],
  );

  return {
    isLoading: loadStatus === 'loading' || loadStatus === 'idle',
    isBmadProject: projectSummary?.isBmadProject ?? false,
    error: lastError,
    projectRoot: activeProjectRootSelector,
    epics,
    displayedStatus,
  };
}
