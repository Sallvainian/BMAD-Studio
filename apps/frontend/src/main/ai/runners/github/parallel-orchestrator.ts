/**
 * Parallel Orchestrator PR Reviewer
 * ==================================
 *
 * PR reviewer using parallel specialist analysis via Promise.allSettled().
 * Ported from apps/backend/runners/github/services/parallel_orchestrator_reviewer.py.
 *
 * The orchestrator analyzes the PR and runs specialized agents (security,
 * quality, logic, codebase-fit) in parallel. Results are synthesized into
 * a final verdict.
 *
 * Key Design:
 * - Replaces SDK `agents={}` with Promise.allSettled() pattern
 * - Each specialist runs as its own generateText() call
 * - Uses createSimpleClient() for lightweight parallel sessions
 */

import { generateText } from 'ai';
import * as crypto from 'node:crypto';

import { createSimpleClient } from '../../client/factory';
import type { ModelShorthand, ThinkingLevel } from '../../config/types';
import type {
  PRContext,
  PRReviewFinding,
  ProgressCallback,
  ProgressUpdate,
} from './pr-review-engine';
import { ReviewCategory, ReviewSeverity } from './pr-review-engine';

// =============================================================================
// Types
// =============================================================================

/** Merge verdict for PR review. */
export const MergeVerdict = {
  READY_TO_MERGE: 'ready_to_merge',
  MERGE_WITH_CHANGES: 'merge_with_changes',
  NEEDS_REVISION: 'needs_revision',
  BLOCKED: 'blocked',
} as const;

export type MergeVerdict = (typeof MergeVerdict)[keyof typeof MergeVerdict];

/** Configuration for a specialist agent. */
interface SpecialistConfig {
  name: string;
  promptSuffix: string;
  description: string;
}

/** Result from parallel orchestrator review. */
export interface ParallelOrchestratorResult {
  findings: PRReviewFinding[];
  verdict: MergeVerdict;
  verdictReasoning: string;
  summary: string;
  blockers: string[];
  agentsInvoked: string[];
  reviewedCommitSha?: string;
}

/** Configuration for the parallel orchestrator. */
export interface ParallelOrchestratorConfig {
  repo: string;
  model?: ModelShorthand;
  thinkingLevel?: ThinkingLevel;
  fastMode?: boolean;
}

// =============================================================================
// Specialist Configurations
// =============================================================================

const SPECIALIST_CONFIGS: SpecialistConfig[] = [
  {
    name: 'security',
    promptSuffix:
      'Focus on security vulnerabilities: OWASP Top 10, authentication issues, injection, XSS, sensitive data exposure, cryptographic weaknesses.',
    description: 'Security vulnerabilities, OWASP Top 10, auth issues, injection, XSS',
  },
  {
    name: 'quality',
    promptSuffix:
      'Focus on code quality: complexity, duplication, error handling, maintainability, and pattern adherence.',
    description: 'Code quality, complexity, duplication, error handling, patterns',
  },
  {
    name: 'logic',
    promptSuffix:
      'Focus on logic correctness: edge cases, algorithm verification, state management, race conditions.',
    description: 'Logic correctness, edge cases, algorithms, race conditions',
  },
  {
    name: 'codebase-fit',
    promptSuffix:
      'Focus on codebase consistency: naming conventions, ecosystem fit, architectural alignment, avoiding reinvention of existing utilities.',
    description: 'Naming conventions, ecosystem fit, architectural alignment',
  },
];

// =============================================================================
// Severity / Category mapping
// =============================================================================

const SEVERITY_MAP: Record<string, PRReviewFinding['severity']> = {
  critical: ReviewSeverity.CRITICAL,
  high: ReviewSeverity.HIGH,
  medium: ReviewSeverity.MEDIUM,
  low: ReviewSeverity.LOW,
};

const CATEGORY_MAP: Record<string, PRReviewFinding['category']> = {
  security: ReviewCategory.SECURITY,
  quality: ReviewCategory.QUALITY,
  style: ReviewCategory.STYLE,
  test: ReviewCategory.TEST,
  docs: ReviewCategory.DOCS,
  pattern: ReviewCategory.PATTERN,
  performance: ReviewCategory.PERFORMANCE,
};

function mapSeverity(s: string): PRReviewFinding['severity'] {
  return SEVERITY_MAP[s.toLowerCase()] ?? ReviewSeverity.MEDIUM;
}

function mapCategory(c: string): PRReviewFinding['category'] {
  return CATEGORY_MAP[c.toLowerCase()] ?? ReviewCategory.QUALITY;
}

function generateFindingId(file: string, line: number, title: string): string {
  const hash = crypto
    .createHash('md5')
    .update(`${file}:${line}:${title}`)
    .digest('hex')
    .slice(0, 8)
    .toUpperCase();
  return `PR-${hash}`;
}

// =============================================================================
// Specialist prompt builder
// =============================================================================

function buildSpecialistPrompt(config: SpecialistConfig, context: PRContext): string {
  const filesList = context.changedFiles
    .map((f) => `- \`${f.path}\` (+${f.additions}/-${f.deletions}) - ${f.status}`)
    .join('\n');

  const patches = context.changedFiles
    .filter((f) => f.patch)
    .map((f) => `\n### File: ${f.path}\n${f.patch}`)
    .join('\n');

  const MAX_DIFF = 150_000;
  const diffContent =
    patches.length > MAX_DIFF
      ? `${patches.slice(0, MAX_DIFF)}\n\n... (diff truncated)`
      : patches;

  return `You are a senior ${config.name} specialist reviewing a pull request.

${config.promptSuffix}

## PR Context

**PR #${context.prNumber}**: ${context.title}

**Description:**
${context.description || '(No description provided)'}

### Changed Files (${context.changedFiles.length} files, +${context.totalAdditions}/-${context.totalDeletions})
${filesList}

### Diff
${diffContent}

## Output Format

Return ONLY valid JSON (no markdown fencing):

{
  "findings": [
    {
      "severity": "critical|high|medium|low",
      "category": "security|quality|style|test|docs|pattern|performance",
      "title": "Brief title",
      "description": "Detailed explanation",
      "file": "path/to/file",
      "line": 42,
      "end_line": 45,
      "suggested_fix": "Optional fix suggestion",
      "fixable": true,
      "evidence": "Code snippet or reasoning",
      "is_impact_finding": false
    }
  ],
  "summary": "Brief summary of specialist analysis"
}`;
}

// =============================================================================
// Parse specialist JSON
// =============================================================================

interface RawFinding {
  severity?: string;
  category?: string;
  title?: string;
  description?: string;
  file?: string;
  line?: number;
  end_line?: number;
  endLine?: number;
  suggested_fix?: string;
  suggestedFix?: string;
  fixable?: boolean;
  evidence?: string;
  is_impact_finding?: boolean;
}

function parseSpecialistOutput(
  name: string,
  text: string,
): PRReviewFinding[] {
  const findings: PRReviewFinding[] = [];

  // Try to extract JSON from response
  let jsonStr = text.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1];
  }

  try {
    const data = JSON.parse(jsonStr) as { findings?: RawFinding[] };
    if (!Array.isArray(data.findings)) return findings;

    for (const f of data.findings) {
      if (!f.title || !f.file) continue;
      const id = generateFindingId(f.file, f.line ?? 0, f.title);
      findings.push({
        id,
        severity: mapSeverity(f.severity ?? 'medium'),
        category: mapCategory(f.category ?? 'quality'),
        title: f.title,
        description: f.description ?? '',
        file: f.file,
        line: f.line ?? 0,
        endLine: f.end_line ?? f.endLine,
        suggestedFix: f.suggested_fix ?? f.suggestedFix,
        fixable: f.fixable ?? false,
        evidence: f.evidence,
      });
    }
  } catch {
    // Could not parse specialist output — return empty
  }

  return findings;
}

// =============================================================================
// Orchestrator prompt (synthesis)
// =============================================================================

function buildSynthesisPrompt(
  context: PRContext,
  specialistResults: Array<{ name: string; findings: PRReviewFinding[] }>,
): string {
  const findingsSummary = specialistResults
    .map(({ name, findings }) => {
      if (findings.length === 0) return `**${name}**: No issues found.`;
      const list = findings
        .map(
          (f) =>
            `  - [${f.severity.toUpperCase()}] ${f.title} (${f.file}:${f.line})`,
        )
        .join('\n');
      return `**${name}** (${findings.length} findings):\n${list}`;
    })
    .join('\n\n');

  return `You are a senior code review orchestrator synthesizing findings from specialist reviewers.

## PR Summary
**PR #${context.prNumber}**: ${context.title}
${context.description || '(No description)'}
Changes: +${context.totalAdditions}/-${context.totalDeletions} across ${context.changedFiles.length} files

## Specialist Findings
${findingsSummary}

## Your Task

Synthesize all specialist findings into a final verdict. Remove duplicates and false positives.

Return ONLY valid JSON (no markdown fencing):

{
  "verdict": "ready_to_merge|merge_with_changes|needs_revision|blocked",
  "verdict_reasoning": "Why this verdict",
  "summary": "Overall assessment",
  "kept_finding_ids": ["PR-ABC123"],
  "removed_finding_ids": ["PR-XYZ789"],
  "removal_reasons": { "PR-XYZ789": "False positive because..." }
}`;
}

// =============================================================================
// Main Reviewer Class
// =============================================================================

export class ParallelOrchestratorReviewer {
  private readonly config: ParallelOrchestratorConfig;
  private readonly progressCallback?: ProgressCallback;

  constructor(config: ParallelOrchestratorConfig, progressCallback?: ProgressCallback) {
    this.config = config;
    this.progressCallback = progressCallback;
  }

  private reportProgress(update: ProgressUpdate): void {
    this.progressCallback?.(update);
  }

  /**
   * Run the parallel orchestrator review.
   *
   * 1. Run all specialist agents in parallel via Promise.allSettled()
   * 2. Synthesize findings into a final verdict
   */
  async review(
    context: PRContext,
    abortSignal?: AbortSignal,
  ): Promise<ParallelOrchestratorResult> {
    this.reportProgress({
      phase: 'orchestrating',
      progress: 30,
      message: 'Starting parallel specialist analysis...',
      prNumber: context.prNumber,
    });

    const modelShorthand = this.config.model ?? 'sonnet';
    const thinkingLevel = this.config.thinkingLevel ?? 'medium';

    // 1. Run all specialists in parallel
    const specialistPromises = SPECIALIST_CONFIGS.map((spec) =>
      this.runSpecialist(spec, context, modelShorthand, thinkingLevel, abortSignal),
    );

    const settledResults = await Promise.allSettled(specialistPromises);
    const agentsInvoked: string[] = [];
    const specialistResults: Array<{ name: string; findings: PRReviewFinding[] }> = [];

    for (let i = 0; i < settledResults.length; i++) {
      const result = settledResults[i];
      const specName = SPECIALIST_CONFIGS[i].name;
      agentsInvoked.push(specName);

      if (result.status === 'fulfilled') {
        specialistResults.push(result.value);
      } else {
        specialistResults.push({ name: specName, findings: [] });
      }
    }

    this.reportProgress({
      phase: 'synthesizing',
      progress: 60,
      message: 'Synthesizing specialist findings...',
      prNumber: context.prNumber,
    });

    // 2. Collect all findings
    const allFindings = specialistResults.flatMap((r) => r.findings);

    // 3. Synthesize verdict
    const synthesisResult = await this.synthesizeFindings(
      context,
      specialistResults,
      allFindings,
      modelShorthand,
      thinkingLevel,
      abortSignal,
    );

    // 4. Deduplicate findings
    const uniqueFindings = this.deduplicateFindings(synthesisResult.keptFindings);

    // 5. Generate blockers
    const blockers: string[] = [];
    for (const finding of uniqueFindings) {
      if (
        finding.severity === ReviewSeverity.CRITICAL ||
        finding.severity === ReviewSeverity.HIGH ||
        finding.severity === ReviewSeverity.MEDIUM
      ) {
        blockers.push(`${finding.category}: ${finding.title}`);
      }
    }

    // 6. Generate summary
    const summary = this.generateSummary(
      synthesisResult.verdict,
      synthesisResult.verdictReasoning,
      blockers,
      uniqueFindings.length,
      agentsInvoked,
    );

    this.reportProgress({
      phase: 'complete',
      progress: 100,
      message: 'Review complete',
      prNumber: context.prNumber,
    });

    return {
      findings: uniqueFindings,
      verdict: synthesisResult.verdict,
      verdictReasoning: synthesisResult.verdictReasoning,
      summary,
      blockers,
      agentsInvoked,
    };
  }

  /**
   * Run a single specialist agent.
   */
  private async runSpecialist(
    config: SpecialistConfig,
    context: PRContext,
    modelShorthand: ModelShorthand,
    thinkingLevel: ThinkingLevel,
    abortSignal?: AbortSignal,
  ): Promise<{ name: string; findings: PRReviewFinding[] }> {
    const prompt = buildSpecialistPrompt(config, context);

    const client = createSimpleClient({
      systemPrompt: `You are a ${config.name} specialist for PR code review.`,
      modelShorthand,
      thinkingLevel,
    });

    try {
      const result = await generateText({
        model: client.model,
        system: client.systemPrompt,
        prompt,
        abortSignal,
      });

      const findings = parseSpecialistOutput(config.name, result.text);
      return { name: config.name, findings };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (abortSignal?.aborted) {
        return { name: config.name, findings: [] };
      }
      throw new Error(`Specialist ${config.name} failed: ${message}`);
    }
  }

  /**
   * Synthesize findings from all specialists into a final verdict.
   */
  private async synthesizeFindings(
    context: PRContext,
    specialistResults: Array<{ name: string; findings: PRReviewFinding[] }>,
    allFindings: PRReviewFinding[],
    modelShorthand: ModelShorthand,
    thinkingLevel: ThinkingLevel,
    abortSignal?: AbortSignal,
  ): Promise<{
    verdict: MergeVerdict;
    verdictReasoning: string;
    keptFindings: PRReviewFinding[];
  }> {
    // If no findings from any specialist, approve
    if (allFindings.length === 0) {
      return {
        verdict: MergeVerdict.READY_TO_MERGE,
        verdictReasoning: 'No issues found by any specialist reviewer.',
        keptFindings: [],
      };
    }

    const prompt = buildSynthesisPrompt(context, specialistResults);

    const client = createSimpleClient({
      systemPrompt: 'You are a senior code review orchestrator.',
      modelShorthand,
      thinkingLevel,
    });

    try {
      const result = await generateText({
        model: client.model,
        system: client.systemPrompt,
        prompt,
        abortSignal,
      });

      // Parse synthesis result
      let jsonStr = result.text.trim();
      const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (fenceMatch) {
        jsonStr = fenceMatch[1];
      }

      const data = JSON.parse(jsonStr) as {
        verdict?: string;
        verdict_reasoning?: string;
        kept_finding_ids?: string[];
        removed_finding_ids?: string[];
      };

      const verdictMap: Record<string, MergeVerdict> = {
        ready_to_merge: MergeVerdict.READY_TO_MERGE,
        merge_with_changes: MergeVerdict.MERGE_WITH_CHANGES,
        needs_revision: MergeVerdict.NEEDS_REVISION,
        blocked: MergeVerdict.BLOCKED,
      };

      const verdict = verdictMap[data.verdict ?? ''] ?? MergeVerdict.NEEDS_REVISION;
      const removedIds = new Set(data.removed_finding_ids ?? []);
      const keptFindings = allFindings.filter((f) => !removedIds.has(f.id));

      return {
        verdict,
        verdictReasoning: data.verdict_reasoning ?? '',
        keptFindings,
      };
    } catch {
      // Fallback: keep all findings, determine verdict from severity
      const hasCritical = allFindings.some(
        (f) => f.severity === ReviewSeverity.CRITICAL,
      );
      const hasHigh = allFindings.some(
        (f) => f.severity === ReviewSeverity.HIGH,
      );

      return {
        verdict: hasCritical
          ? MergeVerdict.BLOCKED
          : hasHigh
            ? MergeVerdict.NEEDS_REVISION
            : MergeVerdict.MERGE_WITH_CHANGES,
        verdictReasoning: 'Verdict determined from finding severity levels.',
        keptFindings: allFindings,
      };
    }
  }

  /**
   * Deduplicate findings by file + line + title.
   */
  private deduplicateFindings(findings: PRReviewFinding[]): PRReviewFinding[] {
    const seen = new Set<string>();
    const unique: PRReviewFinding[] = [];
    for (const f of findings) {
      const key = `${f.file}:${f.line}:${f.title.toLowerCase().trim()}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(f);
      }
    }
    return unique;
  }

  /**
   * Generate a human-readable summary.
   */
  private generateSummary(
    verdict: MergeVerdict,
    verdictReasoning: string,
    blockers: string[],
    findingCount: number,
    agentsInvoked: string[],
  ): string {
    const statusEmoji: Record<MergeVerdict, string> = {
      [MergeVerdict.READY_TO_MERGE]: '✅',
      [MergeVerdict.MERGE_WITH_CHANGES]: '🟡',
      [MergeVerdict.NEEDS_REVISION]: '🟠',
      [MergeVerdict.BLOCKED]: '🔴',
    };

    const emoji = statusEmoji[verdict] ?? '📝';
    const agentsStr = agentsInvoked.length > 0 ? agentsInvoked.join(', ') : 'none';

    const blockersSection =
      blockers.length > 0
        ? `\n### 🚨 Blocking Issues\n${blockers.map((b) => `- ${b}`).join('\n')}\n`
        : '';

    return `## ${emoji} Review: ${verdict.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}

### Verdict
${verdictReasoning}
${blockersSection}
### Summary
- **Findings**: ${findingCount} issue(s) found
- **Agents invoked**: ${agentsStr}

---
*AI-generated review using parallel specialist analysis.*
`;
  }
}
