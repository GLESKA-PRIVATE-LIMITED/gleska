"""Employer-scoped access to shared session and security activity data."""

import base64
import binascii
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status

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
SECURITY_ACTIVITY_PAGE_SIZE = 100


def _decode_activity_cursor(cursor: str) -> tuple[datetime, UUID]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        decoded = base64.b64decode(padded, altchars=b"-_", validate=True).decode("utf-8")
        created_at_text, activity_id_text = decoded.split("\n", 1)
        created_at = datetime.fromisoformat(created_at_text)
        activity_id = UUID(activity_id_text)
        if created_at.tzinfo is None:
            raise ValueError("Activity cursor timestamp must include a timezone")
        return created_at, activity_id
    except (binascii.Error, UnicodeDecodeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="SECURITY_ACTIVITY_CURSOR_INVALID",
        ) from exc


def _encode_activity_cursor(row: dict) -> str:
    value = f"{row['created_at']}\n{row['id']}".encode("utf-8")
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


@router.get("", response_model=AccountSecurityResponse)
async def get_employer_security(
    user: UserResponse = Depends(require_employer),
    session_key: Optional[str] = Header(default=None, alias="X-Goleska-Session-Key"),
    limit: int = Query(default=20, ge=1, le=SECURITY_ACTIVITY_PAGE_SIZE),
    cursor: Optional[str] = Query(default=None, max_length=256),
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
    activity_query = (
        supabase.table("security_activity")
        .select(
            "id, event_type, description, device_name, browser, os, city, country, created_at",
            count="exact" if cursor is None else None,
        )
        .eq("user_id", user.id)
        .order("created_at", desc=True)
        .order("id", desc=True)
    )
    if cursor:
        cursor_created_at, cursor_id = _decode_activity_cursor(cursor)
        cursor_timestamp = cursor_created_at.isoformat()
        activity_query = activity_query.or_(
            f"created_at.lt.{cursor_timestamp},and(created_at.eq.{cursor_timestamp},id.lt.{cursor_id})"
        )
    activities_response = activity_query.limit(limit + 1).execute()
    activity_rows = activities_response.data or []
    has_more = len(activity_rows) > limit
    activity_rows = activity_rows[:limit]

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
        for row in activity_rows
    ]
    next_cursor = _encode_activity_cursor(activity_rows[-1]) if has_more and activity_rows else None
    return AccountSecurityResponse(
        sessions=sessions,
        activities=activities,
        activity_count=getattr(activities_response, "count", None) if cursor is None else None,
        next_cursor=next_cursor,
    )


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
