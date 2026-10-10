"""Schemas for supplier-managed material offerings."""

from datetime import datetime
from decimal import Decimal
import re
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def _normalize_service_coverage(values: list[str]) -> list[str]:
    normalized: list[str] = []
    for value in values:
        if not isinstance(value, str):
            raise ValueError("Each service area must be text.")
        area = " ".join(value.split())
        if not area or len(area) > 160:
            raise ValueError("Each service area must contain 1 to 160 characters.")
        if area.casefold() not in {existing.casefold() for existing in normalized}:
            normalized.append(area)
    return normalized


class SupplierMaterialOfferingFields(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=2, max_length=240)
    specification: str | None = Field(default=None, max_length=2000)
    unit: str = Field(min_length=1, max_length=48)
    indicative_price: Decimal | None = Field(default=None, gt=0, max_digits=18, decimal_places=4)
    currency_code: str | None = Field(default=None, min_length=3, max_length=3)
    minimum_order_quantity: Decimal | None = Field(
        default=None, gt=0, max_digits=18, decimal_places=4
    )
    is_available: bool = True
    service_coverage: list[str] = Field(default_factory=list, max_length=50)

    @field_validator("name", "unit", mode="before")
    @classmethod
    def normalize_required_text(cls, value: Any) -> Any:
        return " ".join(value.split()) if isinstance(value, str) else value

    @field_validator("specification", mode="before")
    @classmethod
    def normalize_specification(cls, value: Any) -> Any:
        if not isinstance(value, str):
            return value
        normalized = " ".join(value.split())
        return normalized or None

    @field_validator("currency_code", mode="before")
    @classmethod
    def normalize_currency_code(cls, value: Any) -> Any:
        return value.strip().upper() if isinstance(value, str) else value

    @field_validator("currency_code")
    @classmethod
    def validate_currency_code(cls, value: str | None) -> str | None:
        if value is not None and not re.fullmatch(r"[A-Z]{3}", value):
            raise ValueError("Currency code must be a three-letter ISO-style code.")
        return value

    @field_validator("service_coverage")
    @classmethod
    def normalize_service_coverage(cls, values: list[str]) -> list[str]:
        return _normalize_service_coverage(values)

    @model_validator(mode="after")
    def price_requires_currency(self):
        if (self.indicative_price is None) != (self.currency_code is None):
            raise ValueError("Provide both indicative price and currency, or neither.")
        return self


class SupplierMaterialOfferingCreateRequest(SupplierMaterialOfferingFields):
    pass


class SupplierMaterialOfferingPatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=2, max_length=240)
    specification: str | None = Field(default=None, max_length=2000)
    unit: str | None = Field(default=None, min_length=1, max_length=48)
    indicative_price: Decimal | None = Field(
        default=None, gt=0, max_digits=18, decimal_places=4
    )
    currency_code: str | None = Field(default=None, min_length=3, max_length=3)
    minimum_order_quantity: Decimal | None = Field(
        default=None, gt=0, max_digits=18, decimal_places=4
    )
    is_available: bool | None = None
    service_coverage: list[str] | None = Field(default=None, max_length=50)
    expected_revision: int = Field(ge=0)

    @field_validator("name", "unit", mode="before")
    @classmethod
    def normalize_required_text(cls, value: Any) -> Any:
        return " ".join(value.split()) if isinstance(value, str) else value

    @field_validator("specification", mode="before")
    @classmethod
    def normalize_specification(cls, value: Any) -> Any:
        if not isinstance(value, str):
            return value
        normalized = " ".join(value.split())
        return normalized or None

    @field_validator("currency_code", mode="before")
    @classmethod
    def normalize_currency_code(cls, value: Any) -> Any:
        return value.strip().upper() if isinstance(value, str) else value

    @field_validator("currency_code")
    @classmethod
    def validate_currency_code(cls, value: str | None) -> str | None:
        if value is not None and not re.fullmatch(r"[A-Z]{3}", value):
            raise ValueError("Currency code must be a three-letter ISO-style code.")
        return value

    @field_validator("service_coverage")
    @classmethod
    def normalize_service_coverage(
        cls,
        values: list[str] | None,
    ) -> list[str] | None:
        if values is None:
            return None
        return _normalize_service_coverage(values)

    @model_validator(mode="after")
    def require_update(self):
        if not (set(self.model_fields_set) - {"expected_revision"}):
            raise ValueError("At least one offering field must be provided.")
        return self


class SupplierMaterialOfferingResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    company_id: UUID
    name: str
    specification: str | None = None
    unit: str
    indicative_price: Decimal | None = None
    currency_code: str | None = None
    minimum_order_quantity: Decimal | None = None
    is_available: bool
    service_coverage: list[str]
    revision: int
    archived_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
