/**
 * BMad Kanban — pure helpers for translating sprint-status.yaml into the
 * renderer's epic/story view tree.
 *
 * Per ENGINE_SWAP_PROMPT.md KAD-2 the filesystem is the contract. The
 * `development_status` map in sprint-status.yaml is the source of truth;
 * these helpers shape it for display without mutating the on-disk source.
 *
 * Three kinds of keys live in `development_status` per the canonical
 * template at `~/Projects/BMAD-Install-Files/.agents/skills/bmad-sprint-planning/sprint-status-template.yaml`:
 *   - `epic-N`                — epic-level status (`backlog`/`in-progress`/`done`)
 *   - `epic-N-retrospective`  — optional retro lane (`optional`/`done`)
 *   - `N-M-slug-text`         — story rows (5 statuses)
 *
 * Per BMAD docs § "Default Agents", story execution is owned by Amelia
 * (the dev persona). Retro execution is also Amelia. Story-card persona
 * defaults to Amelia; the orchestrator may surface a different recommended
 * persona when the user clicks Run.
 */

import {
  BMAD_KANBAN_COLUMNS,
  type BmadDevelopmentStatus,
  type BmadEpicView,
  type BmadKanbanColumnId,
  type BmadPersonaSlug,
  type BmadSprintStatus,
  type BmadStoryView,
} from './bmad';

// =============================================================================
// Key parser
// =============================================================================

export type ParsedKey =
  | {
      readonly kind: 'epic';
      readonly epicId: string;
      readonly epicNumber: number;
    }
  | {
      readonly kind: 'retro';
      readonly epicId: string;
      readonly epicNumber: number;
    }
  | {
      readonly kind: 'story';
      readonly epicId: string;
      readonly epicNumber: number;
      readonly storyNumber: number;
      readonly slug: string;
    }
  | {
      readonly kind: 'unknown';
      readonly raw: string;
    };

/**
 * Parse a sprint-status `development_status` key into its kind + ordinal
 * components. Tolerant: anything we can't make sense of comes back as
 * `kind: 'unknown'` so callers don't lose data on novel keys.
 *
 * Examples:
 *   `epic-1`                       → { kind: 'epic', epicId: 'epic-1', epicNumber: 1 }
 *   `epic-2-retrospective`         → { kind: 'retro', epicId: 'epic-2', epicNumber: 2 }
 *   `1-3-plant-data-model`         → { kind: 'story', epicNumber: 1, storyNumber: 3, slug: 'plant-data-model' }
 *   `weird-thing`                  → { kind: 'unknown', raw: 'weird-thing' }
 */
export function parseSprintStatusKey(key: string): ParsedKey {
  if (!key) return { kind: 'unknown', raw: key };

  const retroMatch = /^epic-(\d+)-retrospective$/.exec(key);
  if (retroMatch) {
    const epicNumber = Number(retroMatch[1]);
    return {
      kind: 'retro',
      epicId: `epic-${epicNumber}`,
      epicNumber,
    };
  }

  const epicMatch = /^epic-(\d+)$/.exec(key);
  if (epicMatch) {
    const epicNumber = Number(epicMatch[1]);
    return {
      kind: 'epic',
      epicId: `epic-${epicNumber}`,
      epicNumber,
    };
  }

  // Story keys are `{epic}-{story}-{slug}`. The slug may itself contain dashes.
  const storyMatch = /^(\d+)-(\d+)-(.+)$/.exec(key);
  if (storyMatch) {
    const epicNumber = Number(storyMatch[1]);
    const storyNumber = Number(storyMatch[2]);
    const slug = storyMatch[3] ?? '';
    if (
      Number.isFinite(epicNumber) &&
      Number.isFinite(storyNumber) &&
      slug.length > 0
    ) {
      return {
        kind: 'story',
        epicId: `epic-${epicNumber}`,
        epicNumber,
        storyNumber,
        slug,
      };
    }
  }

  return { kind: 'unknown', raw: key };
}

// =============================================================================
// Status ↔ column mapping
// =============================================================================

/**
 * Map a story status to its Kanban column. Retro statuses (`optional`/`done`)
 * never map to a main column — the optional lane handles them separately.
 */
export function statusToColumn(
  status: BmadDevelopmentStatus,
): BmadKanbanColumnId | null {
  if (BMAD_KANBAN_COLUMNS.includes(status as BmadKanbanColumnId)) {
    return status as BmadKanbanColumnId;
  }
  return null;
}

/**
 * Inverse: a column id is itself a valid `BmadDevelopmentStatus`.
 */
export function columnToStatus(column: BmadKanbanColumnId): BmadDevelopmentStatus {
  return column;
}

// =============================================================================
// Persona inference
// =============================================================================

/**
 * Per BMAD docs § "Default Agents" + `INVENTORY.md §4` — every story row
 * is owned by Amelia (the dev persona). Retro rows are also owned by
 * Amelia (per `bmad-retrospective` ownership in `bmad-help.csv`).
 *
 * Epic-level rows have no individual persona (they summarize children).
 */
export function personaForKind(
  kind: ParsedKey['kind'],
): BmadPersonaSlug | null {
  switch (kind) {
    case 'story':
    case 'retro':
      return 'amelia';
    case 'epic':
    case 'unknown':
      return null;
  }
}

// =============================================================================
// Story file path resolution
// =============================================================================

/**
 * BMAD's `bmad-create-story` skill writes story files to
 * `_bmad-output/implementation-artifacts/{N}-{M}-{slug}.md`. The renderer
 * needs this path to load the story body when the user opens a card.
 *
 * Returns `null` for non-story kinds; the path is *speculative* — the file
 * may not exist yet (a story in `backlog` typically only exists in the
 * epic file, per the sprint-status template's `Story Status: backlog —
 * Story only exists in epic file`).
 */
export function speculativeStoryPath(parsed: ParsedKey): string | null {
  if (parsed.kind !== 'story') return null;
  return `_bmad-output/implementation-artifacts/${parsed.epicNumber}-${parsed.storyNumber}-${parsed.slug}.md`;
}

// =============================================================================
// Title prettification
// =============================================================================

/**
 * Convert a kebab/snake slug into a Title Case string for display.
 * Used as the fallback title when no story file exists yet.
 *
 *   `account-management` → `Account Management`
 *   `1-3-plant-data-model` (full key) → handled by parsing the slug first.
 */
export function titleFromSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// =============================================================================
// Aggregator: sprint-status → epic[]
// =============================================================================

/**
 * Group `development_status` entries into an array of `BmadEpicView`s
 * sorted by epic number. Stories within an epic are sorted by story
 * number. Unknown keys are dropped (forward-compat — novel modules might
 * introduce new key shapes).
 *
 * The `titleOverrides` map lets callers inject titles parsed from story
 * files (or epic files) without coupling this pure helper to the IPC
 * layer. Keys are sprint-status keys, values are display titles.
 */
export interface GroupSprintStatusOptions {
  readonly titleOverrides?: ReadonlyMap<string, string>;
}

export function groupSprintStatusIntoEpics(
  status: BmadSprintStatus | null,
  options: GroupSprintStatusOptions = {},
): readonly BmadEpicView[] {
  if (!status) return [];

  const titleOverrides = options.titleOverrides ?? new Map<string, string>();
  const epics = new Map<
    number,
    {
      id: string;
      epicNumber: number;
      title: string;
      status: BmadDevelopmentStatus;
      stories: BmadStoryView[];
      retro: BmadStoryView | null;
    }
  >();

  for (const [key, statusValue] of Object.entries(status.developmentStatus)) {
    const parsed = parseSprintStatusKey(key);
    if (parsed.kind === 'unknown') continue;

    if (parsed.kind === 'epic') {
      const existing = epics.get(parsed.epicNumber);
      const epicTitle = titleOverrides.get(key) ?? titleFromEpicId(parsed.epicId);
      if (existing) {
        existing.title = epicTitle;
        existing.status = statusValue;
      } else {
        epics.set(parsed.epicNumber, {
          id: parsed.epicId,
          epicNumber: parsed.epicNumber,
          title: epicTitle,
          status: statusValue,
          stories: [],
          retro: null,
        });
      }
      continue;
    }

    const epicEntry = ensureEpic(epics, parsed.epicNumber, parsed.epicId, titleOverrides);

    if (parsed.kind === 'story') {
      const storyTitle =
        titleOverrides.get(key) ?? titleFromSlug(parsed.slug);
      epicEntry.stories.push({
        key,
        kind: 'story',
        epicId: parsed.epicId,
        epicNumber: parsed.epicNumber,
        storyNumber: parsed.storyNumber,
        slug: parsed.slug,
        title: storyTitle,
        status: statusValue,
        persona: personaForKind('story'),
        storyFilePath: speculativeStoryPath(parsed),
        orderInEpic: parsed.storyNumber,
      });
    } else if (parsed.kind === 'retro') {
      const retroTitle =
        titleOverrides.get(key) ?? `${titleFromEpicId(parsed.epicId)} — Retrospective`;
      epicEntry.retro = {
        key,
        kind: 'retro',
        epicId: parsed.epicId,
        epicNumber: parsed.epicNumber,
        storyNumber: null,
        slug: null,
        title: retroTitle,
        status: statusValue,
        persona: personaForKind('retro'),
        storyFilePath: null,
        // Sort retro after all stories in the epic.
        orderInEpic: Number.MAX_SAFE_INTEGER,
      };
    }
  }

  // Sort epics + their stories deterministically.
  const sorted = Array.from(epics.values()).sort(
    (a, b) => a.epicNumber - b.epicNumber,
  );
  return sorted.map((epic) => ({
    id: epic.id,
    epicNumber: epic.epicNumber,
    title: epic.title,
    status: epic.status,
    stories: epic.stories
      .slice()
      .sort((a, b) => (a.orderInEpic ?? 0) - (b.orderInEpic ?? 0)),
    retro: epic.retro,
  }));
}

function ensureEpic(
  epics: Map<
    number,
    {
      id: string;
      epicNumber: number;
      title: string;
      status: BmadDevelopmentStatus;
      stories: BmadStoryView[];
      retro: BmadStoryView | null;
    }
  >,
  epicNumber: number,
  epicId: string,
  titleOverrides: ReadonlyMap<string, string>,
): {
  id: string;
  epicNumber: number;
  title: string;
  status: BmadDevelopmentStatus;
  stories: BmadStoryView[];
  retro: BmadStoryView | null;
} {
  const existing = epics.get(epicNumber);
  if (existing) return existing;
  const created = {
    id: epicId,
    epicNumber,
    title: titleOverrides.get(epicId) ?? titleFromEpicId(epicId),
    // Default epic status when only stories are present and the epic row
    // hasn't appeared yet — `backlog` matches the template default.
    status: 'backlog' as BmadDevelopmentStatus,
    stories: [],
    retro: null,
  };
  epics.set(epicNumber, created);
  return created;
}

function titleFromEpicId(epicId: string): string {
  const match = /^epic-(\d+)$/.exec(epicId);
  if (match) return `Epic ${match[1]}`;
  return titleFromSlug(epicId);
}

// =============================================================================
// Story-file markdown parser (renderer-side, pure)
// =============================================================================

/**
 * Detect a single AC checkbox line:
 *   - `- [ ] something`    → not done
 *   - `- [x] something`    → done
 *
 * Tolerates leading whitespace, capital `X`, or a numbered `1.` prefix
 * before the dash (`1. - [ ] foo`) which some BMAD step files emit.
 */
const AC_LINE_REGEX = /^(\s*(?:-|\*|\d+\.)\s*)?\[\s*([ xX])\s*\]\s*(.+?)\s*$/;

interface ParsedSection {
  readonly heading: string | null;
  readonly headingLevel: number;
  readonly lines: readonly string[];
  readonly startIndex: number;
  readonly endIndex: number;
}

/**
 * Split markdown into sections delimited by H2 headings. The H1 (if any)
 * goes into a synthetic `null`-heading prelude section for the title.
 */
export function splitMarkdownSections(markdown: string): readonly ParsedSection[] {
  const lines = markdown.split('\n');
  const sections: ParsedSection[] = [];
  let current: {
    heading: string | null;
    headingLevel: number;
    lines: string[];
    startIndex: number;
  } | null = null;
  let preludeStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const match = /^(#{1,6})\s+(.*)$/.exec(line);

    // We split on H2; deeper headings live inside their parent H2 section.
    if (match && match[1].length === 2) {
      if (current) {
        sections.push({
          heading: current.heading,
          headingLevel: current.headingLevel,
          lines: current.lines,
          startIndex: current.startIndex,
          endIndex: i - 1,
        });
      } else if (i > preludeStart) {
        // Capture pre-H2 prelude (H1 + intro) under a null heading.
        sections.push({
          heading: null,
          headingLevel: 0,
          lines: lines.slice(preludeStart, i),
          startIndex: preludeStart,
          endIndex: i - 1,
        });
      }
      current = {
        heading: match[2].trim(),
        headingLevel: 2,
        lines: [],
        startIndex: i,
      };
    } else if (current) {
      current.lines.push(line);
    }
  }

  if (current) {
    sections.push({
      heading: current.heading,
      headingLevel: current.headingLevel,
      lines: current.lines,
      startIndex: current.startIndex,
      endIndex: lines.length - 1,
    });
  } else if (preludeStart < lines.length) {
    sections.push({
      heading: null,
      headingLevel: 0,
      lines: lines.slice(preludeStart),
      startIndex: preludeStart,
      endIndex: lines.length - 1,
    });
  }

  return sections;
}

/**
 * Find a section by case-insensitive H2 heading match. Returns null if no
 * match — story files with non-standard headings are tolerated.
 */
function findSection(
  sections: readonly ParsedSection[],
  heading: string,
): ParsedSection | null {
  const target = heading.toLowerCase();
  return (
    sections.find(
      (s) => s.heading !== null && s.heading.toLowerCase() === target,
    ) ?? null
  );
}

/**
 * Match a markdown H1 line and capture the title text.
 */
function findFirstH1Title(markdown: string): string | null {
  const match = /^#\s+(.+?)\s*$/m.exec(markdown);
  return match ? match[1] : null;
}

/**
 * Parse a story file's markdown into structured sections. Pure function;
 * never touches the filesystem. Designed to round-trip with `toggleAcceptanceCriterion`.
 */
export interface ParseStoryFileOptions {
  /** Fallback title when the markdown lacks an H1 (e.g. brand-new file). */
  readonly fallbackTitle?: string;
}

export function parseStoryFile(
  raw: string,
  options: ParseStoryFileOptions = {},
): {
  readonly title: string;
  readonly statusText: string | null;
  readonly storyText: string;
  readonly acceptanceCriteria: ReadonlyArray<{
    readonly index: number;
    readonly text: string;
    readonly done: boolean;
    /** Source line number (0-based) — used by the writer to flip the box. */
    readonly lineIndex: number;
  }>;
  readonly bodyMarkdown: string;
  readonly raw: string;
} {
  const sections = splitMarkdownSections(raw);
  const title =
    findFirstH1Title(raw) ?? options.fallbackTitle ?? 'Story';

  const statusSection = findSection(sections, 'Status');
  const statusText = statusSection
    ? statusSection.lines.map((l) => l.trim()).filter(Boolean).join(' ').trim() || null
    : null;

  const storySection = findSection(sections, 'Story');
  const storyText = storySection
    ? storySection.lines.join('\n').trim()
    : '';

  const acSection = findSection(sections, 'Acceptance Criteria');
  const acceptanceCriteria: Array<{
    index: number;
    text: string;
    done: boolean;
    lineIndex: number;
  }> = [];
  if (acSection) {
    let acIndex = 0;
    for (let i = 0; i < acSection.lines.length; i++) {
      const line = acSection.lines[i] ?? '';
      const match = AC_LINE_REGEX.exec(line);
      if (match) {
        acIndex += 1;
        acceptanceCriteria.push({
          index: acIndex,
          text: (match[3] ?? '').trim(),
          done: (match[2] ?? '').toLowerCase() === 'x',
          // line index in the original raw file
          lineIndex: acSection.startIndex + 1 + i,
        });
      }
    }
  }

  // Body = everything except the title, Status, Story, Acceptance Criteria.
  // The Detail panel uses this for the "rest of the story" markdown render.
  const skipHeadings = new Set(
    ['status', 'story', 'acceptance criteria'].map((s) => s.toLowerCase()),
  );
  const bodyParts = sections
    .filter(
      (s) =>
        s.heading !== null && !skipHeadings.has(s.heading.toLowerCase()),
    )
    .map(
      (s) => `${'##'} ${s.heading}\n${s.lines.join('\n')}`.trimEnd(),
    );

  return {
    title,
    statusText,
    storyText,
    acceptanceCriteria,
    bodyMarkdown: bodyParts.join('\n\n').trim(),
    raw,
  };
}

/**
 * Toggle a single acceptance-criteria checkbox in the raw markdown by its
 * 1-based index. Returns the updated markdown — original unchanged.
 *
 * Throws when the index is out of range so callers can surface a
 * structured error instead of silently corrupting the file.
 */
export function toggleAcceptanceCriterion(
  raw: string,
  acIndex: number,
  done: boolean,
): string {
  const parsed = parseStoryFile(raw);
  const target = parsed.acceptanceCriteria.find((ac) => ac.index === acIndex);
  if (!target) {
    throw new Error(`acceptance-criterion ${acIndex} out of range`);
  }
  const lines = raw.split('\n');
  const original = lines[target.lineIndex] ?? '';
  const replaced = original.replace(
    /\[\s*[xX ]\s*\]/,
    done ? '[x]' : '[ ]',
  );
  lines[target.lineIndex] = replaced;
  return lines.join('\n');
}
