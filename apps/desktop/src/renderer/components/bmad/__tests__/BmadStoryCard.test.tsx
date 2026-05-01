/**
 * @vitest-environment jsdom
 */

/**
 * Component tests for `BmadStoryCard` (Phase 3 deliverable §2).
 *
 * Verifies the card renders the right chrome and fires the expected
 * callbacks. Wraps in `DndContext` because `useSortable` requires one.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { DndContext } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';

import { BmadStoryCard } from '../BmadStoryCard';
import type {
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

const STORY: BmadStoryView = {
  key: '1-2-account-management',
  kind: 'story',
  epicId: 'epic-1',
  epicNumber: 1,
  storyNumber: 2,
  slug: 'account-management',
  title: 'Account Management',
  status: 'ready-for-dev',
  persona: 'amelia',
  storyFilePath: '_bmad-output/implementation-artifacts/1-2-account-management.md',
  orderInEpic: 2,
};

const PERSONA: BmadPersonaIdentity = {
  slug: 'amelia',
  skillId: 'bmad-agent-dev',
  name: 'Amelia',
  title: 'Senior Software Engineer',
  module: 'bmm',
  team: 'core',
  description: '',
  icon: '💻',
  role: 'Implementation lead',
  identity: '',
  communicationStyle: '',
  principles: [],
  persistentFacts: [],
  activationStepsPrepend: [],
  activationStepsAppend: [],
  menu: [],
  phase: '4-implementation',
};

function renderCard(overrides: Partial<React.ComponentProps<typeof BmadStoryCard>> = {}) {
  return render(
    <DndContext>
      <SortableContext items={[STORY.key]}>
        <BmadStoryCard
          story={STORY}
          status="ready-for-dev"
          persona={PERSONA}
          {...overrides}
        />
      </SortableContext>
    </DndContext>,
  );
}

describe('BmadStoryCard', () => {
  it('renders epic.story handle, title, and persona icon', () => {
    renderCard();
    expect(screen.getByText('Account Management')).toBeInTheDocument();
    expect(screen.getByText('1.2')).toBeInTheDocument();
    expect(screen.getByText('💻')).toBeInTheDocument();
  });

  it('fires onSelect when the card body is clicked', () => {
    const onSelect = vi.fn();
    renderCard({ onSelect });
    const card = screen.getByTestId('bmad-story-card');
    fireEvent.click(card);
    expect(onSelect).toHaveBeenCalledWith(STORY.key);
  });

  it('fires onRun (and not onSelect) when the Run button is clicked', () => {
    const onSelect = vi.fn();
    const onRun = vi.fn();
    renderCard({ onSelect, onRun });
    fireEvent.click(screen.getByTestId('bmad-story-run-button'));
    expect(onRun).toHaveBeenCalledWith(STORY.key);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders the skeleton variant when `skeleton` is true', () => {
    render(
      <DndContext>
        <SortableContext items={[STORY.key]}>
          <BmadStoryCard
            story={STORY}
            status="backlog"
            persona={null}
            skeleton
          />
        </SortableContext>
      </DndContext>,
    );
    expect(
      screen.getByTestId('bmad-story-card-skeleton'),
    ).toBeInTheDocument();
  });

  it('renders the retro badge when kind is retro', () => {
    const retroStory: BmadStoryView = {
      ...STORY,
      key: 'epic-1-retrospective',
      kind: 'retro',
      storyNumber: null,
      slug: null,
      title: 'Epic 1 Retrospective',
      status: 'optional',
    };
    render(
      <DndContext>
        <SortableContext items={[retroStory.key]}>
          <BmadStoryCard
            story={retroStory}
            status="optional"
            persona={PERSONA}
          />
        </SortableContext>
      </DndContext>,
    );
    expect(screen.getByText('kanban.retrospectiveBadge')).toBeInTheDocument();
  });

  it('opens the detail panel via Enter key for keyboard users', () => {
    const onSelect = vi.fn();
    renderCard({ onSelect });
    const card = screen.getByTestId('bmad-story-card');
    card.focus();
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(STORY.key);
  });

  it('disables the Run button when isRunning is true', () => {
    const onRun = vi.fn();
    renderCard({ onRun, isRunning: true });
    const button = screen.getByTestId('bmad-story-run-button');
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onRun).not.toHaveBeenCalled();
  });
});
