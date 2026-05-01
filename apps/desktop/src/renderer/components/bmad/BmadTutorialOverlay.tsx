/**
 * BmadTutorialOverlay — Phase 4 deliverable §5
 *
 * First-launch onboarding overlay. Three skippable cards spotlight the
 * three primary surfaces every BMad user needs to know about:
 *
 *   1. BMad-Help sidebar — "what now?" companion (per BMAD docs §
 *      "Meet BMad-Help: Your Intelligent Guide")
 *   2. Persona chat — talk to Mary/John/Winston/Sally/Paige/Amelia
 *      (per BMAD docs § "What Named Agents Buy You")
 *   3. Kanban drag-and-drop — sprint-status writes flow back to YAML
 *      (per BMAD docs § "The Build Cycle" + KAD-8)
 *
 * Persisted via `tutorialDismissed` in `bmad-store` (localStorage-backed)
 * so dismissal survives app restarts. The store rehydrates from
 * localStorage on every `unloadProject` reset so project-switch flicker
 * doesn't re-show it.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, ChevronRight, Sparkles } from 'lucide-react';

import { Button } from '../ui/button';
import { useBmadStore } from '../../stores/bmad-store';
import { cn } from '../../lib/utils';

interface BmadTutorialOverlayProps {
  readonly className?: string;
}

interface TutorialStep {
  readonly titleKey: string;
  readonly descriptionKey: string;
}

const STEPS: readonly TutorialStep[] = [
  { titleKey: 'tutorial.step1Title', descriptionKey: 'tutorial.step1Description' },
  { titleKey: 'tutorial.step2Title', descriptionKey: 'tutorial.step2Description' },
  { titleKey: 'tutorial.step3Title', descriptionKey: 'tutorial.step3Description' },
];

export function BmadTutorialOverlay({ className }: BmadTutorialOverlayProps) {
  const { t } = useTranslation('bmad');
  const tutorialDismissed = useBmadStore((s) => s.tutorialDismissed);
  const dismissTutorial = useBmadStore((s) => s.dismissTutorial);

  const [stepIdx, setStepIdx] = useState(0);

  if (tutorialDismissed) return null;

  const step = STEPS[stepIdx];
  if (!step) return null;
  const isLast = stepIdx === STEPS.length - 1;
  const isFirst = stepIdx === 0;

  const handleNext = () => {
    if (isLast) {
      dismissTutorial();
      return;
    }
    setStepIdx((idx) => Math.min(idx + 1, STEPS.length - 1));
  };

  const handlePrev = () => {
    setStepIdx((idx) => Math.max(idx - 1, 0));
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="bmad-tutorial-title"
      data-testid="bmad-tutorial-overlay"
      className={cn(
        'fixed inset-0 z-[60] flex items-center justify-center bg-background/80 backdrop-blur-sm',
        className,
      )}
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl">
        <header className="mb-4 flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
          <h2
            id="bmad-tutorial-title"
            className="text-lg font-semibold text-foreground"
          >
            {t('tutorial.title')}
          </h2>
        </header>

        <div className="mb-4 space-y-2">
          <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            {t('tutorial.stepCounter', {
              current: stepIdx + 1,
              total: STEPS.length,
            })}
          </p>
          <h3 className="text-base font-semibold text-foreground">
            {t(step.titleKey)}
          </h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t(step.descriptionKey)}
          </p>
        </div>

        {/* Progress dots */}
        <div className="mb-4 flex items-center gap-1.5" aria-hidden="true">
          {STEPS.map((s, i) => (
            <span
              key={s.titleKey}
              className={cn(
                'h-1.5 rounded-full transition-all',
                i === stepIdx ? 'w-6 bg-primary' : 'w-1.5 bg-muted-foreground/30',
              )}
            />
          ))}
        </div>

        <footer className="flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={dismissTutorial}
            data-testid="bmad-tutorial-skip-button"
          >
            {t('tutorial.skipButton')}
          </Button>
          <div className="flex items-center gap-2">
            {!isFirst && (
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrev}
                data-testid="bmad-tutorial-prev-button"
              >
                <ArrowLeft className="mr-1 h-3 w-3" aria-hidden="true" />
                {t('tutorial.previousButton')}
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleNext}
              data-testid={
                isLast
                  ? 'bmad-tutorial-done-button'
                  : 'bmad-tutorial-next-button'
              }
            >
              {isLast ? t('tutorial.doneButton') : t('tutorial.nextButton')}
              {isLast ? (
                <ChevronRight className="ml-1 h-3 w-3" aria-hidden="true" />
              ) : (
                <ArrowRight className="ml-1 h-3 w-3" aria-hidden="true" />
              )}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
