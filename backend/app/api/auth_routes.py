"""native authentication: first-run setup, login, 2FA and account self-service.

terminology: "account", "login", "auth token". never "session", which means
a trace session in this codebase.
"""
from __future__ import annotations

import logging
import secrets
import uuid

from fastapi import APIRouter, Depends, HTTPException
from starlette.requests import Request
from starlette.responses import Response

from app.api.auth_common import (
    account_response,
    apply_to_account,
    clear_auth_cookie,
    coded_error,
    normalise_email,
    now_iso,
    require_native,
    set_auth_cookie,
    validate_new_password,
)
from app.auth import AUTH_COOKIE_NAME, get_current_account, resolve_account
from app.config import ensure_user_dirs, settings
from app.models.accounts import Account
from app.models.auth_schemas import (
    AccountResponse,
    AuthStatusResponse,
    BackupCodesRequest,
    BackupCodesResponse,
    LoginRequest,
    LoginResponse,
    PasswordChangeRequest,
    SetupRequest,
    TwoFactorConfirmRequest,
    TwoFactorDisableRequest,
    TwoFactorEnrollResponse,
    TwoFactorLoginRequest,
)
from app.services import namespace_tombstones, secret_box, totp
from app.services.account_store import get_account_store
from app.services.auth_token_store import get_auth_token_store
from app.services.login_rate_limit import login_limiter
from app.services.namespace_tombstones import NamespaceNotClaimableError
from app.services.password_hashing import (
    dummy_verify,
    hash_password,
    needs_rehash,
    verify_password,
)
from app.services.pending_login import pending_logins

logger = logging.getLogger(__name__)

router = APIRouter()

BACKUP_CODE_COUNT = 10


def _pending_login_invalid() -> HTTPException:
    """the pending token is spent; the client has to start the login over"""
    return coded_error(401, "pending_login_invalid", "invalid or expired login token")


def _rate_limit_guard(email: str):
    if not login_limiter.allowed(email):
        raise HTTPException(status_code=429, detail="too many attempts, try again later")


def _issue_login(response_headers_target: Response, account: Account) -> LoginResponse:
    raw = get_auth_token_store().issue(account.id)
    set_auth_cookie(response_headers_target, raw)
    return LoginResponse(account=account_response(account))


def _generate_backup_codes() -> list[str]:
    codes = []
    for _ in range(BACKUP_CODE_COUNT):
        raw = secrets.token_hex(5)
        codes.append(f"{raw[:5]}-{raw[5:]}")
    return codes


def _decrypt_totp_secret(account: Account) -> bytes:
    old_token = account.totp_secret
    plaintext, reencrypt = secret_box.decrypt(old_token)
    if reencrypt:
        # lazy re-encrypt after AUTH_SECRET rotation; the compare in the
        # mutation means a concurrent login re-encrypting first wins cleanly
        new_token = secret_box.encrypt(plaintext)

        def swap(live: Account) -> Account | None:
            if live.totp_secret != old_token:
                return None
            live.totp_secret = new_token
            return live

        get_account_store().mutate(account.id, swap)
    return plaintext


def _accept_totp_step(account_id: str, step: int) -> bool:
    """atomically record an accepted step; false when a concurrent login
    already redeemed it (replay)"""

    def accept(live: Account) -> Account | None:
        if live.totp_last_step is not None and step <= live.totp_last_step:
            return None
        live.totp_last_step = step
        return live

    return get_account_store().mutate(account_id, accept) is not None


def _consume_backup_code(account_id: str, stored_hash: str) -> bool:
    """atomically spend a backup code; false when already spent"""

    def consume(live: Account) -> Account | None:
        if stored_hash not in live.backup_code_hashes:
            return None
        live.backup_code_hashes = [h for h in live.backup_code_hashes if h != stored_hash]
        return live

    return get_account_store().mutate(account_id, consume) is not None


def _verify_second_factor(account: Account, code: str) -> bool:
    """check a TOTP or backup code, persisting replay and consumption state.

    callers that go on to update the account must refetch it afterwards:
    this function advances store state the caller's copy does not see.
    """
    cleaned = code.strip()
    if account.totp_secret:
        try:
            secret = _decrypt_totp_secret(account)
        except secret_box.DecryptionError:
            logger.error("cannot decrypt TOTP secret for account %s", account.id)
            secret = None
        if secret is not None:
            step = totp.verify_code(secret, cleaned, account.totp_last_step)
            if step is not None:
                return _accept_totp_step(account.id, step)
    for stored in account.backup_code_hashes:
        if verify_password(cleaned, stored):
            return _consume_backup_code(account.id, stored)
    return False


@router.get("/auth/status", response_model=AuthStatusResponse)
def auth_status(request: Request):
    mode = settings.resolved_auth_mode
    return AuthStatusResponse(
        mode=mode,
        # never advertise a setup an operator has closed: a deployment that
        # provisions accounts elsewhere should look like it has no first run
        setup_required=(
            mode == "native"
            and settings.auth_setup_enabled
            and get_account_store().count() == 0
        ),
        authenticated=mode == "native" and resolve_account(request) is not None,
    )


@router.post("/auth/setup", response_model=AccountResponse)
def setup_first_admin(req: SetupRequest, response: Response):
    require_native()
    if not settings.auth_setup_enabled:
        # closed means closed, whatever the account store holds: the way in
        # for these deployments is an account created out of band
        raise HTTPException(status_code=404, detail="first-run setup is disabled")
    email = normalise_email(req.email)
    validate_new_password(req.password)
    account = Account(
        id=str(uuid.uuid4()),
        email=email,
        password_hash=hash_password(req.password),
        is_admin=True,
        created_at=now_iso(),
        # claims any pre-auth data in storage/default/ without moving it
        storage_namespace="default",
    )
    # the claim is what makes a leftover default namespace dangerous, so it is
    # checked before an account is created that would point at it. adopting is
    # the point of this route: it exists to take a single-user install into
    # authenticated use with its library intact, and it only opens on an
    # instance with no accounts. a tombstone still refuses it
    try:
        namespace_tombstones.claim(account.storage_namespace, adopt_existing=True)
    except NamespaceNotClaimableError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not get_account_store().create_first_admin(account):
        raise HTTPException(status_code=409, detail="setup has already been completed")
    ensure_user_dirs(settings.storage_path / account.storage_namespace)
    raw = get_auth_token_store().issue(account.id)
    set_auth_cookie(response, raw)
    return account_response(account)


@router.post("/auth/login", response_model=LoginResponse)
def login(req: LoginRequest, response: Response):
    require_native()
    email = req.email.strip().lower()
    _rate_limit_guard(email)
    account = get_account_store().get_by_email(email)
    if account is None or account.disabled:
        # burn a hash so a missing or disabled account is timing-identical
        # to a wrong password, and never leaks which it was
        dummy_verify()
        login_limiter.record_failure(email)
        raise HTTPException(status_code=401, detail="invalid email or password")
    if not verify_password(req.password, account.password_hash):
        login_limiter.record_failure(email)
        raise HTTPException(status_code=401, detail="invalid email or password")
    if needs_rehash(account.password_hash):
        # imported credential (e.g. bcrypt): move to the native scheme now the
        # plaintext has proven itself. compare on the stored hash so a login
        # that rehashed first wins cleanly instead of writing over it
        stale_hash = account.password_hash
        rehashed = hash_password(req.password)

        def rehash(live: Account) -> Account | None:
            if live.password_hash != stale_hash:
                return None
            live.password_hash = rehashed
            return live

        get_account_store().mutate(account.id, rehash)
    # the copy above was read before the password was verified: re-read so a
    # disable that landed during verification cannot be handed a live token
    account = get_account_store().get(account.id)
    if account is None or account.disabled:
        raise HTTPException(status_code=401, detail="invalid email or password")
    if account.totp_enabled:
        return LoginResponse(pending=True, pending_token=pending_logins.issue(account.id))
    login_limiter.reset(email)
    return _issue_login(response, account)


@router.post("/auth/login/2fa", response_model=LoginResponse)
def login_two_factor(req: TwoFactorLoginRequest, response: Response):
    require_native()
    account_id = pending_logins.begin_attempt(req.pending_token)
    if account_id is None:
        raise _pending_login_invalid()
    account = get_account_store().get(account_id)
    if account is None or account.disabled or not account.totp_enabled:
        pending_logins.redeem(req.pending_token)
        raise _pending_login_invalid()
    _rate_limit_guard(account.email)
    if not _verify_second_factor(account, req.code):
        login_limiter.record_failure(account.email)
        # the pending token survives a wrong code, so the client stays on the
        # code step instead of restarting the login
        raise coded_error(401, "two_factor_code_invalid", "invalid code")
    pending_logins.redeem(req.pending_token)
    login_limiter.reset(account.email)
    # same re-read as the password step: the copy above was read before the
    # code was verified, so a disable that landed during verification must not
    # be handed a live token
    account = get_account_store().get(account_id)
    if account is None or account.disabled:
        raise _pending_login_invalid()
    return _issue_login(response, account)


@router.post("/auth/logout")
def logout(request: Request):
    require_native()
    raw = request.cookies.get(AUTH_COOKIE_NAME)
    if raw:
        get_auth_token_store().revoke(raw)
    response = Response(status_code=204)
    clear_auth_cookie(response)
    return response


@router.get("/auth/me", response_model=AccountResponse)
def me(account: Account = Depends(get_current_account)):
    return account_response(account)


@router.post("/auth/password")
def change_password(
    req: PasswordChangeRequest, request: Request, account: Account = Depends(get_current_account)
):
    if not verify_password(req.current_password, account.password_hash):
        raise HTTPException(status_code=403, detail="current password is incorrect")
    validate_new_password(req.new_password)
    new_hash = hash_password(req.new_password)

    def set_hash(live: Account):
        live.password_hash = new_hash

    apply_to_account(account.id, set_hash)
    # every other device must log in again; this login survives
    get_auth_token_store().revoke_for_account(
        account.id, keep_raw=request.cookies.get(AUTH_COOKIE_NAME)
    )
    return Response(status_code=204)


@router.post("/auth/2fa/enroll", response_model=TwoFactorEnrollResponse)
def enroll_two_factor(account: Account = Depends(get_current_account)):
    if account.totp_enabled:
        raise HTTPException(status_code=409, detail="2FA is already enabled")
    secret = totp.generate_secret()
    enrolling = secret_box.encrypt(secret)

    def start_enrolment(live: Account):
        live.totp_secret = enrolling
        live.totp_last_step = None

    apply_to_account(account.id, start_enrolment)
    return TwoFactorEnrollResponse(
        secret=totp.secret_to_base32(secret),
        otpauth_uri=totp.otpauth_uri(secret, account.email),
    )


@router.post("/auth/2fa/confirm", response_model=BackupCodesResponse)
def confirm_two_factor(
    req: TwoFactorConfirmRequest, account: Account = Depends(get_current_account)
):
    if account.totp_enabled:
        raise HTTPException(status_code=409, detail="2FA is already enabled")
    if not account.totp_secret:
        raise HTTPException(status_code=400, detail="no enrolment in progress")
    try:
        secret = _decrypt_totp_secret(account)
    except secret_box.DecryptionError as exc:
        raise HTTPException(status_code=500, detail="stored secret cannot be decrypted") from exc
    # a first valid code proves the authenticator before 2FA turns on
    step = totp.verify_code(secret, req.code, None)
    if step is None:
        raise HTTPException(status_code=400, detail="invalid code")
    codes = _generate_backup_codes()
    hashes = [hash_password(c) for c in codes]

    def enable(live: Account):
        live.totp_enabled = True
        live.totp_last_step = step
        live.backup_code_hashes = hashes

    apply_to_account(account.id, enable)
    return BackupCodesResponse(backup_codes=codes)


@router.post("/auth/2fa/disable")
def disable_two_factor(
    req: TwoFactorDisableRequest, account: Account = Depends(get_current_account)
):
    if not account.totp_enabled:
        raise HTTPException(status_code=400, detail="2FA is not enabled")
    _rate_limit_guard(account.email)
    if not verify_password(req.password, account.password_hash):
        login_limiter.record_failure(account.email)
        raise HTTPException(status_code=403, detail="password is incorrect")
    if not _verify_second_factor(account, req.code):
        login_limiter.record_failure(account.email)
        raise HTTPException(status_code=403, detail="invalid code")
    def clear(live: Account):
        live.totp_enabled = False
        live.totp_secret = None
        live.totp_last_step = None
        live.backup_code_hashes = []

    apply_to_account(account.id, clear)
    return Response(status_code=204)


@router.post("/auth/2fa/backup-codes", response_model=BackupCodesResponse)
def regenerate_backup_codes(
    req: BackupCodesRequest, account: Account = Depends(get_current_account)
):
    if not account.totp_enabled:
        raise HTTPException(status_code=400, detail="2FA is not enabled")
    _rate_limit_guard(account.email)
    if not verify_password(req.password, account.password_hash):
        login_limiter.record_failure(account.email)
        raise HTTPException(status_code=403, detail="password is incorrect")
    if not _verify_second_factor(account, req.code):
        login_limiter.record_failure(account.email)
        raise HTTPException(status_code=403, detail="invalid code")
    codes = _generate_backup_codes()
    hashes = [hash_password(c) for c in codes]

    # the second-factor check already advanced replay state in the store, so
    # only the codes themselves may be written back
    def replace_codes(live: Account):
        live.backup_code_hashes = hashes

    apply_to_account(account.id, replace_codes)
    return BackupCodesResponse(backup_codes=codes)
