"""Pure, deterministic pricing: provider usage -> provider cost -> INR -> customer charge -> credits.

No I/O and no floats. Prices are per 1,000,000 tokens. Rounding happens once per transaction:
provider cost 8 dp, INR amounts 4 dp, credits 6 dp, all ROUND_HALF_UP.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, ROUND_UP, Decimal
from typing import Any

PER_MILLION = Decimal(1_000_000)
Q_COST = Decimal("0.00000001")
Q_INR = Decimal("0.0001")
Q_CREDITS = Decimal("0.000001")


def _dec(value: Any) -> Decimal | None:
    return None if value is None else Decimal(str(value))


@dataclass(frozen=True)
class ModelPrice:
    id: str
    provider: str
    model: str
    version: int
    currency: str
    input_price: Decimal
    output_price: Decimal
    cached_input_price: Decimal | None = None
    thinking_price: Decimal | None = None
    audio_input_price: Decimal | None = None
    tier_threshold_tokens: int | None = None
    input_price_above: Decimal | None = None
    output_price_above: Decimal | None = None
    cached_input_price_above: Decimal | None = None
    max_output_tokens: int | None = None

    @classmethod
    def from_row(cls, row: dict[str, Any]) -> "ModelPrice":
        return cls(
            id=str(row["id"]),
            provider=row["provider"],
            model=row["model"],
            version=int(row["version"]),
            currency=row["currency"],
            input_price=_dec(row["input_price"]),
            output_price=_dec(row["output_price"]),
            cached_input_price=_dec(row.get("cached_input_price")),
            thinking_price=_dec(row.get("thinking_price")),
            audio_input_price=_dec(row.get("audio_input_price")),
            tier_threshold_tokens=row.get("tier_threshold_tokens"),
            input_price_above=_dec(row.get("input_price_above")),
            output_price_above=_dec(row.get("output_price_above")),
            cached_input_price_above=_dec(row.get("cached_input_price_above")),
            max_output_tokens=row.get("max_output_tokens"),
        )


@dataclass(frozen=True)
class BillingSettings:
    id: str
    credit_value_inr: Decimal
    markup_multiplier: Decimal
    default_max_output_tokens: int

    @classmethod
    def from_row(cls, row: dict[str, Any]) -> "BillingSettings":
        return cls(
            id=str(row["id"]),
            credit_value_inr=_dec(row["credit_value_inr"]),
            markup_multiplier=_dec(row["markup_multiplier"]),
            default_max_output_tokens=int(row["default_max_output_tokens"]),
        )


@dataclass(frozen=True)
class FxRate:
    id: str | None
    rate: Decimal  # 1 unit of pricing currency in INR


INR_IDENTITY = FxRate(id=None, rate=Decimal(1))


@dataclass(frozen=True)
class Usage:
    """Provider-reported usage. `input_tokens` includes cached and audio input tokens."""

    input_tokens: int = 0
    cached_input_tokens: int = 0
    audio_input_tokens: int = 0
    output_tokens: int = 0
    thinking_tokens: int = 0

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens + self.thinking_tokens


@dataclass(frozen=True)
class Charge:
    provider_cost: Decimal
    provider_cost_inr: Decimal
    customer_charge_inr: Decimal
    credits: Decimal


def provider_cost(usage: Usage, price: ModelPrice) -> Decimal:
    """Exact provider cost in the price's currency (unrounded)."""
    above = bool(price.tier_threshold_tokens and usage.input_tokens > price.tier_threshold_tokens)
    input_rate = price.input_price_above if above else price.input_price
    output_rate = price.output_price_above if above else price.output_price
    cached_rate = (price.cached_input_price_above if above else price.cached_input_price) or input_rate
    audio_rate = price.audio_input_price if price.audio_input_price is not None else input_rate
    thinking_rate = price.thinking_price if price.thinking_price is not None else output_rate

    cached = min(usage.cached_input_tokens, usage.input_tokens)
    audio = min(usage.audio_input_tokens, usage.input_tokens - cached)
    plain_input = usage.input_tokens - cached - audio
    total = (
        Decimal(plain_input) * input_rate
        + Decimal(cached) * cached_rate
        + Decimal(audio) * audio_rate
        + Decimal(usage.output_tokens) * output_rate
        + Decimal(usage.thinking_tokens) * thinking_rate
    )
    return total / PER_MILLION


def charge_for(cost: Decimal, fx: FxRate, settings: BillingSettings) -> Charge:
    cost_inr = cost * fx.rate
    customer_inr = cost_inr * settings.markup_multiplier
    credits = customer_inr / settings.credit_value_inr
    return Charge(
        provider_cost=cost.quantize(Q_COST, ROUND_HALF_UP),
        provider_cost_inr=cost_inr.quantize(Q_INR, ROUND_HALF_UP),
        customer_charge_inr=customer_inr.quantize(Q_INR, ROUND_HALF_UP),
        credits=credits.quantize(Q_CREDITS, ROUND_HALF_UP),
    )


def reservation_credits(
    estimated_input_tokens: int,
    price: ModelPrice,
    fx: FxRate,
    settings: BillingSettings,
) -> Decimal:
    """Conservative upper bound held before the call (input estimate + max output + equal thinking)."""
    max_output = price.max_output_tokens or settings.default_max_output_tokens
    worst = Usage(
        input_tokens=estimated_input_tokens,
        output_tokens=max_output,
        thinking_tokens=max_output,
    )
    credits = charge_for(provider_cost(worst, price), fx, settings).credits  # applies tiers itself
    return max(credits, Q_CREDITS).quantize(Q_CREDITS, ROUND_UP)
