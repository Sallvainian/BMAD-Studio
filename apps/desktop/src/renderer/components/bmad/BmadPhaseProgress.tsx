/**
 * BmadPhaseProgress — horizontal phase indicator above the BMad Kanban.
 *
 * Per ENGINE_SWAP_PROMPT.md Phase 3 deliverable §4: shows
 * Analysis ▸ Planning ▸ Solutioning ▸ Implementation. Each segment is
 * keyboard-focusable; clicking emits `onPhaseSelect(phase)` so the parent
 * can swap the workspace view (Phase 4 wires this to a per-phase workflow
 * list view; Phase 3 just renders the kanban regardless of selection).
 *
 * Per BMAD docs § "Understanding BMad" the four numbered phases each gate
 * the next — completion rules live in the orchestrator. The indicator
 * paints "complete" segments before the active one and "pending" after.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';

import { cn } from '../../lib/utils';
import type { BmadPhase } from '../../../shared/types/bmad';

const NUMBERED_PHASES: readonly Exclude<BmadPhase, 'anytime'>[] = [
  '1-analysis',
  '2-planning',
  '3-solutioning',
  '4-implementation',
];

interface BmadPhaseProgressProps {
  /** Current phase the orchestrator says we're in. */
  readonly currentPhase: BmadPhase;
  /** Optional click handler — if omitted, the segments are not interactive. */
  readonly onPhaseSelect?: (phase: Exclude<BmadPhase, 'anytime'>) => void;
  readonly className?: string;
}

type PhaseState = 'complete' | 'active' | 'pending';

function getPhaseState(
  phase: Exclude<BmadPhase, 'anytime'>,
  currentPhase: BmadPhase,
): PhaseState {
  if (currentPhase === 'anytime') {
    // The kanban shouldn't normally land here; treat as analysis.
    return phase === '1-analysis' ? 'active' : 'pending';
  }
  const currentIdx = NUMBERED_PHASES.indexOf(
    currentPhase as Exclude<BmadPhase, 'anytime'>,
  );
  const phaseIdx = NUMBERED_PHASES.indexOf(phase);
  if (phaseIdx < currentIdx) return 'complete';
  if (phaseIdx === currentIdx) return 'active';
  return 'pending';
}

export function BmadPhaseProgress({
  currentPhase,
  onPhaseSelect,
  className,
}: BmadPhaseProgressProps) {
  const { t } = useTranslation('bmad');

  const segments = useMemo(
    () =>
      NUMBERED_PHASES.map((phase) => ({
        phase,
        label: t(`phases.${phase}`),
        state: getPhaseState(phase, currentPhase),
      })),
    [currentPhase, t],
  );

  return (
    <nav
      aria-label={t('kanban.phaseNavigationAriaLabel')}
      className={cn(
        'bmad-phase-progress flex items-center gap-1 px-4 py-2 rounded-lg border border-white/5 bg-card/50',
        className,
      )}
      data-testid="bmad-phase-progress"
    >
      {segments.map((segment, index) => {
        const Tag = onPhaseSelect ? 'button' : 'div';
        return (
          <div
            key={segment.phase}
            className="flex items-center gap-1 flex-1 min-w-0"
          >
            <Tag
              type={onPhaseSelect ? 'button' : undefined}
              onClick={onPhaseSelect ? () => onPhaseSelect(segment.phase) : undefined}
              aria-current={segment.state === 'active' ? 'step' : undefined}
              aria-label={`${t('kanban.phase')}: ${segment.label} (${t(
                `kanban.phaseState.${segment.state}`,
              )})`}
              className={cn(
                'flex items-center gap-2 flex-1 min-w-0 px-3 py-1.5 rounded-md text-sm transition-colors',
                segment.state === 'complete' &&
                  'bg-success/10 text-success font-medium',
                segment.state === 'active' &&
                  'bg-primary/10 text-primary font-semibold',
                segment.state === 'pending' &&
                  'text-muted-foreground',
                onPhaseSelect &&
                  'hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                onPhaseSelect && segment.state === 'pending' && 'cursor-pointer',
              )}
              data-state={segment.state}
              data-phase={segment.phase}
            >
              <span
                className={cn(
                  'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold border',
                  segment.state === 'complete' &&
                    'bg-success/20 text-success border-success/30',
                  segment.state === 'active' &&
                    'bg-primary/20 text-primary border-primary/30',
                  segment.state === 'pending' &&
                    'bg-muted text-muted-foreground border-border',
                )}
                aria-hidden="true"
              >
                {segment.state === 'complete' ? (
                  <Check className="h-3 w-3" />
                ) : (
                  index + 1
                )}
              </span>
              <span className="truncate">{segment.label}</span>
            </Tag>
            {index < segments.length - 1 && (
              <span
                aria-hidden="true"
                className={cn(
                  'h-px flex-1 min-w-2 mx-1',
                  segment.state !== 'pending' ? 'bg-success/30' : 'bg-border',
                )}
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}
