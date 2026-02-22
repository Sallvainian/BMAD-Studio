"""
BMAD Configuration
==================

Track selection, phase-to-agent mapping, and workflow path configuration
for the BMAD Method integration.
"""

from enum import Enum
from pathlib import Path


class BMADTrack(str, Enum):
    """BMAD methodology tracks mapped from Auto-Claude complexity tiers."""

    QUICK_FLOW = "quick_flow"  # Bug fixes, simple features
    BMAD_METHOD = "bmad_method"  # Products, platforms
    ENTERPRISE = "enterprise"  # Compliance, multi-tenant


def get_bmad_track(complexity: str) -> BMADTrack:
    """Map Auto-Claude complexity to BMAD track."""
    mapping = {
        "simple": BMADTrack.QUICK_FLOW,
        "standard": BMADTrack.BMAD_METHOD,
        "complex": BMADTrack.ENTERPRISE,
    }
    return mapping.get(complexity.lower(), BMADTrack.BMAD_METHOD)


# --- Directory layout ---

# BMAD source materials are copied into bmad/source/ within this package
# so the fork is self-contained and doesn't depend on the BMAD-METHOD repo.
_BMAD_PKG_DIR = Path(__file__).resolve().parent
BMAD_SOURCE_DIR = _BMAD_PKG_DIR / "source"

# Agent YAML definitions
BMAD_AGENTS_DIR = BMAD_SOURCE_DIR / "agents"

# Workflow root
BMAD_WORKFLOWS_DIR = BMAD_SOURCE_DIR / "workflows"

# Default artifact subdirectory name inside a spec directory
BMAD_ARTIFACTS_SUBDIR = "bmad"


# --- Phase-to-agent mapping ---
# Which BMAD agent persona handles each Auto-Claude + BMAD phase.
# Keys are phase names used in the spec pipeline; values are agent file stems
# (e.g. "pm" resolves to "pm.agent.yaml").

PHASE_AGENT_MAP: dict[str, str] = {
    # Analysis / discovery
    "product_brief": "analyst",
    "research": "analyst",
    # Planning
    "prd": "pm",
    "ux_design": "ux-designer",
    # Solutioning
    "architecture": "architect",
    "epics_stories": "pm",
    "implementation_readiness": "pm",
    # Implementation
    "sprint_planning": "sm",
    "create_story": "sm",
    "dev_story": "dev",
    "code_review": "dev",
    # QA
    "qa": "qa",
    # Quick flow (simple tasks)
    "quick_spec": "quick-flow-solo-dev",
    "quick_dev": "quick-flow-solo-dev",
}


# --- Phase-to-workflow mapping ---
# Maps phase names to (workflow_phase_dir, workflow_name) tuples so that
# workflows.load_workflow can find the correct directory.

PHASE_WORKFLOW_MAP: dict[str, tuple[str, str]] = {
    "product_brief": ("1-analysis", "create-product-brief"),
    "research": ("1-analysis", "research"),
    "prd": ("2-planning", "create-prd"),
    "ux_design": ("2-planning", "create-ux-design"),
    "architecture": ("3-solutioning", "create-architecture"),
    "epics_stories": ("3-solutioning", "create-epics-and-stories"),
    "implementation_readiness": ("3-solutioning", "check-implementation-readiness"),
    "sprint_planning": ("4-implementation", "sprint-planning"),
    "create_story": ("4-implementation", "create-story"),
    "dev_story": ("4-implementation", "dev-story"),
    "code_review": ("4-implementation", "code-review"),
    "quick_spec": ("quick-flow", "quick-spec"),
    "quick_dev": ("quick-flow", "quick-dev"),
}
