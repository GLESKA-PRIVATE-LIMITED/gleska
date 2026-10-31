"""Billing reads for employers and audited configuration for administrators.

Money movement itself lives in Postgres functions (migration 104); this service only calls them.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from app.ai_gateway.errors import AIBillingError
from app.core.supabase import supabase
from app.schemas.auth import UserResponse
from app.schemas.billing import (
    AccountStatusUpdate,
    AgentUsage,
    CreditAdjustment,
    FxRateCreate,
    PricingCreate,
    SettingsCreate,
    UsageReport,
    UsageTotals,
    WalletSummary,
)

MAX_REPORT_EVENTS = 5000
EVENT_COLUMNS = (
    "id, started_at, completed_at, user_id, initiating_agent, executing_agent, operation, conversation_id, "
    "provider, model, status, usage_status, input_tokens, cached_input_tokens, output_tokens, thinking_tokens, "
    "total_tokens, provider_cost, provider_currency, provider_cost_inr, customer_charge_inr, credits_reserved, "
    "credits_charged, credits_unrecovered, error_code, latency_ms, pricing_id"
)


class BillingNotFound(Exception):
    pass


def _rows(response: Any) -> list[dict[str, Any]]:
    data = getattr(response, "data", None) or []
    return data if isinstance(data, list) else [data]


def _first(response: Any) -> dict[str, Any] | None:
    rows = _rows(response)
    return rows[0] if rows else None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _dec(value: Any) -> Decimal:
    return Decimal(str(value)) if value is not None else Decimal(0)


def _audit(actor: str, action: str, target_type: str, target_id: str | None, details: dict[str, Any]) -> None:
    supabase.table("billing_audit_logs").insert({
        "actor_user_id": actor,
        "action": action,
        "target_type": target_type,
        "target_id": target_id,
        "details": details,
    }).execute()


def _json(model) -> dict[str, Any]:
    return model.model_dump(mode="json", exclude_none=True)


def summarize(events: list[dict[str, Any]]) -> tuple[UsageTotals, list[AgentUsage], list[dict[str, Any]]]:
    totals = UsageTotals()
    agents: dict[str, AgentUsage] = {}
    models: dict[tuple[str, str], dict[str, Any]] = defaultdict(lambda: {"requests": 0, "total_tokens": 0, "credits_charged": Decimal(0)})

    def add(target: UsageTotals, event: dict[str, Any]) -> None:
        target.requests += 1
        if event.get("status") in ("failed", "rejected"):
            target.failed_requests += 1
        target.input_tokens += int(event.get("input_tokens") or 0)
        target.output_tokens += int(event.get("output_tokens") or 0)
        target.thinking_tokens += int(event.get("thinking_tokens") or 0)
        target.total_tokens += int(event.get("total_tokens") or 0)
        target.provider_cost_inr += _dec(event.get("provider_cost_inr"))
        target.customer_charge_inr += _dec(event.get("customer_charge_inr"))
        target.credits_charged += _dec(event.get("credits_charged"))

    for event in events:
        add(totals, event)
        agent = event.get("executing_agent") or "unknown"
        add(agents.setdefault(agent, AgentUsage(agent=agent)), event)
        model_row = models[(event.get("provider") or "", event.get("model") or "")]
        model_row["requests"] += 1
        model_row["total_tokens"] += int(event.get("total_tokens") or 0)
        model_row["credits_charged"] += _dec(event.get("credits_charged"))
    by_model = [
        {"provider": provider, "model": model, **{k: str(v) if isinstance(v, Decimal) else v for k, v in row.items()}}
        for (provider, model), row in models.items()
    ]
    return totals, sorted(agents.values(), key=lambda a: a.credits_charged, reverse=True), by_model



def _employer_identities(employer_ids: list[str]) -> dict[str, dict[str, Any]]:
    """Admin-facing label for each employer: business name, else contact person, else account name.

    Email and the last 4 phone digits help the admin tell accounts apart (admin-only endpoint).
    """
    if not employer_ids:
        return {}
    profiles = _rows(supabase.table("employer_profiles").select("id, user_id, contact_person_name")
                     .in_("id", employer_ids).execute())
    details = {d["employer_id"]: d for d in _rows(supabase.table("employer_onboarding_details")
               .select("employer_id, business_name").in_("employer_id", employer_ids).execute())}
    user_ids = [p["user_id"] for p in profiles if p.get("user_id")]
    users = {u["id"]: u for u in (_rows(supabase.table("users").select("id, name, email, mobile")
             .in_("id", user_ids).execute()) if user_ids else [])}
    result: dict[str, dict[str, Any]] = {}
    for p in profiles:
        user = users.get(p.get("user_id"), {})
        name = next((str(v).strip() for v in (
            details.get(p["id"], {}).get("business_name"), p.get("contact_person_name"), user.get("name"),
        ) if v and str(v).strip()), None)
        mobile = "".join(ch for ch in str(user.get("mobile") or "") if ch.isdigit())
        result[p["id"]] = {
            "employer_name": name,
            "employer_email": user.get("email"),
            "employer_phone_last4": mobile[-4:] if len(mobile) >= 4 else None,
        }
    return result

class BillingService:
    # ---------- employer ----------

    @staticmethod
    def account_for(user: UserResponse) -> str:
        employer = _first(supabase.table("employer_profiles").select("id").eq("user_id", user.id).limit(1).execute())
        if not employer:
            raise AIBillingError("BILLING_ACCOUNT_REQUIRED")
        return str(supabase.rpc("billing_ensure_account", {"p_employer_id": employer["id"]}).execute().data)

    @staticmethod
    def wallet(account_id: str) -> WalletSummary:
        account = _first(supabase.table("billing_accounts").select("id, status").eq("id", account_id).limit(1).execute())
        wallet = _first(supabase.table("credit_wallets").select("*").eq("account_id", account_id).limit(1).execute())
        settings = _first(
            supabase.table("billing_settings").select("credit_value_inr, markup_multiplier")
            .lte("effective_from", _now()).order("effective_from", desc=True).limit(1).execute()
        )
        if not account or not wallet or not settings:
            raise BillingNotFound("BILLING_ACCOUNT_NOT_FOUND")
        return WalletSummary(
            account_id=account_id,
            status=account["status"],
            **{k: _dec(wallet.get(k)) for k in (
                "available", "reserved", "total_purchased", "total_consumed",
                "total_refunded", "total_adjusted", "total_unrecovered",
            )},
            credit_value_inr=_dec(settings["credit_value_inr"]),
            markup_multiplier=_dec(settings["markup_multiplier"]),
        )

    @staticmethod
    def usage(
        account_id: str | None,
        *,
        start: datetime | None,
        end: datetime | None,
        agent: str | None = None,
        model: str | None = None,
        status: str | None = None,
        user_id: str | None = None,
        limit: int = 100,
    ) -> UsageReport:
        query = supabase.table("ai_usage_events").select(EVENT_COLUMNS + ", account_id")
        if account_id:
            query = query.eq("account_id", account_id)
        if start:
            query = query.gte("started_at", start.isoformat())
        if end:
            query = query.lt("started_at", end.isoformat())
        for column, value in (("executing_agent", agent), ("model", model), ("status", status), ("user_id", user_id)):
            if value:
                query = query.eq(column, value)
        events = _rows(query.order("started_at", desc=True).limit(MAX_REPORT_EVENTS).execute())
        totals, by_agent, by_model = summarize(events)
        return UsageReport(totals=totals, by_agent=by_agent, by_model=by_model, events=events[:limit])

    @staticmethod
    def ledger(account_id: str, limit: int) -> list[dict[str, Any]]:
        return _rows(
            supabase.table("credit_ledger")
            .select("id, entry_type, delta_available, delta_reserved, available_after, reserved_after, "
                    "credits_consumed, credits_unrecovered, reference_type, reference_id, description, created_at")
            .eq("account_id", account_id).order("created_at", desc=True).limit(limit).execute()
        )

    # ---------- administrator ----------

    @staticmethod
    def list_pricing() -> list[dict[str, Any]]:
        return _rows(supabase.table("ai_model_pricing").select("*").order("provider").order("model").order("version", desc=True).execute())

    @staticmethod
    def create_pricing(admin: UserResponse, payload: PricingCreate) -> dict[str, Any]:
        latest = _first(
            supabase.table("ai_model_pricing").select("version")
            .eq("provider", payload.provider).eq("model", payload.model)
            .order("version", desc=True).limit(1).execute()
        )
        row = _first(supabase.table("ai_model_pricing").insert({
            **_json(payload),
            "version": (latest["version"] if latest else 0) + 1,
            "created_by": admin.id,
        }).execute())
        _audit(admin.id, "pricing_version_created", "ai_model_pricing", row["id"], _json(payload))
        return row

    @staticmethod
    def deactivate_pricing(admin: UserResponse, pricing_id: str, reason: str) -> dict[str, Any]:
        row = _first(supabase.table("ai_model_pricing").update({"is_active": False}).eq("id", pricing_id).execute())
        if not row:
            raise BillingNotFound("PRICING_NOT_FOUND")
        _audit(admin.id, "pricing_version_deactivated", "ai_model_pricing", pricing_id, {"reason": reason})
        return row

    @staticmethod
    def list_fx() -> list[dict[str, Any]]:
        return _rows(supabase.table("fx_rates").select("*").order("effective_from", desc=True).limit(200).execute())

    @staticmethod
    def create_fx(admin: UserResponse, payload: FxRateCreate) -> dict[str, Any]:
        row = _first(supabase.table("fx_rates").insert({**_json(payload), "quote_currency": "INR", "created_by": admin.id}).execute())
        _audit(admin.id, "fx_rate_created", "fx_rates", row["id"], _json(payload))
        return row

    @staticmethod
    def list_settings() -> list[dict[str, Any]]:
        return _rows(supabase.table("billing_settings").select("*").order("version", desc=True).execute())

    @staticmethod
    def create_settings(admin: UserResponse, payload: SettingsCreate) -> dict[str, Any]:
        latest = _first(supabase.table("billing_settings").select("version").order("version", desc=True).limit(1).execute())
        row = _first(supabase.table("billing_settings").insert({
            **_json(payload), "version": (latest["version"] if latest else 0) + 1, "created_by": admin.id,
        }).execute())
        _audit(admin.id, "billing_settings_created", "billing_settings", row["id"], _json(payload))
        return row

    @staticmethod
    def list_accounts() -> list[dict[str, Any]]:
        # Every employer gets a (zero-balance) wallet so admins can grant credits before first use.
        known = {a["employer_id"] for a in _rows(supabase.table("billing_accounts").select("employer_id").execute())}
        for employer in _rows(supabase.table("employer_profiles").select("id").execute()):
            if employer["id"] not in known:
                supabase.rpc("billing_ensure_account", {"p_employer_id": employer["id"]}).execute()
        accounts = _rows(supabase.table("billing_accounts").select("id, employer_id, status, created_at").execute())
        wallets = {w["account_id"]: w for w in _rows(supabase.table("credit_wallets").select("*").execute())}
        employer_ids = [a["employer_id"] for a in accounts if a.get("employer_id")]
        info = _employer_identities(employer_ids)
        rows = [{**a, **info.get(a.get("employer_id"), {"employer_name": None, "employer_email": None, "employer_phone_last4": None}),
                 "wallet": wallets.get(a["id"])} for a in accounts]
        return sorted(rows, key=lambda r: (r["employer_name"] is None, (r["employer_name"] or "").lower()))

    @staticmethod
    def adjust(admin: UserResponse, account_id: str, payload: CreditAdjustment) -> dict[str, Any]:
        try:
            result = supabase.rpc("billing_admin_adjust", {
                "p_account_id": account_id,
                "p_delta": str(payload.credits),
                "p_reason": payload.reason,
                "p_actor": admin.id,
                "p_idempotency_key": payload.idempotency_key,
            }).execute()
        except Exception as exc:
            text = str(exc)
            for code in ("INSUFFICIENT_CREDITS", "BILLING_ACCOUNT_NOT_FOUND", "BILLING_REASON_REQUIRED"):
                if code in text:
                    raise BillingNotFound(code) if code == "BILLING_ACCOUNT_NOT_FOUND" else ValueError(code) from exc
            raise
        return result.data or {}

    @staticmethod
    def set_status(admin: UserResponse, account_id: str, payload: AccountStatusUpdate) -> dict[str, Any]:
        row = _first(supabase.table("billing_accounts").update({"status": payload.status}).eq("id", account_id).execute())
        if not row:
            raise BillingNotFound("BILLING_ACCOUNT_NOT_FOUND")
        _audit(admin.id, f"account_{payload.status}", "billing_account", account_id, {"reason": payload.reason})
        return row

    @staticmethod
    def readiness() -> dict[str, Any]:
        """What production still needs before AI requests can be billed (and therefore run)."""
        from app.ai_gateway.backend import get_backend
        from app.ai_gateway.providers import gemini

        model = gemini.default_model()
        status: dict[str, Any] = {"provider": gemini.PROVIDER, "model": model or None, "api_key_configured": bool(gemini.api_key())}
        try:
            backend = get_backend()
            price = backend.active_price(gemini.PROVIDER, model) if model else None
            settings_row = backend.active_settings()
            fx = backend.active_fx(price.currency) if price and price.currency != "INR" else None
        except Exception:
            return {**status, "migration_applied": False, "ready": False,
                    "missing": ["Apply database migration 104 (billing tables)"]}
        missing = []
        if not status["api_key_configured"] or not model:
            missing.append("Set the Gemini API key and model in the backend environment")
        if price is None:
            missing.append(f"Add a verified price for model '{model}'")
        elif price.currency != "INR" and fx is None:
            missing.append(f"Add a {price.currency} to INR exchange rate")
        return {
            **status,
            "migration_applied": True,
            "price": None if price is None else {"id": price.id, "version": price.version, "currency": price.currency},
            "fx_rate": None if fx is None else str(fx.rate),
            "credit_value_inr": str(settings_row.credit_value_inr),
            "markup_multiplier": str(settings_row.markup_multiplier),
            "missing": missing,
            "ready": not missing,
        }

    @staticmethod
    def audit_log(limit: int) -> list[dict[str, Any]]:
        return _rows(supabase.table("billing_audit_logs").select("*").order("created_at", desc=True).limit(limit).execute())
