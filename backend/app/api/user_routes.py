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
    user_path = settings.storage_path / user_id
    if user_path.exists():
        shutil.rmtree(user_path)
        logger.info("deleted storage for user %s", user_id)

    # evict from store cache
    from app.api.routes import _store_cache
    _store_cache.pop(user_id, None)

    return Response(status_code=204)
