"""manifold3d STL generator - full replacement for build123d/OCCT.

10-100x faster on boolean operations. Uses PIL+cv2 for text labels.
"""
import logging
import math
import os
import time
from pathlib import Path

import numpy as np

from app.models.schemas import GenerateRequest
from app.services.polygon_scaler import ScaledPolygon

logger = logging.getLogger(__name__)

GF_GRID = 42.0
GF_HEIGHT_UNIT = 7.0
GF_BASE_HEIGHT = 4.75
GF_CORNER_R = 3.75     # 4.0 - 0.25 inset

# base layer heights (bottom to top)
BASE_H_BOT = 0.8
BASE_H_MID = 1.8
BASE_H_TOP = 2.15      # = GF_BASE_HEIGHT - BASE_H_BOT - BASE_H_MID

# stacking lip dimensions (d0..d4 from gridfinity spec)
LIP_D0 = 1.9
LIP_D1 = 1.8
LIP_D2 = 0.7
LIP_D3 = 1.2
LIP_D4 = LIP_D0 + LIP_D2  # 2.6

MAGNET_DIAMETER = 6.0
MAGNET_DEPTH = 2.4
MAGNET_INSET = 4.8     # from cell corner to magnet centre

CIRCLE_SEGS = 48        # profile corner resolution (2D)
ROUND_SEGS = 128        # sphere/cylinder resolution (3D cutters)
TEXT_DPI = 200          # pixels per inch for text rendering


# ── geometry helpers ─────────────────────────────────────────────────────────

def _rounded_rect_pts(w: float, h: float, r: float, segs: int = CIRCLE_SEGS) -> np.ndarray:
    """CCW polygon for a w×h rectangle with corner radius r, centred at origin."""
    n = max(3, segs // 4)
    cx, cy = w / 2 - r, h / 2 - r
    pts = []
    for i, (ox, oy) in enumerate([(-cx, -cy), (cx, -cy), (cx, cy), (-cx, cy)]):
        base = i * math.pi / 2 + math.pi
        for j in range(n):
            a = base + j * (math.pi / 2) / n
            pts.append((ox + r * math.cos(a), oy + r * math.sin(a)))
    return np.array(pts, dtype=np.float64)


def _cs(pts: np.ndarray):
    import manifold3d as mf
    return mf.CrossSection([np.asarray(pts, dtype=np.float64)])


def _build_base_unit(outer_w: float, outer_h: float):
    """Solid gridfinity base unit for one grid cell, centred at (0,0), z=0..GF_BASE_HEIGHT."""
    import manifold3d as mf

    mid_w = outer_w - 2 * BASE_H_TOP
    mid_h = outer_h - 2 * BASE_H_TOP
    bot_w = mid_w - 2 * BASE_H_BOT
    bot_h = mid_h - 2 * BASE_H_BOT
    r = GF_CORNER_R

    cs_bot = _cs(_rounded_rect_pts(bot_w, bot_h, r))
    cs_mid = _cs(_rounded_rect_pts(mid_w, mid_h, r))

    # bottom taper z=0→BASE_H_BOT: bot_w→mid_w
    l0 = mf.Manifold.extrude(cs_bot, BASE_H_BOT, scale_top=(mid_w / bot_w, mid_h / bot_h))
    # straight z=BASE_H_BOT→BASE_H_BOT+BASE_H_MID
    l1 = mf.Manifold.extrude(cs_mid, BASE_H_MID).translate((0.0, 0.0, BASE_H_BOT))
    # top taper z=BASE_H_BOT+BASE_H_MID→GF_BASE_HEIGHT: mid_w→outer_w
    l2 = mf.Manifold.extrude(
        cs_mid, BASE_H_TOP, scale_top=(outer_w / mid_w, outer_h / mid_h)
    ).translate((0.0, 0.0, BASE_H_BOT + BASE_H_MID))

    return mf.Manifold.batch_boolean([l0, l1, l2], mf.OpType.Add)


def _build_stacking_lip_notch(outer_w: float, outer_h: float):
    """
    Inner notch solid to subtract from the stacking lip.
    Built in notch-local coords where z=0 is the bottom of the notch
    (= wall_top - LIP_D3 - LIP_D4 in global coords) and z=8.2 is the top of the lip.

    Width profile from bottom (z=0) to top (z=8.2):
      z=0:              outer_w  (full outer, notch base)
      z=LIP_D4:         outer_w - 2*LIP_D4  (36.3mm for 1x1)
      z=LIP_D4+LIP_D3:  same  (straight)
      z=+LIP_D2:        outer_w - 2*LIP_D0  (37.7mm, widened)
      z=+LIP_D1:        same  (straight)
      z=+LIP_D0:        outer_w  (full outer, lip top opening)
    """
    import manifold3d as mf

    r = GF_CORNER_R
    nw_inner = outer_w - 2 * (LIP_D0 + LIP_D2)   # 36.3mm
    nh_inner = outer_h - 2 * (LIP_D0 + LIP_D2)
    nw_mid = outer_w - 2 * LIP_D0                 # 37.7mm
    nh_mid = outer_h - 2 * LIP_D0

    cs_outer = _cs(_rounded_rect_pts(outer_w, outer_h, r))
    cs_inner = _cs(_rounded_rect_pts(nw_inner, nh_inner, r))
    cs_mid = _cs(_rounded_rect_pts(nw_mid, nh_mid, r))

    z = 0.0
    # l0: outer→inner (taper inward going up), height=LIP_D4
    l0 = mf.Manifold.extrude(cs_outer, LIP_D4, scale_top=(nw_inner / outer_w, nh_inner / outer_h))
    z += LIP_D4
    # l1: straight at inner, height=LIP_D3
    l1 = mf.Manifold.extrude(cs_inner, LIP_D3).translate((0.0, 0.0, z))
    z += LIP_D3
    # l2: inner→mid (taper outward), height=LIP_D2
    l2 = mf.Manifold.extrude(
        cs_inner, LIP_D2, scale_top=(nw_mid / nw_inner, nh_mid / nh_inner)
    ).translate((0.0, 0.0, z))
    z += LIP_D2
    # l3: straight at mid, height=LIP_D1
    l3 = mf.Manifold.extrude(cs_mid, LIP_D1).translate((0.0, 0.0, z))
    z += LIP_D1
    # l4: mid→outer (taper outward), height=LIP_D0
    l4 = mf.Manifold.extrude(
        cs_mid, LIP_D0, scale_top=(outer_w / nw_mid, outer_h / nh_mid)
    ).translate((0.0, 0.0, z))

    return mf.Manifold.batch_boolean([l0, l1, l2, l3, l4], mf.OpType.Add)


def _build_shell(config: GenerateRequest):
    """Solid bin shell: base units + wall body to wall_top_z.

    Wall body terminates at wall_top_z only. The stacking lip is built
    separately in generate_bin and added on top, matching the original
    gf.Bin + StackingLip structure so the groove is only visible above
    wall_top_z and the large top-floor face is preserved.
    """
    import manifold3d as mf

    grid_x, grid_y = config.grid_x, config.grid_y
    height = config.height_units * GF_HEIGHT_UNIT
    outer_w = grid_x * GF_GRID - 0.5
    outer_h = grid_y * GF_GRID - 0.5
    r = GF_CORNER_R

    base_units = []
    for iy in range(grid_y):
        for ix in range(grid_x):
            cx = (ix - (grid_x - 1) / 2.0) * GF_GRID
            cy = (iy - (grid_y - 1) / 2.0) * GF_GRID
            unit = _build_base_unit(GF_GRID - 0.5, GF_GRID - 0.5)
            base_units.append(unit.translate((cx, cy, 0.0)))

    cs_wall = _cs(_rounded_rect_pts(outer_w, outer_h, r))
    wall_body = mf.Manifold.extrude(cs_wall, height - GF_BASE_HEIGHT).translate(
        (0.0, 0.0, GF_BASE_HEIGHT)
    )

    parts = base_units + [wall_body]
    return mf.Manifold.batch_boolean(parts, mf.OpType.Add)


# ── cutter builders ───────────────────────────────────────────────────────────

def _make_magnet_holes(config: GenerateRequest):
    """Batch union of all magnet hole cylinders (4 per grid cell)."""
    import manifold3d as mf

    r = MAGNET_DIAMETER / 2
    mag = mf.Manifold.cylinder(MAGNET_DEPTH + 0.01, r, circular_segments=ROUND_SEGS)

    holes = []
    for iy in range(config.grid_y):
        for ix in range(config.grid_x):
            cx = (ix - (config.grid_x - 1) / 2.0) * GF_GRID
            cy = (iy - (config.grid_y - 1) / 2.0) * GF_GRID
            for dx, dy in [(-13.0, -13.0), (13.0, -13.0), (13.0, 13.0), (-13.0, 13.0)]:
                holes.append(mag.translate((cx + dx, cy + dy, 0.0)))

    return mf.Manifold.batch_boolean(holes, mf.OpType.Add)


def _shapely_to_cross_sections(shifted_pts: list[tuple]) -> list[np.ndarray]:
    """
    Validate and repair a polygon via Shapely before passing to Clipper2.
    Returns a list of exterior ring arrays (one per simple sub-polygon).

    Two-stage repair:
    1. buffer(0) for polygons that are already self-intersecting (GEOS-invalid)
    2. morphological open (erode+dilate by _CLIP_EPS) to merge near-touching
       edges that Clipper2's integer rounding would otherwise bridge — these
       pass Shapely's validity check but still trigger the Clipper2 chord artifact.
    """
    from shapely.geometry import Polygon as _SPoly, MultiPolygon as _SMPoly

    sp = _SPoly(shifted_pts)

    if not sp.is_valid:
        sp = sp.buffer(0)

    # morphological open: collapses thin peninsulas / near-touching edges
    # 0.05mm is well below any meaningful feature size but larger than Clipper2
    # integer-snapping distance (1e-6 mm at default 1e6 scale factor)
    _CLIP_EPS = 0.05
    cleaned = sp.buffer(-_CLIP_EPS).buffer(_CLIP_EPS)
    if not cleaned.is_empty and cleaned.area > sp.area * 0.9:
        if not cleaned.is_valid:
            cleaned = cleaned.buffer(0)
        sp = cleaned

    if sp.is_empty or sp.area <= 0:
        return []

    polys = list(sp.geoms) if isinstance(sp, _SMPoly) else [sp]
    rings = []
    for p in polys:
        if p.is_empty or p.area <= 0:
            continue
        rings.append(np.array(p.exterior.coords[:-1], dtype=np.float64))
    return rings


def _make_polygon_cutouts(
    polygons: list[ScaledPolygon],
    config: GenerateRequest,
    wall_top_z: float,
    pocket_depth: float,
    offset_x: float,
    offset_y: float,
):
    """Batch union of all polygon cutout extrusions."""
    import manifold3d as mf

    cutters = []
    for poly in polygons:
        shifted = [
            (p[0] + offset_x, -(p[1] + offset_y))
            for p in poly.points_mm
        ]
        if len(shifted) < 3:
            continue
        try:
            rings = _shapely_to_cross_sections(shifted)
            for ring_pts in rings:
                if len(ring_pts) < 3:
                    continue
                cs = mf.CrossSection([ring_pts])
                if cs.area() <= 0:
                    cs = mf.CrossSection([ring_pts[::-1]])
                if cs.area() > 0:
                    cutter = mf.Manifold.extrude(cs, pocket_depth + 0.01).translate(
                        (0.0, 0.0, wall_top_z - pocket_depth)
                    )
                    cutters.append(cutter)
        except Exception as e:
            logger.warning("polygon cutout failed: %s", e)

    if not cutters:
        return None
    return mf.Manifold.batch_boolean(cutters, mf.OpType.Add)


def _make_finger_holes(
    polygons: list[ScaledPolygon],
    config: GenerateRequest,
    wall_top_z: float,
    pocket_depth: float,
    offset_x: float,
    offset_y: float,
):
    """Batch union of all finger hole cutters."""
    import manifold3d as mf

    cutters = []
    for poly in polygons:
        for fh in poly.finger_holes:
            fh_x = fh.x_mm + offset_x
            fh_y = -(fh.y_mm + offset_y)
            shape = getattr(fh, 'shape', 'circle')
            rotation = getattr(fh, 'rotation', 0.0)
            try:
                if shape == 'circle':
                    r = fh.radius_mm
                    pocket_floor_z = wall_top_z - pocket_depth
                    sphere_z = max(wall_top_z, pocket_floor_z + r)
                    # approximate sphere as a cylinder with hemispheric top
                    # using a simple cylinder for speed; close enough for slicer
                    cutter = mf.Manifold.sphere(r, circular_segments=ROUND_SEGS).translate(
                        (fh_x, fh_y, sphere_z)
                    )
                elif shape == 'square':
                    size = fh.radius_mm * 2
                    cut_z = wall_top_z - pocket_depth / 2
                    cutter = (
                        mf.Manifold.cube((size, size, pocket_depth + 0.01), center=True)
                        .rotate((0.0, 0.0, rotation))
                        .translate((fh_x, fh_y, cut_z))
                    )
                elif shape == 'rectangle':
                    w = fh.width_mm if fh.width_mm else fh.radius_mm * 2
                    h = fh.height_mm if fh.height_mm else fh.radius_mm * 2
                    cut_z = wall_top_z - pocket_depth / 2
                    cutter = (
                        mf.Manifold.cube((w, h, pocket_depth + 0.01), center=True)
                        .rotate((0.0, 0.0, rotation))
                        .translate((fh_x, fh_y, cut_z))
                    )
                else:
                    continue
                cutters.append(cutter)
            except Exception as e:
                logger.warning("finger hole failed: %s", e)

    if not cutters:
        return None
    return mf.Manifold.batch_boolean(cutters, mf.OpType.Add)


# ── text label helpers ────────────────────────────────────────────────────────

def _load_font(size_px: int):
    from PIL import ImageFont

    candidates = [
        "/usr/share/fonts/truetype/msttcorefonts/Arial.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/Library/Fonts/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for fp in candidates:
        if os.path.exists(fp):
            try:
                return ImageFont.truetype(fp, size_px)
            except Exception:
                pass
    return ImageFont.load_default(size=size_px)


def _text_to_cross_section(text: str, font_size_mm: float):
    """Render text to a PIL bitmap and trace contours → CrossSection centred at origin."""
    import cv2
    import manifold3d as mf
    from PIL import Image, ImageDraw

    px_per_mm = TEXT_DPI / 25.4
    font_size_px = max(8, int(font_size_mm * px_per_mm))
    pad_px = 8

    font = _load_font(font_size_px)
    bbox = font.getbbox(text)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]

    img_w = tw + 2 * pad_px
    img_h = th + 2 * pad_px
    img = Image.new('L', (img_w, img_h), 255)
    draw = ImageDraw.Draw(img)
    draw.text((pad_px - bbox[0], pad_px - bbox[1]), text, fill=0, font=font)

    arr = np.array(img)
    _, binary = cv2.threshold(arr, 127, 255, cv2.THRESH_BINARY_INV)

    contours, hierarchy = cv2.findContours(binary, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    if not contours or hierarchy is None:
        return None

    hierarchy = hierarchy[0]
    cx_px = img_w / 2.0
    cy_px = img_h / 2.0

    polys = []
    for i, cnt in enumerate(contours):
        pts = cnt.reshape(-1, 2).astype(np.float64)
        if len(pts) < 3:
            continue
        pts[:, 0] = (pts[:, 0] - cx_px) / px_per_mm
        pts[:, 1] = -(pts[:, 1] - cy_px) / px_per_mm  # flip y
        polys.append(pts)

    if not polys:
        return None

    # EvenOdd handles holes in letters (O, A, B, etc.) automatically
    cs = mf.CrossSection(polys, mf.FillRule.EvenOdd)
    return cs if cs.area() > 0 else None


def _make_text_labels(
    config: GenerateRequest,
    wall_top_z: float,
    emboss_only: bool,
    offset_x: float,
    offset_y: float,
):
    """Build manifold solids for text labels. Returns (recessed_cutter, embossed_body)."""
    import manifold3d as mf

    recessed = []
    embossed = []

    for tl in (config.text_labels or []):
        cs = _text_to_cross_section(tl.text, tl.font_size)
        if cs is None:
            continue

        try:
            lx = tl.x + offset_x
            ly = -(tl.y + offset_y)

            if tl.emboss:
                solid = (
                    mf.Manifold.extrude(cs, tl.depth)
                    .rotate((0.0, 0.0, tl.rotation))
                    .translate((lx, ly, wall_top_z))
                )
                embossed.append(solid)
            else:
                # recessed: extrude then place at wall_top going down
                cutter = (
                    mf.Manifold.extrude(cs, tl.depth + 0.01)
                    .rotate((0.0, 0.0, tl.rotation))
                    .translate((lx, ly, wall_top_z - tl.depth - 0.01))
                )
                recessed.append(cutter)
        except Exception as e:
            logger.warning("text label '%s' failed: %s", tl.text, e)

    recessed_union = (
        mf.Manifold.batch_boolean(recessed, mf.OpType.Add) if recessed else None
    )
    embossed_union = (
        mf.Manifold.batch_boolean(embossed, mf.OpType.Add) if embossed else None
    )
    return recessed_union, embossed_union


# ── export helpers ────────────────────────────────────────────────────────────

def _manifold_to_trimesh(m):
    import trimesh

    mesh = m.to_mesh()
    verts = mesh.vert_properties[:, :3].astype(np.float64)
    faces = mesh.tri_verts.astype(np.int64)
    tm = trimesh.Trimesh(vertices=verts, faces=faces, process=False)
    # merge near-duplicate vertices and drop degenerate faces that manifold
    # boolean ops can introduce at intersection seams
    tm.merge_vertices()
    # drop zero-area faces, then clean up orphaned vertices
    mask = tm.nondegenerate_faces()
    tm.update_faces(mask)
    tm.remove_unreferenced_vertices()
    return tm


def _export_stl(m, path: str) -> None:
    tm = _manifold_to_trimesh(m)
    tm.export(path)


def _export_3mf(bin_m, text_m, path: str) -> None:
    import trimesh

    scene = trimesh.Scene()
    scene.add_geometry(_manifold_to_trimesh(bin_m), node_name='bin', geom_name='bin')
    scene.add_geometry(_manifold_to_trimesh(text_m), node_name='text', geom_name='text')
    data = scene.export(file_type='3mf')
    with open(path, 'wb') as f:
        f.write(data)


# ── main generator class ──────────────────────────────────────────────────────

class ManifoldSTLGenerator:
    def generate_bin(
        self,
        polygons: list[ScaledPolygon],
        config: GenerateRequest,
        output_path: str,
        threemf_path: str | None = None,
    ):
        """Generate bin STL using manifold3d. Returns (bin_manifold, text_manifold)."""
        import manifold3d as mf

        t0 = time.monotonic()

        bin_width = config.grid_x * GF_GRID
        bin_depth = config.grid_y * GF_GRID
        offset_x = -bin_width / 2
        offset_y = -bin_depth / 2
        wall_top_z = config.height_units * GF_HEIGHT_UNIT

        # build solid shell (wall body to wall_top_z, no lip yet)
        t1 = time.monotonic()
        bin_body = _build_shell(config)
        logger.info("shell: %.2fs", time.monotonic() - t1)

        # stacking lip: build groove into a separate lip solid (z=wall_top_z to
        # z=wall_top_z+lip_total) and add it to the bin body.  The notch extends
        # below wall_top_z but only cuts the lip solid (not the wall body), so
        # the groove is invisible below wall_top_z — matching gf.Bin behaviour
        # and preserving the large top-floor face at z=wall_top_z.
        if config.stacking_lip:
            lip_total = LIP_D0 + LIP_D1 + LIP_D2
            notch_depth_below = LIP_D3 + LIP_D4
            outer_w = config.grid_x * GF_GRID - 0.5
            outer_h = config.grid_y * GF_GRID - 0.5
            cs_wall_lip = _cs(_rounded_rect_pts(outer_w, outer_h, GF_CORNER_R))
            lip_solid = mf.Manifold.extrude(cs_wall_lip, lip_total).translate(
                (0.0, 0.0, wall_top_z)
            )
            notch = _build_stacking_lip_notch(outer_w, outer_h).translate(
                (0.0, 0.0, wall_top_z - notch_depth_below)
            )
            lip_with_groove = lip_solid - notch
            bin_body = bin_body + lip_with_groove
            logger.info("stacking lip: %.2fs", time.monotonic() - t1)

        # collect remaining cutters (pocket, magnets, finger holes, text) and
        # subtract them in one pass to avoid sequential z-plane imprecision
        cutters: list = []

        if config.magnets:
            cutters.append(_make_magnet_holes(config))

        pocket_depth = 5
        if polygons:
            floor_z = GF_BASE_HEIGHT
            max_depth = wall_top_z - floor_z - 2
            pocket_depth = max(5, min(config.cutout_depth, max_depth))

            t1 = time.monotonic()
            cutouts = _make_polygon_cutouts(polygons, config, wall_top_z, pocket_depth, offset_x, offset_y)
            if cutouts:
                cutters.append(cutouts)
            logger.info("polygon cutouts (%d): %.2fs", len(polygons), time.monotonic() - t1)

            t1 = time.monotonic()
            fholes = _make_finger_holes(polygons, config, wall_top_z, pocket_depth, offset_x, offset_y)
            if fholes:
                cutters.append(fholes)
            logger.info("finger holes: %.2fs", time.monotonic() - t1)

        # text labels (recessed cutters + embossed body additions)
        text_body = None
        if config.text_labels:
            t1 = time.monotonic()
            recessed, embossed = _make_text_labels(config, wall_top_z, False, offset_x, offset_y)
            if recessed:
                cutters.append(recessed)
            if embossed and not embossed.is_empty():
                text_body = embossed
            logger.info("text labels: %.2fs", time.monotonic() - t1)

        # single boolean subtraction for all cutters
        if cutters:
            t1 = time.monotonic()
            all_cutters = mf.Manifold.batch_boolean(cutters, mf.OpType.Add)
            bin_body = bin_body - all_cutters
            logger.info("subtract all cutters: %.2fs", time.monotonic() - t1)

        logger.info("total generate_bin: %.2fs", time.monotonic() - t0)

        # export STL
        t1 = time.monotonic()
        if text_body:
            combined = bin_body + text_body
            _export_stl(combined, output_path)
        else:
            _export_stl(bin_body, output_path)
        logger.info("export_stl: %.2fs", time.monotonic() - t1)

        # 3MF export (multi-colour)
        if text_body and threemf_path:
            try:
                _export_3mf(bin_body, text_body, threemf_path)
            except Exception:
                logger.warning("3MF export failed, skipping", exc_info=True)

        return bin_body, text_body

    @staticmethod
    def _compute_split_points(total_mm: float, grid_count: int, bed_size: float) -> list[float]:
        """Split points relative to bin centre for one axis."""
        if bed_size <= 0 or total_mm <= bed_size:
            return []
        max_units = max(1, int(bed_size // GF_GRID))
        import math as _m
        num_pieces = _m.ceil(grid_count / max_units)
        base = grid_count // num_pieces
        extra = grid_count % num_pieces
        sizes = [base + (1 if i < extra else 0) for i in range(num_pieces)]
        points = []
        pos = -total_mm / 2
        for s in sizes[:-1]:
            pos += s * GF_GRID
            points.append(pos)
        return points

    def split_bin(
        self,
        bin_body,
        text_body,
        config: GenerateRequest,
        bed_size: float,
        output_dir: str,
        session_id: str,
    ) -> list[str]:
        """Split completed bin into bed-sized pieces. Returns list of output paths."""
        import manifold3d as mf
        import math

        bin_width = config.grid_x * GF_GRID
        bin_depth = config.grid_y * GF_GRID

        fits_diagonal = (bin_width + bin_depth) / math.sqrt(2) <= bed_size
        if fits_diagonal:
            return []

        x_cuts = self._compute_split_points(bin_width, config.grid_x, bed_size)
        y_cuts = self._compute_split_points(bin_depth, config.grid_y, bed_size)

        if not x_cuts and not y_cuts:
            return []

        part = bin_body + text_body if text_body else bin_body

        x_pieces = self._split_along_axis(part, x_cuts, axis='x')
        pieces = []
        for xp in x_pieces:
            pieces.extend(self._split_along_axis(xp, y_cuts, axis='y'))

        paths = []
        for i, piece in enumerate(pieces):
            path = f"{output_dir}/{session_id}_part{i + 1}.stl"
            _export_stl(piece, path)
            paths.append(path)

        return paths

    @staticmethod
    def _split_along_axis(part, cut_points: list[float], axis: str) -> list:
        if not cut_points:
            return [part]

        # normal vector for cut plane
        normal = (1.0, 0.0, 0.0) if axis == 'x' else (0.0, 1.0, 0.0)
        pieces = []
        remainder = part

        for cut in cut_points:
            top, bottom = remainder.split_by_plane(normal, cut)
            if not top.is_empty():
                pieces.append(top)
            remainder = bottom

        if not remainder.is_empty():
            pieces.append(remainder)

        return pieces
