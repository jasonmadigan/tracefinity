import hashlib
import json
import logging
import math
import os
import re
import threading
import uuid
import zipfile
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from PIL import Image
from starlette.requests import Request

logger = logging.getLogger(__name__)

from app.auth import get_user_id
from app.config import ensure_user_dirs, settings
from app.constants import GF_GRID
from app.models.schemas import (
    BinConfig,
    BinDefaults,
    BinListResponse,
    BinModel,
    BinPreviewTool,
    BinProject,
    BinProjectBinsRequest,
    BinProjectCreateBinRequest,
    BinProjectCreateRequest,
    BinProjectDetail,
    BinProjectListResponse,
    BinProjectToolsRequest,
    BinProjectUpdateRequest,
    BinSummary,
    BinUpdateRequest,
    CornersRequest,
    CornersResponse,
    CreateBinRequest,
    FingerHole,
    GenerateRequest,
    GenerateResponse,
    PlacedTool,
    Point,
    Polygon,
    PolygonsRequest,
    ProjectHealthResponse,
    SaveToolsRequest,
    SaveToolsResponse,
    Session,
    SessionListResponse,
    SessionSummary,
    SessionUpdateRequest,
    StatusResponse,
    Tool,
    ToolDetailResponse,
    ToolListResponse,
    ToolSummary,
    ToolUpdateRequest,
    TraceRequest,
    TraceResponse,
    UploadResponse,
)
from app.services.ai_tracer import AITracer
from app.services.bin_service import sync_placed_tools
from app.services.bin_store import BinStore
from app.services.geometry import optimal_rotation_angle as _optimal_rotation_angle
from app.services.image_ingest import ingest_image
from app.services.image_processor import ImageProcessor
from app.services.image_service import generate_tool_thumbnail
from app.services.photo_checks import check_photo, extract_focal_length_35mm
from app.services.polygon_scaler import PolygonScaler, ScaledFingerHole, ScaledPolygon
from app.services.project_service import (
    add_bin_to_project,
    add_project_to_tools,
    health_response,
    make_project_detail,
    make_project_summary,
    project_health,
    remove_bin_from_all_projects,
    remove_bin_from_project,
    remove_project_from_tools,
    repair_project_links,
)
from app.services.project_store import ProjectStore
from app.services.session_store import SessionStore
from app.services.stl_generator_manifold import ManifoldSTLGenerator
from app.services.store_errors import StoreClosedError
from app.services.tool_namer import name_polygons
from app.services.tool_store import ToolStore
from app.services.tracer_registry import TRACER_LABELS, tracer_kind, validate_tracer_ids

router = APIRouter()

# Heuristic mismatch score combining a label penalty with bbox and point deltas measured in mm.
SOURCE_POLYGON_MATCH_MAX_SCORE = 80.0

# Fail fast for misspelled TRACERS values without loading local model weights.
validate_tracer_ids(settings.available_tracers)

# per-user store registry
_store_cache: dict[str, tuple[SessionStore, ToolStore, BinStore]] = {}
_project_store_cache: dict[str, ProjectStore] = {}

# serialises store creation against user deletion so a store cannot be
# built from files that are mid-rmtree (issue #160). locks are never
# removed; the dict is bounded by the number of user ids seen.
_user_locks: dict[str, threading.Lock] = {}
_user_locks_guard = threading.Lock()


def user_lock(user_id: str) -> threading.Lock:
    with _user_locks_guard:
        return _user_locks.setdefault(user_id, threading.Lock())


def get_stores(user_id: str) -> tuple[SessionStore, ToolStore, BinStore]:
    with user_lock(user_id):
        if user_id not in _store_cache:
            user_path = settings.storage_path / user_id
            ensure_user_dirs(user_path)
            _store_cache[user_id] = (
                SessionStore(user_path),
                ToolStore(user_path),
                BinStore(user_path),
            )
        return _store_cache[user_id]


def get_project_store(user_id: str) -> ProjectStore:
    with user_lock(user_id):
        if user_id not in _project_store_cache:
            user_path = settings.storage_path / user_id
            ensure_user_dirs(user_path)
            _project_store_cache[user_id] = ProjectStore(user_path)
        return _project_store_cache[user_id]


def _user_path(user_id: str) -> Path:
    # defence-in-depth: even if get_user_id is bypassed, block escaping storage root
    result = (settings.storage_path / user_id).resolve()
    if not result.is_relative_to(settings.storage_path.resolve()):
        raise HTTPException(status_code=400, detail="invalid user path")
    return result


ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif"}
MAX_UPLOAD_DIM = 2048


image_processor = ImageProcessor()

# one AITracer per local model so each can cache its loaded model
_tracers: dict[str, AITracer] = {}


def _remote_token(tracer_id: str) -> str | None:
    return settings.replicate_api_token if tracer_id == "replicate" else settings.fal_key


def _get_tracer(tracer_id: str | None = None) -> AITracer:
    """get or create a tracer for the given ID."""
    tid = tracer_id or settings.available_tracers[0]
    if tid not in _tracers:
        kind = tracer_kind(tid)
        if kind == "gemini":
            _tracers[tid] = AITracer(
                model=settings.gemini_image_model,
                openrouter_key=settings.openrouter_api_key,
                openrouter_image_model=settings.openrouter_image_model,
            )
        elif kind == "remote":
            token = _remote_token(tid)
            model = settings.replicate_model if tid == "replicate" else settings.fal_model
            _tracers[tid] = AITracer(
                saliency_tracer=tid,
                remote_model=model,
                remote_token=token,
                fal_operating_resolution=settings.fal_operating_resolution,
                replicate_resolution=settings.replicate_resolution,
            )
        else:
            _tracers[tid] = AITracer(saliency_tracer=tid)
    return _tracers[tid]


polygon_scaler = PolygonScaler()
stl_generator = ManifoldSTLGenerator()


def _rel(abs_path: str | Path, user_path: Path) -> str:
    """store path relative to storage root (includes user_id prefix)"""
    return str(Path(abs_path).resolve().relative_to(Path(settings.storage_path).resolve()))


def _abs(rel_path: str | None) -> str | None:
    """resolve stored relative path back to absolute"""
    if not rel_path:
        return None
    return str(settings.storage_path / rel_path)


def _translate_points(points: list[Point], dx: float, dy: float) -> list[Point]:
    return [Point(x=p.x + dx, y=p.y + dy) for p in points]


def _translate_finger_holes(holes: list[FingerHole], dx: float, dy: float) -> list[FingerHole]:
    return [
        FingerHole(
            id=fh.id, x=fh.x + dx, y=fh.y + dy,
            radius=fh.radius, width=fh.width, height=fh.height,
            rotation=fh.rotation, shape=fh.shape,
            depth_override=fh.depth_override,
        )
        for fh in holes
    ]


def _polygon_source_transform(poly: Polygon, scale_factor: float) -> tuple[float, float] | None:
    """return image-pixel origin in the centered tool's mm coordinate space."""
    points_mm = [(p.x * scale_factor, p.y * scale_factor) for p in poly.points]
    if not points_mm:
        return None
    xs = [p[0] for p in points_mm]
    ys = [p[1] for p in points_mm]
    cx = (min(xs) + max(xs)) / 2
    cy = (min(ys) + max(ys)) / 2
    return -cx, -cy


def _bounds_mm(points: list[Point]) -> tuple[float, float, float, float] | None:
    if not points:
        return None
    xs = [p.x for p in points]
    ys = [p.y for p in points]
    return min(xs), min(ys), max(xs), max(ys)


def _source_polygon_score(tool: Tool, candidate: list[Point], label: str) -> float:
    score = 0.0 if label == tool.name else 25.0
    tool_bounds = _bounds_mm(tool.points)
    candidate_bounds = _bounds_mm(candidate)
    if tool_bounds and candidate_bounds:
        tool_min_x, tool_min_y, tool_max_x, tool_max_y = tool_bounds
        cand_min_x, cand_min_y, cand_max_x, cand_max_y = candidate_bounds
        score += abs((tool_max_x - tool_min_x) - (cand_max_x - cand_min_x))
        score += abs((tool_max_y - tool_min_y) - (cand_max_y - cand_min_y))
    if len(tool.points) == len(candidate):
        total = 0.0
        for a, b in zip(tool.points, candidate):
            total += math.hypot(a.x - b.x, a.y - b.y)
        score += total / max(1, len(candidate))
    else:
        score += min(30.0, abs(len(tool.points) - len(candidate)) * 0.5)
    return score


def _find_source_polygon(tool: Tool, session: Session) -> Polygon | None:
    if not session.polygons:
        return None
    if tool.source_polygon_id:
        for poly in session.polygons:
            if poly.id == tool.source_polygon_id:
                return poly
    if not session.scale_factor:
        return None

    best: tuple[float, Polygon] | None = None
    for poly in session.polygons:
        centered, _, _ = polygon_scaler.scale_and_centre(poly, session.scale_factor)
        if not centered:
            continue
        score = _source_polygon_score(tool, centered, poly.label)
        if best is None or score < best[0]:
            best = (score, poly)

    return best[1] if best and best[0] < SOURCE_POLYGON_MATCH_MAX_SCORE else None


def _tool_image_context(tool: Tool, sessions: SessionStore, load_missing_dimensions: bool = True) -> tuple[dict, bool] | tuple[None, bool]:
    updated = False
    image_path = tool.source_image_path
    width = tool.source_image_width
    height = tool.source_image_height
    transform = tool.source_image_transform if tool.source_image_transform and len(tool.source_image_transform) == 6 else None

    if (
        (not image_path or transform is None)
        and tool.source_session_id
    ):
        session = sessions.get(tool.source_session_id)
        if session and session.corrected_image_path and session.scale_factor:
            poly = _find_source_polygon(tool, session)
            source_origin = _polygon_source_transform(poly, session.scale_factor) if poly else None
            if source_origin:
                image_path = session.corrected_image_path
                if tool.source_image_path != image_path:
                    tool.source_image_path = image_path
                    updated = True
                transform = [
                    session.scale_factor, 0.0, 0.0, session.scale_factor,
                    source_origin[0], source_origin[1],
                ]
                if tool.source_image_transform != transform:
                    tool.source_image_transform = transform
                    updated = True

    if not image_path or transform is None:
        return None, updated

    abs_path = _abs(image_path)
    if not abs_path or not Path(abs_path).exists():
        return None, updated

    if width is None or height is None:
        if not load_missing_dimensions:
            return None, updated
        try:
            with Image.open(abs_path) as img:
                width, height = img.size
            if tool.source_image_width != width or tool.source_image_height != height:
                tool.source_image_width = width
                tool.source_image_height = height
                updated = True
        except Exception:
            return None, updated

    return {
        "image_url": f"/storage/{image_path}",
        "image_width": width,
        "image_height": height,
        "origin_x_mm": transform[4],
        "origin_y_mm": transform[5],
        "scale_factor": math.hypot(transform[0], transform[1]),
        "transform": transform,
    }, updated


def _now_iso() -> str:
    return datetime.utcnow().isoformat()


def _build_bin_from_tools(
    bin_id: str,
    name: str | None,
    project_id: str | None,
    tool_ids: list[str],
    user_tools: ToolStore,
    default_config: BinDefaults | None = None,
) -> BinModel:
    placed: list[PlacedTool] = []
    all_points_mm: list[tuple[float, float]] = []

    for tool_id in tool_ids:
        tool = user_tools.get(tool_id)
        if not tool:
            raise HTTPException(status_code=404, detail=f"tool {tool_id} not found")

        all_points_mm.extend([(p.x, p.y) for p in tool.points])
        placed.append(PlacedTool(
            id=str(uuid.uuid4()),
            tool_id=tool_id,
            name=tool.name,
            points=list(tool.points),
            finger_holes=list(tool.finger_holes),
            interior_rings=list(tool.interior_rings),
        ))

    bc = BinConfig(**default_config.model_dump(exclude={"text_labels"}), text_labels=[]) if default_config else BinConfig()
    if all_points_mm:
        all_xs = [p[0] for p in all_points_mm]
        all_ys = [p[1] for p in all_points_mm]
        tool_width = max(all_xs) - min(all_xs)
        tool_height = max(all_ys) - min(all_ys)

        clearance = bc.cutout_clearance
        wall = bc.wall_thickness
        needed_w = tool_width + 2 * clearance + 2 * wall + 0.5
        needed_h = tool_height + 2 * clearance + 2 * wall + 0.5

        # snap to 0.5 units when half-grid is on, whole units otherwise
        if bc.half_grid_base:
            half = GF_GRID / 2
            grid_x = max(1.0, math.ceil(needed_w / half) * 0.5)
            grid_y = max(1.0, math.ceil(needed_h / half) * 0.5)
        else:
            grid_x = max(1.0, math.ceil(needed_w / GF_GRID))
            grid_y = max(1.0, math.ceil(needed_h / GF_GRID))
        bc.grid_x = min(grid_x, 10.0)
        bc.grid_y = min(grid_y, 10.0)
        bc.partial_bins_values = [True] * (math.ceil(bc.grid_x) * math.ceil(bc.grid_y))

        bin_w = bc.grid_x * GF_GRID
        bin_h = bc.grid_y * GF_GRID
        bbox_cx = (min(all_xs) + max(all_xs)) / 2
        bbox_cy = (min(all_ys) + max(all_ys)) / 2
        offset_x = bin_w / 2 - bbox_cx
        offset_y = bin_h / 2 - bbox_cy
        for pt in placed:
            pt.points = _translate_points(pt.points, offset_x, offset_y)
            pt.finger_holes = _translate_finger_holes(pt.finger_holes, offset_x, offset_y)
            pt.interior_rings = [_translate_points(ring, offset_x, offset_y) for ring in pt.interior_rings]

    return BinModel(
        id=bin_id,
        name=name,
        project_id=project_id,
        bin_config=bc,
        placed_tools=placed,
        created_at=_now_iso(),
    )


def _run_generate(
    scaled: list[ScaledPolygon],
    gen_req: GenerateRequest,
    entity_id: str,
    user_path: Path,
    input_hash: str,
    user_id: str,
    store: SessionStore | BinStore,
) -> GenerateResponse:
    """shared STL generation with caching, splitting, and zipping"""
    # in-flight guard: the request captured its store before any awaits or
    # threadpool hops; refuse to write outputs once the user is deleted
    store.ensure_open()
    output_path = user_path / "outputs" / f"{entity_id}.stl"
    hash_path = user_path / "outputs" / f"{entity_id}.hash"
    threemf_path = user_path / "outputs" / f"{entity_id}.3mf"
    zip_path = user_path / "outputs" / f"{entity_id}_parts.zip"
    insert_path = user_path / "outputs" / f"{entity_id}_insert.stl"

    if output_path.exists() and hash_path.exists() and hash_path.read_text() == input_hash:
        part_paths = sorted(user_path.glob(f"outputs/{entity_id}_part*.stl"))
        stl_urls = [f"/storage/{user_id}/outputs/{p.name}" for p in part_paths]
        insert_stl_url = (
            f"/storage/{user_id}/outputs/{entity_id}_insert.stl"
            if insert_path.exists() else None
        )
        cached_warning = None
        if getattr(gen_req, 'insert_enabled', False) and not insert_path.exists():
            cached_warning = "Insert generation failed. Try re-tracing the tools or adjusting their placement."
        return GenerateResponse(
            stl_url=f"/storage/{user_id}/outputs/{entity_id}.stl",
            stl_urls=stl_urls,
            threemf_url=f"/storage/{user_id}/outputs/{entity_id}.3mf" if threemf_path.exists() else None,
            split_count=max(1, len(stl_urls)),
            zip_url=f"/storage/{user_id}/outputs/{entity_id}_parts.zip" if zip_path.exists() else None,
            insert_stl_url=insert_stl_url,
            warning=cached_warning,
        )

    threemf_path.unlink(missing_ok=True)
    for old in user_path.glob(f"outputs/{entity_id}_part*.stl"):
        old.unlink(missing_ok=True)
    zip_path.unlink(missing_ok=True)
    insert_path.unlink(missing_ok=True)

    bin_body, text_body = stl_generator.generate_bin(scaled, gen_req, str(output_path), str(threemf_path))

    stl_urls: list[str] = []
    zip_url = None
    output_dir = str(user_path / "outputs")
    part_paths = stl_generator.export_split_parts(
        bin_body, text_body, gen_req, gen_req.bed_size, output_dir, entity_id
    )
    if part_paths:
        stl_urls = [f"/storage/{user_id}/outputs/{Path(p).name}" for p in part_paths]
        part_bytes = [(Path(p).name, Path(p).read_bytes()) for p in part_paths]
        with zipfile.ZipFile(str(zip_path), 'w', zipfile.ZIP_DEFLATED) as zf:
            for fname, data in part_bytes:
                zf.writestr(fname, data)
        zip_url = f"/storage/{user_id}/outputs/{entity_id}_parts.zip"

    insert_stl_url = None
    warning = None
    if getattr(gen_req, 'insert_enabled', False) and scaled:
        bin_width = gen_req.grid_x * GF_GRID
        bin_depth = gen_req.grid_y * GF_GRID
        offset_x = -bin_width / 2
        offset_y = -bin_depth / 2
        try:
            success = stl_generator.generate_insert(scaled, gen_req, str(insert_path), offset_x, offset_y)
        except Exception:
            logger.exception("insert generation crashed")
            success = False
        if success:
            insert_stl_url = f"/storage/{user_id}/outputs/{entity_id}_insert.stl"
            if zip_path.exists():
                with zipfile.ZipFile(str(zip_path), 'a') as zf:
                    zf.write(str(insert_path), f"{entity_id}_insert.stl")
            else:
                with zipfile.ZipFile(str(zip_path), 'w', zipfile.ZIP_DEFLATED) as zf:
                    zf.write(str(output_path), f"{entity_id}.stl")
                    zf.write(str(insert_path), f"{entity_id}_insert.stl")
                zip_url = f"/storage/{user_id}/outputs/{entity_id}_parts.zip"
        else:
            warning = "Insert generation failed. Try re-tracing the tools or adjusting their placement."

    hash_path.write_text(input_hash)

    threemf_url = None
    if threemf_path.exists():
        threemf_url = f"/storage/{user_id}/outputs/{entity_id}.3mf"

    return GenerateResponse(
        stl_url=f"/storage/{user_id}/outputs/{entity_id}.stl",
        stl_urls=stl_urls,
        threemf_url=threemf_url,
        split_count=max(1, len(stl_urls)),
        zip_url=zip_url,
        insert_stl_url=insert_stl_url,
        warning=warning,
    )


@router.post("/upload", response_model=UploadResponse)
async def upload_image(request: Request, image: UploadFile, user_id: str = Depends(get_user_id)):
    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="file must be an image")

    user_sessions, _, _ = get_stores(user_id)
    up = _user_path(user_id)

    session_id = str(uuid.uuid4())
    ext = Path(image.filename or "image.jpg").suffix.lower() or ".jpg"
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(status_code=400, detail="unsupported image format")

    max_bytes = settings.max_upload_mb * 1024 * 1024
    content = await image.read()
    if len(content) > max_bytes:
        raise HTTPException(status_code=413, detail=f"file too large (max {settings.max_upload_mb}MB)")

    # exif is dropped when the image is re-encoded, so read it first
    focal_length = extract_focal_length_35mm(content)

    content, ext, _ = ingest_image(content, ext, MAX_UPLOAD_DIM)
    image_path = up / "uploads" / f"{session_id}{ext}"
    # the awaited read can outlive a concurrent account deletion; refuse
    # to write into the deleted user's tree
    user_sessions.ensure_open()
    image_path.write_bytes(content)

    corners = image_processor.detect_paper_corners(str(image_path))
    corner_points = [Point(x=c[0], y=c[1]) for c in corners] if corners else None

    user_sessions.set(session_id, Session(
        id=session_id,
        created_at=datetime.utcnow().isoformat(),
        original_image_path=_rel(image_path, up),
        corners=corner_points,
        focal_length_35mm=focal_length,
    ))

    return UploadResponse(
        session_id=session_id,
        image_url=f"/storage/{user_id}/uploads/{session_id}{ext}",
        detected_corners=corner_points,
    )


@router.post("/sessions/{session_id}/corners", response_model=CornersResponse)
async def set_corners(request: Request, session_id: str, req: CornersRequest, user_id: str = Depends(get_user_id)):
    user_sessions, _, _ = get_stores(user_id)
    session = user_sessions.get(session_id)
    if not session or not session.original_image_path:
        raise HTTPException(status_code=404, detail="session not found")

    corners = [(p.x, p.y) for p in req.corners]

    # advisory photo checks run against the original before it is deleted
    photo_warnings = []
    try:
        with Image.open(_abs(session.original_image_path)) as im:
            img_w, img_h = im.size
        photo_warnings = check_photo(
            corners, img_w, img_h, req.paper_size, session.focal_length_35mm
        )
    except Exception:
        logger.exception("photo checks skipped")

    output_path, scale_factor = image_processor.apply_perspective_correction(
        _abs(session.original_image_path), corners, req.paper_size
    )

    # resize the corrected image to save storage; adjust scale_factor so
    # pixel→mm conversion stays correct after the image shrinks.
    corrected_bytes = Path(output_path).read_bytes()
    ext = Path(output_path).suffix
    corrected_bytes, _, ds_ratio = ingest_image(corrected_bytes, ext, MAX_UPLOAD_DIM)
    Path(output_path).write_bytes(corrected_bytes)
    if ds_ratio < 1.0:
        scale_factor /= ds_ratio

    # original upload is no longer needed
    orig = _abs(session.original_image_path)
    if orig:
        Path(orig).unlink(missing_ok=True)

    up = _user_path(user_id)
    session.corrected_image_path = _rel(output_path, up)
    session.original_image_path = None
    session.corners = req.corners
    session.paper_size = req.paper_size
    session.scale_factor = scale_factor
    session.photo_warnings = photo_warnings or None
    user_sessions.set(session_id, session)

    return CornersResponse(
        corrected_image_url=f"/storage/{session.corrected_image_path}",
        scale_factor=scale_factor,
        warnings=photo_warnings,
    )


@router.get("/version")
async def get_version():
    """return the running app version (baked into the image, "dev" locally).

    404 when SHOW_APP_VERSION=false so nothing is disclosed.
    """
    if not settings.show_app_version:
        raise HTTPException(status_code=404)
    return {"version": settings.app_version}


@router.get("/api-keys")
async def get_available_keys(request: Request):
    """return available tracers and provider info."""
    tracers = settings.available_tracers
    has_cloud = bool(settings.google_api_key) or bool(settings.openrouter_api_key)
    has_saliency = settings.primary_is_saliency
    primary = tracers[0] if tracers else None
    return {
        # google: server can trace without a user-supplied key (cloud env key, local, or remote)
        "google": has_cloud or has_saliency,
        "provider": tracer_kind(primary) if primary else None,
        "provider_label": TRACER_LABELS.get(primary, primary) if primary else None,
        "tracers": [
            {"id": t, "label": TRACER_LABELS.get(t, t)}
            for t in tracers
        ],
    }


@router.post("/sessions/{session_id}/trace", response_model=TraceResponse)
async def trace_tools(
    request: Request,
    session_id: str,
    req: TraceRequest,
    user_id: str = Depends(get_user_id),
):
    user_sessions, _, _ = get_stores(user_id)
    session = user_sessions.get(session_id)
    if not session or not session.corrected_image_path:
        raise HTTPException(status_code=400, detail="must set corners first")

    tracer_id = req.tracer or settings.available_tracers[0]
    if tracer_id not in settings.available_tracers:
        raise HTTPException(status_code=400, detail=f"tracer '{tracer_id}' not available")

    api_key = settings.google_api_key or req.api_key
    if tracer_id == "gemini" and not api_key and not settings.openrouter_api_key:
        raise HTTPException(status_code=400, detail="no api key provided")

    if tracer_kind(tracer_id) == "remote":
        if not _remote_token(tracer_id):
            env = "REPLICATE_API_TOKEN" if tracer_id == "replicate" else "FAL_KEY"
            raise HTTPException(status_code=400, detail=f"{tracer_id} token not set; set {env}")

    up = _user_path(user_id)
    mask_output_path = str(up / "processed" / f"{session_id}_mask.png")

    tracer = _get_tracer(tracer_id)
    corrected_image_path = _abs(session.corrected_image_path)
    try:
        polygons, mask_path = await tracer.trace_tools(
            corrected_image_path,
            api_key,
            mask_output_path,
            # abort the mask write (and the dir recreation it implies) if
            # the user was deleted while the model call was in flight
            before_mask_write=user_sessions.ensure_open,
        )
    except StoreClosedError:
        raise
    except TimeoutError:
        label = TRACER_LABELS.get(tracer_id, tracer_id)
        logging.warning("%s timed out", tracer_id)
        raise HTTPException(status_code=504, detail=f"{label} timed out; the model may be overloaded. Try again shortly.")
    except Exception as e:
        error_msg = str(e)
        if "insufficient_quota" in error_msg or "exceeded" in error_msg.lower():
            raise HTTPException(status_code=402, detail="API quota exceeded - check your billing")
        if "invalid_api_key" in error_msg or "Incorrect API key" in error_msg:
            raise HTTPException(status_code=401, detail="Invalid API key")
        if "rate_limit" in error_msg.lower():
            raise HTTPException(status_code=429, detail="Rate limited - try again shortly")
        if tracer_kind(tracer_id) == "remote":
            label = TRACER_LABELS.get(tracer_id, tracer_id)
            logging.error("%s provider error: %s", tracer_id, error_msg[:500], exc_info=True)
            raise HTTPException(status_code=502, detail=f"{label} provider error; try again shortly.")
        logging.error("ai tracing failed: %s", error_msg[:500], exc_info=True)
        detail = f"AI tracing failed ({type(e).__name__}: {error_msg[:200]})"
        raise HTTPException(status_code=500, detail=detail)

    polygons = await name_polygons(corrected_image_path, polygons)
    session.polygons = polygons
    session.mask_image_path = _rel(mask_path, up) if mask_path else None
    user_sessions.set(session_id, session)

    mask_url = None
    if mask_path:
        mask_url = f"/storage/{user_id}/processed/{session_id}_mask.png"

    return TraceResponse(polygons=polygons, mask_url=mask_url)


@router.post("/sessions/{session_id}/trace-mask", response_model=TraceResponse)
async def trace_from_mask(
    request: Request,
    session_id: str,
    mask: UploadFile,
    user_id: str = Depends(get_user_id),
):
    """trace contours from a user-uploaded mask image"""
    user_sessions, _, _ = get_stores(user_id)
    session = user_sessions.get(session_id)
    if not session or not session.corrected_image_path:
        raise HTTPException(status_code=400, detail="must set corners first")

    if not mask.content_type or not mask.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="file must be an image")

    up = _user_path(user_id)

    content = await mask.read()
    mask_ext = Path(mask.filename or "mask.png").suffix.lower() or ".png"
    if mask_ext not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(status_code=400, detail="unsupported image format")
    content, mask_ext, _ = ingest_image(content, mask_ext)
    mask_path = up / "processed" / f"{session_id}_mask.png"
    # the awaited read can outlive a concurrent account deletion; refuse
    # to write into the deleted user's tree
    user_sessions.ensure_open()
    mask_path.write_bytes(content)

    corrected_image_path = _abs(session.corrected_image_path)
    contours = _get_tracer()._trace_mask(str(mask_path), corrected_image_path)

    if not contours:
        raise HTTPException(status_code=400, detail="no tool outlines found in mask")

    polygons = []
    for i, (exterior, holes) in enumerate(contours):
        polygons.append(Polygon(
            id=str(uuid.uuid4()),
            points=[Point(x=p[0], y=p[1]) for p in exterior],
            interior_rings=[[Point(x=p[0], y=p[1]) for p in hole] for hole in holes],
            label=f"tool {i + 1}",
        ))

    polygons = await name_polygons(corrected_image_path, polygons)
    session.polygons = polygons
    session.mask_image_path = _rel(mask_path, up)
    user_sessions.set(session_id, session)

    return TraceResponse(
        polygons=polygons,
        mask_url=f"/storage/{user_id}/processed/{session_id}_mask.png"
    )


@router.put("/sessions/{session_id}/polygons", response_model=StatusResponse)
async def update_polygons(request: Request, session_id: str, req: PolygonsRequest, user_id: str = Depends(get_user_id)):
    user_sessions, _, _ = get_stores(user_id)
    session = user_sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session not found")

    session.polygons = req.polygons
    user_sessions.set(session_id, session)
    return StatusResponse(status="ok")


@router.post("/sessions/{session_id}/generate", response_model=GenerateResponse)
def generate_stl(request: Request, session_id: str, req: GenerateRequest, user_id: str = Depends(get_user_id)):
    user_sessions, _, _ = get_stores(user_id)
    up = _user_path(user_id)
    session = user_sessions.get(session_id)
    if not session or not session.scale_factor:
        raise HTTPException(status_code=400, detail="must trace tools first")

    polygons = req.polygons if req.polygons else session.polygons
    if not polygons:
        raise HTTPException(status_code=400, detail="no polygons to generate from")

    input_hash = hashlib.md5(json.dumps(req.model_dump(), sort_keys=True, default=str).encode()).hexdigest()

    scaled = polygon_scaler.scale_to_mm(polygons, session.scale_factor)
    scaled = [
        polygon_scaler.prepare_for_generation(p, req.cutout_clearance, smoothed=False)
        for p in scaled
    ]

    response = _run_generate(scaled, req, session_id, up, input_hash, user_id, user_sessions)

    output_path = up / "outputs" / f"{session_id}.stl"
    fresh_session = user_sessions.get(session_id)
    if fresh_session:
        fresh_session.stl_path = _rel(output_path, up)
        user_sessions.set(session_id, fresh_session)

    return response


@router.get("/sessions", response_model=SessionListResponse)
async def list_sessions(request: Request, user_id: str = Depends(get_user_id)):
    user_sessions, _, _ = get_stores(user_id)
    all_sessions = user_sessions.all()
    summaries = []
    for sid, session in all_sessions.items():
        thumbnail_url = None
        if session.corrected_image_path:
            thumbnail_url = f"/storage/{session.corrected_image_path}"
        elif session.original_image_path:
            thumbnail_url = f"/storage/{session.original_image_path}"

        summaries.append(SessionSummary(
            id=sid,
            name=session.name,
            description=session.description,
            tags=session.tags or [],
            created_at=session.created_at,
            thumbnail_url=thumbnail_url,
            tool_count=len(session.polygons) if session.polygons else 0,
            has_stl=session.stl_path is not None,
        ))

    summaries.sort(key=lambda s: s.created_at or "", reverse=True)
    return SessionListResponse(sessions=summaries)


@router.get("/sessions/{session_id}")
async def get_session(request: Request, session_id: str, user_id: str = Depends(get_user_id)):
    user_sessions, _, _ = get_stores(user_id)
    session = user_sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session not found")
    return session


@router.patch("/sessions/{session_id}", response_model=StatusResponse)
async def update_session(request: Request, session_id: str, req: SessionUpdateRequest, user_id: str = Depends(get_user_id)):
    user_sessions, _, _ = get_stores(user_id)
    session = user_sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session not found")

    if req.name is not None:
        session.name = req.name
    if req.description is not None:
        session.description = req.description
    if req.tags is not None:
        session.tags = req.tags
    if req.layout is not None:
        session.layout = req.layout
    user_sessions.set(session_id, session)
    return StatusResponse(status="ok")


@router.delete("/sessions/{session_id}", response_model=StatusResponse)
async def delete_session(request: Request, session_id: str, user_id: str = Depends(get_user_id)):
    user_sessions, _, _ = get_stores(user_id)
    up = _user_path(user_id)
    session = user_sessions.delete(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session not found")

    for rel in [
        session.original_image_path,
        session.corrected_image_path,
        session.stl_path,
    ]:
        p = _abs(rel)
        if p:
            Path(p).unlink(missing_ok=True)

    if session.stl_path:
        Path(_abs(session.stl_path)).with_suffix(".3mf").unlink(missing_ok=True)
        for part_file in up.glob(f"outputs/{session_id}_part*.stl"):
            part_file.unlink(missing_ok=True)
        zip_path = up / "outputs" / f"{session_id}_parts.zip"
        zip_path.unlink(missing_ok=True)

    return StatusResponse(status="deleted")


@router.get("/sessions/{session_id}/debug")
async def debug_session(request: Request, session_id: str, user_id: str = Depends(get_user_id)):
    """generate debug images showing contour detection steps"""
    user_sessions, _, _ = get_stores(user_id)
    up = _user_path(user_id)
    session = user_sessions.get(session_id)
    if not session or not session.corrected_image_path:
        raise HTTPException(status_code=404, detail="session not found or no corrected image")

    debug_dir = up / "debug" / session_id
    debug_dir.mkdir(parents=True, exist_ok=True)

    results = image_processor.debug_contour_detection(
        _abs(session.corrected_image_path), debug_dir
    )

    for key in results:
        if isinstance(results[key], str) and results[key].endswith(".jpg"):
            results[key] = f"/storage/{user_id}/debug/{session_id}/{results[key]}"

    return results


@router.get("/files/{session_id}/bin.stl")
async def download_stl(request: Request, session_id: str, user_id: str = Depends(get_user_id)):
    user_sessions, _, _ = get_stores(user_id)
    session = user_sessions.get(session_id)
    if not session or not session.stl_path:
        raise HTTPException(status_code=404, detail="stl not found")

    return FileResponse(
        _abs(session.stl_path),
        media_type="application/sla",
        filename=f"tracefinity-{session_id[:8]}.stl",
    )


@router.get("/files/{session_id}/bin_parts.zip")
async def download_zip(request: Request, session_id: str, user_id: str = Depends(get_user_id)):
    up = _user_path(user_id)
    zip_path = up / "outputs" / f"{session_id}_parts.zip"
    if not zip_path.exists():
        raise HTTPException(status_code=404, detail="zip not found")

    return FileResponse(
        str(zip_path),
        media_type="application/zip",
        filename=f"tracefinity-{session_id[:8]}-parts.zip",
    )


@router.get("/files/{session_id}/bin.3mf")
async def download_threemf(request: Request, session_id: str, user_id: str = Depends(get_user_id)):
    user_sessions, _, _ = get_stores(user_id)
    session = user_sessions.get(session_id)
    if not session or not session.stl_path:
        raise HTTPException(status_code=404, detail="3mf not found")

    threemf_path = Path(_abs(session.stl_path)).with_suffix(".3mf")
    if not threemf_path.exists():
        raise HTTPException(status_code=404, detail="3mf not found")

    return FileResponse(
        str(threemf_path),
        media_type="application/vnd.ms-package.3dmanufacturing-3dmodel+xml",
        filename=f"tracefinity-{session_id[:8]}.3mf",
    )


# --- tool library ---


@router.get("/tools", response_model=ToolListResponse)
async def list_tools(request: Request, user_id: str = Depends(get_user_id)):
    user_sessions, user_tools, _ = get_stores(user_id)
    all_tools = user_tools.all()
    summaries = []
    for tid, tool in all_tools.items():
        thumb_url = None
        if tool.thumbnail_path and Path(_abs(tool.thumbnail_path)).exists():
            thumb_url = f"/storage/{tool.thumbnail_path}"
        image_context, _ = _tool_image_context(tool, user_sessions, load_missing_dimensions=False)
        summaries.append(ToolSummary(
            id=tid,
            name=tool.name,
            created_at=tool.created_at,
            point_count=len(tool.points),
            points=tool.points,
            interior_rings=tool.interior_rings,
            smoothed=tool.smoothed,
            smooth_level=tool.smooth_level,
            thumbnail_url=thumb_url,
            image_transform=tool.source_image_transform,
            image_context=image_context,
            category=tool.category,
            drawer=tool.drawer,
            tags=tool.tags,
            project_ids=tool.project_ids,
            review_status=tool.review_status,
            needs_cleanup=tool.needs_cleanup,
        ))
    summaries.sort(key=lambda t: t.created_at or "", reverse=True)
    return ToolListResponse(tools=summaries)


@router.get("/tools/{tool_id}", response_model=ToolDetailResponse)
async def get_tool(request: Request, tool_id: str, user_id: str = Depends(get_user_id)):
    user_sessions, user_tools, _ = get_stores(user_id)
    tool = user_tools.get(tool_id)
    if not tool:
        raise HTTPException(status_code=404, detail="tool not found")
    data = tool.model_dump()
    image_context, updated = _tool_image_context(tool, user_sessions)
    if updated:
        user_tools.set(tool_id, tool)
        data = tool.model_dump()
    data["image_context"] = image_context
    return data


@router.put("/tools/{tool_id}", response_model=StatusResponse)
async def update_tool(request: Request, tool_id: str, req: ToolUpdateRequest, user_id: str = Depends(get_user_id)):
    _, user_tools, _ = get_stores(user_id)
    tool = user_tools.get(tool_id)
    if not tool:
        raise HTTPException(status_code=404, detail="tool not found")

    if req.name is not None:
        tool.name = req.name
    if req.points is not None:
        tool.points = req.points
    if req.finger_holes is not None:
        tool.finger_holes = req.finger_holes
    if req.interior_rings is not None:
        tool.interior_rings = req.interior_rings
    if req.smoothed is not None:
        tool.smoothed = req.smoothed
    if req.smooth_level is not None:
        tool.smooth_level = req.smooth_level
    if req.source_image_transform is not None:
        tool.source_image_transform = req.source_image_transform
    if "category" in req.model_fields_set:
        tool.category = req.category
    if "drawer" in req.model_fields_set:
        tool.drawer = req.drawer
    if req.tags is not None:
        tool.tags = req.tags
    if req.project_ids is not None:
        tool.project_ids = req.project_ids
    if "review_status" in req.model_fields_set:
        tool.review_status = req.review_status
    if req.needs_cleanup is not None:
        tool.needs_cleanup = req.needs_cleanup
    user_tools.set(tool_id, tool)
    return StatusResponse(status="ok")


@router.post("/tools/{tool_id}/auto-rotate")
async def auto_rotate_tool(request: Request, tool_id: str, user_id: str = Depends(get_user_id)):
    _, user_tools, _ = get_stores(user_id)
    tool = user_tools.get(tool_id)
    if not tool or not tool.points:
        raise HTTPException(status_code=404, detail="tool not found")
    pts = [(p.x, p.y) for p in tool.points]
    angle = _optimal_rotation_angle(pts)
    return {"angle": angle}


@router.delete("/tools/{tool_id}", response_model=StatusResponse)
async def delete_tool(request: Request, tool_id: str, user_id: str = Depends(get_user_id)):
    _, user_tools, _ = get_stores(user_id)
    tool = user_tools.delete(tool_id)
    if not tool:
        raise HTTPException(status_code=404, detail="tool not found")
    return StatusResponse(status="deleted")


@router.get("/files/tools/{tool_id}/tool.svg")
async def download_tool_svg(request: Request, tool_id: str, user_id: str = Depends(get_user_id)):
    _, user_tools, _ = get_stores(user_id)
    tool = user_tools.get(tool_id)
    if not tool or not tool.points:
        raise HTTPException(status_code=404, detail="tool not found")

    points_mm = [(p.x, p.y) for p in tool.points]
    interior_rings_mm = [[(p.x, p.y) for p in ring] for ring in tool.interior_rings]
    fholes = [ScaledFingerHole(
        fh.id, fh.x, fh.y, fh.radius,
        shape=fh.shape, width_mm=fh.width, height_mm=fh.height,
        rotation=fh.rotation,
    ) for fh in tool.finger_holes]
    sp = ScaledPolygon(tool.id, points_mm, tool.name, fholes, interior_rings_mm)

    if tool.smoothed:
        sp = polygon_scaler.smooth(sp, level=tool.smooth_level)
    else:
        sp = polygon_scaler.simplify(sp)

    xs = [p[0] for p in sp.points_mm]
    ys = [p[1] for p in sp.points_mm]
    pad = 1.0
    min_x, max_x = min(xs) - pad, max(xs) + pad
    min_y, max_y = min(ys) - pad, max(ys) + pad
    w = max_x - min_x
    h = max_y - min_y

    # outer polygon
    pts = " ".join(f"{x:.4f},{y:.4f}" for x, y in sp.points_mm)
    paths = f'  <polygon points="{pts}" fill="black" stroke="none"/>\n'

    # interior holes
    for ring in sp.interior_rings_mm:
        ring_pts = " ".join(f"{x:.4f},{y:.4f}" for x, y in ring)
        paths += f'  <polygon points="{ring_pts}" fill="white" stroke="none"/>\n'

    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg"'
        f' width="{w:.4f}mm" height="{h:.4f}mm"'
        f' viewBox="{min_x:.4f} {min_y:.4f} {w:.4f} {h:.4f}">\n'
        f'{paths}'
        f'</svg>\n'
    )

    safe_name = tool.name.replace('"', '').replace('/', '-') if tool.name else "tool"
    return Response(
        content=svg,
        media_type="image/svg+xml",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_name}.svg"',
            "Cache-Control": "no-cache",
        },
    )


@router.post("/sessions/{session_id}/save-tools", response_model=SaveToolsResponse)
async def save_tools_from_session(request: Request, session_id: str, body: SaveToolsRequest = SaveToolsRequest(), user_id: str = Depends(get_user_id)):
    """convert session polygons to library tools (px -> mm, centered at origin)"""
    user_sessions, user_tools, _ = get_stores(user_id)
    up = _user_path(user_id)
    session = user_sessions.get(session_id)
    if not session or not session.scale_factor or not session.polygons:
        raise HTTPException(status_code=400, detail="session has no traced polygons")

    sf = session.scale_factor
    tool_ids = []

    polys = session.polygons
    if body.polygon_ids is not None:
        id_set = set(body.polygon_ids)
        polys = [p for p in polys if p.id in id_set]

    src_img = None
    if session.corrected_image_path:
        try:
            src_img = Image.open(_abs(session.corrected_image_path))
        except Exception:
            pass

    for poly in polys:
        centered, fholes, interior_rings = polygon_scaler.scale_and_centre(poly, sf)
        if not centered:
            continue

        tool_id = str(uuid.uuid4())
        source_transform = _polygon_source_transform(poly, sf)

        thumbnail_path = None
        if src_img:
            thumb_abs = generate_tool_thumbnail(src_img, poly.points, tool_id, up / "tools")
            if thumb_abs:
                thumbnail_path = _rel(thumb_abs, up)

        user_tools.set(tool_id, Tool(
            id=tool_id,
            name=poly.label,
            points=centered,
            finger_holes=fholes,
            interior_rings=interior_rings,
            source_session_id=session_id,
            source_polygon_id=poly.id,
            source_image_path=session.corrected_image_path,
            source_image_width=src_img.width if src_img else None,
            source_image_height=src_img.height if src_img else None,
            source_image_transform=(
                [sf, 0.0, 0.0, sf, source_transform[0], source_transform[1]]
                if source_transform else None
            ),
            thumbnail_path=thumbnail_path,
            created_at=datetime.utcnow().isoformat(),
        ))
        tool_ids.append(tool_id)

    return SaveToolsResponse(tool_ids=tool_ids)


# --- bin projects ---

@router.get("/bin-projects", response_model=BinProjectListResponse)
async def list_bin_projects(request: Request, user_id: str = Depends(get_user_id)):
    project_store = get_project_store(user_id)
    _, _, user_bins = get_stores(user_id)
    summaries = [
        make_project_summary(project, user_bins)
        for project in project_store.all().values()
    ]
    summaries.sort(key=lambda p: p.updated_at or p.created_at or "", reverse=True)
    return BinProjectListResponse(projects=summaries)


@router.post("/bin-projects", response_model=BinProject)
async def create_bin_project(request: Request, req: BinProjectCreateRequest, user_id: str = Depends(get_user_id)):
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="project name is required")

    project_store = get_project_store(user_id)
    _, user_tools, _ = get_stores(user_id)
    for tool_id in req.tool_ids:
        if not user_tools.get(tool_id):
            raise HTTPException(status_code=404, detail=f"tool {tool_id} not found")

    project_id = str(uuid.uuid4())
    now = _now_iso()
    project = BinProject(
        id=project_id,
        name=name,
        description=req.description,
        status=req.status,
        tool_ids=list(dict.fromkeys(req.tool_ids)),
        target_grid_x=req.target_grid_x,
        target_grid_y=req.target_grid_y,
        default_bin_config=req.default_bin_config,
        notes=req.notes,
        created_at=now,
        updated_at=now,
    )
    project_store.set(project_id, project)
    add_project_to_tools(project_id, project.tool_ids, user_tools)
    return project


@router.get("/bin-projects/{project_id}", response_model=BinProjectDetail)
async def get_bin_project(request: Request, project_id: str, user_id: str = Depends(get_user_id)):
    project = get_project_store(user_id).get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="project not found")
    _, _, user_bins = get_stores(user_id)
    return make_project_detail(project, user_bins)


@router.patch("/bin-projects/{project_id}", response_model=BinProjectDetail)
async def update_bin_project(
    request: Request,
    project_id: str,
    req: BinProjectUpdateRequest,
    user_id: str = Depends(get_user_id),
):
    project_store = get_project_store(user_id)
    project = project_store.get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="project not found")

    if req.name is not None:
        name = req.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="project name is required")
        project.name = name
    if "description" in req.model_fields_set:
        project.description = req.description
    if "status" in req.model_fields_set and req.status is not None:
        project.status = req.status
    if "target_grid_x" in req.model_fields_set:
        project.target_grid_x = req.target_grid_x
    if "target_grid_y" in req.model_fields_set:
        project.target_grid_y = req.target_grid_y
    if "default_bin_config" in req.model_fields_set:
        project.default_bin_config = req.default_bin_config
    if "notes" in req.model_fields_set:
        project.notes = req.notes

    project.updated_at = _now_iso()
    project_store.set(project_id, project)
    _, _, user_bins = get_stores(user_id)
    return make_project_detail(project, user_bins)


@router.delete("/bin-projects/{project_id}", response_model=StatusResponse)
async def delete_bin_project(request: Request, project_id: str, user_id: str = Depends(get_user_id)):
    project_store = get_project_store(user_id)
    _, user_tools, user_bins = get_stores(user_id)
    project = project_store.delete(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="project not found")

    remove_project_from_tools(project_id, project.tool_ids, user_tools)
    for bid, bin_data in user_bins.all().items():
        if bin_data.project_id == project_id or bid in project.bin_ids:
            bin_data.project_id = None
            user_bins.set(bid, bin_data)

    return StatusResponse(status="deleted")


@router.post("/bin-projects/{project_id}/tools", response_model=BinProjectDetail)
async def add_tools_to_bin_project(
    request: Request,
    project_id: str,
    req: BinProjectToolsRequest,
    user_id: str = Depends(get_user_id),
):
    project_store = get_project_store(user_id)
    project = project_store.get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="project not found")

    _, user_tools, user_bins = get_stores(user_id)
    for tool_id in req.tool_ids:
        if not user_tools.get(tool_id):
            raise HTTPException(status_code=404, detail=f"tool {tool_id} not found")

    existing = set(project.tool_ids)
    for tool_id in req.tool_ids:
        if tool_id not in existing:
            project.tool_ids.append(tool_id)
            existing.add(tool_id)
    project.updated_at = _now_iso()
    project_store.set(project_id, project)
    add_project_to_tools(project_id, req.tool_ids, user_tools)
    return make_project_detail(project, user_bins)


@router.delete("/bin-projects/{project_id}/tools/{tool_id}", response_model=BinProjectDetail)
async def remove_tool_from_bin_project(
    request: Request,
    project_id: str,
    tool_id: str,
    user_id: str = Depends(get_user_id),
):
    project_store = get_project_store(user_id)
    project = project_store.get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="project not found")

    if tool_id in project.tool_ids:
        project.tool_ids = [tid for tid in project.tool_ids if tid != tool_id]
        project.updated_at = _now_iso()
        project_store.set(project_id, project)

    _, user_tools, user_bins = get_stores(user_id)
    remove_project_from_tools(project_id, [tool_id], user_tools)
    return make_project_detail(project, user_bins)


@router.get("/bin-projects/{project_id}/health", response_model=ProjectHealthResponse)
async def get_bin_project_health(request: Request, project_id: str, user_id: str = Depends(get_user_id)):
    project = get_project_store(user_id).get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="project not found")
    _, user_tools, user_bins = get_stores(user_id)
    return health_response(project_health(project, user_tools, user_bins))


@router.post("/bin-projects/{project_id}/repair", response_model=ProjectHealthResponse)
async def repair_bin_project(request: Request, project_id: str, user_id: str = Depends(get_user_id)):
    project_store = get_project_store(user_id)
    project = project_store.get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="project not found")
    _, user_tools, user_bins = get_stores(user_id)
    repaired = repair_project_links(project_store, project, user_tools, user_bins)
    return health_response(project_health(repaired, user_tools, user_bins))


@router.post("/bin-projects/{project_id}/bins", response_model=BinProjectDetail)
async def add_bins_to_bin_project(
    request: Request,
    project_id: str,
    req: BinProjectBinsRequest,
    user_id: str = Depends(get_user_id),
):
    project_store = get_project_store(user_id)
    project = project_store.get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="project not found")

    _, user_tools, user_bins = get_stores(user_id)
    bin_ids = list(dict.fromkeys(req.bin_ids))
    for bin_id in bin_ids:
        bin_data = user_bins.get(bin_id)
        if not bin_data:
            raise HTTPException(status_code=404, detail=f"bin {bin_id} not found")
        if bin_data.project_id and bin_data.project_id != project_id and not req.allow_reassign:
            raise HTTPException(status_code=400, detail=f"bin {bin_id} already belongs to another project")

    existing_tools = set(project.tool_ids)
    for bin_id in bin_ids:
        bin_data = user_bins.get(bin_id)
        if bin_data.project_id and bin_data.project_id != project_id:
            remove_bin_from_project(project_store, bin_data.project_id, bin_id)
        bin_data.project_id = project_id
        user_bins.set(bin_id, bin_data)
        if bin_id not in project.bin_ids:
            project.bin_ids.append(bin_id)

        if req.import_tools:
            importable_tool_ids: list[str] = []
            for placed in bin_data.placed_tools:
                if placed.tool_id and placed.tool_id not in existing_tools:
                    if not user_tools.get(placed.tool_id):
                        continue
                    project.tool_ids.append(placed.tool_id)
                    existing_tools.add(placed.tool_id)
                if placed.tool_id and user_tools.get(placed.tool_id):
                    importable_tool_ids.append(placed.tool_id)
            add_project_to_tools(project_id, importable_tool_ids, user_tools)

    project.updated_at = _now_iso()
    project_store.set(project_id, project)
    return make_project_detail(project, user_bins)


@router.delete("/bin-projects/{project_id}/bins/{bin_id}", response_model=BinProjectDetail)
async def detach_bin_from_bin_project(
    request: Request,
    project_id: str,
    bin_id: str,
    user_id: str = Depends(get_user_id),
):
    project_store = get_project_store(user_id)
    project = project_store.get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="project not found")

    _, _, user_bins = get_stores(user_id)
    bin_data = user_bins.get(bin_id)
    if bin_id in project.bin_ids:
        project.bin_ids = [bid for bid in project.bin_ids if bid != bin_id]
    if bin_data and bin_data.project_id == project_id:
        bin_data.project_id = None
        user_bins.set(bin_id, bin_data)

    project.updated_at = _now_iso()
    project_store.set(project_id, project)
    return make_project_detail(project, user_bins)


@router.post("/bin-projects/{project_id}/create-bin", response_model=BinModel)
async def create_bin_from_project(
    request: Request,
    project_id: str,
    req: BinProjectCreateBinRequest = BinProjectCreateBinRequest(),
    user_id: str = Depends(get_user_id),
):
    project_store = get_project_store(user_id)
    project = project_store.get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="project not found")

    _, user_tools, user_bins = get_stores(user_id)
    tool_ids = project.tool_ids if req.tool_ids is None else req.tool_ids
    outside_project = [tid for tid in tool_ids if tid not in project.tool_ids]
    if outside_project:
        raise HTTPException(status_code=400, detail="all tools must belong to project")

    bin_id = str(uuid.uuid4())
    bin_data = _build_bin_from_tools(
        bin_id=bin_id,
        name=req.name or project.name,
        project_id=project_id,
        tool_ids=tool_ids,
        user_tools=user_tools,
        default_config=req.bin_config or project.default_bin_config,
    )
    user_bins.set(bin_id, bin_data)
    add_bin_to_project(project_store, project_id, bin_id)
    return bin_data


# --- bins ---

@router.get("/bins", response_model=BinListResponse)
async def list_bins(request: Request, user_id: str = Depends(get_user_id)):
    _, _, user_bins = get_stores(user_id)
    all_bins = user_bins.all()
    summaries = []
    for bid, bin_data in all_bins.items():
        summaries.append(BinSummary(
            id=bid,
            name=bin_data.name,
            project_id=bin_data.project_id,
            created_at=bin_data.created_at,
            tool_ids=[pt.tool_id for pt in bin_data.placed_tools],
            tool_count=len(bin_data.placed_tools),
            has_stl=bin_data.stl_path is not None,
            grid_x=bin_data.bin_config.grid_x,
            grid_y=bin_data.bin_config.grid_y,
            preview_tools=[BinPreviewTool(points=pt.points, interior_rings=pt.interior_rings) for pt in bin_data.placed_tools],
        ))
    summaries.sort(key=lambda b: b.created_at or "", reverse=True)
    return BinListResponse(bins=summaries)


@router.get("/bins/{bin_id}")
async def get_bin(request: Request, bin_id: str, user_id: str = Depends(get_user_id)):
    _, user_tools, user_bins = get_stores(user_id)
    bin_data = user_bins.get(bin_id)
    if not bin_data:
        raise HTTPException(status_code=404, detail="bin not found")

    if sync_placed_tools(bin_data, user_tools):
        user_bins.set(bin_id, bin_data)

    return bin_data


@router.post("/bins", response_model=BinModel)
async def create_bin(request: Request, req: CreateBinRequest, user_id: str = Depends(get_user_id)):
    _, user_tools, user_bins = get_stores(user_id)
    project_store = get_project_store(user_id)
    if req.project_id and not project_store.get(req.project_id):
        raise HTTPException(status_code=404, detail=f"project {req.project_id} not found")
    bin_id = str(uuid.uuid4())
    bin_data = _build_bin_from_tools(
        bin_id=bin_id,
        name=req.name,
        project_id=req.project_id,
        tool_ids=req.tool_ids,
        user_tools=user_tools,
        default_config=req.bin_config,
    )
    user_bins.set(bin_id, bin_data)
    add_bin_to_project(project_store, req.project_id, bin_id)
    return bin_data


@router.put("/bins/{bin_id}", response_model=StatusResponse)
async def update_bin(request: Request, bin_id: str, req: BinUpdateRequest, user_id: str = Depends(get_user_id)):
    _, _, user_bins = get_stores(user_id)
    project_store = get_project_store(user_id)
    bin_data = user_bins.get(bin_id)
    if not bin_data:
        raise HTTPException(status_code=404, detail="bin not found")

    old_project_id = bin_data.project_id
    if req.name is not None:
        bin_data.name = req.name
    if "project_id" in req.model_fields_set:
        if req.project_id and not project_store.get(req.project_id):
            raise HTTPException(status_code=404, detail=f"project {req.project_id} not found")
        bin_data.project_id = req.project_id
    if req.bin_config is not None:
        bin_data.bin_config = req.bin_config
    if req.placed_tools is not None:
        bin_data.placed_tools = req.placed_tools
    if req.text_labels is not None:
        bin_data.text_labels = req.text_labels
    user_bins.set(bin_id, bin_data)
    if old_project_id != bin_data.project_id:
        remove_bin_from_project(project_store, old_project_id, bin_id)
        add_bin_to_project(project_store, bin_data.project_id, bin_id)
    return StatusResponse(status="ok")


@router.delete("/bins/{bin_id}", response_model=StatusResponse)
async def delete_bin(request: Request, bin_id: str, user_id: str = Depends(get_user_id)):
    _, _, user_bins = get_stores(user_id)
    project_store = get_project_store(user_id)
    up = _user_path(user_id)
    bin_data = user_bins.delete(bin_id)
    if not bin_data:
        raise HTTPException(status_code=404, detail="bin not found")
    remove_bin_from_project(project_store, bin_data.project_id, bin_id)
    remove_bin_from_all_projects(project_store, bin_id)

    if bin_data.stl_path:
        stl_abs = Path(_abs(bin_data.stl_path))
        stl_abs.unlink(missing_ok=True)
        stl_abs.with_suffix(".3mf").unlink(missing_ok=True)
        stl_abs.with_suffix(".hash").unlink(missing_ok=True)
    for f in up.glob(f"outputs/{bin_id}_part*.stl"):
        f.unlink(missing_ok=True)
    (up / "outputs" / f"{bin_id}_parts.zip").unlink(missing_ok=True)
    (up / "outputs" / f"{bin_id}_insert.stl").unlink(missing_ok=True)

    return StatusResponse(status="deleted")


@router.post("/bins/{bin_id}/generate", response_model=GenerateResponse)
def generate_bin_stl(request: Request, bin_id: str, user_id: str = Depends(get_user_id)):
    _, user_tools, user_bins = get_stores(user_id)
    up = _user_path(user_id)
    bin_data = user_bins.get(bin_id)
    if not bin_data:
        raise HTTPException(status_code=404, detail="bin not found")

    bc = bin_data.bin_config

    # include source tool smoothed state in hash so toggling invalidates cache
    smoothed_flags = {}
    for pt in bin_data.placed_tools:
        src = user_tools.get(pt.tool_id)
        smoothed_flags[pt.tool_id] = {
            "smoothed": src.smoothed if src else False,
            "smooth_level": src.smooth_level if src else 0.5,
        }
    input_data = {
        "bin_config": bc.model_dump(),
        "placed_tools": [pt.model_dump() for pt in bin_data.placed_tools],
        "text_labels": [tl.model_dump() for tl in bin_data.text_labels],
        "smoothed_flags": smoothed_flags,
    }
    input_hash = hashlib.md5(json.dumps(input_data, sort_keys=True, default=str).encode()).hexdigest()

    scaled = []
    for pt in bin_data.placed_tools:
        points_mm = [(p.x, p.y) for p in pt.points]
        fholes = [
            ScaledFingerHole(
                fh.id, fh.x, fh.y, fh.radius,
                shape=fh.shape, width_mm=fh.width, height_mm=fh.height,
                rotation=fh.rotation,
                depth_override=fh.depth_override,
            )
            for fh in pt.finger_holes
        ]
        interior_rings_mm = [
            [(p.x, p.y) for p in ring]
            for ring in pt.interior_rings
        ]
        sp = ScaledPolygon(pt.id, points_mm, pt.name, fholes, interior_rings_mm, depth_override=pt.depth_override)
        source_tool = user_tools.get(pt.tool_id)
        sp = polygon_scaler.prepare_for_generation(
            sp,
            bc.cutout_clearance,
            smoothed=bool(source_tool and source_tool.smoothed),
            smooth_level=source_tool.smooth_level if source_tool else 0.5,
        )
        scaled.append(sp)

    gen_req = GenerateRequest(
        grid_x=bc.grid_x,
        grid_y=bc.grid_y,
        height_units=bc.height_units,
        magnets=bc.magnets,
        magnet_diameter=bc.magnet_diameter,
        magnet_depth=bc.magnet_depth,
        magnet_corners_only=bc.magnet_corners_only,
        stacking_lip=bc.stacking_lip,
        rim_units=bc.rim_units,
        wall_thickness=bc.wall_thickness,
        cutout_depth=bc.cutout_depth,
        cutout_clearance=bc.cutout_clearance,
        insert_enabled=bc.insert_enabled,
        insert_height=bc.insert_height,
        insert_clearance=bc.insert_clearance,
        cutout_chamfer=bc.cutout_chamfer,
        partial_bins=bc.partial_bins,
        partial_bins_values=bc.partial_bins_values,
        partial_bins_connect=bc.partial_bins_connect,
        partial_bins_retain_wall=bc.partial_bins_retain_wall,
        text_labels=bc.text_labels + bin_data.text_labels,
        bed_size=bc.bed_size,
        half_grid_base=bc.half_grid_base,
    )

    response = _run_generate(scaled, gen_req, bin_id, up, input_hash, user_id, user_bins)

    output_path = up / "outputs" / f"{bin_id}.stl"
    fresh = user_bins.get(bin_id)
    if fresh:
        fresh.stl_path = _rel(output_path, up)
        user_bins.set(bin_id, fresh)

    return response


def _bin_stem(bin_data) -> str:
    """Standardized filename stem: Name_XuYuHu_Dmm-tracefinity"""
    bc = bin_data.bin_config
    raw = (bin_data.name or "bin").strip()
    safe = re.sub(r"[^\w\-]", "_", raw).strip("_") or "bin"
    gx = f"{bc.grid_x:g}"
    gy = f"{bc.grid_y:g}"
    return f"{safe}_{gx}u{gy}u{bc.height_units}u_{int(bc.cutout_depth)}mm-tracefinity"


# bin file downloads
@router.get("/files/bins/{bin_id}/bin.stl")
async def download_bin_stl(request: Request, bin_id: str, user_id: str = Depends(get_user_id)):
    _, _, user_bins = get_stores(user_id)
    bin_data = user_bins.get(bin_id)
    if not bin_data or not bin_data.stl_path:
        raise HTTPException(status_code=404, detail="stl not found")
    return FileResponse(
        _abs(bin_data.stl_path),
        media_type="application/sla",
        filename=f"{_bin_stem(bin_data)}.stl",
    )


@router.get("/files/bins/{bin_id}/bin_parts.zip")
async def download_bin_zip(request: Request, bin_id: str, user_id: str = Depends(get_user_id)):
    _, _, user_bins = get_stores(user_id)
    up = _user_path(user_id)
    zip_path = up / "outputs" / f"{bin_id}_parts.zip"
    if not zip_path.exists():
        raise HTTPException(status_code=404, detail="zip not found")
    bin_data = user_bins.get(bin_id)
    fname = f"{_bin_stem(bin_data)}-parts.zip" if bin_data else f"{bin_id[:8]}-parts.zip"
    return FileResponse(
        str(zip_path),
        media_type="application/zip",
        filename=fname,
    )


@router.get("/files/bins/{bin_id}/bin.3mf")
async def download_bin_threemf(request: Request, bin_id: str, user_id: str = Depends(get_user_id)):
    _, _, user_bins = get_stores(user_id)
    bin_data = user_bins.get(bin_id)
    if not bin_data or not bin_data.stl_path:
        raise HTTPException(status_code=404, detail="3mf not found")
    threemf_path = Path(_abs(bin_data.stl_path)).with_suffix(".3mf")
    if not threemf_path.exists():
        raise HTTPException(status_code=404, detail="3mf not found")
    return FileResponse(
        str(threemf_path),
        media_type="application/vnd.ms-package.3dmanufacturing-3dmodel+xml",
        filename=f"{_bin_stem(bin_data)}.3mf",
    )


@router.get("/files/bins/{bin_id}/bin_insert.stl")
async def download_bin_insert(request: Request, bin_id: str, user_id: str = Depends(get_user_id)):
    _, _, user_bins = get_stores(user_id)
    up = _user_path(user_id)
    insert_path = up / "outputs" / f"{bin_id}_insert.stl"
    if not insert_path.exists():
        raise HTTPException(status_code=404, detail="insert stl not found")
    bin_data = user_bins.get(bin_id)
    fname = f"{_bin_stem(bin_data)}-insert.stl" if bin_data else f"{bin_id[:8]}-insert.stl"
    return FileResponse(
        str(insert_path),
        media_type="application/sla",
        filename=fname,
    )


def _dir_size(path: Path) -> int:
    total = 0
    for dirpath, _, filenames in os.walk(path):
        for f in filenames:
            total += os.path.getsize(os.path.join(dirpath, f))
    return total


@router.get("/admin/storage-stats")
async def storage_stats(request: Request):
    if settings.proxy_secret:
        if request.headers.get("x-proxy-secret") != settings.proxy_secret:
            raise HTTPException(status_code=403)

    storage = settings.storage_path
    users = [d for d in storage.iterdir() if d.is_dir()]

    per_user = []
    total = 0
    for user_dir in sorted(users):
        size = _dir_size(user_dir)
        total += size
        per_user.append({"userId": user_dir.name, "bytes": size})

    return {"totalBytes": total, "users": per_user}



