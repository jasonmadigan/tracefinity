import logging
import shutil

from fastapi import APIRouter, Depends, HTTPException
from starlette.requests import Request
from starlette.responses import Response

from app.auth import get_user_id
from app.config import settings
from app.services import namespace_tombstones

logger = logging.getLogger(__name__)

router = APIRouter()


def _delete_native_account(request: Request) -> bool:
    """drop the caller's account record and tokens; false when there is none.

    runs before any data is destroyed so the last-administrator guard can
    still refuse the whole request.
    """
    from app.auth import resolve_account
    from app.services.account_store import LastAdminError, get_account_store
    from app.services.auth_token_store import get_auth_token_store

    account = resolve_account(request)
    if account is None:
        return False
    try:
        get_account_store().delete(account.id)
    except LastAdminError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    # everything, admin tokens included: the account is gone, so nothing
    # issued under it may outlive it
    get_auth_token_store().revoke_all_for_account(account.id)
    logger.info("deleted account %s", account.id)
    return True


@router.delete("/users/me")
def delete_user_data(request: Request, user_id: str = Depends(get_user_id)):
    """delete all stored data for the authenticated user.

    sync on purpose: fastapi runs it in the threadpool, so the user lock,
    store locks and rmtree cannot stall the event loop under contention
    """
    from app.api.routes import (
        _photo_station_store_cache,
        _project_store_cache,
        _store_cache,
        user_lock,
    )

    native = settings.resolved_auth_mode == "native"
    # marked before anything is destroyed: the account record goes first, so
    # only a marker that outlives the process can stop a namespace whose files
    # survived their owner being claimed by the next account
    namespace_tombstones.mark(user_id)
    if native:
        # native deletion is total: the account record and its auth tokens go
        # with the stored data, and the browser's cookie is cleared
        try:
            _delete_native_account(request)
        except Exception:
            # nothing is destroyed yet, so the namespace still has its owner
            namespace_tombstones.clear(user_id)
            raise

    # the user lock blocks store creation for this user until rmtree
    # finishes; closing the evicted stores blocks writes from references
    # already captured by in-flight requests (issue #160)
    with user_lock(user_id):
        stores = _store_cache.pop(user_id, None)
        project_store = _project_store_cache.pop(user_id, None)
        photo_station_store = _photo_station_store_cache.pop(user_id, None)
        for store in (stores or ()):
            store.close()
        if project_store is not None:
            project_store.close()
        if photo_station_store is not None:
            photo_station_store.close()

        user_path = settings.storage_path / user_id
        if user_path.exists():
            shutil.rmtree(user_path)
            logger.info("deleted storage for user %s", user_id)

    # only now: a failed rmtree leaves the marker in place on purpose
    namespace_tombstones.clear(user_id)

    response = Response(status_code=204)
    if native:
        from app.api.auth_common import clear_auth_cookie

        clear_auth_cookie(response)
    return response
