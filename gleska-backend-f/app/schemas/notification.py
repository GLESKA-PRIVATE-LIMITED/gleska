"""In-app notification API contracts."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


NotificationCategory = Literal["job_matching", "attendance", "security"]


class NotificationResponse(BaseModel):
    id: str
    category: NotificationCategory
    title: str
    message: str
    read_at: datetime | None = None
    entity_type: str | None = None
    entity_id: str | None = None
    created_at: datetime


class NotificationListResponse(BaseModel):
    notifications: list[NotificationResponse]
    unread_count: int


class NotificationReadResponse(BaseModel):
    success: bool
    notification: NotificationResponse
