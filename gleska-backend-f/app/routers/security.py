"""Authenticated security metadata endpoints."""

from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, status

from app.core.security import require_worker
from app.core.supabase import supabase
from app.schemas.auth import UserResponse
from app.schemas.security import (
    WorkerSecurityActivityResponse,
    WorkerSecurityResponse,
    WorkerSecurityRevokeResponse,
    WorkerSessionResponse,
)

router = APIRouter(prefix="/workers/me/security", tags=["worker-security"])


@router.get("", response_model=WorkerSecurityResponse)
async def get_worker_security(
    user: UserResponse = Depends(require_worker),
    session_key: Optional[str] = Header(default=None, alias="X-Goleska-Session-Key"),
):
    sessions_response = (
        supabase.table("user_sessions")
        .select("id, device_name, browser, os, city, country, first_seen, last_active, is_revoked, revoked_at, session_key")
        .eq("user_id", user.id)
        .eq("is_revoked", False)
        .order("last_active", desc=True)
        .execute()
    )
    activities_response = (
        supabase.table("security_activity")
        .select("id, event_type, description, device_name, browser, os, city, country, created_at")
        .eq("user_id", user.id)
        .order("created_at", desc=True)
        .limit(10)
        .execute()
    )

    sessions = [
        WorkerSessionResponse(
            id=str(row["id"]),
            device_name=row.get("device_name"),
            browser=row.get("browser"),
            os=row.get("os"),
            city=row.get("city"),
            country=row.get("country"),
            first_seen=row["first_seen"],
            last_active=row["last_active"],
            is_revoked=bool(row.get("is_revoked", False)),
            revoked_at=row.get("revoked_at"),
            is_current=bool(session_key and row.get("session_key") == session_key),
        )
        for row in (sessions_response.data or [])
    ]
    activities = [WorkerSecurityActivityResponse(**row) for row in (activities_response.data or [])]
    return WorkerSecurityResponse(sessions=sessions, activities=activities)


@router.post("/sessions/{session_id}/revoke", response_model=WorkerSecurityRevokeResponse)
async def revoke_worker_security_session(
    session_id: str,
    user: UserResponse = Depends(require_worker),
):
    response = (
        supabase.table("user_sessions")
        .update({"is_revoked": True, "revoked_at": "now()"})
        .eq("id", session_id)
        .eq("user_id", user.id)
        .eq("is_revoked", False)
        .execute()
    )
    if not response.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SECURITY_SESSION_NOT_FOUND")

    session = response.data[0]
    supabase.table("security_activity").insert({
        "user_id": user.id,
        "event_type": "session_revoked",
        "description": f"Session revoked: {session.get('device_name') or 'Unknown device'}",
        "device_name": session.get("device_name"),
        "browser": session.get("browser"),
        "os": session.get("os"),
        "city": session.get("city"),
        "country": session.get("country"),
    }).execute()
    return WorkerSecurityRevokeResponse(success=True, session_id=session_id)
