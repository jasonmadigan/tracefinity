from datetime import datetime

from fastapi import HTTPException

from app.models.schemas import (
    BinModel,
    BinProject,
    BinProjectDetail,
    BinProjectSummary,
    ProjectBinPlacement,
    ProjectHealthIssue,
    ProjectHealthResponse,
    ProjectSketch,
)
from app.services.bin_store import BinStore
from app.services.project_store import ProjectStore
from app.services.tool_store import ToolStore


def now_iso() -> str:
    return datetime.utcnow().isoformat()


def project_linked_bins(project: BinProject, user_bins: BinStore) -> list[BinModel]:
    linked: list[BinModel] = []
    linked_bin_ids = set(project.bin_ids)
    for bid, bin_data in user_bins.all().items():
        if bin_data.project_id == project.id or bid in linked_bin_ids:
            linked.append(bin_data)
    return linked


def project_status(project: BinProject, linked_bins: list[BinModel]) -> dict[str, list[str]]:
    project_tool_ids = list(dict.fromkeys(project.tool_ids))
    project_tool_set = set(project_tool_ids)
    placement_counts: dict[str, int] = {}
    for bin_data in linked_bins:
        for placed in bin_data.placed_tools:
            if placed.tool_id in project_tool_set:
                placement_counts[placed.tool_id] = placement_counts.get(placed.tool_id, 0) + 1

    placed = [tool_id for tool_id in project_tool_ids if placement_counts.get(tool_id, 0) > 0]
    unplaced = [tool_id for tool_id in project_tool_ids if placement_counts.get(tool_id, 0) == 0]
    return {
        "placed_tool_ids": placed,
        "unplaced_tool_ids": unplaced,
    }


def make_project_summary(project: BinProject, user_bins: BinStore) -> BinProjectSummary:
    linked_bins = project_linked_bins(project, user_bins)
    status = project_status(project, linked_bins)
    return BinProjectSummary(
        id=project.id,
        name=project.name,
        description=project.description,
        status=project.status,
        tool_count=len(project.tool_ids),
        bin_count=len(linked_bins),
        placed_count=len(status["placed_tool_ids"]),
        unplaced_count=len(status["unplaced_tool_ids"]),
        sketch_count=len(project.sketches),
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


def make_project_detail(project: BinProject, user_bins: BinStore) -> BinProjectDetail:
    return BinProjectDetail(
        **project.model_dump(),
        **project_status(project, project_linked_bins(project, user_bins)),
    )


def validate_bin_layout(
    project: BinProject,
    placements: list[ProjectBinPlacement],
    user_bins: BinStore,
) -> list[ProjectBinPlacement]:
    """Check that every placement targets a linked bin and has a unique id.

    The same bin may appear several times -- one drawer can hold copies of a bin.
    """
    linked_bin_ids = {bin_data.id for bin_data in project_linked_bins(project, user_bins)}
    seen: set[str] = set()
    layout: list[ProjectBinPlacement] = []
    for placement in placements:
        if placement.bin_id not in linked_bin_ids:
            raise HTTPException(
                status_code=400,
                detail=f"bin {placement.bin_id} is not linked to this project",
            )
        if placement.id in seen:
            raise HTTPException(
                status_code=400,
                detail=f"duplicate placement id {placement.id}",
            )
        seen.add(placement.id)
        layout.append(placement)
    return layout


def get_sketch(project: BinProject, sketch_id: str) -> ProjectSketch:
    for sketch in project.sketches:
        if sketch.id == sketch_id:
            return sketch
    raise HTTPException(status_code=404, detail="sketch not found")


def drop_bins_from_layout(project: BinProject, bin_ids: set[str]) -> bool:
    """Remove placements for bins that left the project. Returns True when changed."""
    changed = False
    for sketch in project.sketches:
        remaining = [p for p in sketch.bin_layout if p.bin_id not in bin_ids]
        if len(remaining) != len(sketch.bin_layout):
            sketch.bin_layout = remaining
            changed = True
    return changed


def add_project_to_tools(project_id: str, tool_ids: list[str], user_tools: ToolStore):
    for tool_id in tool_ids:
        tool = user_tools.get(tool_id)
        if not tool:
            raise HTTPException(status_code=404, detail=f"tool {tool_id} not found")
        if project_id not in tool.project_ids:
            tool.project_ids.append(project_id)
            user_tools.set(tool_id, tool)


def remove_project_from_tools(project_id: str, tool_ids: list[str], user_tools: ToolStore):
    for tool_id in tool_ids:
        tool = user_tools.get(tool_id)
        if tool and project_id in tool.project_ids:
            tool.project_ids = [pid for pid in tool.project_ids if pid != project_id]
            user_tools.set(tool_id, tool)


def add_bin_to_project(project_store: ProjectStore, project_id: str | None, bin_id: str):
    if not project_id:
        return
    project = project_store.get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail=f"project {project_id} not found")
    if bin_id not in project.bin_ids:
        project.bin_ids.append(bin_id)
        project.updated_at = now_iso()
        project_store.set(project_id, project)


def remove_bin_from_project(project_store: ProjectStore, project_id: str | None, bin_id: str):
    if not project_id:
        return
    project = project_store.get(project_id)
    if not project:
        return
    dropped = drop_bins_from_layout(project, {bin_id})
    if bin_id in project.bin_ids:
        project.bin_ids = [bid for bid in project.bin_ids if bid != bin_id]
        dropped = True
    if dropped:
        project.updated_at = now_iso()
        project_store.set(project_id, project)


def remove_bin_from_all_projects(project_store: ProjectStore, bin_id: str):
    for project_id, project in project_store.all().items():
        dropped = drop_bins_from_layout(project, {bin_id})
        if bin_id in project.bin_ids:
            project.bin_ids = [bid for bid in project.bin_ids if bid != bin_id]
            dropped = True
        if dropped:
            project.updated_at = now_iso()
            project_store.set(project_id, project)


def project_health(
    project: BinProject,
    user_tools: ToolStore,
    user_bins: BinStore,
) -> list[ProjectHealthIssue]:
    issues: list[ProjectHealthIssue] = []
    all_tools = user_tools.all()
    all_bins = user_bins.all()
    linked_bin_ids = set(project.bin_ids)
    project_tool_ids = set(project.tool_ids)

    for tool_id in project.tool_ids:
        tool = all_tools.get(tool_id)
        if not tool:
            issues.append(ProjectHealthIssue(
                code="missing_tool",
                severity="error",
                message=f"project references missing tool {tool_id}",
                tool_id=tool_id,
                repairable=True,
            ))
        elif project.id not in tool.project_ids:
            issues.append(ProjectHealthIssue(
                code="tool_missing_project_id",
                severity="warning",
                message=f"tool {tool.name} is in the project but is missing the project backlink",
                tool_id=tool_id,
                repairable=True,
            ))

    for tool_id, tool in all_tools.items():
        if project.id in tool.project_ids and tool_id not in project_tool_ids:
            issues.append(ProjectHealthIssue(
                code="tool_extra_project_id",
                severity="warning",
                message=f"tool {tool.name} has a stale project backlink",
                tool_id=tool_id,
                repairable=True,
            ))

    for bin_id in project.bin_ids:
        bin_data = all_bins.get(bin_id)
        if not bin_data:
            issues.append(ProjectHealthIssue(
                code="missing_bin",
                severity="error",
                message=f"project references missing bin {bin_id}",
                bin_id=bin_id,
                repairable=True,
            ))
        elif bin_data.project_id is None:
            issues.append(ProjectHealthIssue(
                code="bin_missing_project_id",
                severity="warning",
                message=f"bin {bin_data.name or bin_id} is listed in the project but is missing the project link",
                bin_id=bin_id,
                repairable=True,
            ))
        elif bin_data.project_id != project.id:
            issues.append(ProjectHealthIssue(
                code="bin_project_mismatch",
                severity="warning",
                message=f"bin {bin_data.name or bin_id} is linked to another project",
                bin_id=bin_id,
                other_project_id=bin_data.project_id,
                repairable=False,
            ))

    for bin_id, bin_data in all_bins.items():
        if bin_data.project_id == project.id:
            if bin_id not in linked_bin_ids:
                issues.append(ProjectHealthIssue(
                    code="bin_missing_project_id",
                    severity="warning",
                    message=f"bin {bin_data.name or bin_id} links to this project but is missing from the project bin list",
                    bin_id=bin_id,
                    repairable=True,
                ))
            for placed in bin_data.placed_tools:
                if placed.tool_id and placed.tool_id not in project_tool_ids:
                    issues.append(ProjectHealthIssue(
                        code="outside_tool",
                        severity="warning",
                        message=f"bin {bin_data.name or bin_id} contains outside-project tool {placed.name}",
                        bin_id=bin_id,
                        tool_id=placed.tool_id,
                        repairable=False,
                    ))

    return issues


def health_response(issues: list[ProjectHealthIssue]) -> ProjectHealthResponse:
    repairable = sum(1 for issue in issues if issue.repairable)
    return ProjectHealthResponse(
        issues=issues,
        repairable_count=repairable,
        manual_count=len(issues) - repairable,
    )


def repair_project_links(
    project_store: ProjectStore,
    project: BinProject,
    user_tools: ToolStore,
    user_bins: BinStore,
) -> BinProject:
    all_tools = user_tools.all()
    all_bins = user_bins.all()

    project.tool_ids = [tid for tid in dict.fromkeys(project.tool_ids) if tid in all_tools]
    project.bin_ids = [bid for bid in dict.fromkeys(project.bin_ids) if bid in all_bins]

    project_tool_ids = set(project.tool_ids)
    for tool_id, tool in all_tools.items():
        if tool_id in project_tool_ids and project.id not in tool.project_ids:
            tool.project_ids.append(project.id)
            user_tools.set(tool_id, tool)
        elif tool_id not in project_tool_ids and project.id in tool.project_ids:
            tool.project_ids = [pid for pid in tool.project_ids if pid != project.id]
            user_tools.set(tool_id, tool)

    linked_bin_ids = set(project.bin_ids)
    for bin_id, bin_data in all_bins.items():
        if bin_data.project_id == project.id and bin_id not in linked_bin_ids:
            project.bin_ids.append(bin_id)
            linked_bin_ids.add(bin_id)
        elif bin_id in linked_bin_ids and bin_data.project_id is None:
            bin_data.project_id = project.id
            user_bins.set(bin_id, bin_data)

    stale_placements = {
        placement.bin_id
        for sketch in project.sketches
        for placement in sketch.bin_layout
        if placement.bin_id not in linked_bin_ids
    }
    drop_bins_from_layout(project, stale_placements)

    project.updated_at = now_iso()
    project_store.set(project.id, project)
    return project
