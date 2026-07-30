from __future__ import annotations

import math
import os

os.environ.setdefault("DEVELOPMENT_MODE", "1")

from app.services.photo_checks import FULL_FRAME_DIAG_MM  # noqa: E402

A4_DIAG_MM = math.hypot(210, 297)


def rect_corners(cx: float, cy: float, w: float, h: float) -> list[tuple[float, float]]:
    """axis-aligned rect as TL, TR, BR, BL."""
    return [
        (cx - w / 2, cy - h / 2),
        (cx + w / 2, cy - h / 2),
        (cx + w / 2, cy + h / 2),
        (cx - w / 2, cy + h / 2),
    ]


def corners_for_height(height_mm: float, f35: float, img_w: int, img_h: int) -> list[tuple[float, float]]:
    """synthesise an A4 paper quad whose projected size implies height_mm."""
    img_diag = math.hypot(img_w, img_h)
    sensor_diag_mm = f35 * A4_DIAG_MM / height_mm
    paper_diag_px = sensor_diag_mm * img_diag / FULL_FRAME_DIAG_MM
    w = paper_diag_px * 210 / A4_DIAG_MM
    h = paper_diag_px * 297 / A4_DIAG_MM
    return rect_corners(img_w / 2, img_h / 2, w, h)
