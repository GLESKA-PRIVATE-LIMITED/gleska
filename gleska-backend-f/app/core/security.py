"""Security utilities for authentication and authorization."""

from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import settings
from app.core.supabase import supabase
from app.schemas.auth import UserResponse

security = HTTPBearer(auto_error=False)


def create_access_token(subject: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": subject, "exp": expire, "iat": datetime.now(timezone.utc)}
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except Exception as exc:  # pragma: no cover - security branch
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired session") from exc


async def get_current_user(request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(security)) -> UserResponse:
    bearer_token = credentials.credentials if credentials and credentials.credentials else None
    cookie_token = request.cookies.get("goleska_session")

    if not bearer_token and not cookie_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

    if bearer_token:
        try:
            auth_user = supabase.auth.get_user(bearer_token).user
            user_id = str(auth_user.id)
        except Exception as exc:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired Supabase session") from exc
    else:
        payload = decode_access_token(cookie_token)
        user_id = payload.get("sub")

    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")

    response = supabase.table("users").select("*").eq("id", user_id).single().execute()
    if not response.data:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    user = response.data
    if not user.get("is_active", False):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User inactive")

    return UserResponse(**user)


async def require_worker(user: UserResponse = Depends(get_current_user)) -> UserResponse:
    if user.role != "WORKER":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Worker role required")
    return user


async def require_employer(user: UserResponse = Depends(get_current_user)) -> UserResponse:
    if user.role != "EMPLOYER":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Employer role required")
    return user


async def require_admin(user: UserResponse = Depends(get_current_user)) -> UserResponse:
    if user.role != "ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")
    return user
