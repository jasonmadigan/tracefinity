from __future__ import annotations

from pydantic import BaseModel, field_validator
from typing import Literal, Optional


class Point(BaseModel):
    x: float
    y: float


class FingerHole(BaseModel):
    id: str
    x: float  # center position in pixels
    y: float
    radius: float = 15.0  # radius in mm for circles, half-width for squares
    width: float | None = None  # for rectangles
    height: float | None = None  # for rectangles
    rotation: float = 0.0  # degrees
    shape: Literal["circle", "square", "rectangle"] = "circle"


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


class UploadResponse(BaseModel):
    session_id: str
    image_url: str
    detected_corners: list[Point] | None


class CornersRequest(BaseModel):
    corners: list[Point]
    paper_size: Literal["a4", "letter"]


class CornersResponse(BaseModel):
    corrected_image_url: str
    scale_factor: float


class TraceRequest(BaseModel):
    provider: Literal["google"] = "google"
    api_key: str | None = None


class TraceResponse(BaseModel):
    polygons: list[Polygon]
    mask_url: str | None = None


class PolygonsRequest(BaseModel):
    polygons: list[Polygon]


class GenerateRequest(BaseModel):
    grid_x: int = 2
    grid_y: int = 2
    height_units: int = 4
    magnets: bool = True
    stacking_lip: bool = True
    wall_thickness: float = 1.6
    cutout_depth: float = 20.0
    cutout_clearance: float = 1.0
    polygons: list[Polygon] | None = None  # optional: use these instead of session polygons
    text_labels: list[TextLabel] = []
    bed_size: float = 256.0  # mm, 0 = no splitting

    @field_validator("grid_x", "grid_y")
    @classmethod
    def validate_grid(cls, v: int) -> int:
        if v < 1 or v > 10:
            raise ValueError("grid size must be between 1 and 10")
        return v

    @field_validator("height_units")
    @classmethod
    def validate_height(cls, v: int) -> int:
        if v < 1 or v > 20:
            raise ValueError("height must be between 1 and 20 units")
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

    @field_validator("wall_thickness")
    @classmethod
    def validate_wall(cls, v: float) -> float:
        if v < 0.4 or v > 5:
            raise ValueError("wall thickness must be between 0.4 and 5mm")
        return v


class GenerateResponse(BaseModel):
    stl_url: str
    stl_urls: list[str] = []
    threemf_url: str | None = None
    split_count: int = 1
    zip_url: str | None = None


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
    paper_size: Literal["a4", "letter"] | None = None
    scale_factor: float | None = None
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
    source_session_id: str | None = None
    thumbnail_path: str | None = None
    created_at: str | None = None


class ToolSummary(BaseModel):
    id: str
    name: str
    created_at: str | None
    point_count: int
    points: list[Point] = []
    thumbnail_url: str | None = None


class ToolUpdateRequest(BaseModel):
    name: str | None = None
    points: list[Point] | None = None
    finger_holes: list[FingerHole] | None = None


class ToolListResponse(BaseModel):
    tools: list[ToolSummary]


class SaveToolsResponse(BaseModel):
    tool_ids: list[str]


# --- bins ---

class PlacedTool(BaseModel):
    id: str  # placement instance id
    tool_id: str  # reference to library tool
    name: str
    points: list[Point]  # mm, bin-space
    finger_holes: list[FingerHole] = []  # mm, bin-space
    rotation: float = 0.0  # degrees, applied on top of library points


class BinConfig(BaseModel):
    grid_x: int = 2
    grid_y: int = 2
    height_units: int = 4
    magnets: bool = True
    stacking_lip: bool = True
    wall_thickness: float = 1.6
    cutout_depth: float = 20.0
    cutout_clearance: float = 1.0
    text_labels: list[TextLabel] = []
    bed_size: float = 256.0


class BinModel(BaseModel):
    id: str
    name: str | None = None
    bin_config: BinConfig = BinConfig()
    placed_tools: list[PlacedTool] = []
    text_labels: list[TextLabel] = []
    stl_path: str | None = None
    created_at: str | None = None


class BinPreviewTool(BaseModel):
    points: list[Point]

class BinSummary(BaseModel):
    id: str
    name: str | None
    created_at: str | None
    tool_count: int
    has_stl: bool
    grid_x: int = 2
    grid_y: int = 2
    preview_tools: list[BinPreviewTool] = []


class BinListResponse(BaseModel):
    bins: list[BinSummary]


class BinUpdateRequest(BaseModel):
    name: str | None = None
    bin_config: BinConfig | None = None
    placed_tools: list[PlacedTool] | None = None
    text_labels: list[TextLabel] | None = None


class CreateBinRequest(BaseModel):
    name: str | None = None
    tool_ids: list[str] = []  # pre-place these tools
