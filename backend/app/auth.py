from __future__ import annotations

import hmac
import re
from dataclasses import dataclass
from typing import Optional

from fastapi import HTTPException
from starlette.requests import Request

from app.config import settings
from app.models.accounts import Account

AUTH_COOKIE_NAME = "tracefinity_auth"

# allow cuid (25 alphanumeric) or uuid (36 hex+hyphens); block path traversal
_USER_ID_RE = re.compile(r"^[a-z0-9]{25}$|^[a-f0-9-]{36}$")


def valid_user_id(raw: str) -> bool:
    return bool(_USER_ID_RE.match(raw))


def resolve_account(request: Request) -> Optional[Account]:
    """account for the request's auth cookie, or none. native mode identity."""
    from app.services.account_store import get_account_store
    from app.services.auth_token_store import get_auth_token_store

    raw = request.cookies.get(AUTH_COOKIE_NAME)
    if not raw:
        return None
    account_id = get_auth_token_store().resolve(raw)
    if account_id is None:
        return None
    account = get_account_store().get(account_id)
    if account is None or account.disabled:
        return None
    return account


async def get_user_id(request: Request) -> str:
    """storage namespace for the request, per auth mode.

    native resolves the auth cookie; proxy requires the validated header;
    only open keeps the silent default fallback.
    """
    mode = settings.resolved_auth_mode
    if mode == "native":
        account = resolve_account(request)
        if account is None:
            raise HTTPException(status_code=401, detail="not authenticated")
        return account.storage_namespace
    raw = request.headers.get("x-user-id")
    if not raw:
        if mode == "proxy":
            raise HTTPException(status_code=401, detail="not authenticated")
        return "default"
    if not _USER_ID_RE.match(raw):
        raise HTTPException(status_code=400, detail="invalid user id format")
    return raw


async def get_current_account(request: Request) -> Account:
    if settings.resolved_auth_mode != "native":
        raise HTTPException(status_code=404, detail="native authentication is not enabled")
    account = resolve_account(request)
    if account is None:
        raise HTTPException(status_code=401, detail="not authenticated")
    return account


async def get_admin_account(request: Request) -> Account:
    account = await get_current_account(request)
    if not account.is_admin:
        raise HTTPException(status_code=403, detail="administrator access required")
    return account


@dataclass(frozen=True)
class AdminPrincipal:
    """who is acting on the admin API, and with what.

    token_id is set only when an admin token authenticated the request, so
    every mutation can name the credential rather than just the account.
    """

    account: Account
    token_id: str | None = None

    @property
    def actor(self) -> str:
        if self.token_id:
            return f"{self.account.id} via token {self.token_id}"
        return self.account.id


def _bearer_token(request: Request) -> Optional[str]:
    """the Bearer credential on the request, if it carries one.

    another scheme (a fronting proxy's own basic auth) is ignored rather than
    refused: it grants nothing here, and rejecting it would lock an operator
    out of a session that was working.
    """
    header = request.headers.get("authorization")
    if not header:
        return None
    scheme, _, value = header.partition(" ")
    if scheme.lower() != "bearer":
        return None
    return value.strip() or None


async def get_admin_principal(request: Request) -> AdminPrincipal:
    """administrator for the request: an admin token, else the login cookie.

    a Bearer credential that fails is a refusal, never a fall-through to the
    cookie: an explicitly presented credential decides the request.
    """
    if settings.resolved_auth_mode != "native":
        raise HTTPException(status_code=404, detail="native authentication is not enabled")
    raw = _bearer_token(request)
    if raw is None:
        return AdminPrincipal(account=await get_admin_account(request))

    from app.services.account_store import get_account_store
    from app.services.auth_token_store import get_auth_token_store

    resolved = get_auth_token_store().resolve_admin_token(raw)
    if resolved is None:
        raise HTTPException(status_code=401, detail="not authenticated")
    account_id, token_id = resolved
    account = get_account_store().get(account_id)
    # the token carries no authority its issuer has lost: a disabled or
    # demoted account takes its tokens down with it, checked live so it
    # applies however the account changed
    if account is None or account.disabled or not account.is_admin:
        raise HTTPException(status_code=401, detail="not authenticated")
    return AdminPrincipal(account=account, token_id=token_id)


async def get_admin_session_principal(request: Request) -> AdminPrincipal:
    """administrator from an interactive login only.

    guards what a credential that skips the second factor must not reach. a
    Bearer token here simply is not a login, so the cookie check refuses it.
    """
    return AdminPrincipal(account=await get_admin_account(request))


async def require_instance_admin(request: Request):
    """guard instance-wide administrative reads, per auth mode.

    native identity is cookie-borne and must belong to an admin. proxy and
    open keep the shared-secret header check so existing deployments and
    trusted-network installs are unchanged. a mode with neither an admin
    concept nor a secret configured stays open, like the rest of that mode.
    """
    if settings.resolved_auth_mode == "native":
        await get_admin_account(request)
        return
    secret = settings.proxy_secret
    if not secret:
        return
    supplied = request.headers.get("x-proxy-secret") or ""
    if not hmac.compare_digest(supplied, secret):
        raise HTTPException(status_code=403, detail="administrator access required")
