import { useEffect, useRef } from 'react';
import { useProjectStore } from '../stores/project-store';
import { reconcileTasks } from '../stores/task-store';

/** Minimum time the window must be hidden before triggering reconciliation on return */
const MIN_HIDDEN_DURATION_MS = 5_000;

/**
 * Side-effect hook that reconciles task state from disk when the window
 * becomes visible after being hidden for >5 seconds.
 *
 * This fixes the bug where tasks get stuck showing "running" after the agent
 * finishes, because the IPC status-change event was missed while the window
 * was not ready (minimized, backgrounded, renderer not mounted, etc.).
 */
export function useTaskReconciliation(): void {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const selectedProjectId = useProjectStore((s) => s.selectedProjectId);
  const hiddenAtRef = useRef<number>(0);

  useEffect(() => {
    const projectId = activeProjectId || selectedProjectId;
    if (!projectId) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        hiddenAtRef.current = Date.now();
      } else if (hiddenAtRef.current > 0) {
        const hiddenDuration = Date.now() - hiddenAtRef.current;
        hiddenAtRef.current = 0;

        if (hiddenDuration >= MIN_HIDDEN_DURATION_MS) {
          reconcileTasks(projectId);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [activeProjectId, selectedProjectId]);
}
