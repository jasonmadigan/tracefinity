from shapely.geometry import Polygon as ShapelyPolygon
from shapely.validation import make_valid

from app.models.schemas import Polygon, Point


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
