"""instance-wide storage stats must not leak the account roster.

the endpoint reports every user id on the instance, so it needs a real guard
in every mode, not only where PROXY_SECRET happens to be set.
"""
from starlette.testclient import TestClient

from tests.conftest import set_auth_mode
from tests.test_auth_native import create_user, login, setup_admin

STATS = "/api/admin/storage-stats"


def test_native_rejects_unauthenticated_request(native_client):
    setup_admin(native_client)
    anonymous = TestClient(native_client.app)
    resp = anonymous.get(STATS)
    assert resp.status_code == 401
    assert "users" not in resp.text


def test_native_rejects_non_admin_account(native_client):
    setup_admin(native_client)
    create_user(native_client, email="member@example.com", password="member password")

    member = TestClient(native_client.app)
    assert login(member, "member@example.com", "member password").status_code == 200
    resp = member.get(STATS)
    assert resp.status_code == 403
    assert "users" not in resp.text


def test_native_allows_admin(native_client):
    setup_admin(native_client)
    resp = native_client.get(STATS)
    assert resp.status_code == 200
    assert [u["userId"] for u in resp.json()["users"]] == ["default"]


def test_native_ignores_a_forged_proxy_secret_header(native_client, monkeypatch):
    """no PROXY_SECRET is set in native mode, so the header must not be a way in"""
    setup_admin(native_client)
    anonymous = TestClient(native_client.app)
    assert anonymous.get(STATS, headers={"x-proxy-secret": ""}).status_code == 401
    assert anonymous.get(STATS, headers={"x-proxy-secret": "anything"}).status_code == 401


def test_proxy_mode_requires_the_secret(auth_mode_settings, monkeypatch):
    import app.main as main_mod

    set_auth_mode(monkeypatch, "proxy", proxy_secret="topsecret")
    client = TestClient(main_mod.app)

    assert client.get(STATS).status_code == 403
    assert client.get(STATS, headers={"x-proxy-secret": "wrong"}).status_code == 403
    assert client.get(STATS, headers={"x-proxy-secret": "topsecret"}).status_code == 200


def test_open_mode_without_a_secret_stays_open(auth_mode_settings, monkeypatch):
    """open is the documented trusted-network opt-out; nothing changes there"""
    import app.main as main_mod

    set_auth_mode(monkeypatch, "open")
    client = TestClient(main_mod.app)
    assert client.get(STATS).status_code == 200


def test_open_mode_with_a_secret_still_enforces_it(auth_mode_settings, monkeypatch):
    import app.main as main_mod

    set_auth_mode(monkeypatch, "open", proxy_secret="topsecret")
    client = TestClient(main_mod.app)
    assert client.get(STATS).status_code == 403
    assert client.get(STATS, headers={"x-proxy-secret": "topsecret"}).status_code == 200
