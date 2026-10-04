"""Security data contracts shared by account roles."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class AccountSessionResponse(BaseModel):
    id: str
    device_name: Optional[str] = None
    browser: Optional[str] = None
    os: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    first_seen: datetime
    last_active: datetime
    is_current: bool = False


class AccountSecurityActivityResponse(BaseModel):
    id: str
    event_type: str
    description: Optional[str] = None
    device_name: Optional[str] = None
    browser: Optional[str] = None
    os: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    created_at: datetime


class AccountSecurityResponse(BaseModel):
    sessions: list[AccountSessionResponse]
    activities: list[AccountSecurityActivityResponse]


class AccountSecurityRevokeResponse(BaseModel):
    success: bool
    session_id: str
