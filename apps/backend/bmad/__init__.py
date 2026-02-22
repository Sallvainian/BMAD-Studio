"""
BMAD Integration Module
=======================

Integrates the BMAD Method (Big Method of AI-Driven Development) into
Auto-Claude's spec creation and implementation pipeline.

Main Components:
- config: Track selection, phase-to-agent mapping, directory paths
- personas: Load and format BMAD agent personas for prompt injection
- workflows: Load workflow definitions, instructions, checklists, templates
- artifacts: Manage BMAD artifact creation, storage, and plan conversion
"""

from .artifacts import (
    create_bmad_structure,
    load_artifact,
    save_artifact,
    stories_to_implementation_plan,
)
from .config import (
    BMAD_AGENTS_DIR,
    BMAD_ARTIFACTS_SUBDIR,
    BMAD_SOURCE_DIR,
    BMAD_WORKFLOWS_DIR,
    BMADTrack,
    PHASE_AGENT_MAP,
    PHASE_WORKFLOW_MAP,
    get_bmad_track,
)
from .personas import (
    format_persona_block,
    get_all_personas,
    load_persona,
)
from .workflows import (
    get_checklist,
    get_instructions,
    get_template,
    list_workflows,
    load_workflow,
)

__all__ = [
    # Config
    "BMADTrack",
    "get_bmad_track",
    "BMAD_AGENTS_DIR",
    "BMAD_SOURCE_DIR",
    "BMAD_WORKFLOWS_DIR",
    "BMAD_ARTIFACTS_SUBDIR",
    "PHASE_AGENT_MAP",
    "PHASE_WORKFLOW_MAP",
    # Personas
    "load_persona",
    "format_persona_block",
    "get_all_personas",
    # Workflows
    "load_workflow",
    "get_instructions",
    "get_checklist",
    "get_template",
    "list_workflows",
    # Artifacts
    "create_bmad_structure",
    "save_artifact",
    "load_artifact",
    "stories_to_implementation_plan",
]
