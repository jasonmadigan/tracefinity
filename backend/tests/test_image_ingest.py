"""Tests for image ingest: EXIF orientation normalisation and downscaling."""
import io

import pytest
from PIL import Image

from app.models.schemas import CaptureCrop
from app.services.image_ingest import ingest_image


def _jpeg(width: int, height: int, orientation: int | None = None) -> bytes:
    img = Image.new("RGB", (width, height), "red")
    # asymmetric marker so orientation changes are detectable in pixels
    for x in range(min(40, width)):
        for y in range(min(10, height)):
            img.putpixel((x, y), (0, 0, 255))
    buf = io.BytesIO()
    if orientation is not None:
        exif = Image.Exif()
        exif[0x0112] = orientation
        img.save(buf, format="JPEG", exif=exif)
    else:
        img.save(buf, format="JPEG")
    return buf.getvalue()


def _open(content: bytes) -> Image.Image:
    return Image.open(io.BytesIO(content))


class TestOrientation:
    def test_orientation_6_normalised_without_resize(self):
        content = _jpeg(800, 600, orientation=6)

        out, ext, ratio = ingest_image(content, ".jpg", max_dim=2048)

        img = _open(out)
        assert (img.width, img.height) == (600, 800), "pixels must be upright"
        assert img.getexif().get(0x0112, 1) == 1, "orientation tag must be gone"
        assert ratio == 1.0

    def test_orientation_6_normalised_with_resize(self):
        content = _jpeg(3300, 2402, orientation=6)

        out, ext, ratio = ingest_image(content, ".jpg", max_dim=2048)

        img = _open(out)
        # upright is 2402x3300, long edge capped at 2048
        assert img.height == 2048
        assert img.width == round(2402 * (2048 / 3300))

    def test_no_orientation_small_image_untouched(self):
        content = _jpeg(800, 600)

        out, ext, ratio = ingest_image(content, ".jpg", max_dim=2048)

        assert out == content, "no re-encode when nothing changed"
        assert ratio == 1.0
        assert ext == ".jpg"


class TestDownscale:
    def test_ratio_matches_actual_resize(self):
        content = _jpeg(2402, 3300)

        out, ext, ratio = ingest_image(content, ".jpg", max_dim=2048)

        img = _open(out)
        assert img.height == 2048
        # round, not int: 2402 * 2048/3300 = 1490.69
        assert img.width == 1491
        assert ratio == pytest.approx(2048 / 3300)

    def test_png_stays_png(self):
        img = Image.new("RGB", (3000, 1000), "green")
        buf = io.BytesIO()
        img.save(buf, format="PNG")

        out, ext, ratio = ingest_image(buf.getvalue(), ".png", max_dim=2048)

        assert ext == ".png"
        assert _open(out).format == "PNG"
        assert _open(out).width == 2048

    def test_no_max_dim_skips_resize_but_normalises_orientation(self):
        content = _jpeg(3300, 2402, orientation=6)

        out, ext, ratio = ingest_image(content, ".jpg", max_dim=None)

        img = _open(out)
        assert (img.width, img.height) == (2402, 3300)
        assert ratio == 1.0

    def test_crop_happens_before_downscale(self):
        img = Image.new("RGB", (4032, 3024), "green")
        buf = io.BytesIO()
        img.save(buf, format="PNG")

        out, ext, ratio = ingest_image(
            buf.getvalue(),
            ".png",
            max_dim=2048,
            capture_crop=CaptureCrop(x=0, y=0, width=0.5, height=1),
        )

        cropped = _open(out)
        assert ext == ".png"
        assert cropped.height == 2048
        assert cropped.width == round(2016 * (2048 / 3024))
        assert ratio == pytest.approx(2048 / 3024)
