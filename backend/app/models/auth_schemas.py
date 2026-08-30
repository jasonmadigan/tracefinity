from __future__ import annotations

from pydantic import BaseModel, Field

# an upper bound on a requested lifetime, so a typo cannot mint a
# ten-thousand-year credential that reads as deliberate
MAX_ADMIN_TOKEN_DAYS = 3650


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
    # session only: an admin token is refused rather than downgraded
    is_admin: bool = False
    totp_secret: str | None = None  # base32
    backup_code_hashes: list[str] | None = None
    created_at: str | None = None
    # import only: open the account onto a storage namespace that already
    # holds files, which is otherwise refused because the id names a
    # directory that may be another account's. an administrator session only;
    # an admin token asking for it is refused
    adopt_existing_storage: bool = False


class AdminResetPasswordRequest(BaseModel):
    password: str


class AdminUserListResponse(BaseModel):
    users: list[AccountResponse]


class AdminTokenRequest(BaseModel):
    # free-text note so an operator can tell one credential from another
    label: str = Field(default="", max_length=100)
    # omitted means no expiry; see docs/auth.md for why that is the default
    expires_in_days: int | None = Field(default=None, gt=0, le=MAX_ADMIN_TOKEN_DAYS)


class AdminTokenResponse(BaseModel):
    id: str
    account_id: str
    label: str
    created_at: str
    expires_at: str | None
    last_used_at: str | None


class AdminTokenIssuedResponse(AdminTokenResponse):
    # the raw credential, returned by the issuing call and never again
    token: str


class AdminTokenListResponse(BaseModel):
    tokens: list[AdminTokenResponse]
