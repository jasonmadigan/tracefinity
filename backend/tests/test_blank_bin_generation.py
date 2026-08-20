from pathlib import Path

import pytest

from app.models.schemas import GenerateRequest
from app.services.stl_generator_manifold import (
    GF_BASE_HEIGHT,
    GF_GRID,
    GF_HEIGHT_UNIT,
    LIP_D0,
    LIP_D2,
    LIP_D3,
    LIP_D4,
    ManifoldSTLGenerator,
    _make_blank_bin_cutout,
)


def test_generate_blank_bin_writes_full_width_cutout(tmp_path: Path):
    output_path = tmp_path / "blank_bin.stl"
    config = GenerateRequest(
        grid_x=2,
        grid_y=1,
        height_units=3,
        magnets=False,
        stacking_lip=True,
        bed_size=0,
    )

    body, text_body = ManifoldSTLGenerator().generate_bin([], config, str(output_path))

    assert text_body is None
    assert output_path.exists()
    assert output_path.stat().st_size > 0
    assert body.bounding_box()[5] > 0


def test_blank_bin_cutout_observes_cutout_depth():
    shallow = GenerateRequest(
        grid_x=2,
        grid_y=1,
        height_units=4,
        magnets=False,
        stacking_lip=False,
        cutout_depth=8,
    )
    deep = shallow.model_copy(update={"cutout_depth": 14})
    wall_top_z = shallow.height_units * GF_HEIGHT_UNIT
    lip_deduction = (LIP_D3 + LIP_D4) if shallow.stacking_lip else 0
    max_depth = wall_top_z - GF_BASE_HEIGHT - 2 - lip_deduction

    _, shallow_depth = _make_blank_bin_cutout(shallow, wall_top_z, max_depth)
    _, deep_depth = _make_blank_bin_cutout(deep, wall_top_z, max_depth)

    assert shallow_depth == 8
    assert deep_depth == 14


def test_blank_bin_cutout_uses_stacking_lip_wall_thickness():
    config = GenerateRequest(
        grid_x=2,
        grid_y=1,
        height_units=4,
        magnets=False,
        stacking_lip=False,
        wall_thickness=5,
        cutout_depth=8,
    )
    wall_top_z = config.height_units * GF_HEIGHT_UNIT
    max_depth = wall_top_z - GF_BASE_HEIGHT - 2

    cutter, _ = _make_blank_bin_cutout(config, wall_top_z, max_depth)
    min_x, min_y, _, max_x, max_y, _ = cutter.bounding_box()

    expected_wall = LIP_D0 + LIP_D2
    assert max_x - min_x == pytest.approx(config.grid_x * GF_GRID - 0.5 - 2 * expected_wall)
    assert max_y - min_y == pytest.approx(config.grid_y * GF_GRID - 0.5 - 2 * expected_wall)


def test_deeper_blank_bin_cutout_removes_more_material(tmp_path: Path):
    config = GenerateRequest(
        grid_x=2,
        grid_y=1,
        height_units=4,
        magnets=False,
        stacking_lip=False,
        cutout_depth=8,
        bed_size=0,
    )
    generator = ManifoldSTLGenerator()

    shallow_body, _ = generator.generate_bin([], config, str(tmp_path / "shallow.stl"))
    deep_body, _ = generator.generate_bin([], config.model_copy(update={"cutout_depth": 14}), str(tmp_path / "deep.stl"))

    assert shallow_body.volume() > deep_body.volume()
