from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from app.core.supabase import supabase

FREE_TRIAL_DAYS = 30


def _to_utc_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, str):
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    else:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def trial_state_for(profile: dict[str, Any] | None, *, default_end_date: datetime | None = None) -> dict[str, Any]:
    profile = profile or {}
    trial_started_at = _to_utc_datetime(profile.get("trial_started_at"))
    trial_ends_at = _to_utc_datetime(profile.get("trial_ends_at"))
    if trial_ends_at is None and default_end_date is not None:
        trial_ends_at = default_end_date
    if trial_started_at is None and trial_ends_at is not None:
        trial_started_at = trial_ends_at - timedelta(days=FREE_TRIAL_DAYS)
    now = datetime.now(timezone.utc)
    active = bool(trial_started_at and trial_ends_at and trial_started_at <= now < trial_ends_at)
    if trial_started_at and trial_ends_at:
        remaining = max((trial_ends_at - now).days, 0)
    else:
        remaining = 0
    return {
        "trial_started_at": trial_started_at,
        "trial_ends_at": trial_ends_at,
        "trial_active": active,
        "trial_days_remaining": remaining,
    }


def subscription_or_trial_active(profile: dict[str, Any] | None) -> bool:
    profile = profile or {}
    subscription_until = _to_utc_datetime(profile.get("subscription_valid_until"))
    trial = trial_state_for(profile)
    return bool(trial["trial_active"] or (subscription_until is not None and subscription_until > datetime.now(timezone.utc)))


def worker_state(profile: dict[str, Any] | None) -> dict[str, Any]:
    profile = profile or {}
    state = trial_state_for(profile)
    subscription_until = _to_utc_datetime(profile.get("subscription_valid_until"))
    subscription_active = bool(subscription_until is not None and subscription_until > datetime.now(timezone.utc))
    state["subscription_valid_until"] = subscription_until
    state["subscription_active"] = bool(state["trial_active"] or subscription_active)
    state["payment_required"] = not state["subscription_active"]
    return state


def employer_state(profile: dict[str, Any] | None) -> dict[str, Any]:
    profile = profile or {}
    state = trial_state_for(profile)
    subscription_until = _to_utc_datetime(profile.get("subscription_valid_until"))
    subscription_active = bool(subscription_until is not None and subscription_until > datetime.now(timezone.utc))
    state["subscription_valid_until"] = subscription_until
    state["subscription_active"] = bool(state["trial_active"] or subscription_active)
    state["payment_required"] = not state["subscription_active"]
    state["free_worker_limit"] = 3
    state["free_workers_used"] = 0
    state["free_workers_remaining"] = 3
    if profile.get("id"):
        try:
            response = (
                supabase.table("individual_free_worker_claims")
                .select("worker_profile_id")
                .eq("employer_id", profile["id"])
                .execute()
            )
            used = len(response.data or [])
            state["free_workers_used"] = used
            state["free_workers_remaining"] = max(3 - used, 0)
        except Exception:
            pass
    return state
