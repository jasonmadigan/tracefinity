from __future__ import annotations

import math
import os

import pytest

os.environ.setdefault("DEVELOPMENT_MODE", "1")
# legacy suite exercises the pre-auth single-user behaviour; native-mode
# tests reload app modules under their own env
os.environ.setdefault("AUTH_MODE", "open")

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


def _auth_settings_objects():
    """every settings object live modules may hold; reload-based tests can
    leave module aliases pointing at different Settings instances"""
    import app.api.admin_routes as admin_routes_mod
    import app.api.auth_common as auth_common_mod
    import app.api.auth_routes as auth_routes_mod
    import app.api.routes as routes_mod
    import app.api.user_routes as user_routes_mod
    import app.auth as auth_mod
    import app.cli as cli_mod
    import app.config as config_mod
    import app.main as main_mod
    import app.services.account_store as account_store_mod
    import app.services.auth_token_store as token_store_mod
    import app.services.secret_box as secret_box_mod

    objects = {}
    for mod in (
        config_mod, auth_mod, main_mod, routes_mod, user_routes_mod,
        auth_common_mod, auth_routes_mod, admin_routes_mod,
        account_store_mod, token_store_mod, secret_box_mod, cli_mod,
    ):
        objects[id(mod.settings)] = mod.settings
    return list(objects.values())


def _reset_auth_runtime_state():
    import app.api.routes as routes_mod
    from app.services.account_store import reset_account_store
    from app.services.auth_token_store import reset_auth_token_store
    from app.services.login_rate_limit import login_limiter
    from app.services.pending_login import pending_logins

    reset_account_store()
    reset_auth_token_store()
    login_limiter._failures.clear()
    pending_logins._pending.clear()
    routes_mod._store_cache.clear()
    routes_mod._project_store_cache.clear()
    routes_mod._photo_station_store_cache.clear()


@pytest.fixture()
def auth_mode_settings(tmp_path, monkeypatch):
    """patch every live settings alias into an isolated auth sandbox; tests
    then set auth_mode/proxy_secret per scenario"""
    for s in _auth_settings_objects():
        monkeypatch.setattr(s, "storage_path", tmp_path)
        monkeypatch.setattr(s, "auth_mode", None)
        monkeypatch.setattr(s, "proxy_secret", None)
        monkeypatch.setattr(s, "auth_secret", None)
        monkeypatch.setattr(s, "auth_secret_previous", None)
        monkeypatch.setattr(s, "auth_cookie_secure", False)
        monkeypatch.setattr(s, "auth_cookie_domain", None)
        monkeypatch.setattr(s, "auth_setup_enabled", True)
        monkeypatch.setattr(s, "auth_allow_account_data_without_login", False)
    _reset_auth_runtime_state()
    yield tmp_path
    _reset_auth_runtime_state()


def set_auth_mode(monkeypatch, mode, proxy_secret=None):
    for s in _auth_settings_objects():
        monkeypatch.setattr(s, "auth_mode", mode)
        monkeypatch.setattr(s, "proxy_secret", proxy_secret)


def set_auth_setting(monkeypatch, name, value):
    """patch one auth setting across every live settings alias"""
    for s in _auth_settings_objects():
        monkeypatch.setattr(s, name, value)


@pytest.fixture()
def native_client(auth_mode_settings, monkeypatch):
    """test client against the app in native auth mode with isolated storage"""
    from starlette.testclient import TestClient

    import app.main as main_mod
    from app.config import ensure_user_dirs

    set_auth_mode(monkeypatch, "native")
    ensure_user_dirs(auth_mode_settings / "default")
    return TestClient(main_mod.app)
