"""out-of-band first-administrator creation through `python -m app.cli`.

the CLI is the way in for deployments that never open the web setup route,
so it has to land the same account the web path would: same namespace claim,
same tombstone refusal, same storage scaffolding.
"""
import io
import sys
from pathlib import Path

import bcrypt as bcrypt_lib
import pytest
from starlette.testclient import TestClient

from app import cli
from app.services import namespace_tombstones, secret_box, totp
from app.services.account_store import get_account_store
from app.services.password_hashing import hash_password
from tests.conftest import set_auth_mode, set_auth_setting

EMAIL = "admin@example.com"
PASSWORD = "correct horse battery"
# valid uuid per auth._USER_ID_RE
SUPPLIED_ID = "deadbeef-dead-4bee-8bee-deadbeefdead"
# valid cuid per the same expression, so both branches of it are exercised
SUPPLIED_NAMESPACE = "clx9n2k4t0000qzrmn831i7rn"
# a 20-byte secret in base32, the shape an authenticator app is given
TOTP_BASE32 = totp.secret_to_base32(bytes(range(20)))
BACKUP_CODE = "aaaaa-bbbbb"


class _Tty(io.StringIO):
    def isatty(self):
        return True


@pytest.fixture()
def native_cli(auth_mode_settings, monkeypatch):
    """storage sandbox in native mode, with no web client involved"""
    set_auth_mode(monkeypatch, "native")
    return auth_mode_settings


def run(monkeypatch, argv, stdin=None):
    monkeypatch.setattr(sys, "stdin", io.StringIO("" if stdin is None else stdin))
    return cli.main(argv)


def create_admin(monkeypatch, *args, password=PASSWORD):
    return run(monkeypatch, ["create-admin", "--email", EMAIL, *args], stdin=f"{password}\n")


def only_account():
    accounts = get_account_store().all()
    assert len(accounts) == 1
    return accounts[0]


def test_creates_first_admin_from_stdin_password(native_cli, monkeypatch, capsys):
    assert create_admin(monkeypatch) == 0

    account = only_account()
    assert account.email == EMAIL
    assert account.is_admin is True
    assert account.disabled is False
    # the first administrator claims pre-auth data in storage/default/,
    # exactly as the web setup path does
    assert account.storage_namespace == "default"
    assert (native_cli / "default" / "uploads").is_dir()

    out = capsys.readouterr().out
    assert f"email: {EMAIL}" in out
    assert f"id: {account.id}" in out
    assert "namespace: default" in out
    assert "admin: true" in out


def test_created_account_can_log_in_through_the_web_path(native_cli, monkeypatch):
    import app.main as main_mod

    assert create_admin(monkeypatch) == 0

    client = TestClient(main_mod.app)
    assert client.get("/api/auth/status").json()["setup_required"] is False
    resp = client.post("/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert resp.status_code == 200, resp.text
    assert resp.json()["account"]["is_admin"] is True


def test_refuses_when_an_account_already_exists(native_cli, monkeypatch, capsys):
    assert create_admin(monkeypatch) == 0
    existing = only_account()
    capsys.readouterr()

    code = run(
        monkeypatch,
        ["create-admin", "--email", "second@example.com"],
        stdin="another long password\n",
    )
    assert code == 3
    assert only_account().id == existing.id
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "already" in captured.err


def test_accepts_an_imported_password_hash(native_cli, monkeypatch):
    imported = bcrypt_lib.hashpw(b"legacy password", bcrypt_lib.gensalt(rounds=4)).decode()
    # no stdin at all: the hash path must not consult it
    assert run(monkeypatch, ["create-admin", "--email", EMAIL, "--password-hash", imported]) == 0

    account = only_account()
    assert account.password_hash == imported


def test_accepts_a_native_scrypt_hash(native_cli, monkeypatch):
    imported = hash_password("imported pw")
    assert run(monkeypatch, ["create-admin", "--email", EMAIL, "--password-hash", imported]) == 0
    assert only_account().password_hash == imported


def test_rejects_an_unsupported_password_hash(native_cli, monkeypatch, capsys):
    code = run(monkeypatch, ["create-admin", "--email", EMAIL, "--password-hash", "plaintext"])
    assert code == 2
    assert get_account_store().count() == 0
    assert "password_hash" in capsys.readouterr().err


def test_accepts_a_caller_supplied_id(native_cli, monkeypatch):
    assert create_admin(monkeypatch, "--id", SUPPLIED_ID) == 0
    account = only_account()
    assert account.id == SUPPLIED_ID
    # the id keys the account, not the namespace: the first administrator
    # still claims whatever single-user data is already on the volume
    assert account.storage_namespace == "default"


@pytest.mark.parametrize("bad_id", ["../escape", "default", "short", "Uppercase-Is-Not-Hex"])
def test_rejects_an_invalid_id(native_cli, monkeypatch, capsys, bad_id):
    assert create_admin(monkeypatch, "--id", bad_id) == 2
    assert get_account_store().count() == 0
    assert "id" in capsys.readouterr().err


def test_claims_the_default_namespace_when_the_flag_is_omitted(native_cli, monkeypatch, capsys):
    assert create_admin(monkeypatch) == 0
    account = only_account()
    assert account.storage_namespace == "default"
    assert (native_cli / "default" / "uploads").is_dir()
    assert "namespace: default" in capsys.readouterr().out


def test_accepts_the_default_namespace_named_explicitly(native_cli, monkeypatch):
    # the literal sits outside the id shape, so it needs its own allowance
    assert create_admin(monkeypatch, "--storage-namespace", "default") == 0
    assert only_account().storage_namespace == "default"
    assert (native_cli / "default" / "uploads").is_dir()


def test_accepts_a_supplied_storage_namespace(native_cli, monkeypatch, capsys):
    assert create_admin(monkeypatch, "--storage-namespace", SUPPLIED_NAMESPACE) == 0

    account = only_account()
    assert account.storage_namespace == SUPPLIED_NAMESPACE
    assert (native_cli / SUPPLIED_NAMESPACE / "uploads").is_dir()
    # the account opens onto its own data, so the single-user namespace is
    # neither claimed nor scaffolded
    assert not (native_cli / "default").exists()
    assert f"namespace: {SUPPLIED_NAMESPACE}" in capsys.readouterr().out


def test_points_a_supplied_id_at_the_storage_it_already_owns(native_cli, monkeypatch):
    """what the flag exists for: an account provisioned under the id it had
    on a previous system, opening onto the data that id already owns rather
    than an empty default namespace"""
    owned = native_cli / SUPPLIED_ID / "uploads"
    owned.mkdir(parents=True)
    (owned / "prior.png").write_bytes(b"data")

    code = create_admin(monkeypatch, "--id", SUPPLIED_ID, "--storage-namespace", SUPPLIED_ID)
    assert code == 0

    account = only_account()
    assert account.id == SUPPLIED_ID
    assert account.storage_namespace == SUPPLIED_ID
    # claimed where it lies, not moved and not replaced
    assert (owned / "prior.png").read_bytes() == b"data"


@pytest.mark.parametrize(
    "bad_namespace",
    ["../escape", "", "a/b", "short", "Uppercase-Is-Not-Hex", "has space"],
)
def test_rejects_an_unsafe_storage_namespace(native_cli, monkeypatch, capsys, bad_namespace):
    # a namespace is a directory name under the storage root, so anything
    # outside the id shape is a path the command must never open
    assert create_admin(monkeypatch, "--storage-namespace", bad_namespace) == 2
    assert get_account_store().count() == 0
    assert "namespace" in capsys.readouterr().err
    assert list(native_cli.iterdir()) == []


def test_prompts_when_stdin_is_a_tty(native_cli, monkeypatch):
    monkeypatch.setattr(sys, "stdin", _Tty())
    prompts = iter([PASSWORD, PASSWORD])
    monkeypatch.setattr(cli.getpass, "getpass", lambda prompt="": next(prompts))

    assert cli.main(["create-admin", "--email", EMAIL]) == 0
    assert only_account().email == EMAIL


def test_refuses_when_the_prompted_passwords_differ(native_cli, monkeypatch, capsys):
    monkeypatch.setattr(sys, "stdin", _Tty())
    prompts = iter([PASSWORD, "something else entirely"])
    monkeypatch.setattr(cli.getpass, "getpass", lambda prompt="": next(prompts))

    assert cli.main(["create-admin", "--email", EMAIL]) == 2
    assert get_account_store().count() == 0
    assert "match" in capsys.readouterr().err


def test_refuses_when_stdin_carries_no_password(native_cli, monkeypatch, capsys):
    assert run(monkeypatch, ["create-admin", "--email", EMAIL], stdin="") == 2
    assert get_account_store().count() == 0
    assert "stdin" in capsys.readouterr().err


def test_rejects_a_short_password(native_cli, monkeypatch, capsys):
    assert create_admin(monkeypatch, password="short") == 2
    assert get_account_store().count() == 0
    assert "8 characters" in capsys.readouterr().err


def test_rejects_an_invalid_email(native_cli, monkeypatch, capsys):
    code = run(monkeypatch, ["create-admin", "--email", "not-an-email"], stdin=f"{PASSWORD}\n")
    assert code == 2
    assert get_account_store().count() == 0
    assert "email" in capsys.readouterr().err


def test_refuses_a_tombstoned_namespace(native_cli, monkeypatch, capsys):
    # a deletion that did not finish left files with no owner
    canary = native_cli / "default" / "uploads" / "canary.txt"
    canary.parent.mkdir(parents=True, exist_ok=True)
    canary.write_text("private")
    namespace_tombstones.mark("default")

    assert create_admin(monkeypatch) == 1
    assert get_account_store().count() == 0
    assert canary.read_text() == "private"
    assert "did not finish" in capsys.readouterr().err


def test_refuses_a_tombstoned_non_default_namespace(native_cli, monkeypatch, capsys):
    # the claim is not a default-namespace formality: a chosen namespace whose
    # deletion did not finish is refused on the same terms
    canary = native_cli / SUPPLIED_NAMESPACE / "uploads" / "canary.txt"
    canary.parent.mkdir(parents=True, exist_ok=True)
    canary.write_text("private")
    namespace_tombstones.mark(SUPPLIED_NAMESPACE)

    assert create_admin(monkeypatch, "--storage-namespace", SUPPLIED_NAMESPACE) == 1
    assert get_account_store().count() == 0
    assert canary.read_text() == "private"
    assert "did not finish" in capsys.readouterr().err


def test_clears_a_stale_tombstone_with_nothing_left_behind(native_cli, monkeypatch):
    namespace_tombstones.mark("default")
    assert create_admin(monkeypatch) == 0
    assert not namespace_tombstones.is_marked("default")


@pytest.mark.parametrize("mode", ["open", "proxy"])
def test_refuses_outside_native_mode(auth_mode_settings, monkeypatch, capsys, mode):
    set_auth_mode(monkeypatch, mode, proxy_secret="s" if mode == "proxy" else None)

    assert create_admin(monkeypatch) == 1
    assert get_account_store().count() == 0
    err = capsys.readouterr().err
    assert mode in err
    assert "native" in err


def test_works_when_web_setup_is_disabled(native_cli, monkeypatch):
    # the flag closes the web route; out-of-band provisioning is the way in
    set_auth_setting(monkeypatch, "auth_setup_enabled", False)
    assert create_admin(monkeypatch) == 0
    assert only_account().is_admin is True


def test_never_prints_the_password_or_the_hash(native_cli, monkeypatch, capsys):
    assert create_admin(monkeypatch) == 0
    captured = capsys.readouterr()
    written = captured.out + captured.err
    assert PASSWORD not in written
    assert "scrypt" not in written
    assert only_account().password_hash not in written


def test_never_prints_an_imported_hash(auth_mode_settings, monkeypatch, capsys):
    set_auth_mode(monkeypatch, "native")
    imported = hash_password("imported pw")
    assert run(monkeypatch, ["create-admin", "--email", EMAIL, "--password-hash", imported]) == 0
    captured = capsys.readouterr()
    assert imported not in captured.out + captured.err


class _Owner:
    """the storage root's stat with uid/gid overridden, so the target
    ownership can differ from what the test user actually creates.

    everything else delegates, because the override sits on os.stat and
    pathlib reads the same result during the run.
    """

    def __init__(self, real, uid, gid):
        self._real = real
        self.st_uid = uid
        self.st_gid = gid

    def __getattr__(self, name):
        return getattr(self._real, name)


def storage_tree(root):
    """every path under the storage root, walked independently of the CLI"""
    return set(root.rglob("*"))


def own_storage_root(monkeypatch, storage, uid, gid):
    """report a different owner for the storage root than the test user
    creates files with, so an attempted chown is observable"""
    real_stat = cli.os.stat

    def stat(path, *a, **kw):
        info = real_stat(path, *a, **kw)
        if Path(path) == Path(storage):
            return _Owner(info, uid, gid)
        return info

    monkeypatch.setattr(cli.os, "stat", stat)
    return uid, gid


def record_chowns(monkeypatch, chown=None):
    recorded = []

    def record(path, path_uid, path_gid, **kw):
        recorded.append((Path(path), path_uid, path_gid))
        if chown is not None:
            chown(path)

    monkeypatch.setattr(cli.os, "chown", record)
    return recorded


def simulate_root(monkeypatch, storage, uid=4242, gid=4243, chown=None):
    """run the command as if euid 0, recording chowns instead of making them.

    a real root test is not runnable in CI, and the interesting behaviour is
    which paths are handed over, not the syscall.
    """
    monkeypatch.setattr(cli.os, "geteuid", lambda: 0)
    return own_storage_root(monkeypatch, storage, uid, gid), record_chowns(monkeypatch, chown)


def test_hands_everything_it_creates_to_the_storage_root_owner(native_cli, monkeypatch):
    target, recorded = simulate_root(monkeypatch, native_cli)
    before = storage_tree(native_cli)

    assert create_admin(monkeypatch) == 0

    created = storage_tree(native_cli) - before
    assert {path for path, _, _ in recorded} == created
    assert all((uid, gid) == target for _, uid, gid in recorded)
    # the account store, the namespace claim, and the storage scaffolding
    assert native_cli / "users.json" in created
    assert native_cli / "default" in created
    assert native_cli / "default" / "uploads" in created


def test_hands_over_a_chosen_namespace_tree(native_cli, monkeypatch):
    """the diff is taken against the storage root, so a namespace other than
    default is covered without the alignment knowing which one was chosen"""
    target, recorded = simulate_root(monkeypatch, native_cli)
    before = storage_tree(native_cli)

    assert create_admin(monkeypatch, "--storage-namespace", SUPPLIED_NAMESPACE) == 0

    created = storage_tree(native_cli) - before
    assert {path for path, _, _ in recorded} == created
    assert all((uid, gid) == target for _, uid, gid in recorded)
    assert native_cli / SUPPLIED_NAMESPACE in created
    assert native_cli / SUPPLIED_NAMESPACE / "uploads" in created


def test_hands_over_a_file_the_command_did_not_write_itself(native_cli, monkeypatch):
    """anything that appears while the command runs counts, so a secret or a
    token store generated underneath it is covered without being listed"""
    real_ensure = cli.ensure_user_dirs

    def ensure_and_generate_a_secret(user_path):
        real_ensure(user_path)
        (native_cli / "auth_secret").write_text("generated underneath")

    monkeypatch.setattr(cli, "ensure_user_dirs", ensure_and_generate_a_secret)
    _, recorded = simulate_root(monkeypatch, native_cli)

    assert create_admin(monkeypatch) == 0
    assert native_cli / "auth_secret" in {path for path, _, _ in recorded}


def test_leaves_pre_existing_paths_alone(native_cli, monkeypatch):
    existing_dir = native_cli / "default" / "uploads"
    existing_dir.mkdir(parents=True)
    existing_file = existing_dir / "someone-elses.png"
    existing_file.write_bytes(b"data")
    _, recorded = simulate_root(monkeypatch, native_cli)

    assert create_admin(monkeypatch) == 0

    touched = {path for path, _, _ in recorded}
    assert existing_file not in touched
    assert existing_dir not in touched
    assert native_cli / "users.json" in touched


def test_skips_paths_whose_ownership_already_matches(native_cli, monkeypatch):
    real = cli.os.stat(native_cli)
    _, recorded = simulate_root(monkeypatch, native_cli, uid=real.st_uid, gid=real.st_gid)

    assert create_admin(monkeypatch) == 0
    assert recorded == []


def test_attempts_nothing_when_not_running_as_root(native_cli, monkeypatch):
    # ownership that would otherwise be corrected, so only the euid check
    # can be what holds the command back
    own_storage_root(monkeypatch, native_cli, 4242, 4243)
    recorded = record_chowns(monkeypatch)
    monkeypatch.setattr(cli.os, "geteuid", lambda: 1000)

    assert create_admin(monkeypatch) == 0
    assert recorded == []


def test_attempts_nothing_without_posix_ownership(native_cli, monkeypatch):
    own_storage_root(monkeypatch, native_cli, 4242, 4243)
    recorded = record_chowns(monkeypatch)
    monkeypatch.delattr(cli.os, "geteuid", raising=False)

    assert create_admin(monkeypatch) == 0
    assert recorded == []


def test_a_failed_chown_warns_but_leaves_the_administrator_created(
    native_cli, monkeypatch, capsys
):
    def refuse(path):
        raise PermissionError(13, "Operation not permitted")

    simulate_root(monkeypatch, native_cli, chown=refuse)

    # an administrator with the wrong ownership is one chown away from
    # working; a bootstrap abandoned halfway is not
    assert create_admin(monkeypatch) == 0
    assert only_account().email == EMAIL
    err = capsys.readouterr().err
    assert "users.json" in err
    assert "ownership" in err


def test_hands_over_what_a_failed_bootstrap_left_behind(native_cli, monkeypatch, capsys):
    def explode(user_path):
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(cli, "ensure_user_dirs", explode)
    _, recorded = simulate_root(monkeypatch, native_cli)

    assert create_admin(monkeypatch) == 1
    assert "storage error" in capsys.readouterr().err
    # the account store landed before the failure and is still root-owned
    assert native_cli / "users.json" in {path for path, _, _ in recorded}


def login_step_one(client, password=PASSWORD):
    resp = client.post("/api/auth/login", json={"email": EMAIL, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_imported_totp_secret_completes_the_real_two_step_login(native_cli, monkeypatch):
    """the point of the flag: not that a field is set, but that the account
    genuinely verifies a code through the login the browser uses"""
    import app.main as main_mod

    secret = totp.generate_secret()
    code = create_admin(monkeypatch, "--totp-secret", totp.secret_to_base32(secret))
    assert code == 0
    assert only_account().totp_enabled is True

    client = TestClient(main_mod.app)
    # the password alone no longer logs in: it buys a pending token
    body = login_step_one(client)
    assert body["pending"] is True
    assert body.get("account") is None

    resp = client.post(
        "/api/auth/login/2fa",
        json={
            "pending_token": body["pending_token"],
            "code": totp.code_for_step(secret, totp.current_step()),
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["account"]["is_admin"] is True


def test_a_wrong_code_is_refused_by_the_imported_second_factor(native_cli, monkeypatch):
    """the secret that landed is the one supplied, not any secret: a code
    from a different secret must not open the account"""
    import app.main as main_mod

    secret = totp.generate_secret()
    other = totp.generate_secret()
    assert create_admin(monkeypatch, "--totp-secret", totp.secret_to_base32(secret)) == 0

    client = TestClient(main_mod.app)
    body = login_step_one(client)
    resp = client.post(
        "/api/auth/login/2fa",
        json={
            "pending_token": body["pending_token"],
            "code": totp.code_for_step(other, totp.current_step()),
        },
    )
    assert resp.status_code == 401


def test_imported_secret_is_stored_encrypted_at_rest(native_cli, monkeypatch):
    """the same secret_box scheme the admin API uses, so the account is
    byte-for-byte equivalent to an API-created one"""
    secret = totp.generate_secret()
    base32 = totp.secret_to_base32(secret)
    assert create_admin(monkeypatch, "--totp-secret", base32) == 0

    account = only_account()
    assert account.totp_secret is not None
    assert account.totp_secret.startswith("enc$v1$")
    plaintext, _ = secret_box.decrypt(account.totp_secret)
    assert plaintext == secret
    # neither the raw secret nor its base32 form is recoverable from the file
    stored = (native_cli / "users.json").read_text()
    assert base32 not in stored
    assert account.totp_secret in stored


def test_imported_backup_code_hash_redeems_at_login(native_cli, monkeypatch):
    import app.main as main_mod

    secret = totp.generate_secret()
    code = create_admin(
        monkeypatch,
        "--totp-secret",
        totp.secret_to_base32(secret),
        "--backup-code-hash",
        hash_password(BACKUP_CODE),
    )
    assert code == 0
    assert len(only_account().backup_code_hashes) == 1

    client = TestClient(main_mod.app)
    body = login_step_one(client)
    resp = client.post(
        "/api/auth/login/2fa",
        json={"pending_token": body["pending_token"], "code": BACKUP_CODE},
    )
    assert resp.status_code == 200, resp.text
    # single use: redeeming spends it
    assert only_account().backup_code_hashes == []


def test_accepts_several_backup_code_hashes(native_cli, monkeypatch, capsys):
    hashes = [hash_password(f"code-{n}") for n in range(3)]
    args = []
    for stored in hashes:
        args += ["--backup-code-hash", stored]
    assert create_admin(monkeypatch, "--totp-secret", TOTP_BASE32, *args) == 0

    assert only_account().backup_code_hashes == hashes
    assert "backup codes imported: 3" in capsys.readouterr().out


@pytest.mark.parametrize(
    "bad_secret",
    ["!!notbase32!!", "", "AAAA", "not base32 at all", "JBSWY3DPEHPK3PX@"],
)
def test_rejects_a_malformed_totp_secret_before_any_side_effect(
    native_cli, monkeypatch, capsys, bad_secret
):
    assert create_admin(monkeypatch, "--totp-secret", bad_secret) == 2
    assert get_account_store().count() == 0
    assert "totp_secret" in capsys.readouterr().err
    # nothing was written at all, not even the auth secret that sealing the
    # value would have generated
    assert list(native_cli.iterdir()) == []


def test_rejects_a_short_totp_secret(native_cli, monkeypatch, capsys):
    # valid base32, but too little entropy to be a real shared secret
    short = totp.secret_to_base32(b"123456789")
    assert create_admin(monkeypatch, "--totp-secret", short) == 2
    assert get_account_store().count() == 0
    assert "too short" in capsys.readouterr().err
    assert list(native_cli.iterdir()) == []


def test_rejects_an_unsupported_backup_code_hash(native_cli, monkeypatch, capsys):
    code = create_admin(
        monkeypatch,
        "--totp-secret",
        TOTP_BASE32,
        "--backup-code-hash",
        hash_password("fine"),
        "--backup-code-hash",
        "plaintext-code",
    )
    assert code == 2
    assert get_account_store().count() == 0
    assert "backup code hash" in capsys.readouterr().err
    assert list(native_cli.iterdir()) == []


def test_a_bad_secret_leaves_a_tombstone_untouched(native_cli, monkeypatch):
    """validation runs ahead of the claim, so a rejected import cannot clear
    the marker guarding an unfinished deletion"""
    namespace_tombstones.mark("default")

    assert create_admin(monkeypatch, "--totp-secret", "!!notbase32!!") == 2
    assert namespace_tombstones.is_marked("default")
    assert get_account_store().count() == 0


def test_omitting_the_flag_leaves_two_factor_disabled(native_cli, monkeypatch, capsys):
    import app.main as main_mod

    assert create_admin(monkeypatch) == 0

    account = only_account()
    assert account.totp_enabled is False
    assert account.totp_secret is None
    assert account.backup_code_hashes == []
    assert "two-factor: none" in capsys.readouterr().out

    # the login stays one step, exactly as before the flag existed
    client = TestClient(main_mod.app)
    body = login_step_one(client)
    assert body.get("pending") is not True
    assert body["account"]["is_admin"] is True


def test_reports_that_a_second_factor_was_imported(native_cli, monkeypatch, capsys):
    assert create_admin(monkeypatch, "--totp-secret", TOTP_BASE32) == 0
    out = capsys.readouterr().out
    assert "two-factor: imported" in out
    # nothing to report when none were supplied
    assert "backup codes imported" not in out


def test_never_prints_the_imported_totp_secret(native_cli, monkeypatch, capsys):
    secret = totp.generate_secret()
    base32 = totp.secret_to_base32(secret)
    assert create_admin(monkeypatch, "--totp-secret", base32, "--backup-code-hash",
                        hash_password(BACKUP_CODE)) == 0

    captured = capsys.readouterr()
    written = captured.out + captured.err
    assert base32 not in written
    assert secret.hex() not in written
    # nor the sealed form, nor the backup code material
    assert only_account().totp_secret not in written
    assert BACKUP_CODE not in written


def test_never_prints_a_rejected_totp_secret(native_cli, monkeypatch, capsys):
    """a secret that fails validation is still credential material: the error
    names the field, never the value"""
    # valid base32 so it reaches the length check with the value intact
    short = totp.secret_to_base32(b"123456789")
    assert create_admin(monkeypatch, "--totp-secret", short) == 2
    captured = capsys.readouterr()
    assert short not in captured.out + captured.err


def test_hands_over_an_auth_secret_generated_while_sealing(native_cli, monkeypatch):
    """encrypting the secret generates {storage}/auth_secret when AUTH_SECRET
    is unset, so a root-run import must hand that file over too"""
    _, recorded = simulate_root(monkeypatch, native_cli)

    assert create_admin(monkeypatch, "--totp-secret", TOTP_BASE32) == 0

    assert (native_cli / "auth_secret").exists()
    assert native_cli / "auth_secret" in {path for path, _, _ in recorded}
