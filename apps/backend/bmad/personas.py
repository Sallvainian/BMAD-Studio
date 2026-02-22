"""
BMAD Persona Loader
====================

Load and parse BMAD agent YAML definitions into persona strings
suitable for prompt injection into Auto-Claude agent prompts.
"""

import logging
from pathlib import Path

import yaml

from .config import BMAD_AGENTS_DIR

logger = logging.getLogger(__name__)

# Agent files use the naming convention: <stem>.agent.yaml
_AGENT_SUFFIX = ".agent.yaml"


def load_persona(agent_name: str, agents_dir: Path | None = None) -> dict:
    """Load a specific BMAD agent YAML file and return parsed persona.

    Args:
        agent_name: Agent file stem (e.g. "pm", "dev", "architect").
        agents_dir: Override directory containing agent YAML files.
                    Defaults to BMAD_AGENTS_DIR from config.

    Returns:
        Dict with keys from the agent YAML: metadata, persona, and
        optionally critical_actions, menu, prompts.

    Raises:
        FileNotFoundError: If the agent YAML file does not exist.
        yaml.YAMLError: If the YAML is malformed.
    """
    base = agents_dir or BMAD_AGENTS_DIR
    agent_file = base / f"{agent_name}{_AGENT_SUFFIX}"

    if not agent_file.exists():
        raise FileNotFoundError(f"BMAD agent file not found: {agent_file}")

    raw = agent_file.read_text(encoding="utf-8")
    data = yaml.safe_load(raw)

    # The top-level key is "agent"
    agent_data = data.get("agent", data)
    return agent_data


def format_persona_block(persona: dict) -> str:
    """Format a parsed agent dict into a prompt-injectable text block.

    The output is a concise, structured block that can be prepended or
    appended to an agent system prompt.

    Args:
        persona: Dict returned by load_persona (the "agent" subtree).

    Returns:
        Formatted multi-line string ready for prompt injection.
    """
    metadata = persona.get("metadata", {})
    persona_data = persona.get("persona", {})

    name = metadata.get("name", "Unknown")
    title = metadata.get("title", "Agent")
    icon = metadata.get("icon", "")

    role = persona_data.get("role", "")
    identity = persona_data.get("identity", "")
    communication_style = persona_data.get("communication_style", "")
    principles = persona_data.get("principles", "")

    lines = [
        f"## BMAD Persona: {icon} {name} - {title}",
        "",
    ]

    if role:
        lines.append(f"**Role:** {role}")
    if identity:
        lines.append(f"**Identity:** {_clean_multiline(identity)}")
    if communication_style:
        lines.append(f"**Communication Style:** {_clean_multiline(communication_style)}")

    if principles:
        lines.append("")
        lines.append("**Principles:**")
        if isinstance(principles, list):
            for p in principles:
                lines.append(f"- {p}")
        else:
            lines.append(principles.rstrip())

    # Include critical_actions if present (e.g. dev agent)
    critical_actions = persona.get("critical_actions")
    if critical_actions and isinstance(critical_actions, list):
        lines.append("")
        lines.append("**Critical Actions:**")
        for action in critical_actions:
            lines.append(f"- {action}")

    return "\n".join(lines)


def get_all_personas(agents_dir: Path | None = None) -> dict[str, dict]:
    """Load all available BMAD personas.

    Args:
        agents_dir: Override directory containing agent YAML files.

    Returns:
        Dict mapping agent name stems to their parsed persona dicts.
    """
    base = agents_dir or BMAD_AGENTS_DIR
    personas: dict[str, dict] = {}

    if not base.is_dir():
        logger.warning("BMAD agents directory not found: %s", base)
        return personas

    for path in sorted(base.iterdir()):
        if path.name.endswith(_AGENT_SUFFIX):
            stem = path.name.removesuffix(_AGENT_SUFFIX)
            try:
                personas[stem] = load_persona(stem, agents_dir=base)
            except Exception:
                logger.warning("Failed to load BMAD persona: %s", path.name, exc_info=True)

    return personas


def _clean_multiline(text: object) -> str:
    """Collapse YAML multi-line strings into a single line where appropriate."""
    if not isinstance(text, str):
        return str(text)
    return " ".join(line.strip() for line in text.strip().splitlines() if line.strip())
