"""Schemas for employer-owned work locations."""

from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class JobSiteCreate(BaseModel):
    """A work location created by the authenticated employer."""

    name: str = Field(..., min_length=1, max_length=160)
    address: str = Field(..., min_length=1, max_length=500)
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)

    @field_validator("name")
    @classmethod
    def name_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("name must not be blank")
        return value

    @field_validator("address")
    @classmethod
    def address_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("address must not be blank")
        return value.strip()


class JobSiteResponse(BaseModel):
    """An employer-owned work location."""

    id: str
    employer_id: str
    name: str
    address: str | None = None
    latitude: float
    longitude: float
    created_at: datetime
    updated_at: datetime | None = None