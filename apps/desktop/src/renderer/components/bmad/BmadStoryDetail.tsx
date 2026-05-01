/**
 * BmadStoryDetail — Phase 3 deliverable §3
 *
 * Slide-in panel that opens when the user clicks a kanban card. Renders:
 *   - the story file's H1 title + status pill
 *   - the user-story narrative ("As a … I want … so that …")
 *   - acceptance-criteria checkboxes that write back to the story file
 *   - all remaining markdown (Tasks, Dev Notes, File List, Change Log)
 *
 * Per `<engineering_standards>` "Crash-safe writes" the toggle path uses
 * the BMad store's `toggleAcceptance` which calls
 * `BmadAPI.writeStoryFile` (atomic temp+rename). Optimistic checkbox
 * updates roll back on failure — error surfaces via store.lastError.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '../../lib/utils';
import {
  selectActiveStoryDetail,
  useBmadStore,
} from '../../stores/bmad-store';
import { parseSprintStatusKey } from '../../../shared/types/bmad-kanban-helpers';
import type {
  BmadDevelopmentStatus,
  BmadPersonaIdentity,
} from '../../../shared/types/bmad';

interface BmadStoryDetailProps {
  /** Persona records keyed by slug for owner badge. */
  readonly personas: ReadonlyMap<string, BmadPersonaIdentity>;
  /** Optional callback invoked when the user clicks "Run". */
  readonly onRunStory?: (storyKey: string) => void;
  readonly className?: string;
}

export function BmadStoryDetail({
  personas,
  onRunStory,
  className,
}: BmadStoryDetailProps) {
  const { t } = useTranslation('bmad');
  const activeStoryKey = useBmadStore((s) => s.activeStoryKey);
  const detail = useBmadStore(selectActiveStoryDetail);
  const sprintStatus = useBmadStore((s) => s.sprintStatus);
  const optimisticStatus = useBmadStore((s) => s.optimisticStatus);
  const closeStoryDetail = useBmadStore((s) => s.closeStoryDetail);
  const toggleAcceptance = useBmadStore((s) => s.toggleAcceptance);

  const [pendingAcIndex, setPendingAcIndex] = useState<number | null>(null);

  if (!activeStoryKey) return null;

  const parsedKey = parseSprintStatusKey(activeStoryKey);
  const status: BmadDevelopmentStatus | null =
    optimisticStatus[activeStoryKey] ??
    sprintStatus?.developmentStatus[activeStoryKey] ??
    null;

  const personaSlug =
    parsedKey.kind === 'story' || parsedKey.kind === 'retro'
      ? 'amelia'
      : null;
  const persona = personaSlug ? personas.get(personaSlug) ?? null : null;

  const fallbackTitle =
    parsedKey.kind === 'story'
      ? `${parsedKey.epicNumber}.${parsedKey.storyNumber} ${parsedKey.slug}`
      : activeStoryKey;
  const title = detail?.parsed.title ?? fallbackTitle;

  const handleToggle = async (acIndex: number, done: boolean) => {
    setPendingAcIndex(acIndex);
    try {
      await toggleAcceptance(activeStoryKey, acIndex, done);
    } finally {
      setPendingAcIndex(null);
    }
  };

  const handleClose = () => closeStoryDetail();

  return (
    <aside
      role="complementary"
      aria-label={t('kanban.storyDetailAriaLabel')}
      data-testid="bmad-story-detail"
      className={cn(
        'fixed inset-y-0 right-0 z-50 flex w-[28rem] max-w-full flex-col border-l border-border bg-card shadow-xl',
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3 border-b border-border p-4">
        <div className="min-w-0 space-y-1">
          <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            {parsedKey.kind === 'story'
              ? `${parsedKey.epicNumber}.${parsedKey.storyNumber}`
              : parsedKey.kind === 'retro'
                ? t('kanban.retrospectiveBadge')
                : activeStoryKey}
          </p>
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {status && (
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
                  statusBadgeClass(status),
                )}
              >
                {t(`sprintStatus.developmentStatus.${status}`)}
              </span>
            )}
            {persona && (
              <span
                className="flex items-center gap-1"
                title={`${persona.name} — ${persona.title}`}
              >
                <span aria-hidden="true">{persona.icon}</span>
                <span>
                  {persona.name} · {persona.title}
                </span>
              </span>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleClose}
          aria-label={t('kanban.closeStoryDetailAriaLabel')}
          className="shrink-0"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </header>

      <ScrollArea className="flex-1">
        <div className="space-y-6 p-4">
          {!detail && parsedKey.kind === 'story' && (
            <p className="text-sm text-muted-foreground">
              {t('kanban.storyFileMissing')}
            </p>
          )}
          {!detail && parsedKey.kind !== 'story' && (
            <p className="text-sm text-muted-foreground">
              {t('kanban.retrospectiveDescription')}
            </p>
          )}

          {detail?.parsed.storyText && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t('kanban.storyNarrative')}
              </h3>
              <div className="rounded-md border border-white/5 bg-secondary/20 p-3 text-sm leading-relaxed text-foreground">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {detail.parsed.storyText}
                </ReactMarkdown>
              </div>
            </section>
          )}

          {detail && detail.parsed.acceptanceCriteria.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t('kanban.acceptanceCriteria')}
              </h3>
              <ul
                className="space-y-2"
                data-testid="bmad-story-acceptance-criteria"
              >
                {detail.parsed.acceptanceCriteria.map((ac) => {
                  const isPending = pendingAcIndex === ac.index;
                  return (
                    <li
                      key={ac.index}
                      className="flex items-start gap-2"
                      data-testid={`bmad-story-ac-${ac.index}`}
                    >
                      <Checkbox
                        id={`bmad-ac-${ac.index}`}
                        checked={ac.done}
                        disabled={isPending}
                        onCheckedChange={(checked) =>
                          handleToggle(ac.index, checked === true)
                        }
                        aria-label={t('kanban.acceptanceToggleAriaLabel', {
                          index: ac.index,
                          text: ac.text,
                        })}
                        className="mt-0.5"
                      />
                      <label
                        htmlFor={`bmad-ac-${ac.index}`}
                        className={cn(
                          'flex-1 cursor-pointer text-sm leading-snug',
                          ac.done && 'line-through text-muted-foreground',
                        )}
                      >
                        <span className="mr-1 font-mono text-[10px] text-muted-foreground">
                          AC{ac.index}
                        </span>
                        {ac.text}
                      </label>
                      {isPending && (
                        <Loader2
                          className="h-3 w-3 animate-spin text-muted-foreground"
                          aria-hidden="true"
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {detail?.parsed.bodyMarkdown && (
            <section className="prose prose-sm prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {detail.parsed.bodyMarkdown}
              </ReactMarkdown>
            </section>
          )}
        </div>
      </ScrollArea>

      {onRunStory && parsedKey.kind === 'story' && (
        <footer className="border-t border-border p-3">
          <Button
            className="w-full"
            onClick={() => onRunStory(activeStoryKey)}
            disabled={!status || status === 'done'}
          >
            <Check className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('kanban.runStoryWorkflow')}
          </Button>
        </footer>
      )}
    </aside>
  );
}

// =============================================================================
// Status badge styles
// =============================================================================

function statusBadgeClass(status: BmadDevelopmentStatus): string {
  switch (status) {
    case 'backlog':
      return 'bg-muted text-muted-foreground';
    case 'ready-for-dev':
      return 'bg-amber-500/15 text-amber-500';
    case 'in-progress':
      return 'bg-info/15 text-info';
    case 'review':
      return 'bg-purple-500/15 text-purple-400';
    case 'done':
      return 'bg-success/15 text-success';
    case 'optional':
      return 'bg-muted/50 text-muted-foreground';
  }
}
