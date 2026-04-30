/**
 * Vitest fixtures for the four-layer central config resolver.
 *
 * Coverage:
 *   - Base layer is required (absence throws)
 *   - Optional layers degrade silently to {}
 *   - Layer priority: custom.user > custom > base.user > base
 *   - Same structural merge rules as the per-skill resolver — only the layer
 *     count differs, so we lean on the rule-by-rule customization tests for
 *     scalar/table/array correctness and just smoke-test the layered priority.
 *
 * Doc citation: BMAD docs § "Central Configuration" + § "Four-Layer Merge".
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigResolverError, resolveConfig } from '../config-resolver';

async function makeProject(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'bmad-config-resolver-'));
}

async function writeConfigFile(projectRoot: string, relPath: string, contents: string) {
  const filePath = path.join(projectRoot, '_bmad', relPath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, 'utf-8');
}

describe('resolveConfig', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await makeProject();
    await writeConfigFile(
      projectRoot,
      'config.toml',
      `
[core]
project_name = "Default-Project"
document_output_language = "English"

[modules.bmm]
planning_artifacts = "{project-root}/_bmad-output/planning-artifacts"

[agents.bmad-agent-pm]
module = "bmm"
team = "software-development"
name = "John"
title = "Product Manager"
icon = "📋"
description = "Default PM"
`,
    );
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('throws when the base config.toml is missing', async () => {
    const empty = await makeProject();
    try {
      await expect(resolveConfig({ projectRoot: empty })).rejects.toBeInstanceOf(
        ConfigResolverError,
      );
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it('returns the base layer verbatim when no overlays exist', async () => {
    const cfg = await resolveConfig({ projectRoot });
    expect((cfg.core as Record<string, unknown>).project_name).toBe('Default-Project');
    expect((cfg.agents as Record<string, unknown>)['bmad-agent-pm']).toMatchObject({
      icon: '📋',
      name: 'John',
    });
  });

  it('lets installer-owned user (config.user.toml) override the base', async () => {
    await writeConfigFile(
      projectRoot,
      'config.user.toml',
      '[core]\nuser_name = "Sallvain"\nproject_name = "User-Override"\n',
    );
    const cfg = await resolveConfig({ projectRoot });
    expect((cfg.core as Record<string, unknown>).project_name).toBe('User-Override');
    expect((cfg.core as Record<string, unknown>).user_name).toBe('Sallvain');
  });

  it('lets human-authored team (custom/config.toml) beat installer layers', async () => {
    await writeConfigFile(
      projectRoot,
      'config.user.toml',
      '[core]\nproject_name = "User-Override"\n',
    );
    await writeConfigFile(
      projectRoot,
      'custom/config.toml',
      '[core]\nproject_name = "Team-Custom"\n',
    );
    const cfg = await resolveConfig({ projectRoot });
    expect((cfg.core as Record<string, unknown>).project_name).toBe('Team-Custom');
  });

  it('lets human-authored user (custom/config.user.toml) beat all other layers', async () => {
    await writeConfigFile(
      projectRoot,
      'config.user.toml',
      '[core]\nproject_name = "Installer-User"\n',
    );
    await writeConfigFile(
      projectRoot,
      'custom/config.toml',
      '[core]\nproject_name = "Team-Custom"\n',
    );
    await writeConfigFile(
      projectRoot,
      'custom/config.user.toml',
      '[core]\nproject_name = "Personal-Final"\n',
    );
    const cfg = await resolveConfig({ projectRoot });
    expect((cfg.core as Record<string, unknown>).project_name).toBe('Personal-Final');
  });

  it('rebrands an agent in central config — per docs § "Recipe — Rebrand an Agent"', async () => {
    await writeConfigFile(
      projectRoot,
      'custom/config.toml',
      `
[agents.bmad-agent-pm]
description = "Healthcare PM — regulatory-aware"
icon = "🏥"
`,
    );
    const cfg = await resolveConfig({ projectRoot });
    const pm = (cfg.agents as Record<string, Record<string, unknown>>)['bmad-agent-pm'];
    expect(pm.icon).toBe('🏥');
    expect(pm.description).toBe('Healthcare PM — regulatory-aware');
    // Untouched fields survive
    expect(pm.name).toBe('John');
    expect(pm.title).toBe('Product Manager');
  });

  it('adds a new agent at user scope without touching defaults', async () => {
    await writeConfigFile(
      projectRoot,
      'custom/config.user.toml',
      `
[agents.kirk]
team = "startrek"
name = "Captain James T. Kirk"
title = "Starship Captain"
icon = "🖖"
description = "Bold, rule-bending commander."
`,
    );
    const cfg = await resolveConfig({ projectRoot });
    const agents = cfg.agents as Record<string, Record<string, unknown>>;
    expect(agents.kirk).toMatchObject({ name: 'Captain James T. Kirk', icon: '🖖' });
    expect(agents['bmad-agent-pm']).toMatchObject({ name: 'John' });
  });

  it('returns sparse extractions when keys provided', async () => {
    const cfg = await resolveConfig({ projectRoot, keys: ['core.project_name', 'agents.bmad-agent-pm.icon'] });
    expect(cfg).toEqual({
      'core.project_name': 'Default-Project',
      'agents.bmad-agent-pm.icon': '📋',
    });
  });

  it('reports parse warnings on broken optional layers via onWarn', async () => {
    await writeConfigFile(projectRoot, 'config.user.toml', 'this = is not [valid] toml = at all\n');
    const warnings: string[] = [];
    await resolveConfig({ projectRoot, onWarn: (m) => warnings.push(m) });
    expect(warnings.some((w) => w.includes('config.user.toml'))).toBe(true);
  });
});
