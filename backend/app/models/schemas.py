from __future__ import annotations

import re
import uuid
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.constants import PaperSize


class Point(BaseModel):
    x: float
    y: float


class PhotoWarning(BaseModel):
    code: str
    message: str


class FingerHole(BaseModel):
    id: str
    x: float  # center position in pixels
    y: float
    radius: float = 15.0  # radius in mm for circles, half-width for squares
    width: float | None = None  # for rectangles
    height: float | None = None  # for rectangles
    rotation: float = 0.0  # degrees
    shape: Literal["circle", "cylinder", "square", "rectangle", "filleted_rectangle"] = "circle"
    depth_override: float | None = None  # mm; None = use bin_config.cutout_depth


class TextLabel(BaseModel):
    id: str
    text: str
    x: float
    y: float
    font_size: float = 5.0
    rotation: float = 0.0
    emboss: bool = True
    depth: float = 0.5


class Polygon(BaseModel):
    id: str
    points: list[Point]
    label: str
    finger_holes: list[FingerHole] = []
    interior_rings: list[list[Point]] = []


class UploadResponse(BaseModel):
    session_id: str
    image_url: str
    detected_corners: list[Point] | None


class CornersRequest(BaseModel):
    corners: list[Point]
    paper_size: PaperSize


class CornersResponse(BaseModel):
    corrected_image_url: str
    scale_factor: float
    warnings: list[PhotoWarning] = []


class TraceRequest(BaseModel):
    provider: Literal["google"] = "google"
    api_key: str | None = None
    tracer: str | None = None


class TraceResponse(BaseModel):
    polygons: list[Polygon]
    mask_url: str | None = None


class PolygonsRequest(BaseModel):
    polygons: list[Polygon]


class BinParams(BaseModel):
    grid_x: float = 2
    grid_y: float = 2
    height_units: int = 4
    magnets: bool = True
    magnet_diameter: float = 6.0
    magnet_depth: float = 2.4
    magnet_corners_only: bool = False
    stacking_lip: bool = True
    rim_units: int = 0  # extra height units (x7mm) the wall/lip rises above the floor face
    wall_thickness: float = 1.6
    cutout_depth: float = 20.0
    cutout_clearance: float = 1.0
    insert_enabled: bool = False
    insert_height: float = 1.0
    insert_clearance: float = 0.2  # mm shaved off the insert so it fits the pocket
    cutout_chamfer: float = 0.0
    half_grid_base: bool = False  # use 21mm half-grid cells for the bottom baseplate
    partial_bins: bool = False
    partial_bins_values: list[bool] = []
    partial_bins_connect: bool = False
    partial_bins_retain_wall: bool = False

    @model_validator(mode="after")
    def normalize_partial_bins_values(self) -> "BinParams":
        import math

        expected = math.ceil(self.grid_x) * math.ceil(self.grid_y)
        if len(self.partial_bins_values) != expected:
            self.partial_bins_values = [True] * expected
        if not self.partial_bins_connect:
            self.partial_bins_retain_wall = False
        if self.partial_bins and not any(self.partial_bins_values):
            raise ValueError("at least one grid cell must remain enabled when partial bins is on")
        return self

    @field_validator("grid_x", "grid_y")
    @classmethod
    def validate_grid(cls, v: float) -> float:
        if v < 1 or v > 10:
            raise ValueError("grid size must be between 1 and 10")
        # must be a multiple of 0.5
        if v * 2 != int(v * 2):
            raise ValueError("grid size must be a multiple of 0.5")
        return v

    @field_validator("height_units")
    @classmethod
    def validate_height(cls, v: int) -> int:
        if v < 1 or v > 20:
            raise ValueError("height must be between 1 and 20 units")
        return v

    @field_validator("rim_units")
    @classmethod
    def validate_rim(cls, v: int) -> int:
        if v < 0 or v > 20:
            raise ValueError("rim must be between 0 and 20 units")
        return v

    @field_validator("cutout_depth")
    @classmethod
    def validate_depth(cls, v: float) -> float:
        if v < 1 or v > 200:
            raise ValueError("cutout depth must be between 1 and 200mm")
        return v

    @field_validator("cutout_clearance")
    @classmethod
    def validate_clearance(cls, v: float) -> float:
        if v < 0 or v > 10:
            raise ValueError("clearance must be between 0 and 10mm")
        return v

    @field_validator("insert_height")
    @classmethod
    def validate_insert_height(cls, v: float) -> float:
        if v < 0.1 or v > 10:
            raise ValueError("insert height must be between 0.1 and 10mm")
        return v

    @field_validator("insert_clearance")
    @classmethod
    def validate_insert_clearance(cls, v: float) -> float:
        if v < 0 or v > 2:
            raise ValueError("insert clearance must be between 0 and 2mm")
        return v

    @field_validator("cutout_chamfer")
    @classmethod
    def validate_chamfer(cls, v: float) -> float:
        if v < 0 or v > 5:
            raise ValueError("cutout chamfer must be between 0 and 5mm")
        return v

    @field_validator("wall_thickness")
    @classmethod
    def validate_wall(cls, v: float) -> float:
        if v < 0.4 or v > 5:
            raise ValueError("wall thickness must be between 0.4 and 5mm")
        return v

    @model_validator(mode="after")
    def half_grid_disables_magnets(self) -> "BinParams":
        if self.half_grid_base:
            self.magnets = False
        return self


class BinDefaults(BinParams):
    bed_size: float = 256.0  # mm, 0 = no splitting


class GenerateRequest(BinDefaults):
    polygons: list[Polygon] | None = None  # optional: use these instead of session polygons
    text_labels: list[TextLabel] = []


class GenerateResponse(BaseModel):
    stl_url: str
    stl_urls: list[str] = []
    threemf_url: str | None = None
    split_count: int = 1
    zip_url: str | None = None
    insert_stl_url: str | None = None
    warning: str | None = None


class Layout(BaseModel):
    bin_config: GenerateRequest = GenerateRequest()
    polygons: list[Polygon] = []
    text_labels: list[TextLabel] = []


class Session(BaseModel):
    id: str
    name: str | None = None
    description: str | None = None
    tags: list[str] = []
    created_at: str | None = None
    original_image_path: str | None = None
    corrected_image_path: str | None = None
    mask_image_path: str | None = None
    corners: list[Point] | None = None
    paper_size: PaperSize | None = None
    scale_factor: float | None = None
    focal_length_35mm: float | None = None
    photo_warnings: list[PhotoWarning] | None = None
    polygons: list[Polygon] | None = None
    stl_path: str | None = None
    layout: Layout | None = None


class SessionSummary(BaseModel):
    id: str
    name: str | None
    description: str | None
    tags: list[str]
    created_at: str | None
    thumbnail_url: str | None
    tool_count: int
    has_stl: bool


class SessionListResponse(BaseModel):
    sessions: list[SessionSummary]


class SessionUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    tags: list[str] | None = None
    layout: Layout | None = None


class StatusResponse(BaseModel):
    status: str


# --- tool library ---

class Tool(BaseModel):
    id: str
    name: str
    points: list[Point]  # mm, centered at (0,0)
    finger_holes: list[FingerHole] = []  # mm, relative to tool origin
    interior_rings: list[list[Point]] = []  # mm, centered at (0,0)
    smoothed: bool = True
    smooth_level: float = 0.5
    source_session_id: str | None = None
    source_polygon_id: str | None = None
    source_image_path: str | None = None
    source_image_width: int | None = None
    source_image_height: int | None = None
    source_image_transform: list[float] | None = None  # 2D affine [a, b, c, d, e, f] mapping image-px to mm
    category: str | None = None
    drawer: str | None = None
    tags: list[str] = []
    project_ids: list[str] = []
    review_status: str | None = None
    needs_cleanup: bool = False
    thumbnail_path: str | None = None
    created_at: str | None = None


class ToolDetailResponse(Tool):
    image_context: dict | None = None


class ToolSummary(BaseModel):
    id: str
    name: str
    created_at: str | None
    point_count: int
    points: list[Point] = []
    interior_rings: list[list[Point]] = []
    smoothed: bool = False
    smooth_level: float = 0.5
    thumbnail_url: str | None = None
    image_transform: list[float] | None = None
    image_context: dict | None = None
    category: str | None = None
    drawer: str | None = None
    tags: list[str] = []
    project_ids: list[str] = []
    review_status: str | None = None
    needs_cleanup: bool = False


class ToolUpdateRequest(BaseModel):
    name: str | None = None
    points: list[Point] | None = None
    finger_holes: list[FingerHole] | None = None
    interior_rings: list[list[Point]] | None = None
    smoothed: bool | None = None
    smooth_level: float | None = None
    source_image_transform: list[float] | None = None
    category: str | None = None
    drawer: str | None = None
    tags: list[str] | None = None
    project_ids: list[str] | None = None
    review_status: str | None = None
    needs_cleanup: bool | None = None


class ToolListResponse(BaseModel):
    tools: list[ToolSummary]


class SaveToolsRequest(BaseModel):
    polygon_ids: list[str] | None = None


class SaveToolsResponse(BaseModel):
    tool_ids: list[str]


# --- bin projects ---

ProjectStatus = Literal["active", "ready_to_print", "printed", "archived"]
ProjectHealthSeverity = Literal["warning", "error"]
ProjectHealthCode = Literal[
    "missing_tool",
    "missing_bin",
    "bin_missing_project_id",
    "bin_project_mismatch",
    "outside_tool",
    "tool_missing_project_id",
    "tool_extra_project_id",
]

# a project grid describes a whole drawer, so it is much larger than a single bin
MAX_TARGET_GRID = 40


def _check_target_grid(v: float | None) -> float | None:
    """Validate an optional drawer grid size in gridfinity units."""
    if v is None:
        return v
    if v < 1 or v > MAX_TARGET_GRID:
        raise ValueError(f"grid size must be between 1 and {MAX_TARGET_GRID}")
    if v * 2 != int(v * 2):
        raise ValueError("grid size must be a multiple of 0.5")
    return v


PLACEMENT_ROTATIONS = (0, 90, 180, 270)


class ProjectBinPlacement(BaseModel):
    """Position of one bin on the project drawer grid, in gridfinity units from the top-left.

    A bin may be placed more than once, so placements carry their own id.
    """

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    bin_id: str
    x: float = 0
    y: float = 0
    rotation: int = 0  # 90 and 270 swap the bin footprint
    color: str | None = None  # #rrggbb highlight; None uses the default bin colour

    @field_validator("color")
    @classmethod
    def validate_color(cls, v: str | None) -> str | None:
        if v is None:
            return v
        value = v.strip().lower()
        if not re.fullmatch(r"#[0-9a-f]{6}", value):
            raise ValueError("colour must be a #rrggbb hex value")
        return value

    @field_validator("x", "y")
    @classmethod
    def validate_offset(cls, v: float) -> float:
        if v < 0 or v > MAX_TARGET_GRID:
            raise ValueError(f"placement offset must be between 0 and {MAX_TARGET_GRID}")
        if v * 2 != int(v * 2):
            raise ValueError("placement offset must be a multiple of 0.5")
        return v

    @field_validator("rotation")
    @classmethod
    def validate_rotation(cls, v: int) -> int:
        if v not in PLACEMENT_ROTATIONS:
            raise ValueError("placement rotation must be 0, 90, 180 or 270")
        return v


DEFAULT_SKETCH_NAME = "Drawer plan"


class ProjectSketch(BaseModel):
    """One drawer plan: a grid plus the bins placed on it. A project may hold several."""

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str = DEFAULT_SKETCH_NAME
    target_grid_x: float | None = None
    target_grid_y: float | None = None
    bin_layout: list[ProjectBinPlacement] = []
    created_at: str | None = None
    updated_at: str | None = None

    @field_validator("target_grid_x", "target_grid_y")
    @classmethod
    def validate_target_grid(cls, v: float | None) -> float | None:
        return _check_target_grid(v)


class BinProject(BaseModel):
    id: str
    name: str
    description: str | None = None
    status: ProjectStatus = "active"
    tool_ids: list[str] = []
    bin_ids: list[str] = []
    sketches: list[ProjectSketch] = []
    default_bin_config: BinDefaults | None = None
    notes: str | None = None
    created_at: str | None = None
    updated_at: str | None = None

    @model_validator(mode="before")
    @classmethod
    def migrate_single_sketch(cls, data):
        """Fold a pre-multi-sketch record (grid + layout on the project) into one sketch."""
        if not isinstance(data, dict):
            return data
        legacy_keys = ("target_grid_x", "target_grid_y", "bin_layout")
        if not any(key in data for key in legacy_keys):
            return data

        data = dict(data)
        grid_x = data.pop("target_grid_x", None)
        grid_y = data.pop("target_grid_y", None)
        layout = data.pop("bin_layout", None) or []
        if not data.get("sketches") and (layout or grid_x is not None or grid_y is not None):
            data["sketches"] = [{
                "name": DEFAULT_SKETCH_NAME,
                "target_grid_x": grid_x,
                "target_grid_y": grid_y,
                "bin_layout": layout,
                "created_at": data.get("created_at"),
                "updated_at": data.get("updated_at"),
            }]
        return data


class BinProjectDetail(BinProject):
    placed_tool_ids: list[str] = []
    unplaced_tool_ids: list[str] = []


class BinProjectSummary(BaseModel):
    id: str
    name: str
    description: str | None = None
    status: ProjectStatus = "active"
    tool_count: int = 0
    bin_count: int = 0
    placed_count: int = 0
    unplaced_count: int = 0
    sketch_count: int = 0
    created_at: str | None = None
    updated_at: str | None = None


class BinProjectListResponse(BaseModel):
    projects: list[BinProjectSummary]


class BinProjectCreateRequest(BaseModel):
    name: str
    description: str | None = None
    status: ProjectStatus = "active"
    default_bin_config: BinDefaults | None = None
    notes: str | None = None
    tool_ids: list[str] = []


class BinProjectUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    status: ProjectStatus | None = None
    default_bin_config: BinDefaults | None = None
    notes: str | None = None


class ProjectSketchCreateRequest(BaseModel):
    name: str | None = None
    target_grid_x: float | None = None
    target_grid_y: float | None = None

    @field_validator("target_grid_x", "target_grid_y")
    @classmethod
    def validate_target_grid(cls, v: float | None) -> float | None:
        return _check_target_grid(v)


class ProjectSketchUpdateRequest(BaseModel):
    name: str | None = None
    target_grid_x: float | None = None
    target_grid_y: float | None = None
    bin_layout: list[ProjectBinPlacement] | None = None

    @field_validator("target_grid_x", "target_grid_y")
    @classmethod
    def validate_target_grid(cls, v: float | None) -> float | None:
        return _check_target_grid(v)


class BinProjectToolsRequest(BaseModel):
    tool_ids: list[str]


class BinProjectCreateBinRequest(BaseModel):
    name: str | None = None
    tool_ids: list[str] | None = None
    bin_config: BinDefaults | None = None


class BinProjectBinsRequest(BaseModel):
    bin_ids: list[str]
    import_tools: bool = False
    allow_reassign: bool = False


class ProjectHealthIssue(BaseModel):
    code: ProjectHealthCode
    severity: ProjectHealthSeverity
    message: str
    tool_id: str | None = None
    bin_id: str | None = None
    other_project_id: str | None = None
    repairable: bool = False


class ProjectHealthResponse(BaseModel):
    issues: list[ProjectHealthIssue]
    repairable_count: int = 0
    manual_count: int = 0


# --- bins ---

class PlacedTool(BaseModel):
    id: str  # placement instance id
    tool_id: str  # reference to library tool
    name: str
    points: list[Point]  # mm, bin-space (always raw/accurate)
    finger_holes: list[FingerHole] = []  # mm, bin-space
    interior_rings: list[list[Point]] = []  # mm, bin-space
    rotation: float = 0.0  # degrees, applied on top of library points
    depth_override: float | None = None  # mm; None = use bin_config.cutout_depth


class BinConfig(BinDefaults):
    text_labels: list[TextLabel] = []


class BinModel(BaseModel):
    id: str
    name: str | None = None
    project_id: str | None = None
    bin_config: BinConfig = BinConfig()
    placed_tools: list[PlacedTool] = []
    text_labels: list[TextLabel] = []
    stl_path: str | None = None
    created_at: str | None = None


class BinPreviewTool(BaseModel):
    points: list[Point]
    interior_rings: list[list[Point]] = []

class BinSummary(BaseModel):
    id: str
    name: str | None
    project_id: str | None = None
    created_at: str | None
    tool_ids: list[str] = []
    tool_count: int
    has_stl: bool
    grid_x: float = 2
    grid_y: float = 2
    height_units: int = 4
    half_grid_base: bool = False
    preview_tools: list[BinPreviewTool] = []


class BinListResponse(BaseModel):
    bins: list[BinSummary]


class BinUpdateRequest(BaseModel):
    name: str | None = None
    project_id: str | None = None
    bin_config: BinConfig | None = None
    placed_tools: list[PlacedTool] | None = None
    text_labels: list[TextLabel] | None = None


class CreateBinRequest(BaseModel):
    name: str | None = None
    project_id: str | None = None
    tool_ids: list[str] = []  # pre-place these tools
    bin_config: BinDefaults | None = None
