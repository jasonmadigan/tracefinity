"""secret-at-rest encryption for account second factors.

AES-256-GCM under a key HMAC-derived from AUTH_SECRET. tokens serialise as
enc$v1$<b64 nonce>$<b64 ciphertext>. AUTH_SECRET comes from the environment
when set; otherwise it is generated once into {storage}/auth_secret (0600).
AUTH_SECRET_PREVIOUS lets rotation decrypt old tokens; callers re-encrypt
lazily when decrypt reports it.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.config import settings

AUTH_SECRET_FILENAME = "auth_secret"
_KEY_INFO = b"tracefinity-secret-box-v1"
_PREFIX = "enc$v1$"
_NONCE_BYTES = 12


class DecryptionError(Exception):
    """token cannot be decrypted under the current or previous AUTH_SECRET"""


def get_auth_secret() -> str:
    if settings.auth_secret:
        return settings.auth_secret
    path = settings.storage_path / AUTH_SECRET_FILENAME
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        return path.read_text().strip()
    secret = secrets.token_urlsafe(32)
    try:
        with os.fdopen(fd, "w") as f:
            f.write(secret + "\n")
    except Exception:
        path.unlink(missing_ok=True)
        raise
    return secret


def _derive_key(auth_secret: str) -> bytes:
    return hmac.new(auth_secret.encode(), _KEY_INFO, hashlib.sha256).digest()


def encrypt(plaintext: bytes) -> str:
    nonce = secrets.token_bytes(_NONCE_BYTES)
    ciphertext = AESGCM(_derive_key(get_auth_secret())).encrypt(nonce, plaintext, None)
    return _PREFIX + base64.b64encode(nonce).decode() + "$" + base64.b64encode(ciphertext).decode()


def decrypt(token: str) -> tuple[bytes, bool]:
    """decrypt a stored token; returns (plaintext, needs_reencrypt).

    needs_reencrypt is true when the token only decrypts under
    AUTH_SECRET_PREVIOUS, so the caller should re-encrypt and persist.
    """
    if not token.startswith(_PREFIX):
        raise DecryptionError("unrecognised secret format")
    try:
        nonce_b64, ct_b64 = token[len(_PREFIX):].split("$", 1)
        nonce = base64.b64decode(nonce_b64, validate=True)
        ciphertext = base64.b64decode(ct_b64, validate=True)
    except ValueError as exc:
        raise DecryptionError("malformed secret token") from exc
    try:
        return AESGCM(_derive_key(get_auth_secret())).decrypt(nonce, ciphertext, None), False
    except InvalidTag:
        pass
    previous = settings.auth_secret_previous
    if previous:
        try:
            return AESGCM(_derive_key(previous)).decrypt(nonce, ciphertext, None), True
        except InvalidTag:
            pass
    raise DecryptionError(
        "cannot decrypt stored secret; was AUTH_SECRET changed without AUTH_SECRET_PREVIOUS?"
    )
