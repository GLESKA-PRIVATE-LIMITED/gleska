"""Pydantic schemas for worker profiles and related data."""

from pydantic import BaseModel, Field, field_validator, model_validator
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
    address: Optional[str] = None
    pincode: Optional[str] = None
    location_source: Optional[str] = None
    location_updated_at: Optional[datetime] = None
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
    experience_years: Optional[int] = Field(default=None, ge=0)
    expected_daily_wage: Optional[float] = Field(default=None, ge=0)
    availability_status: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    address: Optional[str] = Field(default=None, max_length=500)
    pincode: Optional[str] = Field(default=None, min_length=6, max_length=6)
    latitude: Optional[float] = Field(default=None, ge=-90, le=90)
    longitude: Optional[float] = Field(default=None, ge=-180, le=180)
    location_source: Optional[str] = None

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
    accuracy_m: float = Field(..., gt=0, le=1000)

    @model_validator(mode="after")
    def coordinates_must_not_be_null_island(self) -> "WorkerLocationUpdate":
        if self.latitude == 0 and self.longitude == 0:
            raise ValueError("latitude and longitude cannot both be zero")
        return self


class WorkerCurrentLocationResponse(BaseModel):
    """The latest GPS location saved for a worker."""

    latitude: float
    longitude: float
    accuracy_m: float
    address: Optional[str] = None
    updated_at: datetime


class WorkerRouteOrigin(BaseModel):
    latitude: float
    longitude: float


class WorkerRouteDestination(BaseModel):
    latitude: float
    longitude: float
    name: str


class WorkerRouteSummary(BaseModel):
    distance_meters: int
    distance_km: float
    duration_seconds: int
    duration_minutes: int
    encoded_polyline: str


class WorkerJobRouteResponse(BaseModel):
    job_id: str
    origin: WorkerRouteOrigin
    destination: WorkerRouteDestination
    route: WorkerRouteSummary
