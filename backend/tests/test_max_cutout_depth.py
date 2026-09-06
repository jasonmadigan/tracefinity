"""Tests for max cutout depth calculation in stl_generator_manifold."""
import pytest

from app.models.schemas import GenerateRequest
from app.services.stl_generator_manifold import (
    MIN_CUTOUT_DEPTH,
    _max_pocket_depth,
)


def _config(height_units: int, stacking_lip: bool, shelled: bool = False):
    return GenerateRequest(
        grid_x=2, grid_y=2, height_units=height_units,
        stacking_lip=stacking_lip, shelled=shelled, magnets=False, bed_size=0,
    )


def _max_depth(height_units: int, stacking_lip: bool, shelled: bool = False) -> float:
    return _max_pocket_depth(_config(height_units, stacking_lip, shelled), height_units * 7.0)


class TestMaxCutoutDepth:
    def test_1u_locked_at_minimum(self):
        assert _max_depth(1, True) == MIN_CUTOUT_DEPTH
        assert _max_depth(1, False) == MIN_CUTOUT_DEPTH

    def test_2u_spans_1_5_to_8_5(self):
        # 1.5 + 7 * (2 - 1) = 8.5 without lip
        assert _max_depth(2, False) == 8.5
        # lip notch deducts 3.8mm
        assert _max_depth(2, True) == pytest.approx(4.7)

    def test_4u(self):
        assert _max_depth(4, False) == 22.5
        assert _max_depth(4, True) == pytest.approx(18.7)

    def test_shelled_ignores_lip_deduction(self):
        assert _max_depth(2, True, shelled=True) == 8.5
        assert _max_depth(2, False, shelled=True) == 8.5

    def test_toggling_lip_clamps_depth(self):
        # a depth of 8mm is valid at 2u without lip
        depth = 8.0
        max_with_lip = _max_depth(2, True)
        # toggling lip on should force clamp: min(8.0, 4.7) = 4.7
        assert min(depth, max_with_lip) == pytest.approx(4.7)
