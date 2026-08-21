import logging
from posixpath import normpath

from fastapi import FastAPI
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.config import settings
from app.services.store_errors import StoreClosedError

LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"
LOG_DATEFMT = "%H:%M:%S"

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format=LOG_FORMAT,
    datefmt=LOG_DATEFMT,
)

from app.api.routes import router
from app.api.user_routes import router as user_router

# neutral openapi version when the toggle is off, so nothing is disclosed
# (fastapi rejects an empty version string)
app = FastAPI(
    title="Tracefinity API",
    version=settings.app_version if settings.show_app_version else "hidden",
)


@app.exception_handler(StoreClosedError)
async def _store_closed_handler(request: Request, exc: StoreClosedError):
    # an in-flight request lost the race against user deletion; the data
    # it targets is gone for good
    return JSONResponse(status_code=410, content={"detail": "user data deleted"})


@app.exception_handler(RequestValidationError)
async def _validation_handler(request: Request, exc: RequestValidationError):
    # a 422 is otherwise invisible in the access log, which makes a client
    # sending a bad payload impossible to diagnose after the fact. log where
    # it failed and why, never the value itself: payloads carry user data
    where = ", ".join(
        f"{'.'.join(str(p) for p in e.get('loc', ()))}: "
        f"{e.get('type', 'unknown')} ({e.get('msg', 'no message')})"
        for e in exc.errors()
    )
    logging.getLogger("app.validation").warning(
        "422 %s %s -> %s", request.method, request.url.path, where or "no detail"
    )
    return await request_validation_exception_handler(request, exc)


@app.on_event("startup")
def _configure_uvicorn_logging():
    fmt = logging.Formatter(LOG_FORMAT, datefmt=LOG_DATEFMT)
    for name in ("uvicorn", "uvicorn.access", "uvicorn.error"):
        for h in logging.getLogger(name).handlers:
            h.setFormatter(fmt)


class ProxySecretMiddleware(BaseHTTPMiddleware):
    """only trust user-scoped headers from an authenticated proxy."""

    async def dispatch(self, request: Request, call_next):
        if not settings.proxy_secret:
            path = request.url.path
            user_scoped_path = path in ("/api", "/storage") or path.startswith(("/api/", "/storage/"))
            if user_scoped_path and request.headers.get("x-user-id"):
                return Response(status_code=403)
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
            # normalise to collapse ../ traversal before checking ownership
            clean = normpath(request.url.path)
            parts = clean.split("/")
            # path is /storage/{user_id}/...
            if len(parts) >= 3 and parts[2] != user_id:
                return Response(status_code=403)
        return await call_next(request)


# middleware execution order: CORS (outermost) -> ProxySecret -> StorageAuth -> route
# add_middleware prepends, so add in reverse order
app.add_middleware(StorageAuthMiddleware)
app.add_middleware(ProxySecretMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/storage", StaticFiles(directory=str(settings.storage_path)), name="storage")
app.include_router(router, prefix="/api")
app.include_router(user_router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok"}
