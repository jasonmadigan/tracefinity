"""Tests for contrast insert STL generation."""
import os
import tempfile

import pytest

from app.services.polygon_scaler import ScaledPolygon
from app.services.stl_generator_manifold import ManifoldSTLGenerator

GF_GRID = 42.0


class FakeConfig:
    def __init__(self, insert_height=1.0, grid_x=2, grid_y=2, insert_clearance=None,
                 height_units=3, cutout_depth=5.0, depth_override=None, text_labels=None):
        self.insert_enabled = True
        self.insert_height = insert_height
        self.grid_x = grid_x
        self.grid_y = grid_y
        self.height_units = height_units
        self.cutout_depth = cutout_depth
        self.depth_override = depth_override
        self.wall_thickness = 1.0
        self.shelled = False
        self.stacking_lip = False
        self.half_grid_base = False
        self.text_labels = list(text_labels or [])
        if insert_clearance is not None:
            self.insert_clearance = insert_clearance


def _make_polygon(x, y, size, poly_id="test"):
    return ScaledPolygon(
        id=poly_id,
        points_mm=[(x, y), (x + size, y), (x + size, y + size), (x, y + size)],
        label="test",
        finger_holes=[],
        interior_rings_mm=[],
    )


def _grid_offsets(grid_x=2, grid_y=2):
    bin_width = grid_x * GF_GRID
    bin_depth = grid_y * GF_GRID
    return -bin_width / 2, -bin_depth / 2


@pytest.fixture
def generator():
    return ManifoldSTLGenerator()


@pytest.fixture
def output_path():
    fd, path = tempfile.mkstemp(suffix=".stl")
    os.close(fd)
    yield path
    if os.path.exists(path):
        os.unlink(path)


def test_generate_insert_produces_file(generator, output_path):
    poly = _make_polygon(10, 10, 20)
    config = FakeConfig()
    ox, oy = _grid_offsets()

    result = generator.generate_insert([poly], config, output_path, ox, oy)

    assert result is True
    assert os.path.exists(output_path)
    assert os.path.getsize(output_path) > 0


def test_generate_insert_empty_polygons(generator, output_path):
    config = FakeConfig()

    result = generator.generate_insert([], config, output_path, 0, 0)

    assert result is False


def test_generate_insert_custom_height(generator, output_path):
    poly = _make_polygon(10, 10, 20)
    config = FakeConfig(insert_height=2.5)
    ox, oy = _grid_offsets()

    result = generator.generate_insert([poly], config, output_path, ox, oy)

    assert result is True
    assert os.path.getsize(output_path) > 0


def test_generate_insert_multiple_polygons(generator, output_path):
    polys = [
        _make_polygon(5, 5, 15, "tool1"),
        _make_polygon(30, 30, 10, "tool2"),
    ]
    config = FakeConfig()
    ox, oy = _grid_offsets()

    result = generator.generate_insert(polys, config, output_path, ox, oy)

    assert result is True
    assert os.path.getsize(output_path) > 0


def test_generate_insert_degenerate_polygon(generator, output_path):
    degen = ScaledPolygon(
        id="degen",
        points_mm=[(0, 0), (1, 0)],
        label="degen",
        finger_holes=[],
        interior_rings_mm=[],
    )
    config = FakeConfig()
    ox, oy = _grid_offsets()

    result = generator.generate_insert([degen], config, output_path, ox, oy)

    assert result is False


def _stl_extents(path):
    import trimesh
    mesh = trimesh.load(path)
    return mesh.bounds[1] - mesh.bounds[0]


def _stl_bounds(path):
    import trimesh
    mesh = trimesh.load(path)
    return mesh.bounds


class FakeConfigWithDepth(FakeConfig):
    """legacy alias; FakeConfig now carries the pocket-depth fields."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)


def test_generate_insert_sits_at_pocket_floor(generator, output_path):
    """insert z-range must span [pocket floor, pocket floor + insert_height].

    3u bin: wall_top_z = 3 * 7 = 21. depth = cutout_depth 5 + insert_height 1
    = 6 (max_depth is far larger). floor = 15, top = 16.
    """
    poly = _make_polygon(10, 10, 20)
    config = FakeConfigWithDepth(insert_height=1.0, cutout_depth=5.0)
    ox, oy = _grid_offsets()

    assert generator.generate_insert([poly], config, output_path, ox, oy) is True

    bounds = _stl_bounds(output_path)
    assert bounds[0][2] == pytest.approx(21.0 - 6.0, abs=0.01)
    assert bounds[1][2] == pytest.approx(21.0 - 6.0 + 1.0, abs=0.01)


def test_generate_insert_respects_per_polygon_depth_override(generator, output_path):
    """a deeper per-cutout override pushes the insert's floor down accordingly."""
    poly = ScaledPolygon(
        id="deep",
        points_mm=[(10, 10), (30, 10), (30, 30), (10, 30)],
        label="deep",
        finger_holes=[],
        interior_rings_mm=[],
        depth_override=8.0,
    )
    config = FakeConfigWithDepth(insert_height=2.0, cutout_depth=5.0)
    ox, oy = _grid_offsets()

    assert generator.generate_insert([poly], config, output_path, ox, oy) is True

    bounds = _stl_bounds(output_path)
    # depth = 8 + 2 = 10; floor = 21 - 10 = 11; top = 13
    assert bounds[0][2] == pytest.approx(11.0, abs=0.01)
    assert bounds[1][2] == pytest.approx(13.0, abs=0.01)


def test_generate_insert_overlaps_tool_position(generator, output_path):
    """insert x/y must sit where the tool polygon lands in bin coordinates.

    polygon at (10,10) size 20 in a 2x2 bin: offsets are (-42,-42), the
    bin-space flip gives x in [-32,-12], y in [12,32].
    """
    poly = _make_polygon(10, 10, 20)
    config = FakeConfigWithDepth()
    ox, oy = _grid_offsets()

    assert generator.generate_insert([poly], config, output_path, ox, oy) is True

    bounds = _stl_bounds(output_path)
    assert bounds[0][0] == pytest.approx(10 + ox + 0.2, abs=0.05)
    assert bounds[1][0] == pytest.approx(30 + ox - 0.2, abs=0.05)
    # y is flipped: -(y + offset_y)
    assert bounds[0][1] == pytest.approx(-(30 + oy) + 0.2, abs=0.05)
    assert bounds[1][1] == pytest.approx(-(10 + oy) - 0.2, abs=0.05)


def test_generate_insert_default_fit_clearance(generator, output_path):
    """insert must be smaller than the pocket it drops into (default 0.2mm/side)."""
    poly = _make_polygon(10, 10, 20)
    config = FakeConfig()
    ox, oy = _grid_offsets()

    assert generator.generate_insert([poly], config, output_path, ox, oy) is True

    extents = _stl_extents(output_path)
    assert extents[0] == pytest.approx(20.0 - 2 * 0.2, abs=0.02)
    assert extents[1] == pytest.approx(20.0 - 2 * 0.2, abs=0.02)


def test_generate_insert_custom_fit_clearance(generator, output_path):
    poly = _make_polygon(10, 10, 20)
    config = FakeConfig(insert_clearance=0.5)
    ox, oy = _grid_offsets()

    assert generator.generate_insert([poly], config, output_path, ox, oy) is True

    extents = _stl_extents(output_path)
    assert extents[0] == pytest.approx(20.0 - 2 * 0.5, abs=0.02)


def test_generate_insert_keeps_all_pieces_when_clearance_splits_shape(generator, output_path):
    """a narrow neck can vanish under the fit clearance; every piece must survive.

    the dumbbell is shifted +2mm in x so both lobes sit fully inside the
    2x2 bin interior; overhanging tools are clipped to the interior like
    the pocket cutter, which would trim an overhanging lobe.
    """
    dumbbell = ScaledPolygon(
        id="dumbbell",
        points_mm=[
            (2, 0), (22, 0), (22, 9.85), (52, 9.85), (52, 0), (72, 0),
            (72, 20), (52, 20), (52, 10.15), (22, 10.15), (22, 20), (2, 20),
        ],
        label="dumbbell",
        finger_holes=[],
        interior_rings_mm=[],
    )
    config = FakeConfig()  # default 0.2mm clearance kills the 0.3mm neck
    ox, oy = _grid_offsets()

    assert generator.generate_insert([dumbbell], config, output_path, ox, oy) is True

    extents = _stl_extents(output_path)
    # both 20mm lobes present: full 70mm span minus clearance each side
    assert extents[0] == pytest.approx(70.0 - 2 * 0.2, abs=0.02)


def test_generate_insert_clipped_to_bin_interior(generator, output_path):
    """an overhanging tool must be trimmed to the bin interior, exactly like
    the pocket cutter -- the insert cannot be wider than the pocket."""
    dumbbell = ScaledPolygon(
        id="dumbbell",
        points_mm=[
            (0, 0), (20, 0), (20, 9.85), (50, 9.85), (50, 0), (70, 0),
            (70, 20), (50, 20), (50, 10.15), (20, 10.15), (20, 20), (0, 20),
        ],
        label="dumbbell",
        finger_holes=[],
        interior_rings_mm=[],
    )
    config = FakeConfig()
    ox, oy = _grid_offsets()

    assert generator.generate_insert([dumbbell], config, output_path, ox, oy) is True

    bounds = _stl_bounds(output_path)
    # interior wall for 2x2 bin at 1mm wall thickness: hw = 40.75;
    # the tool starts at bin x=-42, so the insert is clipped at -40.75
    # and pulled in a further 0.2mm by the fit clearance
    assert bounds[0][0] == pytest.approx(-40.75 + 0.2, abs=0.02)


def test_generate_insert_with_hole(generator, output_path):
    poly = ScaledPolygon(
        id="holed",
        points_mm=[(0, 0), (40, 0), (40, 40), (0, 40)],
        label="holed",
        finger_holes=[],
        interior_rings_mm=[[(10, 10), (30, 10), (30, 30), (10, 30)]],
    )
    config = FakeConfig()
    ox, oy = _grid_offsets()

    result = generator.generate_insert([poly], config, output_path, ox, oy)

    assert result is True
    assert os.path.getsize(output_path) > 0


class FakeLabel:
    """TextLabel fields the insert text cutter reads."""

    def __init__(self, text="ABC", x=20.0, y=20.0, font_size=5.0,
                 rotation=0.0, emboss=True, depth=0.5):
        self.text = text
        self.x = x
        self.y = y
        self.font_size = font_size
        self.rotation = rotation
        self.emboss = emboss
        self.depth = depth
        self.id = "lbl"


def test_generate_insert_cuts_embossed_text_from_underside(generator, output_path):
    """an embossed label inside the tool trace is subtracted from the insert
    bottom, so the bin's raised text stays visible through the insert."""
    poly = _make_polygon(10, 10, 20)
    label = FakeLabel(x=20.0, y=20.0, emboss=True, depth=0.5)
    config_with = FakeConfig(text_labels=[label])
    config_without = FakeConfig()
    ox, oy = _grid_offsets()

    import trimesh

    assert generator.generate_insert([poly], config_without, output_path, ox, oy) is True
    v_plain = trimesh.load(output_path).volume

    assert generator.generate_insert([poly], config_with, output_path, ox, oy) is True
    v_text = trimesh.load(output_path).volume

    # the text cutter removes material from the insert underside
    assert v_text < v_plain
    # removed volume is a thin slice, not a catastrophic boolean failure:
    # insert is ~19.6 x 19.6 x 1.0 minus clearance shrink
    assert v_plain > 300
    assert v_text > v_plain * 0.9


def test_generate_insert_ignores_recessed_text(generator, output_path):
    """recessed labels are cut INTO the bin floor, not raised into the insert,
    so they must not alter the insert geometry."""
    poly = _make_polygon(10, 10, 20)
    label = FakeLabel(x=20.0, y=20.0, emboss=False)
    config = FakeConfig(text_labels=[label])
    ox, oy = _grid_offsets()

    assert generator.generate_insert([poly], config, output_path, ox, oy) is True

    bounds = _stl_bounds(output_path)
    # full insert thickness intact: floor at pocket, top at pocket + height
    assert bounds[0][2] == pytest.approx(21.0 - 6.0, abs=0.01)
    assert bounds[1][2] == pytest.approx(21.0 - 6.0 + 1.0, abs=0.01)


def test_generate_insert_ignores_text_outside_polygons(generator, output_path):
    """an embossed label on the open bin surface (not inside any trace) must
    not cut the insert."""
    poly = _make_polygon(10, 10, 20)
    label = FakeLabel(x=70.0, y=70.0, emboss=True)
    config = FakeConfig(text_labels=[label])
    ox, oy = _grid_offsets()

    import trimesh

    assert generator.generate_insert([poly], config, output_path, ox, oy) is True
    v_text = trimesh.load(output_path).volume

    assert generator.generate_insert([poly], FakeConfig(), output_path, ox, oy) is True
    v_plain = trimesh.load(output_path).volume

    assert v_text == pytest.approx(v_plain, rel=1e-3)


def test_generate_insert_text_cut_respects_fit_clearance(generator, output_path):
    """the embossed-text cut must grow with the insert fit clearance: the
    insert needs its gap around the letters too, not just around the trace."""
    poly = _make_polygon(10, 10, 20)
    label = FakeLabel(x=20.0, y=20.0, emboss=True, depth=1.0)
    ox, oy = _grid_offsets()

    import trimesh

    # tight fit: 0.2 clearance
    assert generator.generate_insert(
        [poly], FakeConfig(text_labels=[label], insert_clearance=0.2), output_path, ox, oy
    ) is True
    v_tight = trimesh.load(output_path).volume

    # loose fit: 0.5 clearance widens the text cut as well
    assert generator.generate_insert(
        [poly], FakeConfig(text_labels=[label], insert_clearance=0.5), output_path, ox, oy
    ) is True
    v_loose = trimesh.load(output_path).volume

    # deeper cut removes more insert material
    assert v_loose < v_tight
    # and the difference is the clearance ring around the glyph volume:
    # bounded so a broken offset (no-op or huge) still fails
    removed = v_tight - v_loose
    assert removed > 0.1
    assert removed < (v_tight * 0.2)
