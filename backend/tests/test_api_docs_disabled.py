"""fastapi's generated schema and its viewers are not served in any auth mode."""
import pytest
from starlette.testclient import TestClient

from tests.conftest import set_auth_mode

# /docs/oauth2-redirect is registered by fastapi only alongside /docs, but it
# is asserted explicitly so a future coupling change cannot restore it unseen
DOC_PATHS = ("/openapi.json", "/docs", "/docs/oauth2-redirect", "/redoc")


@pytest.fixture()
def client_for_mode(auth_mode_settings, monkeypatch):
    """build a client in the requested auth mode against isolated storage"""
    import app.main as main_mod
    from app.config import ensure_user_dirs

    def build(mode):
        set_auth_mode(
            monkeypatch, mode, proxy_secret="proxy-secret" if mode == "proxy" else None
        )
        ensure_user_dirs(auth_mode_settings / "default")
        return TestClient(main_mod.app)

    return build


@pytest.mark.parametrize("mode", ["native", "proxy", "open"])
@pytest.mark.parametrize("path", DOC_PATHS)
def test_api_docs_are_not_served(client_for_mode, mode, path):
    """the schema describes every route, admin included; it is off everywhere"""
    assert client_for_mode(mode).get(path).status_code == 404


def test_no_doc_routes_are_registered():
    """404 must come from the route being absent, not from a handler saying no"""
    import app.main as main_mod

    paths = {getattr(r, "path", None) for r in main_mod.app.routes}
    assert paths.isdisjoint(DOC_PATHS)
