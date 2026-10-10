"""Schemas for persistent Procurement RFQs and supplier responses."""

from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator


class RFQModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ProcurementRFQCreateRequest(RFQModel):
    material_request_id: UUID
    idempotency_key: UUID
    supplier_company_ids: list[UUID] = Field(min_length=1, max_length=100)
    delivery_location: Annotated[str, StringConstraints(min_length=1, max_length=500)] | None = None
    quotation_deadline: datetime
    buyer_notes: Annotated[str, StringConstraints(max_length=4000)] | None = None

    @field_validator("supplier_company_ids")
    @classmethod
    def require_unique_supplier_companies(cls, values: list[UUID]) -> list[UUID]:
        if len(values) != len(set(values)):
            raise ValueError("Supplier companies must be unique.")
        return values

    @field_validator("delivery_location")
    @classmethod
    def normalize_delivery_location(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("A delivery location is required.")
        return normalized

    @field_validator("buyer_notes")
    @classmethod
    def normalize_buyer_notes(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return " ".join(value.split()) or None

    @field_validator("quotation_deadline")
    @classmethod
    def require_future_deadline(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("Quotation deadline must include a timezone.")
        if value <= datetime.now(timezone.utc):
            raise ValueError("Quotation deadline must be in the future.")
        return value.astimezone(timezone.utc)


class SupplierQuotationResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: UUID
    unit_price: Decimal
    currency: Literal["INR", "USD", "EUR", "GBP", "AED"]
    quantity_offered: Decimal
    unit: Literal[
        "MT", "Bags", "Pieces", "Kg", "Tons", "Meters", "Sq. ft", "Boxes", "Liters"
    ]
    estimated_delivery_lead_time_days: int
    quotation_valid_until: date
    delivery_terms: str
    notes: str | None = None
    revision: int
    submitted_at: datetime
    updated_at: datetime


class ProcurementRFQRecipient(BaseModel):
    model_config = ConfigDict(extra="ignore")
    company_id: UUID
    company_name: str
    offering_id: UUID
    status: Literal["INVITED", "ACKNOWLEDGED", "DECLINED"]
    response_note: str | None = None
    responded_at: datetime | None = None
    quotation: SupplierQuotationResponse | None = None


class ProcurementRFQResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: UUID
    material_request_id: UUID | None
    item_name: str
    specification: str | None = None
    quantity: Decimal
    unit: str
    delivery_location: str
    quotation_deadline: datetime
    buyer_notes: str | None = None
    status: Literal["OPEN", "CLOSED"]
    created_at: datetime
    recipients: list[ProcurementRFQRecipient] = Field(default_factory=list)


class SupplierRFQResponseRequest(RFQModel):
    status: Literal["ACKNOWLEDGED", "DECLINED"]
    response_note: Annotated[str, StringConstraints(max_length=2000)] | None = None

    @field_validator("response_note")
    @classmethod
    def normalize_response_note(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return " ".join(value.split()) or None


class SupplierRFQResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: UUID
    item_name: str
    specification: str | None = None
    quantity: Decimal
    unit: str
    delivery_location: str
    quotation_deadline: datetime
    buyer_notes: str | None = None
    status: Literal["OPEN", "CLOSED"]
    created_at: datetime
    recipient_status: Literal["INVITED", "ACKNOWLEDGED", "DECLINED"]
    response_note: str | None = None
    responded_at: datetime | None = None
    quotation: SupplierQuotationResponse | None = None


class SupplierRFQResponseResult(BaseModel):
    rfq_id: UUID
    recipient_status: Literal["ACKNOWLEDGED", "DECLINED"]
    response_note: str | None = None
    responded_at: datetime


class SupplierQuotationRequest(RFQModel):
    unit_price: Decimal = Field(ge=0, le=1_000_000_000_000, max_digits=18, decimal_places=4)
    currency: Literal["INR", "USD", "EUR", "GBP", "AED"]
    quantity_offered: Decimal = Field(gt=0, le=1_000_000_000, max_digits=18, decimal_places=4)
    unit: Literal[
        "MT", "Bags", "Pieces", "Kg", "Tons", "Meters", "Sq. ft", "Boxes", "Liters"
    ]
    estimated_delivery_lead_time_days: int = Field(ge=0, le=3650)
    quotation_valid_until: date
    delivery_terms: Annotated[str, StringConstraints(min_length=1, max_length=2000)]
    notes: Annotated[str, StringConstraints(max_length=4000)] | None = None
    expected_revision: int | None = Field(default=None, ge=0)

    @field_validator("delivery_terms", mode="before")
    @classmethod
    def normalize_delivery_terms(cls, value: str) -> str:
        if not isinstance(value, str):
            raise ValueError("Delivery terms are required.")
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("Delivery terms are required.")
        return normalized

    @field_validator("notes", mode="before")
    @classmethod
    def normalize_quotation_notes(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("Notes must be text.")
        return " ".join(value.split()) or None

    @field_validator("quotation_valid_until")
    @classmethod
    def require_future_validity(cls, value: date) -> date:
        if value < date.today():
            raise ValueError("Quotation validity date must not be in the past.")
        return value
class SupplierQuotationResult(SupplierQuotationResponse):
    rfq_id: UUID
