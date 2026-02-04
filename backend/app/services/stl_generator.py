import logging
import time

from app.models.schemas import GenerateRequest
from app.services.polygon_scaler import ScaledPolygon

logger = logging.getLogger(__name__)

GF_GRID = 42.0
GF_HEIGHT_UNIT = 7.0
GF_BASE_HEIGHT = 4.75

# magnet hole dimensions (gridfinity standard)
MAGNET_DIAMETER = 6.0
MAGNET_DEPTH = 2.4
MAGNET_INSET = 4.8  # from cell corner


class STLGenerator:
    def generate_bin(
        self,
        polygons: list[ScaledPolygon],
        config: GenerateRequest,
        output_path: str,
        threemf_path: str | None = None,
    ) -> None:
        """generate using moritzmhmk gridfinity library"""
        import gridfinity as gf
        from build123d import (
            Box,
            BuildPart,
            BuildSketch,
            Circle,
            Cylinder,
            Location,
            Locations,
            Mode,
            Plane,
            Polygon as B123dPolygon,
            Sphere,
            Text,
            add,
            extrude,
            export_stl,
            Compound,
        )

        # create grid array
        grid = [[True] * config.grid_x for _ in range(config.grid_y)]
        height = config.height_units * GF_HEIGHT_UNIT

        # create base bin shell (no compartment - we'll add solid infill manually)
        stacking_lip = "default" if config.stacking_lip else None

        t0 = time.monotonic()

        bin_part = gf.Bin(
            grid=grid,
            height=height,
            compartment=None,
            stacking_lip=stacking_lip,
        )
        logger.info("gf.Bin shell: %.2fs", time.monotonic() - t0)

        with BuildPart() as bp:
            t1 = time.monotonic()
            add(bin_part)
            logger.info("add(bin_part): %.2fs", time.monotonic() - t1)

            t1 = time.monotonic()
            if config.magnets:
                from build123d import GridLocations
                # batch all magnet holes into a single boolean
                with BuildSketch(Plane.XY):
                    with gf.utils.IrregularGridLocations(GF_GRID, GF_GRID, grid):
                        with GridLocations(26, 26, 2, 2):
                            Circle(MAGNET_DIAMETER / 2)
                extrude(amount=MAGNET_DEPTH, mode=Mode.SUBTRACT)

                logger.info("magnets: %.2fs", time.monotonic() - t1)

            if polygons:
                from build123d import Align

                # use wall top (height), not bounding box max which includes stacking lip
                wall_top_z = height
                floor_z = GF_BASE_HEIGHT  # top of base profile
                infill_height = wall_top_z - floor_z

                # add solid infill block inside the bin
                bin_width = config.grid_x * GF_GRID
                bin_depth = config.grid_y * GF_GRID
                wall = config.wall_thickness
                infill_width = bin_width - 2 * wall - 0.5
                infill_depth = bin_depth - 2 * wall - 0.5

                t1 = time.monotonic()
                with Locations([(0, 0, floor_z + infill_height / 2)]):
                    Box(infill_width, infill_depth, infill_height,
                        align=(Align.CENTER, Align.CENTER, Align.CENTER),
                        mode=Mode.ADD)
                logger.info("infill box: %.2fs", time.monotonic() - t1)

            if polygons:
                offset_x = -bin_width / 2
                offset_y = -bin_depth / 2

                max_depth = wall_top_z - floor_z - 2
                pocket_depth = min(config.cutout_depth, max_depth)
                if pocket_depth < 5:
                    pocket_depth = 5

                # batch all polygon cutouts into a single boolean
                t1 = time.monotonic()
                try:
                    with BuildSketch(Plane.XY.offset(wall_top_z - pocket_depth)):
                        for poly in polygons:
                            shifted = [(p[0] + offset_x, -(p[1] + offset_y)) for p in poly.points_mm]
                            B123dPolygon(shifted, align=None)
                    extrude(amount=pocket_depth + 0.01, mode=Mode.SUBTRACT)
                except Exception:
                    # fallback: cut individually if batch fails
                    for poly in polygons:
                        shifted = [(p[0] + offset_x, -(p[1] + offset_y)) for p in poly.points_mm]
                        try:
                            with BuildSketch(Plane.XY.offset(wall_top_z - pocket_depth)):
                                B123dPolygon(shifted, align=None)
                            extrude(amount=pocket_depth + 0.01, mode=Mode.SUBTRACT)
                        except Exception:
                            pass
                logger.info("polygon cutouts (%d): %.2fs", len(polygons), time.monotonic() - t1)

                for i, poly in enumerate(polygons):
                    for j, fh in enumerate(poly.finger_holes):
                        try:
                            fh_x = fh.x_mm + offset_x
                            fh_y = -(fh.y_mm + offset_y)
                            shape = getattr(fh, 'shape', 'circle')
                            rotation = getattr(fh, 'rotation', 0.0)
                            logger.info("finger hole [%d][%d]: shape=%s pos=(%.1f,%.1f) r=%.1f wall_top=%.1f pocket=%.1f",
                                        i, j, shape, fh_x, fh_y, fh.radius_mm, wall_top_z, pocket_depth)

                            if shape == 'circle':
                                r = fh.radius_mm
                                # raise sphere so it doesn't cut below the pocket floor
                                pocket_floor_z = wall_top_z - pocket_depth
                                sphere_z = max(wall_top_z, pocket_floor_z + r)
                                with Locations([(fh_x, fh_y, sphere_z)]):
                                    Sphere(r, mode=Mode.SUBTRACT)
                            elif shape == 'square':
                                size = fh.radius_mm * 2
                                cut_z = wall_top_z - pocket_depth / 2
                                with Locations([Location((fh_x, fh_y, cut_z), (0, 0, rotation))]):
                                    Box(size, size, pocket_depth + 0.01, mode=Mode.SUBTRACT)
                            elif shape == 'rectangle':
                                w = fh.width_mm if fh.width_mm else fh.radius_mm * 2
                                h = fh.height_mm if fh.height_mm else fh.radius_mm * 2
                                cut_z = wall_top_z - pocket_depth / 2
                                with Locations([Location((fh_x, fh_y, cut_z), (0, 0, rotation))]):
                                    Box(w, h, pocket_depth + 0.01, mode=Mode.SUBTRACT)
                            logger.info("finger hole [%d][%d]: OK", i, j)
                        except Exception as e:
                            logger.warning("finger hole [%d][%d] failed: %s", i, j, e)

            # recessed text labels (cut into the bin body)
            if config.text_labels:
                bin_width_tl = config.grid_x * GF_GRID
                bin_depth_tl = config.grid_y * GF_GRID
                wall_top_z_tl = config.height_units * GF_HEIGHT_UNIT
                offset_x_tl = -bin_width_tl / 2
                offset_y_tl = -bin_depth_tl / 2

                for tl in config.text_labels:
                    if tl.emboss:
                        continue
                    try:
                        lx = tl.x + offset_x_tl
                        ly = -(tl.y + offset_y_tl)
                        with BuildSketch(Plane.XY.offset(wall_top_z_tl)):
                            with Locations([Location((lx, ly, 0), (0, 0, tl.rotation))]):
                                Text(tl.text, tl.font_size, font="Arial")
                        extrude(amount=-(tl.depth + 0.01), mode=Mode.SUBTRACT)
                    except Exception:
                        pass

        logger.info("total generate_bin: %.2fs", time.monotonic() - t0)
        bin_body = bp.part

        # embossed text labels as separate body for multi-colour 3MF
        embossed_labels = [tl for tl in (config.text_labels or []) if tl.emboss]
        text_body = None

        if embossed_labels:
            bin_width_tl = config.grid_x * GF_GRID
            bin_depth_tl = config.grid_y * GF_GRID
            wall_top_z_tl = config.height_units * GF_HEIGHT_UNIT
            offset_x_tl = -bin_width_tl / 2
            offset_y_tl = -bin_depth_tl / 2

            with BuildPart() as text_bp:
                for tl in embossed_labels:
                    try:
                        lx = tl.x + offset_x_tl
                        ly = -(tl.y + offset_y_tl)
                        with BuildSketch(Plane.XY.offset(wall_top_z_tl)):
                            with Locations([Location((lx, ly, 0), (0, 0, tl.rotation))]):
                                Text(tl.text, tl.font_size, font="Arial")
                        extrude(amount=tl.depth, mode=Mode.ADD)
                    except Exception:
                        pass

            if text_bp.part:
                text_body = text_bp.part

        t1 = time.monotonic()
        if text_body:
            combined = Compound([bin_body, text_body])
            export_stl(combined, output_path)
        else:
            export_stl(bin_body, output_path)
        logger.info("export_stl: %.2fs", time.monotonic() - t1)

        # 3MF: separate objects for multi-colour printing
        if text_body and threemf_path:
            try:
                from build123d import Mesher, Unit
                with Mesher(unit=Unit.MM) as mesher:
                    mesher.add_shape(bin_body)
                    mesher.add_shape(text_body)
                    mesher.write(threemf_path)
            except Exception:
                logger.warning("3MF export failed, skipping", exc_info=True)

        return bin_body, text_body

    @staticmethod
    def _compute_split_points(total_mm: float, grid_count: int, bed_size: float) -> list[float]:
        """return offsets (relative to bin center) where to cut along one axis.
        splits as evenly as possible rather than greedily packing from one side."""
        if bed_size <= 0 or total_mm <= bed_size:
            return []
        max_units_per_piece = max(1, int(bed_size // GF_GRID))
        import math
        num_pieces = math.ceil(grid_count / max_units_per_piece)
        # distribute units evenly: e.g. 5 units / 2 pieces -> [3, 2]
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
        """split a completed bin into pieces that fit the print bed. returns list of output paths."""
        from build123d import split, Keep, Plane, Compound, export_stl

        bin_width = config.grid_x * GF_GRID
        bin_depth = config.grid_y * GF_GRID

        # check if bin fits diagonally (rotated 45deg) before splitting
        import math
        fits_diagonal = (bin_width + bin_depth) / math.sqrt(2) <= bed_size
        if fits_diagonal:
            return []

        x_cuts = self._compute_split_points(bin_width, config.grid_x, bed_size)
        y_cuts = self._compute_split_points(bin_depth, config.grid_y, bed_size)

        if not x_cuts and not y_cuts:
            return []

        # combine bin + text into one part for splitting
        part = Compound([bin_body, text_body]) if text_body else bin_body

        # split along X first, then Y
        x_pieces = self._split_along_axis(part, x_cuts, axis='x')
        pieces = []
        for xp in x_pieces:
            pieces.extend(self._split_along_axis(xp, y_cuts, axis='y'))

        paths = []
        for i, piece in enumerate(pieces):
            path = f"{output_dir}/{session_id}_part{i + 1}.stl"
            export_stl(piece, path)
            paths.append(path)

        return paths

    @staticmethod
    def _split_along_axis(part, cut_points: list[float], axis: str) -> list:
        """split a part at the given cut points along an axis. returns list of pieces."""
        from build123d import split, Keep, Plane

        if not cut_points:
            return [part]

        cut_plane = Plane.YZ if axis == 'x' else Plane.XZ
        pieces = []
        remainder = part

        for cut in cut_points:
            left = split(remainder, bisect_by=cut_plane.offset(cut), keep=Keep.BOTTOM)
            right = split(remainder, bisect_by=cut_plane.offset(cut), keep=Keep.TOP)
            if left and left.solids():
                pieces.append(left)
            remainder = right

        if remainder and remainder.solids():
            pieces.append(remainder)

        return pieces

