"""Schemas for conversational employer job creation assistant."""

from uuid import UUID
from pydantic import BaseModel, Field, field_validator
from typing import Literal


class JobAssistantState(BaseModel):
    """Candidate job requirements accumulated across conversation turns."""

    title: str | None = None
    headcount_required: int | None = None
    max_daily_salary: float | None = None
    min_experience: int | None = None
    work_duration_days: int | None = None
    work_timing: str | None = None
    required_skills: list[str] = Field(default_factory=list)
    job_site_id: str | None = None
    job_site_name: str | None = None


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
    ready_to_create: bool = False
