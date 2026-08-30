"""disabling must never leave an instance with no enabled administrator.

the route-level check only covers an admin disabling itself. two admins
disabling each other pass that check independently, so the invariant is
enforced in the store under its lock.
"""
import threading

import pytest
from fastapi import HTTPException
from starlette.testclient import TestClient

from app.api.auth_common import apply_to_account
from app.services.account_store import LastAdminError, get_account_store
from tests.test_auth_native import create_user, login, setup_admin

SECOND = {"email": "second@example.com", "password": "second password"}


def enabled_admins():
    return [a for a in get_account_store().all() if a.is_admin and not a.disabled]


def admin_client(native_client, creds):
    client = TestClient(native_client.app)
    assert login(client, creds["email"], creds["password"]).status_code == 200
    return client


def test_disabling_the_only_other_admin_leaves_one_enabled(native_client):
    """the invariant holds when it is the caller's own account at stake"""
    first = setup_admin(native_client)
    second = create_user(native_client, is_admin=True, **SECOND)

    other = admin_client(native_client, SECOND)
    # second disables first, which is allowed: second is still an enabled admin
    assert other.post(f"/api/admin/users/{first['id']}/disable").status_code == 200
    # first can no longer disable second; its own tokens are already revoked
    assert native_client.post(f"/api/admin/users/{second['id']}/disable").status_code == 401
    assert [a.id for a in enabled_admins()] == [second["id"]]


def test_concurrent_mutual_disable_keeps_an_enabled_admin(native_client):
    """both requests passed the route check in the red team's run and both
    returned 200, leaving zero enabled admins and no way back in"""
    first = setup_admin(native_client)
    second = create_user(native_client, is_admin=True, **SECOND)

    first_client = native_client
    second_client = admin_client(native_client, SECOND)
    barrier = threading.Barrier(2)
    results = []

    def attempt(client, target_id):
        barrier.wait()
        results.append(client.post(f"/api/admin/users/{target_id}/disable").status_code)

    threads = [
        threading.Thread(target=attempt, args=(first_client, second["id"])),
        threading.Thread(target=attempt, args=(second_client, first["id"])),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    # the loser is refused by the store (409), or has already lost its own
    # tokens to the winner's revoke and never reaches it (401). both mean the
    # disable did not land, and the outcome depends on where the revoke falls
    # relative to the loser resolving its cookie
    assert results.count(200) == 1
    assert [r for r in results if r != 200][0] in (401, 409)
    assert len(enabled_admins()) == 1


def test_store_refuses_a_mutation_that_removes_the_last_enabled_admin(native_client):
    setup_admin(native_client)
    create_user(native_client, **SECOND)
    sole = enabled_admins()[0]

    def disable(live):
        live.disabled = True
        return live

    with pytest.raises(LastAdminError):
        get_account_store().mutate(sole.id, disable)
    assert len(enabled_admins()) == 1


def test_a_broken_instance_can_still_be_repaired(native_client):
    """the guard blocks the change that breaks the invariant, not every
    change made once it is already broken, or enable could never recover it"""
    setup_admin(native_client)
    sole = enabled_admins()[0]
    store = get_account_store()

    # reach the broken state the way a restored volume might carry it
    with store._lock:
        store._accounts[sole.id].disabled = True

    def enable(live):
        live.disabled = False
        return live

    assert store.mutate(sole.id, enable).disabled is False
    assert len(enabled_admins()) == 1


def test_the_refusal_is_reported_as_409(native_client):
    """route-level 409 only ever arises from the race above, so cover the
    mapping directly rather than leaving it to timing"""
    setup_admin(native_client)
    sole = enabled_admins()[0]

    def disable(live):
        live.disabled = True

    with pytest.raises(HTTPException) as excinfo:
        apply_to_account(sole.id, disable)
    assert excinfo.value.status_code == 409
    assert len(enabled_admins()) == 1


def test_disabling_a_non_admin_is_unaffected(native_client):
    setup_admin(native_client)
    member = create_user(native_client, email="member@example.com", password="member password")
    assert native_client.post(f"/api/admin/users/{member['id']}/disable").status_code == 200
