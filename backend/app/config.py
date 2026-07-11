from __future__ import annotations

from pathlib import Path
from typing import Optional

from pydantic_settings import BaseSettings

from app.services.tracer_registry import DEFAULT_LOCAL_TRACERS, validate_tracer_ids


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
    log_level: str = "INFO"
    proxy_secret: Optional[str] = None
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


# ensure default user dirs exist
settings.storage_path.mkdir(parents=True, exist_ok=True)
ensure_user_dirs(settings.storage_path / "default")
