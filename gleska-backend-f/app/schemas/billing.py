"""Billing API schemas. Amounts are Decimals serialized as strings to avoid float rounding."""

from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, Field, field_validator

MODEL_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$"
Price = Annotated[Decimal, Field(ge=0, max_digits=18, decimal_places=8)]


class PricingCreate(BaseModel):
    provider: str = Field(default="gemini", pattern=r"^[a-z0-9_-]{2,40}$")
    model: str = Field(..., pattern=MODEL_PATTERN)
    currency: str = Field(..., pattern=r"^[A-Z]{3}$")
    input_price: Price
    output_price: Price
    cached_input_price: Price | None = None
    thinking_price: Price | None = None
    audio_input_price: Price | None = None
    tier_threshold_tokens: int | None = Field(default=None, gt=0)
    input_price_above: Price | None = None
    output_price_above: Price | None = None
    cached_input_price_above: Price | None = None
    max_output_tokens: int | None = Field(default=None, gt=0, le=1_000_000)
    effective_from: datetime | None = None
    source_note: str = Field(..., min_length=5, max_length=500, description="Where these verified prices came from")


class FxRateCreate(BaseModel):
    base_currency: str = Field(..., pattern=r"^[A-Z]{3}$")
    rate: Decimal = Field(..., gt=0, max_digits=18, decimal_places=8, description="INR per 1 unit of base currency")
    source: str = Field(..., min_length=3, max_length=200)
    effective_from: datetime | None = None

    @field_validator("base_currency")
    @classmethod
    def not_inr(cls, value: str) -> str:
        if value == "INR":
            raise ValueError("INR needs no exchange rate")
        return value


class SettingsCreate(BaseModel):
    credit_value_inr: Decimal = Field(..., gt=0, max_digits=12, decimal_places=4)
    markup_multiplier: Decimal = Field(..., ge=1, max_digits=8, decimal_places=4)
    default_max_output_tokens: int = Field(default=8192, gt=0, le=1_000_000)
    effective_from: datetime | None = None
    reason: str = Field(..., min_length=5, max_length=500)


class CreditAdjustment(BaseModel):
    credits: Decimal = Field(..., max_digits=20, decimal_places=6)
    reason: str = Field(..., min_length=5, max_length=500)
    idempotency_key: str = Field(..., min_length=8, max_length=100, pattern=r"^[A-Za-z0-9_.:-]+$")

    @field_validator("credits")
    @classmethod
    def non_zero(cls, value: Decimal) -> Decimal:
        if value == 0:
            raise ValueError("credits must not be zero")
        return value


class AccountStatusUpdate(BaseModel):
    status: Literal["active", "suspended"]
    reason: str = Field(..., min_length=5, max_length=500)


class WalletSummary(BaseModel):
    account_id: str
    status: str
    available: Decimal
    reserved: Decimal
    total_purchased: Decimal
    total_consumed: Decimal
    total_refunded: Decimal
    total_adjusted: Decimal
    total_unrecovered: Decimal
    credit_value_inr: Decimal
    markup_multiplier: Decimal


class UsageTotals(BaseModel):
    requests: int = 0
    failed_requests: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    thinking_tokens: int = 0
    total_tokens: int = 0
    provider_cost_inr: Decimal = Decimal(0)
    customer_charge_inr: Decimal = Decimal(0)
    credits_charged: Decimal = Decimal(0)


class AgentUsage(UsageTotals):
    agent: str


class UsageReport(BaseModel):
    totals: UsageTotals
    by_agent: list[AgentUsage]
    by_model: list[dict]
    events: list[dict]
