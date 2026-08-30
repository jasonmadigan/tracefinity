from __future__ import annotations

from pydantic import BaseModel


class AuthStatusResponse(BaseModel):
    mode: str
    setup_required: bool
    authenticated: bool


class AccountResponse(BaseModel):
    id: str
    email: str
    is_admin: bool
    disabled: bool
    created_at: str
    totp_enabled: bool


class SetupRequest(BaseModel):
    email: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    # pending=true means 2FA: redeem pending_token at /auth/login/2fa
    pending: bool = False
    pending_token: str | None = None
    account: AccountResponse | None = None


class TwoFactorLoginRequest(BaseModel):
    pending_token: str
    code: str


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str


class TwoFactorEnrollResponse(BaseModel):
    secret: str  # base32, shown once during enrolment
    otpauth_uri: str


class TwoFactorConfirmRequest(BaseModel):
    code: str


class BackupCodesResponse(BaseModel):
    backup_codes: list[str]  # plaintext, shown once


class TwoFactorDisableRequest(BaseModel):
    password: str
    code: str


class BackupCodesRequest(BaseModel):
    password: str
    code: str


class AdminCreateUserRequest(BaseModel):
    email: str
    password: str | None = None
    # import path: verify-as-is bcrypt ($2a/$2b/$2y) or native $scrypt$
    password_hash: str | None = None
    id: str | None = None
    is_admin: bool = False
    totp_secret: str | None = None  # base32
    backup_code_hashes: list[str] | None = None
    created_at: str | None = None


class AdminResetPasswordRequest(BaseModel):
    password: str


class AdminUserListResponse(BaseModel):
    users: list[AccountResponse]
