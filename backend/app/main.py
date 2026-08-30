import asyncio
import hmac
import logging
from posixpath import normpath
from urllib.parse import unquote

from fastapi import FastAPI
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.config import settings
from app.services.output_retention import retention_loop
from app.services.store_errors import StoreClosedError

LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"
LOG_DATEFMT = "%H:%M:%S"

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format=LOG_FORMAT,
    datefmt=LOG_DATEFMT,
)

from app.api.admin_routes import router as admin_router
from app.api.auth_routes import router as auth_router
from app.api.routes import router
from app.api.user_routes import router as user_router
from app.auth import resolve_account

# neutral openapi version when the toggle is off, so nothing is disclosed
# (fastapi rejects an empty version string)
# the generated schema and its viewers stay off: they publish every route,
# admin included, and nothing here consumes them. openapi_url=None alone also
# drops /docs, /redoc and /docs/oauth2-redirect, but naming all three keeps
# them gone if that coupling ever changes upstream
app = FastAPI(
    title="Tracefinity API",
    version=settings.app_version if settings.show_app_version else "hidden",
    openapi_url=None,
    docs_url=None,
    redoc_url=None,
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


@app.on_event("startup")
def _validate_auth_startup_state():
    # the transition states, checked against the volume rather than the
    # config alone: a mode that would reach account-owned data is refused,
    # an open first run on populated storage is warned about
    from app.config import validate_auth_startup_state

    validate_auth_startup_state()


@app.on_event("startup")
def _ensure_auth_secret():
    # native mode encrypts second factors at rest; generate the key material
    # up front so the first enrolment cannot fail on a read-only surprise
    if settings.resolved_auth_mode == "native":
        from app.services.secret_box import get_auth_secret

        get_auth_secret()


@app.on_event("startup")
async def _start_output_retention():
    if settings.stl_retention_hours > 0:
        # reference kept on app.state so the task is not garbage collected
        app.state.output_retention_task = asyncio.create_task(
            retention_loop(settings.storage_path, settings.stl_retention_hours)
        )


class ProxySecretMiddleware(BaseHTTPMiddleware):
    """only trust user-scoped headers from an authenticated proxy."""

    async def dispatch(self, request: Request, call_next):
        # headers only ever carry identity in proxy and open modes; native
        # identity is cookie-borne, so a header there is always forged
        trusted_secret = (
            settings.proxy_secret if settings.resolved_auth_mode in ("proxy", "open") else None
        )
        if not trusted_secret:
            path = request.url.path
            user_scoped_path = path in ("/api", "/storage") or path.startswith(("/api/", "/storage/"))
            if user_scoped_path and request.headers.get("x-user-id"):
                return Response(status_code=403)
            return await call_next(request)
        if request.headers.get("x-user-id"):
            supplied = request.headers.get("x-proxy-secret") or ""
            if not hmac.compare_digest(supplied, trusted_secret):
                return Response(status_code=403)
        return await call_next(request)


def _storage_path_owner_ok(path: str, user_id: str) -> bool:
    # decode until stable so percent- and double-encoded ../ cannot smuggle
    # traversal past the segment check, then collapse and compare
    decoded = path
    for _ in range(3):
        expanded = unquote(decoded)
        if expanded == decoded:
            break
        decoded = expanded
    clean = normpath(decoded)
    parts = clean.split("/")
    # path is /storage/{user_id}/...
    return len(parts) >= 3 and parts[1] == "storage" and parts[2] == user_id and ".." not in parts


class StorageAuthMiddleware(BaseHTTPMiddleware):
    """block cross-user /storage/ access; identity resolved per auth mode"""

    async def dispatch(self, request: Request, call_next):
        if request.url.path.startswith("/storage/"):
            mode = settings.resolved_auth_mode
            if mode == "native":
                account = resolve_account(request)
                if account is None:
                    return Response(status_code=401)
                user_id = account.storage_namespace
            elif mode == "proxy":
                user_id = request.headers.get("x-user-id")
                if not user_id:
                    return Response(status_code=401)
            else:
                user_id = request.headers.get("x-user-id") or "default"
            if not _storage_path_owner_ok(request.url.path, user_id):
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
    # frontend blob downloads read the server-set filename cross-origin in dev
    expose_headers=["Content-Disposition"],
)

app.mount("/storage", StaticFiles(directory=str(settings.storage_path)), name="storage")
app.include_router(router, prefix="/api")
app.include_router(user_router, prefix="/api")
app.include_router(auth_router, prefix="/api")
app.include_router(admin_router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok"}
