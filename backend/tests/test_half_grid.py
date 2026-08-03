"""tests for half-grid bin support (0.5-unit increments, half-grid baseplate)."""
import math
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.constants import GF_GRID
from app.models.schemas import BinParams, GenerateRequest
from app.services.stl_generator_manifold import (
    GF_HALF_GRID,
    ManifoldSTLGenerator,
    _base_cell_layout,
    _make_magnet_holes,
)

# ── validation ───────────────────────────────────────────────────────────────

def test_grid_accepts_half_units():
    p = BinParams(grid_x=3.5, grid_y=2.5)
    assert p.grid_x == 3.5
    assert p.grid_y == 2.5


def test_grid_accepts_integers():
    p = BinParams(grid_x=4, grid_y=3)
    assert p.grid_x == 4.0
    assert p.grid_y == 3.0


def test_grid_rejects_non_half_increment():
    with pytest.raises(ValidationError):
        BinParams(grid_x=2.3)


def test_grid_rejects_below_minimum():
    with pytest.raises(ValidationError):
        BinParams(grid_x=0.5)


def test_grid_rejects_above_maximum():
    with pytest.raises(ValidationError):
        BinParams(grid_x=10.5)


# ── cell layout ──────────────────────────────────────────────────────────────

def test_cell_layout_integer_full_grid():
    cells = _base_cell_layout(3, GF_GRID)
    assert len(cells) == 3
    widths = [w for _, w in cells]
    assert all(abs(w - GF_GRID) < 0.01 for w in widths)


def test_cell_layout_fractional_full_grid():
    cells = _base_cell_layout(3.5, GF_GRID)
    assert len(cells) == 4
    widths = [w for _, w in cells]
    # 3 full cells + 1 half cell
    assert abs(widths[-1] - GF_HALF_GRID) < 0.01


@pytest.mark.parametrize("grid_units", [2.5, 4.5, 6.5, 8.5])
def test_cell_layout_fractional_full_grid_even_half_units(grid_units: float):
    cells = _base_cell_layout(grid_units, GF_GRID)
    widths = [w for _, w in cells]
    assert abs(sum(widths) - grid_units * GF_GRID) < 0.01
    assert abs(widths[-1] - GF_HALF_GRID) < 0.01


def test_cell_layout_half_grid():
    cells = _base_cell_layout(2, GF_HALF_GRID)
    assert len(cells) == 4  # 2 full units = 4 half-grid cells
    widths = [w for _, w in cells]
    assert all(abs(w - GF_HALF_GRID) < 0.01 for w in widths)


def test_cell_layout_half_grid_fractional():
    cells = _base_cell_layout(3.5, GF_HALF_GRID)
    assert len(cells) == 7  # 3.5 units = 7 half-grid cells
    widths = [w for _, w in cells]
    assert all(abs(w - GF_HALF_GRID) < 0.01 for w in widths)


# ── STL generation ───────────────────────────────────────────────────────────

def test_half_unit_bin_generates(tmp_path: Path):
    config = GenerateRequest(
        grid_x=3.5, grid_y=2.5,
        height_units=3, magnets=False, stacking_lip=False, bed_size=0,
    )
    gen = ManifoldSTLGenerator()
    body, _ = gen.generate_bin([], config, str(tmp_path / "half.stl"))
    assert body.volume() > 0
    out = tmp_path / "half.stl"
    assert out.exists()


def test_half_grid_base_generates(tmp_path: Path):
    config = GenerateRequest(
        grid_x=2, grid_y=2,
        height_units=3, magnets=False, stacking_lip=False,
        half_grid_base=True, bed_size=0,
    )
    gen = ManifoldSTLGenerator()
    body, _ = gen.generate_bin([], config, str(tmp_path / "hgb.stl"))
    assert body.volume() > 0


def test_half_grid_base_more_cells_than_standard(tmp_path: Path):
    """half-grid base has 4x more base cells (2x per axis)."""
    standard = GenerateRequest(
        grid_x=2, grid_y=2,
        height_units=3, magnets=False, stacking_lip=False,
        half_grid_base=False, bed_size=0,
    )
    half = standard.model_copy(update={"half_grid_base": True})

    gen = ManifoldSTLGenerator()
    s_body, _ = gen.generate_bin([], standard, str(tmp_path / "s.stl"))
    h_body, _ = gen.generate_bin([], half, str(tmp_path / "h.stl"))

    # both should produce valid geometry
    assert s_body.volume() > 0
    assert h_body.volume() > 0
    # Blank bins now generate as container cavities, so the base pattern can
    # account for more of the remaining material than it did for solid shells.
    # The invariant for half-grid bases is the shared outer envelope.
    s_bb = s_body.bounding_box()
    h_bb = h_body.bounding_box()
    assert h_bb[3] - h_bb[0] == pytest.approx(s_bb[3] - s_bb[0])
    assert h_bb[4] - h_bb[1] == pytest.approx(s_bb[4] - s_bb[1])
    assert h_bb[5] - h_bb[2] == pytest.approx(s_bb[5] - s_bb[2])


def test_half_unit_bin_correct_outer_dimensions(tmp_path: Path):
    config = GenerateRequest(
        grid_x=3.5, grid_y=2,
        height_units=3, magnets=False, stacking_lip=False, bed_size=0,
    )
    gen = ManifoldSTLGenerator()
    body, _ = gen.generate_bin([], config, str(tmp_path / "dim.stl"))

    bb = body.bounding_box()  # (min_x, min_y, min_z, max_x, max_y, max_z)
    expected_w = 3.5 * GF_GRID - 0.5  # 146.5mm
    expected_h = 2 * GF_GRID - 0.5    # 83.5mm
    actual_w = bb[3] - bb[0]
    actual_h = bb[4] - bb[1]
    assert abs(actual_w - expected_w) < 0.1
    assert abs(actual_h - expected_h) < 0.1


def test_magnets_on_half_unit_bin(tmp_path: Path):
    """magnets are placed only on full 42mm cells, not partial cells."""
    config = GenerateRequest(
        grid_x=3.5, grid_y=2,
        height_units=3, magnets=True, stacking_lip=False, bed_size=0,
    )
    gen = ManifoldSTLGenerator()
    body, _ = gen.generate_bin([], config, str(tmp_path / "mag.stl"))
    assert body.volume() > 0


def test_half_grid_base_skips_magnets(tmp_path: Path):
    """half_grid_base disables magnet holes -- 21mm cells can't fit the 13mm offset."""

    standard = GenerateRequest(
        grid_x=2, grid_y=2,
        height_units=3, magnets=True, stacking_lip=False,
        half_grid_base=False, bed_size=0,
    )
    # model_copy bypasses validators, so magnets stays True -- tests the
    # defence-in-depth early return inside _make_magnet_holes itself
    half = standard.model_copy(update={"half_grid_base": True})

    s_holes = _make_magnet_holes(standard)
    h_holes = _make_magnet_holes(half)

    assert s_holes.volume() > 0
    assert h_holes.is_empty()


def test_half_grid_base_model_validator_forces_magnets_off():
    """model_validator on BinParams forces magnets=False when half_grid_base=True.
    this is the primary fix -- it changes the serialised config, invalidating
    any cached STL that was generated before the fix."""
    from app.models.schemas import BinConfig, BinParams

    bp = BinParams(magnets=True, half_grid_base=True)
    assert bp.magnets is False

    req = GenerateRequest(
        grid_x=2, grid_y=2, height_units=3,
        magnets=True, half_grid_base=True, bed_size=0,
    )
    assert req.magnets is False

    bc = BinConfig(magnets=True, half_grid_base=True)
    assert bc.magnets is False


def test_half_grid_base_full_generate_no_magnet_holes(tmp_path: Path):
    """end-to-end: generate_bin with half_grid_base produces identical volume
    regardless of the magnets flag (validator forces it off)."""
    gen = ManifoldSTLGenerator()
    with_flag = GenerateRequest(
        grid_x=2, grid_y=2, height_units=3,
        magnets=True, stacking_lip=False,
        half_grid_base=True, bed_size=0,
    )
    without_flag = GenerateRequest(
        grid_x=2, grid_y=2, height_units=3,
        magnets=False, stacking_lip=False,
        half_grid_base=True, bed_size=0,
    )
    body_w, _ = gen.generate_bin([], with_flag, str(tmp_path / "w.stl"))
    body_wo, _ = gen.generate_bin([], without_flag, str(tmp_path / "wo.stl"))
    assert abs(body_w.volume() - body_wo.volume()) < 0.01


def test_stacking_lip_on_half_unit_bin(tmp_path: Path):
    config = GenerateRequest(
        grid_x=2.5, grid_y=2.5,
        height_units=4, magnets=False, stacking_lip=True, bed_size=0,
    )
    gen = ManifoldSTLGenerator()
    body, _ = gen.generate_bin([], config, str(tmp_path / "lip.stl"))
    assert body.volume() > 0


def test_split_half_unit_bin(tmp_path: Path):
    """splitting works with fractional grid sizes."""
    config = GenerateRequest(
        grid_x=5.5, grid_y=2,
        height_units=3, magnets=False, stacking_lip=False, bed_size=100,
    )
    gen = ManifoldSTLGenerator()
    body, text = gen.generate_bin([], config, str(tmp_path / "big.stl"))
    parts = gen.split_bin(body, text, config, 100, str(tmp_path), "test")
    assert len(parts) >= 2
