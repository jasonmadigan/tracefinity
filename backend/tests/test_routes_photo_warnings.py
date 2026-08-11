"""Route-level tests for photo warnings on upload and corner correction."""

import io

from fastapi.testclient import TestClient
from PIL import ExifTags, Image

import app.api.routes as routes
from app.config import ensure_user_dirs
from app.main import app
from app.models.schemas import Session
from tests.conftest import corners_for_height


def _client(tmp_path, monkeypatch):
    monkeypatch.setattr(routes.settings, "storage_path", tmp_path)
    routes._store_cache.clear()
    ensure_user_dirs(tmp_path / "default")
    return TestClient(app)


def _jpeg_bytes(w: int, h: int, f35: float | None) -> bytes:
    img = Image.new("RGB", (w, h), "white")
    buf = io.BytesIO()
    if f35 is not None:
        exif = Image.Exif()
        exif.get_ifd(ExifTags.IFD.Exif)[ExifTags.Base.FocalLengthIn35mmFilm] = int(f35)
        img.save(buf, format="JPEG", exif=exif)
    else:
        img.save(buf, format="JPEG")
    return buf.getvalue()


def test_upload_stores_focal_length_from_exif(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    monkeypatch.setattr(
        routes.image_processor, "detect_paper_corners", lambda path: None
    )

    resp = client.post(
        "/api/upload",
        files={"image": ("photo.jpg", _jpeg_bytes(800, 600, 26.0), "image/jpeg")},
    )
    assert resp.status_code == 200
    sessions, _, _ = routes.get_stores("default")
    assert sessions.get(resp.json()["session_id"]).focal_length_35mm == 26.0


def test_upload_without_exif_stores_no_focal_length(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    monkeypatch.setattr(
        routes.image_processor, "detect_paper_corners", lambda path: None
    )

    resp = client.post(
        "/api/upload",
        files={"image": ("photo.jpg", _jpeg_bytes(800, 600, None), "image/jpeg")},
    )
    assert resp.status_code == 200
    sessions, _, _ = routes.get_stores("default")
    assert sessions.get(resp.json()["session_id"]).focal_length_35mm is None


def test_upload_rejects_image_over_pixel_limit(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    monkeypatch.setattr(routes.settings, "max_image_pixels", 100)

    resp = client.post(
        "/api/upload",
        files={"image": ("photo.jpg", _jpeg_bytes(11, 10, None), "image/jpeg")},
    )

    assert resp.status_code == 413
    assert resp.json() == {"detail": "image has 110 pixels; maximum is 100"}


def test_upload_focal_length_survives_downscale(tmp_path, monkeypatch):
    """exif is stripped when the image is re-encoded; extraction must happen first."""
    client = _client(tmp_path, monkeypatch)
    monkeypatch.setattr(
        routes.image_processor, "detect_paper_corners", lambda path: None
    )
    monkeypatch.setattr(routes, "MAX_UPLOAD_DIM", 400)

    resp = client.post(
        "/api/upload",
        files={"image": ("photo.jpg", _jpeg_bytes(800, 600, 26.0), "image/jpeg")},
    )
    assert resp.status_code == 200
    sessions, _, _ = routes.get_stores("default")
    assert sessions.get(resp.json()["session_id"]).focal_length_35mm == 26.0


def _seed_session_with_upload(tmp_path, monkeypatch, f35):
    client = _client(tmp_path, monkeypatch)
    uploads = tmp_path / "default" / "uploads"
    uploads.mkdir(parents=True, exist_ok=True)
    (uploads / "s1.jpg").write_bytes(_jpeg_bytes(800, 600, None))
    sessions, _, _ = routes.get_stores("default")
    sessions.set("s1", Session(
        id="s1",
        original_image_path="default/uploads/s1.jpg",
        focal_length_35mm=f35,
    ))
    return client, sessions


def test_corners_returns_and_persists_warnings(tmp_path, monkeypatch):
    client, sessions = _seed_session_with_upload(tmp_path, monkeypatch, f35=26.0)
    corners = corners_for_height(250.0, 26.0, 800, 600)

    resp = client.post(
        "/api/sessions/s1/corners",
        json={
            "corners": [{"x": x, "y": y} for x, y in corners],
            "paper_size": "a4",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "camera_too_close" in [w["code"] for w in body["warnings"]]
    assert "camera_too_close" in [w.code for w in sessions.get("s1").photo_warnings]


def test_corners_without_focal_length_is_graceful(tmp_path, monkeypatch):
    client, sessions = _seed_session_with_upload(tmp_path, monkeypatch, f35=None)
    corners = corners_for_height(250.0, 26.0, 800, 600)

    resp = client.post(
        "/api/sessions/s1/corners",
        json={
            "corners": [{"x": x, "y": y} for x, y in corners],
            "paper_size": "a4",
        },
    )
    assert resp.status_code == 200
    assert "camera_too_close" not in [w["code"] for w in resp.json()["warnings"]]


def test_corners_succeeds_when_photo_checks_raise(tmp_path, monkeypatch):
    """a broken check must not fail perspective correction."""
    client, sessions = _seed_session_with_upload(tmp_path, monkeypatch, f35=26.0)

    def boom(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(routes, "check_photo", boom)
    corners = corners_for_height(250.0, 26.0, 800, 600)

    resp = client.post(
        "/api/sessions/s1/corners",
        json={
            "corners": [{"x": x, "y": y} for x, y in corners],
            "paper_size": "a4",
        },
    )
    assert resp.status_code == 200
    assert resp.json()["warnings"] == []
    assert sessions.get("s1").photo_warnings is None
