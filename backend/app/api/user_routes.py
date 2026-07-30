import logging
import shutil

from fastapi import APIRouter, Depends
from starlette.requests import Request
from starlette.responses import Response

from app.auth import get_user_id
from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter()


@router.delete("/users/me")
async def delete_user_data(request: Request, user_id: str = Depends(get_user_id)):
    """delete all stored data for the authenticated user"""
    from app.api.routes import _project_store_cache, _store_cache, user_lock

    # the user lock blocks store creation for this user until rmtree
    # finishes; closing the evicted stores blocks writes from references
    # already captured by in-flight requests (issue #160)
    with user_lock(user_id):
        stores = _store_cache.pop(user_id, None)
        project_store = _project_store_cache.pop(user_id, None)
        for store in (stores or ()):
            store.close()
        if project_store is not None:
            project_store.close()

        user_path = settings.storage_path / user_id
        if user_path.exists():
            shutil.rmtree(user_path)
            logger.info("deleted storage for user %s", user_id)

    return Response(status_code=204)
