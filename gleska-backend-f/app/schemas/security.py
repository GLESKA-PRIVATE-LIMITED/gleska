"""Safe security session and activity response schemas."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class WorkerSessionResponse(BaseModel):
    id: str
    device_name: Optional[str] = None
    browser: Optional[str] = None
    os: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    first_seen: datetime
    last_active: datetime
    is_revoked: bool
    revoked_at: Optional[datetime] = None
    is_current: bool = False


class WorkerSecurityActivityResponse(BaseModel):
    id: str
    event_type: str
    description: Optional[str] = None
    device_name: Optional[str] = None
    browser: Optional[str] = None
    os: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    created_at: datetime


class WorkerSecurityResponse(BaseModel):
    sessions: list[WorkerSessionResponse]
    activities: list[WorkerSecurityActivityResponse]


class WorkerSecurityRevokeResponse(BaseModel):
    success: bool
    session_id: str
