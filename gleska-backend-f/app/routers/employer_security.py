"""Employer-scoped access to shared session and security activity data."""

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, status

from app.core.security import require_employer
from app.core.supabase import supabase
from app.schemas.account_security import (
    AccountSecurityActivityResponse,
    AccountSecurityResponse,
    AccountSecurityRevokeResponse,
    AccountSessionResponse,
)
from app.schemas.auth import UserResponse

router = APIRouter(prefix="/employers/me/security", tags=["employer-security"])


@router.get("", response_model=AccountSecurityResponse)
async def get_employer_security(
    user: UserResponse = Depends(require_employer),
    session_key: Optional[str] = Header(default=None, alias="X-Goleska-Session-Key"),
):
    if session_key:
        supabase.table("user_sessions").update(
            {"last_active": datetime.now(timezone.utc).isoformat()}
        ).eq("user_id", user.id).eq("session_key", session_key).eq("is_revoked", False).execute()

    sessions_response = (
        supabase.table("user_sessions")
        .select("id, device_name, browser, os, city, country, first_seen, last_active, session_key")
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
        .limit(20)
        .execute()
    )

    sessions = [
        AccountSessionResponse(
            id=str(row["id"]),
            device_name=row.get("device_name"),
            browser=row.get("browser"),
            os=row.get("os"),
            city=row.get("city"),
            country=row.get("country"),
            first_seen=row["first_seen"],
            last_active=row["last_active"],
            is_current=bool(session_key and row.get("session_key") == session_key),
        )
        for row in (sessions_response.data or [])
    ]
    activities = [
        AccountSecurityActivityResponse(**row)
        for row in (activities_response.data or [])
    ]
    return AccountSecurityResponse(sessions=sessions, activities=activities)


@router.post(
    "/sessions/{session_id}/revoke",
    response_model=AccountSecurityRevokeResponse,
)
async def revoke_employer_security_session(
    session_id: UUID,
    user: UserResponse = Depends(require_employer),
):
    response = (
        supabase.rpc("revoke_account_session", {
            "p_user_id": user.id,
            "p_session_id": str(session_id),
        })
        .execute()
    )
    if not response.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="SECURITY_SESSION_NOT_FOUND",
        )

    return AccountSecurityRevokeResponse(success=True, session_id=str(session_id))
