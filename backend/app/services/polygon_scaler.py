import math
from shapely.geometry import Polygon as ShapelyPolygon
from shapely.validation import make_valid

from app.models.schemas import Polygon, Point


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
    ):
        self.id = id
        self.x_mm = x_mm
        self.y_mm = y_mm
        self.radius_mm = radius_mm
        self.shape = shape
        self.width_mm = width_mm
        self.height_mm = height_mm
        self.rotation = rotation


class ScaledPolygon:
    def __init__(self, id: str, points_mm: list[tuple[float, float]], label: str, finger_holes: list[ScaledFingerHole] = None, interior_rings_mm: list[list[tuple[float, float]]] = None):
        self.id = id
        self.points_mm = points_mm
        self.label = label
        self.finger_holes = finger_holes or []
        self.interior_rings_mm = interior_rings_mm or []


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

    def add_clearance(self, polygon: ScaledPolygon, clearance_mm: float) -> ScaledPolygon:
        """expand polygon outward by clearance amount"""
        if clearance_mm <= 0:
            return polygon

        try:
            shape = ShapelyPolygon(polygon.points_mm, holes=polygon.interior_rings_mm or [])
            if not shape.is_valid:
                shape = make_valid(shape)

            buffered = shape.buffer(clearance_mm, join_style=2)

            if buffered.geom_type == "Polygon":
                coords = list(buffered.exterior.coords)[:-1]
                holes = [list(interior.coords)[:-1] for interior in buffered.interiors]
            else:
                coords = polygon.points_mm
                holes = polygon.interior_rings_mm

            return ScaledPolygon(polygon.id, coords, polygon.label, polygon.finger_holes, holes)

        except Exception:
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
                return ScaledPolygon(polygon.id, coords, polygon.label, polygon.finger_holes, holes)
        except Exception:
            pass

        return polygon

    def smooth(self, polygon: ScaledPolygon, level: float = 0.5) -> ScaledPolygon:
        """simplify, chaikin subdivide, then clean near-collinear points.
        level 0..1 controls simplification aggressiveness before subdivision."""
        pts = polygon.points_mm
        if len(pts) < 4:
            return polygon
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        diag = math.hypot(max(xs) - min(xs), max(ys) - min(ys))
        # level 0 = gentle (0.002 * diag), level 1 = moderate (0.008 * diag)
        factor = 0.002 + level * (0.008 - 0.002)
        epsilon = max(0.3, diag * factor)
        simplified = self.simplify(polygon, tolerance_mm=epsilon)
        smoothed_pts = _chaikin_smooth(simplified.points_mm)
        smoothed_rings = [_chaikin_smooth(ring) for ring in simplified.interior_rings_mm]
        # clean up dense chaikin output — remove near-collinear points that
        # cause clipper2 chord artifacts, while keeping the smooth shape
        result = ScaledPolygon(polygon.id, smoothed_pts, polygon.label, polygon.finger_holes, smoothed_rings)
        return self.simplify(result, tolerance_mm=0.05)

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
