import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.config import settings

logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO))
from app.api.routes import router
from app.api.user_routes import router as user_router

app = FastAPI(title="Tracefinity API", version="0.1.0")


class ProxySecretMiddleware(BaseHTTPMiddleware):
    """reject requests with X-User-Id but wrong/missing proxy secret"""

    async def dispatch(self, request: Request, call_next):
        if not settings.proxy_secret:
            return await call_next(request)
        if request.headers.get("x-user-id"):
            if request.headers.get("x-proxy-secret") != settings.proxy_secret:
                return Response(status_code=403)
        return await call_next(request)


class StorageAuthMiddleware(BaseHTTPMiddleware):
    """block cross-user /storage/ access based on X-User-Id header"""

    async def dispatch(self, request: Request, call_next):
        if request.url.path.startswith("/storage/"):
            user_id = request.headers.get("x-user-id") or "default"
            parts = request.url.path.split("/")
            # path is /storage/{user_id}/...
            if len(parts) >= 3 and parts[2] != user_id:
                return Response(status_code=403)
        return await call_next(request)


# cors for local dev; in production the proxy serves everything same-origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(StorageAuthMiddleware)
app.add_middleware(ProxySecretMiddleware)

app.mount("/storage", StaticFiles(directory=str(settings.storage_path)), name="storage")
app.include_router(router, prefix="/api")
app.include_router(user_router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok"}
