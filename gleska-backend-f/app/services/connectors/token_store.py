"""Single access point for connector credentials stored in ``connector_tokens``.

Every connector service reads its token through :func:`get_credential`, which
- resolves shared OAuth grants (one Google consent covers Gmail/Calendar/Drive/Docs/Sheets/Forms),
- refreshes access tokens shortly before they expire and persists rotated refresh tokens,
- marks a connection ``expired`` when it can no longer be refreshed, so the UI asks to reconnect,
- encrypts tokens at rest when ``CONNECTOR_TOKEN_ENCRYPTION_KEY`` is set.

Rows are always filtered by the caller's employer id: the service-role client bypasses RLS.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings
from app.core.supabase import supabase
from app.services.connectors.oauth_service import (
    PROVIDER_MAP,
    credential_group,
    refresh_access_token,
)

logger = logging.getLogger(__name__)

TABLE = "connector_tokens"
REFRESH_MARGIN = timedelta(seconds=120)
_ENCRYPTED_PREFIX = "enc:v1:"
_refresh_locks: dict[tuple[str, str], asyncio.Lock] = {}


class TokenDecryptionError(Exception):
    """A stored token is encrypted but cannot be decrypted with the configured key."""


@dataclass(frozen=True)
class Credential:
    token: str | None
    status: str  # "ok" | "not_connected" | "expired"
    provider: str

    def error_message(self, service_name: str) -> str:
        if self.status == "expired":
            return (
                f"The {service_name} connection has expired and could not be renewed. "
                "Please reconnect it in Settings > Connectors."
            )
        return (
            f"{service_name} is not connected. Please connect it in Settings > Connectors."
        )


# ── Encryption ──────────────────────────────────────────────────────────────

def _fernet() -> Fernet | None:
    key = (settings.CONNECTOR_TOKEN_ENCRYPTION_KEY or "").strip()
    return Fernet(key.encode()) if key else None


def encrypt_token(value: str | None) -> str | None:
    if not value:
        return value
    fernet = _fernet()
    if fernet is None:
        return value
    return _ENCRYPTED_PREFIX + fernet.encrypt(value.encode()).decode()


def decrypt_token(value: str | None) -> str | None:
    """Decrypt a stored token. Plaintext legacy rows are returned unchanged."""
    if not value or not value.startswith(_ENCRYPTED_PREFIX):
        return value
    fernet = _fernet()
    if fernet is None:
        raise TokenDecryptionError("CONNECTOR_TOKEN_ENCRYPTION_KEY_MISSING")
    try:
        return fernet.decrypt(value[len(_ENCRYPTED_PREFIX):].encode()).decode()
    except InvalidToken as exc:
        raise TokenDecryptionError("CONNECTOR_TOKEN_UNDECRYPTABLE") from exc


# ── Persistence ─────────────────────────────────────────────────────────────

def _expires_at(expires_in: Any, now: datetime) -> str | None:
    try:
        seconds = int(expires_in)
    except (TypeError, ValueError):
        return None
    return (now + timedelta(seconds=seconds)).isoformat() if seconds > 0 else None


def store_token(
    employer_id: str,
    provider: str,
    access_token: str,
    refresh_token: str | None = None,
    expires_in: Any = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    now = datetime.now(timezone.utc)
    supabase.table(TABLE).upsert(
        {
            "employer_id": employer_id,
            "provider": provider,
            "access_token": encrypt_token(access_token),
            "refresh_token": encrypt_token(refresh_token),
            "expires_at": _expires_at(expires_in, now),
            "status": "active",
            "connected_at": now.isoformat(),
            "updated_at": now.isoformat(),
            "connector_metadata": metadata or {},
        },
        on_conflict="employer_id,provider",
    ).execute()


def _group_rows(employer_id: str, provider: str) -> list[dict[str, Any]]:
    group = credential_group(provider)
    response = (
        supabase.table(TABLE)
        .select("provider,access_token,refresh_token,expires_at,status,connected_at")
        .eq("employer_id", employer_id)
        .in_("provider", list(group))
        .execute()
    )
    rows = list(getattr(response, "data", None) or [])
    # Prefer the exact provider row, then the most recently connected sibling.
    rows.sort(key=lambda row: str(row.get("connected_at") or ""), reverse=True)
    rows.sort(key=lambda row: row.get("provider") != provider)
    return rows


def connection_statuses(employer_id: str) -> dict[str, dict[str, Any]]:
    """Map every provider id to its effective connection row (shared grants included)."""
    response = (
        supabase.table(TABLE)
        .select("provider,status,connected_at,expires_at,refresh_token")
        .eq("employer_id", employer_id)
        .execute()
    )
    rows = {row["provider"]: row for row in (getattr(response, "data", None) or [])}
    effective: dict[str, dict[str, Any]] = {}
    for provider in {*rows, *PROVIDER_MAP}:
        candidates = [rows[p] for p in credential_group(provider) if p in rows]
        active = [row for row in candidates if row.get("status") == "active"]
        chosen = (active or candidates or [None])[0]
        if chosen is not None:
            effective[provider] = chosen
    return effective


def disconnect(employer_id: str, provider: str) -> tuple[str, ...]:
    """Disconnect the provider and every connector sharing its OAuth grant."""
    group = credential_group(provider)
    supabase.table(TABLE).update({
        "status": "disconnected",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("employer_id", employer_id).in_("provider", list(group)).execute()
    return group


def _mark_expired(employer_id: str, provider: str) -> None:
    try:
        supabase.table(TABLE).update({
            "status": "expired",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("employer_id", employer_id).eq("provider", provider).execute()
    except Exception:
        logger.exception("Failed to mark connector expired: provider=%s", provider)


# ── Lookup with refresh ─────────────────────────────────────────────────────

def _needs_refresh(row: dict[str, Any], now: datetime) -> bool:
    raw = row.get("expires_at")
    if not raw:
        return False
    try:
        expires_at = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return False
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return expires_at - REFRESH_MARGIN <= now


async def get_credential(employer_id: str, provider: str) -> Credential:
    """Return a usable token for ``provider``, refreshing it if it is about to expire."""
    if not employer_id:
        return Credential(None, "not_connected", provider)
    try:
        rows = _group_rows(employer_id, provider)
    except Exception:
        logger.exception("Failed to load connector token: provider=%s", provider)
        return Credential(None, "not_connected", provider)

    active = [row for row in rows if row.get("status") == "active"]
    if not active:
        expired = any(row.get("status") == "expired" for row in rows)
        return Credential(None, "expired" if expired else "not_connected", provider)

    row = active[0]
    row_provider = str(row["provider"])
    try:
        if not _needs_refresh(row, datetime.now(timezone.utc)):
            return Credential(decrypt_token(row.get("access_token")) or None, "ok", row_provider)
        lock = _refresh_locks.setdefault((employer_id, row_provider), asyncio.Lock())
        async with lock:
            return await _refresh(employer_id, row_provider)
    except TokenDecryptionError as exc:
        logger.error("Connector token unreadable: provider=%s reason=%s", row_provider, exc)
        return Credential(None, "expired", row_provider)


async def _refresh(employer_id: str, provider: str) -> Credential:
    # Re-read under the lock: another request may have refreshed already.
    rows = [r for r in _group_rows(employer_id, provider) if r.get("provider") == provider]
    row = rows[0] if rows else None
    if row is None or row.get("status") != "active":
        return Credential(None, "expired", provider)
    now = datetime.now(timezone.utc)
    if not _needs_refresh(row, now):
        return Credential(decrypt_token(row.get("access_token")) or None, "ok", provider)

    refresh_token = decrypt_token(row.get("refresh_token"))
    if not refresh_token or provider not in PROVIDER_MAP:
        _mark_expired(employer_id, provider)
        return Credential(None, "expired", provider)

    try:
        refreshed = await refresh_access_token(provider, refresh_token)
    except Exception as exc:
        logger.warning("Connector token refresh failed: provider=%s reason=%s", provider, str(exc)[:80])
        _mark_expired(employer_id, provider)
        return Credential(None, "expired", provider)

    supabase.table(TABLE).update({
        "access_token": encrypt_token(refreshed["access_token"]),
        "refresh_token": encrypt_token(refreshed["refresh_token"]),
        "expires_at": _expires_at(refreshed.get("expires_in"), now),
        "status": "active",
        "updated_at": now.isoformat(),
    }).eq("employer_id", employer_id).eq("provider", provider).execute()
    return Credential(refreshed["access_token"], "ok", provider)
