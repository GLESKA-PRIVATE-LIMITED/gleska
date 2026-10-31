"""Billing persistence for the gateway. All money movement happens in Postgres functions."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Protocol

from app.ai_gateway.errors import AIBillingError
from app.ai_gateway.pricing import BillingSettings, FxRate, ModelPrice
from app.core.supabase import supabase

KNOWN_DB_ERRORS = ("INSUFFICIENT_CREDITS", "BILLING_ACCOUNT_SUSPENDED")


class BillingBackend(Protocol):
    def resolve_account(self, user_id: str) -> str: ...
    def active_price(self, provider: str, model: str) -> ModelPrice | None: ...
    def active_settings(self) -> BillingSettings: ...
    def active_fx(self, currency: str) -> FxRate | None: ...
    def create_event(self, fields: dict[str, Any]) -> str: ...
    def update_event(self, event_id: str, fields: dict[str, Any]) -> None: ...
    def reserve(self, event_id: str, credits: Decimal) -> None: ...
    def settle(self, event_id: str, credits: Decimal, fields: dict[str, Any]) -> None: ...


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _first(response: Any) -> dict[str, Any] | None:
    data = getattr(response, "data", None) or []
    data = data if isinstance(data, list) else [data]
    return data[0] if data else None


def _raise_known(exc: Exception) -> None:
    text = str(exc)
    for code in KNOWN_DB_ERRORS:
        if code in text:
            raise AIBillingError(code) from exc


class SupabaseBillingBackend:
    def resolve_account(self, user_id: str) -> str:
        employer = _first(
            supabase.table("employer_profiles").select("id").eq("user_id", user_id).limit(1).execute()
        )
        if not employer:
            raise AIBillingError("BILLING_ACCOUNT_REQUIRED")
        account = supabase.rpc("billing_ensure_account", {"p_employer_id": employer["id"]}).execute()
        account_id = getattr(account, "data", None)
        if not account_id:
            raise RuntimeError("billing_ensure_account returned no account")
        return str(account_id)

    def active_price(self, provider: str, model: str) -> ModelPrice | None:
        row = _first(
            supabase.table("ai_model_pricing").select("*")
            .eq("provider", provider).eq("model", model).eq("is_active", True)
            .lte("effective_from", _now())
            .order("effective_from", desc=True).order("version", desc=True).limit(1).execute()
        )
        return ModelPrice.from_row(row) if row else None

    def active_settings(self) -> BillingSettings:
        row = _first(
            supabase.table("billing_settings").select("*").lte("effective_from", _now())
            .order("effective_from", desc=True).order("version", desc=True).limit(1).execute()
        )
        if not row:
            raise RuntimeError("No billing settings configured")
        return BillingSettings.from_row(row)

    def active_fx(self, currency: str) -> FxRate | None:
        row = _first(
            supabase.table("fx_rates").select("id, rate").eq("base_currency", currency)
            .eq("quote_currency", "INR").lte("effective_from", _now())
            .order("effective_from", desc=True).limit(1).execute()
        )
        return FxRate(id=str(row["id"]), rate=Decimal(str(row["rate"]))) if row else None

    def create_event(self, fields: dict[str, Any]) -> str:
        row = _first(supabase.table("ai_usage_events").insert(fields).execute())
        if not row:
            raise RuntimeError("Usage event insert returned no row")
        return str(row["id"])

    def update_event(self, event_id: str, fields: dict[str, Any]) -> None:
        supabase.table("ai_usage_events").update(fields).eq("id", event_id).execute()

    def reserve(self, event_id: str, credits: Decimal) -> None:
        try:
            supabase.rpc("billing_reserve", {"p_usage_event_id": event_id, "p_amount": str(credits)}).execute()
        except Exception as exc:
            _raise_known(exc)
            raise

    def settle(self, event_id: str, credits: Decimal, fields: dict[str, Any]) -> None:
        supabase.rpc(
            "billing_settle",
            {"p_usage_event_id": event_id, "p_charge": str(credits), "p_event": fields},
        ).execute()


_backend: BillingBackend = SupabaseBillingBackend()


def get_backend() -> BillingBackend:
    return _backend


def set_backend(backend: BillingBackend) -> BillingBackend:
    """Swap the backend (tests). Returns the previous one."""
    global _backend
    previous, _backend = _backend, backend
    return previous
