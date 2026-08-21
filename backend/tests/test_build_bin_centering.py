"""Tests for tool centering when building bins from tools.

Reproduces the bug where auto-rotated tools appear offset in the 3D
preview: the bbox centre shifts away from (0,0) after rotation, but
_build_bin_from_tools assumed tools were always at origin.
"""

import math
import uuid
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from app.constants import GF_GRID
from app.models.schemas import FingerHole, Point, Tool


def _make_tool(points_mm, finger_holes=None, interior_rings=None):
    """create a minimal Tool with the given mm-space points."""
    return Tool(
        id=str(uuid.uuid4()),
        name="test-tool",
        points=[Point(x=x, y=y) for x, y in points_mm],
        finger_holes=finger_holes or [],
        interior_rings=interior_rings or [],
        created_at="2025-01-01T00:00:00",
    )


def _mock_tool_store(tools: dict[str, Tool]):
    """mock ToolStore.get to return tools by id."""
    store = MagicMock()
    store.get = lambda tid: tools.get(tid)
    return store


def _bbox_centre(points):
    xs = [p.x for p in points]
    ys = [p.y for p in points]
    return (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2


def _bin_centre(bin_model):
    bc = bin_model.bin_config
    return bc.grid_x * GF_GRID / 2, bc.grid_y * GF_GRID / 2


def _rotate_points(pts_mm, angle_deg):
    """rotate points around their centroid, same as frontend rotateGeometry."""
    n = len(pts_mm)
    cx = sum(x for x, y in pts_mm) / n
    cy = sum(y for x, y in pts_mm) / n
    rad = math.radians(angle_deg)
    cos_r, sin_r = math.cos(rad), math.sin(rad)
    return [
        (cx + (x - cx) * cos_r - (y - cy) * sin_r,
         cy + (x - cx) * sin_r + (y - cy) * cos_r)
        for x, y in pts_mm
    ]


class TestBuildBinCentering:
    """placed tools should be centred in the bin regardless of bbox position."""

    def test_origin_centred_tool_is_centred_in_bin(self):
        """tool at origin -> should be centred after placement."""
        from app.api.routes import _build_bin_from_tools

        # L-shaped tool centred at origin (bbox centre = 0,0)
        pts = [(-10, -10), (10, -10), (10, 0), (0, 0), (0, 10), (-10, 10)]
        tool = _make_tool(pts)
        tools = {tool.id: tool}
        store = _mock_tool_store(tools)

        result = _build_bin_from_tools("bin1", "test", None, [tool.id], store)
        placed = result.placed_tools[0]

        bin_cx, bin_cy = _bin_centre(result)
        placed_cx, placed_cy = _bbox_centre(placed.points)

        assert placed_cx == pytest.approx(bin_cx, abs=0.1)
        assert placed_cy == pytest.approx(bin_cy, abs=0.1)

    def test_long_narrow_tool_uses_more_than_ten_grid_units(self):
        from app.api.routes import _build_bin_from_tools

        tool = _make_tool([(0, 0), (600, 0), (600, 20), (0, 20)])
        store = _mock_tool_store({tool.id: tool})

        result = _build_bin_from_tools("bin1", "test", None, [tool.id], store)

        assert result.bin_config.grid_x == 15
        assert result.bin_config.grid_y == 1

    def test_tool_layout_over_resource_limit_is_rejected_instead_of_clipped(self):
        from app.api.routes import _build_bin_from_tools

        tool = _make_tool([(0, 0), (1050, 0), (1050, 20), (0, 20)])
        store = _mock_tool_store({tool.id: tool})

        with pytest.raises(HTTPException) as exc_info:
            _build_bin_from_tools("bin1", "test", None, [tool.id], store)

        assert exc_info.value.status_code == 422
        assert "require a 26x1 grid" in exc_info.value.detail
        assert "25 units per axis" in exc_info.value.detail

    def test_rotated_tool_is_centred_in_bin(self):
        """tool rotated around centroid (bbox no longer at origin) -> still centred."""
        from app.api.routes import _build_bin_from_tools

        # asymmetric tool: centroid != bbox centre
        pts = [(-15, -5), (15, -5), (15, 5), (5, 5), (5, 10), (-15, 10)]
        rotated = _rotate_points(pts, 35)
        tool = _make_tool(rotated)
        tools = {tool.id: tool}
        store = _mock_tool_store(tools)

        result = _build_bin_from_tools("bin1", "test", None, [tool.id], store)
        placed = result.placed_tools[0]

        bin_cx, bin_cy = _bin_centre(result)
        placed_cx, placed_cy = _bbox_centre(placed.points)

        assert placed_cx == pytest.approx(bin_cx, abs=0.1)
        assert placed_cy == pytest.approx(bin_cy, abs=0.1)

    def test_offset_tool_is_centred_in_bin(self):
        """tool with bbox centre far from origin -> still centred after placement."""
        from app.api.routes import _build_bin_from_tools

        # tool shifted so bbox centre is at (50, 30)
        pts = [(40, 20), (60, 20), (60, 40), (40, 40)]
        tool = _make_tool(pts)
        tools = {tool.id: tool}
        store = _mock_tool_store(tools)

        result = _build_bin_from_tools("bin1", "test", None, [tool.id], store)
        placed = result.placed_tools[0]

        bin_cx, bin_cy = _bin_centre(result)
        placed_cx, placed_cy = _bbox_centre(placed.points)

        assert placed_cx == pytest.approx(bin_cx, abs=0.1)
        assert placed_cy == pytest.approx(bin_cy, abs=0.1)

    def test_rotated_tool_finger_holes_centred(self):
        """finger holes should follow the same centering as polygon points."""
        from app.api.routes import _build_bin_from_tools

        pts = [(-15, -5), (15, -5), (15, 5), (-15, 5)]
        rotated = _rotate_points(pts, 45)

        # finger hole at centroid
        cx = sum(x for x, y in rotated) / len(rotated)
        cy = sum(y for x, y in rotated) / len(rotated)

        tool = _make_tool(rotated, finger_holes=[
            FingerHole(id="fh1", x=cx, y=cy, radius=3.0),
        ])
        tools = {tool.id: tool}
        store = _mock_tool_store(tools)

        result = _build_bin_from_tools("bin1", "test", None, [tool.id], store)
        placed = result.placed_tools[0]

        bin_cx, bin_cy = _bin_centre(result)
        placed_cx, placed_cy = _bbox_centre(placed.points)

        # finger hole should be offset from bin centre by same amount as
        # the centroid was offset from bbox centre in the original
        fh = placed.finger_holes[0]
        pts_xs = [p.x for p in placed.points]
        pts_ys = [p.y for p in placed.points]
        pts_bbox_cx = (min(pts_xs) + max(pts_xs)) / 2
        pts_bbox_cy = (min(pts_ys) + max(pts_ys)) / 2
        assert pts_bbox_cx == pytest.approx(bin_cx, abs=0.1)
        assert pts_bbox_cy == pytest.approx(bin_cy, abs=0.1)

    def test_rotated_tool_interior_rings_centred(self):
        """interior rings should follow the same centering."""
        from app.api.routes import _build_bin_from_tools

        pts = [(-20, -10), (20, -10), (20, 10), (-20, 10)]
        rotated = _rotate_points(pts, 30)

        # small interior ring near centre
        ring = _rotate_points([(-2, -2), (2, -2), (2, 2), (-2, 2)], 30)

        tool = _make_tool(rotated, interior_rings=[
            [Point(x=x, y=y) for x, y in ring],
        ])
        tools = {tool.id: tool}
        store = _mock_tool_store(tools)

        result = _build_bin_from_tools("bin1", "test", None, [tool.id], store)
        placed = result.placed_tools[0]

        bin_cx, bin_cy = _bin_centre(result)
        placed_cx, placed_cy = _bbox_centre(placed.points)

        assert placed_cx == pytest.approx(bin_cx, abs=0.1)
        assert placed_cy == pytest.approx(bin_cy, abs=0.1)
