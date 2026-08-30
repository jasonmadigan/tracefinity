"""version endpoint reports the running app version."""

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, settings
from app.main import app


@pytest.fixture()
def client():
    return TestClient(app)


def test_version_defaults_to_dev(monkeypatch):
    monkeypatch.delenv("APP_VERSION", raising=False)
    assert Settings(_env_file=None).app_version == "dev"


def test_version_endpoint_reflects_settings(client, monkeypatch):
    monkeypatch.setattr(settings, "app_version", "1.2.3")
    resp = client.get("/api/version")
    assert resp.status_code == 200
    assert resp.json() == {"version": "1.2.3"}


def test_app_version_read_from_env(monkeypatch):
    monkeypatch.setenv("APP_VERSION", "0.6.0")
    assert Settings(_env_file=None).app_version == "0.6.0"


def test_version_endpoint_404_when_disabled(client, monkeypatch):
    monkeypatch.setattr(settings, "show_app_version", False)
    resp = client.get("/api/version")
    assert resp.status_code == 404


def test_show_app_version_read_from_env(monkeypatch):
    monkeypatch.setenv("SHOW_APP_VERSION", "false")
    assert Settings(_env_file=None).show_app_version is False
    monkeypatch.setenv("SHOW_APP_VERSION", "0")
    assert Settings(_env_file=None).show_app_version is False
    monkeypatch.delenv("SHOW_APP_VERSION")
    assert Settings(_env_file=None).show_app_version is True


def test_empty_env_vars_fall_back_to_defaults(monkeypatch):
    """docker run -e SHOW_APP_VERSION= must not crash the app."""
    monkeypatch.setenv("SHOW_APP_VERSION", "")
    monkeypatch.setenv("APP_VERSION", "")
    s = Settings(_env_file=None)
    assert s.show_app_version is True
    assert s.app_version == "dev"


def test_openapi_version_hidden_when_disabled(monkeypatch):
    """reload app with the toggle off; openapi must not carry the version.

    the schema is no longer served (see test_api_docs_disabled), so assert on
    the generator behind it: the version must stay out of anything generated
    from the app, whether or not a route ever exposes it again.
    """
    import importlib

    import app.config as config_mod
    import app.main as main_mod

    monkeypatch.setenv("SHOW_APP_VERSION", "false")
    monkeypatch.setenv("APP_VERSION", "9.9.9")
    try:
        importlib.reload(config_mod)
        importlib.reload(main_mod)
        assert main_mod.app.openapi()["info"]["version"] == "hidden"
    finally:
        monkeypatch.delenv("SHOW_APP_VERSION")
        monkeypatch.delenv("APP_VERSION")
        importlib.reload(config_mod)
        importlib.reload(main_mod)
