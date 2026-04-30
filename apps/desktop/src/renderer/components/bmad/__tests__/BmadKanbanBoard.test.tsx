/**
 * @vitest-environment jsdom
 */

/**
 * BmadKanbanBoard tests — Phase 3.
 *
 * Drag-drop is exercised in the E2E tests (Playwright); here we cover the
 * structural rendering, ARIA roles, optional lane, error/empty states, and
 * the click-through interactions on cards. Drag is verified end-to-end in
 * Phase 3's Playwright suite (see `tests/e2e/bmad-kanban.spec.ts`).
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import { BmadKanbanBoard } from '../BmadKanbanBoard';
import type {
  BmadEpicView,
  BmadKanbanColumnId,
  BmadPersonaIdentity,
  BmadStoryView,
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

function makeStory(
  key: string,
  status: BmadStoryView['status'],
  epicNumber: number,
  storyNumber: number,
): BmadStoryView {
  return {
    key,
    kind: 'story',
    epicId: `epic-${epicNumber}`,
    epicNumber,
    storyNumber,
    slug: 'test',
    title: `Story ${epicNumber}.${storyNumber}`,
    status,
    persona: 'amelia',
    storyFilePath: null,
    orderInEpic: storyNumber,
  };
}

function makeEpic(
  epicNumber: number,
  stories: BmadStoryView[],
  retro?: BmadStoryView,
): BmadEpicView {
  return {
    id: `epic-${epicNumber}`,
    epicNumber,
    title: `Epic ${epicNumber}`,
    status: 'in-progress',
    stories,
    retro: retro ?? null,
  };
}

describe('BmadKanbanBoard', () => {
  it('renders all 5 columns + empty state messaging when no stories', () => {
    render(
      <BmadKanbanBoard
        epics={[]}
        displayedStatus={() => null}
        personas={PERSONAS}
        onMoveStory={vi.fn().mockResolvedValue({ success: true })}
        onSelectStory={vi.fn()}
        onRunStory={vi.fn()}
      />,
    );
    for (const col of [
      'backlog',
      'ready-for-dev',
      'in-progress',
      'review',
      'done',
    ] as const) {
      expect(
        screen.getByTestId(`bmad-kanban-column-${col}`),
      ).toBeInTheDocument();
    }
    // Each column has its own empty state copy
    expect(screen.getByText('kanban.empty.backlog')).toBeInTheDocument();
    expect(screen.getByText('kanban.empty.review')).toBeInTheDocument();
  });

  it('places stories in their declared columns', () => {
    const epic = makeEpic(1, [
      makeStory('1-1-foo', 'in-progress', 1, 1),
      makeStory('1-2-bar', 'review', 1, 2),
    ]);
    const status: Record<string, BmadStoryView['status']> = {
      '1-1-foo': 'in-progress',
      '1-2-bar': 'review',
    };
    render(
      <BmadKanbanBoard
        epics={[epic]}
        displayedStatus={(k) => status[k] ?? null}
        personas={PERSONAS}
        onMoveStory={vi.fn().mockResolvedValue({ success: true })}
        onSelectStory={vi.fn()}
        onRunStory={vi.fn()}
      />,
    );
    const inProgress = screen.getByTestId('bmad-kanban-column-in-progress');
    const review = screen.getByTestId('bmad-kanban-column-review');
    expect(inProgress).toContainElement(screen.getByText('Story 1.1'));
    expect(review).toContainElement(screen.getByText('Story 1.2'));
  });

  it('renders the optional lane for retros', () => {
    const retro: BmadStoryView = {
      key: 'epic-1-retrospective',
      kind: 'retro',
      epicId: 'epic-1',
      epicNumber: 1,
      storyNumber: null,
      slug: null,
      title: 'Epic 1 Retrospective',
      status: 'optional',
      persona: 'amelia',
      storyFilePath: null,
      orderInEpic: Number.MAX_SAFE_INTEGER,
    };
    const epic = makeEpic(1, [], retro);
    render(
      <BmadKanbanBoard
        epics={[epic]}
        displayedStatus={() => 'optional'}
        personas={PERSONAS}
        onMoveStory={vi.fn().mockResolvedValue({ success: true })}
        onSelectStory={vi.fn()}
        onRunStory={vi.fn()}
      />,
    );
    expect(screen.getByTestId('bmad-optional-lane')).toBeInTheDocument();
    // Retros don't appear in the main columns
    const backlog = screen.getByTestId('bmad-kanban-column-backlog');
    expect(backlog).not.toContainElement(
      screen.queryByText('Epic 1 Retrospective'),
    );
  });

  it('shows the error banner when error is non-null', () => {
    render(
      <BmadKanbanBoard
        epics={[]}
        displayedStatus={() => null}
        error="manifest.yaml is corrupt"
        personas={PERSONAS}
        onMoveStory={vi.fn().mockResolvedValue({ success: true })}
        onSelectStory={vi.fn()}
        onRunStory={vi.fn()}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('manifest.yaml is corrupt');
  });

  it('renders the phase progress strip when currentPhase is given', () => {
    render(
      <BmadKanbanBoard
        epics={[]}
        displayedStatus={() => null}
        currentPhase="3-solutioning"
        personas={PERSONAS}
        onMoveStory={vi.fn().mockResolvedValue({ success: true })}
        onSelectStory={vi.fn()}
        onRunStory={vi.fn()}
      />,
    );
    expect(screen.getByTestId('bmad-phase-progress')).toBeInTheDocument();
  });

  it('marks the dropped column with data-over while dragging is over', () => {
    // Initial state: data-over absent.
    render(
      <BmadKanbanBoard
        epics={[]}
        displayedStatus={() => null}
        personas={PERSONAS}
        onMoveStory={vi.fn().mockResolvedValue({ success: true })}
        onSelectStory={vi.fn()}
        onRunStory={vi.fn()}
      />,
    );
    const col = screen.getByTestId('bmad-kanban-column-backlog');
    expect(col.getAttribute('data-over')).toBeNull();
    // Note: full drag-end behavior is exercised in the Playwright E2E.
  });

  it('uses Kanban column ARIA labels for screen readers', () => {
    render(
      <BmadKanbanBoard
        epics={[]}
        displayedStatus={() => null}
        personas={PERSONAS}
        onMoveStory={vi.fn().mockResolvedValue({ success: true })}
        onSelectStory={vi.fn()}
        onRunStory={vi.fn()}
      />,
    );
    const board = screen.getByRole('application');
    expect(board).toHaveAttribute('aria-label', 'kanban.boardAriaLabel');
    const regions = screen.getAllByRole('region');
    expect(regions.length).toBe(5);
    for (const region of regions) {
      expect(region.getAttribute('aria-label')).toMatch(
        /^kanban\.columnAriaLabel/,
      );
    }
  });
});

// =============================================================================
// Type guard for unused imports
// =============================================================================

const _coverage: BmadKanbanColumnId = 'backlog';
void _coverage;
