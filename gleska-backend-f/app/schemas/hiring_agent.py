from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class HiringAgentJobDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, max_length=120)
    headcount_required: int | None = Field(default=None, ge=1, le=1000)
    max_daily_salary: float | None = Field(default=None, gt=0, le=1_000_000)
    min_experience: float | None = Field(default=None, ge=0, le=100)
    work_duration_days: int | None = Field(default=None, ge=1, le=365)
    work_timing: str | None = Field(default=None, max_length=120)
    trade_id: str | None = Field(default=None, max_length=120)
    required_skills: list[str] = Field(default_factory=list, max_length=50)

    @field_validator("title", "work_timing", "trade_id")
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


class HiringAgentMessageRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    conversation_id: UUID | None = None
    job_id: UUID | None = None
    selected_job_site_id: UUID | None = None
    state_revision: int | None = Field(default=None, ge=0)

    @field_validator("message")
    @classmethod
    def validate_message(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("message must not be blank")
        return normalized


class HiringAgentCreateRequest(BaseModel):
    conversation_id: UUID
    state_revision: int = Field(ge=0)
    confirmation_token: str = Field(min_length=1)


class HiringAgentHistoryMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str
    created_at: str | None = None


class HiringAgentCandidate(BaseModel):
    candidate_ref: str
    name: str | None = None
    trade: str | None = None
    skills: list[str] = Field(default_factory=list)
    experience_years: int | None = None
    expected_daily_wage: float | None = None
    availability_status: str | None = None
    projected_distance_m: float | None = None
    verified_evidence: list[str] = Field(default_factory=list)
    unavailable_fields: list[str] = Field(default_factory=list)


class HiringAgentResponse(BaseModel):
    conversation_id: str
    job_id: str | None = None
    assistant_message: str
    state_revision: int
    history: list[HiringAgentHistoryMessage] = Field(default_factory=list)
    candidate_results: list[HiringAgentCandidate] = Field(default_factory=list)
    candidate_result_status: Literal["FOUND", "NO_MATCHES", "NOT_RETRIEVED", "FAILED"]
    candidate_result_note: str | None = None
    candidate_retrieved_at: str | None = None
    job_draft: HiringAgentJobDraft = Field(default_factory=HiringAgentJobDraft)
    job_site_id: str | None = None
    job_site_name: str | None = None
    job_confirmation_token: str | None = None
    created_job_id: str | None = None


class HiringAgentConversationResponse(BaseModel):
    conversation_id: str
    job_id: str | None = None
    state_revision: int
    history: list[HiringAgentHistoryMessage] = Field(default_factory=list)
    candidate_results: list[HiringAgentCandidate] = Field(default_factory=list)
    candidate_result_status: Literal["FOUND", "NO_MATCHES", "NOT_RETRIEVED", "FAILED"]
    candidate_result_note: str | None = None
    candidate_retrieved_at: str | None = None
    job_draft: HiringAgentJobDraft = Field(default_factory=HiringAgentJobDraft)
    job_site_id: str | None = None
    job_site_name: str | None = None
    job_confirmation_token: str | None = None
    created_job_id: str | None = None
