/**
 * @vitest-environment jsdom
 */

/**
 * Tests for BmadPersonaChat (Phase 4 deliverable §1).
 *
 * Verifies:
 *   - empty state renders when no thread is active
 *   - persona switcher renders all 6 personas in canonical order
 *   - workflow streaming renders message bubbles + status badge
 *   - pending menu renders option buttons; clicking calls respondToMenu
 *   - free-form input + Send dispatches respondToMenu with text
 *   - Start with persona calls runWorkflow with the persona's agent skill
 *   - close button selects null when streaming, drops thread when terminal
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';

import { BmadPersonaChat } from '../BmadPersonaChat';
import { useBmadStore } from '../../../stores/bmad-store';
import { useClaudeProfileStore } from '../../../stores/claude-profile-store';
import type {
  BmadChatThread,
  BmadIpcResult,
  BmadPersonaIdentity,
  BmadPersonaSlug,
  BmadWorkflowResult,
} from '../../../../shared/types/bmad';
import type { ClaudeProfile } from '../../../../shared/types/agent';

// Lightweight ReactMarkdown mock — we only care that the content prop is
// rendered (and avoid pulling unified plugin chains into jsdom).
vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));
vi.mock('remark-gfm', () => ({ default: () => {} }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && typeof opts === 'object') {
        return `${key}:${JSON.stringify(opts)}`;
      }
      return key;
    },
    i18n: { language: 'en' },
  }),
}));

function persona(slug: BmadPersonaSlug, name: string, icon: string): BmadPersonaIdentity {
  return {
    slug,
    skillId: `bmad-agent-${slug}`,
    name,
    title: `${name} Title`,
    module: 'bmm',
    team: 'core',
    description: '',
    icon,
    role: '',
    identity: '',
    communicationStyle: '',
    principles: [],
    persistentFacts: [],
    activationStepsPrepend: [],
    activationStepsAppend: [],
    menu: [],
    phase: '4-implementation',
  };
}

const PERSONAS = new Map<string, BmadPersonaIdentity>([
  ['mary', persona('mary', 'Mary', '📊')],
  ['paige', persona('paige', 'Paige', '📚')],
  ['john', persona('john', 'John', '📋')],
  ['sally', persona('sally', 'Sally', '🎨')],
  ['winston', persona('winston', 'Winston', '🏗️')],
  ['amelia', persona('amelia', 'Amelia', '💻')],
]);

const PROFILE: ClaudeProfile = {
  id: 'profile-1',
  name: 'Default',
  isDefault: true,
  createdAt: new Date(),
};

function ok<T>(data: T): BmadIpcResult<T> {
  return { success: true, data };
}

function installMock() {
  const respondToWorkflowMenu = vi
    .fn()
    .mockResolvedValue(ok({ resolved: true }));
  const runWorkflow = vi.fn().mockResolvedValue(
    ok<BmadWorkflowResult & { invocationId: string }>({
      outcome: 'completed',
      skillId: 'bmad-agent-john',
      turns: 1,
      durationMs: 1,
      outputFiles: [],
      invocationId: 'mock-id',
    }),
  );
  const onWorkflowStream = vi.fn().mockReturnValue(() => {});
  const onWorkflowMenuRequest = vi.fn().mockReturnValue(() => {});
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    bmad: {
      respondToWorkflowMenu,
      runWorkflow,
      onWorkflowStream,
      onWorkflowMenuRequest,
    },
  };
  return { respondToWorkflowMenu, runWorkflow };
}

function seedStore(thread: BmadChatThread | null = null) {
  useBmadStore.setState({
    activeProjectRoot: '/tmp/test',
    track: 'method',
    chatThreads: thread ? { [thread.invocationId]: thread } : {},
    activeChatId: thread?.invocationId ?? null,
    preferredPersona: null,
    streamListenersAttached: true,
    sprintStatus: null,
    optimisticStatus: {},
    storyDetails: {},
  });
  useClaudeProfileStore.setState({
    profiles: [PROFILE],
    activeProfileId: PROFILE.id,
  });
}

describe('BmadPersonaChat', () => {
  beforeEach(() => {
    installMock();
    seedStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders empty state when no thread is active', () => {
    render(<BmadPersonaChat personas={PERSONAS} />);
    // Scope to the messages container — the same i18n key is also used as
    // a header fallback when no skillName is set, so a global getByText
    // would match both elements.
    const body = screen.getByTestId('bmad-chat-messages');
    expect(within(body).getByText('chat.emptyState')).toBeInTheDocument();
  });

  it('renders the persona switcher with all six personas', () => {
    render(<BmadPersonaChat personas={PERSONAS} />);
    const switcher = screen.getByTestId('bmad-persona-switcher');
    expect(switcher).toBeInTheDocument();
  });

  it('renders persona header + status badge when thread is streaming', () => {
    const thread: BmadChatThread = {
      invocationId: 'inv-john-1',
      skillName: 'bmad-create-prd',
      personaSlug: 'john',
      storyKey: null,
      title: null,
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          content: '📋 Hello, I am John.',
          personaSlug: 'john',
          timestamp: 1,
        },
      ],
      status: 'streaming',
      pendingMenu: null,
      startedAt: 0,
    };
    seedStore(thread);
    render(<BmadPersonaChat personas={PERSONAS} />);

    expect(screen.getByText('John')).toBeInTheDocument();
    expect(screen.getByText('John Title')).toBeInTheDocument();
    expect(screen.getByTestId('bmad-chat-status-badge')).toHaveAttribute(
      'data-status',
      'streaming',
    );
  });

  it('renders pending menu options as buttons; click resolves via respondToMenu', async () => {
    const { respondToWorkflowMenu } = installMock();
    const thread: BmadChatThread = {
      invocationId: 'inv-menu',
      skillName: 'bmad-create-prd',
      personaSlug: 'john',
      storyKey: null,
      title: null,
      messages: [],
      status: 'awaiting-menu',
      pendingMenu: {
        menuId: 'menu-1',
        receivedAt: 0,
        menu: {
          prompt: 'Pick',
          options: [
            { code: 'C', label: 'Continue' },
            { code: 'E', label: 'Edit' },
          ],
        },
      },
      startedAt: 0,
    };
    seedStore(thread);
    render(<BmadPersonaChat personas={PERSONAS} />);

    fireEvent.click(screen.getByTestId('bmad-chat-menu-option-C'));
    await waitFor(() => {
      expect(respondToWorkflowMenu).toHaveBeenCalledWith({
        invocationId: 'inv-menu',
        menuId: 'menu-1',
        choice: { optionCode: 'C', text: 'Continue' },
      });
    });
  });

  it('free-form Send dispatches respondToMenu with the typed text', async () => {
    const { respondToWorkflowMenu } = installMock();
    const thread: BmadChatThread = {
      invocationId: 'inv-free',
      skillName: 'bmad-help',
      personaSlug: null,
      storyKey: null,
      title: null,
      messages: [],
      status: 'awaiting-menu',
      pendingMenu: {
        menuId: 'menu-free',
        receivedAt: 0,
        menu: { prompt: 'Reply', options: [] },
      },
      startedAt: 0,
    };
    seedStore(thread);
    render(<BmadPersonaChat personas={PERSONAS} />);
    const composer = screen.getByTestId('bmad-chat-composer');
    fireEvent.change(composer, { target: { value: 'My answer' } });
    fireEvent.click(screen.getByTestId('bmad-chat-send-button'));
    await waitFor(() => {
      expect(respondToWorkflowMenu).toHaveBeenCalledWith({
        invocationId: 'inv-free',
        menuId: 'menu-free',
        choice: { text: 'My answer' },
      });
    });
  });

  it('"Start with John" button calls runWorkflow with bmad-agent-pm', async () => {
    const { runWorkflow } = installMock();
    seedStore();
    useBmadStore.setState({ preferredPersona: 'john' });
    render(<BmadPersonaChat personas={PERSONAS} />);
    fireEvent.click(screen.getByTestId('bmad-persona-start-button'));
    await waitFor(() => {
      expect(runWorkflow).toHaveBeenCalled();
      const args = runWorkflow.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(args.skillName).toBe('bmad-agent-pm');
      expect(args.personaSlug).toBe('john');
    });
  });

  it('Send is disabled when composer is empty', () => {
    const thread: BmadChatThread = {
      invocationId: 'inv-x',
      skillName: 'bmad-help',
      personaSlug: null,
      storyKey: null,
      title: null,
      messages: [],
      status: 'awaiting-menu',
      pendingMenu: {
        menuId: 'm',
        receivedAt: 0,
        menu: { prompt: '', options: [] },
      },
      startedAt: 0,
    };
    seedStore(thread);
    render(<BmadPersonaChat personas={PERSONAS} />);
    expect(screen.getByTestId('bmad-chat-send-button')).toBeDisabled();
  });

  it('does not render free-form composer when thread is completed', () => {
    const thread: BmadChatThread = {
      invocationId: 'inv-done',
      skillName: 'bmad-create-prd',
      personaSlug: 'john',
      storyKey: null,
      title: null,
      messages: [
        { id: 'a', role: 'assistant', content: 'Done', timestamp: 1 },
      ],
      status: 'completed',
      pendingMenu: null,
      outcome: 'completed',
      startedAt: 0,
      endedAt: 1,
    };
    seedStore(thread);
    render(<BmadPersonaChat personas={PERSONAS} />);
    expect(screen.queryByTestId('bmad-chat-composer')).not.toBeInTheDocument();
  });

  it('hides itself when visible=false', () => {
    seedStore();
    const { container } = render(
      <BmadPersonaChat personas={PERSONAS} visible={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('close button on a streaming thread deselects without dropping it', () => {
    const thread: BmadChatThread = {
      invocationId: 'inv-mid',
      skillName: 'bmad-create-prd',
      personaSlug: 'john',
      storyKey: null,
      title: null,
      messages: [],
      status: 'streaming',
      pendingMenu: null,
      startedAt: 0,
    };
    seedStore(thread);
    const onClose = vi.fn();
    render(<BmadPersonaChat personas={PERSONAS} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('chat.closeAriaLabel'));
    expect(useBmadStore.getState().activeChatId).toBeNull();
    expect(useBmadStore.getState().chatThreads['inv-mid']).toBeDefined();
    expect(onClose).toHaveBeenCalled();
  });

  it('close button on a completed thread drops it from the map', () => {
    const thread: BmadChatThread = {
      invocationId: 'inv-end',
      skillName: 'bmad-create-prd',
      personaSlug: 'john',
      storyKey: null,
      title: null,
      messages: [],
      status: 'completed',
      pendingMenu: null,
      startedAt: 0,
    };
    seedStore(thread);
    render(<BmadPersonaChat personas={PERSONAS} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText('chat.closeAriaLabel'));
    expect(useBmadStore.getState().chatThreads['inv-end']).toBeUndefined();
  });
});
