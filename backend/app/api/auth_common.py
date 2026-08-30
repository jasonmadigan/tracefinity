"""shared helpers for the auth and admin routers."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Callable, Sequence

from fastapi import HTTPException
from starlette.responses import Response

from app.auth import AUTH_COOKIE_NAME
from app.config import settings
from app.models.accounts import Account
from app.models.auth_schemas import AccountResponse
from app.services import totp
from app.services.account_store import LastAdminError, get_account_store
from app.services.auth_token_store import TOKEN_LIFETIME
from app.services.password_hashing import is_supported_hash

MIN_PASSWORD_LENGTH = 8
# \A and \Z for the same reason as _USER_ID_RE: $ tolerates a trailing
# newline. normalise_email strips first, so this holds the line regardless
_EMAIL_RE = re.compile(r"\A[^@\s]+@[^@\s]+\Z")
# below the 128 bits RFC 4226 requires of a generator: an import comes from
# whatever the prior system issued, and refusing it strands the account
_MIN_TOTP_SECRET_BYTES = 10


def require_native():
    if settings.resolved_auth_mode != "native":
        raise HTTPException(status_code=404, detail="native authentication is not enabled")


def normalise_email(email: str) -> str:
    cleaned = email.strip().lower()
    if len(cleaned) > 254 or not _EMAIL_RE.match(cleaned):
        raise HTTPException(status_code=422, detail="invalid email address")
    return cleaned


def validate_new_password(password: str):
    if len(password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=422,
            detail=f"password must be at least {MIN_PASSWORD_LENGTH} characters",
        )


def decode_imported_totp_secret(value: str) -> bytes:
    """check a base32 second-factor secret and return its raw bytes.

    every import path validates here and seals the result with
    secret_box.encrypt, so an account provisioned by the command line is
    stored exactly as one created through the admin API and verifies against
    the same login. decoding is kept separate from encryption because
    encrypting generates the auth secret file when AUTH_SECRET is unset, and
    callers need to reject bad input before anything touches storage.
    """
    try:
        secret = totp.secret_from_base32(value)
    except Exception as exc:
        raise HTTPException(status_code=422, detail="totp_secret is not valid base32") from exc
    if len(secret) < _MIN_TOTP_SECRET_BYTES:
        raise HTTPException(status_code=422, detail="totp_secret is too short")
    return secret


def validate_backup_code_hashes(hashes: Sequence[str] | None) -> list[str]:
    """imported backup codes arrive already hashed; plaintext is refused"""
    for stored in hashes or []:
        if not is_supported_hash(stored):
            raise HTTPException(status_code=422, detail="unsupported backup code hash scheme")
    return list(hashes or [])


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def coded_error(status_code: int, code: str, message: str) -> HTTPException:
    """error carrying a stable machine-readable code alongside its message.

    clients branch on the code; matching on the message text would break the
    moment the wording changes.
    """
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


def apply_to_account(account_id: str, change: Callable[[Account], None]) -> Account:
    """write a change onto the live account record and return it.

    every handler holds a copy read earlier in the request. passing the whole
    copy to update() would rewrite fields nobody touched, reverting an admin
    change that landed in between: a disable in particular. changing the live
    record under the store lock only writes what the handler meant to write.
    """

    def mutate(live: Account) -> Account:
        change(live)
        return live

    try:
        updated = get_account_store().mutate(account_id, mutate)
    except LastAdminError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if updated is None:
        raise HTTPException(status_code=404, detail="account not found")
    return updated


def account_response(account: Account) -> AccountResponse:
    return AccountResponse(
        id=account.id,
        email=account.email,
        is_admin=account.is_admin,
        disabled=account.disabled,
        created_at=account.created_at,
        totp_enabled=account.totp_enabled,
    )


def set_auth_cookie(response: Response, raw_token: str):
    response.set_cookie(
        AUTH_COOKIE_NAME,
        raw_token,
        max_age=int(TOKEN_LIFETIME.total_seconds()),
        httponly=True,
        samesite="lax",
        path="/",
        secure=settings.auth_cookie_secure,
        domain=settings.auth_cookie_domain,
    )


def clear_auth_cookie(response: Response):
    response.delete_cookie(AUTH_COOKIE_NAME, path="/", domain=settings.auth_cookie_domain)
