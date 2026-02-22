"""
BMAD Phase Implementations
============================

Phase methods for BMAD-enhanced spec creation pipeline.
These phases inject BMAD personas, workflows, and artifact management
into the existing Auto-Claude spec pipeline.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

from .models import MAX_RETRIES, PhaseResult

if TYPE_CHECKING:
    from collections.abc import Callable


class BMADPhaseMixin:
    """Mixin for BMAD-specific phase methods.

    Provides composite phases that map to BMAD methodology stages:

    Legacy phases (kept for backward compatibility):
    - bmad_analysis: Product brief creation using the Analyst persona
    - bmad_planning: PRD and UX design using PM and UX Designer personas
    - bmad_solutioning: Architecture and epics using Architect and PM personas

    New granular phases:
    - bmad_prd_writing: PRD creation using PM persona (John)
    - bmad_architecture: Architecture review using Architect persona (Winston)
    - bmad_story_planning: Story decomposition using SM persona (Bob)
    - bmad_quick_spec: Quick flow spec using Solo Dev persona (Barry)

    Attributes are provided by PhaseExecutor when mixed in.
    """

    spec_dir: Path
    task_description: str
    run_agent_fn: Callable[..., Any]
    ui: Any

    async def phase_bmad_analysis(self) -> PhaseResult:
        """BMAD Analysis phase: create product brief using Analyst persona.

        Loads the BMAD Analyst persona and the product-brief workflow,
        then runs the spec_gatherer prompt enhanced with BMAD context.
        """
        from bmad.artifacts import create_bmad_structure, save_artifact
        from bmad.config import PHASE_AGENT_MAP
        from bmad.personas import format_persona_block, load_persona
        from bmad.workflows import get_instructions, load_workflow

        brief_file = self.spec_dir / "bmad" / "planning" / "product-brief.md"

        if brief_file.exists():
            self.ui.print_status("BMAD product brief already exists", "success")
            return PhaseResult("bmad_analysis", True, [str(brief_file)], [], 0)

        # Ensure BMAD structure exists
        create_bmad_structure(self.spec_dir)

        # Load persona and workflow
        agent_name = PHASE_AGENT_MAP.get("product_brief", "analyst")
        try:
            persona = load_persona(agent_name)
            persona_block = format_persona_block(persona)
        except FileNotFoundError:
            persona_block = ""

        try:
            workflow = load_workflow("product_brief")
            instructions = get_instructions(workflow)
        except FileNotFoundError:
            instructions = ""

        errors = []
        for attempt in range(MAX_RETRIES):
            self.ui.print_status(
                f"Running BMAD analysis (attempt {attempt + 1})...", "progress"
            )

            context_str = f"""
{persona_block}

## BMAD Product Brief Workflow

{instructions[:3000] if instructions else "Create a concise product brief for this task."}

**Task**: {self.task_description}
**Spec Directory**: {self.spec_dir}
**Output**: Write the product brief to {brief_file}

Focus on: problem definition, target users, success metrics, and scope boundaries.
"""
            success, output = await self.run_agent_fn(
                "spec_gatherer.md",
                additional_context=context_str,
                phase_name="bmad_analysis",
            )

            if success:
                # Save as BMAD artifact if the agent wrote content
                if brief_file.exists():
                    self.ui.print_status("BMAD product brief created", "success")
                    return PhaseResult(
                        "bmad_analysis", True, [str(brief_file)], [], attempt
                    )

                # Agent may have written to a different location - check spec.md
                spec_file = self.spec_dir / "spec.md"
                if spec_file.exists():
                    content = spec_file.read_text(encoding="utf-8")
                    save_artifact(self.spec_dir, "product_brief", content)
                    self.ui.print_status(
                        "BMAD product brief saved from spec output", "success"
                    )
                    return PhaseResult(
                        "bmad_analysis", True, [str(brief_file)], [], attempt
                    )

            errors.append(f"Attempt {attempt + 1}: BMAD analysis agent failed")

        return PhaseResult("bmad_analysis", False, [], errors, MAX_RETRIES)

    async def phase_bmad_planning(self) -> PhaseResult:
        """BMAD Planning phase: PRD creation using PM persona.

        Creates a BMAD-style PRD by injecting the PM persona and the
        PRD creation workflow into the spec writing phase.
        """
        from bmad.artifacts import save_artifact
        from bmad.config import PHASE_AGENT_MAP
        from bmad.personas import format_persona_block, load_persona
        from bmad.workflows import get_checklist, get_instructions, load_workflow

        prd_file = self.spec_dir / "bmad" / "planning" / "prd.md"

        if prd_file.exists():
            self.ui.print_status("BMAD PRD already exists", "success")
            return PhaseResult("bmad_planning", True, [str(prd_file)], [], 0)

        # Load PM persona and PRD workflow
        agent_name = PHASE_AGENT_MAP.get("prd", "pm")
        try:
            persona = load_persona(agent_name)
            persona_block = format_persona_block(persona)
        except FileNotFoundError:
            persona_block = ""

        try:
            workflow = load_workflow("prd")
            instructions = get_instructions(workflow)
            checklist = get_checklist(workflow)
        except FileNotFoundError:
            instructions = ""
            checklist = ""

        # Load product brief if available
        brief_path = self.spec_dir / "bmad" / "planning" / "product-brief.md"
        brief_content = ""
        if brief_path.exists():
            brief_content = brief_path.read_text(encoding="utf-8")

        errors = []
        for attempt in range(MAX_RETRIES):
            self.ui.print_status(
                f"Running BMAD PRD creation (attempt {attempt + 1})...", "progress"
            )

            context_str = f"""
{persona_block}

## BMAD PRD Creation Workflow

{instructions[:3000] if instructions else "Create a comprehensive PRD."}

{f"## Product Brief (input)\\n\\n{brief_content[:2000]}" if brief_content else ""}

{f"## Validation Checklist\\n\\n{checklist[:1500]}" if checklist else ""}

**Task**: {self.task_description}
**Spec Directory**: {self.spec_dir}
**Output**: Write the PRD as spec.md in {self.spec_dir} AND save to {prd_file}

The PRD should cover: vision, user journeys, functional requirements,
non-functional requirements, success metrics, and scope.
"""
            success, output = await self.run_agent_fn(
                "spec_writer.md",
                additional_context=context_str,
                phase_name="bmad_planning",
            )

            if success:
                # Check if spec.md was created (the standard output)
                spec_file = self.spec_dir / "spec.md"
                if spec_file.exists():
                    content = spec_file.read_text(encoding="utf-8")
                    save_artifact(self.spec_dir, "prd", content)
                    self.ui.print_status("BMAD PRD created", "success")
                    return PhaseResult(
                        "bmad_planning", True, [str(spec_file), str(prd_file)], [],
                        attempt,
                    )

            errors.append(f"Attempt {attempt + 1}: BMAD PRD agent failed")

        return PhaseResult("bmad_planning", False, [], errors, MAX_RETRIES)

    async def phase_bmad_solutioning(self) -> PhaseResult:
        """BMAD Solutioning phase: architecture and epics using Architect persona.

        Creates architecture decisions and epic/story breakdown, then converts
        BMAD stories into Auto-Claude's implementation_plan.json format.
        """
        from bmad.artifacts import save_artifact, stories_to_implementation_plan
        from bmad.config import PHASE_AGENT_MAP
        from bmad.personas import format_persona_block, load_persona
        from bmad.workflows import get_instructions, load_workflow

        arch_file = self.spec_dir / "bmad" / "planning" / "architecture.md"
        plan_file = self.spec_dir / "implementation_plan.json"

        if arch_file.exists() and plan_file.exists():
            self.ui.print_status(
                "BMAD architecture and plan already exist", "success"
            )
            return PhaseResult(
                "bmad_solutioning", True,
                [str(arch_file), str(plan_file)], [], 0,
            )

        # Load Architect persona and architecture workflow
        agent_name = PHASE_AGENT_MAP.get("architecture", "architect")
        try:
            persona = load_persona(agent_name)
            persona_block = format_persona_block(persona)
        except FileNotFoundError:
            persona_block = ""

        try:
            workflow = load_workflow("architecture")
            instructions = get_instructions(workflow)
        except FileNotFoundError:
            instructions = ""

        # Load PRD/spec for context
        spec_file = self.spec_dir / "spec.md"
        spec_content = ""
        if spec_file.exists():
            spec_content = spec_file.read_text(encoding="utf-8")

        errors = []
        for attempt in range(MAX_RETRIES):
            self.ui.print_status(
                f"Running BMAD solutioning (attempt {attempt + 1})...", "progress"
            )

            context_str = f"""
{persona_block}

## BMAD Architecture Workflow

{instructions[:3000] if instructions else "Create architecture decisions and implementation stories."}

{f"## PRD / Spec (input)\\n\\n{spec_content[:3000]}" if spec_content else ""}

**Task**: {self.task_description}
**Spec Directory**: {self.spec_dir}

Create TWO outputs:
1. Architecture document at {arch_file} covering:
   - Technology decisions with rationale
   - Component structure
   - Data flow and integration points
   - Key constraints and trade-offs

2. Implementation plan at {plan_file} as JSON with subtasks.
   Each subtask needs: id, description, service, files_to_modify,
   files_to_create, patterns_from, acceptance_criteria.
"""
            success, output = await self.run_agent_fn(
                "planner.md",
                additional_context=context_str,
                phase_name="bmad_solutioning",
            )

            if success:
                # Save architecture artifact if created
                if arch_file.exists():
                    pass  # Already in the right place
                elif spec_file.exists():
                    # Extract architecture section from planner output
                    pass

                # If plan was created, save architecture artifact too
                if plan_file.exists():
                    self.ui.print_status(
                        "BMAD architecture and plan created", "success"
                    )
                    return PhaseResult(
                        "bmad_solutioning", True,
                        [str(arch_file), str(plan_file)], [], attempt,
                    )

                # Try converting BMAD stories to implementation plan
                epics_file = self.spec_dir / "bmad" / "stories" / "epics.md"
                if epics_file.exists():
                    stories_to_implementation_plan(self.spec_dir)
                    if plan_file.exists():
                        self.ui.print_status(
                            "Converted BMAD stories to implementation plan", "success"
                        )
                        return PhaseResult(
                            "bmad_solutioning", True,
                            [str(plan_file)], [], attempt,
                        )

            errors.append(f"Attempt {attempt + 1}: BMAD solutioning agent failed")

        return PhaseResult("bmad_solutioning", False, [], errors, MAX_RETRIES)

    # ------------------------------------------------------------------
    # New granular BMAD phases
    # ------------------------------------------------------------------

    async def phase_bmad_prd_writing(self) -> PhaseResult:
        """BMAD PRD Writing: focused PRD creation using PM persona (John).

        Similar to bmad_planning but named for the new granular phase scheme.
        Creates a BMAD-style PRD by injecting the PM persona and the
        PRD creation workflow into the spec writer prompt.
        """
        from bmad.artifacts import create_bmad_structure, save_artifact
        from bmad.config import PHASE_AGENT_MAP
        from bmad.personas import format_persona_block, load_persona
        from bmad.workflows import get_checklist, get_instructions, load_workflow

        prd_file = self.spec_dir / "bmad" / "planning" / "prd.md"

        if prd_file.exists():
            self.ui.print_status("BMAD PRD already exists", "success")
            return PhaseResult("bmad_prd_writing", True, [str(prd_file)], [], 0)

        create_bmad_structure(self.spec_dir)

        # Load PM persona (John) and PRD workflow
        agent_name = PHASE_AGENT_MAP.get("prd", "pm")
        try:
            persona = load_persona(agent_name)
            persona_block = format_persona_block(persona)
        except FileNotFoundError:
            persona_block = ""

        try:
            workflow = load_workflow("prd")
            instructions = get_instructions(workflow)
            checklist = get_checklist(workflow)
        except FileNotFoundError:
            instructions = ""
            checklist = ""

        # Load prior artifacts for context
        brief_path = self.spec_dir / "bmad" / "planning" / "product-brief.md"
        brief_content = ""
        if brief_path.exists():
            brief_content = brief_path.read_text(encoding="utf-8")

        errors: list[str] = []
        for attempt in range(MAX_RETRIES):
            self.ui.print_status(
                f"Running BMAD PRD writing (attempt {attempt + 1})...", "progress"
            )

            context_str = f"""
{persona_block}

## BMAD PRD Creation Workflow

{instructions[:3000] if instructions else "Create a comprehensive PRD."}

{f"## Product Brief (input)\\n\\n{brief_content[:2000]}" if brief_content else ""}

{f"## Validation Checklist\\n\\n{checklist[:1500]}" if checklist else ""}

**Task**: {self.task_description}
**Spec Directory**: {self.spec_dir}
**Output**: Write the PRD as spec.md in {self.spec_dir} AND save to {prd_file}

The PRD should cover: vision, user journeys, functional requirements,
non-functional requirements, success metrics, and scope.
"""
            success, output = await self.run_agent_fn(
                "spec_writer.md",
                additional_context=context_str,
                phase_name="bmad_prd_writing",
            )

            if success:
                spec_file = self.spec_dir / "spec.md"
                if spec_file.exists():
                    content = spec_file.read_text(encoding="utf-8")
                    save_artifact(self.spec_dir, "prd", content)
                    self.ui.print_status("BMAD PRD created", "success")
                    return PhaseResult(
                        "bmad_prd_writing", True,
                        [str(spec_file), str(prd_file)], [], attempt,
                    )

            errors.append(f"Attempt {attempt + 1}: BMAD PRD writing failed")

        return PhaseResult("bmad_prd_writing", False, [], errors, MAX_RETRIES)

    async def phase_bmad_architecture(self) -> PhaseResult:
        """BMAD Architecture: architecture decisions using Architect persona (Winston).

        Creates architecture decisions document covering technology choices,
        component structure, data flow, and key constraints.
        """
        from bmad.artifacts import create_bmad_structure, save_artifact
        from bmad.config import PHASE_AGENT_MAP
        from bmad.personas import format_persona_block, load_persona
        from bmad.workflows import get_instructions, load_workflow

        arch_file = self.spec_dir / "bmad" / "planning" / "architecture.md"

        if arch_file.exists():
            self.ui.print_status("BMAD architecture already exists", "success")
            return PhaseResult("bmad_architecture", True, [str(arch_file)], [], 0)

        create_bmad_structure(self.spec_dir)

        # Load Architect persona (Winston)
        agent_name = PHASE_AGENT_MAP.get("architecture", "architect")
        try:
            persona = load_persona(agent_name)
            persona_block = format_persona_block(persona)
        except FileNotFoundError:
            persona_block = ""

        try:
            workflow = load_workflow("architecture")
            instructions = get_instructions(workflow)
        except FileNotFoundError:
            instructions = ""

        # Load PRD/spec for context
        spec_file = self.spec_dir / "spec.md"
        spec_content = ""
        if spec_file.exists():
            spec_content = spec_file.read_text(encoding="utf-8")

        errors: list[str] = []
        for attempt in range(MAX_RETRIES):
            self.ui.print_status(
                f"Running BMAD architecture (attempt {attempt + 1})...", "progress"
            )

            context_str = f"""
{persona_block}

## BMAD Architecture Workflow

{instructions[:3000] if instructions else "Create architecture decisions document."}

{f"## PRD / Spec (input)\\n\\n{spec_content[:3000]}" if spec_content else ""}

**Task**: {self.task_description}
**Spec Directory**: {self.spec_dir}
**Output**: Write architecture document to {arch_file}

Cover:
- Technology decisions with rationale
- Component structure and responsibilities
- Data flow and integration points
- Key constraints and trade-offs
"""
            success, output = await self.run_agent_fn(
                "spec_writer.md",
                additional_context=context_str,
                phase_name="bmad_architecture",
            )

            if success:
                if arch_file.exists():
                    self.ui.print_status("BMAD architecture created", "success")
                    return PhaseResult(
                        "bmad_architecture", True, [str(arch_file)], [], attempt
                    )
                # Agent may have written architecture into spec.md
                if spec_file.exists():
                    content = spec_file.read_text(encoding="utf-8")
                    if "architecture" in content.lower():
                        save_artifact(self.spec_dir, "architecture", content)
                        self.ui.print_status(
                            "BMAD architecture saved from spec output", "success"
                        )
                        return PhaseResult(
                            "bmad_architecture", True, [str(arch_file)], [], attempt
                        )

            errors.append(f"Attempt {attempt + 1}: BMAD architecture failed")

        return PhaseResult("bmad_architecture", False, [], errors, MAX_RETRIES)

    async def phase_bmad_story_planning(self) -> PhaseResult:
        """BMAD Story Planning: story decomposition using SM persona (Bob).

        Breaks down the PRD and architecture into epics and stories,
        then converts BMAD stories into Auto-Claude's implementation_plan.json.
        """
        from bmad.artifacts import create_bmad_structure, save_artifact, stories_to_implementation_plan
        from bmad.config import PHASE_AGENT_MAP
        from bmad.personas import format_persona_block, load_persona
        from bmad.workflows import get_instructions, load_workflow

        stories_file = self.spec_dir / "bmad" / "stories" / "epics.md"
        plan_file = self.spec_dir / "implementation_plan.json"

        if stories_file.exists() and plan_file.exists():
            self.ui.print_status("BMAD stories and plan already exist", "success")
            return PhaseResult(
                "bmad_story_planning", True,
                [str(stories_file), str(plan_file)], [], 0,
            )

        create_bmad_structure(self.spec_dir)

        # Load SM persona (Bob)
        agent_name = PHASE_AGENT_MAP.get("create_story", "sm")
        try:
            persona = load_persona(agent_name)
            persona_block = format_persona_block(persona)
        except FileNotFoundError:
            persona_block = ""

        try:
            workflow = load_workflow("epics_stories")
            instructions = get_instructions(workflow)
        except FileNotFoundError:
            instructions = ""

        # Load prior artifacts
        spec_file = self.spec_dir / "spec.md"
        spec_content = ""
        if spec_file.exists():
            spec_content = spec_file.read_text(encoding="utf-8")

        arch_path = self.spec_dir / "bmad" / "planning" / "architecture.md"
        arch_content = ""
        if arch_path.exists():
            arch_content = arch_path.read_text(encoding="utf-8")

        errors: list[str] = []
        for attempt in range(MAX_RETRIES):
            self.ui.print_status(
                f"Running BMAD story planning (attempt {attempt + 1})...", "progress"
            )

            context_str = f"""
{persona_block}

## BMAD Story Planning Workflow

{instructions[:3000] if instructions else "Break down requirements into epics and stories."}

{f"## PRD / Spec (input)\\n\\n{spec_content[:2000]}" if spec_content else ""}

{f"## Architecture (input)\\n\\n{arch_content[:2000]}" if arch_content else ""}

**Task**: {self.task_description}
**Spec Directory**: {self.spec_dir}

Create epics and stories at {stories_file}, then generate the
implementation plan at {plan_file} as JSON with subtasks.
Each subtask needs: id, description, service, files_to_modify,
files_to_create, patterns_from, acceptance_criteria.
"""
            success, output = await self.run_agent_fn(
                "planner.md",
                additional_context=context_str,
                phase_name="bmad_story_planning",
            )

            if success:
                # If the plan was created directly by the planner
                if plan_file.exists():
                    self.ui.print_status("BMAD stories and plan created", "success")
                    return PhaseResult(
                        "bmad_story_planning", True,
                        [str(stories_file), str(plan_file)], [], attempt,
                    )

                # Try converting BMAD stories to implementation plan
                if stories_file.exists():
                    stories_to_implementation_plan(self.spec_dir)
                    if plan_file.exists():
                        self.ui.print_status(
                            "Converted BMAD stories to implementation plan", "success"
                        )
                        return PhaseResult(
                            "bmad_story_planning", True,
                            [str(stories_file), str(plan_file)], [], attempt,
                        )

            errors.append(f"Attempt {attempt + 1}: BMAD story planning failed")

        return PhaseResult("bmad_story_planning", False, [], errors, MAX_RETRIES)

    async def phase_bmad_quick_spec(self) -> PhaseResult:
        """BMAD Quick Spec: lightweight spec using Solo Dev persona (Barry).

        For simple tasks, uses the Quick Flow Solo Dev persona to create
        a lean tech spec and implementation plan without heavy BMAD ceremony.
        """
        from bmad.artifacts import create_bmad_structure
        from bmad.config import PHASE_AGENT_MAP
        from bmad.personas import format_persona_block, load_persona
        from bmad.workflows import get_instructions, load_workflow

        from .. import writer

        spec_file = self.spec_dir / "spec.md"
        plan_file = self.spec_dir / "implementation_plan.json"

        if spec_file.exists() and plan_file.exists():
            self.ui.print_status("BMAD quick spec already exists", "success")
            return PhaseResult(
                "bmad_quick_spec", True, [str(spec_file), str(plan_file)], [], 0
            )

        create_bmad_structure(self.spec_dir)

        # Load Solo Dev persona (Barry)
        agent_name = PHASE_AGENT_MAP.get("quick_spec", "quick-flow-solo-dev")
        try:
            persona = load_persona(agent_name)
            persona_block = format_persona_block(persona)
        except FileNotFoundError:
            persona_block = ""

        try:
            workflow = load_workflow("quick_spec")
            instructions = get_instructions(workflow)
        except FileNotFoundError:
            instructions = ""

        errors: list[str] = []
        for attempt in range(MAX_RETRIES):
            self.ui.print_status(
                f"Running BMAD quick spec (attempt {attempt + 1})...", "progress"
            )

            context_str = f"""
{persona_block}

## BMAD Quick Flow Spec

{instructions[:3000] if instructions else "Create a lean tech spec for this simple task."}

**Task**: {self.task_description}
**Spec Directory**: {self.spec_dir}
**Complexity**: SIMPLE (1-2 files expected)

This is a SIMPLE task using BMAD Quick Flow. Create:
1. A concise spec.md with essential sections
2. A simple implementation_plan.json with 1-2 subtasks

No heavy analysis or research needed. Ship the smallest thing that works.
"""
            success, output = await self.run_agent_fn(
                "spec_quick.md",
                additional_context=context_str,
                phase_name="bmad_quick_spec",
            )

            if success and spec_file.exists():
                if not plan_file.exists():
                    writer.create_minimal_plan(self.spec_dir, self.task_description)

                self.ui.print_status("BMAD quick spec created", "success")
                return PhaseResult(
                    "bmad_quick_spec", True,
                    [str(spec_file), str(plan_file)], [], attempt,
                )

            errors.append(f"Attempt {attempt + 1}: BMAD quick spec failed")

        return PhaseResult("bmad_quick_spec", False, [], errors, MAX_RETRIES)
