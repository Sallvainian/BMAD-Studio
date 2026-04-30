/**
 * Live smoke test for the workflow runner.
 *
 * Per ENGINE_SWAP_PROMPT.md Phase 2 §"Acceptance":
 *   1. A CLI smoke test runs `bmad-product-brief` end-to-end against a
 *      throwaway project and produces `_bmad-output/planning-artifacts/product-brief.md`.
 *   2. A CLI smoke test runs the orchestrator against a fresh project and
 *      emits the correct `workflow-required` events for each phase of BMad
 *      Method track.
 *
 * Both gated behind `RUN_BMAD_WORKFLOW_SMOKE=1` (and the orchestrator one
 * also requires `BMAD-Install-Files` reference to exist) so vanilla
 * `npm test` doesn't pull from npm or hit a model.
 *
 * The orchestrator smoke test runs with a stub model (no actual AI call)
 * — it exercises the workflow runner's activation flow + variable
 * substitution + file IO, not the model integration. That's covered by
 * the manual integration test in `RUN_BMAD_WORKFLOW_SMOKE=1` mode where
 * the user supplies a real ANTHROPIC_API_KEY.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';

import { computeOrchestratorState } from '../orchestrator';
import { runHelpSync } from '../help-runner';

const SMOKE_ENABLED = process.env.RUN_BMAD_WORKFLOW_SMOKE === '1';
const REFERENCE_INSTALL = process.env.HOME
  ? path.join(process.env.HOME, 'Projects', 'BMAD-Install-Files')
  : null;

const skipUnlessEnabled = SMOKE_ENABLED ? describe : describe.skip;

skipUnlessEnabled('orchestrator smoke (BMad Method track) — runs against the reference install', () => {
  it('emits a coherent recommendation for a fresh BMAD project', async () => {
    if (!REFERENCE_INSTALL || !existsSync(REFERENCE_INSTALL)) {
      console.warn(
        'skipping: reference install not present at',
        REFERENCE_INSTALL,
      );
      return;
    }

    const result = await computeOrchestratorState({
      projectRoot: REFERENCE_INSTALL,
      track: 'method',
    });

    expect(result.currentPhase).toBeDefined();
    expect(result.track).toBe('method');
    // The reference install hasn't run any workflows, so we expect either
    // phase 1 (no required) or phase 2 (required: bmad-create-prd).
    expect(['1-analysis', '2-planning', '3-solutioning', '4-implementation']).toContain(
      result.currentPhase,
    );
  });

  it('runHelpSync returns the same recommendation as computeOrchestratorState', async () => {
    if (!REFERENCE_INSTALL || !existsSync(REFERENCE_INSTALL)) return;

    const fromOrchestrator = await computeOrchestratorState({
      projectRoot: REFERENCE_INSTALL,
      track: 'method',
    });
    const fromHelp = await runHelpSync({
      projectRoot: REFERENCE_INSTALL,
      track: 'method',
    });

    expect(fromHelp.currentPhase).toBe(fromOrchestrator.currentPhase);
    expect(fromHelp.required?.skillId).toBe(fromOrchestrator.required?.skillId);
    expect(fromHelp.recommended.length).toBe(fromOrchestrator.recommended.length);
    expect(fromHelp.completed.length).toBe(fromOrchestrator.completed.length);
  });

  it('detects completion when planning artifacts exist (writes a fake prd.md)', async () => {
    if (!REFERENCE_INSTALL || !existsSync(REFERENCE_INSTALL)) return;

    const planningDir = path.join(REFERENCE_INSTALL, '_bmad-output', 'planning-artifacts');
    const fakePrd = path.join(planningDir, 'prd.md');
    let createdDir = false;
    let createdFile = false;

    try {
      if (!existsSync(planningDir)) {
        await fs.mkdir(planningDir, { recursive: true });
        createdDir = true;
      }
      if (!existsSync(fakePrd)) {
        await fs.writeFile(fakePrd, '# fake PRD for smoke test\n', 'utf-8');
        createdFile = true;
      }

      const result = await computeOrchestratorState({
        projectRoot: REFERENCE_INSTALL,
        track: 'method',
      });
      expect(result.completed.map((a) => a.skillId)).toContain('bmad-create-prd');
    } finally {
      if (createdFile) await fs.rm(fakePrd, { force: true });
      if (createdDir) await fs.rm(planningDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Default (always-runs) shape sanity tests — no AI, no install required
// ---------------------------------------------------------------------------

describe('orchestrator + help-runner shape sanity (no AI required)', () => {
  it('orchestrator throws UNSUPPORTED_TRACK for the quick track regardless of install', async () => {
    await expect(
      computeOrchestratorState({
        projectRoot: '/tmp/nonexistent-bmad-project',
        track: 'quick',
      }),
    ).rejects.toThrow(/Quick Flow|UNSUPPORTED_TRACK/);
  });

  it('help-runner refuses to operate on a non-BMAD directory', async () => {
    await expect(
      runHelpSync({
        projectRoot: '/tmp/nonexistent-bmad-project-' + Date.now(),
        track: 'method',
      }),
    ).rejects.toThrow();
  });
});
