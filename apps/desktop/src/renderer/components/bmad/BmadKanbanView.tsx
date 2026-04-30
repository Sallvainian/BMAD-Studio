/**
 * BmadKanbanView — Phase 3 wrapper component
 *
 * Mounts the BMad Kanban + slide-in story detail for the active project.
 * Bridges the Zustand store (via `useBmadProject`) to the dumb
 * presentational components (`BmadKanbanBoard`, `BmadStoryDetail`).
 *
 * Self-contained: drop this into the App's view-router and it handles
 * loading state, file-watcher subscription, drag-drop persistence, and
 * detail-panel open/close. Empty-state copy renders when the project
 * isn't a BMad project (no `_bmad/_config/manifest.yaml`).
 */

import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

import { useBmadProject } from '../../hooks/useBmadProject';
import { useBmadStore } from '../../stores/bmad-store';
import type {
  BmadDevelopmentStatus,
  BmadKanbanColumnId,
  BmadPersonaIdentity,
} from '../../../shared/types/bmad';
import { BmadKanbanBoard } from './BmadKanbanBoard';
import { BmadStoryDetail } from './BmadStoryDetail';

interface BmadKanbanViewProps {
  /** Active project root the workspace tab is currently focused on. */
  readonly projectRoot: string | null;
}

export function BmadKanbanView({ projectRoot }: BmadKanbanViewProps) {
  const { t } = useTranslation('bmad');
  const project = useBmadProject(projectRoot, { track: 'method' });
  const setStoryStatus = useBmadStore((s) => s.setStoryStatus);
  const selectStory = useBmadStore((s) => s.selectStory);
  const personasList = useBmadStore((s) => s.personas);
  const recommendation = useBmadStore((s) => s.recommendation);
  const activeInvocation = useBmadStore((s) => s.activeInvocation);

  const personasMap = useMemo<ReadonlyMap<string, BmadPersonaIdentity>>(() => {
    const map = new Map<string, BmadPersonaIdentity>();
    for (const persona of personasList) {
      map.set(persona.slug, persona);
    }
    return map;
  }, [personasList]);

  const onMoveStory = useCallback(
    async (storyKey: string, nextColumn: BmadKanbanColumnId) => {
      const status: BmadDevelopmentStatus = nextColumn;
      return setStoryStatus(storyKey, status);
    },
    [setStoryStatus],
  );

  const onSelectStory = useCallback(
    (storyKey: string) => {
      void selectStory(storyKey);
    },
    [selectStory],
  );

  const onRunStory = useCallback((_storyKey: string) => {
    // Phase 4 will wire this to the workflow runner via persona chat.
    // For Phase 3 we surface an unobtrusive intent log via the store's
    // active-invocation slot so UI tests can assert the click happened.
    useBmadStore.getState().setActiveInvocation({
      invocationId: `pending-${Date.now()}`,
      storyKey: _storyKey,
      skillName: 'bmad-dev-story',
    });
  }, []);

  // Empty state: not a BMad project (yet)
  if (!projectRoot) {
    return (
      <EmptyState
        title={t('kanban.empty.backlog')}
        description={t('errors.PROJECT_NOT_FOUND')}
      />
    );
  }
  if (project.isLoading) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground"
        data-testid="bmad-kanban-loading"
      >
        <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
        <p className="text-sm">{t('workflow.starting', { skillId: 'BMad' })}</p>
      </div>
    );
  }
  if (!project.isBmadProject) {
    return (
      <EmptyState
        title={t('errors.PROJECT_NOT_BMAD')}
        description={t('errors.SPRINT_STATUS_NOT_FOUND')}
      />
    );
  }

  return (
    <div className="relative flex h-full flex-col">
      <BmadKanbanBoard
        epics={project.epics}
        displayedStatus={project.displayedStatus}
        isLoading={project.isLoading}
        error={project.error}
        personas={personasMap}
        onMoveStory={onMoveStory}
        onSelectStory={onSelectStory}
        onRunStory={onRunStory}
        runningStoryKey={activeInvocation?.storyKey ?? null}
        currentPhase={recommendation?.currentPhase}
      />
      <BmadStoryDetail
        personas={personasMap}
        onRunStory={onRunStory}
      />
    </div>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <h2 className="text-base font-medium text-foreground">{title}</h2>
      <p className="max-w-md text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

