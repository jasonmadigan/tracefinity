"""AUTH_MODE matrix: resolution precedence, startup validation, per-mode behaviour."""
import pytest
from pydantic import ValidationError
from starlette.testclient import TestClient

from tests.conftest import set_auth_mode

VALID_USER = "cjld2cjxh0000qzrmn831i7rn"


def make_settings(**overrides):
    from app.config import Settings

    # ignore the developer's real environment and .env for these
    return Settings(_env_file=None, **overrides)


def test_default_mode_is_native(monkeypatch):
    monkeypatch.delenv("AUTH_MODE", raising=False)
    monkeypatch.delenv("PROXY_SECRET", raising=False)
    assert make_settings().resolved_auth_mode == "native"


def test_unset_mode_with_proxy_secret_selects_proxy(monkeypatch):
    monkeypatch.delenv("AUTH_MODE", raising=False)
    monkeypatch.delenv("PROXY_SECRET", raising=False)
    assert make_settings(proxy_secret="s").resolved_auth_mode == "proxy"


def test_explicit_mode_wins_over_proxy_secret(monkeypatch):
    monkeypatch.delenv("AUTH_MODE", raising=False)
    monkeypatch.delenv("PROXY_SECRET", raising=False)
    assert make_settings(auth_mode="open", proxy_secret="s").resolved_auth_mode == "open"
    assert make_settings(auth_mode="native", proxy_secret="s").resolved_auth_mode == "native"


def test_proxy_mode_without_secret_is_a_startup_error(monkeypatch):
    monkeypatch.delenv("PROXY_SECRET", raising=False)
    with pytest.raises(ValidationError):
        make_settings(auth_mode="proxy")


def test_short_env_auth_secret_is_a_startup_error(monkeypatch):
    """an env AUTH_SECRET is the key material for every stored 2FA secret"""
    monkeypatch.delenv("AUTH_SECRET", raising=False)
    with pytest.raises(ValidationError):
        make_settings(auth_secret="x")
    with pytest.raises(ValidationError):
        make_settings(auth_secret="a" * 31)
    assert make_settings(auth_secret="a" * 32).auth_secret == "a" * 32


def test_generated_length_auth_secret_is_accepted(monkeypatch):
    """the auto-generated secret an operator may copy into env must pass"""
    import secrets

    monkeypatch.delenv("AUTH_SECRET", raising=False)
    generated = secrets.token_urlsafe(32)
    assert make_settings(auth_secret=generated).auth_secret == generated


def test_rotation_from_a_weak_previous_secret_stays_possible(monkeypatch):
    monkeypatch.delenv("AUTH_SECRET", raising=False)
    monkeypatch.delenv("AUTH_SECRET_PREVIOUS", raising=False)
    settings = make_settings(auth_secret="a" * 40, auth_secret_previous="weak")
    assert settings.auth_secret_previous == "weak"


def test_wildcard_cors_origin_is_a_startup_error_under_native(monkeypatch):
    """allow_credentials reflects the wildcard back, so any site could call
    the api as the logged-in user"""
    monkeypatch.delenv("AUTH_MODE", raising=False)
    monkeypatch.delenv("PROXY_SECRET", raising=False)
    with pytest.raises(ValidationError):
        make_settings(cors_origins=["*"])
    with pytest.raises(ValidationError):
        make_settings(cors_origins=["http://localhost:3000", "*"])
    with pytest.raises(ValidationError):
        make_settings(auth_mode="native", proxy_secret="s", cors_origins=["*"])


def test_wildcard_cors_origin_is_left_alone_outside_native(monkeypatch):
    monkeypatch.delenv("AUTH_MODE", raising=False)
    monkeypatch.delenv("PROXY_SECRET", raising=False)
    assert make_settings(auth_mode="open", cors_origins=["*"]).cors_origins == ["*"]
    assert make_settings(auth_mode="proxy", proxy_secret="s", cors_origins=["*"]).cors_origins == [
        "*"
    ]


def test_unknown_mode_is_a_startup_error():
    with pytest.raises(ValidationError):
        make_settings(auth_mode="cloud")


def test_proxy_mode_startup_error_through_env_reload(monkeypatch):
    """the import path production startup takes: bad env kills the process"""
    import importlib

    import app.config as config_mod

    original = config_mod.settings
    monkeypatch.setenv("AUTH_MODE", "proxy")
    monkeypatch.delenv("PROXY_SECRET", raising=False)
    try:
        with pytest.raises(ValidationError):
            importlib.reload(config_mod)
    finally:
        # rebuild the module cleanly, then hand back the collection-time
        # singleton every other module still holds
        monkeypatch.setenv("AUTH_MODE", "open")
        importlib.reload(config_mod)
        config_mod.settings = original


@pytest.fixture()
def proxy_client(auth_mode_settings, monkeypatch):
    import app.main as main_mod

    set_auth_mode(monkeypatch, "proxy", proxy_secret="proxy-secret")
    return TestClient(main_mod.app)


@pytest.fixture()
def open_client(auth_mode_settings, monkeypatch):
    import app.main as main_mod
    from app.config import ensure_user_dirs

    set_auth_mode(monkeypatch, "open")
    ensure_user_dirs(auth_mode_settings / "default")
    return TestClient(main_mod.app)


def test_proxy_mode_fails_closed_without_identity(proxy_client):
    assert proxy_client.get("/api/bins").status_code == 401
    assert proxy_client.get("/storage/default/uploads/x.png").status_code == 401


def test_proxy_mode_accepts_valid_header_and_secret(proxy_client):
    headers = {"x-user-id": VALID_USER, "x-proxy-secret": "proxy-secret"}
    assert proxy_client.get("/api/bins", headers=headers).status_code == 200
    assert proxy_client.get(
        f"/storage/{VALID_USER}/uploads/missing.png", headers=headers
    ).status_code == 404


def test_proxy_mode_rejects_wrong_secret(proxy_client):
    headers = {"x-user-id": VALID_USER, "x-proxy-secret": "wrong"}
    assert proxy_client.get("/api/bins", headers=headers).status_code == 403


def test_proxy_mode_rejects_cross_user_storage(proxy_client):
    headers = {"x-user-id": VALID_USER, "x-proxy-secret": "proxy-secret"}
    assert proxy_client.get(
        "/storage/otheruser0000000000000000/x.png", headers=headers
    ).status_code == 403


def test_proxy_mode_has_no_native_endpoints(proxy_client):
    assert proxy_client.post(
        "/api/auth/setup", json={"email": "a@example.com", "password": "long password"}
    ).status_code == 404
    assert proxy_client.post(
        "/api/auth/login", json={"email": "a@example.com", "password": "long password"}
    ).status_code == 404
    assert proxy_client.get("/api/admin/users").status_code == 404


def test_proxy_mode_status(proxy_client):
    assert proxy_client.get("/api/auth/status").json() == {
        "mode": "proxy",
        "setup_required": False,
        "authenticated": False,
    }


def test_open_mode_keeps_default_fallback(open_client):
    assert open_client.get("/api/bins").status_code == 200
    assert open_client.get("/api/auth/status").json() == {
        "mode": "open",
        "setup_required": False,
        "authenticated": False,
    }


def test_open_mode_still_rejects_forged_namespace_headers(open_client):
    headers = {"x-user-id": VALID_USER}
    assert open_client.get("/api/bins", headers=headers).status_code == 403


def test_open_mode_invalid_user_id_format_rejected(auth_mode_settings, monkeypatch):
    import app.main as main_mod

    set_auth_mode(monkeypatch, "open", proxy_secret="proxy-secret")
    client = TestClient(main_mod.app)
    headers = {"x-user-id": "../escape", "x-proxy-secret": "proxy-secret"}
    assert client.get("/api/bins", headers=headers).status_code == 400


def test_native_mode_auth_secret_generated_at_startup(auth_mode_settings, monkeypatch):
    import app.main as main_mod

    set_auth_mode(monkeypatch, "native")
    with TestClient(main_mod.app):
        pass
    assert (auth_mode_settings / "auth_secret").exists()
