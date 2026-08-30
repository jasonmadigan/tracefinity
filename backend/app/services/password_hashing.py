"""scheme-prefixed password hashing.

native hashes use stdlib scrypt serialised as
$scrypt$n=<n>,r=<r>,p=<p>$<b64 salt>$<b64 key> so the scheme can evolve
without a data migration. bcrypt ($2a/$2b/$2y) is verify-only for imported
credentials; callers rehash to scrypt on first successful login.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets

import bcrypt

SCRYPT_N = 2**14
SCRYPT_R = 8
SCRYPT_P = 1
_SALT_BYTES = 16
_KEY_BYTES = 32

_BCRYPT_PREFIXES = ("$2a$", "$2b$", "$2y$")
_NATIVE_PREFIX = f"$scrypt$n={SCRYPT_N},r={SCRYPT_R},p={SCRYPT_P}$"


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(_SALT_BYTES)
    key = hashlib.scrypt(
        password.encode(), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=_KEY_BYTES
    )
    return (
        f"{_NATIVE_PREFIX}"
        f"{base64.b64encode(salt).decode()}${base64.b64encode(key).decode()}"
    )


def _parse_scrypt(stored: str) -> tuple[int, int, int, bytes, bytes] | None:
    parts = stored.split("$")
    if len(parts) != 5 or parts[0] != "" or parts[1] != "scrypt":
        return None
    try:
        opts = dict(kv.split("=", 1) for kv in parts[2].split(","))
        n, r, p = int(opts["n"]), int(opts["r"]), int(opts["p"])
        salt = base64.b64decode(parts[3], validate=True)
        key = base64.b64decode(parts[4], validate=True)
    except (ValueError, KeyError):
        return None
    # only well-known key lengths: a truncated stored hash must fail, not
    # silently verify at reduced strength
    if n < 2 or (n & (n - 1)) or r < 1 or p < 1 or not salt or len(key) not in (32, 64):
        return None
    return n, r, p, salt, key


def verify_password(password: str, stored: str) -> bool:
    if stored.startswith("$scrypt$"):
        parsed = _parse_scrypt(stored)
        if parsed is None:
            return False
        n, r, p, salt, expected = parsed
        key = hashlib.scrypt(password.encode(), salt=salt, n=n, r=r, p=p, dklen=len(expected))
        return hmac.compare_digest(key, expected)
    if stored.startswith(_BCRYPT_PREFIXES):
        try:
            return bcrypt.checkpw(password.encode(), stored.encode())
        except ValueError:
            return False
    return False


def needs_rehash(stored: str) -> bool:
    """true when the stored hash is not the current native scheme and parameters"""
    return not stored.startswith(_NATIVE_PREFIX)


def is_supported_hash(stored: str) -> bool:
    """true for hashes verify_password can check; used to validate imports up front"""
    if stored.startswith(_BCRYPT_PREFIXES):
        return len(stored) == 60
    if stored.startswith("$scrypt$"):
        return _parse_scrypt(stored) is not None
    return False


def dummy_verify():
    """burn one scrypt evaluation so a missing account costs the same as a
    wrong password, keeping login timing from confirming which emails exist"""
    salt = b"\x00" * _SALT_BYTES
    hashlib.scrypt(b"invalid", salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=_KEY_BYTES)
