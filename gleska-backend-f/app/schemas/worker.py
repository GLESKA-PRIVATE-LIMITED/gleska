"""Pydantic schemas for worker profiles and related data."""

from pydantic import BaseModel, Field, field_validator
from typing import Optional
from datetime import datetime


class WorkerProfileResponse(BaseModel):
    """Worker profile response."""
    id: str
    user_id: str
    trade_id: Optional[str] = None
    experience_years: Optional[int] = None
    expected_daily_wage: Optional[float] = None
    availability_status: str = "OFFLINE"  # AVAILABLE, ON_JOB, OFFLINE
    city: Optional[str] = None
    state: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    profile_completed: bool = False
    onboarding_status: str = "NOT_STARTED"
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class UpdateWorkerProfileSchema(BaseModel):
    """Schema for updating worker profile."""
    trade_id: Optional[str] = Field(default=None, min_length=1, max_length=120)
    experience_years: Optional[int] = None
    expected_daily_wage: Optional[float] = None
    availability_status: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    profile_completed: Optional[bool] = None

    @field_validator("trade_id")
    @classmethod
    def validate_trade_id(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("trade_id must not be blank")
        return normalized


class WorkerLocationUpdate(BaseModel):
    """A real browser-provided location for the authenticated worker."""

    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
