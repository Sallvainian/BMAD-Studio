/**
 * BmadKanbanBoard — the headline differentiator (Phase 3 deliverable §1).
 *
 * Five columns sourced verbatim from BMAD's `sprint-status.yaml` schema
 * per ENGINE_SWAP_PROMPT.md KAD-8 + the canonical template at
 * `~/Projects/BMAD-Install-Files/.agents/skills/bmad-sprint-planning/sprint-status-template.yaml`:
 *
 *   Backlog | Ready for Dev | In Progress | Review | Done
 *
 * Plus a collapsed "Optional" lane below the board for retrospectives
 * (per the template's `Retrospective Status: optional | done`).
 *
 * Cards group under epic headers (collapsible). Drag-and-drop uses
 * `@dnd-kit/core` (already a workspace dependency). Drop on a column fires
 * `setStoryStatus(key, columnId)` which updates the store optimistically
 * and writes the new YAML; the file-watcher emits `sprint-status-changed`
 * which reconciles the store back to disk truth.
 *
 * Phase progress (`BmadPhaseProgress`) sits above the board and helps the
 * user see how far the project is into the four-phase BMAD lifecycle.
 *
 * Per `<engineering_standards>`: no `console.log`, all chrome i18n'd, ARIA
 * roles on the board (`role="application"`), columns (`role="region"`),
 * cards (`role="article"`).
 */

import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useDroppable,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { cn } from '../../lib/utils';
import { ScrollArea } from '../ui/scroll-area';
import {
  BMAD_KANBAN_COLUMNS,
  type BmadDevelopmentStatus,
  type BmadEpicView,
  type BmadKanbanColumnId,
  type BmadPersonaIdentity,
  type BmadStoryView,
} from '../../../shared/types/bmad';
import { BmadPhaseProgress } from './BmadPhaseProgress';
import { BmadStoryCard } from './BmadStoryCard';

// =============================================================================
// Types
// =============================================================================

interface BmadKanbanBoardProps {
  readonly epics: readonly BmadEpicView[];
  readonly displayedStatus: (storyKey: string) => BmadDevelopmentStatus | null;
  /** Optional skeleton state — paints empty columns with placeholders. */
  readonly isLoading?: boolean;
  /** Renderer-displayable error string from the store. */
  readonly error?: string | null;
  /** Persona records keyed by slug for icon lookup. */
  readonly personas: ReadonlyMap<string, BmadPersonaIdentity>;
  /** Move-to-status callback (drag drop or keyboard). */
  readonly onMoveStory: (
    storyKey: string,
    nextColumn: BmadKanbanColumnId,
  ) => Promise<{ success: boolean; error?: string }>;
  /** Open the detail slide-in. */
  readonly onSelectStory: (storyKey: string) => void;
  /** Invoke the next workflow for a story (Run button). */
  readonly onRunStory: (storyKey: string) => void;
  /** Currently-running invocation (story key). */
  readonly runningStoryKey?: string | null;
  /** Current phase from orchestrator — drives the phase progress strip. */
  readonly currentPhase?: import('../../../shared/types/bmad').BmadPhase;
}

// =============================================================================
// Component
// =============================================================================

export function BmadKanbanBoard({
  epics,
  displayedStatus,
  isLoading,
  error,
  personas,
  onMoveStory,
  onSelectStory,
  onRunStory,
  runningStoryKey,
  currentPhase,
}: BmadKanbanBoardProps) {
  const { t } = useTranslation('bmad');

  const [activeDragStory, setActiveDragStory] = useState<BmadStoryView | null>(
    null,
  );
  const [collapsedEpics, setCollapsedEpics] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [optionalLaneCollapsed, setOptionalLaneCollapsed] = useState(true);

  // Story-key → BmadStoryView lookup used by the drag overlay + drag-start.
  const storiesByKey = useMemo(() => {
    const map = new Map<string, BmadStoryView>();
    for (const epic of epics) {
      for (const story of epic.stories) {
        map.set(story.key, story);
      }
      if (epic.retro) map.set(epic.retro.key, epic.retro);
    }
    return map;
  }, [epics]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // ─── Cards per column ─────────────────────────────────────────────────
  const storyCards = useMemo(() => {
    return epics.flatMap((epic) =>
      epic.stories.map((story) => ({ story, epic })),
    );
  }, [epics]);

  const cardsByColumn = useMemo(() => {
    const buckets: Record<BmadKanbanColumnId, Array<{
      story: BmadStoryView;
      epic: BmadEpicView;
    }>> = {
      backlog: [],
      'ready-for-dev': [],
      'in-progress': [],
      review: [],
      done: [],
    };
    for (const card of storyCards) {
      const status = displayedStatus(card.story.key);
      if (!status || status === 'optional') continue;
      const column = status as BmadKanbanColumnId;
      if (column in buckets) {
        buckets[column].push(card);
      }
    }
    // Sort by epic number then story number for deterministic rendering.
    for (const col of BMAD_KANBAN_COLUMNS) {
      buckets[col].sort((a, b) => {
        if (a.epic.epicNumber !== b.epic.epicNumber) {
          return a.epic.epicNumber - b.epic.epicNumber;
        }
        const aOrder = a.story.orderInEpic;
        const bOrder = b.story.orderInEpic;
        return aOrder - bOrder;
      });
    }
    return buckets;
  }, [storyCards, displayedStatus]);

  const optionalCards = useMemo(() => {
    const out: BmadStoryView[] = [];
    for (const epic of epics) {
      if (epic.retro) out.push(epic.retro);
    }
    return out.sort((a, b) => a.epicNumber - b.epicNumber);
  }, [epics]);

  // ─── Drag handlers ─────────────────────────────────────────────────────
  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const id = String(event.active.id);
      setActiveDragStory(storiesByKey.get(id) ?? null);
    },
    [storiesByKey],
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveDragStory(null);
      if (!over) return;
      const overId = String(over.id);
      const storyKey = String(active.id);

      // Resolve drop target — column id directly, or another card's column.
      let targetColumn: BmadKanbanColumnId | null = null;
      if (BMAD_KANBAN_COLUMNS.includes(overId as BmadKanbanColumnId)) {
        targetColumn = overId as BmadKanbanColumnId;
      } else {
        const overStatus = displayedStatus(overId);
        if (overStatus && BMAD_KANBAN_COLUMNS.includes(overStatus as BmadKanbanColumnId)) {
          targetColumn = overStatus as BmadKanbanColumnId;
        }
      }
      if (!targetColumn) return;

      const currentStatus = displayedStatus(storyKey);
      if (currentStatus === targetColumn) return;

      await onMoveStory(storyKey, targetColumn);
    },
    [displayedStatus, onMoveStory],
  );

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col" data-testid="bmad-kanban-board">
      {currentPhase && (
        <div className="px-6 pt-4">
          <BmadPhaseProgress currentPhase={currentPhase} />
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mx-6 mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div
          role="application"
          aria-label={t('kanban.boardAriaLabel')}
          className="flex flex-1 gap-4 overflow-x-auto p-6 min-h-0"
        >
          {BMAD_KANBAN_COLUMNS.map((column) => (
            <KanbanColumn
              key={column}
              column={column}
              cards={cardsByColumn[column]}
              displayedStatus={displayedStatus}
              isLoading={isLoading}
              personas={personas}
              collapsedEpics={collapsedEpics}
              onToggleEpic={(epicId) =>
                setCollapsedEpics((prev) => {
                  const next = new Set(prev);
                  if (next.has(epicId)) {
                    next.delete(epicId);
                  } else {
                    next.add(epicId);
                  }
                  return next;
                })
              }
              onSelectStory={onSelectStory}
              onRunStory={onRunStory}
              runningStoryKey={runningStoryKey ?? null}
            />
          ))}
        </div>

        <DragOverlay>
          {activeDragStory ? (
            <div className="rotate-2 shadow-2xl">
              <BmadStoryCard
                story={activeDragStory}
                status={
                  displayedStatus(activeDragStory.key) ?? activeDragStory.status
                }
                persona={
                  activeDragStory.persona
                    ? personas.get(activeDragStory.persona) ?? null
                    : null
                }
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Optional lane (collapsed by default) */}
      {optionalCards.length > 0 && (
        <div
          className="border-t border-white/5 px-6 py-3"
          data-testid="bmad-optional-lane"
        >
          <button
            type="button"
            className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
            aria-expanded={!optionalLaneCollapsed}
            onClick={() => setOptionalLaneCollapsed((v) => !v)}
          >
            {optionalLaneCollapsed ? (
              <ChevronRight className="h-3 w-3" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-3 w-3" aria-hidden="true" />
            )}
            {t('kanban.optionalLaneLabel', { count: optionalCards.length })}
          </button>
          {!optionalLaneCollapsed && (
            <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
              {optionalCards.map((retro) => {
                const status = displayedStatus(retro.key) ?? retro.status;
                return (
                  <BmadStoryCard
                    key={retro.key}
                    story={retro}
                    status={status}
                    persona={
                      retro.persona ? personas.get(retro.persona) ?? null : null
                    }
                    onSelect={onSelectStory}
                    onRun={onRunStory}
                    isRunning={runningStoryKey === retro.key}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Column
// =============================================================================

interface KanbanColumnProps {
  readonly column: BmadKanbanColumnId;
  readonly cards: ReadonlyArray<{ story: BmadStoryView; epic: BmadEpicView }>;
  readonly displayedStatus: (storyKey: string) => BmadDevelopmentStatus | null;
  readonly isLoading?: boolean;
  readonly personas: ReadonlyMap<string, BmadPersonaIdentity>;
  readonly collapsedEpics: ReadonlySet<string>;
  readonly onToggleEpic: (epicId: string) => void;
  readonly onSelectStory: (storyKey: string) => void;
  readonly onRunStory: (storyKey: string) => void;
  readonly runningStoryKey: string | null;
}

function KanbanColumn({
  column,
  cards,
  displayedStatus,
  isLoading,
  personas,
  collapsedEpics,
  onToggleEpic,
  onSelectStory,
  onRunStory,
  runningStoryKey,
}: KanbanColumnProps) {
  const { t } = useTranslation('bmad');
  const { setNodeRef, isOver } = useDroppable({
    id: column,
    data: { type: 'bmad-column', column },
  });

  // Group cards by epic for collapsible headers.
  const grouped = useMemo(() => {
    const map = new Map<
      string,
      { epic: BmadEpicView; cards: BmadStoryView[] }
    >();
    for (const { story, epic } of cards) {
      const entry = map.get(epic.id);
      if (entry) {
        entry.cards.push(story);
      } else {
        map.set(epic.id, { epic, cards: [story] });
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => a.epic.epicNumber - b.epic.epicNumber,
    );
  }, [cards]);

  const allItemIds = useMemo(
    () => cards.map(({ story }) => story.key),
    [cards],
  );

  return (
    <section
      role="region"
      aria-label={t('kanban.columnAriaLabel', {
        name: t(`sprintStatus.developmentStatus.${column}`),
        count: cards.length,
      })}
      ref={setNodeRef}
      data-testid={`bmad-kanban-column-${column}`}
      data-column={column}
      data-over={isOver ? 'true' : undefined}
      className={cn(
        'flex flex-col rounded-xl border border-white/5 bg-linear-to-b from-secondary/20 to-transparent backdrop-blur-sm min-w-72 max-w-96 flex-1 transition-colors',
        getColumnAccent(column),
        'border-t-2',
        isOver && 'bg-primary/5 ring-2 ring-primary/40',
      )}
    >
      <header className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">
            {t(`sprintStatus.developmentStatus.${column}`)}
          </h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {cards.length}
          </span>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        <ScrollArea className="h-full">
          <SortableContext
            items={allItemIds}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-3 p-3">
              {isLoading && cards.length === 0 && (
                <>
                  <BmadStoryCard
                    skeleton
                    story={skeletonStory(`skel-${column}-1`)}
                    status="backlog"
                    persona={null}
                  />
                  <BmadStoryCard
                    skeleton
                    story={skeletonStory(`skel-${column}-2`)}
                    status="backlog"
                    persona={null}
                  />
                </>
              )}
              {!isLoading && cards.length === 0 && (
                <EmptyDropTarget label={t(`kanban.empty.${column}`)} />
              )}
              {grouped.map(({ epic, cards: epicCards }) => {
                const collapsed = collapsedEpics.has(epic.id);
                return (
                  <div
                    key={epic.id}
                    className="space-y-2"
                    data-testid={`bmad-kanban-epic-${epic.id}`}
                  >
                    <button
                      type="button"
                      onClick={() => onToggleEpic(epic.id)}
                      aria-expanded={!collapsed}
                      className="flex w-full items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                    >
                      {collapsed ? (
                        <ChevronRight
                          className="h-3 w-3"
                          aria-hidden="true"
                        />
                      ) : (
                        <ChevronDown
                          className="h-3 w-3"
                          aria-hidden="true"
                        />
                      )}
                      <span className="truncate">{epic.title}</span>
                      <span className="ml-auto text-[10px] font-mono text-muted-foreground/70">
                        {epicCards.length}
                      </span>
                    </button>
                    {!collapsed &&
                      epicCards.map((story) => {
                        const status =
                          displayedStatus(story.key) ?? story.status;
                        return (
                          <BmadStoryCard
                            key={story.key}
                            story={story}
                            status={status}
                            persona={
                              story.persona
                                ? personas.get(story.persona) ?? null
                                : null
                            }
                            onSelect={onSelectStory}
                            onRun={onRunStory}
                            isRunning={runningStoryKey === story.key}
                          />
                        );
                      })}
                  </div>
                );
              })}
            </div>
          </SortableContext>
        </ScrollArea>
      </div>
    </section>
  );
}

// =============================================================================
// Empty state
// =============================================================================

function EmptyDropTarget({ label }: { label: string }) {
  return (
    <div
      role="presentation"
      className="flex min-h-32 flex-col items-center justify-center rounded-md border-2 border-dashed border-border bg-card/30 p-6 text-center text-xs text-muted-foreground"
    >
      {label}
    </div>
  );
}

function getColumnAccent(column: BmadKanbanColumnId): string {
  switch (column) {
    case 'backlog':
      return 'border-t-muted-foreground/30';
    case 'ready-for-dev':
      return 'border-t-amber-500/50';
    case 'in-progress':
      return 'border-t-info/60';
    case 'review':
      return 'border-t-purple-500/50';
    case 'done':
      return 'border-t-success/60';
    default:
      return 'border-t-muted-foreground/30';
  }
}

function skeletonStory(key: string): BmadStoryView {
  return {
    key,
    kind: 'story',
    epicId: 'epic-1',
    epicNumber: 1,
    storyNumber: 1,
    slug: 'loading',
    title: '',
    status: 'backlog',
    persona: 'amelia',
    storyFilePath: null,
    orderInEpic: 0,
  };
}
