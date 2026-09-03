"""Schemas for employer-owned work locations."""

from datetime import datetime
from math import isfinite
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class JobSiteCreate(BaseModel):
    """A work location created by the authenticated employer."""

    name: str = Field(..., min_length=1, max_length=160)
    address: str = Field(..., min_length=1, max_length=500)
    city: str | None = Field(default=None, max_length=160)
    state: str | None = Field(default=None, max_length=160)
    pincode: str | None = Field(default=None, min_length=6, max_length=6)
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    location_source: Literal["PROFILE", "GPS", "SEARCH", "MAP"] = "MAP"

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

    @model_validator(mode="after")
    def coordinates_must_be_finite_and_not_null_island(self) -> "JobSiteCreate":
        if not isfinite(self.latitude) or not isfinite(self.longitude):
            raise ValueError("latitude and longitude must be finite")
        if self.latitude == 0 and self.longitude == 0:
            raise ValueError("latitude and longitude cannot both be zero")
        return self


class JobSiteResponse(BaseModel):
    """An employer-owned work location."""

    id: str
    employer_id: str
    name: str
    address: str | None = None
    city: str | None = None
    state: str | None = None
    pincode: str | None = None
    latitude: float
    longitude: float
    location_source: str | None = None
    created_at: datetime
    updated_at: datetime | None = None