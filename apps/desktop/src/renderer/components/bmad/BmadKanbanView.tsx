/**
 * BmadKanbanView — Phase 3 + Phase 4 wrapper component
 *
 * Mounts the BMad Kanban + the BMad-Help sidebar + the persona chat dock +
 * the install wizard (when the project doesn't have `_bmad/_config/manifest.yaml`)
 * + the first-launch tutorial. Bridges the Zustand store via `useBmadProject`
 * to the dumb presentational components.
 *
 * Layout (Phase 4):
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ Toolbar (toggle help, toggle chat, dock state)          │
 *   ├────────────┬───────────────────────────────┬────────────┤
 *   │ Help       │ Kanban (always)               │ Persona    │
 *   │ Sidebar    │                               │ Chat       │
 *   │ (toggleable│                               │ (conditional│
 *   └────────────┴───────────────────────────────┴────────────┘
 *      ╰─ Story detail slides in from right (z-50) on card click.
 *      ╰─ Tutorial overlay covers everything until dismissed (z-60).
 *
 * Per Phase 4 deliverables:
 *   1. BmadPersonaChat — chat panel docked right, streamed responses, menu
 *      buttons + free-form input via the existing onMenu plumbing.
 *   2. BmadHelpSidebar — always-on companion (toggleable by user via the
 *      toolbar), shows current phase + Required + Recommended + Completed.
 *   4. BmadInstallWizard — auto-launches when the project isn't a BMad
 *      project yet, streams `npx bmad-method install` output, lands the
 *      user back here when done.
 *   5. BmadTutorialOverlay — first-launch onboarding, persisted dismissal.
 *
 * Carry-forward from Phase 3: the Run button on BmadStoryCard now calls
 * `bmad.runWorkflow` (via `startWorkflow` store action) instead of the
 * placeholder. The store's optimistic-status override paints the card
 * `in-progress` immediately; the watcher reconciles when sprint-status.yaml
 * is rewritten by the workflow.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, MessageSquare, PanelLeft, PanelLeftClose } from 'lucide-react';

import { useBmadProject } from '../../hooks/useBmadProject';
import { useBmadStore } from '../../stores/bmad-store';
import { useClaudeProfileStore } from '../../stores/claude-profile-store';
import type {
  BmadDevelopmentStatus,
  BmadKanbanColumnId,
  BmadMigrationPlan,
  BmadPersonaIdentity,
  BmadWorkflowAction,
} from '../../../shared/types/bmad';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { cn } from '../../lib/utils';

import { BmadKanbanBoard } from './BmadKanbanBoard';
import { BmadStoryDetail } from './BmadStoryDetail';
import { BmadPersonaChat } from './BmadPersonaChat';
import { BmadHelpSidebar } from './BmadHelpSidebar';
import {
  BmadInstallWizard,
  BmadInstallPrompt,
} from './BmadInstallWizard';
import { BmadTutorialOverlay } from './BmadTutorialOverlay';

interface BmadKanbanViewProps {
  /** Active project root the workspace tab is currently focused on. */
  readonly projectRoot: string | null;
}

/**
 * Resolve the workflow skill the Run button should invoke for a given
 * story status. Per BMAD docs § "The Build Cycle" + bmad-help.csv `after`
 * column the implementation cycle is:
 *
 *   ready-for-dev  →  bmad-dev-story    (Amelia builds it)
 *   in-progress    →  bmad-dev-story    (resume)
 *   review         →  bmad-code-review  (Amelia reviews)
 *   backlog/done   →  bmad-create-story (or no-op)
 *
 * The orchestrator's recommendation logic is the canonical source of
 * truth, but for a one-click Run on a card we pick a sensible default
 * here and let the workflow runner take it from there.
 */
function nextWorkflowForStatus(status: BmadDevelopmentStatus): string {
  switch (status) {
    case 'review':
      return 'bmad-code-review';
    case 'backlog':
      return 'bmad-create-story';
    case 'ready-for-dev':
    case 'in-progress':
    default:
      return 'bmad-dev-story';
  }
}

export function BmadKanbanView({ projectRoot }: BmadKanbanViewProps) {
  const { t } = useTranslation('bmad');

  const project = useBmadProject(projectRoot, { track: 'method' });

  // Store actions
  const setStoryStatus = useBmadStore((s) => s.setStoryStatus);
  const selectStory = useBmadStore((s) => s.selectStory);
  const startWorkflow = useBmadStore((s) => s.startWorkflow);
  const personasList = useBmadStore((s) => s.personas);
  const recommendation = useBmadStore((s) => s.recommendation);
  const activeInvocation = useBmadStore((s) => s.activeInvocation);
  const activeChatId = useBmadStore((s) => s.activeChatId);

  // Active profile for runWorkflow.
  const claudeProfiles = useClaudeProfileStore((s) => s.profiles);
  const activeProfileId = useClaudeProfileStore((s) => s.activeProfileId);
  const activeProfile = useMemo(
    () =>
      claudeProfiles.find((p) => p.id === activeProfileId) ??
      claudeProfiles.find((p) => p.isDefault) ??
      claudeProfiles[0] ??
      null,
    [claudeProfiles, activeProfileId],
  );

  // UI panel state.
  const [helpOpen, setHelpOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [installWizardOpen, setInstallWizardOpen] = useState(false);
  const [migrationPlan, setMigrationPlan] = useState<BmadMigrationPlan | null>(null);
  const [migrationOpen, setMigrationOpen] = useState(false);
  const [migrationRunning, setMigrationRunning] = useState(false);
  const [migrationMessage, setMigrationMessage] = useState<string | null>(null);
  const [migrationError, setMigrationError] = useState<string | null>(null);

  // Auto-open the chat panel when a workflow starts (activeChatId becomes
  // non-null). Don't auto-close if the user explicitly closed it after
  // the workflow finished — we open exactly once per non-null transition.
  useEffect(() => {
    if (activeChatId && !chatOpen) {
      setChatOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChatId]);

  useEffect(() => {
    const root = projectRoot;
    if (!root || !project.isBmadProject) return;
    const checkedRoot = root;
    let cancelled = false;
    async function detectMigration() {
      const resp = await window.electronAPI.bmad.detectLegacyMigration(checkedRoot);
      if (cancelled) return;
      if (resp.success && resp.data.hasLegacySpecs) {
        setMigrationPlan(resp.data);
        setMigrationOpen(true);
      }
    }
    void detectMigration();
    return () => {
      cancelled = true;
    };
  }, [projectRoot, project.isBmadProject]);

  const runMigration = useCallback(async () => {
    const root = projectRoot;
    if (!root) return;
    setMigrationRunning(true);
    setMigrationError(null);
    setMigrationMessage(null);
    const resp = await window.electronAPI.bmad.runLegacyMigration(root);
    setMigrationRunning(false);
    if (!resp.success) {
      setMigrationError(resp.error.message);
      return;
    }
    setMigrationMessage(t('migration.success', { backupDir: resp.data.backupDir }));
    setMigrationOpen(false);
    await useBmadStore.getState().loadProject(root, 'method');
  }, [projectRoot, t]);

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

  /**
   * Phase 4: real workflow invocation. The store's `startWorkflow`
   * - generates an invocationId,
   * - opens a fresh chat thread keyed on it,
   * - paints the story optimistic-`in-progress`,
   * - fires `bmad.runWorkflow` IPC,
   * - and reconciles via the `sprint-status-changed` watcher event when
   *   the workflow writes back to YAML.
   *
   * The chat panel auto-opens via the useEffect above when activeChatId
   * becomes non-null.
   */
  const onRunStory = useCallback(
    async (storyKey: string) => {
      if (!activeProfile) {
        // Surface this via the chat empty-state once the panel is open;
        // for now just open the panel so the user sees the warning.
        setChatOpen(true);
        return;
      }
      const currentStatus = project.displayedStatus(storyKey) ?? 'backlog';
      const skillName = nextWorkflowForStatus(currentStatus);
      await startWorkflow(
        {
          skillName,
          storyKey,
          title: storyKey,
        },
        activeProfile,
      );
    },
    [activeProfile, project, startWorkflow],
  );

  /**
   * Help sidebar Run button. The action carries `skillId` + optional
   * `persona` (from the orchestrator); we forward through the same
   * `startWorkflow` action so the chat thread + optimistic state work
   * identically to the kanban Run button.
   */
  const onRunHelpAction = useCallback(
    async (action: BmadWorkflowAction) => {
      if (!activeProfile) {
        setChatOpen(true);
        return;
      }
      await startWorkflow(
        {
          skillName: action.skillId,
          ...(action.persona ? { personaSlug: action.persona } : {}),
        },
        activeProfile,
      );
    },
    [activeProfile, startWorkflow],
  );

  // Empty state: no project selected (sidebar before the user picks one)
  if (!projectRoot) {
    return (
      <EmptyState
        title={t('help.noActiveProject')}
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

  // Non-BMad project — surface the install prompt + auto-mount the wizard.
  if (!project.isBmadProject) {
    return (
      <>
        <BmadInstallPrompt onLaunch={() => setInstallWizardOpen(true)} />
        <BmadInstallWizard
          open={installWizardOpen}
          onOpenChange={setInstallWizardOpen}
          projectRoot={projectRoot}
          onComplete={() => {
            // The watcher will fire `manifest-changed` once the new
            // _bmad/_config/manifest.yaml lands; the store's
            // applyFileEvent then refreshes the recommendation. We also
            // re-detect explicitly so the user lands in the kanban view
            // immediately on success.
            void useBmadStore.getState().loadProject(projectRoot, 'method');
          }}
        />
      </>
    );
  }

  return (
    <div className="relative flex h-full w-full flex-col" data-testid="bmad-kanban-view">
      <Dialog open={migrationOpen} onOpenChange={setMigrationOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('migration.title')}</DialogTitle>
            <DialogDescription>
              {t('migration.description', {
                count: migrationPlan?.candidates.length ?? 0,
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-48 space-y-1 overflow-auto rounded-md border border-border p-2 text-sm">
            {migrationPlan?.candidates.map((candidate) => (
              <div key={candidate.id}>
                {t('migration.candidate', {
                  id: candidate.id,
                  title: candidate.title,
                })}
              </div>
            ))}
          </div>
          {migrationError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {migrationError}
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setMigrationOpen(false)}
              disabled={migrationRunning}
            >
              {t('migration.dismiss')}
            </Button>
            <Button type="button" onClick={runMigration} disabled={migrationRunning}>
              {migrationRunning && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              {migrationRunning ? t('migration.running') : t('migration.accept')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {migrationMessage && (
        <div className="mx-3 mt-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2 text-sm text-emerald-700 dark:text-emerald-300">
          {migrationMessage}
        </div>
      )}

      {/* Toolbar */}
      <header
        className="flex items-center gap-2 border-b border-border bg-card/40 px-3 py-1.5"
        data-testid="bmad-kanban-toolbar"
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setHelpOpen((open) => !open)}
          aria-label={
            helpOpen ? t('help.closeSidebar') : t('help.openSidebar')
          }
          data-testid="bmad-toggle-help-button"
          className="h-7 gap-1.5 px-2 text-xs"
        >
          {helpOpen ? (
            <PanelLeftClose className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <PanelLeft className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {helpOpen ? t('help.closeSidebar') : t('help.openSidebar')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setChatOpen((open) => !open)}
          aria-label={t('chat.panelAriaLabel')}
          data-testid="bmad-toggle-chat-button"
          className={cn(
            'h-7 gap-1.5 px-2 text-xs',
            activeChatId && !chatOpen && 'text-primary animate-pulse',
          )}
        >
          <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
          {chatOpen ? t('chat.closeAriaLabel') : t('personaSwitcher.label')}
        </Button>
      </header>

      {/* Three-column body */}
      <div className="flex flex-1 overflow-hidden">
        {helpOpen && (
          <div className="w-72 shrink-0 border-r border-border">
            <BmadHelpSidebar
              personas={personasMap}
              onRunWorkflow={onRunHelpAction}
              allowAskQuestion
            />
          </div>
        )}

        <div className="flex-1 overflow-hidden">
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
        </div>

        {chatOpen && (
          <div className="w-96 shrink-0">
            <BmadPersonaChat
              personas={personasMap}
              visible
              onClose={() => setChatOpen(false)}
            />
          </div>
        )}
      </div>

      {/* Story detail slides over the right edge (above the chat panel). */}
      <BmadStoryDetail
        personas={personasMap}
        onRunStory={(storyKey) => void onRunStory(storyKey)}
      />

      {/* First-launch tutorial — persisted dismissal. */}
      <BmadTutorialOverlay />
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

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
