/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import { BmadModuleManager } from '../BmadModuleManager';
import type {
  BmadInstallerResult,
  BmadIpcResult,
  BmadModule,
} from '../../../../shared/types/bmad';

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

const PROJECT_ROOT = '/tmp/bmad-module-test';

const MODULES: readonly BmadModule[] = [
  moduleEntry('core'),
  moduleEntry('bmm'),
  moduleEntry('cis'),
];

function moduleEntry(name: string): BmadModule {
  return {
    name,
    version: '6.6.0',
    installDate: '2026-04-30T00:00:00.000Z',
    lastUpdated: '2026-04-30T00:00:00.000Z',
    source: 'built-in',
    npmPackage: null,
    repoUrl: null,
  };
}

function ok<T>(data: T): BmadIpcResult<T> {
  return { success: true, data };
}

function installMock(overrides: { modules?: readonly BmadModule[] } = {}) {
  const cleanup = vi.fn();
  const listModules = vi.fn().mockResolvedValue(ok(overrides.modules ?? MODULES));
  const onInstallerStream = vi.fn().mockReturnValue(cleanup);
  const runInstaller = vi.fn().mockResolvedValue(
    ok<BmadInstallerResult>({
      exitCode: 0,
      success: true,
      directory: PROJECT_ROOT,
      durationMs: 1,
      bmadDirCreated: true,
      modules: ['core', 'bmm'],
      tools: ['cursor'],
      skillsConfigured: 42,
      raw: 'ok',
    }),
  );
  const listInstallerOptions = vi.fn().mockResolvedValue(ok({ raw: 'options-output' }));

  (window as unknown as { electronAPI: unknown }).electronAPI = {
    bmad: {
      listModules,
      runInstaller,
      onInstallerStream,
      listInstallerOptions,
    },
  };

  return {
    cleanup,
    listModules,
    onInstallerStream,
    runInstaller,
    listInstallerOptions,
  };
}

describe('BmadModuleManager', () => {
  let mock: ReturnType<typeof installMock>;

  beforeEach(() => {
    mock = installMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders installed modules from the manifest-backed IPC call', async () => {
    render(<BmadModuleManager projectRoot={PROJECT_ROOT} />);

    await screen.findByText('core');

    expect(mock.listModules).toHaveBeenCalledWith(PROJECT_ROOT);
    expect(screen.getByText('bmm')).toBeInTheDocument();
    expect(screen.getByText('cis')).toBeInTheDocument();
    expect(screen.getByTestId('bmad-module-remove-core')).toBeDisabled();
  });

  it('runs quick-update without a modules filter for row update buttons', async () => {
    render(<BmadModuleManager projectRoot={PROJECT_ROOT} />);
    await screen.findByText('bmm');

    fireEvent.click(screen.getByTestId('bmad-module-update-bmm'));

    await waitFor(() => {
      expect(mock.runInstaller).toHaveBeenCalledTimes(1);
    });
    expect(mock.runInstaller).toHaveBeenCalledWith({
      directory: PROJECT_ROOT,
      yes: true,
      action: 'quick-update',
    });
  });

  it('removes by running a full update with the exact remaining module set', async () => {
    render(<BmadModuleManager projectRoot={PROJECT_ROOT} />);
    await screen.findByText('cis');

    fireEvent.click(screen.getByTestId('bmad-module-remove-cis'));

    await waitFor(() => {
      expect(mock.runInstaller).toHaveBeenCalledTimes(1);
    });
    expect(mock.runInstaller).toHaveBeenCalledWith({
      directory: PROJECT_ROOT,
      yes: true,
      action: 'update',
      modules: ['bmm'],
    });
  });

  it('installs selected modules by preserving existing non-core modules', async () => {
    render(<BmadModuleManager projectRoot={PROJECT_ROOT} />);
    await screen.findByText('bmm');

    fireEvent.click(screen.getByLabelText('installWizard.moduleNames.rgm'));
    fireEvent.click(screen.getByTestId('bmad-module-install'));

    await waitFor(() => {
      expect(mock.runInstaller).toHaveBeenCalledTimes(1);
    });
    expect(mock.runInstaller).toHaveBeenCalledWith({
      directory: PROJECT_ROOT,
      yes: true,
      action: 'update',
      modules: ['bmm', 'cis', 'rgm'],
    });
  });

  it('lists installer options in the output panel', async () => {
    render(<BmadModuleManager projectRoot={PROJECT_ROOT} />);
    await screen.findByText('bmm');

    fireEvent.click(screen.getByTestId('bmad-module-list-options'));

    await waitFor(() => {
      expect(mock.listInstallerOptions).toHaveBeenCalledWith(PROJECT_ROOT);
    });
    expect(screen.getByText('options-output')).toBeInTheDocument();
  });
});
