/**
 * BMAD Workflows Reference
 *
 * Displays all BMAD Method workflows organized by phase/category.
 * Covers: BMAD Method (phases 1-4 + quick flow), Core Tools, and Test Architect module.
 */

import {
  ChevronDown,
  ChevronRight,
  Search,
  FileCheck,
  Code,
  Zap,
  FlaskConical,
  Lightbulb,
  BookOpen,
  GitBranch,
  BarChart3,
  Workflow
} from 'lucide-react';
import { useState } from 'react';
import { ScrollArea } from './ui/scroll-area';
import { useTranslation } from 'react-i18next';

interface WorkflowEntry {
  id: string;
  name: string;
  description: string;
  agent: string;
  phase: string;
}

interface WorkflowCategory {
  id: string;
  label: string;
  icon: React.ElementType;
  workflows: WorkflowEntry[];
}

const WORKFLOW_CATEGORIES: WorkflowCategory[] = [
  {
    id: 'analysis',
    label: 'Phase 1 — Analysis',
    icon: Search,
    workflows: [
      {
        id: 'create-product-brief',
        name: 'Create Product Brief',
        description: 'Define product vision, target users, success metrics, and project scope through structured discovery.',
        agent: 'Mary (Analyst)',
        phase: 'Analysis',
      },
      {
        id: 'research-market',
        name: 'Market Research',
        description: 'Analyze customer behavior, pain points, competitive landscape, and purchasing decisions.',
        agent: 'Mary (Analyst)',
        phase: 'Analysis',
      },
      {
        id: 'research-domain',
        name: 'Domain Research',
        description: 'Deep-dive domain analysis, regulatory focus, technical trends, and competitive landscape.',
        agent: 'Mary (Analyst)',
        phase: 'Analysis',
      },
      {
        id: 'research-technical',
        name: 'Technical Research',
        description: 'Technical overview, integration patterns, architectural patterns, and implementation feasibility.',
        agent: 'Mary (Analyst)',
        phase: 'Analysis',
      },
    ],
  },
  {
    id: 'planning',
    label: 'Phase 2 — Planning',
    icon: FileCheck,
    workflows: [
      {
        id: 'create-prd',
        name: 'Create PRD',
        description: 'Comprehensive product requirements document covering goals, user journeys, functional and non-functional requirements.',
        agent: 'John (PM)',
        phase: 'Planning',
      },
      {
        id: 'edit-prd',
        name: 'Edit PRD',
        description: 'Iterative editing and enhancement of an existing PRD with targeted discovery and revision.',
        agent: 'John (PM)',
        phase: 'Planning',
      },
      {
        id: 'validate-prd',
        name: 'Validate PRD',
        description: 'Validate PRD for density, measurability, traceability, and completeness before solutioning.',
        agent: 'John (PM)',
        phase: 'Planning',
      },
      {
        id: 'create-ux-design',
        name: 'Create UX Design',
        description: 'Define user experience, visual design direction, component strategy, and responsive/accessibility patterns.',
        agent: 'Sally (UX Designer)',
        phase: 'Planning',
      },
    ],
  },
  {
    id: 'solutioning',
    label: 'Phase 3 — Solutioning',
    icon: GitBranch,
    workflows: [
      {
        id: 'create-architecture',
        name: 'Create Architecture',
        description: 'System architecture decisions, technology choices, component structure, and scalability patterns.',
        agent: 'Winston (Architect)',
        phase: 'Solutioning',
      },
      {
        id: 'create-epics-stories',
        name: 'Create Epics & Stories',
        description: 'Decompose PRD into well-structured epics and user stories with acceptance criteria.',
        agent: 'Bob (Scrum Master)',
        phase: 'Solutioning',
      },
      {
        id: 'check-readiness',
        name: 'Check Implementation Readiness',
        description: 'Validate readiness across PRD completeness, architecture alignment, story coverage, and UX consistency.',
        agent: 'John (PM)',
        phase: 'Solutioning',
      },
    ],
  },
  {
    id: 'implementation',
    label: 'Phase 4 — Implementation',
    icon: Code,
    workflows: [
      {
        id: 'dev-story',
        name: 'Dev Story',
        description: 'Execute a development story with TDD discipline — implement, test, and validate against acceptance criteria.',
        agent: 'Amelia (Dev)',
        phase: 'Implementation',
      },
      {
        id: 'create-story',
        name: 'Create Story',
        description: 'Define a detailed development story with tasks, acceptance criteria, and technical context.',
        agent: 'Bob (Scrum Master)',
        phase: 'Implementation',
      },
      {
        id: 'code-review',
        name: 'Code Review',
        description: 'Systematic code quality review covering standards, security, performance, and maintainability.',
        agent: 'Quinn (QA)',
        phase: 'Implementation',
      },
      {
        id: 'sprint-planning',
        name: 'Sprint Planning',
        description: 'Plan and sequence stories into sprints with capacity consideration and dependency ordering.',
        agent: 'Bob (Scrum Master)',
        phase: 'Implementation',
      },
      {
        id: 'sprint-status',
        name: 'Sprint Status',
        description: 'Track and report sprint progress against goals, surfacing blockers and velocity data.',
        agent: 'Bob (Scrum Master)',
        phase: 'Implementation',
      },
      {
        id: 'correct-course',
        name: 'Correct Course',
        description: 'Address implementation blockers, misaligned assumptions, or scope drift during active development.',
        agent: 'Amelia (Dev)',
        phase: 'Implementation',
      },
      {
        id: 'retrospective',
        name: 'Retrospective',
        description: 'Structured sprint retrospective to surface what worked, what didn\'t, and concrete improvements.',
        agent: 'Bob (Scrum Master)',
        phase: 'Implementation',
      },
    ],
  },
  {
    id: 'quick-flow',
    label: 'Quick Flow',
    icon: Zap,
    workflows: [
      {
        id: 'quick-spec',
        name: 'Quick Spec',
        description: 'Rapid technical specification for simple, well-defined tasks — skips heavy BMAD ceremony.',
        agent: 'Barry (Solo Dev)',
        phase: 'Quick Flow',
      },
      {
        id: 'quick-dev',
        name: 'Quick Dev',
        description: 'Fast implementation for simple tasks with self-review and adversarial check built in.',
        agent: 'Barry (Solo Dev)',
        phase: 'Quick Flow',
      },
    ],
  },
  {
    id: 'utilities',
    label: 'Utilities',
    icon: BookOpen,
    workflows: [
      {
        id: 'document-project',
        name: 'Document Project',
        description: 'Comprehensive project documentation generation from existing codebase and artifacts.',
        agent: 'BMAD Team',
        phase: 'Utility',
      },
      {
        id: 'generate-context',
        name: 'Generate Project Context',
        description: 'AI-optimized project context file for injecting codebase knowledge into agent sessions.',
        agent: 'BMAD Team',
        phase: 'Utility',
      },
      {
        id: 'qa-automate',
        name: 'QA Automate',
        description: 'Generate comprehensive test automation suite from existing codebase and acceptance criteria.',
        agent: 'Quinn (QA)',
        phase: 'Utility',
      },
    ],
  },
  {
    id: 'core',
    label: 'Core Tools',
    icon: Lightbulb,
    workflows: [
      {
        id: 'advanced-elicitation',
        name: 'Advanced Elicitation',
        description: 'Deep structured requirements elicitation using multiple expert methods to surface hidden needs.',
        agent: 'Mary (Analyst)',
        phase: 'Core',
      },
      {
        id: 'brainstorming',
        name: 'Brainstorming',
        description: 'Multi-method creative brainstorming session with structured divergent and convergent thinking.',
        agent: 'BMAD Team',
        phase: 'Core',
      },
      {
        id: 'party-mode',
        name: 'Party Mode',
        description: 'Multi-agent collaborative planning — all BMAD personas engage simultaneously for holistic review.',
        agent: 'All Agents',
        phase: 'Core',
      },
    ],
  },
  {
    id: 'test-architect',
    label: 'Test Architect (TEA)',
    icon: FlaskConical,
    workflows: [
      {
        id: 'tea-framework',
        name: 'Framework Setup',
        description: 'Initialize production-ready test framework architecture (Playwright or Cypress) with fixtures, helpers, and config.',
        agent: 'Murat (Test Architect)',
        phase: 'Test Architect',
      },
      {
        id: 'tea-atdd',
        name: 'ATDD',
        description: 'Generate failing acceptance tests before implementation using TDD red-green-refactor cycle.',
        agent: 'Murat (Test Architect)',
        phase: 'Test Architect',
      },
      {
        id: 'tea-test-design',
        name: 'Test Design',
        description: 'System-level testability review (Solutioning) or epic-level test planning (Implementation) — auto-detects phase.',
        agent: 'Murat (Test Architect)',
        phase: 'Test Architect',
      },
      {
        id: 'tea-automate',
        name: 'Automate',
        description: 'Expand test automation coverage after implementation or analyze existing codebase to generate comprehensive test suite.',
        agent: 'Murat (Test Architect)',
        phase: 'Test Architect',
      },
      {
        id: 'tea-trace',
        name: 'Traceability',
        description: 'Generate requirements-to-tests traceability matrix, analyze coverage, and make quality gate decision (PASS/CONCERNS/FAIL).',
        agent: 'Murat (Test Architect)',
        phase: 'Test Architect',
      },
      {
        id: 'tea-nfr',
        name: 'NFR Assessment',
        description: 'Assess non-functional requirements — performance, security, reliability, maintainability — before release.',
        agent: 'Murat (Test Architect)',
        phase: 'Test Architect',
      },
      {
        id: 'tea-ci',
        name: 'CI/CD Pipeline',
        description: 'Scaffold CI/CD quality pipeline with test execution, burn-in loops, and artifact collection.',
        agent: 'Murat (Test Architect)',
        phase: 'Test Architect',
      },
      {
        id: 'tea-review',
        name: 'Test Review',
        description: 'Review test quality using comprehensive knowledge base and best practices validation.',
        agent: 'Murat (Test Architect)',
        phase: 'Test Architect',
      },
      {
        id: 'tea-teach',
        name: 'Teach Me Testing',
        description: 'Multi-session progressive learning companion that teaches testing through 7 structured sessions with state persistence.',
        agent: 'Murat (Test Architect)',
        phase: 'Test Architect',
      },
    ],
  },
];

const PHASE_COLORS: Record<string, string> = {
  'Analysis':        'bg-blue-500/15 text-blue-400 border-blue-500/20',
  'Planning':        'bg-purple-500/15 text-purple-400 border-purple-500/20',
  'Solutioning':     'bg-amber-500/15 text-amber-400 border-amber-500/20',
  'Implementation':  'bg-green-500/15 text-green-400 border-green-500/20',
  'Quick Flow':      'bg-cyan-500/15 text-cyan-400 border-cyan-500/20',
  'Utility':         'bg-slate-500/15 text-slate-400 border-slate-500/20',
  'Core':            'bg-orange-500/15 text-orange-400 border-orange-500/20',
  'Test Architect':  'bg-rose-500/15 text-rose-400 border-rose-500/20',
};

interface WorkflowCardProps {
  workflow: WorkflowEntry;
}

function WorkflowCard({ workflow }: WorkflowCardProps) {
  const phaseClass = PHASE_COLORS[workflow.phase] ?? 'bg-muted text-muted-foreground border-border';

  return (
    <div className="rounded-lg border border-border bg-card p-4 hover:border-border/80 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-foreground">{workflow.name}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${phaseClass}`}>
              {workflow.phase}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{workflow.description}</p>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <BarChart3 className="h-3 w-3 text-muted-foreground/50" />
        <span className="text-xs text-muted-foreground/70">{workflow.agent}</span>
      </div>
    </div>
  );
}

interface CategorySectionProps {
  category: WorkflowCategory;
  isExpanded: boolean;
  onToggle: () => void;
}

function CategorySection({ category, isExpanded, onToggle }: CategorySectionProps) {
  const Icon = category.icon;

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-1 py-2 rounded-md hover:bg-muted/50 transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        )}
        <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <span className="text-sm font-medium text-foreground">{category.label}</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {category.workflows.length} {category.workflows.length === 1 ? 'workflow' : 'workflows'}
        </span>
      </button>

      {isExpanded && (
        <div className="mt-2 grid grid-cols-1 gap-2 pl-6">
          {category.workflows.map((workflow) => (
            <WorkflowCard key={workflow.id} workflow={workflow} />
          ))}
        </div>
      )}
    </div>
  );
}

export function BMADWorkflows() {
  const { t } = useTranslation(['navigation']);

  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(['analysis', 'planning', 'solutioning', 'implementation'])
  );

  const toggleCategory = (id: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const totalWorkflows = WORKFLOW_CATEGORIES.reduce((sum, cat) => sum + cat.workflows.length, 0);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b border-border p-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-muted">
            <Workflow className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-semibold text-foreground">
              {t('navigation:items.bmadWorkflows')}
            </h1>
            <p className="text-sm text-muted-foreground">
              {totalWorkflows} workflows across BMAD Method, Core Tools, and Test Architect
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-6">
          {WORKFLOW_CATEGORIES.map((category) => (
            <CategorySection
              key={category.id}
              category={category}
              isExpanded={expandedCategories.has(category.id)}
              onToggle={() => toggleCategory(category.id)}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
