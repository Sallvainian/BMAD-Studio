/**
 * @vitest-environment jsdom
 */

/**
 * BmadStoryDetail tests — Phase 3 deliverable §3.
 *
 * Drives the panel via the real `useBmadStore` (Zustand), populated with
 * a fixture story. Asserts on:
 *   - title, status pill, persona row
 *   - acceptance-criteria checkboxes render with correct state
 *   - clicking a checkbox calls toggleAcceptance with the right args
 *   - the store's optimistic update repaints the panel
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import { BmadStoryDetail } from '../BmadStoryDetail';
import { useBmadStore } from '../../../stores/bmad-store';
import { parseStoryFile } from '../../../../shared/types/bmad-kanban-helpers';
import type {
  BmadIpcResult,
  BmadPersonaIdentity,
  BmadSprintStatus,
} from '../../../../shared/types/bmad';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && typeof opts === 'object') {
        return `${key}:${JSON.stringify(opts)}`;
      }
      return key;
    },
  }),
}));

const PERSONA: BmadPersonaIdentity = {
  slug: 'amelia',
  skillId: 'bmad-agent-dev',
  name: 'Amelia',
  title: 'Senior Software Engineer',
  module: 'bmm',
  team: 'core',
  description: '',
  icon: '💻',
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

const PERSONAS = new Map([['amelia', PERSONA]]);

const FIXTURE_RAW = `# 1.2 Account Management

## Status

ready-for-dev

## Story

As a user, I want to manage my account.

## Acceptance Criteria

- [ ] AC 1: Email update
- [x] AC 2: Password change

## Tasks / Subtasks

- [ ] Backend route
`;

const SPRINT_STATUS: BmadSprintStatus = {
  generated: '',
  lastUpdated: '',
  project: 'Test',
  projectKey: 'TEST',
  trackingSystem: 'file-system',
  storyLocation: '',
  developmentStatus: {
    'epic-1': 'in-progress',
    '1-2-account-management': 'ready-for-dev',
  },
};

function ok<T>(data: T): BmadIpcResult<T> {
  return { success: true, data };
}
function fail<T = never>(message: string): BmadIpcResult<T> {
  return {
    success: false,
    error: { code: 'IO_ERROR', message },
  };
}

function installMock(opts: {
  writeShouldFail?: boolean;
} = {}) {
  const writeStoryFile = vi.fn().mockResolvedValue(
    opts.writeShouldFail
      ? fail('disk full')
      : ok({ absolutePath: '/tmp/x' }),
  );
  // Merge into the existing jsdom window — replacing it would wipe
  // setTimeout/clearTimeout etc. that React + Radix rely on.
  (window as unknown as { electronAPI: { bmad: { writeStoryFile: typeof writeStoryFile } } }).electronAPI = {
    bmad: { writeStoryFile },
  };
  return { writeStoryFile };
}

function seedStore() {
  useBmadStore.setState({
    activeProjectRoot: '/tmp/test',
    track: 'method',
    loadStatus: 'ready',
    lastError: null,
    projectSummary: null,
    sprintStatus: SPRINT_STATUS,
    phaseGraph: null,
    recommendation: null,
    personas: [PERSONA],
    storyFiles: [],
    optimisticStatus: {},
    storyDetails: {
      '1-2-account-management': {
        storyKey: '1-2-account-management',
        storyPath:
          '_bmad-output/implementation-artifacts/1-2-account-management.md',
        raw: FIXTURE_RAW,
        parsed: parseStoryFile(FIXTURE_RAW, {
          fallbackTitle: 'account-management',
        }),
        absolutePath:
          '/tmp/test/_bmad-output/implementation-artifacts/1-2-account-management.md',
        loadedAt: 0,
      },
    },
    activeStoryKey: '1-2-account-management',
    activeInvocation: null,
  });
}

describe('BmadStoryDetail', () => {
  beforeEach(() => {
    installMock();
    seedStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders title, status pill, persona, AC list, body', () => {
    render(<BmadStoryDetail personas={PERSONAS} />);
    expect(screen.getByText('1.2 Account Management')).toBeInTheDocument();
    expect(
      screen.getByText('sprintStatus.developmentStatus.ready-for-dev'),
    ).toBeInTheDocument();
    // Persona row
    expect(
      screen.getByText(/Amelia.*Senior Software Engineer/),
    ).toBeInTheDocument();

    const ac1 = screen.getByTestId('bmad-story-ac-1');
    const ac2 = screen.getByTestId('bmad-story-ac-2');
    expect(ac1).toHaveTextContent('AC 1: Email update');
    expect(ac2).toHaveTextContent('AC 2: Password change');

    const cb1 = ac1.querySelector('button[role="checkbox"]') as HTMLElement;
    const cb2 = ac2.querySelector('button[role="checkbox"]') as HTMLElement;
    expect(cb1.getAttribute('data-state')).toBe('unchecked');
    expect(cb2.getAttribute('data-state')).toBe('checked');
  });

  it('toggles AC1 to done — store reflects the change synchronously', async () => {
    const { writeStoryFile } = installMock();
    seedStore();
    render(<BmadStoryDetail personas={PERSONAS} />);
    const cb1 = screen
      .getByTestId('bmad-story-ac-1')
      .querySelector('button[role="checkbox"]') as HTMLElement;
    fireEvent.click(cb1);

    await waitFor(() => expect(writeStoryFile).toHaveBeenCalledTimes(1));
    const args = writeStoryFile.mock.calls[0];
    expect(args[0]).toBe('/tmp/test');
    expect(args[1]).toBe(
      '_bmad-output/implementation-artifacts/1-2-account-management.md',
    );
    expect(args[2]).toContain('- [x] AC 1');
    // Store cache shows the toggled state
    const detail =
      useBmadStore.getState().storyDetails['1-2-account-management'];
    expect(detail?.parsed.acceptanceCriteria[0]?.done).toBe(true);
  });

  it('rolls back AC toggle when write fails', async () => {
    installMock({ writeShouldFail: true });
    seedStore();
    render(<BmadStoryDetail personas={PERSONAS} />);
    const cb1 = screen
      .getByTestId('bmad-story-ac-1')
      .querySelector('button[role="checkbox"]') as HTMLElement;
    fireEvent.click(cb1);

    await waitFor(() => {
      const error = useBmadStore.getState().lastError;
      expect(error).toBe('disk full');
    });
    // After rollback, AC1 is back to not-done
    const detail =
      useBmadStore.getState().storyDetails['1-2-account-management'];
    expect(detail?.parsed.acceptanceCriteria[0]?.done).toBe(false);
  });

  it('returns null when no story is selected', () => {
    useBmadStore.setState({ activeStoryKey: null });
    const { container } = render(<BmadStoryDetail personas={PERSONAS} />);
    expect(container.firstChild).toBeNull();
  });

  it('closes the panel when the close button is clicked', () => {
    render(<BmadStoryDetail personas={PERSONAS} />);
    const close = screen.getByLabelText('kanban.closeStoryDetailAriaLabel');
    fireEvent.click(close);
    expect(useBmadStore.getState().activeStoryKey).toBeNull();
  });
});
