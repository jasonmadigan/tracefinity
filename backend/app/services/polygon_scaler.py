import logging
import math

from shapely.geometry import Polygon as ShapelyPolygon
from shapely.validation import make_valid

from app.models.schemas import FingerHole, Point, Polygon

logger = logging.getLogger(__name__)

# Two millimetres keeps a smoothed right-angle corner within about 0.4mm.
# Mirrored in frontend lib/svg.ts; keep preview and generation in lockstep.
CHAIKIN_CORNER_SPAN_MM = 2.0


def smooth_epsilon(level: float) -> float:
    """DP tolerance for smoothing, absolute mm. trace noise is a property of
    the camera/mask resolution, not the tool, so it must not scale with size.
    mirrored in frontend lib/svg.ts smoothEpsilon; keep in lockstep."""
    level = max(0.0, min(1.0, level))
    return 0.3 + level * 1.2


def _chaikin_smooth(
    pts: list[tuple[float, float]], iterations: int = 3
) -> list[tuple[float, float]]:
    """chaikin corner-cutting subdivision. stays within the control polygon."""
    result = list(pts)
    for _ in range(iterations):
        new: list[tuple[float, float]] = []
        n = len(result)
        for i in range(n):
            p0 = result[i]
            p1 = result[(i + 1) % n]
            new.append((0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1]))
            new.append((0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1]))
        result = new
    return result


def _add_chaikin_support_points(
    pts: list[tuple[float, float]], corner_span_mm: float = CHAIKIN_CORNER_SPAN_MM
) -> list[tuple[float, float]]:
    """Bound Chaikin's corner influence without sampling straight interiors."""
    result: list[tuple[float, float]] = []
    n = len(pts)
    for i in range(n):
        p0 = pts[i]
        p1 = pts[(i + 1) % n]
        result.append(p0)
        length = math.dist(p0, p1)
        if length <= corner_span_mm:
            continue
        support_positions = (
            [0.5]
            if length <= 2 * corner_span_mm
            else [corner_span_mm / length, 1 - corner_span_mm / length]
        )
        for t in support_positions:
            result.append(
                (p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t)
            )
    return result


class ScaledFingerHole:
    def __init__(
        self,
        id: str,
        x_mm: float,
        y_mm: float,
        radius_mm: float,
        shape: str = "circle",
        width_mm: float | None = None,
        height_mm: float | None = None,
        rotation: float = 0.0,
        depth_override: float | None = None,
    ):
        self.id = id
        self.x_mm = x_mm
        self.y_mm = y_mm
        self.radius_mm = radius_mm
        self.shape = shape
        self.width_mm = width_mm
        self.height_mm = height_mm
        self.rotation = rotation
        self.depth_override = depth_override


class ScaledPolygon:
    def __init__(self, id: str, points_mm: list[tuple[float, float]], label: str, finger_holes: list[ScaledFingerHole] = None, interior_rings_mm: list[list[tuple[float, float]]] = None, depth_override: float | None = None):
        self.id = id
        self.points_mm = points_mm
        self.label = label
        self.finger_holes = finger_holes or []
        self.interior_rings_mm = interior_rings_mm or []
        self.depth_override = depth_override


class PolygonScaler:
    def scale_to_mm(
        self, polygons: list[Polygon], scale_factor: float
    ) -> list[ScaledPolygon]:
        """convert pixel coordinates to millimetres"""
        scaled = []
        for poly in polygons:
            points_mm = [(p.x * scale_factor, p.y * scale_factor) for p in poly.points]
            finger_holes = [
                ScaledFingerHole(
                    fh.id,
                    fh.x * scale_factor,
                    fh.y * scale_factor,
                    fh.radius,
                    shape=fh.shape,
                    width_mm=fh.width,
                    height_mm=fh.height,
                    rotation=fh.rotation,
                )
                for fh in poly.finger_holes
            ]
            interior_rings_mm = [
                [(p.x * scale_factor, p.y * scale_factor) for p in ring]
                for ring in poly.interior_rings
            ]
            scaled.append(ScaledPolygon(poly.id, points_mm, poly.label, finger_holes, interior_rings_mm))
        return scaled

    def scale_and_centre(
        self, poly: Polygon, scale_factor: float
    ) -> tuple[list[Point], list[FingerHole], list[list[Point]]]:
        """convert polygon from pixels to mm and centre at origin"""
        points_mm = [(p.x * scale_factor, p.y * scale_factor) for p in poly.points]
        if not points_mm:
            return [], [], []

        xs = [p[0] for p in points_mm]
        ys = [p[1] for p in points_mm]
        cx = (min(xs) + max(xs)) / 2
        cy = (min(ys) + max(ys)) / 2

        centered = [Point(x=p[0] - cx, y=p[1] - cy) for p in points_mm]

        interior_rings = []
        for ring in poly.interior_rings:
            ring_mm = [(p.x * scale_factor, p.y * scale_factor) for p in ring]
            interior_rings.append(
                [Point(x=p[0] - cx, y=p[1] - cy) for p in ring_mm]
            )

        finger_holes = [
            FingerHole(
                id=fh.id,
                x=fh.x * scale_factor - cx,
                y=fh.y * scale_factor - cy,
                radius=fh.radius,
                width=fh.width,
                height=fh.height,
                rotation=fh.rotation,
                shape=fh.shape,
            )
            for fh in poly.finger_holes
        ]

        return centered, finger_holes, interior_rings

    @staticmethod
    def _largest_polygon(geom):
        """largest Polygon component of a geometry, or None."""
        if geom.is_empty:
            return None
        if geom.geom_type == "Polygon":
            return geom
        pieces = [
            g for g in getattr(geom, "geoms", [])
            if g.geom_type == "Polygon" and not g.is_empty
        ]
        return max(pieces, key=lambda g: g.area) if pieces else None

    def add_clearance(self, polygon: ScaledPolygon, clearance_mm: float) -> ScaledPolygon:
        """expand polygon outward by clearance amount"""
        if clearance_mm <= 0:
            return polygon

        try:
            shape = ShapelyPolygon(polygon.points_mm, holes=polygon.interior_rings_mm or [])
            if not shape.is_valid:
                shape = make_valid(shape)

            buffered = shape.buffer(clearance_mm, join_style=2)
            result = self._largest_polygon(buffered)
            if result is None:
                logger.warning("clearance produced no usable outline for %s; keeping original", polygon.id)
                return polygon
            if buffered.geom_type != "Polygon":
                logger.warning("outline %s split during clearance repair; keeping largest piece", polygon.id)

            coords = list(result.exterior.coords)[:-1]
            holes = [list(interior.coords)[:-1] for interior in result.interiors]
            return ScaledPolygon(polygon.id, coords, polygon.label, polygon.finger_holes, holes, depth_override=polygon.depth_override)

        except Exception:
            logger.exception("clearance failed for %s; keeping original outline", polygon.id)
            return polygon

    def simplify(self, polygon: ScaledPolygon, tolerance_mm: float = 0.3) -> ScaledPolygon:
        """reduce vertex count via Douglas-Peucker. big speedup for CSG."""
        if len(polygon.points_mm) <= 8 and not polygon.interior_rings_mm:
            return polygon

        try:
            shape = ShapelyPolygon(polygon.points_mm, holes=polygon.interior_rings_mm or [])
            if not shape.is_valid:
                shape = make_valid(shape)

            simplified = shape.simplify(tolerance_mm, preserve_topology=True)

            if simplified.geom_type == "Polygon" and len(simplified.exterior.coords) >= 4:
                coords = list(simplified.exterior.coords)[:-1]
                holes = [list(interior.coords)[:-1] for interior in simplified.interiors]
                return ScaledPolygon(polygon.id, coords, polygon.label, polygon.finger_holes, holes, depth_override=polygon.depth_override)
        except Exception:
            pass

        return polygon

    def smooth(self, polygon: ScaledPolygon, level: float = 0.5) -> ScaledPolygon:
        """simplify, bound corner influence, then subdivide and clean.
        level 0..1 controls simplification aggressiveness before smoothing."""
        pts = polygon.points_mm
        if len(pts) < 4:
            return polygon
        simplified = self.simplify(polygon, tolerance_mm=smooth_epsilon(level))
        smoothed_pts = _chaikin_smooth(
            _add_chaikin_support_points(simplified.points_mm)
        )
        smoothed_rings = [
            _chaikin_smooth(_add_chaikin_support_points(ring))
            for ring in simplified.interior_rings_mm
        ]
        # clean up dense chaikin output — remove near-collinear points that
        # cause clipper2 chord artifacts, while keeping the smooth shape
        result = ScaledPolygon(polygon.id, smoothed_pts, polygon.label, polygon.finger_holes, smoothed_rings, depth_override=polygon.depth_override)
        return self.simplify(result, tolerance_mm=0.05)

    def prepare_for_generation(
        self,
        polygon: ScaledPolygon,
        clearance_mm: float,
        smoothed: bool,
        smooth_level: float = 0.5,
    ) -> ScaledPolygon:
        """cutout pipeline: smooth or simplify first, clearance last.
        vertex reduction erodes the outline by up to its tolerance; applied
        before buffering that erosion can never eat into the clearance, and
        the printed pocket is exactly the previewed shape grown by clearance."""
        shape = self.smooth(polygon, level=smooth_level) if smoothed else self.simplify(polygon)
        return self.add_clearance(shape, clearance_mm)

    def compute_bounding_box(
        self, polygons: list[ScaledPolygon]
    ) -> tuple[float, float]:
        """return combined bounding box dimensions"""
        if not polygons:
            return (0, 0)

        all_points = []
        for p in polygons:
            all_points.extend(p.points_mm)

        xs = [p[0] for p in all_points]
        ys = [p[1] for p in all_points]

        return (max(xs) - min(xs), max(ys) - min(ys))
