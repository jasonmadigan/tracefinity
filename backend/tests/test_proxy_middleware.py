"""auth middleware: enforced when secret is configured, skipped otherwise."""
import pytest
from starlette.testclient import TestClient


@pytest.fixture()
def _clear_proxy_env(monkeypatch):
    monkeypatch.delenv("PROXY_SECRET", raising=False)
    monkeypatch.delenv("DEVELOPMENT_MODE", raising=False)


@pytest.fixture()
def app(_clear_proxy_env):
    """import fresh app with no auth secret configured."""
    import importlib

    import app.main as main_mod

    importlib.reload(main_mod)
    return main_mod.app


@pytest.fixture()
def client(app):
    return TestClient(app)


@pytest.fixture()
def _restore_secretless_app():
    """secret tests bake PROXY_SECRET into reloaded module state; reload
    app.config/app.main without it afterwards so later tests see clean modules."""
    yield
    import importlib

    import app.config as config_mod
    import app.main as main_mod

    with pytest.MonkeyPatch.context() as mp:
        mp.delenv("PROXY_SECRET", raising=False)
        importlib.reload(config_mod)
        importlib.reload(main_mod)


def test_starts_without_proxy_secret(client):
    """starts without auth configured."""
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_requests_pass_through_without_proxy_secret(client):
    """no auth configured = requests pass through."""
    resp = client.get("/health", headers={"x-user-id": "user-1"})
    assert resp.status_code == 200


def test_rejects_bad_secret_when_configured(monkeypatch, _restore_secretless_app):
    """wrong secret rejected when auth is configured."""
    monkeypatch.setenv("PROXY_SECRET", "real-secret")

    import importlib

    import app.config as config_mod
    import app.main as main_mod

    importlib.reload(config_mod)
    importlib.reload(main_mod)

    client = TestClient(main_mod.app)
    resp = client.get(
        "/health",
        headers={"x-user-id": "u1", "x-proxy-secret": "wrong"},
    )
    assert resp.status_code == 403


def test_accepts_correct_secret_when_configured(monkeypatch, _restore_secretless_app):
    """correct secret accepted when auth is configured."""
    monkeypatch.setenv("PROXY_SECRET", "real-secret")

    import importlib

    import app.config as config_mod
    import app.main as main_mod

    importlib.reload(config_mod)
    importlib.reload(main_mod)

    client = TestClient(main_mod.app)
    resp = client.get(
        "/health",
        headers={"x-user-id": "u1", "x-proxy-secret": "real-secret"},
    )
    assert resp.status_code == 200
