"""the id format contract, on every path that becomes a storage directory.

python's ``$`` matches before a trailing newline, so an anchored-with-``$``
expression accepts ``"<valid id>\n"``. a newline in a namespace is not
cross-user exposure, but the namespace becomes a directory name under the
storage root, and a newline there breaks shell globbing, log parsing, backup
scripts, and anything that reads a list of namespaces a line at a time.
"""
import io
import sys

import pytest
from starlette.testclient import TestClient

from app import cli
from app.auth import valid_user_id
from app.services.account_store import get_account_store
from tests.conftest import set_auth_mode
from tests.test_auth_native import setup_admin

CUID = "cjld2cjxh0000qzrmn831i7rn"
UUID = "deadbeef-dead-4bee-8bee-deadbeefdead"
EMAIL = "admin@example.com"
PASSWORD = "correct horse battery"

# every way whitespace can ride along on an otherwise well-formed id
BAD = [
    pytest.param(CUID + "\n", id="cuid-trailing-lf"),
    pytest.param(UUID + "\n", id="uuid-trailing-lf"),
    pytest.param("\n" + CUID, id="cuid-leading-lf"),
    pytest.param("\n" + UUID, id="uuid-leading-lf"),
    pytest.param(CUID[:12] + "\n" + CUID[13:], id="cuid-embedded-lf"),
    pytest.param(UUID[:12] + "\n" + UUID[13:], id="uuid-embedded-lf"),
    pytest.param(CUID + "\r\n", id="cuid-trailing-crlf"),
    pytest.param(CUID + "\r", id="cuid-trailing-cr"),
    pytest.param(CUID + "\t", id="cuid-trailing-tab"),
    pytest.param(CUID + " ", id="cuid-trailing-space"),
    pytest.param(UUID + " ", id="uuid-trailing-space"),
]


def namespaces_on_disk(root):
    return sorted(p.name for p in root.iterdir() if p.is_dir())


@pytest.mark.parametrize("raw", BAD)
def test_validator_rejects_whitespace_around_an_id(raw):
    assert valid_user_id(raw) is False


def test_validator_still_accepts_both_clean_shapes():
    assert valid_user_id(CUID) is True
    assert valid_user_id(UUID) is True


@pytest.mark.parametrize("raw", BAD)
def test_admin_create_rejects_a_whitespace_id(native_client, auth_mode_settings, raw):
    setup_admin(native_client)
    before = namespaces_on_disk(auth_mode_settings)
    count = get_account_store().count()

    resp = native_client.post(
        "/api/admin/users",
        json={"email": "imported@example.com", "password": PASSWORD, "id": raw},
    )

    assert resp.status_code == 422, resp.text
    assert get_account_store().count() == count
    assert namespaces_on_disk(auth_mode_settings) == before


@pytest.mark.parametrize("raw", BAD)
def test_cli_id_flag_rejects_whitespace(auth_mode_settings, monkeypatch, capsys, raw):
    set_auth_mode(monkeypatch, "native")
    monkeypatch.setattr(sys, "stdin", io.StringIO(f"{PASSWORD}\n"))

    code = cli.main(["create-admin", "--email", EMAIL, "--id", raw])

    assert code == 2
    assert "id" in capsys.readouterr().err
    assert get_account_store().count() == 0


@pytest.mark.parametrize("raw", BAD)
def test_cli_storage_namespace_flag_rejects_whitespace(
    auth_mode_settings, monkeypatch, capsys, raw
):
    set_auth_mode(monkeypatch, "native")
    monkeypatch.setattr(sys, "stdin", io.StringIO(f"{PASSWORD}\n"))
    before = namespaces_on_disk(auth_mode_settings)

    code = cli.main(["create-admin", "--email", EMAIL, "--storage-namespace", raw])

    assert code == 2
    assert "namespace" in capsys.readouterr().err
    assert get_account_store().count() == 0
    assert namespaces_on_disk(auth_mode_settings) == before


@pytest.mark.parametrize("raw", BAD)
def test_proxy_header_rejects_a_whitespace_id(auth_mode_settings, monkeypatch, raw):
    """a wire-level parser would refuse a bare newline in a header value, so
    this is the validator standing behind whatever the proxy hands over"""
    import app.main as main_mod

    set_auth_mode(monkeypatch, "proxy", proxy_secret="proxy-secret")
    client = TestClient(main_mod.app)

    resp = client.get(
        "/api/bins", headers={"x-user-id": raw, "x-proxy-secret": "proxy-secret"}
    )

    assert resp.status_code == 400
    assert namespaces_on_disk(auth_mode_settings) == []


def test_email_expression_rejects_a_trailing_newline():
    """normalise_email strips before matching, so this locks the expression's
    own contract rather than the caller's"""
    from app.api.auth_common import _EMAIL_RE

    assert _EMAIL_RE.match("admin@example.com\n") is None
    assert _EMAIL_RE.match("admin@example.com") is not None
