"""api-keys resolves identity per mode like the rest of the API.

it reports tracer configuration, whether cloud keys are set, and whether
photo stations are on. In native mode that is instance configuration handed
to anyone who asks.
"""
from starlette.testclient import TestClient

import app.main as main_mod
from tests.conftest import set_auth_mode
from tests.test_auth_native import ADMIN, setup_admin

VALID_USER = "cjld2cjxh0000qzrmn831i7rn"


def test_native_requires_a_login(native_client):
    setup_admin(native_client)

    anonymous = TestClient(native_client.app)
    assert anonymous.get("/api/api-keys").status_code == 401

    resp = native_client.get("/api/api-keys")
    assert resp.status_code == 200
    assert "tracers" in resp.json()


def test_native_refuses_before_setup(native_client):
    """nothing to be learned from an instance nobody has claimed yet"""
    assert native_client.get("/api/api-keys").status_code == 401


def test_open_mode_stays_unauthenticated(auth_mode_settings, monkeypatch):
    set_auth_mode(monkeypatch, "open")
    client = TestClient(main_mod.app)
    assert client.get("/api/api-keys").status_code == 200


def test_proxy_mode_uses_the_proxy_identity(auth_mode_settings, monkeypatch):
    set_auth_mode(monkeypatch, "proxy", proxy_secret="proxy-secret")
    client = TestClient(main_mod.app)
    headers = {"x-user-id": VALID_USER, "x-proxy-secret": "proxy-secret"}
    assert client.get("/api/api-keys", headers=headers).status_code == 200
    assert client.get("/api/api-keys").status_code == 401
