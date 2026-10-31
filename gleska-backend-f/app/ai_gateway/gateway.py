"""Request lifecycle: resolve account -> price -> reserve -> call provider -> settle -> record.

Fails closed: if the account, price, FX rate or billing database is unavailable, no provider call
is made. Provider-side failures release the reservation; a 200 response without usage metadata
keeps the reservation held as `pending_reconciliation` instead of inventing token counts.
"""

from __future__ import annotations

import logging
import time
from decimal import Decimal
from typing import Any
from uuid import uuid4

import httpx

from app.ai_gateway.backend import get_backend
from app.ai_gateway.context import current_billing_context
from app.ai_gateway.errors import AIBillingError
from app.ai_gateway.pricing import INR_IDENTITY, charge_for, provider_cost, reservation_credits
from app.ai_gateway.providers import gemini

logger = logging.getLogger(__name__)


def _usage_fields(usage, charge, raw, response_id) -> dict[str, Any]:
    return {
        "status": "succeeded",
        "usage_status": "confirmed",
        "input_tokens": usage.input_tokens,
        "cached_input_tokens": usage.cached_input_tokens,
        "audio_input_tokens": usage.audio_input_tokens,
        "output_tokens": usage.output_tokens,
        "thinking_tokens": usage.thinking_tokens,
        "total_tokens": usage.total_tokens,
        "provider_request_id": response_id,
        "provider_cost": str(charge.provider_cost),
        "provider_cost_inr": str(charge.provider_cost_inr),
        "customer_charge_inr": str(charge.customer_charge_inr),
        "raw_usage": raw,
    }


async def generate_content(
    payload: dict[str, Any],
    *,
    operation: str,
    timeout: float,
    model: str | None = None,
    input_size_hint_bytes: int = 0,
) -> httpx.Response:
    """Billed Gemini `generateContent`. Returns the provider response unchanged.

    Raises AIBillingError before any provider call when the request cannot be billed, and re-raises
    httpx transport errors after releasing the reservation, so callers keep their error handling.
    """
    context = current_billing_context()
    if context is None:
        logger.error("AI call without billing context: operation=%s", operation)
        raise AIBillingError("BILLING_CONTEXT_MISSING")
    model = model or gemini.default_model()
    backend = get_backend()

    try:
        account_id = backend.resolve_account(context.user_id)
        price = backend.active_price(gemini.PROVIDER, model)
        if price is None:
            logger.error("AI pricing not configured: provider=%s model=%s operation=%s", gemini.PROVIDER, model, operation)
            raise AIBillingError("AI_PRICING_NOT_CONFIGURED")
        billing_settings = backend.active_settings()
        fx = INR_IDENTITY if price.currency == "INR" else backend.active_fx(price.currency)
        if fx is None:
            logger.error("FX rate not configured: currency=%s", price.currency)
            raise AIBillingError("AI_FX_RATE_NOT_CONFIGURED")
        estimate = gemini.estimate_input_tokens(payload, input_size_hint_bytes)
        hold = reservation_credits(estimate, price, fx, billing_settings)
        event_id = backend.create_event({
            "request_id": str(uuid4()),
            "account_id": account_id,
            "user_id": context.user_id,
            "initiating_agent": context.initiating_agent,
            "executing_agent": context.executing_agent,
            "operation": operation,
            "conversation_id": context.conversation_id,
            "parent_task_id": context.parent_task_id,
            "provider": gemini.PROVIDER,
            "model": model,
            "pricing_id": price.id,
            "settings_id": billing_settings.id,
            "fx_rate_id": fx.id,
            "fx_rate": str(fx.rate),
            "provider_currency": price.currency,
            "status": "reserved",
        })
    except AIBillingError:
        raise
    except Exception as exc:
        logger.exception("Billing unavailable before AI call: operation=%s", operation)
        raise AIBillingError("BILLING_UNAVAILABLE") from exc

    try:
        backend.reserve(event_id, hold)
    except AIBillingError as exc:
        backend.update_event(event_id, {"status": "rejected", "error_code": exc.code})
        raise
    except Exception as exc:
        logger.exception("Credit reservation failed: event_id=%s", event_id)
        raise AIBillingError("BILLING_UNAVAILABLE") from exc

    started = time.monotonic()

    def release(error_code: str) -> None:
        try:
            backend.settle(event_id, Decimal(0), {
                "status": "failed",
                "error_code": error_code,
                "latency_ms": round((time.monotonic() - started) * 1000),
            })
        except Exception:
            logger.exception("Reservation release failed; left for reconciliation: event_id=%s", event_id)

    try:
        response = await gemini.generate_content(model, payload, timeout)
    except httpx.TimeoutException:
        release("PROVIDER_TIMEOUT")
        raise
    except httpx.HTTPError as exc:
        release(f"PROVIDER_TRANSPORT_{type(exc).__name__}"[:60])
        raise

    latency_ms = round((time.monotonic() - started) * 1000)
    if response.status_code != 200:
        release(f"PROVIDER_HTTP_{response.status_code}")
        return response

    try:
        body = response.json()
    except ValueError:
        body = None
    usage, raw, response_id = gemini.parse_usage(body)
    if usage is None:
        logger.error("Provider returned no usage metadata; reservation held for reconciliation: event_id=%s", event_id)
        try:
            backend.update_event(event_id, {
                "status": "pending_reconciliation",
                "usage_status": "unavailable",
                "provider_request_id": response_id,
                "latency_ms": latency_ms,
                "raw_usage": raw,
            })
        except Exception:
            logger.exception("Could not flag event for reconciliation: event_id=%s", event_id)
        return response

    charge = charge_for(provider_cost(usage, price), fx, billing_settings)
    try:
        backend.settle(event_id, charge.credits, {
            **_usage_fields(usage, charge, raw, response_id),
            "latency_ms": latency_ms,
        })
    except Exception:
        # The provider already did the work: return it, and leave the held reservation for reconciliation.
        logger.exception("Settlement failed; reservation held for reconciliation: event_id=%s", event_id)
    return response
