/**
 * Vitest fixtures for the customization resolver.
 *
 * Coverage targets the four shape-driven merge rules from BMAD docs
 * § "Merge Rules (by shape, not by field name)":
 *
 *   Rule 1: scalar override wins
 *   Rule 2: table deep merge
 *   Rule 3: keyed array (every item shares `code` or `id`) merges by key
 *   Rule 4: any other array appends (base then override)
 *
 * Plus three-layer integration scenarios (defaults → team → user), the
 * `extractKey` dotted-path lookup, the keyed-field detection edge cases, and
 * the file-loading boundary (`loadToml` + `resolveCustomization`).
 *
 * Doc citations: every test that asserts a behavior contract cites the docs
 * section it grounds on, per ENGINE_SWAP_PROMPT.md `<docs_protocol>` Rule 2.
 */

import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CustomizationResolverError,
  __internals,
  deepMerge,
  extractKey,
  loadToml,
  resolveCustomization,
} from '../customization-resolver';

const { detectKeyedMergeField, mergeArrays, mergeByKey, isPlainObject } = __internals;

// =============================================================================
// Helpers
// =============================================================================

async function makeTempProject(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'bmad-resolver-'));
}

async function writeFileEnsuringDir(filePath: string, contents: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, 'utf-8');
}

// =============================================================================
// Rule 1 — scalar override wins
// =============================================================================

describe('deepMerge — Rule 1: scalars (override wins)', () => {
  it('replaces a string scalar', () => {
    expect(deepMerge('base', 'override')).toBe('override');
  });

  it('replaces an integer with a different integer', () => {
    expect(deepMerge(1, 2)).toBe(2);
  });

  it('replaces a boolean', () => {
    expect(deepMerge(true, false)).toBe(false);
  });

  it('replaces a float', () => {
    expect(deepMerge(1.5, 2.5)).toBe(2.5);
  });

  it('lets override REPLACE base when types differ — per docs § "Merge Rules": "Anything else: override wins"', () => {
    expect(deepMerge('string-base', 42)).toBe(42);
    expect(deepMerge([1, 2, 3], 'now-a-string')).toBe('now-a-string');
    expect(deepMerge({ k: 'v' }, [1, 2])).toEqual([1, 2]);
  });
});

// =============================================================================
// Rule 2 — table deep merge
// =============================================================================

describe('deepMerge — Rule 2: tables (recursive deep merge)', () => {
  it('merges shallow keys, override winning on conflicts', () => {
    expect(deepMerge({ a: 1, b: 2 }, { b: 3, c: 4 })).toEqual({
      a: 1,
      b: 3,
      c: 4,
    });
  });

  it('preserves untouched keys from the base layer', () => {
    expect(deepMerge({ retained: 'yes', changed: 'before' }, { changed: 'after' })).toEqual({
      retained: 'yes',
      changed: 'after',
    });
  });

  it('recursively merges nested tables', () => {
    expect(
      deepMerge(
        { agent: { icon: '📋', role: 'PM', principles: ['p1'] } },
        { agent: { icon: '🏥', principles: ['p2'] } },
      ),
    ).toEqual({
      agent: {
        icon: '🏥',
        role: 'PM',
        principles: ['p1', 'p2'],
      },
    });
  });

  it('adds new override keys without touching base keys', () => {
    expect(deepMerge({ retained: 'yes' }, { added: 'new' })).toEqual({
      retained: 'yes',
      added: 'new',
    });
  });
});

// =============================================================================
// Rule 3 — keyed arrays merge by `code` / `id`
// =============================================================================

describe('deepMerge — Rule 3: keyed arrays merge by code/id', () => {
  it('replaces matching `code` items in place — per docs § "Merge Rules": matching keys replace in place', () => {
    const merged = deepMerge(
      [
        { code: 'CP', description: 'Create PRD', skill: 'bmad-create-prd' },
        { code: 'VP', description: 'Validate PRD', skill: 'bmad-validate-prd' },
      ],
      [{ code: 'CP', description: 'Replaced PRD', skill: 'custom-create-prd' }],
    );
    expect(merged).toEqual([
      { code: 'CP', description: 'Replaced PRD', skill: 'custom-create-prd' },
      { code: 'VP', description: 'Validate PRD', skill: 'bmad-validate-prd' },
    ]);
  });

  it('appends new `code` items at the end', () => {
    expect(
      deepMerge(
        [{ code: 'CP', description: 'Base' }],
        [{ code: 'RC', description: 'Compliance pre-check' }],
      ),
    ).toEqual([
      { code: 'CP', description: 'Base' },
      { code: 'RC', description: 'Compliance pre-check' },
    ]);
  });

  it('mixes replace + append in one override pass', () => {
    expect(
      deepMerge(
        [
          { code: 'A', x: 1 },
          { code: 'B', x: 2 },
        ],
        [
          { code: 'B', x: 99 },
          { code: 'C', x: 3 },
        ],
      ),
    ).toEqual([
      { code: 'A', x: 1 },
      { code: 'B', x: 99 },
      { code: 'C', x: 3 },
    ]);
  });

  it('uses `id` when every item shares it instead of `code`', () => {
    expect(
      deepMerge([{ id: 'one', v: 1 }], [{ id: 'one', v: 99 }, { id: 'two', v: 2 }]),
    ).toEqual([
      { id: 'one', v: 99 },
      { id: 'two', v: 2 },
    ]);
  });

  it('preserves the relative order of base items when replacing in place', () => {
    expect(
      deepMerge(
        [
          { code: 'first', v: 1 },
          { code: 'second', v: 2 },
          { code: 'third', v: 3 },
        ],
        [{ code: 'second', v: 999 }],
      ),
    ).toEqual([
      { code: 'first', v: 1 },
      { code: 'second', v: 999 },
      { code: 'third', v: 3 },
    ]);
  });
});

// =============================================================================
// Rule 4 — append fallback for non-keyed arrays
// =============================================================================

describe('deepMerge — Rule 4: append fallback', () => {
  it('appends scalar arrays — per docs § "Merge Rules": "All other arrays: append"', () => {
    expect(deepMerge(['p1', 'p2'], ['p3', 'p4'])).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('appends arrays of tables that lack any `code` or `id` field', () => {
    expect(
      deepMerge([{ description: 'a' }], [{ description: 'b' }]),
    ).toEqual([{ description: 'a' }, { description: 'b' }]);
  });

  it('appends MIXED-key arrays where some items use `code` and others `id` — per docs § "The `code` / `id` convention": "Mixing identifier keys within one array...append-fallback is safer than guessing"', () => {
    expect(
      deepMerge([{ code: 'A', v: 1 }], [{ id: 'B', v: 2 }]),
    ).toEqual([
      { code: 'A', v: 1 },
      { id: 'B', v: 2 },
    ]);
  });

  it('appends when only some items have a candidate key (one missing → append)', () => {
    expect(
      deepMerge(
        [{ code: 'A', v: 1 }, { v: 2 }],
        [{ code: 'C', v: 3 }],
      ),
    ).toEqual([
      { code: 'A', v: 1 },
      { v: 2 },
      { code: 'C', v: 3 },
    ]);
  });

  it('appends arrays of mixed scalar types', () => {
    expect(deepMerge([1, 'a'], [true, 2.5])).toEqual([1, 'a', true, 2.5]);
  });
});

// =============================================================================
// detectKeyedMergeField unit tests
// =============================================================================

describe('detectKeyedMergeField', () => {
  it('returns null for empty arrays', () => {
    expect(detectKeyedMergeField([])).toBeNull();
  });

  it('returns null when items are not all objects', () => {
    expect(detectKeyedMergeField([{ code: 'A' }, 'string'])).toBeNull();
    expect(detectKeyedMergeField([1, 2, 3])).toBeNull();
  });

  it('returns null when keys are mixed across items', () => {
    expect(
      detectKeyedMergeField([{ code: 'A' }, { id: 'B' }]),
    ).toBeNull();
  });

  it('returns "code" when every item has `code`', () => {
    expect(
      detectKeyedMergeField([
        { code: 'A', x: 1 },
        { code: 'B', x: 2 },
      ]),
    ).toBe('code');
  });

  it('returns "id" when every item has `id`', () => {
    expect(
      detectKeyedMergeField([
        { id: 'one', x: 1 },
        { id: 'two', x: 2 },
      ]),
    ).toBe('id');
  });

  it('prefers "code" over "id" when both are present (Python order: code first)', () => {
    expect(
      detectKeyedMergeField([
        { code: 'A', id: 'one' },
        { code: 'B', id: 'two' },
      ]),
    ).toBe('code');
  });

  it('treats a literal `null` value for the candidate key as missing', () => {
    expect(
      detectKeyedMergeField([{ code: 'A' }, { code: null }]),
    ).toBeNull();
  });

  it('treats an empty string as a present key (matches Python `is not None`)', () => {
    expect(
      detectKeyedMergeField([{ code: '' }, { code: 'B' }]),
    ).toBe('code');
  });

  it('treats `0` and `false` as present keys', () => {
    expect(
      detectKeyedMergeField([{ code: 0 }, { code: false }, { code: 'X' }]),
    ).toBe('code');
  });
});

// =============================================================================
// mergeByKey + mergeArrays direct tests
// =============================================================================

describe('mergeByKey', () => {
  it('appends override items when no base item shares the key', () => {
    expect(
      mergeByKey([{ code: 'A' }], [{ code: 'B' }], 'code'),
    ).toEqual([{ code: 'A' }, { code: 'B' }]);
  });

  it('drops base items that are not plain objects (matches Python `if not isinstance(item, dict): continue`)', () => {
    expect(
      mergeByKey(['scalar', { code: 'A' }], [{ code: 'A' }], 'code'),
    ).toEqual([{ code: 'A' }]);
  });

  it('appends override items that are not plain objects untouched', () => {
    expect(
      mergeByKey([{ code: 'A' }], ['raw', { code: 'B' }], 'code'),
    ).toEqual([{ code: 'A' }, 'raw', { code: 'B' }]);
  });
});

describe('mergeArrays', () => {
  it('coerces non-array base or override into empty arrays', () => {
    expect(mergeArrays(undefined, [1, 2])).toEqual([1, 2]);
    expect(mergeArrays([1, 2], null)).toEqual([1, 2]);
  });
});

// =============================================================================
// extractKey
// =============================================================================

describe('extractKey', () => {
  const tree = {
    agent: {
      icon: '📋',
      menu: [{ code: 'CP' }, { code: 'VP' }],
    },
    workflow: { on_complete: 'done' },
  };

  it('extracts top-level keys', () => {
    expect(extractKey(tree, 'agent')).toEqual(tree.agent);
  });

  it('extracts nested dotted paths', () => {
    expect(extractKey(tree, 'agent.icon')).toBe('📋');
    expect(extractKey(tree, 'workflow.on_complete')).toBe('done');
  });

  it('returns undefined for missing intermediate segments', () => {
    expect(extractKey(tree, 'agent.unknown.deeper')).toBeUndefined();
  });

  it('returns undefined when descending into a non-object', () => {
    expect(extractKey(tree, 'agent.icon.further')).toBeUndefined();
  });

  it('returns undefined for entirely-missing keys', () => {
    expect(extractKey(tree, 'nope')).toBeUndefined();
  });
});

// =============================================================================
// isPlainObject
// =============================================================================

describe('isPlainObject', () => {
  it('treats `{}` as plain', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
  });

  it('rejects null, arrays, and primitives', () => {
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(0)).toBe(false);
    expect(isPlainObject('s')).toBe(false);
  });

  it('rejects Date / Map (smol-toml can produce Date for TOML datetimes)', () => {
    expect(isPlainObject(new Date())).toBe(false);
    expect(isPlainObject(new Map())).toBe(false);
  });

  it('treats Object.create(null) as plain', () => {
    expect(isPlainObject(Object.create(null))).toBe(true);
  });
});

// =============================================================================
// loadToml — file-loading boundary
// =============================================================================

describe('loadToml', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempProject();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns {} when the file is missing and not required', async () => {
    expect(await loadToml(path.join(dir, 'missing.toml'))).toEqual({});
  });

  it('throws CustomizationResolverError when missing and required', async () => {
    await expect(
      loadToml(path.join(dir, 'missing.toml'), { required: true }),
    ).rejects.toBeInstanceOf(CustomizationResolverError);
  });

  it('parses a valid TOML file', async () => {
    const filePath = path.join(dir, 'valid.toml');
    await writeFile(filePath, '[agent]\nicon = "📋"\n');
    expect(await loadToml(filePath)).toEqual({ agent: { icon: '📋' } });
  });

  it('returns {} on parse failure when not required (and reports via onWarn)', async () => {
    const filePath = path.join(dir, 'broken.toml');
    await writeFile(filePath, 'this is not [valid] = toml = at all\n');
    const warnings: string[] = [];
    const result = await loadToml(filePath, { onWarn: (m) => warnings.push(m) });
    expect(result).toEqual({});
    expect(warnings.some((w) => w.includes(filePath))).toBe(true);
  });

  it('throws when parse fails and required', async () => {
    const filePath = path.join(dir, 'broken.toml');
    await writeFile(filePath, 'this is not [valid] = toml\n');
    await expect(
      loadToml(filePath, { required: true }),
    ).rejects.toBeInstanceOf(CustomizationResolverError);
  });
});

// =============================================================================
// resolveCustomization — three-layer integration
// =============================================================================

describe('resolveCustomization — three-layer integration', () => {
  let projectRoot: string;
  let skillDir: string;

  beforeEach(async () => {
    projectRoot = await makeTempProject();
    skillDir = path.join(projectRoot, '_bmad', 'bmm', '2-plan-workflows', 'bmad-agent-pm');
    await writeFileEnsuringDir(
      path.join(skillDir, 'customize.toml'),
      `
[agent]
name = "John"
title = "Product Manager"
icon = "📋"
principles = ["PRDs emerge from user interviews."]

[[agent.menu]]
code = "CP"
description = "Create PRD"
skill = "bmad-create-prd"

[[agent.menu]]
code = "VP"
description = "Validate PRD"
skill = "bmad-validate-prd"
`,
    );
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('returns the defaults verbatim when no custom files exist', async () => {
    const merged = await resolveCustomization({ skillDir, projectRoot });
    expect(merged).toMatchObject({
      agent: {
        name: 'John',
        title: 'Product Manager',
        icon: '📋',
        principles: ['PRDs emerge from user interviews.'],
      },
    });
  });

  it('lets a team override scalar field win — per docs § "Three-Layer Override Model": team beats default', async () => {
    await writeFileEnsuringDir(
      path.join(projectRoot, '_bmad', 'custom', 'bmad-agent-pm.toml'),
      '[agent]\nicon = "🏥"\n',
    );
    const merged = await resolveCustomization({ skillDir, projectRoot });
    expect((merged.agent as Record<string, unknown>).icon).toBe('🏥');
  });

  it('lets a user override beat the team override — per docs § "Three-Layer Override Model": user beats team', async () => {
    await writeFileEnsuringDir(
      path.join(projectRoot, '_bmad', 'custom', 'bmad-agent-pm.toml'),
      '[agent]\nicon = "🏥"\n',
    );
    await writeFileEnsuringDir(
      path.join(projectRoot, '_bmad', 'custom', 'bmad-agent-pm.user.toml'),
      '[agent]\nicon = "🌟"\n',
    );
    const merged = await resolveCustomization({ skillDir, projectRoot });
    expect((merged.agent as Record<string, unknown>).icon).toBe('🌟');
  });

  it('appends principles across all three layers', async () => {
    await writeFileEnsuringDir(
      path.join(projectRoot, '_bmad', 'custom', 'bmad-agent-pm.toml'),
      '[agent]\nprinciples = ["Compliance always."]\n',
    );
    await writeFileEnsuringDir(
      path.join(projectRoot, '_bmad', 'custom', 'bmad-agent-pm.user.toml'),
      '[agent]\nprinciples = ["Always include complexity estimate."]\n',
    );
    const merged = await resolveCustomization({ skillDir, projectRoot });
    expect((merged.agent as Record<string, unknown>).principles).toEqual([
      'PRDs emerge from user interviews.',
      'Compliance always.',
      'Always include complexity estimate.',
    ]);
  });

  it('replaces a menu item by `code` while appending new ones — per docs § "Menu customization (merge by code)"', async () => {
    await writeFileEnsuringDir(
      path.join(projectRoot, '_bmad', 'custom', 'bmad-agent-pm.toml'),
      `
[[agent.menu]]
code = "CP"
description = "Custom create PRD"
skill = "custom-create-prd"

[[agent.menu]]
code = "RC"
description = "Run compliance check"
prompt = "scan compliance docs"
`,
    );
    const merged = await resolveCustomization({ skillDir, projectRoot });
    expect((merged.agent as Record<string, unknown>).menu).toEqual([
      { code: 'CP', description: 'Custom create PRD', skill: 'custom-create-prd' },
      { code: 'VP', description: 'Validate PRD', skill: 'bmad-validate-prd' },
      { code: 'RC', description: 'Run compliance check', prompt: 'scan compliance docs' },
    ]);
  });

  it('returns a sparse object when `keys` is provided', async () => {
    await writeFileEnsuringDir(
      path.join(projectRoot, '_bmad', 'custom', 'bmad-agent-pm.user.toml'),
      '[agent]\nicon = "🏥"\n',
    );
    const result = await resolveCustomization({
      skillDir,
      projectRoot,
      keys: ['agent.icon', 'agent.name', 'workflow.on_complete'],
    });
    expect(result).toEqual({
      'agent.icon': '🏥',
      'agent.name': 'John',
    });
  });

  it('throws when the skill defaults file is missing', async () => {
    const otherSkill = path.join(projectRoot, 'no-defaults');
    await mkdir(otherSkill, { recursive: true });
    await expect(
      resolveCustomization({ skillDir: otherSkill, projectRoot }),
    ).rejects.toBeInstanceOf(CustomizationResolverError);
  });

  it('walks up from skillDir to find project root when none provided', async () => {
    const merged = await resolveCustomization({ skillDir });
    // Doesn't throw, returns at least the defaults block
    expect((merged.agent as Record<string, unknown>).name).toBe('John');
  });
});
