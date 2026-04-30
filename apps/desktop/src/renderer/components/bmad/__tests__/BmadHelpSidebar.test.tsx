/**
 * @vitest-environment jsdom
 */

/**
 * Tests for BmadHelpSidebar (Phase 4 deliverable §2).
 *
 * Per BMAD docs § "Meet BMad-Help: Your Intelligent Guide" the sidebar
 * surfaces three affordances: required, recommended, completed. Tests
 * verify each section renders, the Run button forwards the action, the
 * Ask form submits the question, and the loading/empty/error states render
 * correctly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

import { BmadHelpSidebar } from '../BmadHelpSidebar';
import { useBmadStore } from '../../../stores/bmad-store';
import { useClaudeProfileStore } from '../../../stores/claude-profile-store';
import type {
  BmadHelpRecommendation,
  BmadPersonaIdentity,
  BmadWorkflowAction,
} from '../../../../shared/types/bmad';
import type { ClaudeProfile } from '../../../../shared/types/agent';

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

const PERSONA: BmadPersonaIdentity = {
  slug: 'john',
  skillId: 'bmad-agent-pm',
  name: 'John',
  title: 'Product Manager',
  module: 'bmm',
  team: 'core',
  description: '',
  icon: '📋',
  role: '',
  identity: '',
  communicationStyle: '',
  principles: [],
  persistentFacts: [],
  activationStepsPrepend: [],
  activationStepsAppend: [],
  menu: [],
  phase: '2-planning',
};

const PERSONAS = new Map<string, BmadPersonaIdentity>([['john', PERSONA]]);

const REQUIRED_ACTION: BmadWorkflowAction = {
  skillId: 'bmad-create-prd',
  action: '',
  displayName: 'Create PRD',
  menuCode: '1',
  description: 'Create a Product Requirements Document',
  phase: '2-planning',
  required: true,
  persona: 'john',
  rationale: 'Required for BMad Method track',
};

const RECOMMENDED_ACTION: BmadWorkflowAction = {
  ...REQUIRED_ACTION,
  skillId: 'bmad-validate-prd',
  displayName: 'Validate PRD',
  required: false,
  rationale: 'Optional sanity check',
};

const COMPLETED_ACTION: BmadWorkflowAction = {
  ...REQUIRED_ACTION,
  skillId: 'bmad-product-brief',
  displayName: 'Product Brief',
  required: false,
  persona: 'john',
  rationale: '',
};

const RECOMMENDATION: BmadHelpRecommendation = {
  currentPhase: '2-planning',
  required: REQUIRED_ACTION,
  recommended: [RECOMMENDED_ACTION],
  completed: [COMPLETED_ACTION],
  track: 'method',
};

const PROFILE: ClaudeProfile = {
  id: 'mock-profile',
  name: 'Mock',
  isDefault: true,
  createdAt: new Date(),
};

function seedStore(
  overrides: Partial<ReturnType<typeof useBmadStore.getState>> = {},
) {
  useBmadStore.setState({
    activeProjectRoot: '/tmp/test',
    track: 'method',
    loadStatus: 'ready',
    lastError: null,
    recommendation: RECOMMENDATION,
    ...overrides,
  });
  useClaudeProfileStore.setState({
    profiles: [PROFILE],
    activeProfileId: PROFILE.id,
  });
}

describe('BmadHelpSidebar', () => {
  beforeEach(() => {
    seedStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders required + recommended + completed sections', () => {
    render(<BmadHelpSidebar personas={PERSONAS} />);
    expect(screen.getByTestId('bmad-help-required-section')).toBeInTheDocument();
    expect(
      screen.getByTestId('bmad-help-recommended-section'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('bmad-help-completed-section'),
    ).toBeInTheDocument();

    expect(screen.getByText('Create PRD')).toBeInTheDocument();
    expect(screen.getByText('Validate PRD')).toBeInTheDocument();
    expect(screen.getByText('Product Brief')).toBeInTheDocument();
  });

  it('renders the loading state when loadStatus is `loading`', () => {
    seedStore({ loadStatus: 'loading' });
    render(<BmadHelpSidebar personas={PERSONAS} />);
    expect(screen.getByText('help.loading')).toBeInTheDocument();
  });

  it('renders the empty state when there is no recommendation', () => {
    seedStore({ loadStatus: 'ready', recommendation: null });
    render(<BmadHelpSidebar personas={PERSONAS} />);
    expect(screen.getByText('help.empty')).toBeInTheDocument();
  });

  it('renders an alert when lastError is set', () => {
    seedStore({ lastError: 'Boom' });
    render(<BmadHelpSidebar personas={PERSONAS} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Boom');
  });

  it('forwards Run click on required action to onRunWorkflow', () => {
    const onRunWorkflow = vi.fn();
    render(
      <BmadHelpSidebar personas={PERSONAS} onRunWorkflow={onRunWorkflow} />,
    );
    fireEvent.click(screen.getByTestId('bmad-help-run-bmad-create-prd'));
    expect(onRunWorkflow).toHaveBeenCalledWith(REQUIRED_ACTION);
  });

  it('forwards Run click on recommended action to onRunWorkflow', () => {
    const onRunWorkflow = vi.fn();
    render(
      <BmadHelpSidebar personas={PERSONAS} onRunWorkflow={onRunWorkflow} />,
    );
    fireEvent.click(screen.getByTestId('bmad-help-run-bmad-validate-prd'));
    expect(onRunWorkflow).toHaveBeenCalledWith(RECOMMENDED_ACTION);
  });

  it('completed actions are not interactive (no Run button)', () => {
    render(<BmadHelpSidebar personas={PERSONAS} />);
    const completedSection = screen.getByTestId('bmad-help-completed-section');
    expect(completedSection.querySelectorAll('button')).toHaveLength(0);
    expect(
      screen.getByTestId('bmad-help-completed-bmad-product-brief'),
    ).toBeInTheDocument();
  });

  it('Ask form calls onAskQuestion with the trimmed question', () => {
    const onAskQuestion = vi.fn();
    render(
      <BmadHelpSidebar personas={PERSONAS} onAskQuestion={onAskQuestion} />,
    );
    const input = screen.getByTestId('bmad-help-ask-input');
    fireEvent.change(input, { target: { value: '  what next?  ' } });
    fireEvent.click(screen.getByTestId('bmad-help-ask-button'));
    expect(onAskQuestion).toHaveBeenCalledWith('what next?');
  });

  it('hides the Ask form when allowAskQuestion is false', () => {
    render(
      <BmadHelpSidebar personas={PERSONAS} allowAskQuestion={false} />,
    );
    expect(screen.queryByTestId('bmad-help-ask-form')).not.toBeInTheDocument();
  });

  it('Ask button is disabled when there is no active profile', () => {
    useClaudeProfileStore.setState({
      profiles: [],
      activeProfileId: 'default',
    });
    render(<BmadHelpSidebar personas={PERSONAS} />);
    const askButton = screen.getByTestId('bmad-help-ask-button');
    expect(askButton).toBeDisabled();
  });

  it('renders the persona icon in the action header', () => {
    render(<BmadHelpSidebar personas={PERSONAS} />);
    const required = screen.getByTestId('bmad-help-action-bmad-create-prd');
    expect(required.textContent).toContain('📋');
  });

  it('shows phase + track labels', () => {
    render(<BmadHelpSidebar personas={PERSONAS} />);
    expect(
      screen.getByText(/help.phaseLabel/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/help.trackLabel/),
    ).toBeInTheDocument();
  });
});
