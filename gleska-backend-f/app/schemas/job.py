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
    trade_id: str | None = Field(default=None, min_length=1, max_length=120)
    required_skills: list[str] | None = None

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("title must not be blank")
        return normalized

    @field_validator("trade_id")
    @classmethod
    def normalize_trade_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("trade_id must not be blank")
        return normalized

    @field_validator("required_skills")
    @classmethod
    def normalize_required_skills(cls, values: list[str] | None) -> list[str] | None:
        if values is None:
            return None
        if not isinstance(values, list):
            raise ValueError("required_skills must be a list of strings")
        normalized = []
        for value in values:
            if not isinstance(value, str):
                continue
            skill = value.strip()
            if skill and skill not in normalized:
                normalized.append(skill)
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
    trade_id: str | None = None
    required_skills: list[str] = Field(default_factory=list)
    status: str
    created_at: datetime
    updated_at: datetime | None = None


class JobSiteDetailsResponse(BaseModel):
    id: str
    name: str
    address: str | None = None
    latitude: float
    longitude: float


class JobDetailsResponse(JobResponse):
    job_site: JobSiteDetailsResponse


class JobMatchWorkerResponse(BaseModel):
    worker_profile_id: str
    name: str | None = None
    trade_id: str | None = None
    skills: list[str] = Field(default_factory=list)
    experience_years: int | None = None
    expected_daily_wage: Decimal | None = None
    availability_status: str | None = None
    distance_m: float | None = None
    composite_score: Decimal
    status: str
    created_at: datetime


class JobMatchesResponse(BaseModel):
    matching_status: str
    matches: list[JobMatchWorkerResponse] = Field(default_factory=list)


class JobMatchSummary(BaseModel):
    job_id: str
    current_match_count: int
    matching_status: str


class JobMatchAcceptRequest(BaseModel):
    worker_profile_id: UUID


class JobMatchAcceptResponse(BaseModel):
    match_id: str
    worker_profile_id: str
    match_status: str
    job_status: str
    accepted_count: int