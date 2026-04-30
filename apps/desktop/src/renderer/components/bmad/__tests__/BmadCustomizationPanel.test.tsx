/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import { BmadCustomizationPanel } from '../BmadCustomizationPanel';
import type {
  BmadIpcResult,
  BmadSkillManifestEntry,
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

const PROJECT_ROOT = '/tmp/bmad-customization-test';

const SKILLS: readonly BmadSkillManifestEntry[] = [
  {
    canonicalId: 'bmad-help',
    name: 'bmad-help',
    description: 'Guide',
    module: 'core',
    path: '_bmad/core/bmad-help/SKILL.md',
  },
  {
    canonicalId: 'bmad-agent-pm',
    name: 'John',
    description: 'Product manager',
    module: 'bmm',
    path: '_bmad/bmm/2-plan-workflows/bmad-agent-pm/SKILL.md',
  },
  {
    canonicalId: 'bmad-create-prd',
    name: 'Create PRD',
    description: 'Create a PRD',
    module: 'bmm',
    path: '_bmad/bmm/2-plan-workflows/bmad-create-prd/SKILL.md',
  },
];

function ok<T>(data: T): BmadIpcResult<T> {
  return { success: true, data };
}

function installMock() {
  const listSkills = vi.fn().mockResolvedValue(ok(SKILLS));
  const readCustomization = vi.fn().mockResolvedValue(
    ok({
      agent: { icon: '📋', role: 'Default PM' },
    }),
  );
  const writeCustomization = vi.fn().mockResolvedValue(
    ok({
      filePath: `${PROJECT_ROOT}/_bmad/custom/bmad-agent-pm.toml`,
    }),
  );

  (window as unknown as { electronAPI: unknown }).electronAPI = {
    bmad: {
      listSkills,
      readCustomization,
      writeCustomization,
    },
  };

  return { listSkills, readCustomization, writeCustomization };
}

describe('BmadCustomizationPanel', () => {
  let mock: ReturnType<typeof installMock>;

  beforeEach(() => {
    mock = installMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads customizable skills and skips bmad-help', async () => {
    render(<BmadCustomizationPanel projectRoot={PROJECT_ROOT} />);

    await screen.findByTestId('bmad-customization-panel');

    expect(mock.listSkills).toHaveBeenCalledWith(PROJECT_ROOT);
    expect(screen.queryByText('bmad-help')).not.toBeInTheDocument();
    expect(screen.getByText('bmad-agent-pm')).toBeInTheDocument();
    expect(screen.getByText('bmad-create-prd')).toBeInTheDocument();
  });

  it('writes a sparse personal icon override for the selected skill', async () => {
    render(<BmadCustomizationPanel projectRoot={PROJECT_ROOT} />);
    await screen.findByTestId('bmad-customization-panel');

    fireEvent.change(screen.getByLabelText('customization.valueLabel'), {
      target: { value: '🏥' },
    });
    fireEvent.click(screen.getByRole('button', { name: /customization.save/ }));

    await waitFor(() => {
      expect(mock.writeCustomization).toHaveBeenCalledTimes(1);
    });
    expect(mock.writeCustomization).toHaveBeenCalledWith(
      PROJECT_ROOT,
      'bmad-agent-pm',
      'team',
      { agent: { icon: '🏥' } },
    );
    expect(screen.getByText(/customization.saved/)).toBeInTheDocument();
  });

  it('writes central config roster overrides through skillId config', async () => {
    render(<BmadCustomizationPanel projectRoot={PROJECT_ROOT} />);
    await screen.findByTestId('bmad-customization-panel');

    fireEvent.click(screen.getByText('customization.centralConfig'));
    fireEvent.click(screen.getByRole('button', { name: /customization.save/ }));

    await waitFor(() => {
      expect(mock.writeCustomization).toHaveBeenCalledTimes(1);
    });
    expect(mock.writeCustomization).toHaveBeenCalledWith(
      PROJECT_ROOT,
      'config',
      'team',
      {
        agents: {
          'bmad-agent-pm': {
            description:
              'John the regulated-product PM — crisp, audit-aware, and focused on traceability.',
          },
        },
      },
    );
  });
});
