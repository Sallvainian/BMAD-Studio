/**
 * Vitest fixtures for the orchestrator.
 *
 * Coverage:
 *   - computeOrchestratorState computes correct currentPhase from completion map
 *   - Required action: first incomplete required workflow whose `after` deps
 *     are all complete
 *   - Recommended actions: optional workflows in current phase + anytime workflows
 *   - Persona ownership inference matches INVENTORY.md §4 mapping table
 *   - Quick Flow track throws UNSUPPORTED_TRACK (per D-005)
 *   - Phase 1 (analysis) has zero required workflows and is reported current
 *     until any later-phase workflow has started, then advances
 *   - File-existence detection picks up planning/implementation outputs
 *   - Emitter fires phase-progressed + workflow-required events
 */

import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __internals,
  computeOrchestratorState,
  createOrchestratorEmitter,
  OrchestratorError,
} from '../orchestrator';
import type {
  BmadHelpRow,
  BmadVariableContext,
  BmadWorkflowDescriptor,
} from '../../../../shared/types/bmad';

const {
  computeCurrentPhase,
  isWorkflowComplete,
  resolveLocationVariable,
  inferPersonaForWorkflow,
} = __internals;

// =============================================================================
// Helpers
// =============================================================================

async function makeProject(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'bmad-orchestrator-'));
}

async function writeFileEnsuringDir(filePath: string, contents: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, 'utf-8');
}

const MANIFEST_YAML = `
installation:
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
ides: [cursor]
`;

const CONFIG_TOML = `
[core]
project_name = "test"
output_folder = "{project-root}/_bmad-output"

[modules.bmm]
planning_artifacts = "{project-root}/_bmad-output/planning-artifacts"
implementation_artifacts = "{project-root}/_bmad-output/implementation-artifacts"
project_knowledge = "{project-root}/docs"
`;

const HELP_CSV =
  `module,skill,display-name,menu-code,description,action,args,phase,after,before,required,output-location,outputs
BMad Method,bmad-product-brief,Create Brief,CB,Brief,,,1-analysis,,,false,planning_artifacts,product brief
BMad Method,bmad-create-prd,Create PRD,CP,PRD,,,2-planning,,,true,planning_artifacts,prd
BMad Method,bmad-create-architecture,Create Architecture,CA,Arch,,,3-solutioning,,,true,planning_artifacts,architecture
BMad Method,bmad-create-epics-and-stories,Create Epics,CE,Epics,,,3-solutioning,bmad-create-architecture,,true,planning_artifacts,epics and stories
BMad Method,bmad-sprint-planning,Sprint Plan,SP,Sprint,,,4-implementation,,,true,implementation_artifacts,sprint status
BMad Method,bmad-help,Help,BH,Help,,,anytime,,,false,,
`;

const SKILL_MANIFEST_CSV =
  `canonicalId,name,description,module,path
bmad-product-brief,brief,brief,bmm,_bmad/bmm/1-analysis/bmad-product-brief/SKILL.md
bmad-create-prd,prd,prd,bmm,_bmad/bmm/2-plan/bmad-create-prd/SKILL.md
bmad-create-architecture,arch,arch,bmm,_bmad/bmm/3-sol/bmad-create-architecture/SKILL.md
bmad-create-epics-and-stories,epics,epics,bmm,_bmad/bmm/3-sol/bmad-create-epics-and-stories/SKILL.md
bmad-sprint-planning,sp,sp,bmm,_bmad/bmm/4-impl/bmad-sprint-planning/SKILL.md
bmad-help,help,help,core,_bmad/core/bmad-help/SKILL.md
`;

async function makeBmadProject(): Promise<string> {
  const root = await makeProject();
  await writeFileEnsuringDir(path.join(root, '_bmad', '_config', 'manifest.yaml'), MANIFEST_YAML);
  await writeFileEnsuringDir(path.join(root, '_bmad', '_config', 'skill-manifest.csv'), SKILL_MANIFEST_CSV);
  await writeFileEnsuringDir(path.join(root, '_bmad', '_config', 'bmad-help.csv'), HELP_CSV);
  await writeFileEnsuringDir(path.join(root, '_bmad', '_config', 'files-manifest.csv'), 'type,name,module,path,hash\n');
  await writeFileEnsuringDir(path.join(root, '_bmad', 'config.toml'), CONFIG_TOML);
  return root;
}

const SAMPLE_VARS: BmadVariableContext = {
  projectRoot: '/proj',
  skillRoot: '/proj/skill',
  skillName: 'skill',
  userName: '',
  communicationLanguage: 'English',
  documentOutputLanguage: 'English',
  planningArtifacts: '/proj/_bmad-output/planning-artifacts',
  implementationArtifacts: '/proj/_bmad-output/implementation-artifacts',
  projectKnowledge: '/proj/docs',
  outputFolder: '/proj/_bmad-output',
  date: '2026-04-30',
  projectName: 'p',
};

// =============================================================================
// inferPersonaForWorkflow
// =============================================================================

describe('inferPersonaForWorkflow', () => {
  it('maps planning workflows to John (per INVENTORY.md §4)', () => {
    expect(inferPersonaForWorkflow('bmad-create-prd')).toBe('john');
    expect(inferPersonaForWorkflow('bmad-validate-prd')).toBe('john');
    expect(inferPersonaForWorkflow('bmad-create-epics-and-stories')).toBe('john');
  });

  it('maps solutioning workflows to Winston', () => {
    expect(inferPersonaForWorkflow('bmad-create-architecture')).toBe('winston');
    expect(inferPersonaForWorkflow('bmad-generate-project-context')).toBe('winston');
  });

  it('maps implementation workflows to Amelia', () => {
    expect(inferPersonaForWorkflow('bmad-dev-story')).toBe('amelia');
    expect(inferPersonaForWorkflow('bmad-code-review')).toBe('amelia');
    expect(inferPersonaForWorkflow('bmad-quick-dev')).toBe('amelia');
  });

  it('maps analysis workflows to Mary', () => {
    expect(inferPersonaForWorkflow('bmad-product-brief')).toBe('mary');
    expect(inferPersonaForWorkflow('bmad-domain-research')).toBe('mary');
  });

  it('returns null for non-persona-owned workflows like bmad-help', () => {
    expect(inferPersonaForWorkflow('bmad-help')).toBeNull();
    expect(inferPersonaForWorkflow('bmad-customize')).toBeNull();
  });
});

// =============================================================================
// resolveLocationVariable
// =============================================================================

describe('resolveLocationVariable', () => {
  it('maps planning_artifacts to the resolved path', () => {
    expect(resolveLocationVariable('planning_artifacts', SAMPLE_VARS)).toBe(
      '/proj/_bmad-output/planning-artifacts',
    );
  });

  it('handles dashed variant `planning-artifacts`', () => {
    expect(resolveLocationVariable('planning-artifacts', SAMPLE_VARS)).toBe(
      '/proj/_bmad-output/planning-artifacts',
    );
  });

  it('returns null for empty input', () => {
    expect(resolveLocationVariable('', SAMPLE_VARS)).toBeNull();
  });

  it('returns null for URLs (e.g. _meta rows)', () => {
    expect(resolveLocationVariable('https://docs.bmad-method.org/llms.txt', SAMPLE_VARS)).toBeNull();
  });
});

// =============================================================================
// computeCurrentPhase
// =============================================================================

describe('computeCurrentPhase', () => {
  it('reports 1-analysis when phase 1 has no required and no later phase has started', () => {
    const graph = {
      slices: [
        { phase: '1-analysis' as const, requiredWorkflows: [], optionalWorkflows: [] },
        { phase: '2-planning' as const, requiredWorkflows: [makeWf('bmad-create-prd', '2-planning', true)], optionalWorkflows: [] },
        { phase: '3-solutioning' as const, requiredWorkflows: [], optionalWorkflows: [] },
        { phase: '4-implementation' as const, requiredWorkflows: [], optionalWorkflows: [] },
      ],
      anytimeWorkflows: [],
    };
    const completion = new Map<string, boolean>();
    expect(computeCurrentPhase(graph, completion)).toBe('1-analysis');
  });

  it('advances past phase 1 (zero required) when a later-phase workflow has actually completed', () => {
    // Phase 1 is empty (no required). The orchestrator stays in phase 1
    // until at least one later-phase workflow is marked complete — that's
    // the signal the project has moved on. Marking bmad-create-prd
    // complete advances us into phase 2 (which is now also satisfied since
    // its only required workflow is done) and on to 3-solutioning.
    const graph = {
      slices: [
        { phase: '1-analysis' as const, requiredWorkflows: [], optionalWorkflows: [] },
        { phase: '2-planning' as const, requiredWorkflows: [makeWf('bmad-create-prd', '2-planning', true)], optionalWorkflows: [] },
        { phase: '3-solutioning' as const, requiredWorkflows: [makeWf('bmad-create-architecture', '3-solutioning', true)], optionalWorkflows: [] },
        { phase: '4-implementation' as const, requiredWorkflows: [], optionalWorkflows: [] },
      ],
      anytimeWorkflows: [],
    };
    const completion = new Map<string, boolean>([
      ['bmad-create-prd::', true],
    ]);
    expect(computeCurrentPhase(graph, completion)).toBe('3-solutioning');
  });

  it('stays in phase 1 when phase 1 is empty and no later-phase workflow has started', () => {
    const graph = {
      slices: [
        { phase: '1-analysis' as const, requiredWorkflows: [], optionalWorkflows: [] },
        { phase: '2-planning' as const, requiredWorkflows: [makeWf('bmad-create-prd', '2-planning', true)], optionalWorkflows: [] },
        { phase: '3-solutioning' as const, requiredWorkflows: [], optionalWorkflows: [] },
        { phase: '4-implementation' as const, requiredWorkflows: [], optionalWorkflows: [] },
      ],
      anytimeWorkflows: [],
    };
    const completion = new Map<string, boolean>();
    expect(computeCurrentPhase(graph, completion)).toBe('1-analysis');
  });

  it('reports 4-implementation when every phase is complete', () => {
    const graph = {
      slices: [
        { phase: '1-analysis' as const, requiredWorkflows: [], optionalWorkflows: [] },
        { phase: '2-planning' as const, requiredWorkflows: [makeWf('bmad-create-prd', '2-planning', true)], optionalWorkflows: [] },
        { phase: '3-solutioning' as const, requiredWorkflows: [makeWf('bmad-create-architecture', '3-solutioning', true)], optionalWorkflows: [] },
        { phase: '4-implementation' as const, requiredWorkflows: [makeWf('bmad-sprint-planning', '4-implementation', true)], optionalWorkflows: [] },
      ],
      anytimeWorkflows: [],
    };
    const completion = new Map<string, boolean>([
      ['bmad-create-prd::', true],
      ['bmad-create-architecture::', true],
      ['bmad-sprint-planning::', true],
    ]);
    expect(computeCurrentPhase(graph, completion)).toBe('4-implementation');
  });
});

function makeWf(
  skillId: string,
  phase: BmadWorkflowDescriptor['phase'],
  required: boolean,
): BmadWorkflowDescriptor {
  return {
    skillId,
    module: 'bmm',
    displayName: skillId,
    description: '',
    menuCode: '',
    action: '',
    args: '',
    phase,
    required,
    after: [],
    before: [],
    outputLocation: 'planning_artifacts',
    outputs: [],
    skillPath: '',
  };
}

// =============================================================================
// isWorkflowComplete — file-existence detection
// =============================================================================

describe('isWorkflowComplete', () => {
  let projectRoot: string;
  let vars: BmadVariableContext;

  beforeEach(async () => {
    projectRoot = await makeProject();
    const planning = path.join(projectRoot, '_bmad-output', 'planning-artifacts');
    await mkdir(planning, { recursive: true });
    vars = {
      ...SAMPLE_VARS,
      projectRoot: projectRoot,
      planningArtifacts: planning,
      implementationArtifacts: path.join(projectRoot, '_bmad-output', 'implementation-artifacts'),
    };
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('returns false when outputs is empty', async () => {
    const wf = { ...makeWf('x', '2-planning', true), outputs: [] };
    expect(await isWorkflowComplete(wf, vars)).toBe(false);
  });

  it('returns false when output-location is empty', async () => {
    const wf = { ...makeWf('x', '2-planning', true), outputs: ['prd'], outputLocation: '' };
    expect(await isWorkflowComplete(wf, vars)).toBe(false);
  });

  it('returns true when an output filename is found via loose match', async () => {
    await writeFile(path.join(vars.planningArtifacts, 'prd.md'), '# PRD\n', 'utf-8');
    const wf = { ...makeWf('bmad-create-prd', '2-planning', true), outputs: ['prd'] };
    expect(await isWorkflowComplete(wf, vars)).toBe(true);
  });

  it('returns true for the catch-all `*` outputs (e.g. bmad-document-project)', async () => {
    await writeFile(path.join(vars.planningArtifacts, 'anything.md'), '# anything\n', 'utf-8');
    const wf = { ...makeWf('bmad-document-project', 'anytime', false), outputs: ['*'] };
    expect(await isWorkflowComplete(wf, vars)).toBe(true);
  });

  it('returns false when the output directory has no matching file', async () => {
    const wf = { ...makeWf('bmad-create-prd', '2-planning', true), outputs: ['prd'] };
    expect(await isWorkflowComplete(wf, vars)).toBe(false);
  });
});

// =============================================================================
// computeOrchestratorState — integration
// =============================================================================

describe('computeOrchestratorState — integration', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await makeBmadProject();
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('reports phase 1 as current when nothing has been produced', async () => {
    const result = await computeOrchestratorState({ projectRoot, track: 'method' });
    expect(result.currentPhase).toBe('1-analysis');
    expect(result.required).toBeNull();
    // Optional analysis workflow + bmad-help should appear in recommendations.
    expect(result.recommended.map((a) => a.skillId)).toContain('bmad-product-brief');
    expect(result.recommended.map((a) => a.skillId)).toContain('bmad-help');
  });

  it('advances to phase 2 once a planning artifact exists', async () => {
    const planningDir = path.join(projectRoot, '_bmad-output', 'planning-artifacts');
    await mkdir(planningDir, { recursive: true });
    await writeFile(path.join(planningDir, 'prd.md'), '# PRD\n', 'utf-8');

    const result = await computeOrchestratorState({ projectRoot, track: 'method' });
    // PRD exists → phase 2 required is satisfied → current phase advances.
    expect(['2-planning', '3-solutioning']).toContain(result.currentPhase);
    expect(result.completed.map((a) => a.skillId)).toContain('bmad-create-prd');
  });

  it('throws UNSUPPORTED_TRACK for the quick track (per D-005)', async () => {
    await expect(
      computeOrchestratorState({ projectRoot, track: 'quick' }),
    ).rejects.toThrow(OrchestratorError);
  });

  it('throws PROJECT_NOT_BMAD when the project lacks _bmad/_config/manifest.yaml', async () => {
    const empty = await makeProject();
    try {
      await expect(
        computeOrchestratorState({ projectRoot: empty, track: 'method' }),
      ).rejects.toThrow(/PROJECT_NOT_BMAD|not a BMAD project/);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it('attaches persona ownership to the required + recommended actions', async () => {
    const result = await computeOrchestratorState({ projectRoot, track: 'method' });
    const briefAction = result.recommended.find((a) => a.skillId === 'bmad-product-brief');
    expect(briefAction?.persona).toBe('mary');
    const helpAction = result.recommended.find((a) => a.skillId === 'bmad-help');
    expect(helpAction?.persona).toBeNull();
  });
});

// =============================================================================
// Event emitter integration
// =============================================================================

describe('createOrchestratorEmitter — events', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await makeBmadProject();
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('fires phase-progressed + workflow-recommended events', async () => {
    const emitter = createOrchestratorEmitter();
    const phaseProgressed = vi.fn();
    const workflowRecommended = vi.fn();
    emitter.on('phase-progressed', phaseProgressed);
    emitter.on('workflow-recommended', workflowRecommended);

    await computeOrchestratorState({ projectRoot, track: 'method', emitter });
    expect(phaseProgressed).toHaveBeenCalledTimes(1);
    expect(workflowRecommended.mock.calls.length).toBeGreaterThan(0);
  });
});
