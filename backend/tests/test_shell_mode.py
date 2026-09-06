"""Tests for shelled bin generation (constant-thickness shell).

Shell v2 model: additive construction. The top floor face is removed; an
outer wall band and per-tool wall rings trace the outlines at wall thickness.
Between them the trench runs open down to the floor plate at the base top.
Wall thickness is a user-selected 1-3mm slider.
"""
import pytest

from app.models.schemas import GenerateRequest, TextLabel
from app.services.polygon_scaler import ScaledPolygon
from app.services.stl_generator_manifold import (
    GF_BASE_HEIGHT,
    GF_HEIGHT_UNIT,
    LIP_D0,
    LIP_D2,
    LIP_D3,
    LIP_D4,
    SHELL_TRENCH_PLATE_T,
    ManifoldSTLGenerator,
    _effective_wall_thickness,
    _interior_clip_rect,
    _is_shelled,
)


def _config(**overrides) -> GenerateRequest:
    defaults = dict(
        grid_x=2,
        grid_y=2,
        height_units=4,
        magnets=False,
        stacking_lip=True,
        bed_size=0,
    )
    defaults.update(overrides)
    return GenerateRequest(**defaults)


def _square_poly(size=20.0, poly_id="tool"):
    return ScaledPolygon(
        id=poly_id,
        points_mm=[(0.0, 0.0), (size, 0.0), (size, size), (0.0, size)],
        label=poly_id,
        finger_holes=[],
        interior_rings_mm=[],
    )


# ── schema / thickness computation ───────────────────────────────────────────


def test_shelled_wall_thickness_is_direct():
    config = _config(shelled=True, wall_thickness=1.2)
    assert config.wall_thickness == pytest.approx(1.2)
    assert _effective_wall_thickness(config) == pytest.approx(1.2)


def test_shelled_thickness_clamped_to_slider_range():
    config = _config(shelled=True, wall_thickness=5.0)
    assert config.wall_thickness == pytest.approx(3.0)
    config = _config(shelled=True, wall_thickness=0.4)
    assert config.wall_thickness == pytest.approx(1.0)


def test_unshelled_keeps_wall_thickness_and_resets_shell_options():
    config = _config(wall_thickness=2.4, shelled=False,
                     shell_exterior_standard=False)
    assert config.wall_thickness == pytest.approx(2.4)
    assert config.shell_exterior_standard is True
    assert config.shell_exterior_wall is True


def test_stacking_lip_forces_exterior_wall_on():
    """The stacking lip needs the outer wall band to sit on: turning the
    exterior wall off with the lip enabled must normalize back to True."""
    config = _config(shelled=True, stacking_lip=True, shell_exterior_wall=False)
    assert config.shell_exterior_wall is True
    # without the lip the toggle survives
    config = _config(shelled=True, stacking_lip=False, shell_exterior_wall=False)
    assert config.shell_exterior_wall is False


def test_unshelled_wall_thickness_not_clamped_to_slider_range():
    config = _config(wall_thickness=0.8, shelled=False)
    assert config.wall_thickness == pytest.approx(0.8)


def test_is_shelled_defaults_false():
    assert _is_shelled(_config()) is False
    assert _is_shelled(_config(shelled=True)) is True


def test_interior_clip_rect_uses_shelled_thickness():
    config = _config(shelled=True, wall_thickness=1.2, stacking_lip=True)
    rect = _interior_clip_rect(config)
    outer_w = config.grid_x * 42.0 - 0.5
    # stacking lip inset (2.6) dominates over 1.2mm walls
    assert rect.bounds[2] - rect.bounds[0] == pytest.approx(outer_w - 2 * 2.6)


# ── end-to-end generation ────────────────────────────────────────────────────


def _load_mesh(path):
    import trimesh
    return trimesh.load(path, force="mesh")


def test_shelled_bin_volume_much_less_than_solid(tmp_path):
    gen = ManifoldSTLGenerator()
    solid_path = str(tmp_path / "solid.stl")
    shell_path = str(tmp_path / "shell.stl")
    gen.generate_bin([_square_poly()], _config(), solid_path)
    gen.generate_bin([_square_poly()], _config(shelled=True, wall_thickness=1.2), shell_path)

    solid = _load_mesh(solid_path)
    shell = _load_mesh(shell_path)
    assert solid.is_watertight and shell.is_watertight
    assert shell.volume < solid.volume * 0.6


def test_standard_shell_lip_band_reaches_wall_top(tmp_path):
    """With a stacking lip, the outer band widens to the spec lip wall thickness
    and runs to the wall top so the lip sits on it (no floating lip)."""
    gen = ManifoldSTLGenerator()
    path = str(tmp_path / "lipband.stl")
    config = _config(shelled=True, stacking_lip=True, shell_exterior_standard=True)
    gen.generate_bin([], config, path)
    mesh = _load_mesh(path)
    assert mesh.is_watertight
    import trimesh
    wall_top = config.height_units * GF_HEIGHT_UNIT
    # section just below the wall top must be a solid 2.6mm band ring, not empty:
    # area = outer footprint ring of thickness LIP_D0+LIP_D2
    section = mesh.section(plane_origin=[0, 0, wall_top - 0.3], plane_normal=[0, 0, 1])
    assert section is not None
    polys = section.to_planar()[0].polygons_full
    area = sum(p.area for p in polys)
    outer = config.grid_x * 42.0 - 0.5
    expected = outer * outer - (outer - 2 * (LIP_D0 + LIP_D2)) ** 2
    assert area == pytest.approx(expected, rel=0.05)


def test_shell_trench_plate_sealed(tmp_path):
    """The trench floor plate must seal the bottom: volume must exceed a
    zero-thickness membrane by roughly plate_thickness x footprint."""
    gen = ManifoldSTLGenerator()
    path = str(tmp_path / "plate.stl")
    gen.generate_bin([_square_poly()], _config(shelled=True), path)
    mesh = _load_mesh(path)
    assert mesh.is_watertight
    # 2x2 bin footprint ~83.5x83.5; 0.75mm plate over the whole base is
    # ~5200mm^3. A through-cut shell would lose most of that.
    assert mesh.volume > 0.8 * 83.5 * 83.5 * SHELL_TRENCH_PLATE_T


def test_shelled_bin_open_top(tmp_path):
    """The top floor face is removed: a horizontal slice above the tallest slab
    and below the lip must contain only wall bands/rings, not a filled floor."""
    gen = ManifoldSTLGenerator()
    path = str(tmp_path / "open.stl")
    # no polygons -> no slabs; matched exterior so cavity reaches wall top
    gen.generate_bin([], _config(shelled=True), path)
    mesh = _load_mesh(path)
    section = mesh.section(plane_origin=[0, 0, 30], plane_normal=[0, 0, 1])
    assert section is not None
    polys = section.to_planar()[0].polygons_full
    assert len(polys) > 0
    # the outer boundary must be a ring (has interior), not a solid disc:
    # total section area must be far less than the full footprint
    total_area = sum(p.area for p in polys)
    footprint = 83.5 * 83.5
    assert total_area < footprint * 0.2


def test_shelled_trench_floor_at_base_top(tmp_path):
    """Just below the base top the base is solid; above the trench floor
    plate (base top + plate thickness) the section is open (walls only)."""
    gen = ManifoldSTLGenerator()
    path = str(tmp_path / "floor.stl")
    gen.generate_bin([], _config(shelled=True), path)
    mesh = _load_mesh(path)
    section = mesh.section(plane_origin=[0, 0, GF_BASE_HEIGHT - 0.3], plane_normal=[0, 0, 1])
    assert section is not None
    polys = section.to_planar()[0].polygons_full
    total_area = sum(p.area for p in polys)
    assert total_area > 0.9 * 83.5 * 83.5
    # trench floor plate top = base top + plate thickness
    plate_top = GF_BASE_HEIGHT + SHELL_TRENCH_PLATE_T
    section = mesh.section(plane_origin=[0, 0, plate_top + 0.3], plane_normal=[0, 0, 1])
    polys = section.to_planar()[0].polygons_full
    total_area = sum(p.area for p in polys)
    assert total_area < 0.2 * 83.5 * 83.5


def test_standard_shell_trench_plate_seals_above_feet(tmp_path):
    """The 0.5mm trench floor plate sits ON TOP of the base cells: it must be
    present at mid-plate z (sealing the gaps between tool walls / outer band
    / base cells) while the grooves between the feet below the base top stay
    open (cells still separate polygons at the seam z)."""
    gen = ManifoldSTLGenerator()
    path = str(tmp_path / "plate.stl")
    gen.generate_bin([], _config(shelled=True), path)
    mesh = _load_mesh(path)
    assert mesh.is_watertight

    plate_top = GF_BASE_HEIGHT + SHELL_TRENCH_PLATE_T
    # mid-plate: nearly the full footprint is solid
    section = mesh.section(plane_origin=[0, 0, GF_BASE_HEIGHT + SHELL_TRENCH_PLATE_T / 2], plane_normal=[0, 0, 1])
    assert section is not None
    total_area = sum(p.area for p in section.to_planar()[0].polygons_full)
    assert total_area > 0.9 * 83.5 * 83.5
    # just below the base top: grooves between feet open (cells separate)
    section = mesh.section(plane_origin=[0, 0, GF_BASE_HEIGHT - 0.3], plane_normal=[0, 0, 1])
    assert section is not None
    polys = section.to_planar()[0].polygons_full
    assert len(polys) > 1, "grooves between feet are sealed below the plate"
    # plate does not extend above its top
    section = mesh.section(plane_origin=[0, 0, plate_top + 0.1], plane_normal=[0, 0, 1])
    polys = section.to_planar()[0].polygons_full
    total_area = sum(p.area for p in polys)
    assert total_area < 0.2 * 83.5 * 83.5


def test_standard_shell_grooves_between_feet_stay_open(tmp_path):
    """In standard mode there is no floor membrane: the grooves between the
    base feet stay open through the flare zone, so the flare chamfer between
    the feet is preserved exactly as on the solid bin.
    Regression: a full-footprint membrane plate filled the upper flare of
    those grooves (material from ~3.7 to 4.75mm at the seam between feet),
    merging the base cells into one blob and burying the chamfer there."""
    gen = ManifoldSTLGenerator()
    path = str(tmp_path / "grooves.stl")
    gen.generate_bin([], _config(shelled=True), path)
    mesh = _load_mesh(path)
    assert mesh.is_watertight

    # in the flare zone the solid base cells are separate polygons; a
    # membrane merging them yields a single polygon with the same area
    for z in (3.8, 4.1, 4.4, 4.6):
        section = mesh.section(plane_origin=[0, 0, z], plane_normal=[0, 0, 1])
        assert section is not None, f"no section at z={z}"
        polys = section.to_planar()[0].polygons_full
        assert len(polys) > 1, (
            f"z={z}: base cells merged into {len(polys)} polygon — a plate is "
            "filling the grooves between the feet (chamfer buried)"
        )


def test_standard_shell_exterior_matches_base_flare(tmp_path):
    """In standard mode the bin exterior must follow the gridfinity base
    flare: mid-flare sections must be no wider than the tapered base cells.
    Regression: the (since removed) full-footprint floor membrane was a
    straight extrusion, standing as a vertical skirt from (base_top - floor_t)
    up and burying the foot chamfer — the bin was full-width at z=3.76
    instead of mid-flare."""
    gen = ManifoldSTLGenerator()
    path = str(tmp_path / "flare.stl")
    gen.generate_bin([], _config(shelled=True), path)
    mesh = _load_mesh(path)
    assert mesh.is_watertight

    import numpy as np

    # outer_w/2 for a 2x2 bin is 41.75; mid-flare widths at these z are
    # outer_half - (GF_BASE_HEIGHT - z) from the base taper
    outer_half = 41.75
    for z in (3.9, 4.1, 4.4):
        section = mesh.section(plane_origin=[0, 0, z], plane_normal=[0, 0, 1])
        assert section is not None, f"no section at z={z}"
        v = section.vertices
        half_width = float(v[:, 0].max())
        expected = outer_half - (GF_BASE_HEIGHT - z)
        assert half_width == pytest.approx(expected, abs=0.05), (
            f"z={z}: exterior half-width {half_width:.3f} != flare {expected:.3f} "
            "(membrane skirt is covering the foot chamfer)"
        )


def test_tool_ring_and_slab_present(tmp_path):
    """With a tool trace, material must exist around the trace (ring) at mid
    height and under the pocket (slab top at pocket depth)."""
    gen = ManifoldSTLGenerator()
    path = str(tmp_path / "ring.stl")
    config = _config(shelled=True, cutout_depth=10.0, height_units=4)
    gen.generate_bin([_square_poly()], config, path)
    mesh = _load_mesh(path)
    assert mesh.is_watertight
    wall_top = 4 * GF_HEIGHT_UNIT
    slab_top = wall_top - 10.0
    # slice just above slab top: ring walls must be present around tool area
    section = mesh.section(plane_origin=[0, 0, slab_top + 1.0], plane_normal=[0, 0, 1])
    assert section is not None
    polys = section.to_planar()[0].polygons_full
    assert sum(p.area for p in polys) > 0


def test_tool_ring_full_height_regardless_of_exterior_standard(tmp_path):
    """Tool wall rings must reach the wall top whether or not Gridfinity
    Standard Exterior is on. Regression: with exterior_standard on the rings
    stopped at the cavity top (wall_top - LIP_D3 - LIP_D4), leaving the walls
    around the tool 3.8mm shorter than with it off. Measure the section area
    just below the wall top with and without a tool: the tool's ring band
    must add area in BOTH modes (with the old code it added none when
    exterior_standard was on, because the rings stopped 3.8mm lower)."""
    import numpy as np

    gen = ManifoldSTLGenerator()

    def _area_at_top(shelled_exterior_standard: bool, with_tool: bool) -> float:
        config = _config(
            shelled=True, height_units=4, wall_thickness=0.6,
            shell_exterior_standard=shelled_exterior_standard,
        )
        polys = [_square_poly(size=20.0, poly_id="tool")] if with_tool else []
        path = str(tmp_path / f"ringtop_{shelled_exterior_standard}_{with_tool}.stl")
        gen.generate_bin(polys, config, path)
        mesh = _load_mesh(path)
        assert mesh.is_watertight
        wall_top = config.height_units * GF_HEIGHT_UNIT
        # slice inside the lip zone (below lip base, above old cavity top):
        # with exterior_standard the rings previously never reached here
        section = mesh.section(
            plane_origin=[0, 0, wall_top - 1.0], plane_normal=[0, 0, 1]
        )
        assert section is not None
        polys_full = section.to_planar()[0].polygons_full
        return sum(p.area for p in polys_full)

    for ext_standard in (True, False):
        band_only = _area_at_top(ext_standard, with_tool=False)
        with_ring = _area_at_top(ext_standard, with_tool=True)
        # the trace is clipped to the interior rect, so the ring edges nearest
        # the bin corner merge into the outer band; only the free edges add
        # section area (~17mm^2 here). The old bug (rings stopping at the
        # cavity top) gave a delta of 0 with exterior_standard on, so any
        # solid positive delta proves the rings reach the wall top.
        assert with_ring > band_only + 5, (
            f"exterior_standard={ext_standard}: tool ring missing near wall top "
            f"(with tool {with_ring:.1f} vs band only {band_only:.1f})"
        )


def test_pocket_floor_solid_to_trench_floor(tmp_path):
    """The pocket floor must run from the pocket depth all the way down to the
    trench floor — the same vertical span as the ring walls beside it. The
    cutout depth selection controls the pocket depth in shell mode too, so
    with cutout_depth=10 the floor top sits at wall_top - 10. A ray cast down
    inside the tool trace hits exactly two surfaces: the pocket floor top and
    z=0, with no enclosed void in between.
    Regression: the pocket floor once stopped a wall-thickness below the
    pocket depth."""
    gen = ManifoldSTLGenerator()
    path = str(tmp_path / "deepfloor.stl")
    config = _config(shelled=True, cutout_depth=10.0, height_units=4)
    gen.generate_bin([_square_poly(size=20.0, poly_id="tool")], config, path)
    mesh = _load_mesh(path)
    assert mesh.is_watertight

    import numpy as np

    wall_top = config.height_units * GF_HEIGHT_UNIT
    slab_top = wall_top - 10.0  # cutout_depth controls the pocket depth
    # probe mid-trace: the 20mm square lands at x[-42,-22], y[22,42] after the
    # bin-space transform (offset + Y negation)
    pt = np.array([[-32.0, 32.0, wall_top]], dtype=np.float64)
    loc, _, _ = mesh.ray.intersects_location(
        pt, np.array([[0, 0, -1.0]]), multiple_hits=True
    )
    zs = sorted({round(float(p[2]), 2) for p in loc}, reverse=True)
    # exactly two surfaces: pocket floor top and the bin bottom — a void under
    # the pocket would add hits between slab_top and 0
    assert len(zs) == 2, f"expected a solid column (2 hits), got {zs}"
    assert zs[0] == pytest.approx(slab_top, abs=0.15), f"pocket floor top {zs}"
    assert zs[1] == pytest.approx(0.0, abs=0.15), f"bin bottom {zs}"


def test_pocket_depth_ignores_stacking_lip(tmp_path):
    """The stacking-lip notch must not reduce shell-mode pocket depth: the lip
    collar is perimeter-only geometry above the cavity top and never bounds
    the pocket cutter. The pocket floor top must sit at the same z with the
    lip on and off (regression: the lip deducted 3.8mm from shell pockets,
    making them shallower than the same bin without a lip)."""
    import numpy as np

    gen = ManifoldSTLGenerator()

    def _floor_top(stacking_lip: bool) -> float:
        config = _config(
            shelled=True, cutout_depth=10.0, height_units=4,
            stacking_lip=stacking_lip,
        )
        path = str(tmp_path / f"lip_{stacking_lip}.stl")
        gen.generate_bin([_square_poly(size=20.0, poly_id="tool")], config, path)
        mesh = _load_mesh(path)
        assert mesh.is_watertight
        wall_top = config.height_units * GF_HEIGHT_UNIT
        loc, _, _ = mesh.ray.intersects_location(
            np.array([[-32.0, 32.0, wall_top]], dtype=np.float64),
            np.array([[0, 0, -1.0]]),
            multiple_hits=True,
        )
        zs = sorted({round(float(p[2]), 2) for p in loc}, reverse=True)
        assert len(zs) >= 1, f"no surfaces hit (lip={stacking_lip})"
        return zs[0]

    expected = 4 * GF_HEIGHT_UNIT - 10.0  # cutout_depth controls pocket depth
    assert _floor_top(True) == pytest.approx(expected, abs=0.15)
    assert _floor_top(False) == pytest.approx(expected, abs=0.15)


def test_shelled_matched_exterior_watertight(tmp_path):
    gen = ManifoldSTLGenerator()
    path = str(tmp_path / "matched.stl")
    gen.generate_bin([_square_poly()], _config(shelled=True, shell_exterior_standard=False), path)
    assert _load_mesh(path).is_watertight


def test_shelled_with_text_labels(tmp_path):
    gen = ManifoldSTLGenerator()
    config = _config(
        shelled=True,
        text_labels=[TextLabel(id="t1", text="screws", x=42.0, y=42.0, font_size=6, depth=0.6, emboss=False)],
    )
    path = str(tmp_path / "shell_text.stl")
    bin_body, _ = gen.generate_bin([], config, path)
    assert not bin_body.is_empty()


def test_small_shelled_bin_watertight(tmp_path):
    gen = ManifoldSTLGenerator()
    path = str(tmp_path / "tiny.stl")
    config = _config(grid_x=1, grid_y=1, shelled=True, wall_thickness=3.0)
    gen.generate_bin([_square_poly()], config, path)
    assert _load_mesh(path).is_watertight


def test_shelled_partial_bins_compose(tmp_path):
    gen = ManifoldSTLGenerator()
    path = str(tmp_path / "partial.stl")
    config = _config(
        shelled=True,
        partial_bins=True,
        partial_bins_values=[True, True, True, False],
    )
    gen.generate_bin([_square_poly()], config, path)
    assert _load_mesh(path).is_watertight


def test_no_exterior_wall_drops_outer_band(tmp_path):
    """With shell_exterior_wall off the outer wall band must be gone: a
    mid-cavity section (no tools, stacking lip off) must be empty, while the
    same bin with the wall on shows the band ring. The trench floor plate
    below must remain in both (perimeter flush at the plate top)."""
    gen = ManifoldSTLGenerator()
    mesh_by_wall = {}
    for wall_on in (True, False):
        config = _config(
            shelled=True, stacking_lip=False,
            shell_exterior_wall=wall_on,
        )
        path = str(tmp_path / f"noband_{wall_on}.stl")
        gen.generate_bin([], config, path)
        mesh = _load_mesh(path)
        assert mesh.is_watertight
        mesh_by_wall[wall_on] = mesh

    mid_z = GF_BASE_HEIGHT + SHELL_TRENCH_PLATE_T + 2.0
    for wall_on, mesh in mesh_by_wall.items():
        section = mesh.section(plane_origin=[0, 0, mid_z], plane_normal=[0, 0, 1])
        polys = section.to_planar()[0].polygons_full if section else []
        area = sum(p.area for p in polys)
        if wall_on:
            assert area > 0.9 * 83.5 * 83.5 * 0.01, (
                "band ring missing with exterior wall on"
            )
        else:
            assert area == pytest.approx(0.0), (
                f"outer band still present with exterior wall off (area {area:.1f})"
            )

    # the trench floor plate must seal the bottom in both modes
    plate_top = GF_BASE_HEIGHT + SHELL_TRENCH_PLATE_T
    for wall_on, mesh in mesh_by_wall.items():
        section = mesh.section(
            plane_origin=[0, 0, GF_BASE_HEIGHT + SHELL_TRENCH_PLATE_T / 2],
            plane_normal=[0, 0, 1],
        )
        assert section is not None
        area = sum(p.area for p in section.to_planar()[0].polygons_full)
        assert area > 0.9 * 83.5 * 83.5, f"plate missing (wall_on={wall_on})"


def test_no_exterior_wall_keeps_tool_rings(tmp_path):
    """Without the outer band, tool wall rings must still stand and stay
    clipped to the standard gridfinity footprint: the mesh stays watertight
    and its bounding box must not exceed the standard footprint."""
    gen = ManifoldSTLGenerator()
    # tool trace near the bin edge so its ring reaches the perimeter clip
    poly = ScaledPolygon(
        id="edge",
        points_mm=[(55.0, 55.0), (75.0, 55.0), (75.0, 75.0), (55.0, 75.0)],
        label="edge",
        finger_holes=[],
        interior_rings_mm=[],
    )
    config = _config(
        shelled=True, stacking_lip=False, shell_exterior_wall=False,
        wall_thickness=1.2, height_units=4, cutout_depth=10.0,
    )
    path = str(tmp_path / "edgering.stl")
    gen.generate_bin([poly], config, path)
    mesh = _load_mesh(path)
    assert mesh.is_watertight
    import numpy as np
    extents = mesh.bounds[1] - mesh.bounds[0]
    outer = config.grid_x * 42.0 - 0.5
    assert extents[0] <= outer + 0.1 and extents[1] <= outer + 0.1, (
        f"footprint exceeded the standard gridfinity size: {extents}"
    )
    # a ring must exist: section at mid height has material
    mid_z = GF_BASE_HEIGHT + SHELL_TRENCH_PLATE_T + 2.0
    section = mesh.section(plane_origin=[0, 0, mid_z], plane_normal=[0, 0, 1])
    assert section is not None
    area = sum(p.area for p in section.to_planar()[0].polygons_full)
    assert area > 0, "tool wall rings missing without the exterior wall"
