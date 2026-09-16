"""Schemas for conversational employer job creation assistant."""

from uuid import UUID
from decimal import Decimal
from pydantic import BaseModel, Field, field_validator
from typing import Literal


class JobAssistantState(BaseModel):
    """Candidate job requirements accumulated across conversation turns."""

    title: str | None = Field(default=None, max_length=120)
    headcount_required: int | None = Field(default=None, ge=1, le=1000)
    max_daily_salary: float | None = Field(default=None, gt=0, le=1_000_000)
    min_experience: Decimal | None = Field(default=None, ge=0, le=100)
    work_duration_days: int | None = Field(default=None, ge=1, le=365)
    work_duration_months: Decimal | None = Field(default=None, gt=0, le=12)
    work_timing: str | None = Field(default=None, max_length=120)
    required_skills: list[str] = Field(default_factory=list, max_length=50)
    job_site_id: str | None = None
    job_site_name: str | None = None

    @field_validator("title", "work_timing")
    @classmethod
    def normalize_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(value.split())
        return normalized or None

    @field_validator("required_skills")
    @classmethod
    def normalize_skills(cls, values: list[str]) -> list[str]:
        normalized: list[str] = []
        for value in values:
            skill = " ".join(value.split())
            if skill and skill.casefold() not in {item.casefold() for item in normalized}:
                normalized.append(skill)
        return normalized


class JobAssistantMessageRequest(BaseModel):
    """Request payload for a turn in the conversational job creation assistant."""

    message: str = Field(..., min_length=1, max_length=4000)
    language: Literal["EN", "HI", "MR", "TA", "HINGLISH"] = "EN"
    conversation_id: str | None = None
    current_state: JobAssistantState = Field(default_factory=JobAssistantState)
    selected_job_site_id: UUID | None = None

    @field_validator("message")
    @classmethod
    def validate_message(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("message must not be blank")
        return normalized


class JobAssistantResponse(BaseModel):
    """Authoritative response returned by the backend conversational assistant."""

    conversation_id: str
    assistant_message: str
    structured_state: JobAssistantState
    missing_fields: list[str] = Field(default_factory=list)
    validation_errors: list[str] = Field(default_factory=list)
    invalid_fields: list[str] = Field(default_factory=list)
    ready_to_create: bool = False
    confirmation_token: str | None = None


class JobAssistantCreateRequest(BaseModel):
    """One-time server-issued confirmation for creating the reviewed job."""

    conversation_id: str
    confirmation_token: str
