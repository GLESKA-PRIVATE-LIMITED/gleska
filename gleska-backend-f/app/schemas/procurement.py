"""Schemas for Procurement conversations and saved material requests."""

from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


PROCUREMENT_DRAFT_FIELDS = (
    "title",
    "item_name",
    "specification",
    "quantity",
    "unit",
    "required_by",
    "delivery_location",
    "additional_requirements",
    "notes",
)


class ProcurementModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MaterialRequestDraft(ProcurementModel):
    title: str | None = Field(default=None, max_length=160)
    item_name: str | None = Field(default=None, max_length=240)
    specification: str | None = Field(default=None, max_length=2000)
    quantity: Decimal | None = Field(default=None, gt=0, le=1_000_000_000)
    unit: str | None = Field(default=None, max_length=48)
    required_by: date | None = None
    delivery_location: str | None = Field(default=None, max_length=500)
    additional_requirements: list[str] = Field(default_factory=list, max_length=50)
    notes: str | None = Field(default=None, max_length=4000)

    @field_validator(
        "title",
        "item_name",
        "specification",
        "unit",
        "delivery_location",
        "notes",
    )
    @classmethod
    def normalize_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(value.split())
        return normalized or None

    @field_validator("additional_requirements")
    @classmethod
    def normalize_requirements(cls, values: list[str]) -> list[str]:
        normalized: list[str] = []
        for value in values:
            requirement = " ".join(value.split())
            if requirement and requirement.casefold() not in {
                existing.casefold() for existing in normalized
            }:
                normalized.append(requirement)
        return normalized


class ProcurementConversationMessage(ProcurementModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)
    created_at: datetime


class ProcurementConversationCreateResponse(ProcurementModel):
    conversation_id: UUID
    status: Literal["ACTIVE", "COMPLETED"]
    history: list[ProcurementConversationMessage]
    draft: MaterialRequestDraft
    confirmed_fields: list[str]
    revision: int
    created_at: datetime
    updated_at: datetime


class ProcurementConversationMessageRequest(ProcurementModel):
    message: str = Field(min_length=1, max_length=4000)
    expected_revision: int = Field(ge=0)

    @field_validator("message")
    @classmethod
    def validate_message(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("message must not be blank")
        return normalized


class ProcurementDraftUpdateRequest(ProcurementModel):
    draft: MaterialRequestDraft
    confirmed_fields: list[str] = Field(default_factory=list)
    expected_revision: int = Field(ge=0)

    @field_validator("confirmed_fields")
    @classmethod
    def validate_confirmed_fields(cls, values: list[str]) -> list[str]:
        unknown = sorted(set(values) - set(PROCUREMENT_DRAFT_FIELDS))
        if unknown:
            raise ValueError("Unknown confirmed draft field")
        return list(dict.fromkeys(values))

    @model_validator(mode="after")
    def confirmed_values_must_exist(self):
        values = self.draft.model_dump(mode="python")
        for field_name in self.confirmed_fields:
            value = values[field_name]
            if value is None or value == []:
                raise ValueError(f"Cannot confirm empty field: {field_name}")
        return self


class ProcurementSaveRequest(ProcurementModel):
    idempotency_key: UUID
    expected_revision: int = Field(ge=0)


class ProcurementMaterialRequestPatch(ProcurementModel):
    title: str | None = Field(default=None, max_length=160)
    item_name: str | None = Field(default=None, max_length=240)
    specification: str | None = Field(default=None, max_length=2000)
    quantity: Decimal | None = Field(default=None, gt=0, le=1_000_000_000)
    unit: str | None = Field(default=None, max_length=48)
    required_by: date | None = None
    delivery_location: str | None = Field(default=None, max_length=500)
    additional_requirements: list[str] | None = Field(default=None, max_length=50)
    notes: str | None = Field(default=None, max_length=4000)
    expected_revision: int = Field(ge=0)

    @field_validator(
        "title",
        "item_name",
        "specification",
        "unit",
        "delivery_location",
        "notes",
    )
    @classmethod
    def normalize_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(value.split())
        return normalized or None

    @field_validator("additional_requirements")
    @classmethod
    def normalize_requirements(cls, values: list[str] | None) -> list[str] | None:
        if values is None:
            return None
        return MaterialRequestDraft.normalize_requirements(values)

    @model_validator(mode="after")
    def require_at_least_one_change(self):
        if not (set(self.model_fields_set) - {"expected_revision"}):
            raise ValueError("At least one material request field must be provided")
        return self


class ProcurementMaterialRequestResponse(ProcurementModel):
    id: UUID
    origin_conversation_id: UUID | None = None
    title: str | None = None
    item_name: str
    specification: str | None = None
    quantity: Decimal
    unit: str
    required_by: date | None = None
    delivery_location: str | None = None
    additional_requirements: list[str]
    notes: str | None = None
    confirmed_fields: list[str]
    status: Literal["SAVED"]
    revision: int
    created_at: datetime
    updated_at: datetime
