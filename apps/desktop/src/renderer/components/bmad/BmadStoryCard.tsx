/**
 * BmadStoryCard — Phase 3 deliverable §2
 *
 * Renders a single sprint-status row (`{epic}-{story}-{slug}` or
 * `epic-N-retrospective`) as a draggable card:
 *
 *   ┌──────────────────────────────────────┐
 *   │ {epic.story}  Title                  │
 *   │ 💻 Amelia               [▶ Run]      │
 *   └──────────────────────────────────────┘
 *
 * Draggable via `useSortable` from `@dnd-kit/sortable`. Click anywhere
 * outside the Run button opens the slide-in detail panel via
 * `onSelect(storyKey)`.
 *
 * Per BMAD docs § "Default Agents" the persona is always Amelia for
 * story/retro rows; Phase 4's persona-chat panel surfaces a different
 * persona only when explicitly requested.
 */

import { useTranslation } from 'react-i18next';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Play } from 'lucide-react';

import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import type {
  BmadDevelopmentStatus,
  BmadPersonaIdentity,
  BmadStoryView,
} from '../../../shared/types/bmad';

interface BmadStoryCardProps {
  readonly story: BmadStoryView;
  /** Effective status (handles optimistic overrides during drag). */
  readonly status: BmadDevelopmentStatus;
  /** Loaded persona for icon rendering. Falls back to slug initial. */
  readonly persona: BmadPersonaIdentity | null;
  /** True when a workflow invocation is currently running for this story. */
  readonly isRunning?: boolean;
  /** Open the detail panel. */
  readonly onSelect?: (storyKey: string) => void;
  /** Invoke the story's next workflow. */
  readonly onRun?: (storyKey: string) => void;
  /** Skeleton rendering when sprint-status hasn't loaded yet. */
  readonly skeleton?: boolean;
  readonly className?: string;
}

export function BmadStoryCard({
  story,
  status,
  persona,
  isRunning,
  onSelect,
  onRun,
  skeleton,
  className,
}: BmadStoryCardProps) {
  const { t } = useTranslation('bmad');

  // Hooks always run, even in the skeleton variant — React rules-of-hooks
  // forbid calling them after an early return.
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: story.key,
    data: {
      type: 'bmad-story',
      key: story.key,
      kind: story.kind,
      status,
    },
    disabled: skeleton === true,
  });

  if (skeleton) {
    return (
      <div
        aria-hidden="true"
        className={cn(
          'rounded-lg border border-white/5 bg-secondary/20 p-3 animate-pulse',
          className,
        )}
        data-testid="bmad-story-card-skeleton"
      >
        <div className="h-3 w-3/4 rounded bg-muted-foreground/30" />
        <div className="mt-2 h-3 w-1/2 rounded bg-muted-foreground/20" />
      </div>
    );
  }

  const draggableStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const personaLabel = persona
    ? `${persona.icon} ${persona.name}`
    : story.persona
      ? t(`personas.${story.persona}.name`)
      : null;

  const personaIcon = persona?.icon ?? null;

  const epicStoryHandle =
    story.kind === 'story'
      ? `${story.epicNumber}.${story.storyNumber ?? ''}`
      : story.kind === 'retro'
        ? t('kanban.retrospectiveBadge')
        : story.epicId;

  const ariaLabel = t('kanban.cardAriaLabel', {
    handle: epicStoryHandle,
    title: story.title,
    status: t(`sprintStatus.developmentStatus.${status}`),
  });

  // Compose a keyboard handler that runs dnd-kit's first (so Space/arrow
  // keys still trigger drag) and then our Enter→onSelect override.
  const dndKeyDown =
    (listeners as Record<string, ((event: React.KeyboardEvent) => void) | undefined>)?.onKeyDown ??
    null;
  const composedKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    dndKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === 'Enter' && onSelect) {
      event.preventDefault();
      onSelect(story.key);
    }
  };

  // Strip dnd-kit's onKeyDown from `listeners` so our composed wrapper wins.
  const sortableListeners: Record<string, unknown> = { ...(listeners ?? {}) };
  delete sortableListeners.onKeyDown;

  return (
    <article
      ref={setNodeRef}
      data-testid="bmad-story-card"
      data-story-key={story.key}
      data-status={status}
      style={draggableStyle}
      onClick={(event) => {
        // Only fire onSelect when the click didn't originate inside an
        // interactive child (Run button, drag handle).
        const target = event.target as HTMLElement;
        if (target.closest('[data-bmad-no-select]')) return;
        onSelect?.(story.key);
      }}
      className={cn(
        'group relative flex flex-col gap-2 rounded-lg border border-white/5 bg-card p-3 cursor-pointer transition-shadow',
        'hover:border-primary/30 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        isDragging && 'opacity-50 ring-2 ring-primary/40',
        isRunning && 'border-primary/50 shadow-md',
        className,
      )}
      // dnd-kit's spread provides role/tabIndex and pointer/key handlers.
      // Apply our overrides AFTER so a11y label wins, but keep listeners.
      {...attributes}
      {...sortableListeners}
      onKeyDown={composedKeyDown}
      role="article"
      aria-label={ariaLabel}
      tabIndex={0}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            {epicStoryHandle}
          </span>
          <h3 className="text-sm font-medium leading-snug text-foreground line-clamp-2">
            {story.title}
          </h3>
        </div>
        {personaIcon && (
          <span
            aria-label={personaLabel ?? undefined}
            title={personaLabel ?? undefined}
            className="shrink-0 text-lg leading-none"
          >
            {personaIcon}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground truncate">
          {personaLabel ??
            (story.persona
              ? t(`personas.${story.persona}.title`)
              : '')}
        </span>
        {onRun && (
          <Button
            variant="ghost"
            size="sm"
            data-bmad-no-select
            data-testid="bmad-story-run-button"
            disabled={isRunning}
            onClick={(event) => {
              event.stopPropagation();
              onRun(story.key);
            }}
            aria-label={t('kanban.runActionAriaLabel', {
              title: story.title,
            })}
            className="h-7 gap-1.5 px-2 text-xs"
          >
            <Play className="h-3 w-3" aria-hidden="true" />
            {isRunning ? t('kanban.running') : t('kanban.run')}
          </Button>
        )}
      </div>
    </article>
  );
}
