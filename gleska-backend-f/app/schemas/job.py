"""Schemas for employer job creation."""

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


MAX_JOB_TITLE_LENGTH = 120
MAX_HEADCOUNT = 1_000
MAX_EXPERIENCE_YEARS = 100
MAX_DAILY_SALARY = Decimal("1000000")


class JobCreate(BaseModel):
    """Validated job fields supplied by an authenticated employer."""

    job_site_id: UUID
    title: str = Field(..., min_length=1, max_length=MAX_JOB_TITLE_LENGTH)
    headcount_required: int = Field(..., ge=1, le=MAX_HEADCOUNT)
    max_daily_salary: Decimal | None = Field(default=None, ge=0, le=MAX_DAILY_SALARY)
    min_experience: int | None = Field(default=None, ge=0, le=MAX_EXPERIENCE_YEARS)

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("title must not be blank")
        return normalized


class JobResponse(BaseModel):
    """Persisted job returned by the target API."""

    id: str
    employer_id: str
    job_site_id: str
    title: str
    headcount_required: int
    max_daily_salary: Decimal | None = None
    min_experience: int | None = None
    status: str
    created_at: datetime
    updated_at: datetime | None = None