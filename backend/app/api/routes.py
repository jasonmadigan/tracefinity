import logging
import os
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, UploadFile, HTTPException
from fastapi.responses import FileResponse, Response
from starlette.requests import Request
from PIL import Image
import io

from app.config import settings, ensure_user_dirs
from app.auth import get_user_id
from app.models.schemas import (
    UploadResponse,
    CornersRequest,
    CornersResponse,
    TraceRequest,
    TraceResponse,
    PolygonsRequest,
    GenerateRequest,
    GenerateResponse,
    Session,
    SessionSummary,
    SessionListResponse,
    SessionUpdateRequest,
    StatusResponse,
    Point,
    Polygon,
    FingerHole,
    Tool,
    ToolSummary,
    ToolListResponse,
    ToolUpdateRequest,
    SaveToolsResponse,
    PlacedTool,
    BinModel,
    BinConfig,
    BinSummary,
    BinPreviewTool,
    BinListResponse,
    BinUpdateRequest,
    CreateBinRequest,
)
from app.services.image_processor import ImageProcessor
from app.services.ai_tracer import AITracer
from app.services.polygon_scaler import PolygonScaler, ScaledPolygon, ScaledFingerHole
from app.services.stl_generator_manifold import ManifoldSTLGenerator
from app.services.session_store import SessionStore
from app.services.tool_store import ToolStore
from app.services.bin_store import BinStore
router = APIRouter()

# register heif/heic support with pillow
try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except ImportError:
    pass

# per-user store registry
_store_cache: dict[str, tuple[SessionStore, ToolStore, BinStore]] = {}


def get_stores(user_id: str) -> tuple[SessionStore, ToolStore, BinStore]:
    if user_id not in _store_cache:
        user_path = settings.storage_path / user_id
        ensure_user_dirs(user_path)
        _store_cache[user_id] = (
            SessionStore(user_path),
            ToolStore(user_path),
            BinStore(user_path),
        )
    return _store_cache[user_id]


def _user_path(user_id: str) -> Path:
    return settings.storage_path / user_id


ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif"}
HEIC_EXTENSIONS = {".heic", ".heif"}


def _convert_heic_to_jpeg(content: bytes, original_ext: str) -> tuple[bytes, str]:
    """convert heic/heif to jpeg. returns (content, new_extension)."""
    if original_ext.lower() not in HEIC_EXTENSIONS:
        return content, original_ext
    img = Image.open(io.BytesIO(content))
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=95)
    return buf.getvalue(), ".jpg"


image_processor = ImageProcessor()
ai_tracer = AITracer()
polygon_scaler = PolygonScaler()
stl_generator = ManifoldSTLGenerator()


def _rel(abs_path: str | Path, user_path: Path) -> str:
    """store path relative to storage root (includes user_id prefix)"""
    return str(Path(abs_path).relative_to(settings.storage_path))


def _abs(rel_path: str | None) -> str | None:
    """resolve stored relative path back to absolute"""
    if not rel_path:
        return None
    return str(settings.storage_path / rel_path)


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

    content, ext = _convert_heic_to_jpeg(content, ext)
    image_path = up / "uploads" / f"{session_id}{ext}"
    image_path.write_bytes(content)

    corners = image_processor.detect_paper_corners(str(image_path))
    corner_points = [Point(x=c[0], y=c[1]) for c in corners] if corners else None

    user_sessions.set(session_id, Session(
        id=session_id,
        created_at=datetime.utcnow().isoformat(),
        original_image_path=_rel(image_path, up),
        corners=corner_points,
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
    output_path, scale_factor = image_processor.apply_perspective_correction(
        _abs(session.original_image_path), corners, req.paper_size
    )

    up = _user_path(user_id)
    session.corrected_image_path = _rel(output_path, up)
    session.corners = req.corners
    session.paper_size = req.paper_size
    session.scale_factor = scale_factor
    user_sessions.set(session_id, session)

    return CornersResponse(
        corrected_image_url=f"/storage/{session.corrected_image_path}",
        scale_factor=scale_factor,
    )


@router.get("/api-keys")
async def get_available_keys(request: Request):
    """check which api keys are configured via env vars"""
    return {
        "google": settings.google_api_key is not None,
    }


@router.post("/sessions/{session_id}/trace", response_model=TraceResponse)
async def trace_tools(request: Request, session_id: str, req: TraceRequest, user_id: str = Depends(get_user_id)):
    user_sessions, _, _ = get_stores(user_id)
    session = user_sessions.get(session_id)
    if not session or not session.corrected_image_path:
        raise HTTPException(status_code=400, detail="must set corners first")

    api_key = settings.google_api_key or req.api_key
    if not api_key:
        raise HTTPException(status_code=400, detail="no api key provided")

    up = _user_path(user_id)
    mask_output_path = str(up / "processed" / f"{session_id}_mask.png")

    try:
        polygons, mask_path = await ai_tracer.trace_tools(
            _abs(session.corrected_image_path),
            api_key,
            mask_output_path,
        )
    except Exception as e:
        error_msg = str(e)
        if "insufficient_quota" in error_msg or "exceeded" in error_msg.lower():
            raise HTTPException(status_code=402, detail="API quota exceeded - check your billing")
        if "invalid_api_key" in error_msg or "Incorrect API key" in error_msg:
            raise HTTPException(status_code=401, detail="Invalid API key")
        if "rate_limit" in error_msg.lower():
            raise HTTPException(status_code=429, detail="Rate limited - try again shortly")
        logging.error("ai tracing failed: %s", error_msg[:500])
        raise HTTPException(status_code=500, detail="AI tracing failed. Please try again.")

    session.polygons = polygons
    session.mask_image_path = _rel(mask_path, up) if mask_path else None
    user_sessions.set(session_id, session)

    mask_url = None
    if mask_path:
        mask_url = f"/storage/{user_id}/processed/{session_id}_mask.png"

    return TraceResponse(polygons=polygons, mask_url=mask_url)


@router.post("/sessions/{session_id}/trace-mask", response_model=TraceResponse)
async def trace_from_mask(request: Request, session_id: str, mask: UploadFile, user_id: str = Depends(get_user_id)):
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
    content, mask_ext = _convert_heic_to_jpeg(content, mask_ext)
    mask_path = up / "processed" / f"{session_id}_mask.png"
    mask_path.write_bytes(content)

    contours = ai_tracer._trace_mask(str(mask_path), _abs(session.corrected_image_path))

    if not contours:
        raise HTTPException(status_code=400, detail="no tool outlines found in mask")

    polygons = []
    for i, contour in enumerate(contours):
        polygons.append(Polygon(
            id=str(uuid.uuid4()),
            points=[Point(x=p[0], y=p[1]) for p in contour],
            label=f"tool {i + 1}",
        ))

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

    import hashlib, json
    input_hash = hashlib.md5(json.dumps(req.model_dump(), sort_keys=True, default=str).encode()).hexdigest()
    hash_path = up / "outputs" / f"{session_id}.hash"
    output_path = up / "outputs" / f"{session_id}.stl"

    if output_path.exists() and hash_path.exists() and hash_path.read_text() == input_hash:
        threemf_path = up / "outputs" / f"{session_id}.3mf"
        zip_path = up / "outputs" / f"{session_id}_parts.zip"
        part_paths = sorted(up.glob(f"outputs/{session_id}_part*.stl"))
        stl_urls = [f"/storage/{user_id}/outputs/{p.name}" for p in part_paths]
        return GenerateResponse(
            stl_url=f"/storage/{user_id}/outputs/{session_id}.stl",
            stl_urls=stl_urls,
            threemf_url=f"/storage/{user_id}/outputs/{session_id}.3mf" if threemf_path.exists() else None,
            split_count=max(1, len(stl_urls)),
            zip_url=f"/storage/{user_id}/outputs/{session_id}_parts.zip" if zip_path.exists() else None,
        )

    scaled = polygon_scaler.scale_to_mm(polygons, session.scale_factor)
    scaled = [polygon_scaler.add_clearance(p, req.cutout_clearance) for p in scaled]
    scaled = [polygon_scaler.simplify(p) for p in scaled]

    threemf_path = up / "outputs" / f"{session_id}.3mf"
    threemf_path.unlink(missing_ok=True)
    for old in up.glob(f"outputs/{session_id}_part*.stl"):
        old.unlink(missing_ok=True)
    zip_path = up / "outputs" / f"{session_id}_parts.zip"
    zip_path.unlink(missing_ok=True)

    bin_body, text_body = stl_generator.generate_bin(scaled, req, str(output_path), str(threemf_path))

    stl_urls: list[str] = []
    zip_url = None
    if req.bed_size > 0:
        output_dir = str(up / "outputs")
        part_paths = stl_generator.split_bin(bin_body, text_body, req, req.bed_size, output_dir, session_id)
        if part_paths:
            stl_urls = [f"/storage/{user_id}/outputs/{Path(p).name}" for p in part_paths]
            import zipfile
            part_bytes = [(Path(p).name, Path(p).read_bytes()) for p in part_paths]
            with zipfile.ZipFile(str(zip_path), 'w', zipfile.ZIP_DEFLATED) as zf:
                for name, data in part_bytes:
                    zf.writestr(name, data)
            zip_url = f"/storage/{user_id}/outputs/{session_id}_parts.zip"

    hash_path.write_text(input_hash)

    fresh_session = user_sessions.get(session_id)
    if fresh_session:
        fresh_session.stl_path = _rel(output_path, up)
        user_sessions.set(session_id, fresh_session)

    threemf_url = None
    if threemf_path.exists():
        threemf_url = f"/storage/{user_id}/outputs/{session_id}.3mf"

    return GenerateResponse(
        stl_url=f"/storage/{user_id}/outputs/{session_id}.stl",
        stl_urls=stl_urls,
        threemf_url=threemf_url,
        split_count=max(1, len(stl_urls)),
        zip_url=zip_url,
    )


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

GF_GRID = 42.0


@router.get("/tools", response_model=ToolListResponse)
async def list_tools(request: Request, user_id: str = Depends(get_user_id)):
    _, user_tools, _ = get_stores(user_id)
    all_tools = user_tools.all()
    summaries = []
    for tid, tool in all_tools.items():
        thumb_url = None
        if tool.thumbnail_path and Path(_abs(tool.thumbnail_path)).exists():
            thumb_url = f"/storage/{tool.thumbnail_path}"
        summaries.append(ToolSummary(
            id=tid,
            name=tool.name,
            created_at=tool.created_at,
            point_count=len(tool.points),
            points=tool.points,
            thumbnail_url=thumb_url,
        ))
    summaries.sort(key=lambda t: t.created_at or "", reverse=True)
    return ToolListResponse(tools=summaries)


@router.get("/tools/{tool_id}")
async def get_tool(request: Request, tool_id: str, user_id: str = Depends(get_user_id)):
    _, user_tools, _ = get_stores(user_id)
    tool = user_tools.get(tool_id)
    if not tool:
        raise HTTPException(status_code=404, detail="tool not found")
    return tool


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
    user_tools.set(tool_id, tool)
    return StatusResponse(status="ok")


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

    xs = [p.x for p in tool.points]
    ys = [p.y for p in tool.points]
    pad = 1.0
    min_x, max_x = min(xs) - pad, max(xs) + pad
    min_y, max_y = min(ys) - pad, max(ys) + pad
    w = max_x - min_x
    h = max_y - min_y

    pts = " ".join(f"{p.x},{p.y}" for p in tool.points)
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg"'
        f' width="{w:.4f}mm" height="{h:.4f}mm"'
        f' viewBox="{min_x:.4f} {min_y:.4f} {w:.4f} {h:.4f}">\n'
        f'  <polygon points="{pts}" fill="black" stroke="none"/>\n'
        f'</svg>\n'
    )

    safe_name = tool.name.replace('"', '').replace('/', '-') if tool.name else "tool"
    return Response(
        content=svg,
        media_type="image/svg+xml",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.svg"'},
    )


@router.post("/sessions/{session_id}/save-tools", response_model=SaveToolsResponse)
async def save_tools_from_session(request: Request, session_id: str, user_id: str = Depends(get_user_id)):
    """convert session polygons to library tools (px -> mm, centered at origin)"""
    user_sessions, user_tools, _ = get_stores(user_id)
    up = _user_path(user_id)
    session = user_sessions.get(session_id)
    if not session or not session.scale_factor or not session.polygons:
        raise HTTPException(status_code=400, detail="session has no traced polygons")

    sf = session.scale_factor
    tool_ids = []

    src_img = None
    if session.corrected_image_path:
        try:
            src_img = Image.open(_abs(session.corrected_image_path))
        except Exception:
            pass

    for poly in session.polygons:
        points_mm = [(p.x * sf, p.y * sf) for p in poly.points]
        if not points_mm:
            continue

        xs = [p[0] for p in points_mm]
        ys = [p[1] for p in points_mm]
        cx = (min(xs) + max(xs)) / 2
        cy = (min(ys) + max(ys)) / 2
        centered = [Point(x=p[0] - cx, y=p[1] - cy) for p in points_mm]

        fholes = []
        for fh in poly.finger_holes:
            fholes.append(FingerHole(
                id=fh.id,
                x=fh.x * sf - cx,
                y=fh.y * sf - cy,
                radius=fh.radius,
                width=fh.width,
                height=fh.height,
                rotation=fh.rotation,
                shape=fh.shape,
            ))

        tool_id = str(uuid.uuid4())

        thumbnail_path = None
        if src_img:
            try:
                px_xs = [p.x for p in poly.points]
                px_ys = [p.y for p in poly.points]
                pad = 20
                left = max(0, int(min(px_xs)) - pad)
                top = max(0, int(min(px_ys)) - pad)
                right = min(src_img.width, int(max(px_xs)) + pad)
                bottom = min(src_img.height, int(max(px_ys)) + pad)
                crop = src_img.crop((left, top, right, bottom))
                max_dim = max(crop.width, crop.height)
                if max_dim > 256:
                    scale = 256 / max_dim
                    crop = crop.resize((int(crop.width * scale), int(crop.height * scale)), Image.LANCZOS)
                thumb_file = up / "tools" / f"{tool_id}.jpg"
                crop.convert("RGB").save(thumb_file, "JPEG", quality=80)
                thumbnail_path = _rel(thumb_file, up)
            except Exception:
                pass

        user_tools.set(tool_id, Tool(
            id=tool_id,
            name=poly.label,
            points=centered,
            finger_holes=fholes,
            source_session_id=session_id,
            thumbnail_path=thumbnail_path,
            created_at=datetime.utcnow().isoformat(),
        ))
        tool_ids.append(tool_id)

    return SaveToolsResponse(tool_ids=tool_ids)


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
            created_at=bin_data.created_at,
            tool_count=len(bin_data.placed_tools),
            has_stl=bin_data.stl_path is not None,
            grid_x=bin_data.bin_config.grid_x,
            grid_y=bin_data.bin_config.grid_y,
            preview_tools=[BinPreviewTool(points=pt.points) for pt in bin_data.placed_tools],
        ))
    summaries.sort(key=lambda b: b.created_at or "", reverse=True)
    return BinListResponse(bins=summaries)


@router.get("/bins/{bin_id}")
async def get_bin(request: Request, bin_id: str, user_id: str = Depends(get_user_id)):
    _, user_tools, user_bins = get_stores(user_id)
    bin_data = user_bins.get(bin_id)
    if not bin_data:
        raise HTTPException(status_code=404, detail="bin not found")

    # sync placed tools with library versions
    import math
    changed = False
    for pt in bin_data.placed_tools:
        if not pt.tool_id:
            continue
        tool = user_tools.get(pt.tool_id)
        if not tool or not tool.points:
            continue

        n_placed = len(pt.points)
        placed_cx = sum(p.x for p in pt.points) / n_placed
        placed_cy = sum(p.y for p in pt.points) / n_placed

        n_lib = len(tool.points)
        lib_cx = sum(p.x for p in tool.points) / n_lib
        lib_cy = sum(p.y for p in tool.points) / n_lib

        rot = math.radians(pt.rotation)
        cos_r, sin_r = math.cos(rot), math.sin(rot)

        new_points = []
        for p in tool.points:
            rx = (p.x - lib_cx) * cos_r - (p.y - lib_cy) * sin_r
            ry = (p.x - lib_cx) * sin_r + (p.y - lib_cy) * cos_r
            new_points.append(Point(x=placed_cx + rx, y=placed_cy + ry))

        new_fh = []
        for fh in tool.finger_holes:
            rx = (fh.x - lib_cx) * cos_r - (fh.y - lib_cy) * sin_r
            ry = (fh.x - lib_cx) * sin_r + (fh.y - lib_cy) * cos_r
            new_fh.append(FingerHole(
                id=fh.id, x=placed_cx + rx, y=placed_cy + ry,
                radius=fh.radius, width=fh.width, height=fh.height,
                rotation=fh.rotation, shape=fh.shape,
            ))

        if new_points != pt.points or new_fh != pt.finger_holes:
            pt.points = new_points
            pt.finger_holes = new_fh
            pt.name = tool.name
            changed = True

    if changed:
        user_bins.set(bin_id, bin_data)

    return bin_data


@router.post("/bins", response_model=BinModel)
async def create_bin(request: Request, req: CreateBinRequest, user_id: str = Depends(get_user_id)):
    _, user_tools, user_bins = get_stores(user_id)
    bin_id = str(uuid.uuid4())

    placed: list[PlacedTool] = []
    all_points_mm: list[tuple[float, float]] = []

    for tool_id in req.tool_ids:
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
        ))

    bc = BinConfig()
    if all_points_mm:
        all_xs = [p[0] for p in all_points_mm]
        all_ys = [p[1] for p in all_points_mm]
        tool_width = max(all_xs) - min(all_xs)
        tool_height = max(all_ys) - min(all_ys)

        clearance = bc.cutout_clearance
        wall = bc.wall_thickness
        needed_w = tool_width + 2 * clearance + 2 * wall + 0.5
        needed_h = tool_height + 2 * clearance + 2 * wall + 0.5

        grid_x = max(1, int((needed_w + GF_GRID - 1) // GF_GRID))
        grid_y = max(1, int((needed_h + GF_GRID - 1) // GF_GRID))
        bc.grid_x = min(grid_x, 10)
        bc.grid_y = min(grid_y, 10)

        bin_w = bc.grid_x * GF_GRID
        bin_h = bc.grid_y * GF_GRID
        offset_x = bin_w / 2
        offset_y = bin_h / 2
        for pt in placed:
            pt.points = [Point(x=p.x + offset_x, y=p.y + offset_y) for p in pt.points]
            pt.finger_holes = [
                FingerHole(id=fh.id, x=fh.x + offset_x, y=fh.y + offset_y,
                           radius=fh.radius, width=fh.width, height=fh.height,
                           rotation=fh.rotation, shape=fh.shape)
                for fh in pt.finger_holes
            ]

    bin_data = BinModel(
        id=bin_id,
        name=req.name,
        bin_config=bc,
        placed_tools=placed,
        created_at=datetime.utcnow().isoformat(),
    )
    user_bins.set(bin_id, bin_data)
    return bin_data


@router.put("/bins/{bin_id}", response_model=StatusResponse)
async def update_bin(request: Request, bin_id: str, req: BinUpdateRequest, user_id: str = Depends(get_user_id)):
    _, _, user_bins = get_stores(user_id)
    bin_data = user_bins.get(bin_id)
    if not bin_data:
        raise HTTPException(status_code=404, detail="bin not found")

    if req.name is not None:
        bin_data.name = req.name
    if req.bin_config is not None:
        bin_data.bin_config = req.bin_config
    if req.placed_tools is not None:
        bin_data.placed_tools = req.placed_tools
    if req.text_labels is not None:
        bin_data.text_labels = req.text_labels
    user_bins.set(bin_id, bin_data)
    return StatusResponse(status="ok")


@router.delete("/bins/{bin_id}", response_model=StatusResponse)
async def delete_bin(request: Request, bin_id: str, user_id: str = Depends(get_user_id)):
    _, _, user_bins = get_stores(user_id)
    up = _user_path(user_id)
    bin_data = user_bins.delete(bin_id)
    if not bin_data:
        raise HTTPException(status_code=404, detail="bin not found")

    if bin_data.stl_path:
        stl_abs = Path(_abs(bin_data.stl_path))
        stl_abs.unlink(missing_ok=True)
        stl_abs.with_suffix(".3mf").unlink(missing_ok=True)
        stl_abs.with_suffix(".hash").unlink(missing_ok=True)
    for f in up.glob(f"outputs/{bin_id}_part*.stl"):
        f.unlink(missing_ok=True)
    (up / "outputs" / f"{bin_id}_parts.zip").unlink(missing_ok=True)

    return StatusResponse(status="deleted")


@router.post("/bins/{bin_id}/generate", response_model=GenerateResponse)
def generate_bin_stl(request: Request, bin_id: str, user_id: str = Depends(get_user_id)):
    _, _, user_bins = get_stores(user_id)
    up = _user_path(user_id)
    bin_data = user_bins.get(bin_id)
    if not bin_data:
        raise HTTPException(status_code=404, detail="bin not found")
    if not bin_data.placed_tools:
        raise HTTPException(status_code=400, detail="bin has no tools placed")

    bc = bin_data.bin_config

    import hashlib, json
    input_data = {
        "bin_config": bc.model_dump(),
        "placed_tools": [pt.model_dump() for pt in bin_data.placed_tools],
        "text_labels": [tl.model_dump() for tl in bin_data.text_labels],
    }
    input_hash = hashlib.md5(json.dumps(input_data, sort_keys=True, default=str).encode()).hexdigest()
    hash_path = up / "outputs" / f"{bin_id}.hash"
    output_path = up / "outputs" / f"{bin_id}.stl"

    if output_path.exists() and hash_path.exists() and hash_path.read_text() == input_hash:
        threemf_path = up / "outputs" / f"{bin_id}.3mf"
        zip_path = up / "outputs" / f"{bin_id}_parts.zip"
        part_paths = sorted(up.glob(f"outputs/{bin_id}_part*.stl"))
        stl_urls = [f"/storage/{user_id}/outputs/{p.name}" for p in part_paths]
        return GenerateResponse(
            stl_url=f"/storage/{user_id}/outputs/{bin_id}.stl",
            stl_urls=stl_urls,
            threemf_url=f"/storage/{user_id}/outputs/{bin_id}.3mf" if threemf_path.exists() else None,
            split_count=max(1, len(stl_urls)),
            zip_url=f"/storage/{user_id}/outputs/{bin_id}_parts.zip" if zip_path.exists() else None,
        )

    scaled = []
    for pt in bin_data.placed_tools:
        points_mm = [(p.x, p.y) for p in pt.points]
        fholes = [
            ScaledFingerHole(
                fh.id, fh.x, fh.y, fh.radius,
                shape=fh.shape, width_mm=fh.width, height_mm=fh.height,
                rotation=fh.rotation,
            )
            for fh in pt.finger_holes
        ]
        sp = ScaledPolygon(pt.id, points_mm, pt.name, fholes)
        sp = polygon_scaler.add_clearance(sp, bc.cutout_clearance)
        sp = polygon_scaler.simplify(sp)
        scaled.append(sp)

    gen_req = GenerateRequest(
        grid_x=bc.grid_x,
        grid_y=bc.grid_y,
        height_units=bc.height_units,
        magnets=bc.magnets,
        stacking_lip=bc.stacking_lip,
        wall_thickness=bc.wall_thickness,
        cutout_depth=bc.cutout_depth,
        cutout_clearance=bc.cutout_clearance,
        text_labels=bc.text_labels + bin_data.text_labels,
        bed_size=bc.bed_size,
    )

    threemf_path = up / "outputs" / f"{bin_id}.3mf"
    threemf_path.unlink(missing_ok=True)
    for old in up.glob(f"outputs/{bin_id}_part*.stl"):
        old.unlink(missing_ok=True)
    zip_path = up / "outputs" / f"{bin_id}_parts.zip"
    zip_path.unlink(missing_ok=True)

    bin_body, text_body = stl_generator.generate_bin(scaled, gen_req, str(output_path), str(threemf_path))

    stl_urls: list[str] = []
    zip_url = None
    if gen_req.bed_size > 0:
        output_dir = str(up / "outputs")
        part_paths = stl_generator.split_bin(bin_body, text_body, gen_req, gen_req.bed_size, output_dir, bin_id)
        if part_paths:
            stl_urls = [f"/storage/{user_id}/outputs/{Path(p).name}" for p in part_paths]
            import zipfile
            part_bytes = [(Path(p).name, Path(p).read_bytes()) for p in part_paths]
            with zipfile.ZipFile(str(zip_path), 'w', zipfile.ZIP_DEFLATED) as zf:
                for name, data in part_bytes:
                    zf.writestr(name, data)
            zip_url = f"/storage/{user_id}/outputs/{bin_id}_parts.zip"

    hash_path.write_text(input_hash)

    fresh = user_bins.get(bin_id)
    if fresh:
        fresh.stl_path = _rel(output_path, up)
        user_bins.set(bin_id, fresh)

    threemf_url = None
    if threemf_path.exists():
        threemf_url = f"/storage/{user_id}/outputs/{bin_id}.3mf"

    return GenerateResponse(
        stl_url=f"/storage/{user_id}/outputs/{bin_id}.stl",
        stl_urls=stl_urls,
        threemf_url=threemf_url,
        split_count=max(1, len(stl_urls)),
        zip_url=zip_url,
    )


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
        filename=f"tracefinity-{bin_id[:8]}.stl",
    )


@router.get("/files/bins/{bin_id}/bin_parts.zip")
async def download_bin_zip(request: Request, bin_id: str, user_id: str = Depends(get_user_id)):
    up = _user_path(user_id)
    zip_path = up / "outputs" / f"{bin_id}_parts.zip"
    if not zip_path.exists():
        raise HTTPException(status_code=404, detail="zip not found")
    return FileResponse(
        str(zip_path),
        media_type="application/zip",
        filename=f"tracefinity-{bin_id[:8]}-parts.zip",
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
        filename=f"tracefinity-{bin_id[:8]}.3mf",
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

