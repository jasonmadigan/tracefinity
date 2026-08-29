"""retention sweep for generated export artefacts (issue #176)."""

from __future__ import annotations

import asyncio
import contextlib
import os
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

import app.api.routes as routes
import app.services.output_retention as output_retention
from app.config import Settings, ensure_user_dirs, settings
from app.main import app
from app.models.schemas import BinModel, GenerateRequest, Session
from app.services.output_retention import sweep_expired_outputs

HOUR = 3600.0

FAMILY = [
    "e1.stl",
    "e1.hash",
    "e1.3mf",
    "e1_parts.zip",
    "e1_insert.stl",
    "e1_part1.stl",
    "e1_part2.stl",
]


class _OpenStore:
    def ensure_open(self):
        pass


def _write_aged(directory: Path, name: str, age_hours: float, now: float, content: bytes = b"x") -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / name
    path.write_bytes(content)
    stamp = now - age_hours * HOUR
    os.utime(path, (stamp, stamp))
    return path


# --- settings ---


def test_stl_retention_defaults_to_24_hours(monkeypatch):
    monkeypatch.delenv("STL_RETENTION_HOURS", raising=False)
    assert Settings(_env_file=None).stl_retention_hours == 24


def test_stl_retention_zero_disables(monkeypatch):
    monkeypatch.setenv("STL_RETENTION_HOURS", "0")
    assert Settings(_env_file=None).stl_retention_hours == 0


def test_stl_retention_rejects_negative_values(monkeypatch):
    monkeypatch.setenv("STL_RETENTION_HOURS", "-1")
    with pytest.raises(ValidationError):
        Settings(_env_file=None)


# --- sweep ---


def test_sweep_removes_expired_artefacts_for_every_user(tmp_path):
    now = time.time()
    expired = [
        _write_aged(tmp_path / "default" / "outputs", name, 25, now) for name in FAMILY
    ] + [_write_aged(tmp_path / "user-2" / "outputs", "b2.stl", 30, now)]

    removed = sweep_expired_outputs(tmp_path, 24, now=now)

    assert removed == len(expired)
    assert all(not p.exists() for p in expired)


def test_sweep_keeps_artefacts_younger_than_retention(tmp_path):
    now = time.time()
    fresh = [
        _write_aged(tmp_path / "default" / "outputs", name, 23, now) for name in FAMILY
    ]

    removed = sweep_expired_outputs(tmp_path, 24, now=now)

    assert removed == 0
    assert all(p.exists() for p in fresh)


def test_sweep_zero_retention_keeps_everything(tmp_path):
    now = time.time()
    old = _write_aged(tmp_path / "default" / "outputs", "e1.stl", 24 * 365, now)

    removed = sweep_expired_outputs(tmp_path, 0, now=now)

    assert removed == 0
    assert old.exists()


def test_sweep_only_touches_export_artefacts_in_outputs(tmp_path):
    now = time.time()
    user = tmp_path / "default"
    untouchable = [
        # export-like suffixes outside outputs/ stay
        _write_aged(user / "uploads", "photo.stl", 48, now),
        # decoy directly at the storage root stays
        _write_aged(tmp_path, "stray.stl", 48, now),
        _write_aged(user / "processed", "corrected.zip", 48, now),
        # non-artefact files inside outputs/ stay
        _write_aged(user / "outputs", "notes.txt", 48, now),
        _write_aged(user / "outputs", "sessions.json", 48, now),
        # no recursion below outputs/
        _write_aged(user / "outputs" / "nested", "old.stl", 48, now),
        # user photos, tools, bins, session stores stay
        _write_aged(user / "uploads", "original.jpg", 48, now),
        _write_aged(user / "tools", "tools.json", 48, now),
        _write_aged(user / "bins", "bins.json", 48, now),
    ]
    dir_named_like_artefact = user / "outputs" / "weird.stl.d"
    dir_named_like_artefact.mkdir(parents=True)
    expired = _write_aged(user / "outputs", "old.stl", 48, now)

    removed = sweep_expired_outputs(tmp_path, 24, now=now)

    assert removed == 1
    assert not expired.exists()
    assert all(p.exists() for p in untouchable)
    assert dir_named_like_artefact.exists()


def test_sweep_tolerates_files_vanishing_mid_sweep(tmp_path, monkeypatch):
    now = time.time()
    vanishing = _write_aged(tmp_path / "default" / "outputs", "gone.stl", 48, now)
    survivor_target = _write_aged(tmp_path / "default" / "outputs", "old.stl", 48, now)

    real_unlink = Path.unlink

    def flaky_unlink(self, *args, **kwargs):
        if self.name == "gone.stl":
            real_unlink(self)
            raise FileNotFoundError(str(self))
        return real_unlink(self, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", flaky_unlink)

    removed = sweep_expired_outputs(tmp_path, 24, now=now)

    assert removed == 1
    assert not vanishing.exists()
    assert not survivor_target.exists()


def test_retention_loop_survives_sweep_exceptions(monkeypatch, caplog):
    calls = []

    def flaky_sweep(storage_path, retention_hours):
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("sweep blew up")
        return 0

    monkeypatch.setattr(output_retention, "sweep_expired_outputs", flaky_sweep)
    monkeypatch.setattr(output_retention, "SWEEP_INTERVAL_SECONDS", 0)

    async def run_until_second_sweep():
        task = asyncio.create_task(output_retention.retention_loop(Path("/nowhere"), 1))
        try:
            for _ in range(500):
                if len(calls) >= 2:
                    break
                await asyncio.sleep(0.005)
        finally:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    asyncio.run(run_until_second_sweep())

    assert len(calls) >= 2, "loop stopped after a failing sweep"
    assert any("retention sweep failed" in r.message for r in caplog.records)


# --- cache hits refresh mtimes so live pages keep their files ---


def test_cached_generate_refreshes_artefact_mtimes(tmp_path, monkeypatch):
    monkeypatch.setattr(routes, "_stl_generation_semaphore", None)
    now = time.time()
    paths = [
        _write_aged(tmp_path / "outputs", name, 25, now, content=b"h1" if name.endswith(".hash") else b"x")
        for name in FAMILY
    ]

    response = routes._run_generate(
        [], GenerateRequest(), "e1", tmp_path, "h1", "default", _OpenStore()
    )

    assert response.stl_url == "/storage/default/outputs/e1.stl"
    for p in paths:
        assert p.stat().st_mtime >= now - 60, f"{p.name} mtime not refreshed"


# --- purged files fail clearly, not with a 500 ---


def _client(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "storage_path", tmp_path)
    monkeypatch.setattr(routes.settings, "storage_path", tmp_path)
    routes._store_cache.clear()
    ensure_user_dirs(tmp_path / "default")
    return TestClient(app)


def test_session_stl_download_404s_when_file_purged(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    user_sessions, _, _ = routes.get_stores("default")
    user_sessions.set("s1", Session(id="s1", stl_path="default/outputs/s1.stl"))

    resp = client.get("/api/files/s1/bin.stl")

    assert resp.status_code == 404
    assert "regenerate" in resp.json()["detail"]


def test_bin_stl_download_404s_when_file_purged(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    _, _, user_bins = routes.get_stores("default")
    user_bins.set("b1", BinModel(id="b1", stl_path="default/outputs/b1.stl"))

    resp = client.get("/api/files/bins/b1/bin.stl")

    assert resp.status_code == 404
    assert "regenerate" in resp.json()["detail"]


def test_session_export_404s_distinguish_expiry_from_never_generated(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    user_sessions, _, _ = routes.get_stores("default")
    user_sessions.set("s1", Session(id="s1", stl_path="default/outputs/s1.stl"))

    for path in ("/api/files/s1/bin.3mf", "/api/files/s1/bin_parts.zip"):
        resp = client.get(path)
        assert resp.status_code == 404
        assert "regenerate" in resp.json()["detail"], path

    for path in ("/api/files/unknown/bin.3mf", "/api/files/unknown/bin_parts.zip"):
        resp = client.get(path)
        assert resp.status_code == 404
        assert "regenerate" not in resp.json()["detail"], path


def test_bin_export_404s_distinguish_expiry_from_never_generated(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    _, _, user_bins = routes.get_stores("default")
    user_bins.set("b1", BinModel(id="b1", stl_path="default/outputs/b1.stl"))

    expired = (
        "/api/files/bins/b1/bin.3mf",
        "/api/files/bins/b1/bin_parts.zip",
        "/api/files/bins/b1/bin_insert.stl",
    )
    for path in expired:
        resp = client.get(path)
        assert resp.status_code == 404
        assert "regenerate" in resp.json()["detail"], path

    never_generated = (
        "/api/files/bins/unknown/bin.3mf",
        "/api/files/bins/unknown/bin_parts.zip",
        "/api/files/bins/unknown/bin_insert.stl",
    )
    for path in never_generated:
        resp = client.get(path)
        assert resp.status_code == 404
        assert "regenerate" not in resp.json()["detail"], path
