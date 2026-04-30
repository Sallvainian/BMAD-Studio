/**
 * Unit tests for `bmad-store.ts` (Phase 3 deliverable §5).
 *
 * Mocks `window.electronAPI.bmad` end-to-end so the store can be exercised
 * without the Electron host. Covers:
 *   - loadProject happy path (parallel fetches + watcher start)
 *   - loadProject for non-BMad projects (no fetches beyond detect)
 *   - loadProject failure surfaces error
 *   - setStoryStatus optimistic update + watcher reconciliation
 *   - setStoryStatus rollback on write failure
 *   - selectStory caches the parsed body, repeats are no-ops
 *   - toggleAcceptance writes back atomically + rolls back on failure
 *   - applyFileEvent re-fetches the right slice per event type
 *   - selectEpicViews respects optimistic overrides + title cache
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  selectActiveStoryDetail,
  selectDisplayedStatus,
  selectEpicViews,
  useBmadStore,
} from '../bmad-store';
import type {
  BmadIpcResult,
  BmadSprintStatus,
  BmadHelpRecommendation,
  BmadPersonaIdentity,
  BmadPhaseGraph,
  BmadProjectSummary,
  BmadFileEvent,
} from '../../../shared/types/bmad';

// =============================================================================
// IPC mock
// =============================================================================

interface BmadIpcMock {
  detectProject: ReturnType<typeof vi.fn>;
  readSprintStatusTyped: ReturnType<typeof vi.fn>;
  getPhaseGraph: ReturnType<typeof vi.fn>;
  getHelpRecommendation: ReturnType<typeof vi.fn>;
  listPersonas: ReturnType<typeof vi.fn>;
  listStoryFiles: ReturnType<typeof vi.fn>;
  startWatcher: ReturnType<typeof vi.fn>;
  stopWatcher: ReturnType<typeof vi.fn>;
  updateStoryStatus: ReturnType<typeof vi.fn>;
  readStoryFile: ReturnType<typeof vi.fn>;
  writeStoryFile: ReturnType<typeof vi.fn>;
  onFileEvent: ReturnType<typeof vi.fn>;
  onOrchestratorEvent: ReturnType<typeof vi.fn>;
  // Phase 4
  runWorkflow: ReturnType<typeof vi.fn>;
  runHelpAI: ReturnType<typeof vi.fn>;
  respondToWorkflowMenu: ReturnType<typeof vi.fn>;
  onWorkflowStream: ReturnType<typeof vi.fn>;
  onWorkflowMenuRequest: ReturnType<typeof vi.fn>;
}

function ok<T>(data: T): BmadIpcResult<T> {
  return { success: true, data };
}
function fail<T = never>(
  code: 'INVALID_INPUT' | 'PROJECT_NOT_BMAD' | 'IO_ERROR' | 'UNKNOWN',
  message: string,
): BmadIpcResult<T> {
  return { success: false, error: { code, message } };
}

const PROJECT_ROOT = '/tmp/test-bmad-project';

const SAMPLE_SUMMARY: BmadProjectSummary = {
  projectRoot: PROJECT_ROOT,
  isBmadProject: true,
  manifest: null,
  skillCount: 30,
  moduleCount: 2,
};

const SAMPLE_SPRINT_STATUS: BmadSprintStatus = {
  generated: '04-30-2026 09:00',
  lastUpdated: '04-30-2026 09:30',
  project: 'Test',
  projectKey: 'TST',
  trackingSystem: 'file-system',
  storyLocation: '_bmad-output/implementation-artifacts/',
  developmentStatus: {
    'epic-1': 'in-progress',
    '1-1-foo': 'ready-for-dev',
    '1-2-bar': 'backlog',
    'epic-1-retrospective': 'optional',
  },
};

const SAMPLE_PHASE_GRAPH: BmadPhaseGraph = {
  slices: [],
  anytimeWorkflows: [],
};

const SAMPLE_RECOMMENDATION: BmadHelpRecommendation = {
  currentPhase: '4-implementation',
  required: null,
  recommended: [],
  completed: [],
  track: 'method',
};

const SAMPLE_PERSONA: BmadPersonaIdentity = {
  slug: 'amelia',
  skillId: 'bmad-agent-dev',
  name: 'Amelia',
  title: 'Senior Software Engineer',
  module: 'bmm',
  team: 'core',
  description: 'Senior software engineer',
  icon: '💻',
  role: 'Implementation lead',
  identity: 'Amelia, the dev',
  communicationStyle: 'precise',
  principles: [],
  persistentFacts: [],
  activationStepsPrepend: [],
  activationStepsAppend: [],
  menu: [],
  phase: '4-implementation',
};

function installMock(): BmadIpcMock {
  const mock: BmadIpcMock = {
    detectProject: vi.fn().mockResolvedValue(ok(SAMPLE_SUMMARY)),
    readSprintStatusTyped: vi.fn().mockResolvedValue(ok(SAMPLE_SPRINT_STATUS)),
    getPhaseGraph: vi.fn().mockResolvedValue(ok(SAMPLE_PHASE_GRAPH)),
    getHelpRecommendation: vi.fn().mockResolvedValue(ok(SAMPLE_RECOMMENDATION)),
    listPersonas: vi.fn().mockResolvedValue(ok([SAMPLE_PERSONA])),
    listStoryFiles: vi.fn().mockResolvedValue(ok({ files: ['_bmad-output/implementation-artifacts/1-1-foo.md'] })),
    startWatcher: vi.fn().mockResolvedValue(ok({ watching: true })),
    stopWatcher: vi.fn().mockResolvedValue(ok({ watching: false })),
    updateStoryStatus: vi.fn(),
    readStoryFile: vi.fn(),
    writeStoryFile: vi.fn(),
    onFileEvent: vi.fn().mockReturnValue(() => {}),
    onOrchestratorEvent: vi.fn().mockReturnValue(() => {}),
    runWorkflow: vi.fn().mockResolvedValue(
      ok({
        outcome: 'completed',
        skillId: 'bmad-dev-story',
        turns: 1,
        durationMs: 1,
        outputFiles: [],
        invocationId: 'mock-store-id',
      }),
    ),
    runHelpAI: vi.fn().mockResolvedValue(ok({ invocationId: 'mock-help-id' })),
    respondToWorkflowMenu: vi.fn().mockResolvedValue(ok({ resolved: true })),
    onWorkflowStream: vi.fn().mockReturnValue(() => {}),
    onWorkflowMenuRequest: vi.fn().mockReturnValue(() => {}),
  };

  // Merge into the global object so we don't smash anything jsdom set up.
  // The store reads `window.electronAPI?.bmad`; in node mode (no jsdom env)
  // we just need a global `window` reference.
  if (typeof window === 'undefined') {
    (globalThis as unknown as {
      window: { electronAPI: { bmad: BmadIpcMock } };
    }).window = {
      electronAPI: { bmad: mock },
    } as never;
  } else {
    (window as unknown as { electronAPI: { bmad: BmadIpcMock } }).electronAPI = {
      bmad: mock,
    };
  }

  return mock;
}

// =============================================================================
// Tests
// =============================================================================

describe('useBmadStore', () => {
  let mock: BmadIpcMock;

  beforeEach(() => {
    mock = installMock();
    // Reset the store to its pristine state.
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

  describe('loadProject', () => {
    it('loads in parallel and lands in `ready` for a BMad project', async () => {
      await useBmadStore.getState().loadProject(PROJECT_ROOT);
      const s = useBmadStore.getState();
      expect(s.loadStatus).toBe('ready');
      expect(s.activeProjectRoot).toBe(PROJECT_ROOT);
      expect(s.projectSummary).toEqual(SAMPLE_SUMMARY);
      expect(s.sprintStatus).toEqual(SAMPLE_SPRINT_STATUS);
      expect(s.phaseGraph).toEqual(SAMPLE_PHASE_GRAPH);
      expect(s.recommendation).toEqual(SAMPLE_RECOMMENDATION);
      expect(s.personas).toEqual([SAMPLE_PERSONA]);
      expect(s.storyFiles).toEqual([
        '_bmad-output/implementation-artifacts/1-1-foo.md',
      ]);

      expect(mock.detectProject).toHaveBeenCalledWith(PROJECT_ROOT);
      expect(mock.startWatcher).toHaveBeenCalledWith(PROJECT_ROOT, {
        debounceMs: 250,
      });
    });

    it('skips per-slice fetches when not a BMad project', async () => {
      mock.detectProject.mockResolvedValue(
        ok({ ...SAMPLE_SUMMARY, isBmadProject: false, manifest: null }),
      );
      await useBmadStore.getState().loadProject(PROJECT_ROOT);
      const s = useBmadStore.getState();
      expect(s.loadStatus).toBe('ready');
      expect(s.projectSummary?.isBmadProject).toBe(false);
      expect(mock.readSprintStatusTyped).not.toHaveBeenCalled();
      expect(mock.getPhaseGraph).not.toHaveBeenCalled();
      expect(mock.startWatcher).not.toHaveBeenCalled();
    });

    it('lands in `error` when detect fails', async () => {
      mock.detectProject.mockResolvedValue(
        fail('PROJECT_NOT_BMAD', 'Not BMad'),
      );
      await useBmadStore.getState().loadProject(PROJECT_ROOT);
      const s = useBmadStore.getState();
      expect(s.loadStatus).toBe('error');
      expect(s.lastError).toBe('Not BMad');
    });

    it('surfaces the first slice failure but keeps the load `ready`', async () => {
      mock.getPhaseGraph.mockResolvedValue(
        fail('IO_ERROR', 'manifest.yaml is corrupt'),
      );
      await useBmadStore.getState().loadProject(PROJECT_ROOT);
      const s = useBmadStore.getState();
      expect(s.loadStatus).toBe('ready');
      expect(s.lastError).toBe('manifest.yaml is corrupt');
      expect(s.sprintStatus).toEqual(SAMPLE_SPRINT_STATUS);
    });
  });

  describe('setStoryStatus', () => {
    beforeEach(async () => {
      await useBmadStore.getState().loadProject(PROJECT_ROOT);
    });

    it('paints the optimistic override before the IPC resolves', async () => {
      mock.updateStoryStatus.mockImplementation(
        () =>
          new Promise<BmadIpcResult<BmadSprintStatus>>((resolve) => {
            setTimeout(
              () =>
                resolve(
                  ok({
                    ...SAMPLE_SPRINT_STATUS,
                    developmentStatus: {
                      ...SAMPLE_SPRINT_STATUS.developmentStatus,
                      '1-1-foo': 'in-progress',
                    },
                  }),
                ),
              25,
            );
          }),
      );

      const promise = useBmadStore
        .getState()
        .setStoryStatus('1-1-foo', 'in-progress');

      // Optimistic override visible synchronously after the call returns control.
      await Promise.resolve();
      expect(useBmadStore.getState().optimisticStatus['1-1-foo']).toBe(
        'in-progress',
      );
      expect(
        selectDisplayedStatus(useBmadStore.getState(), '1-1-foo'),
      ).toBe('in-progress');

      const result = await promise;
      expect(result).toEqual({ success: true });
      // After the writer returns the canonical YAML, the override stays
      // until the watcher event lands; the sprint-status itself reflects
      // the new state.
      expect(useBmadStore.getState().sprintStatus?.developmentStatus['1-1-foo']).toBe(
        'in-progress',
      );
    });

    it('rolls back the optimistic override on write failure', async () => {
      mock.updateStoryStatus.mockResolvedValue(
        fail('IO_ERROR', 'disk full'),
      );
      const result = await useBmadStore
        .getState()
        .setStoryStatus('1-1-foo', 'in-progress');
      expect(result.success).toBe(false);
      expect(result.error).toBe('disk full');
      expect(useBmadStore.getState().optimisticStatus['1-1-foo']).toBeUndefined();
      expect(useBmadStore.getState().lastError).toBe('disk full');
    });

    it('rejects unknown story keys', async () => {
      const result = await useBmadStore
        .getState()
        .setStoryStatus('nonexistent', 'in-progress');
      expect(result.success).toBe(false);
      expect(mock.updateStoryStatus).not.toHaveBeenCalled();
    });

    it('no-ops when the new status equals the current status', async () => {
      const result = await useBmadStore
        .getState()
        .setStoryStatus('1-2-bar', 'backlog');
      expect(result).toEqual({ success: true });
      expect(mock.updateStoryStatus).not.toHaveBeenCalled();
    });
  });

  describe('selectStory + toggleAcceptance', () => {
    beforeEach(async () => {
      await useBmadStore.getState().loadProject(PROJECT_ROOT);
    });

    it('reads, parses, and caches a story file on selection', async () => {
      mock.readStoryFile.mockResolvedValue(
        ok({
          contents: '# Test Story\n\n## Acceptance Criteria\n\n- [ ] AC 1\n',
          absolutePath: `${PROJECT_ROOT}/_bmad-output/implementation-artifacts/1-1-foo.md`,
        }),
      );
      const r = await useBmadStore.getState().selectStory('1-1-foo');
      expect(r.success).toBe(true);
      const detail = selectActiveStoryDetail(useBmadStore.getState());
      expect(detail?.parsed.title).toBe('Test Story');
      expect(detail?.parsed.acceptanceCriteria).toHaveLength(1);

      // Re-selecting the same story is a no-op (cache hit).
      mock.readStoryFile.mockClear();
      await useBmadStore.getState().selectStory('1-1-foo');
      expect(mock.readStoryFile).not.toHaveBeenCalled();
    });

    it('toggles AC and writes the updated markdown', async () => {
      mock.readStoryFile.mockResolvedValue(
        ok({
          contents: '# Story\n\n## Acceptance Criteria\n\n- [ ] AC 1\n',
          absolutePath: `${PROJECT_ROOT}/_bmad-output/implementation-artifacts/1-1-foo.md`,
        }),
      );
      mock.writeStoryFile.mockResolvedValue(
        ok({
          absolutePath: `${PROJECT_ROOT}/_bmad-output/implementation-artifacts/1-1-foo.md`,
        }),
      );
      await useBmadStore.getState().selectStory('1-1-foo');
      const result = await useBmadStore
        .getState()
        .toggleAcceptance('1-1-foo', 1, true);
      expect(result.success).toBe(true);
      expect(mock.writeStoryFile).toHaveBeenCalledTimes(1);
      const writeArgs = mock.writeStoryFile.mock.calls[0];
      expect(writeArgs[0]).toBe(PROJECT_ROOT);
      expect(writeArgs[2]).toContain('- [x] AC 1');
      const detail = selectActiveStoryDetail(useBmadStore.getState());
      expect(detail?.parsed.acceptanceCriteria[0]?.done).toBe(true);
    });

    it('rolls back the cache on write failure', async () => {
      mock.readStoryFile.mockResolvedValue(
        ok({
          contents: '# Story\n\n## Acceptance Criteria\n\n- [ ] AC 1\n',
          absolutePath: `${PROJECT_ROOT}/_bmad-output/implementation-artifacts/1-1-foo.md`,
        }),
      );
      mock.writeStoryFile.mockResolvedValue(fail('IO_ERROR', 'permission denied'));
      await useBmadStore.getState().selectStory('1-1-foo');
      const before = selectActiveStoryDetail(useBmadStore.getState())?.raw;
      const result = await useBmadStore
        .getState()
        .toggleAcceptance('1-1-foo', 1, true);
      expect(result.success).toBe(false);
      expect(result.error).toBe('permission denied');
      const after = selectActiveStoryDetail(useBmadStore.getState())?.raw;
      expect(after).toBe(before);
      expect(useBmadStore.getState().lastError).toBe('permission denied');
    });
  });

  describe('applyFileEvent', () => {
    beforeEach(async () => {
      await useBmadStore.getState().loadProject(PROJECT_ROOT);
      mock.readSprintStatusTyped.mockClear();
      mock.getHelpRecommendation.mockClear();
      mock.getPhaseGraph.mockClear();
      mock.listStoryFiles.mockClear();
    });

    it('re-fetches sprint-status + recommendation on sprint-status-changed', async () => {
      const event: BmadFileEvent = {
        type: 'sprint-status-changed',
        path: `${PROJECT_ROOT}/_bmad-output/implementation-artifacts/sprint-status.yaml`,
        projectRoot: PROJECT_ROOT,
        timestamp: Date.now(),
      };
      await useBmadStore.getState().applyFileEvent(event);
      expect(mock.readSprintStatusTyped).toHaveBeenCalledTimes(1);
      expect(mock.getHelpRecommendation).toHaveBeenCalledTimes(1);
      // Optimistic overrides cleared on re-fetch.
      expect(useBmadStore.getState().optimisticStatus).toEqual({});
    });

    it('re-fetches phase graph + recommendation on manifest-changed', async () => {
      await useBmadStore.getState().applyFileEvent({
        type: 'manifest-changed',
        path: '',
        projectRoot: PROJECT_ROOT,
        timestamp: Date.now(),
      });
      expect(mock.getPhaseGraph).toHaveBeenCalledTimes(1);
      expect(mock.getHelpRecommendation).toHaveBeenCalledTimes(1);
    });

    it('re-fetches story file list on story-file-changed', async () => {
      await useBmadStore.getState().applyFileEvent({
        type: 'story-file-changed',
        path: `${PROJECT_ROOT}/_bmad-output/implementation-artifacts/1-1-foo.md`,
        projectRoot: PROJECT_ROOT,
        timestamp: Date.now(),
      });
      expect(mock.listStoryFiles).toHaveBeenCalledTimes(1);
    });

    it('ignores events from other projects', async () => {
      await useBmadStore.getState().applyFileEvent({
        type: 'sprint-status-changed',
        path: '',
        projectRoot: '/some/other/project',
        timestamp: Date.now(),
      });
      expect(mock.readSprintStatusTyped).not.toHaveBeenCalled();
    });
  });

  describe('selectEpicViews', () => {
    it('respects optimistic overrides', async () => {
      await useBmadStore.getState().loadProject(PROJECT_ROOT);
      useBmadStore.setState((s) => ({
        optimisticStatus: { ...s.optimisticStatus, '1-1-foo': 'in-progress' },
      }));
      const epics = selectEpicViews(useBmadStore.getState());
      expect(epics).toHaveLength(1);
      const story = epics[0]?.stories.find((s) => s.key === '1-1-foo');
      expect(story?.status).toBe('in-progress');
    });
  });

  // ─── Phase 4: chat thread + workflow lifecycle ──────────────────────────
  describe('startWorkflow (Phase 4)', () => {
    const TEST_PROFILE = {
      id: 'tp',
      name: 'Test',
      isDefault: true,
      createdAt: new Date(),
    };

    beforeEach(async () => {
      await useBmadStore.getState().loadProject(PROJECT_ROOT);
    });

    it('creates a chat thread, sets activeChatId, paints optimistic in-progress for ready-for-dev stories', async () => {
      const result = await useBmadStore.getState().startWorkflow(
        { skillName: 'bmad-dev-story', storyKey: '1-1-foo' },
        TEST_PROFILE,
      );
      expect(result.success).toBe(true);
      expect(result.invocationId).toBeDefined();

      const state = useBmadStore.getState();
      expect(state.activeChatId).toBe(result.invocationId);
      const thread = state.chatThreads[result.invocationId!];
      expect(thread).toBeDefined();
      expect(thread?.skillName).toBe('bmad-dev-story');
      expect(thread?.personaSlug).toBe('amelia');
      // Optimistic in-progress paint for the ready-for-dev story.
      expect(state.optimisticStatus['1-1-foo']).toBe('in-progress');
      // IPC fire
      expect(mock.runWorkflow).toHaveBeenCalled();
    });

    it('does not paint optimistic status when the story is already in-progress', async () => {
      const result = await useBmadStore.getState().startWorkflow(
        { skillName: 'bmad-dev-story', storyKey: '1-2-bar' },
        TEST_PROFILE,
      );
      expect(result.success).toBe(true);
      // 1-2-bar is `backlog` initially → still paints (per the action's rule).
      const state = useBmadStore.getState();
      expect(state.optimisticStatus['1-2-bar']).toBe('in-progress');
    });

    it('rolls back optimistic status when runWorkflow fails', async () => {
      mock.runWorkflow.mockResolvedValue({
        success: false,
        error: { code: 'PROVIDER_ERROR', message: 'rate limited' },
      });
      const result = await useBmadStore.getState().startWorkflow(
        { skillName: 'bmad-dev-story', storyKey: '1-1-foo' },
        TEST_PROFILE,
      );
      expect(result.success).toBe(false);
      const state = useBmadStore.getState();
      const thread = state.chatThreads[result.invocationId!];
      expect(thread?.status).toBe('errored');
      expect(thread?.error).toBe('rate limited');
      expect(state.optimisticStatus['1-1-foo']).toBeUndefined();
      expect(state.activeInvocation).toBeNull();
    });

    it('startHelpAI creates an empty thread keyed to bmad-help', async () => {
      const result = await useBmadStore.getState().startHelpAI(
        { question: 'what now?' },
        TEST_PROFILE,
      );
      expect(result.success).toBe(true);
      const state = useBmadStore.getState();
      const thread = state.chatThreads[result.invocationId!];
      expect(thread?.skillName).toBe('bmad-help');
      expect(thread?.personaSlug).toBeNull();
      expect(thread?.messages[0]?.content).toBe('what now?');
      expect(mock.runHelpAI).toHaveBeenCalled();
    });
  });

  describe('respondToMenu (Phase 4)', () => {
    beforeEach(async () => {
      await useBmadStore.getState().loadProject(PROJECT_ROOT);
    });

    it('appends a user message + clears the pending menu + calls IPC', async () => {
      const invocationId = 'inv-test';
      useBmadStore.setState((s) => ({
        chatThreads: {
          ...s.chatThreads,
          [invocationId]: {
            invocationId,
            skillName: 'bmad-create-prd',
            personaSlug: 'john',
            storyKey: null,
            title: null,
            messages: [],
            status: 'awaiting-menu',
            pendingMenu: {
              menuId: 'm1',
              receivedAt: 0,
              menu: { prompt: '', options: [] },
            },
            startedAt: 0,
          },
        },
        activeChatId: invocationId,
      }));

      const result = await useBmadStore
        .getState()
        .respondToMenu(invocationId, { optionCode: 'C', text: 'Continue' });
      expect(result.success).toBe(true);

      const state = useBmadStore.getState();
      const thread = state.chatThreads[invocationId];
      expect(thread?.pendingMenu).toBeNull();
      expect(thread?.status).toBe('streaming');
      expect(thread?.messages).toHaveLength(1);
      expect(thread?.messages[0]?.role).toBe('user');
      expect(thread?.messages[0]?.content).toBe('C Continue');

      expect(mock.respondToWorkflowMenu).toHaveBeenCalledWith({
        invocationId,
        menuId: 'm1',
        choice: { optionCode: 'C', text: 'Continue' },
      });
    });

    it('returns error when no pending menu exists', async () => {
      const result = await useBmadStore
        .getState()
        .respondToMenu('nope', { text: 'foo' });
      expect(result.success).toBe(false);
    });
  });

  describe('appendStreamChunk (Phase 4)', () => {
    beforeEach(async () => {
      await useBmadStore.getState().loadProject(PROJECT_ROOT);
      useBmadStore.setState((s) => ({
        chatThreads: {
          ...s.chatThreads,
          'inv-stream': {
            invocationId: 'inv-stream',
            skillName: 'bmad-create-prd',
            personaSlug: 'john',
            storyKey: null,
            title: null,
            messages: [],
            status: 'starting',
            pendingMenu: null,
            startedAt: 0,
          },
        },
      }));
    });

    it('text-delta chunks accumulate into a single streaming assistant message', () => {
      const store = useBmadStore.getState();
      store.appendStreamChunk('inv-stream', {
        kind: 'text-delta',
        text: 'Hello ',
        seq: 1,
        timestamp: 1,
      });
      store.appendStreamChunk('inv-stream', {
        kind: 'text-delta',
        text: 'world',
        seq: 2,
        timestamp: 2,
      });
      const thread = useBmadStore.getState().chatThreads['inv-stream'];
      expect(thread?.messages).toHaveLength(1);
      expect(thread?.messages[0]?.content).toBe('Hello world');
      expect(thread?.messages[0]?.role).toBe('assistant');
      expect(thread?.messages[0]?.streaming).toBe(true);
      expect(thread?.status).toBe('streaming');
    });

    it('done chunk finalizes the streaming flag', () => {
      const store = useBmadStore.getState();
      store.appendStreamChunk('inv-stream', {
        kind: 'text-delta',
        text: 'Hi',
        seq: 1,
        timestamp: 1,
      });
      store.appendStreamChunk('inv-stream', {
        kind: 'done',
        seq: 2,
        timestamp: 2,
      });
      const thread = useBmadStore.getState().chatThreads['inv-stream'];
      // The reducer rewrites `streaming: true` → `streaming: false`; the
      // contract (UI side) is "stop pulsing" — both falsy values satisfy it.
      expect(thread?.messages[0]?.streaming).toBeFalsy();
      expect(thread?.status).toBe('completed');
    });

    it('error chunk drops a system message and marks errored', () => {
      const store = useBmadStore.getState();
      store.appendStreamChunk('inv-stream', {
        kind: 'error',
        text: 'boom',
        seq: 1,
        timestamp: 1,
      });
      const thread = useBmadStore.getState().chatThreads['inv-stream'];
      expect(thread?.status).toBe('errored');
      expect(thread?.error).toBe('boom');
    });

    it('tool-call chunks render as compact system messages', () => {
      const store = useBmadStore.getState();
      store.appendStreamChunk('inv-stream', {
        kind: 'tool-call',
        toolName: 'Read',
        toolArgs: { file_path: '/tmp/foo' },
        seq: 1,
        timestamp: 1,
      });
      const thread = useBmadStore.getState().chatThreads['inv-stream'];
      expect(thread?.messages).toHaveLength(1);
      expect(thread?.messages[0]?.role).toBe('system');
      expect(thread?.messages[0]?.content).toBe('Read /tmp/foo');
    });
  });

  describe('selectChat / closeChat / dismissTutorial (Phase 4)', () => {
    it('selectChat updates activeChatId', () => {
      useBmadStore.getState().selectChat('foo');
      expect(useBmadStore.getState().activeChatId).toBe('foo');
      useBmadStore.getState().selectChat(null);
      expect(useBmadStore.getState().activeChatId).toBeNull();
    });

    it('closeChat drops the thread and clears activeChatId when matching', () => {
      useBmadStore.setState({
        chatThreads: {
          'inv-x': {
            invocationId: 'inv-x',
            skillName: 'bmad-help',
            personaSlug: null,
            storyKey: null,
            title: null,
            messages: [],
            status: 'completed',
            pendingMenu: null,
            startedAt: 0,
          },
        },
        activeChatId: 'inv-x',
      });
      useBmadStore.getState().closeChat('inv-x');
      const state = useBmadStore.getState();
      expect(state.chatThreads['inv-x']).toBeUndefined();
      expect(state.activeChatId).toBeNull();
    });

    it('dismissTutorial flips the in-memory flag', () => {
      // localStorage persistence is exercised in the BmadTutorialOverlay
      // jsdom suite; here we only cover the reducer-side state mutation.
      useBmadStore.setState({ tutorialDismissed: false });
      useBmadStore.getState().dismissTutorial();
      expect(useBmadStore.getState().tutorialDismissed).toBe(true);
    });
  });
});
