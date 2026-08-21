"""drawer planning: bin packing and drawer layout algorithms."""

from __future__ import annotations

import math
import uuid

from app.constants import GF_GRID
from app.models.schemas import (
    BinConfig,
    BinModel,
    DrawerBin,
    FingerHole,
    PlacedTool,
    Point,
)
from app.services.tool_store import ToolStore


def _min_grid_for_size(
    width_mm: float, height_mm: float,
    clearance: float = 2.0, wall: float = 1.6,
    half_grid_base: bool = False,
) -> tuple[float, float]:
    """minimum gridfinity grid units for a given size in mm."""
    needed_w = width_mm + 2 * clearance + 2 * wall + 0.5
    needed_h = height_mm + 2 * clearance + 2 * wall + 0.5
    if half_grid_base:
        half = GF_GRID / 2
        gx = max(1.0, math.ceil(needed_w / half) * 0.5)
        gy = max(1.0, math.ceil(needed_h / half) * 0.5)
    else:
        gx = max(1.0, math.ceil(needed_w / GF_GRID))
        gy = max(1.0, math.ceil(needed_h / GF_GRID))
    return gx, gy


def _min_grid_bbox(
    points: list[tuple[float, float]],
    clearance: float = 2.0,
    wall: float = 1.6,
) -> tuple[float, float, float]:
    """find rotation angle that minimises gridfinity grid units.

    sweeps 0-180 in 0.5 deg steps then refines +/-1 deg in 0.1 deg steps.
    returns (angle_rad, grid_x, grid_y).
    """
    if len(points) < 3:
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        w, h = max(xs) - min(xs), max(ys) - min(ys)
        gx, gy = _min_grid_for_size(w, h, clearance, wall)
        return 0.0, gx, gy

    def _score(angle: float) -> tuple[float, int, int]:
        cos_a = math.cos(-angle)
        sin_a = math.sin(-angle)
        rotated = [
            (p[0] * cos_a - p[1] * sin_a, p[0] * sin_a + p[1] * cos_a)
            for p in points
        ]
        xs = [r[0] for r in rotated]
        ys = [r[1] for r in rotated]
        w = max(xs) - min(xs)
        h = max(ys) - min(ys)
        gx, gy = _min_grid_for_size(w, h, clearance, wall)
        # tiebreaker: prefer axis-aligned orientations
        score = gx * gy + (w + h) * 0.001
        return score, gx, gy

    # coarse sweep
    step = math.radians(0.5)
    best_angle = 0.0
    best_score = float('inf')
    best_gx, best_gy = 1.0, 1.0
    a = 0.0
    while a < math.pi:
        score, gx, gy = _score(a)
        if score < best_score:
            best_score, best_angle = score, a
            best_gx, best_gy = gx, gy
        a += step

    # fine refinement
    fine = math.radians(0.1)
    lo = best_angle - math.radians(1)
    hi = best_angle + math.radians(1)
    a = lo
    while a <= hi:
        score, gx, gy = _score(a)
        if score < best_score:
            best_score, best_angle = score, a
            best_gx, best_gy = gx, gy
        a += fine

    return best_angle, best_gx, best_gy


def _rotate_points(
    points: list[tuple[float, float]], angle: float,
) -> list[tuple[float, float]]:
    """rotate points around origin by angle (radians)."""
    if angle == 0.0:
        return points
    cos_a = math.cos(angle)
    sin_a = math.sin(angle)
    return [(x * cos_a - y * sin_a, x * sin_a + y * cos_a) for x, y in points]


def _bbox(pts: list[tuple[float, float]]) -> tuple[float, float, float, float]:
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def pack_tools_to_bins(
    tool_ids: list[str],
    tool_store: ToolStore,
    clearance: float = 1.0,
    wall: float = 1.6,
    height_units: int = 4,
) -> list[BinModel]:
    """pack each tool into its own optimally-rotated bin.

    finds the rotation that minimises grid units, creates a bin per tool
    with the tool centred inside. returns list of BinModel.
    """
    bins: list[BinModel] = []

    for tid in tool_ids:
        tool = tool_store.get(tid)
        if not tool or not tool.points:
            continue

        raw_pts = [(p.x, p.y) for p in tool.points]
        angle, gx, gy = _min_grid_bbox(raw_pts, clearance, wall)

        # rotate all geometry
        rotated_pts = _rotate_points(raw_pts, -angle)
        fh_raw = [(fh.x, fh.y) for fh in tool.finger_holes]
        fh_rotated = _rotate_points(fh_raw, -angle) if fh_raw else []
        rings_rotated = []
        for ring in tool.interior_rings:
            ring_raw = [(p.x, p.y) for p in ring]
            rings_rotated.append(_rotate_points(ring_raw, -angle))

        # centre in bin
        min_x, min_y, max_x, max_y = _bbox(rotated_pts)
        cx = (max_x + min_x) / 2
        cy = (max_y + min_y) / 2
        bin_w = gx * GF_GRID
        bin_h = gy * GF_GRID
        offset_x = bin_w / 2 - cx
        offset_y = bin_h / 2 - cy

        placed_points = [
            Point(x=p[0] + offset_x, y=p[1] + offset_y)
            for p in rotated_pts
        ]
        placed_fholes = [
            FingerHole(
                id=fh.id,
                x=fh_rotated[i][0] + offset_x,
                y=fh_rotated[i][1] + offset_y,
                radius=fh.radius, width=fh.width, height=fh.height,
                rotation=(fh.rotation or 0) - math.degrees(angle),
                shape=fh.shape,
            )
            for i, fh in enumerate(tool.finger_holes)
        ]
        placed_rings = [
            [Point(x=p[0] + offset_x, y=p[1] + offset_y) for p in ring]
            for ring in rings_rotated
        ]

        placed = PlacedTool(
            id=f"pt-{uuid.uuid4().hex[:12]}",
            tool_id=tid,
            name=tool.name,
            points=placed_points,
            finger_holes=placed_fholes,
            interior_rings=placed_rings,
            rotation=-math.degrees(angle),
        )

        bin_model = BinModel(
            id=str(uuid.uuid4()),
            name=tool.name or f"Bin {tid[:8]}",
            bin_config=BinConfig(
                grid_x=gx, grid_y=gy, height_units=height_units,
                cutout_clearance=clearance, wall_thickness=wall,
            ),
            placed_tools=[placed],
        )
        bins.append(bin_model)

    return bins


def _rotate_bin_90(bm: BinModel) -> None:
    """rotate a bin 90 deg clockwise: swap grid_x/grid_y and transform points."""
    old_h = bm.bin_config.grid_y * GF_GRID

    bm.bin_config.grid_x, bm.bin_config.grid_y = bm.bin_config.grid_y, bm.bin_config.grid_x

    for pt in bm.placed_tools:
        pt.points = [Point(x=old_h - p.y, y=p.x) for p in pt.points]
        pt.finger_holes = [
            FingerHole(
                id=fh.id, x=old_h - fh.y, y=fh.x,
                radius=fh.radius, width=fh.width, height=fh.height,
                rotation=(fh.rotation or 0) - 90, shape=fh.shape,
            )
            for fh in pt.finger_holes
        ]
        pt.interior_rings = [
            [Point(x=old_h - p.y, y=p.x) for p in ring]
            for ring in pt.interior_rings
        ]
        pt.rotation = (pt.rotation or 0) - 90


def layout_drawer(
    drawer_width_mm: float,
    drawer_depth_mm: float,
    bins: list[BinModel],
) -> tuple[list[DrawerBin], list[DrawerBin]]:
    """grid-scan packing into a drawer. returns (fitted, overflow).

    for each bin (largest first), tries both orientations, picks the one
    that leads to a more compact placement. column-major first-fit scan.
    """
    cols = int(drawer_width_mm // GF_GRID)
    rows = int(drawer_depth_mm // GF_GRID)

    if cols <= 0 or rows <= 0:
        overflow = []
        ox = 0
        for b in bins:
            overflow.append(DrawerBin(
                id=str(uuid.uuid4()), bin_id=b.id,
                group_name=b.name or "",
                grid_col=ox, grid_row=0,
                grid_x=b.bin_config.grid_x, grid_y=b.bin_config.grid_y,
            ))
            ox += b.bin_config.grid_x
        return [], overflow

    grid = [[False] * cols for _ in range(rows)]

    def _fits(r: int, c: int, h: int, w: int) -> bool:
        if r + h > rows or c + w > cols:
            return False
        for dr in range(h):
            for dc in range(w):
                if grid[r + dr][c + dc]:
                    return False
        return True

    def _place(r: int, c: int, h: int, w: int):
        for dr in range(h):
            for dc in range(w):
                grid[r + dr][c + dc] = True

    def _find_pos(gx: int, gy: int) -> tuple[int, int] | None:
        for c in range(cols):
            for r in range(rows):
                if _fits(r, c, gy, gx):
                    return c, r
        return None

    # sort by area descending
    sorted_bins = sorted(
        bins,
        key=lambda b: b.bin_config.grid_x * b.bin_config.grid_y,
        reverse=True,
    )

    fitted: list[DrawerBin] = []
    overflow: list[DrawerBin] = []

    for bm in sorted_bins:
        gx = bm.bin_config.grid_x
        gy = bm.bin_config.grid_y

        pos_orig = _find_pos(gx, gy)
        pos_rot = _find_pos(gy, gx) if gx != gy else None

        use_rotated = False
        if pos_orig and pos_rot:
            extent_orig = max(pos_orig[0] + gx, pos_orig[1] + gy)
            extent_rot = max(pos_rot[0] + gy, pos_rot[1] + gx)
            if extent_rot < extent_orig:
                use_rotated = True
        elif pos_rot and not pos_orig:
            use_rotated = True

        pos = pos_rot if use_rotated else pos_orig

        if pos:
            c, r = pos
            if use_rotated:
                _rotate_bin_90(bm)
                gx, gy = gy, gx
            _place(r, c, gy, gx)
            fitted.append(DrawerBin(
                id=str(uuid.uuid4()), bin_id=bm.id,
                group_name=bm.name or "",
                grid_col=c, grid_row=r,
                grid_x=gx, grid_y=gy,
            ))
        else:
            overflow.append(DrawerBin(
                id=str(uuid.uuid4()), bin_id=bm.id,
                group_name=bm.name or "",
                grid_col=0, grid_row=0,
                grid_x=gx, grid_y=gy,
            ))

    # position overflow in a row below the drawer
    if overflow:
        ox = 0
        oy = rows + 1
        for ob in overflow:
            ob.grid_col = ox
            ob.grid_row = oy
            ox += ob.grid_x

    return fitted, overflow
