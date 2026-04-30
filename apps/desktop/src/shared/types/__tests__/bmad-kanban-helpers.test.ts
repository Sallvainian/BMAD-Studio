/**
 * Vitest fixtures for `bmad-kanban-helpers.ts`.
 *
 * Covers every Phase 3 deliverable's pure-function dependency:
 *   - parseSprintStatusKey (epic / retro / story / unknown)
 *   - statusToColumn / columnToStatus
 *   - personaForKind
 *   - speculativeStoryPath
 *   - titleFromSlug
 *   - groupSprintStatusIntoEpics (the load-bearing aggregator)
 *   - splitMarkdownSections / parseStoryFile / toggleAcceptanceCriterion
 */

import { describe, expect, it } from 'vitest';

import {
  groupSprintStatusIntoEpics,
  parseSprintStatusKey,
  parseStoryFile,
  personaForKind,
  speculativeStoryPath,
  splitMarkdownSections,
  statusToColumn,
  titleFromSlug,
  toggleAcceptanceCriterion,
} from '../bmad-kanban-helpers';
import type { BmadSprintStatus } from '../bmad';

// =============================================================================
// parseSprintStatusKey
// =============================================================================

describe('parseSprintStatusKey', () => {
  it('parses epic rows', () => {
    expect(parseSprintStatusKey('epic-1')).toEqual({
      kind: 'epic',
      epicId: 'epic-1',
      epicNumber: 1,
    });
    expect(parseSprintStatusKey('epic-12')).toEqual({
      kind: 'epic',
      epicId: 'epic-12',
      epicNumber: 12,
    });
  });

  it('parses retrospective rows', () => {
    expect(parseSprintStatusKey('epic-2-retrospective')).toEqual({
      kind: 'retro',
      epicId: 'epic-2',
      epicNumber: 2,
    });
  });

  it('parses story rows including dashed slugs', () => {
    expect(parseSprintStatusKey('1-3-plant-data-model')).toEqual({
      kind: 'story',
      epicId: 'epic-1',
      epicNumber: 1,
      storyNumber: 3,
      slug: 'plant-data-model',
    });
    expect(parseSprintStatusKey('2-1-personality-system')).toEqual({
      kind: 'story',
      epicId: 'epic-2',
      epicNumber: 2,
      storyNumber: 1,
      slug: 'personality-system',
    });
  });

  it('returns unknown for unrecognized shapes', () => {
    expect(parseSprintStatusKey('hello-world')).toEqual({
      kind: 'unknown',
      raw: 'hello-world',
    });
    expect(parseSprintStatusKey('')).toEqual({
      kind: 'unknown',
      raw: '',
    });
    expect(parseSprintStatusKey('epic')).toEqual({
      kind: 'unknown',
      raw: 'epic',
    });
  });
});

// =============================================================================
// statusToColumn / personaForKind
// =============================================================================

describe('statusToColumn', () => {
  it('maps story statuses to themselves', () => {
    expect(statusToColumn('backlog')).toBe('backlog');
    expect(statusToColumn('ready-for-dev')).toBe('ready-for-dev');
    expect(statusToColumn('in-progress')).toBe('in-progress');
    expect(statusToColumn('review')).toBe('review');
    expect(statusToColumn('done')).toBe('done');
  });

  it('returns null for retro-only statuses', () => {
    expect(statusToColumn('optional')).toBeNull();
  });
});

describe('personaForKind', () => {
  it('returns Amelia for stories and retros (BMAD docs § "Default Agents")', () => {
    expect(personaForKind('story')).toBe('amelia');
    expect(personaForKind('retro')).toBe('amelia');
  });

  it('returns null for epics and unknown', () => {
    expect(personaForKind('epic')).toBeNull();
    expect(personaForKind('unknown')).toBeNull();
  });
});

// =============================================================================
// speculativeStoryPath / titleFromSlug
// =============================================================================

describe('speculativeStoryPath', () => {
  it('builds the canonical implementation-artifacts path for stories', () => {
    expect(
      speculativeStoryPath({
        kind: 'story',
        epicId: 'epic-1',
        epicNumber: 1,
        storyNumber: 3,
        slug: 'plant-data-model',
      }),
    ).toBe('_bmad-output/implementation-artifacts/1-3-plant-data-model.md');
  });

  it('returns null for non-story kinds', () => {
    expect(
      speculativeStoryPath({ kind: 'epic', epicId: 'epic-1', epicNumber: 1 }),
    ).toBeNull();
    expect(
      speculativeStoryPath({ kind: 'retro', epicId: 'epic-1', epicNumber: 1 }),
    ).toBeNull();
    expect(
      speculativeStoryPath({ kind: 'unknown', raw: 'asdf' }),
    ).toBeNull();
  });
});

describe('titleFromSlug', () => {
  it('Title-Cases dashed slugs', () => {
    expect(titleFromSlug('plant-data-model')).toBe('Plant Data Model');
    expect(titleFromSlug('account_management')).toBe('Account Management');
    expect(titleFromSlug('one')).toBe('One');
  });

  it('handles empty input gracefully', () => {
    expect(titleFromSlug('')).toBe('');
  });
});

// =============================================================================
// groupSprintStatusIntoEpics — the canonical aggregator
// =============================================================================

const SAMPLE_SPRINT: BmadSprintStatus = {
  generated: '04-30-2026 09:00',
  lastUpdated: '04-30-2026 09:30',
  project: 'Test Project',
  projectKey: 'TEST',
  trackingSystem: 'file-system',
  storyLocation: '_bmad-output/implementation-artifacts/',
  developmentStatus: {
    'epic-1': 'in-progress',
    '1-1-user-authentication': 'done',
    '1-2-account-management': 'ready-for-dev',
    '1-3-plant-data-model': 'backlog',
    'epic-1-retrospective': 'optional',
    'epic-2': 'backlog',
    '2-1-personality-system': 'backlog',
    '2-2-chat-interface': 'backlog',
    'epic-2-retrospective': 'optional',
    'unrecognized-thing': 'backlog',
  },
};

describe('groupSprintStatusIntoEpics', () => {
  it('groups stories under their epic with correct ordering', () => {
    const epics = groupSprintStatusIntoEpics(SAMPLE_SPRINT);
    expect(epics).toHaveLength(2);
    expect(epics[0]?.epicNumber).toBe(1);
    expect(epics[0]?.id).toBe('epic-1');
    expect(epics[0]?.status).toBe('in-progress');
    expect(epics[0]?.stories.map((s) => s.key)).toEqual([
      '1-1-user-authentication',
      '1-2-account-management',
      '1-3-plant-data-model',
    ]);
    expect(epics[0]?.retro?.key).toBe('epic-1-retrospective');
    expect(epics[0]?.retro?.status).toBe('optional');
  });

  it('drops keys it cannot parse', () => {
    const epics = groupSprintStatusIntoEpics(SAMPLE_SPRINT);
    const allKeys = epics.flatMap((e) => [
      e.id,
      ...e.stories.map((s) => s.key),
      e.retro?.key ?? '',
    ]);
    expect(allKeys.includes('unrecognized-thing')).toBe(false);
  });

  it('returns empty array for null sprint status', () => {
    expect(groupSprintStatusIntoEpics(null)).toEqual([]);
  });

  it('respects title overrides', () => {
    const overrides = new Map([
      ['1-1-user-authentication', 'Sign In with Magic Link'],
      ['epic-1', 'User Foundations'],
    ]);
    const epics = groupSprintStatusIntoEpics(SAMPLE_SPRINT, {
      titleOverrides: overrides,
    });
    expect(epics[0]?.title).toBe('User Foundations');
    expect(epics[0]?.stories[0]?.title).toBe('Sign In with Magic Link');
    // Untouched stories fall back to slug-derived title
    expect(epics[0]?.stories[1]?.title).toBe('Account Management');
  });

  it('synthesizes epic entries when only story keys are present', () => {
    const sprint: BmadSprintStatus = {
      ...SAMPLE_SPRINT,
      developmentStatus: {
        '5-1-something': 'backlog',
        '5-2-other': 'in-progress',
      },
    };
    const epics = groupSprintStatusIntoEpics(sprint);
    expect(epics).toHaveLength(1);
    expect(epics[0]?.id).toBe('epic-5');
    // Default status is backlog when no epic row exists
    expect(epics[0]?.status).toBe('backlog');
    expect(epics[0]?.stories).toHaveLength(2);
  });

  it('every story has Amelia as persona', () => {
    const epics = groupSprintStatusIntoEpics(SAMPLE_SPRINT);
    for (const epic of epics) {
      for (const story of epic.stories) {
        expect(story.persona).toBe('amelia');
      }
      if (epic.retro) {
        expect(epic.retro.persona).toBe('amelia');
      }
    }
  });
});

// =============================================================================
// splitMarkdownSections / parseStoryFile / toggleAcceptanceCriterion
// =============================================================================

const SAMPLE_STORY = `# 1.2 Account Management

## Status

ready-for-dev

## Story

As a user, I want to manage my account, so that I can update my email and password.

## Acceptance Criteria

- [ ] AC 1: User can update email
- [x] AC 2: User can change password
- [ ] AC 3: User can delete account

## Tasks / Subtasks

- [ ] Backend route
- [ ] Frontend form

## Dev Notes

The auth flow is documented in \`docs/auth.md\`.

## File List

- \`src/auth.ts\`
- \`src/account.tsx\`

## Change Log

| Date | Author | Description |
|------|--------|-------------|
| 04-30-2026 | Amelia | Initial story |
`;

describe('splitMarkdownSections', () => {
  it('captures every H2 heading in order (after the H1 prelude)', () => {
    const sections = splitMarkdownSections(SAMPLE_STORY);
    // The first section is the synthetic prelude (H1 + intro lines) with
    // `heading: null`. The H2 sections follow in order.
    const headings = sections
      .map((s) => s.heading)
      .filter((h): h is string => h !== null);
    expect(headings).toEqual([
      'Status',
      'Story',
      'Acceptance Criteria',
      'Tasks / Subtasks',
      'Dev Notes',
      'File List',
      'Change Log',
    ]);
    // The synthetic prelude exists so the H1 doesn't get lost.
    expect(sections[0]?.heading).toBeNull();
  });

  it('preserves line ranges so writers can patch specific lines', () => {
    const sections = splitMarkdownSections(SAMPLE_STORY);
    const acSection = sections.find((s) => s.heading === 'Acceptance Criteria');
    expect(acSection?.startIndex).toBeGreaterThan(0);
    expect(acSection?.endIndex).toBeGreaterThan(acSection?.startIndex ?? 0);
  });
});

describe('parseStoryFile', () => {
  it('extracts the H1 title, status, story narrative, and AC checkboxes', () => {
    const parsed = parseStoryFile(SAMPLE_STORY);
    expect(parsed.title).toBe('1.2 Account Management');
    expect(parsed.statusText).toBe('ready-for-dev');
    expect(parsed.storyText).toContain('As a user');
    expect(parsed.acceptanceCriteria).toHaveLength(3);
    expect(parsed.acceptanceCriteria[0]).toMatchObject({
      index: 1,
      text: 'AC 1: User can update email',
      done: false,
    });
    expect(parsed.acceptanceCriteria[1]).toMatchObject({
      index: 2,
      text: 'AC 2: User can change password',
      done: true,
    });
    expect(parsed.bodyMarkdown).toContain('Tasks / Subtasks');
    expect(parsed.bodyMarkdown).not.toContain('## Acceptance Criteria');
  });

  it('falls back to fallbackTitle when no H1 exists', () => {
    const parsed = parseStoryFile('## Status\n\nbacklog\n', {
      fallbackTitle: 'Untitled story',
    });
    expect(parsed.title).toBe('Untitled story');
    expect(parsed.acceptanceCriteria).toEqual([]);
  });

  it('captures no AC when the section is missing', () => {
    const parsed = parseStoryFile('# Title\n\n## Story\n\nA story.\n');
    expect(parsed.acceptanceCriteria).toEqual([]);
  });
});

describe('toggleAcceptanceCriterion', () => {
  it('flips a single criterion to done', () => {
    const next = toggleAcceptanceCriterion(SAMPLE_STORY, 1, true);
    const reparsed = parseStoryFile(next);
    expect(reparsed.acceptanceCriteria[0]?.done).toBe(true);
    // Other ACs untouched
    expect(reparsed.acceptanceCriteria[1]?.done).toBe(true);
    expect(reparsed.acceptanceCriteria[2]?.done).toBe(false);
  });

  it('flips a criterion back to not-done', () => {
    const next = toggleAcceptanceCriterion(SAMPLE_STORY, 2, false);
    const reparsed = parseStoryFile(next);
    expect(reparsed.acceptanceCriteria[1]?.done).toBe(false);
  });

  it('throws when the index is out of range', () => {
    expect(() => toggleAcceptanceCriterion(SAMPLE_STORY, 99, true)).toThrow(
      /out of range/,
    );
  });

  it('preserves all other lines including non-AC content', () => {
    const next = toggleAcceptanceCriterion(SAMPLE_STORY, 1, true);
    expect(next).toContain('## Tasks / Subtasks');
    expect(next).toContain('## Change Log');
    expect(next.includes('| 04-30-2026 | Amelia | Initial story |')).toBe(true);
  });
});
