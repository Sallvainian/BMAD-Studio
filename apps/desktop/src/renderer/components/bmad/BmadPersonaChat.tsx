/**
 * BmadPersonaChat — Phase 4 deliverable §1
 *
 * Right-docked chat panel that renders a streamed workflow conversation
 * with one of the six BMM personas (Mary 📊, Paige 📚, John 📋, Sally 🎨,
 * Winston 🏗️, Amelia 💻). Per BMAD docs § "What Named Agents Buy You" the
 * persona's name + title is read-only identity; per § "The Activation Flow"
 * the model prefixes every reply with its icon so the user always knows
 * who's speaking.
 *
 * Three interaction modes:
 *
 *   1. Workflow run — the user clicks Run on a story card or invokes a
 *      workflow from the Help sidebar; the runner streams the persona's
 *      output and surfaces interactive menus via `onMenu`.
 *
 *   2. Free-form persona chat — the user picks a persona via the switcher
 *      and starts a conversation with that persona's agent skill (e.g.
 *      `bmad-agent-architect` for Winston). The runner detects the user's
 *      free-form input and calls back through the same menu plumbing with
 *      no parsed options; we render a text input.
 *
 *   3. BMad-Help free-form — the help sidebar's "Ask anything" input
 *      streams through `runHelpAI` rather than `runWorkflow`. Same chunk
 *      infrastructure; the chat thread renders the same way (no persona
 *      avatar; bmad-help is a task skill, not an agent).
 *
 * All three feed the same `BmadChatThread` shape in `bmad-store`. The chat
 * panel is dumb — every interaction goes through store actions which fire
 * the IPC and reconcile state on completion.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Send, Square, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { ScrollArea } from '../ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { useBmadStore } from '../../stores/bmad-store';
import { useClaudeProfileStore } from '../../stores/claude-profile-store';
import type {
  BmadChatMessage,
  BmadChatThread,
  BmadPersonaIdentity,
  BmadPersonaSlug,
  BmadWorkflowMenuOption,
} from '../../../shared/types/bmad';

interface BmadPersonaChatProps {
  /** Persona records keyed by slug — drives the avatar overlay + switcher. */
  readonly personas: ReadonlyMap<string, BmadPersonaIdentity>;
  /** When false, the panel hides itself entirely (used when there's nothing
   *  to show + the kanban wants its full width back). */
  readonly visible?: boolean;
  /** Optional close handler; renders the X button when supplied. */
  readonly onClose?: () => void;
  readonly className?: string;
}

export function BmadPersonaChat({
  personas,
  visible = true,
  onClose,
  className,
}: BmadPersonaChatProps) {
  const { t } = useTranslation('bmad');

  // Store wiring — read everything the panel needs.
  const activeChatId = useBmadStore((s) => s.activeChatId);
  const chatThreads = useBmadStore((s) => s.chatThreads);
  const preferredPersona = useBmadStore((s) => s.preferredPersona);
  const startWorkflow = useBmadStore((s) => s.startWorkflow);
  const respondToMenu = useBmadStore((s) => s.respondToMenu);
  const closeChat = useBmadStore((s) => s.closeChat);
  const selectChat = useBmadStore((s) => s.selectChat);
  const setPreferredPersona = useBmadStore((s) => s.setPreferredPersona);

  // Active profile for runWorkflow — falls back to the default profile when
  // the user hasn't explicitly picked one.
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

  const thread = activeChatId ? chatThreads[activeChatId] ?? null : null;

  // Local input state (free-form text + menu-text fallback).
  const [composerText, setComposerText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Auto-scroll on new messages.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [thread?.messages.length, thread?.pendingMenu]);

  // Sorted persona list (memoized so the Select doesn't re-key on every
  // render). Hooks must run unconditionally — the early-return guard is
  // below this line so React's rules-of-hooks stay happy.
  const personaList = useMemo(
    () => Array.from(personas.values()).sort((a, b) => orderSlug(a.slug) - orderSlug(b.slug)),
    [personas],
  );

  if (!visible) return null;

  const handleStartWith = async (slug: BmadPersonaSlug) => {
    if (!activeProfile) return;
    setPreferredPersona(slug);
    setSubmitting(true);
    try {
      await startWorkflow(
        {
          skillName: skillForPersona(slug),
          personaSlug: slug,
        },
        activeProfile,
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (thread) {
      // Detach the chat from the active dock without dropping the thread —
      // user can reselect via thread history (Phase 6 stretch). For now we
      // close + drop fully on a stopped/completed thread, otherwise just
      // hide it from the dock.
      if (
        thread.status === 'completed' ||
        thread.status === 'aborted' ||
        thread.status === 'errored'
      ) {
        closeChat(thread.invocationId);
      } else {
        selectChat(null);
      }
    }
    onClose?.();
  };

  const handleMenuOption = async (option: BmadWorkflowMenuOption) => {
    if (!thread) return;
    setSubmitting(true);
    try {
      await respondToMenu(thread.invocationId, {
        optionCode: option.code,
        text: option.label,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSend = async () => {
    if (!thread || !composerText.trim()) return;
    setSubmitting(true);
    try {
      await respondToMenu(thread.invocationId, { text: composerText.trim() });
      setComposerText('');
    } finally {
      setSubmitting(false);
    }
  };

  // Determine the persona showing in the header
  const headerPersona = thread?.personaSlug
    ? personas.get(thread.personaSlug) ?? null
    : null;

  return (
    <aside
      role="complementary"
      aria-label={t('chat.panelAriaLabel')}
      data-testid="bmad-persona-chat"
      className={cn(
        'flex h-full w-full flex-col border-l border-border bg-card text-card-foreground',
        className,
      )}
    >
      {/* ─── Header ─────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {headerPersona ? (
            <>
              <span className="text-xl leading-none" aria-hidden="true">
                {headerPersona.icon}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">
                  {headerPersona.name}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {headerPersona.title}
                </p>
              </div>
            </>
          ) : thread?.skillName === 'bmad-help' ? (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">
                {t('chat.helpSkillHeader')}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {t('help.sidebarSubtitle')}
              </p>
            </div>
          ) : (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">
                BMad
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {thread?.skillName ?? t('chat.emptyState')}
              </p>
            </div>
          )}
          {thread && <ChatStatusBadge status={thread.status} />}
        </div>
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClose}
            aria-label={t('chat.closeAriaLabel')}
            className="shrink-0"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </header>

      {/* ─── Persona switcher ───────────────────────────────────────────── */}
      {personaList.length > 0 && (
        <div className="flex items-center gap-2 border-b border-border bg-secondary/20 px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">
            {t('personaSwitcher.label')}
          </span>
          <Select
            value={preferredPersona ?? ''}
            onValueChange={(slug) => setPreferredPersona(slug as BmadPersonaSlug)}
          >
            <SelectTrigger
              className="h-8 max-w-44"
              aria-label={t('chat.personaPickerAriaLabel')}
              data-testid="bmad-persona-switcher"
            >
              <SelectValue placeholder={t('chat.personaPickerLabel')} />
            </SelectTrigger>
            <SelectContent>
              {personaList.map((p) => (
                <SelectItem key={p.slug} value={p.slug}>
                  {t('personaSwitcher.personaItem', {
                    icon: p.icon,
                    name: p.name,
                    title: p.title,
                  })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {preferredPersona && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => handleStartWith(preferredPersona)}
              disabled={submitting || !activeProfile}
              data-testid="bmad-persona-start-button"
            >
              {t('chat.startWith', {
                name:
                  personas.get(preferredPersona)?.name ?? preferredPersona,
              })}
            </Button>
          )}
        </div>
      )}

      {/* ─── Body ──────────────────────────────────────────────────────── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <ScrollArea className="h-full">
          <div className="space-y-4 p-3" data-testid="bmad-chat-messages">
            {!thread && (
              <div className="flex h-full flex-col items-center justify-center gap-2 py-12 text-center text-sm text-muted-foreground">
                <p>{t('chat.emptyState')}</p>
                {!activeProfile && (
                  <p
                    role="status"
                    className="rounded-md bg-warning/10 px-3 py-1 text-xs text-warning"
                  >
                    {t('chat.noActiveProfile')}
                  </p>
                )}
              </div>
            )}
            {thread?.messages.map((m) => (
              <ChatBubble
                key={m.id}
                message={m}
                personas={personas}
              />
            ))}
            {thread && thread.status === 'starting' && (
              <div
                role="status"
                className="flex items-center gap-2 text-xs text-muted-foreground"
              >
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                {t('chat.starting')}
              </div>
            )}
            {thread?.pendingMenu && (
              <PendingMenu
                pendingMenu={thread.pendingMenu}
                disabled={submitting}
                onPick={handleMenuOption}
              />
            )}
            {thread?.error && (
              <div
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {thread.error}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* ─── Composer ──────────────────────────────────────────────────── */}
      {thread && canSendFreeForm(thread) && (
        <footer className="border-t border-border p-3">
          <div className="flex items-end gap-2">
            <Textarea
              value={composerText}
              onChange={(e) => setComposerText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder={
                thread.personaSlug
                  ? t('chat.freeFormPrompt', {
                      name:
                        personas.get(thread.personaSlug)?.name ??
                        thread.personaSlug,
                    })
                  : t('chat.freeFormPromptGeneric')
              }
              className="max-h-32 min-h-10 flex-1"
              rows={2}
              disabled={submitting || thread.status === 'completed'}
              aria-label={t('chat.freeFormPromptGeneric')}
              data-testid="bmad-chat-composer"
            />
            <Button
              size="icon"
              onClick={handleSend}
              disabled={submitting || !composerText.trim()}
              aria-label={t('chat.send')}
              data-testid="bmad-chat-send-button"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="h-4 w-4" aria-hidden="true" />
              )}
            </Button>
          </div>
        </footer>
      )}
    </aside>
  );
}

// =============================================================================
// Chat bubble
// =============================================================================

interface ChatBubbleProps {
  readonly message: BmadChatMessage;
  readonly personas: ReadonlyMap<string, BmadPersonaIdentity>;
}

function ChatBubble({ message, personas }: ChatBubbleProps) {
  const { t } = useTranslation('bmad');

  if (message.role === 'system') {
    // System messages (step transitions, tool calls) are compact.
    return (
      <div
        className="flex items-start gap-2 text-xs text-muted-foreground"
        data-testid={`bmad-chat-message-system-${message.id}`}
      >
        <span className="rounded-full bg-secondary px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider">
          {t('chat.messageRoles.system')}
        </span>
        <span className="break-words">{message.content}</span>
      </div>
    );
  }

  const persona = message.personaSlug ? personas.get(message.personaSlug) ?? null : null;
  const isUser = message.role === 'user';

  return (
    <div
      data-testid={`bmad-chat-message-${message.role}-${message.id}`}
      className={cn(
        'flex gap-2',
        isUser ? 'justify-end' : 'justify-start',
      )}
    >
      {!isUser && persona && (
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center text-lg leading-none"
        >
          {persona.icon}
        </span>
      )}
      <div
        className={cn(
          'max-w-[80%] rounded-2xl px-3 py-2 text-sm',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-secondary/40 text-foreground',
        )}
      >
        {!isUser && persona && (
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {persona.name} · {persona.title}
          </p>
        )}
        <div className={cn('prose prose-sm max-w-none', !isUser && 'prose-invert')}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content || (message.streaming ? '…' : '')}
          </ReactMarkdown>
        </div>
        {message.streaming && (
          <div
            role="status"
            className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground"
          >
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            {t('chat.thinking')}
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Pending menu
// =============================================================================

interface PendingMenuProps {
  readonly pendingMenu: NonNullable<BmadChatThread['pendingMenu']>;
  readonly disabled: boolean;
  readonly onPick: (option: BmadWorkflowMenuOption) => void;
}

function PendingMenu({ pendingMenu, disabled, onPick }: PendingMenuProps) {
  const { t } = useTranslation('bmad');
  const { menu } = pendingMenu;

  return (
    <div
      role="region"
      aria-label={t('chat.menuPrompt')}
      className="rounded-lg border border-primary/30 bg-primary/5 p-3"
      data-testid="bmad-chat-pending-menu"
    >
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary">
        {menu.options.length > 0
          ? t('chat.menuPrompt')
          : t('chat.menuFreeFormPrompt')}
      </p>
      {menu.options.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {menu.options.map((opt) => (
            <Button
              key={opt.code}
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => onPick(opt)}
              data-testid={`bmad-chat-menu-option-${opt.code}`}
              className="font-mono text-xs"
            >
              <span className="mr-1.5 rounded bg-primary/10 px-1 py-0.5 text-[10px] text-primary">
                {opt.code}
              </span>
              <span className="font-sans">{opt.label}</span>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Status badge
// =============================================================================

function ChatStatusBadge({ status }: { status: BmadChatThread['status'] }) {
  const { t } = useTranslation('bmad');
  const badge = (() => {
    switch (status) {
      case 'completed':
        return {
          label: t('chat.completedBadge'),
          icon: null,
          className: 'bg-success/15 text-success border-success/30',
        };
      case 'aborted':
        return {
          label: t('chat.abortedBadge'),
          icon: <Square className="h-3 w-3" aria-hidden="true" />,
          className: 'bg-muted text-muted-foreground border-border',
        };
      case 'errored':
        return {
          label: t('chat.erroredBadge'),
          icon: null,
          className: 'bg-destructive/15 text-destructive border-destructive/30',
        };
      case 'awaiting-menu':
      case 'awaiting-response':
        return {
          label: t('chat.awaitingMenuBadge'),
          icon: null,
          className: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
        };
      case 'streaming':
      case 'starting':
        return {
          label: t('chat.streamingBadge'),
          icon: <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />,
          className: 'bg-info/15 text-info border-info/30',
        };
      default:
        return null;
    }
  })();

  if (!badge) return null;
  return (
    <span
      className={cn(
        'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
        badge.className,
      )}
      data-testid="bmad-chat-status-badge"
      data-status={status}
    >
      {badge.icon}
      {badge.label}
    </span>
  );
}

// =============================================================================
// Helpers
// =============================================================================

const PERSONA_ORDER: readonly BmadPersonaSlug[] = [
  'mary',
  'paige',
  'john',
  'sally',
  'winston',
  'amelia',
];

function orderSlug(slug: BmadPersonaSlug): number {
  const idx = PERSONA_ORDER.indexOf(slug);
  return idx === -1 ? PERSONA_ORDER.length : idx;
}

const PERSONA_TO_SKILL: Readonly<Record<BmadPersonaSlug, string>> = {
  mary: 'bmad-agent-analyst',
  paige: 'bmad-agent-tech-writer',
  john: 'bmad-agent-pm',
  sally: 'bmad-agent-ux-designer',
  winston: 'bmad-agent-architect',
  amelia: 'bmad-agent-dev',
};

function skillForPersona(slug: BmadPersonaSlug): string {
  return PERSONA_TO_SKILL[slug];
}

/**
 * Whether the user is allowed to type a free-form reply. Allowed in:
 *   - awaiting-menu (the runner is asking for input)
 *   - awaiting-response (alternative wait state for non-menu prompts)
 *   - streaming with no pending menu (allows interrupt-style follow-up)
 *
 * Not allowed when the workflow is starting (we don't have a thread id yet
 * server-side), completed, aborted, or errored.
 */
function canSendFreeForm(thread: BmadChatThread): boolean {
  return (
    thread.status === 'awaiting-menu' ||
    thread.status === 'awaiting-response' ||
    thread.status === 'streaming'
  );
}
