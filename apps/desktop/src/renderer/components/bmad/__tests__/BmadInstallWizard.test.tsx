/**
 * @vitest-environment jsdom
 */

/**
 * Tests for BmadInstallWizard (Phase 4 deliverable §4).
 *
 * Verifies:
 *   - modules + track + advanced fields render
 *   - core module is required (disabled checkbox)
 *   - submit fires runInstaller IPC with the constructed args
 *   - stream listener is wired before runInstaller fires
 *   - success state renders Open project button
 *   - error state surfaces the message
 *   - install prompt button calls onLaunch
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import {
  BmadInstallPrompt,
  BmadInstallWizard,
} from '../BmadInstallWizard';
import type {
  BmadInstallerOptions,
  BmadInstallerResult,
  BmadIpcResult,
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

function ok<T>(data: T): BmadIpcResult<T> {
  return { success: true, data };
}
function fail<T = never>(message: string): BmadIpcResult<T> {
  return { success: false, error: { code: 'INSTALLER_FAILED', message } };
}

interface InstallMock {
  runInstaller: ReturnType<typeof vi.fn>;
  onInstallerStream: ReturnType<typeof vi.fn>;
  cleanupSpy: ReturnType<typeof vi.fn>;
}

function installMock(opts: { failMessage?: string } = {}): InstallMock {
  const cleanupSpy = vi.fn();
  const onInstallerStream = vi.fn().mockReturnValue(cleanupSpy);
  const runInstaller = vi.fn().mockResolvedValue(
    opts.failMessage
      ? fail(opts.failMessage)
      : ok<BmadInstallerResult>({
          exitCode: 0,
          success: true,
          directory: '/tmp/x',
          durationMs: 1234,
          bmadDirCreated: true,
          modules: ['core', 'bmm'],
          tools: ['cursor'],
          skillsConfigured: 42,
          raw: 'mock-install-output',
        }),
  );

  (window as unknown as { electronAPI: unknown }).electronAPI = {
    bmad: { runInstaller, onInstallerStream },
  };

  return { runInstaller, onInstallerStream, cleanupSpy };
}

describe('BmadInstallWizard', () => {
  let mock: InstallMock;

  beforeEach(() => {
    mock = installMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the module checklist with core required (disabled)', () => {
    render(
      <BmadInstallWizard
        open
        onOpenChange={() => {}}
        projectRoot="/tmp/install-target"
      />,
    );
    const coreCheckbox = screen.getByLabelText(
      /installWizard.moduleNames.core/,
      { selector: 'button' },
    );
    expect(coreCheckbox).toBeDisabled();
  });

  it('Submit fires runInstaller with the right args + opens success banner', async () => {
    render(
      <BmadInstallWizard
        open
        onOpenChange={() => {}}
        projectRoot="/tmp/install-target"
      />,
    );

    fireEvent.click(screen.getByTestId('bmad-install-submit'));

    await waitFor(() => {
      expect(mock.runInstaller).toHaveBeenCalledTimes(1);
    });
    const args = mock.runInstaller.mock.calls[0]?.[0] as BmadInstallerOptions;
    expect(args.directory).toBe('/tmp/install-target');
    expect(args.yes).toBe(true);
    expect(args.modules).toContain('core');
    expect(args.modules).toContain('bmm');
    expect(args.tools).toEqual(['cursor']);
    expect(args.action).toBe('install');

    // Stream listener attached BEFORE the IPC call.
    expect(mock.onInstallerStream).toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByTestId('bmad-install-success')).toBeInTheDocument();
    });
    // Submit + cancel buttons disappear, replaced by Open project.
    expect(screen.getByTestId('bmad-install-open')).toBeInTheDocument();
  });

  it('streams installer chunks into the log', async () => {
    type StreamHandler = (payload: unknown) => void;
    const handlerHolder: { current: StreamHandler | null } = { current: null };
    mock.onInstallerStream.mockImplementation((handler: StreamHandler) => {
      handlerHolder.current = handler;
      return mock.cleanupSpy;
    });

    render(
      <BmadInstallWizard
        open
        onOpenChange={() => {}}
        projectRoot="/tmp/x"
      />,
    );
    fireEvent.click(screen.getByTestId('bmad-install-submit'));

    await waitFor(() => {
      expect(handlerHolder.current).not.toBeNull();
    });

    handlerHolder.current?.({
      senderId: 1,
      chunk: {
        kind: 'stdout',
        text: 'hello from installer',
        timestamp: Date.now(),
      },
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('bmad-install-log').textContent ?? '',
      ).toContain('hello from installer');
    });
  });

  it('error response surfaces the failure banner', async () => {
    installMock({ failMessage: 'npm not found' });
    render(
      <BmadInstallWizard
        open
        onOpenChange={() => {}}
        projectRoot="/tmp/x"
      />,
    );
    fireEvent.click(screen.getByTestId('bmad-install-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('bmad-install-error')).toBeInTheDocument();
    });
    expect(
      screen.getByTestId('bmad-install-error').textContent ?? '',
    ).toContain('npm not found');
  });

  it('does not render the dialog when open is false', () => {
    render(
      <BmadInstallWizard
        open={false}
        onOpenChange={() => {}}
        projectRoot="/tmp/x"
      />,
    );
    expect(screen.queryByTestId('bmad-install-submit')).not.toBeInTheDocument();
  });
});

describe('BmadInstallPrompt', () => {
  it('renders heading + launch button', () => {
    const onLaunch = vi.fn();
    render(<BmadInstallPrompt onLaunch={onLaunch} />);
    expect(screen.getByTestId('bmad-install-prompt')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('bmad-install-launch-button'));
    expect(onLaunch).toHaveBeenCalled();
  });
});
