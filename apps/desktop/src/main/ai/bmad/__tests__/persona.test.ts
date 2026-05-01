/**
 * Vitest fixtures for the persona registry.
 *
 * Coverage:
 *   - loadPersona reads `_bmad/config.toml` `[agents.{skillId}]` for read-only
 *     identity (name/title/module/team/description) per BMAD docs § "What Named
 *     Agents Buy You" — `agent.name` and `agent.title` are read-only.
 *   - The customizable surface (icon/role/principles/menu/...) flows through
 *     the per-skill `customize.toml` via the skill registry.
 *   - The slug↔skillId map matches INVENTORY.md §4.3 + BMAD docs § "Default Agents".
 *   - `loadAllPersonas` skips personas whose central-config block is missing
 *     (project doesn't have BMM installed).
 *   - `personaSlugFromSkillId` is the inverse of `skillIdForPersonaSlug`.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  __internals,
  loadAllPersonas,
  loadPersona,
  personaSlugFromSkillId,
  PersonaError,
  skillIdForPersonaSlug,
} from '../persona';
import { SkillRegistry } from '../skill-registry';
import type { BmadPersonaSlug } from '../../../../shared/types/bmad';

const { SLUG_TO_SKILL, SLUG_TO_PHASE } = __internals;

// =============================================================================
// Helpers — build a minimal BMAD project on disk
// =============================================================================

async function makeProject(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'bmad-persona-'));
}

async function writeBmadFile(root: string, rel: string, body: string) {
  const target = path.join(root, rel);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, body, 'utf-8');
}

const SAMPLE_CONFIG_TOML = `
[core]
project_name = "test"

[agents.bmad-agent-pm]
module = "bmm"
team = "software-development"
name = "John"
title = "Product Manager"
description = "Drives Jobs-to-be-Done over template filling."

[agents.bmad-agent-architect]
module = "bmm"
team = "software-development"
name = "Winston"
title = "System Architect"
description = "Favors boring technology for stability."
`;

const SAMPLE_PM_CUSTOMIZE_TOML = `
[agent]
name = "John"
title = "Product Manager"
icon = "📋"
activation_steps_prepend = []
activation_steps_append = []
persistent_facts = ["file:{project-root}/**/project-context.md"]
role = "Translate vision into a PRD."
identity = "Thinks like Marty Cagan."
communication_style = "Detective's relentless 'why?'."
principles = [
  "PRDs emerge from user interviews.",
  "Ship the smallest thing that validates.",
]

[[agent.menu]]
code = "CP"
description = "Create PRD"
skill = "bmad-create-prd"

[[agent.menu]]
code = "CC"
description = "Course correct"
prompt = "Walk me through what changed."
`;

const SAMPLE_ARCHITECT_CUSTOMIZE_TOML = `
[agent]
name = "Winston"
title = "System Architect"
icon = "🏗️"
role = "Design the system."
principles = ["Boring technology wins."]
`;

const SAMPLE_PM_SKILL = `---
name: bmad-agent-pm
description: PM persona.
---

# John - Product Manager

This is the PM activation flow.
`;

const SAMPLE_ARCH_SKILL = `---
name: bmad-agent-architect
description: Architect persona.
---

# Winston - System Architect
`;

async function makeBmadInstall(opts: {
  readonly includeArchitect?: boolean;
} = {}): Promise<string> {
  const root = await makeProject();
  await writeBmadFile(root, '_bmad/config.toml', SAMPLE_CONFIG_TOML);
  await writeBmadFile(
    root,
    '_bmad/_config/manifest.yaml',
    `installation:
  version: 6.6.0
  installDate: 2026-04-30T00:00:00.000Z
  lastUpdated: 2026-04-30T00:00:00.000Z
modules:
  - name: bmm
    version: 6.6.0
    installDate: 2026-04-30T00:00:00.000Z
    lastUpdated: 2026-04-30T00:00:00.000Z
    source: built-in
    npmPackage: null
    repoUrl: null
ides:
  - cursor
`,
  );

  // skill-manifest.csv — reference paths within the project root.
  const skillRows = [
    'canonicalId,name,description,module,path',
    '"bmad-agent-pm","bmad-agent-pm","PM persona","bmm","_bmad/bmm/2-plan-workflows/bmad-agent-pm/SKILL.md"',
  ];
  if (opts.includeArchitect) {
    skillRows.push(
      '"bmad-agent-architect","bmad-agent-architect","Architect persona","bmm","_bmad/bmm/3-solutioning/bmad-agent-architect/SKILL.md"',
    );
  }
  await writeBmadFile(root, '_bmad/_config/skill-manifest.csv', `${skillRows.join('\n')}\n`);

  // PM skill files
  await writeBmadFile(
    root,
    '_bmad/bmm/2-plan-workflows/bmad-agent-pm/SKILL.md',
    SAMPLE_PM_SKILL,
  );
  await writeBmadFile(
    root,
    '_bmad/bmm/2-plan-workflows/bmad-agent-pm/customize.toml',
    SAMPLE_PM_CUSTOMIZE_TOML,
  );

  if (opts.includeArchitect) {
    await writeBmadFile(
      root,
      '_bmad/bmm/3-solutioning/bmad-agent-architect/SKILL.md',
      SAMPLE_ARCH_SKILL,
    );
    await writeBmadFile(
      root,
      '_bmad/bmm/3-solutioning/bmad-agent-architect/customize.toml',
      SAMPLE_ARCHITECT_CUSTOMIZE_TOML,
    );
  }

  return root;
}

// =============================================================================
// Tests
// =============================================================================

describe('persona constants — SLUG_TO_SKILL', () => {
  it('hardcodes the six BMM personas per INVENTORY.md §4.3', () => {
    expect(SLUG_TO_SKILL).toEqual({
      mary: 'bmad-agent-analyst',
      paige: 'bmad-agent-tech-writer',
      john: 'bmad-agent-pm',
      sally: 'bmad-agent-ux-designer',
      winston: 'bmad-agent-architect',
      amelia: 'bmad-agent-dev',
    });
  });

  it('matches BMAD docs § "Default Agents" phase ownership', () => {
    expect(SLUG_TO_PHASE).toEqual({
      mary: '1-analysis',
      paige: '1-analysis',
      john: '2-planning',
      sally: '2-planning',
      winston: '3-solutioning',
      amelia: '4-implementation',
    });
  });

  it('skillIdForPersonaSlug round-trips with personaSlugFromSkillId', () => {
    const slugs: BmadPersonaSlug[] = ['mary', 'paige', 'john', 'sally', 'winston', 'amelia'];
    for (const slug of slugs) {
      const skillId = skillIdForPersonaSlug(slug);
      expect(personaSlugFromSkillId(skillId)).toBe(slug);
    }
  });

  it('returns null for non-persona skill ids', () => {
    expect(personaSlugFromSkillId('bmad-create-prd')).toBeNull();
    expect(personaSlugFromSkillId('bmad-help')).toBeNull();
    expect(personaSlugFromSkillId('made-up-skill')).toBeNull();
  });
});

describe('loadPersona — happy path', () => {
  let projectRoot: string;
  let skillRegistry: SkillRegistry;

  beforeEach(async () => {
    projectRoot = await makeBmadInstall();
    skillRegistry = new SkillRegistry();
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('merges central-config identity with per-skill customize block', async () => {
    const persona = await loadPersona('john', { projectRoot, skillRegistry });

    expect(persona.slug).toBe('john');
    expect(persona.skillId).toBe('bmad-agent-pm');
    // Read-only identity from _bmad/config.toml [agents.bmad-agent-pm].
    expect(persona.name).toBe('John');
    expect(persona.title).toBe('Product Manager');
    expect(persona.module).toBe('bmm');
    expect(persona.team).toBe('software-development');
    expect(persona.description).toContain('Jobs-to-be-Done');
    // Customizable surface from per-skill customize.toml [agent].
    expect(persona.icon).toBe('📋');
    expect(persona.role).toBe('Translate vision into a PRD.');
    expect(persona.identity).toBe('Thinks like Marty Cagan.');
    expect(persona.communicationStyle).toBe("Detective's relentless 'why?'.");
    expect(persona.principles).toEqual([
      'PRDs emerge from user interviews.',
      'Ship the smallest thing that validates.',
    ]);
    expect(persona.persistentFacts).toEqual([
      'file:{project-root}/**/project-context.md',
    ]);
    expect(persona.phase).toBe('2-planning');
  });

  it('parses the menu items including both `skill` and `prompt` shapes', async () => {
    const persona = await loadPersona('john', { projectRoot, skillRegistry });
    expect(persona.menu).toHaveLength(2);
    expect(persona.menu[0]).toMatchObject({
      code: 'CP',
      description: 'Create PRD',
      skill: 'bmad-create-prd',
    });
    expect(persona.menu[0]?.prompt).toBeUndefined();
    expect(persona.menu[1]).toMatchObject({
      code: 'CC',
      description: 'Course correct',
      prompt: 'Walk me through what changed.',
    });
    expect(persona.menu[1]?.skill).toBeUndefined();
  });
});

describe('loadPersona — error paths', () => {
  it('throws PERSONA_NOT_FOUND for an unknown slug', async () => {
    const projectRoot = await makeBmadInstall();
    try {
      await expect(
        loadPersona('not-a-persona' as BmadPersonaSlug, { projectRoot }),
      ).rejects.toThrow(PersonaError);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('throws IO_ERROR when _bmad/config.toml is missing', async () => {
    const projectRoot = await makeProject();
    try {
      await expect(
        loadPersona('john', { projectRoot }),
      ).rejects.toThrow(/config\.toml/);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('throws PERSONA_NOT_FOUND when central config has no [agents.{skillId}] block', async () => {
    const projectRoot = await makeProject();
    await writeBmadFile(projectRoot, '_bmad/config.toml', '[core]\nproject_name = "test"\n');
    await writeBmadFile(
      projectRoot,
      '_bmad/_config/skill-manifest.csv',
      'canonicalId,name,description,module,path\n"bmad-agent-pm","bmad-agent-pm","x","bmm","_bmad/bmm/x/SKILL.md"\n',
    );
    try {
      await expect(loadPersona('john', { projectRoot })).rejects.toThrow(/agents/);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});

describe('loadAllPersonas', () => {
  it('skips personas whose central-config block is missing without throwing', async () => {
    const projectRoot = await makeBmadInstall();
    try {
      const personas = await loadAllPersonas({ projectRoot });
      // Only PM is in central config; the other 5 should be silently skipped.
      expect(personas.map((p) => p.slug)).toEqual(['john']);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('returns multiple personas when multiple are configured', async () => {
    const projectRoot = await makeBmadInstall({ includeArchitect: true });
    try {
      const personas = await loadAllPersonas({ projectRoot });
      expect(personas.map((p) => p.slug).sort()).toEqual(['john', 'winston']);
      const winston = personas.find((p) => p.slug === 'winston');
      expect(winston?.icon).toBe('🏗️');
      expect(winston?.title).toBe('System Architect');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
