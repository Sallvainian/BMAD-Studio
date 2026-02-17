"""
BMAD Workflow Adapter
=====================

Load BMAD workflow YAML files, resolve file references (instructions,
checklists, templates), and extract their contents for use in the
Auto-Claude spec pipeline.
"""

import logging
from pathlib import Path

import yaml

from .config import BMAD_WORKFLOWS_DIR, PHASE_WORKFLOW_MAP

logger = logging.getLogger(__name__)


def load_workflow(phase: str, workflow_name: str | None = None,
                  workflows_dir: Path | None = None) -> dict:
    """Load a workflow definition and resolve its file references.

    Supports both YAML (.yaml) and Markdown (.md) workflow files.
    File reference keys (instructions, validation/checklist, template)
    are resolved to absolute paths so callers can read them directly.

    Args:
        phase: BMAD phase directory name (e.g. "4-implementation") or
               an Auto-Claude phase key from PHASE_WORKFLOW_MAP.
        workflow_name: Workflow subdirectory name. If *phase* is a key
                       in PHASE_WORKFLOW_MAP and workflow_name is None,
                       both values are resolved from the map.
        workflows_dir: Override root workflows directory.

    Returns:
        Dict with workflow metadata plus resolved paths:
        - "workflow_dir": Path to the workflow directory
        - "instructions_path": Path | None
        - "checklist_path": Path | None
        - "template_path": Path | None
        - Plus all raw keys from the YAML (if the file was YAML).

    Raises:
        FileNotFoundError: If the workflow directory does not exist.
    """
    base = workflows_dir or BMAD_WORKFLOWS_DIR

    # Resolve from the phase-workflow map if no explicit workflow_name
    if workflow_name is None and phase in PHASE_WORKFLOW_MAP:
        phase_dir, workflow_name = PHASE_WORKFLOW_MAP[phase]
    else:
        phase_dir = phase

    if workflow_name is None:
        raise ValueError(f"workflow_name required for unknown phase: {phase}")

    workflow_dir = base / phase_dir / workflow_name
    if not workflow_dir.is_dir():
        raise FileNotFoundError(f"BMAD workflow directory not found: {workflow_dir}")

    # Try loading workflow.yaml first, then workflow.md
    result: dict = {"workflow_dir": workflow_dir}
    yaml_file = workflow_dir / "workflow.yaml"
    md_file = workflow_dir / "workflow.md"

    if yaml_file.exists():
        raw = yaml_file.read_text(encoding="utf-8")
        parsed = yaml.safe_load(raw) or {}
        result.update(parsed)
    elif md_file.exists():
        # For markdown-based workflows, store the raw content
        result["workflow_content"] = md_file.read_text(encoding="utf-8")

    # Resolve well-known file references
    result["instructions_path"] = _resolve_ref(workflow_dir, result, "instructions")
    result["checklist_path"] = _resolve_ref(workflow_dir, result, "validation", "checklist")
    result["template_path"] = _resolve_ref(workflow_dir, result, "template")

    return result


def get_instructions(workflow: dict) -> str:
    """Read the instruction file referenced by a loaded workflow.

    Falls back to workflow_content for markdown-only workflows.
    """
    path = workflow.get("instructions_path")
    if path and path.exists():
        return path.read_text(encoding="utf-8")

    # For markdown workflows, the workflow.md itself is the instructions
    content = workflow.get("workflow_content")
    if content:
        return content

    return ""


def get_checklist(workflow: dict) -> str:
    """Read the checklist / validation file referenced by a loaded workflow."""
    path = workflow.get("checklist_path")
    if path and path.exists():
        return path.read_text(encoding="utf-8")
    return ""


def get_template(workflow: dict) -> str:
    """Read the template file referenced by a loaded workflow."""
    path = workflow.get("template_path")
    if path and path.exists():
        return path.read_text(encoding="utf-8")
    return ""


def list_workflows(phase: str, workflows_dir: Path | None = None) -> list[str]:
    """List available workflow names for a given phase directory.

    Args:
        phase: Phase directory name (e.g. "1-analysis", "4-implementation").
        workflows_dir: Override root workflows directory.

    Returns:
        Sorted list of workflow subdirectory names.
    """
    base = workflows_dir or BMAD_WORKFLOWS_DIR
    phase_dir = base / phase

    if not phase_dir.is_dir():
        logger.warning("BMAD phase directory not found: %s", phase_dir)
        return []

    return sorted(
        d.name
        for d in phase_dir.iterdir()
        if d.is_dir() and not d.name.startswith(".")
    )


def _resolve_ref(workflow_dir: Path, data: dict, *keys: str) -> Path | None:
    """Resolve a file reference from workflow data or by convention.

    Checks the YAML data for keys like "instructions", "validation",
    etc., and resolves the path relative to workflow_dir. Falls back
    to scanning the directory for common filenames.
    """
    # Check YAML keys
    for key in keys:
        ref = data.get(key)
        if ref and isinstance(ref, str):
            # Strip BMAD path variables (e.g. "{installed_path}/...")
            if "/" in ref:
                filename = ref.rsplit("/", 1)[-1]
            else:
                filename = ref
            candidate = workflow_dir / filename
            if candidate.exists():
                return candidate

    # Convention-based fallback
    convention_names = {
        "instructions": ["instructions.xml", "instructions.md"],
        "validation": ["checklist.md", "validation.md"],
        "checklist": ["checklist.md"],
        "template": ["template.md"],
    }

    for key in keys:
        for name in convention_names.get(key, []):
            candidate = workflow_dir / name
            if candidate.exists():
                return candidate

    # Also try pattern: <key>*.md or <key>*.xml
    for key in keys:
        for ext in (".md", ".xml"):
            matches = list(workflow_dir.glob(f"*{key}*{ext}"))
            if matches:
                return matches[0]

    return None
