/**
 * Vitest fixtures for the manifest loader.
 *
 * Coverage:
 *   - loadManifest: missing returns null, broken yaml throws YAML_PARSE_ERROR,
 *     valid yaml passes Zod validation
 *   - loadSkillManifest: empty/missing returns [], parses well-formed CSV,
 *     reports row issues
 *   - loadBmadHelp: parses workflow rows and meta rows, parses dependencies
 *     with optional `:action` suffix, parses pipe-separated outputs, parses
 *     boolean literals, rejects unknown phases
 *   - loadFilesManifest: parses + validates
 *   - isBmadProject: false for empty dir, true after writing manifest.yaml
 *   - loadAllManifests: throws PROJECT_NOT_BMAD when manifest missing
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  __internals,
  isBmadProject,
  loadAllManifests,
  loadBmadHelp,
  loadFilesManifest,
  loadManifest,
  loadSkillManifest,
  ManifestLoadError,
} from '../manifest-loader';

const { parseDependencyList, parseBooleanLiteral, parsePipeList } = __internals;

async function makeProject(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'bmad-manifest-loader-'));
}

async function writeConfigFile(projectRoot: string, fileName: string, contents: string) {
  const configDir = path.join(projectRoot, '_bmad', '_config');
  await mkdir(configDir, { recursive: true });
  await writeFile(path.join(configDir, fileName), contents, 'utf-8');
}

const SAMPLE_MANIFEST_YAML = `
installation:
  version: 6.6.0
  installDate: 2026-04-30T05:00:00.000Z
  lastUpdated: 2026-04-30T05:00:00.000Z
modules:
  - name: core
    version: 6.6.0
    installDate: 2026-04-30T05:00:00.000Z
    lastUpdated: 2026-04-30T05:00:00.000Z
    source: built-in
    npmPackage: null
    repoUrl: null
  - name: bmm
    version: 6.6.0
    installDate: 2026-04-30T05:00:00.000Z
    lastUpdated: 2026-04-30T05:00:00.000Z
    source: built-in
    npmPackage: null
    repoUrl: null
ides:
  - cursor
`;

const SAMPLE_SKILL_MANIFEST_CSV =
  `canonicalId,name,description,module,path
"bmad-help","bmad-help","Intelligent guide","core","_bmad/core/bmad-help/SKILL.md"
"bmad-create-prd","bmad-create-prd","Create a PRD","bmm","_bmad/bmm/2-plan-workflows/bmad-create-prd/SKILL.md"
`;

const SAMPLE_BMAD_HELP_CSV =
  `module,skill,display-name,menu-code,description,action,args,phase,after,before,required,output-location,outputs
BMad Method,_meta,,,,,,,,,false,https://docs.bmad-method.org/llms.txt,
BMad Method,bmad-create-prd,Create PRD,CP,Expert led PRD,,,2-planning,,,true,planning_artifacts,prd
BMad Method,bmad-validate-prd,Validate PRD,VP,Validate,,[path],2-planning,bmad-create-prd,,false,planning_artifacts,prd validation report
BMad Method,bmad-create-story,Create Story,CS,Story start,create,,4-implementation,bmad-sprint-planning,bmad-create-story:validate,true,implementation_artifacts,story
BMad Method,bmad-create-story,Validate Story,VS,Validate story,validate,,4-implementation,bmad-create-story:create,bmad-dev-story,false,implementation_artifacts,validation report
BMad Method,bmad-document-project,Document Project,DP,Brownfield docs,,,anytime,,,false,project-knowledge,*
`;

const SAMPLE_FILES_MANIFEST_CSV =
  `type,name,module,path,hash
"yaml","manifest","_config","_config/manifest.yaml","abc123"
"csv","skill-manifest","_config","_config/skill-manifest.csv","def456"
`;

describe('isBmadProject', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await makeProject();
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('returns false when manifest.yaml is missing', async () => {
    expect(await isBmadProject(projectRoot)).toBe(false);
  });

  it('returns true after writing manifest.yaml', async () => {
    await writeConfigFile(projectRoot, 'manifest.yaml', SAMPLE_MANIFEST_YAML);
    expect(await isBmadProject(projectRoot)).toBe(true);
  });
});

describe('loadManifest', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await makeProject();
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('returns null when missing (caller decides project status)', async () => {
    expect(await loadManifest(projectRoot)).toBeNull();
  });

  it('parses a valid manifest', async () => {
    await writeConfigFile(projectRoot, 'manifest.yaml', SAMPLE_MANIFEST_YAML);
    const manifest = await loadManifest(projectRoot);
    expect(manifest?.installation.version).toBe('6.6.0');
    expect(manifest?.modules).toHaveLength(2);
    expect(manifest?.modules.map((m) => m.name).sort()).toEqual(['bmm', 'core']);
    expect(manifest?.ides).toEqual(['cursor']);
  });

  it('throws YAML_PARSE_ERROR on malformed yaml', async () => {
    await writeConfigFile(projectRoot, 'manifest.yaml', '   :::  not yaml ::: ');
    await expect(loadManifest(projectRoot)).rejects.toMatchObject({
      code: 'YAML_PARSE_ERROR',
    });
  });

  it('throws MANIFEST_PARSE_ERROR when schema fails', async () => {
    await writeConfigFile(projectRoot, 'manifest.yaml', `installation:\n  version: 6\nmodules: []\nides: []\n`);
    await expect(loadManifest(projectRoot)).rejects.toBeInstanceOf(ManifestLoadError);
  });
});

describe('loadSkillManifest', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await makeProject();
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('returns [] when missing', async () => {
    expect(await loadSkillManifest(projectRoot)).toEqual([]);
  });

  it('parses a valid CSV', async () => {
    await writeConfigFile(projectRoot, 'skill-manifest.csv', SAMPLE_SKILL_MANIFEST_CSV);
    const skills = await loadSkillManifest(projectRoot);
    expect(skills).toHaveLength(2);
    expect(skills[0]).toMatchObject({ canonicalId: 'bmad-help', module: 'core' });
    expect(skills[1]).toMatchObject({ canonicalId: 'bmad-create-prd', module: 'bmm' });
  });

  it('rejects rows missing required fields with details', async () => {
    await writeConfigFile(
      projectRoot,
      'skill-manifest.csv',
      `canonicalId,name,description,module,path\n,"missing-id","desc","core",""\n`,
    );
    await expect(loadSkillManifest(projectRoot)).rejects.toMatchObject({
      code: 'CSV_PARSE_ERROR',
    });
  });
});

describe('loadBmadHelp', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await makeProject();
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('returns [] when missing', async () => {
    expect(await loadBmadHelp(projectRoot)).toEqual([]);
  });

  it('parses workflow + meta rows, dependency lists, pipe outputs, booleans', async () => {
    await writeConfigFile(projectRoot, 'bmad-help.csv', SAMPLE_BMAD_HELP_CSV);
    const rows = await loadBmadHelp(projectRoot);
    expect(rows).toHaveLength(6);

    const meta = rows.find((r) => r.kind === 'meta');
    expect(meta?.skill).toBe('_meta');
    expect(meta?.required).toBe(false);

    const createPrd = rows.find((r) => r.skill === 'bmad-create-prd');
    expect(createPrd?.required).toBe(true);
    expect(createPrd?.outputs).toEqual(['prd']);
    expect(createPrd?.phase).toBe('2-planning');

    const validatePrd = rows.find((r) => r.skill === 'bmad-validate-prd');
    expect(validatePrd?.after).toEqual([{ skill: 'bmad-create-prd', action: null }]);
    expect(validatePrd?.args).toBe('[path]');

    const createStoryCreate = rows.find(
      (r) => r.skill === 'bmad-create-story' && r.action === 'create',
    );
    expect(createStoryCreate?.before).toEqual([
      { skill: 'bmad-create-story', action: 'validate' },
    ]);

    const createStoryValidate = rows.find(
      (r) => r.skill === 'bmad-create-story' && r.action === 'validate',
    );
    expect(createStoryValidate?.after).toEqual([
      { skill: 'bmad-create-story', action: 'create' },
    ]);
    expect(createStoryValidate?.before).toEqual([{ skill: 'bmad-dev-story', action: null }]);

    const documentProject = rows.find((r) => r.skill === 'bmad-document-project');
    expect(documentProject?.phase).toBe('anytime');
    expect(documentProject?.outputs).toEqual(['*']);
  });

  it('rejects rows with unknown phase', async () => {
    await writeConfigFile(
      projectRoot,
      'bmad-help.csv',
      `module,skill,display-name,menu-code,description,action,args,phase,after,before,required,output-location,outputs
BMad,bmad-foo,Foo,FF,,,,99-bogus,,,false,,
`,
    );
    await expect(loadBmadHelp(projectRoot)).rejects.toMatchObject({
      code: 'CSV_PARSE_ERROR',
    });
  });
});

describe('loadFilesManifest', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await makeProject();
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('returns [] when missing', async () => {
    expect(await loadFilesManifest(projectRoot)).toEqual([]);
  });

  it('parses a valid CSV', async () => {
    await writeConfigFile(projectRoot, 'files-manifest.csv', SAMPLE_FILES_MANIFEST_CSV);
    const entries = await loadFilesManifest(projectRoot);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ type: 'yaml', hash: 'abc123' });
  });
});

describe('loadAllManifests', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await makeProject();
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('throws PROJECT_NOT_BMAD when manifest.yaml missing', async () => {
    await expect(loadAllManifests(projectRoot)).rejects.toMatchObject({
      code: 'PROJECT_NOT_BMAD',
    });
  });

  it('aggregates all four files when present', async () => {
    await writeConfigFile(projectRoot, 'manifest.yaml', SAMPLE_MANIFEST_YAML);
    await writeConfigFile(projectRoot, 'skill-manifest.csv', SAMPLE_SKILL_MANIFEST_CSV);
    await writeConfigFile(projectRoot, 'bmad-help.csv', SAMPLE_BMAD_HELP_CSV);
    await writeConfigFile(projectRoot, 'files-manifest.csv', SAMPLE_FILES_MANIFEST_CSV);
    const bundle = await loadAllManifests(projectRoot);
    expect(bundle.manifest.modules).toHaveLength(2);
    expect(bundle.skills).toHaveLength(2);
    expect(bundle.help).toHaveLength(6);
    expect(bundle.files).toHaveLength(2);
  });
});

describe('parser internals', () => {
  it('parseDependencyList — empty', () => {
    expect(parseDependencyList('')).toEqual([]);
    expect(parseDependencyList('   ')).toEqual([]);
  });

  it('parseDependencyList — single skill no action', () => {
    expect(parseDependencyList('bmad-create-prd')).toEqual([
      { skill: 'bmad-create-prd', action: null },
    ]);
  });

  it('parseDependencyList — multiple', () => {
    expect(parseDependencyList('bmad-create-prd, bmad-validate-prd')).toEqual([
      { skill: 'bmad-create-prd', action: null },
      { skill: 'bmad-validate-prd', action: null },
    ]);
  });

  it('parseDependencyList — with action suffix', () => {
    expect(parseDependencyList('bmad-create-story:validate')).toEqual([
      { skill: 'bmad-create-story', action: 'validate' },
    ]);
  });

  it('parseBooleanLiteral — true / false / unknown', () => {
    expect(parseBooleanLiteral('true')).toBe(true);
    expect(parseBooleanLiteral('TRUE')).toBe(true);
    expect(parseBooleanLiteral('false')).toBe(false);
    expect(parseBooleanLiteral('')).toBe(false);
    expect(parseBooleanLiteral('1')).toBe(true);
    expect(parseBooleanLiteral('yes')).toBe(true);
    expect(parseBooleanLiteral('no')).toBe(false);
  });

  it('parsePipeList', () => {
    expect(parsePipeList('')).toEqual([]);
    expect(parsePipeList('a')).toEqual(['a']);
    expect(parsePipeList('a|b|c')).toEqual(['a', 'b', 'c']);
    expect(parsePipeList('a | b')).toEqual(['a', 'b']);
  });
});
