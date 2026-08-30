"""startup checks against what the storage volume already holds.

steady state is not the problem: these cover the transitions. an instance
whose accounts and configured auth mode disagree, and one whose account store
has gone missing while its namespaces still hold data.
"""
import logging

import pytest
from starlette.testclient import TestClient

import app.config as config_mod
from app.models.accounts import Account
from app.services.account_store import get_account_store
from tests.conftest import set_auth_mode, set_auth_setting

# resolved through the module on every use: reload-based tests elsewhere
# rebind app.config, and a name bound at import time goes stale

ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
MEMBER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"


def seed_account(account_id=ADMIN_ID, *, namespace=None, is_admin=True):
    get_account_store().create(
        Account(
            id=account_id,
            email=f"{account_id}@example.com",
            password_hash="$scrypt$fake",
            is_admin=is_admin,
            created_at="2024-01-01T00:00:00+00:00",
            storage_namespace=namespace or account_id,
        )
    )


def put_file(root, namespace, name="tools.json"):
    target = root / namespace
    target.mkdir(parents=True, exist_ok=True)
    (target / name).write_text("{}")


# --- findings 2 and 6: a mode that would expose account-owned data ---


@pytest.mark.parametrize("mode,secret", [("open", None), ("proxy", "proxy-secret")])
def test_refuses_open_or_proxy_when_accounts_exist(mode, secret, auth_mode_settings, monkeypatch):
    """open publishes the first admin's `default` namespace anonymously;
    proxy strands it and makes the rest header-selectable"""
    set_auth_mode(monkeypatch, "native")
    seed_account(namespace="default")

    set_auth_mode(monkeypatch, mode, proxy_secret=secret)
    with pytest.raises(config_mod.UnsafeAuthModeError) as excinfo:
        config_mod.validate_auth_startup_state()
    assert mode in str(excinfo.value)
    assert "AUTH_ALLOW_ACCOUNT_DATA_WITHOUT_LOGIN" in str(excinfo.value)


@pytest.mark.parametrize("mode,secret", [("open", None), ("proxy", "proxy-secret")])
def test_open_or_proxy_starts_with_no_accounts(mode, secret, auth_mode_settings, monkeypatch):
    set_auth_mode(monkeypatch, mode, proxy_secret=secret)
    config_mod.validate_auth_startup_state()


def test_override_permits_the_transition_and_warns(auth_mode_settings, monkeypatch, caplog):
    set_auth_mode(monkeypatch, "native")
    seed_account(namespace="default")

    set_auth_mode(monkeypatch, "open")
    set_auth_setting(monkeypatch, "auth_allow_account_data_without_login", True)
    with caplog.at_level(logging.WARNING):
        config_mod.validate_auth_startup_state()
    assert "AUTH_ALLOW_ACCOUNT_DATA_WITHOUT_LOGIN" in caplog.text


def test_native_starts_with_accounts(auth_mode_settings, monkeypatch):
    set_auth_mode(monkeypatch, "native")
    seed_account(namespace="default")
    config_mod.validate_auth_startup_state()


def test_startup_event_refuses_the_unsafe_transition(auth_mode_settings, monkeypatch):
    """the check is wired to startup, not merely importable"""
    import app.main as main_mod

    set_auth_mode(monkeypatch, "native")
    seed_account(namespace="default")

    set_auth_mode(monkeypatch, "open")
    with pytest.raises(config_mod.UnsafeAuthModeError):
        with TestClient(main_mod.app):
            pass


# --- finding 1: a missing users.json under populated storage ---


def test_warns_when_setup_is_open_on_populated_storage(auth_mode_settings, monkeypatch, caplog):
    set_auth_mode(monkeypatch, "native")
    put_file(auth_mode_settings, "default")

    with caplog.at_level(logging.WARNING):
        config_mod.validate_auth_startup_state()
    assert "already holds stored data" in caplog.text


def test_warns_for_a_non_default_namespace(auth_mode_settings, monkeypatch, caplog):
    """an upgrading proxy install keeps its data under caller-supplied ids"""
    set_auth_mode(monkeypatch, "native")
    put_file(auth_mode_settings, "cjld2cjxh0000qzrmn831i7rn")

    with caplog.at_level(logging.WARNING):
        config_mod.validate_auth_startup_state()
    assert "already holds stored data" in caplog.text


def test_no_warning_on_a_genuinely_empty_instance(auth_mode_settings, monkeypatch, caplog):
    """the scaffolding config.py creates is empty directories, not content"""
    from app.config import ensure_user_dirs

    set_auth_mode(monkeypatch, "native")
    ensure_user_dirs(auth_mode_settings / "default")

    with caplog.at_level(logging.WARNING):
        config_mod.validate_auth_startup_state()
    assert "already holds stored data" not in caplog.text


def test_no_warning_once_an_account_exists(auth_mode_settings, monkeypatch, caplog):
    set_auth_mode(monkeypatch, "native")
    put_file(auth_mode_settings, "default")
    seed_account(namespace="default")

    with caplog.at_level(logging.WARNING):
        config_mod.validate_auth_startup_state()
    assert "already holds stored data" not in caplog.text


def test_unreadable_storage_root_counts_as_content(auth_mode_settings, monkeypatch, caplog):
    """fail closed: a volume that cannot be listed may hold anything"""
    import os

    set_auth_mode(monkeypatch, "native")

    def boom(*args, **kwargs):
        raise PermissionError("nope")

    monkeypatch.setattr(os, "scandir", boom)
    with caplog.at_level(logging.WARNING):
        config_mod.validate_auth_startup_state()
    assert "already holds stored data" in caplog.text


# --- finding 1/3: closing setup by configuration ---


def test_setup_disabled_refuses_and_is_not_advertised(native_client, monkeypatch):
    set_auth_setting(monkeypatch, "auth_setup_enabled", False)

    status = native_client.get("/api/auth/status")
    assert status.status_code == 200
    assert status.json()["setup_required"] is False

    resp = native_client.post(
        "/api/auth/setup", json={"email": "first@example.com", "password": "a good password"}
    )
    assert resp.status_code == 404
    assert get_account_store().count() == 0


def test_setup_disabled_refuses_even_on_a_populated_instance(native_client, monkeypatch):
    """closed means closed, whatever the account store says"""
    set_auth_setting(monkeypatch, "auth_setup_enabled", False)
    seed_account(namespace="default")

    resp = native_client.post(
        "/api/auth/setup", json={"email": "second@example.com", "password": "a good password"}
    )
    assert resp.status_code == 404
    assert get_account_store().count() == 1
