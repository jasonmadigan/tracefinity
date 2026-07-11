import io
import json
import logging

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from pydantic import ValidationError

import app.api.routes as routes
from app.config import ensure_user_dirs, settings
from app.main import app
from app.models.schemas import CaptureCrop, PhotoStation, Point, Session
from app.services.photo_station_store import PhotoStationStore


def _api_client(tmp_path, monkeypatch, photo_stations: bool = True):
    monkeypatch.setattr(settings, "storage_path", tmp_path)
    monkeypatch.setattr(routes.settings, "storage_path", tmp_path)
    monkeypatch.setattr(settings, "photo_stations", photo_stations)
    routes._store_cache.clear()
    routes._project_store_cache.clear()
    routes._photo_station_store_cache.clear()
    ensure_user_dirs(tmp_path / "default")
    return TestClient(app)


def _corners(width: float = 100.0, height: float | None = None):
    height = width if height is None else height
    return [
        Point(x=0, y=0),
        Point(x=width, y=0),
        Point(x=width, y=height),
        Point(x=0, y=height),
    ]


def _write_image(path, size=(120, 160)):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, color=(32, 64, 96)).save(path)


def _image_bytes(size=(120, 160), fmt="PNG"):
    buf = io.BytesIO()
    Image.new("RGB", size, color=(32, 64, 96)).save(buf, format=fmt)
    return buf.getvalue()


def test_photo_station_feature_flag_defaults_off(tmp_path, monkeypatch):
    client = _api_client(tmp_path, monkeypatch, photo_stations=False)

    assert client.get("/api/api-keys").json()["photo_stations"] is False
    assert client.get("/api/photo-stations").status_code == 404

    resp = client.post(
        "/api/upload",
        data={"capture_crop": json.dumps({"x": 0, "y": 0, "width": 1, "height": 1})},
        files={"image": ("photo.png", _image_bytes(), "image/png")},
    )

    assert resp.status_code == 404


def test_photo_station_geometry_rejects_non_finite_values():
    with pytest.raises(ValidationError):
        Point(x=float("nan"), y=0)

    with pytest.raises(ValidationError):
        CaptureCrop(x=0, y=0, width=float("inf"), height=1)


def test_photo_station_store_round_trips(tmp_path):
    store = PhotoStationStore(tmp_path)
    station = PhotoStation(
        id="station-1",
        name="Desk station",
        image_width=100,
        image_height=100,
        paper_size="a4",
        corners=_corners(),
    )

    store.set(station.id, station)
    reloaded = PhotoStationStore(tmp_path)

    assert reloaded.get("station-1").name == "Desk station"
    assert reloaded.get("station-1").corners[2].x == 100


def test_photo_station_store_logs_corrupt_json(tmp_path, caplog):
    store_path = tmp_path / "photo-stations.json"
    store_path.write_text("{invalid json!!!")

    with caplog.at_level(logging.ERROR):
        store = PhotoStationStore(tmp_path)

    assert store.all() == {}
    assert not store_path.exists()
    moved = list(tmp_path.glob("photo-stations.corrupt-*.json"))
    assert len(moved) == 1
    assert moved[0].read_text() == "{invalid json!!!"
    assert any("Failed to load" in record.message for record in caplog.records)


def test_create_station_from_confirmed_session(tmp_path, monkeypatch):
    client = _api_client(tmp_path, monkeypatch)
    session_store, _, _ = routes.get_stores("default")
    session_store.set("session-1", Session(
        id="session-1",
        original_image_width=120,
        original_image_height=160,
        corners=_corners(),
        paper_size="letter",
    ))

    resp = client.post("/api/photo-stations", json={
        "name": "Phone mount",
        "session_id": "session-1",
    })

    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Phone mount"
    assert data["paper_size"] == "letter"
    assert data["image_width"] == 120


def test_create_station_copies_upload_to_station_owned_photo(tmp_path, monkeypatch):
    client = _api_client(tmp_path, monkeypatch)
    original = tmp_path / "default" / "uploads" / "session-1.jpg"
    _write_image(original)
    session_store, _, _ = routes.get_stores("default")
    session_store.set("session-1", Session(
        id="session-1",
        original_image_path="default/uploads/session-1.jpg",
        original_image_width=120,
        original_image_height=160,
        corners=_corners(),
        paper_size="letter",
    ))

    resp = client.post("/api/photo-stations", json={
        "name": "Phone mount",
        "session_id": "session-1",
    })

    assert resp.status_code == 200
    image_path = resp.json()["image_path"]
    assert image_path.startswith("default/station-photos/")
    assert "\\" not in image_path
    assert (tmp_path / image_path).exists()


def test_create_station_requires_confirmed_corners(tmp_path, monkeypatch):
    client = _api_client(tmp_path, monkeypatch)
    session_store, _, _ = routes.get_stores("default")
    session_store.set("session-1", Session(
        id="session-1",
        original_image_width=120,
        original_image_height=160,
    ))

    resp = client.post("/api/photo-stations", json={
        "name": "Phone mount",
        "session_id": "session-1",
    })

    assert resp.status_code == 400


def test_create_station_rejects_wrong_corner_count(tmp_path, monkeypatch):
    client = _api_client(tmp_path, monkeypatch)
    session_store, _, _ = routes.get_stores("default")
    session_store.set("session-1", Session(
        id="session-1",
        original_image_width=120,
        original_image_height=160,
        paper_size="a4",
    ))

    resp = client.post("/api/photo-stations", json={
        "name": "Phone mount",
        "session_id": "session-1",
        "paper_size": "a4",
        "corners": [{"x": 0, "y": 0}, {"x": 1, "y": 0}, {"x": 1, "y": 1}],
    })

    assert resp.status_code == 400


def test_get_photo_station_returns_single_station(tmp_path, monkeypatch):
    client = _api_client(tmp_path, monkeypatch)
    station_store = routes.get_photo_station_store("default")
    station_store.set("station-1", PhotoStation(
        id="station-1",
        name="Desk station",
        image_width=100,
        image_height=100,
        paper_size="a4",
        corners=_corners(),
    ))

    ok = client.get("/api/photo-stations/station-1")
    missing = client.get("/api/photo-stations/missing")

    assert ok.status_code == 200
    assert ok.json()["name"] == "Desk station"
    assert missing.status_code == 404


def test_list_photo_stations_returns_recent_first(tmp_path, monkeypatch):
    client = _api_client(tmp_path, monkeypatch)
    station_store = routes.get_photo_station_store("default")
    station_store.set("old", PhotoStation(
        id="old",
        name="Old station",
        image_width=100,
        image_height=100,
        paper_size="a4",
        corners=_corners(),
        created_at="2026-01-01T00:00:00+00:00",
        updated_at="2026-01-02T00:00:00+00:00",
    ))
    station_store.set("new", PhotoStation(
        id="new",
        name="New station",
        image_width=100,
        image_height=100,
        paper_size="a4",
        corners=_corners(),
        created_at="2026-01-03T00:00:00+00:00",
        updated_at="2026-01-04T00:00:00+00:00",
    ))

    resp = client.get("/api/photo-stations")

    assert resp.status_code == 200
    assert [station["id"] for station in resp.json()["stations"]] == ["new", "old"]


def test_update_station_renames_and_edits_corners(tmp_path, monkeypatch):
    client = _api_client(tmp_path, monkeypatch)
    station_store = routes.get_photo_station_store("default")
    station_store.set("station-1", PhotoStation(
        id="station-1",
        name="Desk station",
        image_width=100,
        image_height=100,
        paper_size="a4",
        corners=_corners(),
    ))

    resp = client.patch("/api/photo-stations/station-1", json={
        "name": "Phone station",
        "paper_size": "letter",
        "corners": [
            {"x": 5, "y": 6},
            {"x": 90, "y": 7},
            {"x": 88, "y": 92},
            {"x": 4, "y": 91},
        ],
    })

    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Phone station"
    assert data["paper_size"] == "letter"
    assert data["corners"][0] == {"x": 5.0, "y": 6.0}
    assert station_store.get("station-1").corners[2].x == 88


def test_update_station_rejects_wrong_corner_count(tmp_path, monkeypatch):
    client = _api_client(tmp_path, monkeypatch)
    station_store = routes.get_photo_station_store("default")
    station_store.set("station-1", PhotoStation(
        id="station-1",
        name="Desk station",
        image_width=100,
        image_height=100,
        paper_size="a4",
        corners=_corners(),
    ))

    resp = client.patch("/api/photo-stations/station-1", json={
        "corners": [{"x": 5, "y": 6}, {"x": 90, "y": 7}, {"x": 88, "y": 92}],
    })

    assert resp.status_code == 400


def test_delete_station_removes_owned_photo(tmp_path, monkeypatch):
    client = _api_client(tmp_path, monkeypatch)
    photo = tmp_path / "default" / "station-photos" / "station-1.jpg"
    _write_image(photo)
    station_store = routes.get_photo_station_store("default")
    station_store.set("station-1", PhotoStation(
        id="station-1",
        name="Desk station",
        image_width=100,
        image_height=100,
        image_path="default/station-photos/station-1.jpg",
        paper_size="a4",
        corners=_corners(),
    ))

    resp = client.delete("/api/photo-stations/station-1")

    assert resp.status_code == 200
    assert station_store.get("station-1") is None
    assert not photo.exists()


def test_station_suggestions_are_backend_owned_and_filter_far(tmp_path, monkeypatch):
    client = _api_client(tmp_path, monkeypatch)
    session_store, _, _ = routes.get_stores("default")
    station_store = routes.get_photo_station_store("default")
    session_store.set("session-1", Session(
        id="session-1",
        original_image_path="default/uploads/session-1.jpg",
        original_image_width=101,
        original_image_height=122,
        corners=_corners(101, 122),
    ))
    station_store.set("near", PhotoStation(
        id="near",
        name="Near station",
        image_width=100,
        image_height=120,
        paper_size="a4",
        corners=_corners(100, 120),
    ))
    station_store.set("far", PhotoStation(
        id="far",
        name="Far station",
        image_width=160,
        image_height=120,
        paper_size="a4",
        corners=_corners(160, 120),
    ))

    resp = client.get("/api/sessions/session-1/station-suggestions")

    assert resp.status_code == 200
    data = resp.json()
    assert data["station_count"] == 2
    assert [s["station"]["id"] for s in data["suggestions"]] == ["near"]
    assert data["suggestions"][0]["match_status"] == "near"
    assert data["suggestions"][0]["height_delta_percent"] == pytest.approx(1.667)


def test_station_suggestions_return_empty_for_legacy_sessions_without_dimensions(tmp_path, monkeypatch):
    client = _api_client(tmp_path, monkeypatch)
    session_store, _, _ = routes.get_stores("default")
    station_store = routes.get_photo_station_store("default")
    session_store.set("session-1", Session(
        id="session-1",
        original_image_path="default/uploads/session-1.jpg",
        corners=_corners(),
    ))
    station_store.set("station-1", PhotoStation(
        id="station-1",
        name="Desk station",
        image_width=100,
        image_height=100,
        paper_size="a4",
        corners=_corners(),
    ))

    resp = client.get("/api/sessions/session-1/station-suggestions")

    assert resp.status_code == 200
    assert resp.json() == {"suggestions": [], "station_count": 1}


def test_upload_with_station_reuses_crop_and_corners(tmp_path, monkeypatch):
    client = _api_client(tmp_path, monkeypatch)
    station_store = routes.get_photo_station_store("default")
    station_store.set("station-1", PhotoStation(
        id="station-1",
        name="Cropped station",
        image_width=100,
        image_height=100,
        capture_crop={"x": 0.25, "y": 0, "width": 0.5, "height": 1},
        paper_size="a4",
        corners=_corners(),
    ))

    resp = client.post(
        "/api/upload",
        data={"station_id": "station-1"},
        files={"image": ("photo.png", _image_bytes(size=(200, 100)), "image/png")},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["corner_source"] == "station"
    assert data["station_id"] == "station-1"
    session_store, _, _ = routes.get_stores("default")
    session = session_store.get(data["session_id"])
    assert session.original_image_width == 100
    assert session.original_image_height == 100
    assert session.capture_crop.x == 0.25
    assert session.corners[2].x == 100
    assert station_store.get("station-1").last_used_at is not None
    assert station_store.get("station-1").updated_at is None


def test_upload_with_station_dimension_mismatch_does_not_orphan_upload(tmp_path, monkeypatch):
    client = _api_client(tmp_path, monkeypatch)
    station_store = routes.get_photo_station_store("default")
    station_store.set("station-1", PhotoStation(
        id="station-1",
        name="Desk station",
        image_width=100,
        image_height=100,
        paper_size="a4",
        corners=_corners(),
    ))

    resp = client.post(
        "/api/upload",
        data={"station_id": "station-1"},
        files={"image": ("photo.png", _image_bytes(size=(140, 100)), "image/png")},
    )

    session_store, _, _ = routes.get_stores("default")
    assert resp.status_code == 400
    assert session_store.all() == {}
    assert list((tmp_path / "default" / "uploads").iterdir()) == []


def test_upload_with_capture_crop_detects_on_cropped_image(tmp_path, monkeypatch):
    client = _api_client(tmp_path, monkeypatch)

    def detect(path):
        assert Image.open(path).size == (50, 80)
        return [(0, 0), (50, 0), (50, 80), (0, 80)]

    monkeypatch.setattr(routes.image_processor, "detect_paper_corners", detect)

    resp = client.post(
        "/api/upload",
        data={"capture_crop": json.dumps({"x": 0, "y": 0, "width": 0.5, "height": 1})},
        files={"image": ("photo.png", _image_bytes(size=(100, 80)), "image/png")},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["corner_source"] == "detected"
    session_store, _, _ = routes.get_stores("default")
    session = session_store.get(data["session_id"])
    assert session.original_image_width == 50
    assert session.original_image_height == 80
    assert session.capture_crop.width == 0.5


def test_upload_rejects_capture_crop_outside_image(tmp_path, monkeypatch):
    client = _api_client(tmp_path, monkeypatch)

    resp = client.post(
        "/api/upload",
        data={"capture_crop": json.dumps({"x": 0.75, "y": 0, "width": 0.5, "height": 1})},
        files={"image": ("photo.png", _image_bytes(size=(100, 80)), "image/png")},
    )

    assert resp.status_code == 400


def test_reuse_station_scales_near_dimension_match(tmp_path, monkeypatch):
    client = _api_client(tmp_path, monkeypatch)
    session_store, _, _ = routes.get_stores("default")
    station_store = routes.get_photo_station_store("default")
    session_store.set("session-1", Session(
        id="session-1",
        original_image_path="default/uploads/session-1.jpg",
        original_image_width=101,
        original_image_height=122,
        corners=_corners(101, 122),
    ))
    station_store.set("station-1", PhotoStation(
        id="station-1",
        name="Desk station",
        image_width=100,
        image_height=120,
        paper_size="a4",
        corners=_corners(100, 120),
    ))

    resp = client.post("/api/sessions/session-1/reuse-corners", json={"station_id": "station-1"})

    assert resp.status_code == 200
    data = resp.json()
    assert data["paper_size"] == "a4"
    assert data["corners"][1]["x"] == 101
    assert data["corners"][2]["y"] == 122
    assert data["suggestion"]["match_status"] == "near"
    assert data["suggestion"]["warnings"]
    assert session_store.get("session-1").paper_size == "a4"
    assert station_store.get("station-1").updated_at is None


def test_reuse_station_requires_original_upload(tmp_path, monkeypatch):
    client = _api_client(tmp_path, monkeypatch)
    session_store, _, _ = routes.get_stores("default")
    station_store = routes.get_photo_station_store("default")
    session_store.set("session-1", Session(
        id="session-1",
        original_image_width=100,
        original_image_height=100,
        corners=_corners(),
    ))
    station_store.set("station-1", PhotoStation(
        id="station-1",
        name="Desk station",
        image_width=100,
        image_height=100,
        paper_size="a4",
        corners=_corners(),
    ))

    resp = client.post("/api/sessions/session-1/reuse-corners", json={"station_id": "station-1"})

    assert resp.status_code == 404


def test_reuse_station_rejects_far_dimension_match(tmp_path, monkeypatch):
    client = _api_client(tmp_path, monkeypatch)
    session_store, _, _ = routes.get_stores("default")
    station_store = routes.get_photo_station_store("default")
    session_store.set("session-1", Session(
        id="session-1",
        original_image_path="default/uploads/session-1.jpg",
        original_image_width=140,
        original_image_height=100,
        corners=_corners(140),
    ))
    station_store.set("station-1", PhotoStation(
        id="station-1",
        name="Desk station",
        image_width=100,
        image_height=100,
        paper_size="a4",
        corners=_corners(),
    ))

    resp = client.post("/api/sessions/session-1/reuse-corners", json={"station_id": "station-1"})

    assert resp.status_code == 400


def test_redetect_corners_updates_session_from_original_upload(tmp_path, monkeypatch):
    client = _api_client(tmp_path, monkeypatch)
    original = tmp_path / "default" / "uploads" / "session-1.png"
    _write_image(original, size=(120, 160))
    session_store, _, _ = routes.get_stores("default")
    session_store.set("session-1", Session(
        id="session-1",
        original_image_path="default/uploads/session-1.png",
        original_image_width=120,
        original_image_height=160,
        corners=_corners(),
        paper_size="letter",
    ))
    monkeypatch.setattr(routes.image_processor, "detect_paper_corners", lambda *_: [(1, 2), (100, 3), (98, 120), (2, 118)])

    resp = client.post("/api/sessions/session-1/redetect-corners")

    assert resp.status_code == 200
    assert resp.json()["corners"][0] == {"x": 1.0, "y": 2.0}
    session = session_store.get("session-1")
    assert session.corners[2].x == 98
    assert session.paper_size == "letter"


def test_delete_session_cleans_session_owned_files(tmp_path, monkeypatch):
    client = _api_client(tmp_path, monkeypatch)
    paths = [
        tmp_path / "default" / "uploads" / "session-1.png",
        tmp_path / "default" / "processed" / "session-1_corrected.png",
        tmp_path / "default" / "processed" / "session-1_mask.png",
        tmp_path / "default" / "outputs" / "session-1.stl",
        tmp_path / "default" / "outputs" / "session-1.3mf",
    ]
    for path in paths:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"data")
    session_store, _, _ = routes.get_stores("default")
    session_store.set("session-1", Session(
        id="session-1",
        original_image_path="default/uploads/session-1.png",
        corrected_image_path="default/processed/session-1_corrected.png",
        mask_image_path="default/processed/session-1_mask.png",
        stl_path="default/outputs/session-1.stl",
    ))

    resp = client.delete("/api/sessions/session-1")

    assert resp.status_code == 200
    assert session_store.get("session-1") is None
    assert all(not path.exists() for path in paths)


def test_set_corners_without_station_does_not_copy_station_photo(tmp_path, monkeypatch):
    client = _api_client(tmp_path, monkeypatch)
    original = tmp_path / "default" / "uploads" / "session-1.png"
    corrected = tmp_path / "default" / "processed" / "session-1_corrected.png"
    _write_image(original)
    _write_image(corrected)
    session_store, _, _ = routes.get_stores("default")
    session_store.set("session-1", Session(
        id="session-1",
        original_image_path="default/uploads/session-1.png",
        original_image_width=120,
        original_image_height=160,
        corners=_corners(),
        paper_size="a4",
    ))
    monkeypatch.setattr(routes.image_processor, "apply_perspective_correction", lambda *_: (str(corrected), 1.0))

    resp = client.post("/api/sessions/session-1/corners", json={
        "corners": [p.model_dump() for p in _corners()],
        "paper_size": "a4",
    })

    assert resp.status_code == 200
    assert resp.json()["station"] is None
    assert not (tmp_path / "default" / "station-photos").exists()


def test_set_corners_with_station_saves_station_photo(tmp_path, monkeypatch):
    client = _api_client(tmp_path, monkeypatch)
    original = tmp_path / "default" / "uploads" / "session-1.png"
    corrected = tmp_path / "default" / "processed" / "session-1_corrected.png"
    _write_image(original)
    _write_image(corrected)
    session_store, _, _ = routes.get_stores("default")
    session_store.set("session-1", Session(
        id="session-1",
        original_image_path="default/uploads/session-1.png",
        original_image_width=120,
        original_image_height=160,
        corners=_corners(),
        paper_size="a4",
    ))
    monkeypatch.setattr(routes.image_processor, "apply_perspective_correction", lambda *_: (str(corrected), 1.0))

    resp = client.post("/api/sessions/session-1/corners", json={
        "corners": [p.model_dump() for p in _corners()],
        "paper_size": "a4",
        "save_station_name": "Desk station",
    })

    assert resp.status_code == 200
    station = resp.json()["station"]
    assert station["name"] == "Desk station"
    assert station["image_path"].startswith("default/station-photos/")
    assert (tmp_path / station["image_path"]).exists()
    assert not original.exists()


def test_set_corners_station_copy_failure_keeps_original_upload(tmp_path, monkeypatch):
    client = _api_client(tmp_path, monkeypatch)
    original = tmp_path / "default" / "uploads" / "session-1.png"
    corrected = tmp_path / "default" / "processed" / "session-1_corrected.png"
    _write_image(original)
    _write_image(corrected)
    session_store, _, _ = routes.get_stores("default")
    session_store.set("session-1", Session(
        id="session-1",
        original_image_path="default/uploads/session-1.png",
        original_image_width=120,
        original_image_height=160,
        corners=_corners(),
        paper_size="a4",
    ))
    monkeypatch.setattr(routes.image_processor, "apply_perspective_correction", lambda *_: (str(corrected), 1.0))

    def fail_copy(*_args, **_kwargs):
        raise OSError("copy failed")

    monkeypatch.setattr(routes.shutil, "copy2", fail_copy)

    with pytest.raises(OSError, match="copy failed"):
        client.post("/api/sessions/session-1/corners", json={
            "corners": [p.model_dump() for p in _corners()],
            "paper_size": "a4",
            "save_station_name": "Desk station",
        })

    assert original.exists()
