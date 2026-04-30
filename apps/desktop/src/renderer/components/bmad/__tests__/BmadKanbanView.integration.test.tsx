/**
 * @vitest-environment jsdom
 */

/**
 * BmadKanbanView integration test — Phase 3 acceptance roundtrip.
 *
 * Mounts the full view (kanban + detail panel) wired against a mocked
 * `window.electronAPI.bmad`. Exercises the end-to-end Phase 3 happy path:
 *   1. View loads → calls detectProject + parallel fetches + watcher start
 *   2. Drag-end (simulated via store action) → optimistic update + IPC write
 *   3. Watcher event arrives → store reconciles back to disk truth
 *
 * This is a faster, more reliable proxy for "Playwright drag" — the dnd-kit
 * sortable API is hard to drive headlessly, but the store action that
 * drag-end calls is the same code path. The Playwright suite covers the
 * pixel-level interaction in environments where Electron is built.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';

import { BmadKanbanView } from '../BmadKanbanView';
import { useBmadStore } from '../../../stores/bmad-store';
import type {
  BmadFileEvent,
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

const PROJECT_ROOT = '/tmp/bmad-integration-test';

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

const INITIAL_SPRINT_STATUS: BmadSprintStatus = {
  generated: '04-30-2026 09:00',
  lastUpdated: '04-30-2026 09:00',
  project: 'Integration Test',
  projectKey: 'INT',
  trackingSystem: 'file-system',
  storyLocation: '_bmad-output/implementation-artifacts/',
  developmentStatus: {
    'epic-1': 'in-progress',
    '1-1-user-authentication': 'backlog',
    '1-2-account-management': 'backlog',
  },
};

function ok<T>(data: T): BmadIpcResult<T> {
  return { success: true, data };
}

function installMock() {
  const fileEventListeners = new Set<(e: BmadFileEvent) => void>();
  const writes: BmadSprintStatus[] = [];
  let currentSprint = INITIAL_SPRINT_STATUS;

  const mock = {
    detectProject: vi.fn().mockResolvedValue(
      ok({
        projectRoot: PROJECT_ROOT,
        isBmadProject: true,
        manifest: null,
        skillCount: 30,
        moduleCount: 2,
      }),
    ),
    readSprintStatusTyped: vi.fn().mockImplementation(async () => ok(currentSprint)),
    getPhaseGraph: vi.fn().mockResolvedValue(ok({ slices: [], anytimeWorkflows: [] })),
    getHelpRecommendation: vi.fn().mockResolvedValue(
      ok({
        currentPhase: '4-implementation',
        required: null,
        recommended: [],
        completed: [],
        track: 'method',
      }),
    ),
    listPersonas: vi.fn().mockResolvedValue(ok([PERSONA])),
    listStoryFiles: vi.fn().mockResolvedValue(ok({ files: [] })),
    startWatcher: vi.fn().mockResolvedValue(ok({ watching: true })),
    stopWatcher: vi.fn().mockResolvedValue(ok({ watching: false })),
    updateStoryStatus: vi.fn().mockImplementation(async (args) => {
      currentSprint = {
        ...currentSprint,
        developmentStatus: {
          ...currentSprint.developmentStatus,
          [args.storyKey]: args.status,
        },
      };
      writes.push(currentSprint);
      return ok(currentSprint);
    }),
    readStoryFile: vi.fn(),
    writeStoryFile: vi.fn(),
    onFileEvent: vi.fn().mockImplementation((handler: (e: BmadFileEvent) => void) => {
      fileEventListeners.add(handler);
      return () => fileEventListeners.delete(handler);
    }),
    onOrchestratorEvent: vi.fn().mockReturnValue(() => {}),
  };

  (window as unknown as { electronAPI: { bmad: typeof mock } }).electronAPI = {
    bmad: mock,
  };

  return {
    mock,
    writes,
    fireFileEvent(event: BmadFileEvent) {
      for (const listener of fileEventListeners) {
        listener(event);
      }
    },
    setCurrentSprint(next: BmadSprintStatus) {
      currentSprint = next;
    },
    getCurrentSprint() {
      return currentSprint;
    },
  };
}

describe('BmadKanbanView integration', () => {
  beforeEach(() => {
    useBmadStore.setState({
      activeProjectRoot: null,
      track: 'method',
      loadStatus: 'idle',
      lastError: null,
      projectSummary: null,
      sprintStatus: null,
      phaseGraph: null,
      recommendation: null,
      personas: [],
      storyFiles: [],
      optimisticStatus: {},
      storyDetails: {},
      activeStoryKey: null,
      activeInvocation: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders all 5 columns + 2 stories after the parallel load completes', async () => {
    const harness = installMock();
    render(<BmadKanbanView projectRoot={PROJECT_ROOT} />);

    // 1. Loading state appears synchronously
    expect(screen.getByTestId('bmad-kanban-loading')).toBeInTheDocument();

    // 2. After load, all columns + cards render
    await waitFor(() => {
      expect(screen.getByTestId('bmad-kanban-board')).toBeInTheDocument();
    });

    // 3. Stories appear in the backlog column
    const backlog = screen.getByTestId('bmad-kanban-column-backlog');
    expect(backlog).toContainElement(
      screen.getByText('User Authentication'),
    );
    expect(backlog).toContainElement(
      screen.getByText('Account Management'),
    );

    // 4. Watcher is started
    expect(harness.mock.startWatcher).toHaveBeenCalledWith(PROJECT_ROOT, {
      debounceMs: 250,
    });
  });

  it('drag → drop completes the full kanban roundtrip (write + watcher reconcile)', async () => {
    const harness = installMock();
    render(<BmadKanbanView projectRoot={PROJECT_ROOT} />);
    await waitFor(() =>
      expect(screen.getByTestId('bmad-kanban-board')).toBeInTheDocument(),
    );

    // Simulate a drag-end by calling the store action directly. The
    // BmadKanbanBoard component wires drag-end to this exact call path.
    await act(async () => {
      const result = await useBmadStore
        .getState()
        .setStoryStatus('1-1-user-authentication', 'ready-for-dev');
      expect(result.success).toBe(true);
    });

    // The IPC writer was called with the right payload.
    expect(harness.mock.updateStoryStatus).toHaveBeenCalledWith({
      projectRoot: PROJECT_ROOT,
      storyKey: '1-1-user-authentication',
      status: 'ready-for-dev',
    });

    // The new YAML state is reflected in the store synchronously after
    // the writer returns the canonical payload.
    expect(
      useBmadStore.getState().sprintStatus?.developmentStatus['1-1-user-authentication'],
    ).toBe('ready-for-dev');

    // 4. Simulate the file watcher event arriving — the store's
    // applyFileEvent should re-fetch the sprint status, dropping the
    // optimistic override (already empty after writer success).
    harness.mock.readSprintStatusTyped.mockClear();
    await act(async () => {
      harness.fireFileEvent({
        type: 'sprint-status-changed',
        path: `${PROJECT_ROOT}/_bmad-output/implementation-artifacts/sprint-status.yaml`,
        projectRoot: PROJECT_ROOT,
        timestamp: Date.now(),
      });
      // Allow microtasks to settle.
      await new Promise<void>((r) => setTimeout(r, 0));
    });
    expect(harness.mock.readSprintStatusTyped).toHaveBeenCalledTimes(1);
    expect(useBmadStore.getState().optimisticStatus).toEqual({});
  });

  it('renders the empty state when the project is not BMad', async () => {
    const harness = installMock();
    harness.mock.detectProject.mockResolvedValue(
      ok({
        projectRoot: PROJECT_ROOT,
        isBmadProject: false,
        manifest: null,
        skillCount: 0,
        moduleCount: 0,
      }),
    );
    render(<BmadKanbanView projectRoot={PROJECT_ROOT} />);
    await waitFor(() => {
      // The empty state translation key uses 'errors.PROJECT_NOT_BMAD'
      expect(screen.getByText('errors.PROJECT_NOT_BMAD')).toBeInTheDocument();
    });
    expect(harness.mock.startWatcher).not.toHaveBeenCalled();
  });
});
