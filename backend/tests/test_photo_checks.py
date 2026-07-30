"""Unit tests for pre-trace photo quality checks."""

import io

import pytest
from PIL import ExifTags, Image

import app.services.photo_checks as photo_checks
from app.services.photo_checks import (
    MIN_CAMERA_HEIGHT_MM,
    check_photo,
    estimate_camera_height_mm,
    extract_focal_length_35mm,
)
from tests.conftest import corners_for_height, rect_corners


class TestEstimateCameraHeight:
    def test_recovers_known_height(self):
        corners = corners_for_height(500.0, 26.0, 4000, 3000)
        est = estimate_camera_height_mm(corners, 4000, 3000, "a4", 26.0)
        assert est == pytest.approx(500.0, rel=0.01)

    def test_none_without_focal_length(self):
        corners = corners_for_height(500.0, 26.0, 4000, 3000)
        assert estimate_camera_height_mm(corners, 4000, 3000, "a4", None) is None

    def test_none_for_degenerate_quad(self):
        corners = [(100.0, 100.0)] * 4
        assert estimate_camera_height_mm(corners, 4000, 3000, "a4", 26.0) is None


class TestCheckPhoto:
    def test_warns_when_camera_too_close(self):
        corners = corners_for_height(250.0, 26.0, 4000, 3000)
        warnings = check_photo(corners, 4000, 3000, "a4", 26.0)
        codes = [w.code for w in warnings]
        assert "camera_too_close" in codes
        msg = next(w.message for w in warnings if w.code == "camera_too_close")
        # 250/(250-15) - 1 = ~6.4% oversize for a 15mm tool
        assert "6.4" in msg
        assert "25 cm" in msg

    def test_no_camera_warning_at_comfortable_height(self):
        corners = corners_for_height(600.0, 26.0, 4000, 3000)
        warnings = check_photo(corners, 4000, 3000, "a4", 26.0)
        assert "camera_too_close" not in [w.code for w in warnings]

    def test_no_camera_warning_at_threshold_height(self):
        corners = corners_for_height(MIN_CAMERA_HEIGHT_MM, 26.0, 4000, 3000)
        warnings = check_photo(corners, 4000, 3000, "a4", 26.0)
        assert "camera_too_close" not in [w.code for w in warnings]

    def test_camera_warning_just_below_threshold(self):
        corners = corners_for_height(MIN_CAMERA_HEIGHT_MM - 1.0, 26.0, 4000, 3000)
        warnings = check_photo(corners, 4000, 3000, "a4", 26.0)
        assert "camera_too_close" in [w.code for w in warnings]

    def test_no_camera_warning_without_exif(self):
        corners = corners_for_height(250.0, 26.0, 4000, 3000)
        warnings = check_photo(corners, 4000, 3000, "a4", None)
        assert "camera_too_close" not in [w.code for w in warnings]

    def test_warns_when_paper_touches_edge(self):
        corners = [(0.0, 500.0), (1500.0, 480.0), (1520.0, 1600.0), (30.0, 1620.0)]
        warnings = check_photo(corners, 2048, 1536, "a4", None)
        assert "paper_out_of_frame" in [w.code for w in warnings]

    def test_warns_when_corner_beyond_edge(self):
        corners = [(-10.0, 500.0), (1500.0, 480.0), (1520.0, 1600.0), (30.0, 1620.0)]
        warnings = check_photo(corners, 2048, 1536, "a4", None)
        assert "paper_out_of_frame" in [w.code for w in warnings]

    def test_no_edge_warning_for_interior_paper(self):
        corners = rect_corners(1024, 768, 1200, 900)
        warnings = check_photo(corners, 2048, 1536, "a4", None)
        assert "paper_out_of_frame" not in [w.code for w in warnings]

    def test_warns_on_extreme_keystone(self):
        # top edge half the length of the bottom edge
        corners = [(700.0, 200.0), (1300.0, 200.0), (1700.0, 1300.0), (500.0, 1300.0)]
        warnings = check_photo(corners, 2048, 1536, "a4", None)
        assert "extreme_perspective" in [w.code for w in warnings]

    def test_no_keystone_warning_for_mild_angle(self):
        corners = [(590.0, 200.0), (1450.0, 210.0), (1500.0, 1300.0), (540.0, 1310.0)]
        warnings = check_photo(corners, 2048, 1536, "a4", None)
        assert "extreme_perspective" not in [w.code for w in warnings]

    def test_degenerate_quad_produces_no_warnings(self):
        warnings = check_photo([(100.0, 100.0)] * 4, 4000, 3000, "a4", 26.0)
        assert warnings == []

    def test_failing_check_does_not_break_others(self, monkeypatch):
        def boom(*args, **kwargs):
            raise RuntimeError("boom")

        monkeypatch.setattr(photo_checks, "_check_paper_in_frame", boom)
        corners = corners_for_height(250.0, 26.0, 4000, 3000)
        warnings = check_photo(corners, 4000, 3000, "a4", 26.0)
        assert "camera_too_close" in [w.code for w in warnings]


class TestExtractFocalLength:
    def _jpeg_with_exif(self, exif: Image.Exif | None) -> bytes:
        img = Image.new("RGB", (64, 48), "white")
        buf = io.BytesIO()
        if exif is not None:
            img.save(buf, format="JPEG", exif=exif)
        else:
            img.save(buf, format="JPEG")
        return buf.getvalue()

    def _jpeg_with_focal(self, value) -> bytes:
        exif = Image.Exif()
        exif.get_ifd(ExifTags.IFD.Exif)[ExifTags.Base.FocalLengthIn35mmFilm] = value
        return self._jpeg_with_exif(exif)

    def test_reads_focal_length_from_exif_ifd(self):
        content = self._jpeg_with_focal(26)
        assert extract_focal_length_35mm(content) == pytest.approx(26.0)

    def test_none_when_exif_stripped(self):
        content = self._jpeg_with_exif(None)
        assert extract_focal_length_35mm(content) is None

    def test_none_for_zero_focal_length(self):
        assert extract_focal_length_35mm(self._jpeg_with_focal(0)) is None

    def test_none_for_negative_focal_length(self):
        assert extract_focal_length_35mm(self._jpeg_with_focal(-26)) is None

    def test_none_for_infinite_focal_length(self):
        # inf round-trips through exif and would break session reads if stored
        assert extract_focal_length_35mm(self._jpeg_with_focal(float("inf"))) is None

    def test_none_for_nan_focal_length(self):
        assert extract_focal_length_35mm(self._jpeg_with_focal(float("nan"))) is None

    def test_none_for_garbage_bytes(self):
        assert extract_focal_length_35mm(b"not an image") is None
