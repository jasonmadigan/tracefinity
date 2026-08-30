from __future__ import annotations

from pydantic import BaseModel


class Account(BaseModel):
    id: str
    email: str  # login key, stored lowercased, unique
    password_hash: str
    is_admin: bool = False
    disabled: bool = False
    created_at: str
    # keys stores and storage paths; the first admin claims "default"
    storage_namespace: str
    totp_enabled: bool = False
    # enc$v1$ encrypted; present but disabled while enrolment awaits confirmation
    totp_secret: str | None = None
    # last accepted TOTP step, persisted for replay protection
    totp_last_step: int | None = None
    backup_code_hashes: list[str] = []
