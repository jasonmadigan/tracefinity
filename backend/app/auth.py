from __future__ import annotations

from fastapi import Request


async def get_user_id(request: Request) -> str:
    return request.headers.get("x-user-id") or "default"
