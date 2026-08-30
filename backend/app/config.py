from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings

from app.services.tracer_registry import DEFAULT_LOCAL_TRACERS, validate_tracer_ids

logger = logging.getLogger(__name__)

# well past offline brute force, and under the 43 characters the generated
# secret carries, so an operator copying that file value still passes
MIN_AUTH_SECRET_LENGTH = 32


class Settings(BaseSettings):
    app_version: str = "dev"
    show_app_version: bool = True
    storage_path: Path = Path("./storage")
    google_api_key: Optional[str] = None
    openrouter_api_key: Optional[str] = None
    openrouter_url: str = "https://openrouter.ai/api/v1/chat/completions"
    openrouter_image_model: str = "google/gemini-3.1-flash-image-preview"
    openrouter_label_model: str = "google/gemini-2.0-flash-001"
    gemini_image_model: str = "gemini-3.1-flash-image-preview"
    gemini_label_model: str = "gemini-2.0-flash"
    max_upload_mb: int = 20
    max_image_pixels: int = Field(default=64_000_000, gt=0)
    stl_generation_concurrency: Optional[int] = Field(default=None, gt=0)
    # hours generated export artefacts are kept; 0 keeps them forever
    stl_retention_hours: float = Field(default=24, ge=0)
    log_level: str = "INFO"
    proxy_secret: Optional[str] = None
    # native (default) / proxy / open; unset with PROXY_SECRET selects proxy
    auth_mode: Optional[str] = None
    auth_secret: Optional[str] = None
    auth_secret_previous: Optional[str] = None
    auth_cookie_secure: bool = False
    auth_cookie_domain: Optional[str] = None
    # first-run web setup; false for deployments that provision accounts
    # out of band, where an open /setup is a way in nobody asked for
    auth_setup_enabled: bool = True
    # opt in to running open or proxy mode with native accounts on disk,
    # which reaches their data without their login. refused by default
    auth_allow_account_data_without_login: bool = False
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:4001"]
    tracers: Optional[str] = None
    replicate_api_token: Optional[str] = None
    fal_key: Optional[str] = None
    replicate_model: str = "men1scus/birefnet"
    fal_model: str = "fal-ai/birefnet/v2"
    replicate_resolution: Optional[str] = None  # "WxH"; None => model default
    fal_operating_resolution: str = "1024x1024"
    tracefinity_onnx_provider: str = "auto"
    tool_label_provider: str = "none"
    tool_label_model: str = "qwen3-vl:4b"
    tool_label_ollama_url: str = "http://localhost:11434"
    tool_label_timeout_seconds: float = 30.0
    tool_label_max_crop_px: int = 512
    photo_stations: bool = False

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "extra": "ignore",
        # empty env vars (e.g. docker run -e SHOW_APP_VERSION=) fall back to defaults
        "env_ignore_empty": True,
    }

    @model_validator(mode="after")
    def _validate_auth_mode(self):
        if self.auth_mode is not None and self.auth_mode not in ("native", "proxy", "open"):
            raise ValueError("AUTH_MODE must be one of: native, proxy, open")
        if self.auth_mode == "proxy" and not self.proxy_secret:
            raise ValueError("AUTH_MODE=proxy requires PROXY_SECRET")
        # an env AUTH_SECRET wins over the strong generated file secret, and
        # the key encrypting every stored 2FA secret derives straight from
        # it, so a short one is brute-forceable offline from users.json.
        # AUTH_SECRET_PREVIOUS is deliberately unchecked: rotating away from
        # a weak secret has to stay possible
        if self.auth_secret is not None and len(self.auth_secret) < MIN_AUTH_SECRET_LENGTH:
            raise ValueError(
                f"AUTH_SECRET must be at least {MIN_AUTH_SECRET_LENGTH} characters; "
                "leave it unset to have a strong one generated into the storage volume"
            )
        # CORS runs with allow_credentials, so a wildcard origin is reflected
        # back with the auth cookie allowed and any site could then call the
        # API as the logged-in user
        if "*" in self.cors_origins and self.resolved_auth_mode == "native":
            raise ValueError(
                "CORS_ORIGINS cannot be '*' under native authentication; "
                "list the real frontend origins"
            )
        return self

    @property
    def resolved_auth_mode(self) -> str:
        """effective auth mode. explicit AUTH_MODE wins; an unset AUTH_MODE
        with PROXY_SECRET keeps existing proxy deployments unchanged."""
        if self.auth_mode:
            return self.auth_mode
        if self.proxy_secret:
            return "proxy"
        return "native"

    @property
    def available_tracers(self) -> list[str]:
        """list of tracer IDs available to users.

        set TRACERS env var to a comma-separated list, e.g. "birefnet-lite,isnet"
        or "gemini,birefnet-lite". if not set, auto-detects: an LLM key picks
        gemini, else a remote token picks that provider, else local models.
        """
        if self.tracers:
            return validate_tracer_ids([t.strip() for t in self.tracers.split(",") if t.strip()])
        if self.google_api_key or self.openrouter_api_key:
            return ["gemini"]
        remote = []
        if self.replicate_api_token:
            remote.append("replicate")
        if self.fal_key:
            remote.append("fal")
        if remote:
            return remote
        return list(DEFAULT_LOCAL_TRACERS)

    @property
    def primary_tracer(self) -> str | None:
        """the primary (first) available tracer id, or none."""
        tracers = self.available_tracers
        return tracers[0] if tracers else None

    @property
    def primary_is_saliency(self) -> bool:
        """true when the primary tracer uses the saliency pipeline (local or
        remote), not the gemini llm path."""
        primary = self.primary_tracer
        return primary is not None and primary != "gemini"


settings = Settings()


def ensure_user_dirs(user_path: Path):
    """create storage subdirs for a user"""
    user_path.mkdir(parents=True, exist_ok=True)
    for sub in ("uploads", "processed", "outputs", "tools", "bins"):
        (user_path / sub).mkdir(exist_ok=True)


class UnsafeAuthModeError(RuntimeError):
    """the configured mode would reach data owned by native accounts"""


def _any_namespace_holds_content() -> bool:
    """true when a storage namespace already holds data.

    every namespace counts, not only `default`: an install upgrading from
    proxy mode keeps its data under caller-supplied ids. a storage root that
    cannot be listed counts as content, because a volume nobody can read may
    hold anything, and guessing the empty answer is the dangerous one.
    """
    from app.services.namespace_tombstones import holds_files

    try:
        with os.scandir(settings.storage_path) as entries:
            namespaces = [Path(e.path) for e in entries if e.is_dir(follow_symlinks=False)]
    except OSError:
        return True
    return any(holds_files(ns) for ns in namespaces)


def validate_auth_startup_state():
    """startup checks that depend on what the storage volume already holds.

    the mode-versus-accounts check is a refusal because the damage is silent
    and immediate. the populated-storage check is a warning because an open
    first run is deliberate for self-hosted installs; an operator who wants
    it closed sets AUTH_SETUP_ENABLED=false.
    """
    from app.services.account_store import get_account_store

    mode = settings.resolved_auth_mode
    accounts = get_account_store().count()

    if accounts and mode in ("open", "proxy"):
        # setup pins the first administrator to the `default` namespace, which
        # is also the namespace open mode serves to anyone. proxy mode is the
        # same trade from the other side: `default` fails the user id format
        # check so that data goes unreachable, while every other account's
        # namespace is selectable by whoever holds the proxy secret
        exposure = (
            "unauthenticated callers would read and delete the first administrator's data"
            if mode == "open"
            else "the first administrator's data becomes unreachable and the remaining "
            "accounts' namespaces become selectable by X-User-Id"
        )
        if not settings.auth_allow_account_data_without_login:
            raise UnsafeAuthModeError(
                f"AUTH_MODE={mode} with {accounts} native account(s) in users.json: "
                f"{exposure}. Keep AUTH_MODE=native, or remove the accounts and their "
                "storage first. Set AUTH_ALLOW_ACCOUNT_DATA_WITHOUT_LOGIN=true only if "
                "that exposure is what you intend."
            )
        logger.warning(
            "AUTH_ALLOW_ACCOUNT_DATA_WITHOUT_LOGIN is set: running AUTH_MODE=%s with "
            "%d native account(s), so %s",
            mode,
            accounts,
            exposure,
        )

    if mode == "native" and not accounts and settings.auth_setup_enabled:
        if _any_namespace_holds_content():
            logger.warning(
                "first-run setup is open on an instance that already holds stored data: "
                "no accounts exist in users.json, but a storage namespace holds files. "
                "the next caller to POST /api/auth/setup becomes the administrator and "
                "inherits that data. if this is not a fresh install, restore users.json "
                "rather than creating a new administrator, or set AUTH_SETUP_ENABLED=false "
                "to close setup."
            )


# ensure default user dirs exist
settings.storage_path.mkdir(parents=True, exist_ok=True)
ensure_user_dirs(settings.storage_path / "default")
