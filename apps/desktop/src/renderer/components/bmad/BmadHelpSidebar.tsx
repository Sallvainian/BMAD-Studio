/**
 * BmadHelpSidebar — Phase 4 deliverable §2
 *
 * Always-on companion that answers "what now?" with one click. Per
 * BMAD docs § "Meet BMad-Help: Your Intelligent Guide" the help skill's
 * three affordances are:
 *
 *   1. **Show your options** — render every workflow available for the
 *      current phase + track.
 *   2. **Recommend what's next** — surface the required action with a
 *      one-click Run button.
 *   3. **Answer questions** — let the user type a free-form question and
 *      stream the bmad-help skill's narrative response into the chat
 *      panel.
 *
 * Per ENGINE_SWAP_PROMPT.md `<engineering_standards>` "Performance budgets"
 * the synchronous path returns in <50ms (no model call). The synchronous
 * `BmadHelpRecommendation` is already in `useBmadStore` (Phase 2 +
 * `useBmadProject` re-fetches it on every relevant watcher event). Free-form
 * questions go through `startHelpAI` → workflow runner.
 */

import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CheckCircle2,
  ChevronRight,
  HelpCircle,
  Loader2,
  Play,
  Send,
  Sparkles,
} from 'lucide-react';

import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { ScrollArea } from '../ui/scroll-area';
import { useBmadStore } from '../../stores/bmad-store';
import { useClaudeProfileStore } from '../../stores/claude-profile-store';
import type {
  BmadHelpRecommendation,
  BmadPersonaIdentity,
  BmadPersonaSlug,
  BmadWorkflowAction,
} from '../../../shared/types/bmad';

interface BmadHelpSidebarProps {
  /** Persona records keyed by slug (drives icons next to actions). */
  readonly personas: ReadonlyMap<string, BmadPersonaIdentity>;
  /** Caller for "Run" buttons — defers to the chat panel via the store. */
  readonly onRunWorkflow?: (action: BmadWorkflowAction) => void;
  /** Called when the user submits a free-form question. */
  readonly onAskQuestion?: (question: string) => void;
  /** Allow caller to hide the inline "Ask anything" input (it's rendered in
   *  the chat panel for the AI-augmented free-form flow). */
  readonly allowAskQuestion?: boolean;
  readonly className?: string;
}

export function BmadHelpSidebar({
  personas,
  onRunWorkflow,
  onAskQuestion,
  allowAskQuestion = true,
  className,
}: BmadHelpSidebarProps) {
  const { t } = useTranslation('bmad');

  const recommendation = useBmadStore((s) => s.recommendation);
  const loadStatus = useBmadStore((s) => s.loadStatus);
  const lastError = useBmadStore((s) => s.lastError);
  const startHelpAI = useBmadStore((s) => s.startHelpAI);
  const startWorkflow = useBmadStore((s) => s.startWorkflow);
  const claudeProfiles = useClaudeProfileStore((s) => s.profiles);
  const activeProfileId = useClaudeProfileStore((s) => s.activeProfileId);
  const activeProfile =
    claudeProfiles.find((p) => p.id === activeProfileId) ??
    claudeProfiles.find((p) => p.isDefault) ??
    claudeProfiles[0] ??
    null;

  const [askText, setAskText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleAsk = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!askText.trim() || !activeProfile) return;
    setSubmitting(true);
    try {
      if (onAskQuestion) {
        onAskQuestion(askText.trim());
      } else {
        await startHelpAI({ question: askText.trim() }, activeProfile);
      }
      setAskText('');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRun = async (action: BmadWorkflowAction) => {
    if (onRunWorkflow) {
      onRunWorkflow(action);
      return;
    }
    if (!activeProfile) return;
    setSubmitting(true);
    try {
      await startWorkflow(
        {
          skillName: action.skillId,
          ...(action.persona ? { personaSlug: action.persona } : {}),
        },
        activeProfile,
      );
    } finally {
      setSubmitting(false);
    }
  };

  const isLoading = loadStatus === 'loading' || loadStatus === 'idle';

  return (
    <aside
      role="complementary"
      aria-label={t('help.sidebarAriaLabel')}
      data-testid="bmad-help-sidebar"
      className={cn(
        'flex h-full w-full flex-col border-r border-border bg-sidebar text-sidebar-foreground',
        className,
      )}
    >
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-foreground">
            {t('help.sidebarTitle')}
          </h2>
          <p className="truncate text-xs text-muted-foreground">
            {t('help.sidebarSubtitle')}
          </p>
        </div>
      </header>

      <ScrollArea className="flex-1">
        <div className="space-y-4 p-4">
          {isLoading && (
            <div
              role="status"
              className="flex items-center gap-2 text-sm text-muted-foreground"
            >
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {t('help.loading')}
            </div>
          )}

          {!isLoading && !recommendation && (
            <p className="text-sm text-muted-foreground">{t('help.empty')}</p>
          )}

          {recommendation && (
            <RecommendationBody
              recommendation={recommendation}
              personas={personas}
              onRun={handleRun}
              submitting={submitting}
              activeProfile={activeProfile !== null}
            />
          )}

          {lastError && (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {lastError}
            </p>
          )}
        </div>
      </ScrollArea>

      {allowAskQuestion && (
        <form
          onSubmit={handleAsk}
          className="border-t border-border p-3"
          data-testid="bmad-help-ask-form"
        >
          <div className="flex items-center gap-2">
            <HelpCircle
              className="h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={askText}
              onChange={(e) => setAskText(e.target.value)}
              placeholder={t('help.askQuestionPlaceholder')}
              disabled={submitting || !activeProfile}
              className="h-9 flex-1 text-sm"
              aria-label={t('help.askQuestionPlaceholder')}
              data-testid="bmad-help-ask-input"
            />
            <Button
              type="submit"
              size="icon"
              variant="secondary"
              disabled={submitting || !askText.trim() || !activeProfile}
              aria-label={t('help.askButton')}
              data-testid="bmad-help-ask-button"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="h-4 w-4" aria-hidden="true" />
              )}
            </Button>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {t('help.askPlaceholderHint')}
          </p>
        </form>
      )}
    </aside>
  );
}

// =============================================================================
// Recommendation body
// =============================================================================

interface RecommendationBodyProps {
  readonly recommendation: BmadHelpRecommendation;
  readonly personas: ReadonlyMap<string, BmadPersonaIdentity>;
  readonly onRun: (action: BmadWorkflowAction) => void;
  readonly submitting: boolean;
  readonly activeProfile: boolean;
}

function RecommendationBody({
  recommendation,
  personas,
  onRun,
  submitting,
  activeProfile,
}: RecommendationBodyProps) {
  const { t } = useTranslation('bmad');

  return (
    <>
      {/* Phase header */}
      <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">
          {t('help.currentPhase')}
        </p>
        <p className="text-sm font-medium text-foreground">
          {t('help.phaseLabel', {
            label: t(`phases.${recommendation.currentPhase}`),
          })}
        </p>
        <p className="text-[10px] text-muted-foreground">
          {t('help.trackLabel', {
            label: t(`tracks.${recommendation.track}`),
          })}
        </p>
      </div>

      {/* Required */}
      <section data-testid="bmad-help-required-section">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('help.required')}
        </h3>
        {recommendation.required ? (
          <ActionCard
            action={recommendation.required}
            personas={personas}
            onRun={onRun}
            submitting={submitting}
            disabled={!activeProfile}
            isRequired
          />
        ) : (
          <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {t('help.noNextRequired')}
          </p>
        )}
      </section>

      {/* Recommended */}
      {recommendation.recommended.length > 0 && (
        <section data-testid="bmad-help-recommended-section">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t('help.recommended')}
          </h3>
          <div className="space-y-2">
            {recommendation.recommended.map((action) => (
              <ActionCard
                key={`${action.skillId}-${action.action || 'default'}`}
                action={action}
                personas={personas}
                onRun={onRun}
                submitting={submitting}
                disabled={!activeProfile}
              />
            ))}
          </div>
        </section>
      )}

      {/* Completed */}
      {recommendation.completed.length > 0 && (
        <section data-testid="bmad-help-completed-section">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t('help.completed')}
          </h3>
          <ul className="space-y-1">
            {recommendation.completed.map((action) => (
              <li
                key={`${action.skillId}-${action.action || 'default'}`}
                className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground"
                data-testid={`bmad-help-completed-${action.skillId}`}
              >
                <CheckCircle2
                  className="h-3 w-3 shrink-0 text-success"
                  aria-hidden="true"
                />
                <span className="truncate">{action.displayName}</span>
                {action.persona && (
                  <PersonaIcon
                    slug={action.persona}
                    personas={personas}
                    title={action.persona}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

// =============================================================================
// Action card
// =============================================================================

interface ActionCardProps {
  readonly action: BmadWorkflowAction;
  readonly personas: ReadonlyMap<string, BmadPersonaIdentity>;
  readonly onRun: (action: BmadWorkflowAction) => void;
  readonly submitting: boolean;
  readonly disabled: boolean;
  readonly isRequired?: boolean;
}

function ActionCard({
  action,
  personas,
  onRun,
  submitting,
  disabled,
  isRequired,
}: ActionCardProps) {
  const { t } = useTranslation('bmad');
  const persona = action.persona ? personas.get(action.persona) ?? null : null;

  return (
    <div
      data-testid={`bmad-help-action-${action.skillId}`}
      className={cn(
        'flex flex-col gap-2 rounded-lg border px-3 py-2',
        isRequired
          ? 'border-amber-500/40 bg-amber-500/10'
          : 'border-border bg-card/40',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            {action.displayName}
          </p>
          <p className="font-mono text-[10px] text-muted-foreground">
            {action.skillId}
            {action.action ? `:${action.action}` : ''}
          </p>
        </div>
        {persona && (
          <span
            aria-label={`${persona.name}, ${persona.title}`}
            title={`${persona.name}, ${persona.title}`}
            className="text-lg leading-none"
          >
            {persona.icon}
          </span>
        )}
      </div>
      {action.rationale && (
        <p
          aria-label={t('help.rationaleAriaLabel')}
          className="text-[11px] text-muted-foreground"
        >
          <ChevronRight
            className="-ml-1 mr-1 inline h-3 w-3"
            aria-hidden="true"
          />
          {action.rationale}
        </p>
      )}
      <Button
        size="sm"
        variant={isRequired ? 'default' : 'secondary'}
        disabled={submitting || disabled}
        onClick={() => onRun(action)}
        data-testid={`bmad-help-run-${action.skillId}`}
        className="w-full justify-center"
      >
        <Play className="mr-1.5 h-3 w-3" aria-hidden="true" />
        {isRequired ? t('help.runRequired') : t('help.runRecommended')}
      </Button>
    </div>
  );
}

// =============================================================================
// Persona icon helper
// =============================================================================

function PersonaIcon({
  slug,
  personas,
  title,
}: {
  slug: BmadPersonaSlug;
  personas: ReadonlyMap<string, BmadPersonaIdentity>;
  title: string;
}) {
  const persona = personas.get(slug) ?? null;
  return (
    <span
      aria-label={persona ? `${persona.name}, ${persona.title}` : title}
      title={persona ? `${persona.name}, ${persona.title}` : title}
      className="text-sm leading-none"
    >
      {persona?.icon ?? '?'}
    </span>
  );
}
