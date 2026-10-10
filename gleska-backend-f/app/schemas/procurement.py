"""Schemas for Procurement conversations and saved material requests."""

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator


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

ProcurementUnit = Literal[
    "MT", "Bags", "Pieces", "Kg", "Tons", "Meters", "Sq. ft", "Boxes", "Liters"
]
SpecificationMatchPolicy = Literal["REVIEW_DIFFERENCES", "REQUIRE_OVERLAP"]
DeliveryCoveragePolicy = Literal["ALLOW_UNSPECIFIED", "REQUIRE_MATCH"]


class ProcurementModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ProcurementSettings(ProcurementModel):
    default_delivery_location: Annotated[str, StringConstraints(min_length=1, max_length=500)] | None = None
    preferred_units: list[ProcurementUnit] = Field(default_factory=list, max_length=9)
    specification_match_policy: SpecificationMatchPolicy = "REVIEW_DIFFERENCES"
    delivery_coverage_policy: DeliveryCoveragePolicy = "ALLOW_UNSPECIFIED"
    updated_at: datetime | None = None

    @field_validator("default_delivery_location", mode="before")
    @classmethod
    def normalize_default_delivery_location(cls, value):
        if not isinstance(value, str):
            return value
        normalized = " ".join(value.split())
        return normalized or None

    @field_validator("preferred_units")
    @classmethod
    def validate_preferred_units(cls, values: list[ProcurementUnit]) -> list[ProcurementUnit]:
        if len(values) != len(set(values)):
            raise ValueError("Preferred purchasing units must be unique.")
        return values


class ProcurementSettingsUpdate(ProcurementModel):
    default_delivery_location: Annotated[str, StringConstraints(min_length=1, max_length=500)] | None = None
    preferred_units: list[ProcurementUnit] = Field(default_factory=list, max_length=9)
    specification_match_policy: SpecificationMatchPolicy = "REVIEW_DIFFERENCES"
    delivery_coverage_policy: DeliveryCoveragePolicy = "ALLOW_UNSPECIFIED"

    @field_validator("default_delivery_location", mode="before")
    @classmethod
    def normalize_default_delivery_location(cls, value):
        if not isinstance(value, str):
            return value
        normalized = " ".join(value.split())
        return normalized or None

    @field_validator("preferred_units")
    @classmethod
    def validate_preferred_units(cls, values: list[ProcurementUnit]) -> list[ProcurementUnit]:
        if len(values) != len(set(values)):
            raise ValueError("Preferred purchasing units must be unique.")
        return values


class MaterialRequestDraft(ProcurementModel):
    model_config = ConfigDict(extra="ignore")
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
    model_config = ConfigDict(extra="ignore")
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)
    created_at: datetime


class ProcurementConversationCreateResponse(ProcurementModel):
    model_config = ConfigDict(extra="ignore")
    conversation_id: UUID
    status: Literal["ACTIVE", "COMPLETED"]
    history: list[ProcurementConversationMessage]
    draft: MaterialRequestDraft
    confirmed_fields: list[str] = Field(default_factory=list)
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
    model_config = ConfigDict(extra="ignore")
    id: UUID
    origin_conversation_id: UUID | None = None
    title: str | None = None
    item_name: str
    specification: str | None = None
    quantity: Decimal
    unit: str
    required_by: date | None = None
    delivery_location: str | None = None
    additional_requirements: list[str] = Field(default_factory=list)
    notes: str | None = None
    confirmed_fields: list[str] = Field(default_factory=list)
    status: Literal["SAVED"]
    revision: int
    created_at: datetime
    updated_at: datetime


class ProcurementSupplierOfferingMatch(ProcurementModel):
    supplier_company_id: UUID
    supplier_name: str
    offering_id: UUID
    name: str
    specification: str | None = None
    unit: str
    indicative_price: Decimal | None = None
    currency_code: str | None = None
    minimum_order_quantity: Decimal | None = None
    service_coverage: list[str]
    specification_match: Literal[
        "MATCHED", "PARTIAL", "NO_MATCH", "NOT_LISTED", "NOT_REQUESTED"
    ]
    coverage_match: Literal["MATCHED", "NOT_SPECIFIED", "NOT_REQUESTED"]
    minimum_order_compatible: bool | None
    match_reasons: list[str]


class ProcurementSupplierDiscoveryResponse(ProcurementModel):
    request_id: UUID
    item_name: str
    specification: str | None = None
    quantity: Decimal
    unit: str
    delivery_location: str | None = None
    matches: list[ProcurementSupplierOfferingMatch]
    search_limit_reached: bool = False
