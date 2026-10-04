"""Authenticated, owner-scoped in-app notifications."""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.security import get_current_user
from app.core.supabase import supabase
from app.schemas.auth import UserResponse
from app.schemas.notification import (
    NotificationListResponse,
    NotificationReadResponse,
    NotificationResponse,
)

router = APIRouter(prefix="/notifications", tags=["notifications"])


def _require_account_role(user: UserResponse) -> None:
    if user.role not in {"WORKER", "EMPLOYER"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account notifications are not available for this role",
        )


@router.get("", response_model=NotificationListResponse)
async def list_notifications(
    limit: int = Query(default=50, ge=1, le=100),
    user: UserResponse = Depends(get_current_user),
):
    _require_account_role(user)
    response = (
        supabase.table("notifications")
        .select("id, category, title, message, read_at, entity_type, entity_id, created_at")
        .eq("user_id", user.id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    unread_response = (
        supabase.table("notifications")
        .select("id", count="exact", head=True)
        .eq("user_id", user.id)
        .is_("read_at", "null")
        .execute()
    )
    notifications = [
        NotificationResponse(
            **{**row, "id": str(row["id"]), "entity_id": str(row["entity_id"]) if row.get("entity_id") else None}
        )
        for row in (response.data or [])
    ]
    return NotificationListResponse(
        notifications=notifications,
        unread_count=unread_response.count or 0,
    )


@router.post("/{notification_id}/read", response_model=NotificationReadResponse)
async def mark_notification_read(
    notification_id: UUID,
    user: UserResponse = Depends(get_current_user),
):
    _require_account_role(user)
    response = (
        supabase.table("notifications")
        .update({"read_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", str(notification_id))
        .eq("user_id", user.id)
        .is_("read_at", "null")
        .select("id, category, title, message, read_at, entity_type, entity_id, created_at")
        .execute()
    )
    if response.data:
        row = response.data[0]
    else:
        existing = (
            supabase.table("notifications")
            .select("id, category, title, message, read_at, entity_type, entity_id, created_at")
            .eq("id", str(notification_id))
            .eq("user_id", user.id)
            .maybe_single()
            .execute()
        )
        if not existing.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="NOTIFICATION_NOT_FOUND",
            )
        row = existing.data

    notification = NotificationResponse(
        **{**row, "id": str(row["id"]), "entity_id": str(row["entity_id"]) if row.get("entity_id") else None}
    )
    return NotificationReadResponse(success=True, notification=notification)
