"""Schemas for untrusted natural-language job requirement extraction."""

from uuid import UUID

from pydantic import BaseModel, Field, field_validator


MAX_JOB_PROMPT_LENGTH = 8_000
MAX_TITLE_LENGTH = 120
MAX_DESCRIPTION_LENGTH = 2_000
MAX_HEADCOUNT = 1_000
MAX_EXPERIENCE_YEARS = 100
MAX_DAILY_SALARY = 1_000_000


class JobExtractionRequest(BaseModel):
    """Natural-language input with an optional site for client context."""

    job_site_id: UUID | None = None
    prompt: str = Field(..., min_length=1, max_length=MAX_JOB_PROMPT_LENGTH)

    @field_validator("prompt")
    @classmethod
    def validate_prompt(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("prompt must not be blank")
        return normalized


class JobExtraction(BaseModel):
    """Validated extraction candidate; it is not an authorization decision."""

    title: str = Field(..., min_length=1, max_length=MAX_TITLE_LENGTH)
    headcount_required: int = Field(default=1, ge=1, le=MAX_HEADCOUNT)
    min_experience: int = Field(default=0, ge=0, le=MAX_EXPERIENCE_YEARS)
    max_daily_salary: float | None = Field(default=None, ge=0, le=MAX_DAILY_SALARY)
    description: str | None = Field(default=None, max_length=MAX_DESCRIPTION_LENGTH)
    location: str | None = Field(default=None, max_length=200)
    job_type: str | None = Field(default=None, max_length=80)
    skills: list[str] = Field(default_factory=list, max_length=30)
    gender_requirement: str | None = Field(default=None, max_length=80)
    work_timing: str | None = Field(default=None, max_length=160)
    accommodation_provided: bool | None = None
    food_provided: bool | None = None
    other_requirements: list[str] = Field(default_factory=list, max_length=30)

    @field_validator("title", "description", "location", "job_type", "gender_requirement", "work_timing")
    @classmethod
    def normalize_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(value.split())
        return normalized or None

    @field_validator("skills", "other_requirements")
    @classmethod
    def normalize_lists(cls, values: list[str]) -> list[str]:
        normalized = []
        for value in values:
            item = " ".join(value.split())
            if item and item not in normalized:
                normalized.append(item)
        return normalized

    @field_validator("title")
    @classmethod
    def validate_title(cls, value: str) -> str:
        if not value:
            raise ValueError("title must not be blank")
        return value


class JobExtractionResponse(BaseModel):
    """Extraction result while target job persistence is not yet available."""

    job_created: bool = False
    integration_status: str = "JOB_SERVICE_NOT_IMPLEMENTED"
    parsed_data: JobExtraction
