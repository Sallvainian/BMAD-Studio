import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSpawnWorkerProcess = vi.fn();
const mockKillProcess = vi.fn();

vi.mock('./agent-process', () => ({
  AgentProcessManager: class {
    configure = vi.fn();
    spawnWorkerProcess = mockSpawnWorkerProcess;
    killProcess = mockKillProcess;
    killAllProcesses = vi.fn();
  },
}));

vi.mock('./agent-queue', () => ({
  AgentQueueManager: class {
    startRoadmapGeneration = vi.fn();
    startIdeationGeneration = vi.fn();
    stopIdeation = vi.fn();
    isIdeationRunning = vi.fn(() => false);
    stopRoadmap = vi.fn();
    isRoadmapRunning = vi.fn(() => false);
  },
}));

vi.mock('../claude-profile/operation-registry', () => ({
  getOperationRegistry: vi.fn(() => ({
    unregisterOperation: vi.fn(),
  })),
}));

import { AgentManager } from './agent-manager';

function createManagerWithErrorHandler() {
  const manager = new AgentManager();
  const errorHandler = vi.fn();
  manager.on('error', errorHandler);
  return { manager, errorHandler };
}

function expectBmadWorkflowError(errorHandler: ReturnType<typeof vi.fn>, taskId: string, action: string) {
  expect(errorHandler).toHaveBeenCalledWith(
    taskId,
    expect.stringContaining(`Legacy ${action} has been removed in BMad Studio.`),
  );
  expect(errorHandler).toHaveBeenCalledWith(
    taskId,
    expect.stringContaining('Use the BMad planning and sprint workflows instead.'),
  );
}

describe('AgentManager legacy orchestration entrypoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('startSpecCreation fails fast and does not spawn a worker', async () => {
    const { manager, errorHandler } = createManagerWithErrorHandler();

    await manager.startSpecCreation('task-spec', '/project', 'Create a spec');

    expectBmadWorkflowError(errorHandler, 'task-spec', 'spec creation');
    expect(mockSpawnWorkerProcess).not.toHaveBeenCalled();
  });

  it('startTaskExecution fails fast and does not spawn a worker', async () => {
    const { manager, errorHandler } = createManagerWithErrorHandler();

    await manager.startTaskExecution('task-build', '/project', 'spec-001');

    expectBmadWorkflowError(errorHandler, 'task-build', 'task execution');
    expect(mockSpawnWorkerProcess).not.toHaveBeenCalled();
  });

  it('startQAProcess fails fast and does not spawn a worker', async () => {
    const { manager, errorHandler } = createManagerWithErrorHandler();

    await manager.startQAProcess('task-qa', '/project', 'spec-001');

    expectBmadWorkflowError(errorHandler, 'task-qa', 'QA');
    expect(mockSpawnWorkerProcess).not.toHaveBeenCalled();
  });

  it('restartTask returns false and does not spawn or restart a worker', () => {
    const { manager, errorHandler } = createManagerWithErrorHandler();

    const result = manager.restartTask('task-restart', 'profile-2');

    expect(result).toBe(false);
    expectBmadWorkflowError(errorHandler, 'task-restart', 'task restart');
    expect(mockSpawnWorkerProcess).not.toHaveBeenCalled();
    expect(mockKillProcess).not.toHaveBeenCalled();
  });
});
