"""site administration: the minimum user management for a single-admin instance.

create supports importing accounts from a prior system: an externally hashed
credential (bcrypt or native scrypt), a TOTP secret and backup code hashes.
imports validate everything first, then land in one atomic store write; a
repeated import of the same id and email is a no-op, never an overwrite.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from starlette.responses import Response

from app.api.auth_common import (
    account_response,
    apply_to_account,
    decode_imported_totp_secret,
    normalise_email,
    now_iso,
    validate_backup_code_hashes,
    validate_new_password,
)
from app.auth import get_admin_account, valid_user_id
from app.config import ensure_user_dirs, settings
from app.models.accounts import Account
from app.models.auth_schemas import (
    AccountResponse,
    AdminCreateUserRequest,
    AdminResetPasswordRequest,
    AdminUserListResponse,
)
from app.services import namespace_tombstones, secret_box
from app.services.account_store import DuplicateAccountError, get_account_store
from app.services.auth_token_store import get_auth_token_store
from app.services.login_rate_limit import login_limiter
from app.services.namespace_tombstones import NamespaceDeletionPendingError
from app.services.password_hashing import hash_password, is_supported_hash

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/admin/users", response_model=AdminUserListResponse)
def list_users(admin: Account = Depends(get_admin_account)):
    accounts = sorted(get_account_store().all(), key=lambda a: a.created_at)
    return AdminUserListResponse(users=[account_response(a) for a in accounts])


@router.post("/admin/users", response_model=AccountResponse)
def create_user(req: AdminCreateUserRequest, admin: Account = Depends(get_admin_account)):
    # validate everything before touching the store: a partial failure must
    # leave nothing behind
    email = normalise_email(req.email)
    if (req.password is None) == (req.password_hash is None):
        raise HTTPException(
            status_code=422, detail="provide exactly one of password or password_hash"
        )
    if req.password is not None:
        validate_new_password(req.password)
        password_hash = hash_password(req.password)
    else:
        if not is_supported_hash(req.password_hash):
            raise HTTPException(status_code=422, detail="unsupported password_hash scheme")
        password_hash = req.password_hash
    if req.id is not None:
        # the id keys storage paths, so it must satisfy the same format
        # contract as proxy-supplied user ids
        if not valid_user_id(req.id):
            raise HTTPException(status_code=422, detail="invalid account id format")
        account_id = req.id
    else:
        account_id = str(uuid.uuid4())
    encrypted_totp = None
    if req.totp_secret is not None:
        encrypted_totp = secret_box.encrypt(decode_imported_totp_secret(req.totp_secret))
    backup_hashes = validate_backup_code_hashes(req.backup_code_hashes)
    created_at = now_iso()
    if req.created_at is not None:
        try:
            datetime.fromisoformat(req.created_at)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="created_at is not ISO 8601") from exc
        created_at = req.created_at

    store = get_account_store()
    existing = store.get(account_id)
    if existing is not None:
        if existing.email == email:
            # idempotent import: same id and email is a no-op
            return account_response(existing)
        raise HTTPException(status_code=409, detail="account id already exists")
    if store.get_by_email(email) is not None:
        raise HTTPException(status_code=409, detail="email already registered")

    account = Account(
        id=account_id,
        email=email,
        password_hash=password_hash,
        is_admin=req.is_admin,
        created_at=created_at,
        storage_namespace=account_id,
        totp_enabled=encrypted_totp is not None,
        totp_secret=encrypted_totp,
        backup_code_hashes=backup_hashes,
    )
    try:
        namespace_tombstones.claim(account.storage_namespace)
    except NamespaceDeletionPendingError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    try:
        store.create(account)
    except DuplicateAccountError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    ensure_user_dirs(settings.storage_path / account.storage_namespace)
    logger.info("admin %s created account %s", admin.id, account.id)
    return account_response(account)


@router.post("/admin/users/{account_id}/disable", response_model=AccountResponse)
def disable_user(account_id: str, admin: Account = Depends(get_admin_account)):
    if account_id == admin.id:
        raise HTTPException(status_code=400, detail="cannot disable your own account")
    def disable(live: Account):
        live.disabled = True

    account = apply_to_account(account_id, disable)
    # locked out now, not at token expiry
    get_auth_token_store().revoke_for_account(account_id)
    return account_response(account)


@router.post("/admin/users/{account_id}/enable", response_model=AccountResponse)
def enable_user(account_id: str, admin: Account = Depends(get_admin_account)):
    def enable(live: Account):
        live.disabled = False

    account = apply_to_account(account_id, enable)
    # a re-enabled account must not stay locked out by the failures that
    # piled up while it was disabled
    login_limiter.reset(account.email)
    return account_response(account)


@router.post("/admin/users/{account_id}/reset-password")
def reset_password(
    account_id: str,
    req: AdminResetPasswordRequest,
    admin: Account = Depends(get_admin_account),
):
    validate_new_password(req.password)
    new_hash = hash_password(req.password)

    def set_hash(live: Account):
        live.password_hash = new_hash

    account = apply_to_account(account_id, set_hash)
    get_auth_token_store().revoke_for_account(account_id)
    # recovery is pointless if the lockout that prompted it survives
    login_limiter.reset(account.email)
    return Response(status_code=204)


@router.post("/admin/users/{account_id}/clear-2fa")
def clear_two_factor(account_id: str, admin: Account = Depends(get_admin_account)):
    """recovery path for a lost authenticator; no email infrastructure needed"""
    def clear(live: Account):
        live.totp_enabled = False
        live.totp_secret = None
        live.totp_last_step = None
        live.backup_code_hashes = []

    apply_to_account(account_id, clear)
    return Response(status_code=204)
