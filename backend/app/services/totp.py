"""stdlib TOTP (RFC 6238): SHA-1, 6 digits, 30-second step.

verification allows one step either side and refuses any step at or before
the last accepted one, so an intercepted code cannot be replayed.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote

STEP_SECONDS = 30
DIGITS = 6
SECRET_BYTES = 20
_ISSUER = "Tracefinity"


def generate_secret() -> bytes:
    return secrets.token_bytes(SECRET_BYTES)


def secret_to_base32(secret: bytes) -> str:
    return base64.b32encode(secret).decode().rstrip("=")


def secret_from_base32(value: str) -> bytes:
    cleaned = value.strip().replace(" ", "").upper()
    return base64.b32decode(cleaned + "=" * (-len(cleaned) % 8))


def otpauth_uri(secret: bytes, account_name: str) -> str:
    label = f"{quote(_ISSUER)}:{quote(account_name, safe='')}"
    return (
        f"otpauth://totp/{label}"
        f"?secret={secret_to_base32(secret)}&issuer={quote(_ISSUER)}"
        f"&algorithm=SHA1&digits={DIGITS}&period={STEP_SECONDS}"
    )


def code_for_step(secret: bytes, step: int, digits: int = DIGITS) -> str:
    digest = hmac.new(secret, struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(value % 10**digits).zfill(digits)


def current_step(now: float | None = None) -> int:
    return int((time.time() if now is None else now) // STEP_SECONDS)


def verify_code(
    secret: bytes,
    code: str,
    last_accepted_step: int | None,
    now: float | None = None,
) -> int | None:
    """return the accepted step on success, none on failure"""
    cleaned = code.strip().replace(" ", "")
    if len(cleaned) != DIGITS or not cleaned.isdigit():
        return None
    base = current_step(now)
    for step in (base, base - 1, base + 1):
        if last_accepted_step is not None and step <= last_accepted_step:
            continue
        if hmac.compare_digest(code_for_step(secret, step), cleaned):
            return step
    return None
