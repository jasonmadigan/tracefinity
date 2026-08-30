"""command line administration for instances provisioned out of band.

some deployments create administrators outside the browser: containerised
installs, automated provisioning, or any instance running with
AUTH_SETUP_ENABLED=false, where the web setup route does not exist at all.
`python -m app.cli create-admin` is the way in for those, and it lands the
same account POST /api/auth/setup would, including the namespace claim and
the storage scaffolding.
"""
from __future__ import annotations

import argparse
import getpass
import os
import sys
import uuid
from contextlib import contextmanager
from pathlib import Path

from fastapi import HTTPException

from app.api.auth_common import (
    decode_imported_totp_secret,
    normalise_email,
    now_iso,
    validate_backup_code_hashes,
    validate_new_password,
)
from app.auth import valid_user_id
from app.config import ensure_user_dirs, settings
from app.models.accounts import Account
from app.services import namespace_tombstones, secret_box
from app.services.account_store import get_account_store
from app.services.namespace_tombstones import NamespaceNotClaimableError
from app.services.password_hashing import hash_password, is_supported_hash

EXIT_OK = 0
# instance state refuses the command: wrong mode, unclaimable namespace, storage
EXIT_REFUSED = 1
# bad input; argparse leaves with the same code for a usage error
EXIT_INVALID = 2
# nothing to do, an account is already provisioned
EXIT_EXISTS = 3


class CliError(Exception):
    """message for the operator, and the code to leave with"""

    def __init__(self, message: str, code: int = EXIT_REFUSED):
        super().__init__(message)
        self.code = code


def _fail(message: str, code: int) -> int:
    print(f"error: {message}", file=sys.stderr)
    return code


def _running_as_root() -> bool:
    # geteuid and chown are both POSIX-only
    return hasattr(os, "geteuid") and hasattr(os, "chown") and os.geteuid() == 0


def _storage_owner() -> tuple[int, int] | None:
    """the uid/gid the storage root already carries.

    the same target the container entrypoint chowns to, so nothing new has
    to be configured and the two cannot disagree.
    """
    try:
        info = os.stat(settings.storage_path)
    except OSError as exc:
        print(f"warning: cannot read ownership of {settings.storage_path}: {exc}", file=sys.stderr)
        return None
    return info.st_uid, info.st_gid


def _storage_tree() -> set[Path]:
    """every path under the storage root, so what this command created can be
    told apart from what was already on the volume.

    only walked when running as root, which is once per provisioning, so the
    cost of listing a populated volume buys not having to guess which files
    the account store, the namespace scaffolding, and the secret writer left
    behind.
    """
    found: set[Path] = set()
    stack = [Path(settings.storage_path)]
    while stack:
        try:
            with os.scandir(stack.pop()) as entries:
                for entry in entries:
                    found.add(Path(entry.path))
                    if entry.is_dir(follow_symlinks=False):
                        stack.append(Path(entry.path))
        except OSError:
            # unreadable now is unchownable later; nothing to record
            continue
    return found


def _align_ownership(paths: set[Path], uid: int, gid: int):
    for path in sorted(paths):
        try:
            current = os.lstat(path)
        except OSError:
            continue
        if (current.st_uid, current.st_gid) == (uid, gid):
            continue
        try:
            # never through a symlink: as root that would retarget whatever
            # it points at. a platform without lchown raises
            # NotImplementedError rather than OSError, and that is still a
            # chown that did not happen
            os.chown(path, uid, gid, follow_symlinks=False)
        except (OSError, NotImplementedError) as exc:
            # an administrator that exists with the wrong ownership is one
            # chown away from working, and the operator is told which path
            # to fix. a bootstrap abandoned halfway is the worse outcome
            print(f"warning: could not set ownership on {path}: {exc}", file=sys.stderr)


@contextmanager
def _ownership_matching_storage():
    """hand anything created inside to whoever owns the storage root.

    `docker exec <container> python -m app.cli` lands as root by default,
    because the image has no USER and privileges drop at runtime. users.json
    is written 0600, so a root-created one is unreadable to the backend user
    and the instance then refuses to start. the entrypoint cannot catch it:
    its recursive chown is guarded on the storage directory's own ownership,
    which a file created inside an already-correct directory leaves matching.
    so do here what the entrypoint would have done, against the same target.

    the alignment runs even when the command fails partway, because a
    half-written bootstrap leaves root-owned files behind too.
    """
    if not _running_as_root():
        yield
        return
    owner = _storage_owner()
    before = _storage_tree()
    try:
        yield
    finally:
        if owner is not None:
            _align_ownership(_storage_tree() - before, *owner)


def _read_password() -> str:
    """prompt on a terminal, otherwise take one line from stdin.

    never a command-line argument: that lands in shell history and in the
    process table for anyone who can run ps.
    """
    if sys.stdin.isatty():
        password = getpass.getpass("password: ")
        if password != getpass.getpass("confirm password: "):
            raise CliError("passwords do not match", EXIT_INVALID)
        return password
    password = sys.stdin.readline().rstrip("\r\n")
    if not password:
        raise CliError("no password received on stdin", EXIT_INVALID)
    return password


def _resolve_password_hash(supplied: str | None) -> str:
    if supplied is None:
        password = _read_password()
        # the same minimum the web setup path enforces; an out-of-band admin
        # is not a weaker account
        validate_new_password(password)
        return hash_password(password)
    # same check the admin import path applies, so the two agree on what a
    # credential from a prior system may look like
    if not is_supported_hash(supplied):
        raise CliError(
            "unsupported password_hash scheme; expected bcrypt ($2a$/$2b$/$2y$) "
            "or native $scrypt$",
            EXIT_INVALID,
        )
    return supplied


def _resolve_account_id(supplied: str | None) -> str:
    if supplied is None:
        return str(uuid.uuid4())
    # the id keys storage paths, so it must satisfy the same format contract
    # as proxy-supplied user ids
    if not valid_user_id(supplied):
        raise CliError("invalid account id format", EXIT_INVALID)
    return supplied


def _resolve_second_factor(
    secret: str | None, backup_code_hashes: list[str] | None
) -> tuple[bytes | None, list[str]]:
    """check an imported second factor without writing anything.

    the admin API's own import validators, so an account provisioned here is
    stored exactly as one created through /api/admin/users and verifies
    against the same two-step login. both raise HTTPException, which main()
    already reports as invalid input. sealing the secret is left to the
    caller: encrypting generates the auth secret file when AUTH_SECRET is
    unset, and that belongs inside the ownership guard, after this has
    refused anything malformed.
    """
    decoded = None if secret is None else decode_imported_totp_secret(secret)
    return decoded, validate_backup_code_hashes(backup_code_hashes)


def _resolve_storage_namespace(supplied: str | None) -> str:
    if supplied is None:
        # what the web setup path claims: pre-auth single-user data, in place
        return "default"
    # the namespace becomes a directory name under the storage root, so it is
    # held to the id contract that doubles as the traversal guard. "default"
    # is the one name outside that shape, and it is the single-user namespace
    if supplied != "default" and not valid_user_id(supplied):
        raise CliError("invalid storage namespace format", EXIT_INVALID)
    return supplied


def _create_admin(args: argparse.Namespace) -> int:
    mode = settings.resolved_auth_mode
    if mode != "native":
        # the login route is native-only, so the account could never be used,
        # and an instance holding accounts refuses to start in either of the
        # other two modes
        raise CliError(
            f"AUTH_MODE resolves to '{mode}'; a native account cannot be used in that "
            "mode. run this command with AUTH_MODE=native"
        )
    # AUTH_SETUP_ENABLED is deliberately not consulted: it governs the web
    # route, and closing that door is the reason this command exists

    email = normalise_email(args.email)
    account_id = _resolve_account_id(args.id)
    namespace = _resolve_storage_namespace(args.storage_namespace)
    # a malformed secret must not reach the tombstone claim, so it is checked
    # with the rest of the input rather than beside the account it builds
    totp_secret, backup_hashes = _resolve_second_factor(
        args.totp_secret, args.backup_code_hash
    )
    # cheap refusal before anything with a side effect, so a provisioning
    # script that runs twice does not clear a tombstone on the second run
    if get_account_store().count():
        raise CliError(
            "an account already exists on this instance; use the administration "
            "API to add further accounts",
            EXIT_EXISTS,
        )
    password_hash = _resolve_password_hash(args.password_hash)

    # everything with a side effect goes inside, so a root-run command leaves
    # nothing the backend user cannot read
    with _ownership_matching_storage():
        # sealing the secret generates {storage}/auth_secret when AUTH_SECRET
        # is unset, so it has to happen in here to be handed over too
        encrypted_totp = None if totp_secret is None else secret_box.encrypt(totp_secret)
        account = Account(
            id=account_id,
            email=email,
            password_hash=password_hash,
            is_admin=True,
            created_at=now_iso(),
            # claims whatever is already in storage/<namespace>/ without
            # moving it. left alone that is storage/default/, the same claim
            # the web setup path makes; a supplied id keys the account, not
            # the namespace
            storage_namespace=namespace,
            # same coupling the admin API applies: a supplied secret is what
            # turns the second factor on
            totp_enabled=encrypted_totp is not None,
            totp_secret=encrypted_totp,
            backup_code_hashes=backup_hashes,
        )
        try:
            # adopting is what this command is for: the default namespace holds
            # a single-user install's library, and --storage-namespace names
            # storage the account already owned elsewhere. both are typed by an
            # operator on an instance with no accounts. a tombstone still refuses
            namespace_tombstones.claim(account.storage_namespace, adopt_existing=True)
        except NamespaceNotClaimableError as exc:
            raise CliError(str(exc)) from exc
        if not get_account_store().create_first_admin(account):
            raise CliError("an account was created concurrently; nothing was changed", EXIT_EXISTS)
        ensure_user_dirs(settings.storage_path / account.storage_namespace)

    print("created administrator")
    print(f"email: {account.email}")
    print(f"id: {account.id}")
    print(f"namespace: {account.storage_namespace}")
    print("admin: true")
    print(f"two-factor: {'imported' if account.totp_enabled else 'none'}")
    if backup_hashes:
        print(f"backup codes imported: {len(backup_hashes)}")
    return EXIT_OK


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m app.cli",
        description="administer a Tracefinity instance without the web interface",
    )
    subcommands = parser.add_subparsers(dest="command", required=True)
    create = subcommands.add_parser(
        "create-admin",
        help="create the first administrator on an instance provisioned out of band",
    )
    create.add_argument("--email", required=True, help="login email address")
    create.add_argument(
        "--id",
        help="account id instead of a generated uuid, so provisioning can preserve "
        "existing keying. a 25-character cuid or a 36-character uuid",
    )
    create.add_argument(
        "--storage-namespace",
        help="storage namespace the account opens onto, for an account that "
        "already owns data under a namespace other than 'default'. the same "
        "format as --id, or the literal 'default', which is the default",
    )
    create.add_argument(
        "--totp-secret",
        help="import an existing base32 TOTP secret, so an account that already "
        "had a second factor keeps it. without it the account is created with "
        "two-factor authentication off",
    )
    create.add_argument(
        "--backup-code-hash",
        action="append",
        metavar="HASH",
        help="import one already-hashed backup code, in the same bcrypt or "
        "$scrypt$ form as --password-hash. repeat for each code",
    )
    create.add_argument(
        "--password-hash",
        help="import an existing bcrypt or $scrypt$ credential. without it the "
        "password is prompted for on a terminal, or read from stdin when stdin "
        "is not one",
    )
    create.set_defaults(func=_create_admin)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except CliError as exc:
        return _fail(str(exc), exc.code)
    except HTTPException as exc:
        # the validators shared with the web path speak HTTP; the rules are
        # identical, so their wording comes straight through
        return _fail(str(exc.detail), EXIT_INVALID)
    except OSError as exc:
        return _fail(f"storage error: {exc}", EXIT_REFUSED)


if __name__ == "__main__":
    sys.exit(main())
