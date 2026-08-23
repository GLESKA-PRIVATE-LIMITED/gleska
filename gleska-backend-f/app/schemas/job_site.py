"""Schemas for employer-owned work locations."""

from datetime import datetime

from pydantic import BaseModel, Field


class JobSiteCreate(BaseModel):
    """A work location created by the authenticated employer."""

    name: str = Field(..., min_length=1, max_length=160)
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)


class JobSiteResponse(BaseModel):
    """An employer-owned work location."""

    id: str
    employer_id: str
    name: str
    latitude: float
    longitude: float
    created_at: datetime
    updated_at: datetime | None = None