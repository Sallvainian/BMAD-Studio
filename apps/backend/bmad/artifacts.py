"""
BMAD Artifact Management
========================

Create, save, and load BMAD artifacts (PRD, architecture, epics,
stories, etc.) within the Auto-Claude spec directory structure.
Includes a bridge function to convert BMAD stories into Auto-Claude's
implementation_plan.json format.
"""

import json
import logging
from datetime import datetime
from pathlib import Path

from .config import BMAD_ARTIFACTS_SUBDIR

logger = logging.getLogger(__name__)

# Recognized BMAD artifact types and their file names
ARTIFACT_FILES: dict[str, str] = {
    "product_brief": "product-brief.md",
    "prd": "prd.md",
    "ux_design": "ux-design.md",
    "architecture": "architecture.md",
    "epics": "epics.md",
    "stories": "stories.md",
    "sprint_plan": "sprint-plan.md",
    "readiness_report": "readiness-report.md",
}


def create_bmad_structure(spec_dir: Path) -> None:
    """Create the bmad/ subdirectory structure within a spec directory.

    Layout created::

        spec_dir/
        └── bmad/
            ├── planning/      # PRD, UX, architecture docs
            ├── stories/       # Individual story files
            └── reviews/       # Code review and QA artifacts

    Args:
        spec_dir: Path to the Auto-Claude spec directory
                  (e.g. .auto-claude/specs/001-feature/).
    """
    bmad_root = spec_dir / BMAD_ARTIFACTS_SUBDIR
    for subdir in ("planning", "stories", "reviews"):
        (bmad_root / subdir).mkdir(parents=True, exist_ok=True)

    logger.info("Created BMAD artifact structure at %s", bmad_root)


def save_artifact(spec_dir: Path, artifact_type: str, content: str) -> Path:
    """Save a BMAD artifact to the appropriate location.

    Args:
        spec_dir: Path to the Auto-Claude spec directory.
        artifact_type: One of the keys in ARTIFACT_FILES, or a custom
                       name (which will be used as-is with .md extension).
        content: Markdown content of the artifact.

    Returns:
        Path to the saved file.
    """
    bmad_root = spec_dir / BMAD_ARTIFACTS_SUBDIR

    # Determine subdirectory
    if artifact_type in ("product_brief", "prd", "ux_design", "architecture",
                         "readiness_report"):
        subdir = bmad_root / "planning"
    elif artifact_type in ("epics", "stories", "sprint_plan"):
        subdir = bmad_root / "stories"
    else:
        subdir = bmad_root / "reviews"

    subdir.mkdir(parents=True, exist_ok=True)

    filename = ARTIFACT_FILES.get(artifact_type, f"{artifact_type}.md")
    artifact_path = subdir / filename
    artifact_path.write_text(content, encoding="utf-8")

    logger.info("Saved BMAD artifact: %s -> %s", artifact_type, artifact_path)
    return artifact_path


def load_artifact(spec_dir: Path, artifact_type: str) -> str | None:
    """Load a BMAD artifact from the spec directory.

    Searches all bmad/ subdirectories for the artifact file.

    Args:
        spec_dir: Path to the Auto-Claude spec directory.
        artifact_type: Artifact type key or filename stem.

    Returns:
        File content as string, or None if not found.
    """
    bmad_root = spec_dir / BMAD_ARTIFACTS_SUBDIR
    filename = ARTIFACT_FILES.get(artifact_type, f"{artifact_type}.md")

    # Search across subdirectories
    for subdir in ("planning", "stories", "reviews", ""):
        candidate = bmad_root / subdir / filename if subdir else bmad_root / filename
        if candidate.exists():
            return candidate.read_text(encoding="utf-8")

    return None


def stories_to_implementation_plan(spec_dir: Path) -> dict:
    """Convert BMAD stories into Auto-Claude's implementation_plan.json format.

    Reads BMAD story artifacts and transforms them into the subtask
    structure expected by the Auto-Claude planner/coder pipeline.

    Auto-Claude implementation_plan.json structure::

        {
            "subtasks": [
                {
                    "id": "subtask-1",
                    "description": "...",
                    "service": "...",
                    "files_to_modify": [...],
                    "files_to_create": [...],
                    "patterns_from": [...],
                    "acceptance_criteria": [...]
                }
            ],
            "metadata": { ... }
        }

    Args:
        spec_dir: Path to the Auto-Claude spec directory.

    Returns:
        Dict in implementation_plan.json format. Empty subtasks list
        if no stories found.
    """
    bmad_root = spec_dir / BMAD_ARTIFACTS_SUBDIR
    stories_dir = bmad_root / "stories"

    subtasks: list[dict] = []
    task_index = 0

    # Try the consolidated stories file first
    stories_content = load_artifact(spec_dir, "stories")
    epics_content = load_artifact(spec_dir, "epics")

    source_content = stories_content or epics_content or ""

    if source_content:
        subtasks = _parse_stories_from_markdown(source_content, task_index)
        task_index += len(subtasks)

    # Also pick up individual story files from stories/ directory
    if stories_dir.is_dir():
        for story_file in sorted(stories_dir.glob("*.md")):
            if story_file.name in ARTIFACT_FILES.values():
                continue  # Skip consolidated files
            content = story_file.read_text(encoding="utf-8")
            parsed = _parse_stories_from_markdown(content, task_index)
            subtasks.extend(parsed)
            task_index += len(parsed)

    plan = {
        "subtasks": subtasks,
        "metadata": {
            "source": "bmad",
            "generated_at": datetime.now().isoformat(),
            "spec_dir": str(spec_dir),
        },
    }

    # Write to the standard location
    plan_path = spec_dir / "implementation_plan.json"
    plan_path.write_text(json.dumps(plan, indent=2), encoding="utf-8")
    logger.info("Generated implementation plan with %d subtasks at %s",
                len(subtasks), plan_path)

    return plan


def _parse_stories_from_markdown(content: str, start_index: int = 0) -> list[dict]:
    """Extract subtask entries from BMAD story markdown content.

    Looks for markdown headings and acceptance criteria patterns to
    build structured subtask entries. This is a best-effort parser
    that handles common BMAD story formats.
    """
    subtasks: list[dict] = []
    current_heading = ""
    current_body_lines: list[str] = []
    current_ac: list[str] = []
    in_ac_section = False

    def flush() -> None:
        nonlocal current_heading, current_body_lines, current_ac, in_ac_section
        if current_heading:
            idx = start_index + len(subtasks)
            subtasks.append({
                "id": f"bmad-{idx + 1:03d}",
                "description": current_heading.strip(),
                "details": "\n".join(current_body_lines).strip(),
                "service": "all",
                "files_to_modify": [],
                "files_to_create": [],
                "patterns_from": [],
                "acceptance_criteria": current_ac[:],
            })
        current_heading = ""
        current_body_lines = []
        current_ac = []
        in_ac_section = False

    for line in content.splitlines():
        stripped = line.strip()

        # Detect story-level headings (## or ### level)
        if stripped.startswith("## ") or stripped.startswith("### "):
            heading = stripped.lstrip("#").strip()
            # Skip non-story section headings
            if any(kw in heading.lower() for kw in
                   ("acceptance criteria", "tasks", "subtask", "notes",
                    "dependencies", "definition of done")):
                in_ac_section = "acceptance" in heading.lower()
                continue
            flush()
            current_heading = heading
            continue

        # Collect acceptance criteria
        if in_ac_section and stripped.startswith(("- ", "* ", "- [ ] ")):
            ac_text = stripped.lstrip("-*[] ").strip()
            if ac_text:
                current_ac.append(ac_text)
            continue

        # Detect inline acceptance criteria markers
        if stripped.lower().startswith("ac:") or stripped.lower().startswith("given "):
            current_ac.append(stripped)
            continue

        if current_heading:
            current_body_lines.append(line)

    flush()
    return subtasks
