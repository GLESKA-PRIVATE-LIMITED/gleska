"""Connector management endpoints — list, connect, disconnect external services."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.security import require_employer
from app.core.supabase import supabase
from app.schemas.auth import UserResponse
from app.services.connectors.oauth_service import (
    PROVIDER_MAP,
    build_authorize_url,
    exchange_code_for_token,
    is_oauth_configured,
)
from app.services.job_service import JobService

router = APIRouter(prefix="/connectors", tags=["connectors"])
logger = logging.getLogger(__name__)


SUPPORTED_PROVIDERS = {
    "google_drive": {
        "name": "Google Drive",
        "description": "Fetch files from Drive for job templates and documents",
        "oauth": True,
        "icon": "drive",
    },
    "google_docs": {
        "name": "Google Docs",
        "description": "Read and create documents",
        "oauth": True,
        "icon": "docs",
    },
    "google_sheets": {
        "name": "Google Sheets",
        "description": "Bulk import jobs and worker data from spreadsheets",
        "oauth": True,
        "icon": "sheets",
    },
    "google_forms": {
        "name": "Google Forms",
        "description": "Create application forms for jobs",
        "oauth": True,
        "icon": "forms",
    },
    "google_calendar": {
        "name": "Google Calendar",
        "description": "Schedule interviews and site visits",
        "oauth": True,
        "icon": "calendar",
    },
    "gmail": {
        "name": "Gmail",
        "description": "Send emails via the assistant",
        "oauth": True,
        "icon": "gmail",
    },
    "outlook": {
        "name": "Outlook",
        "description": "Send emails and schedule meetings via Microsoft 365",
        "oauth": True,
        "icon": "outlook",
    },
    "microsoft_365": {
        "name": "Microsoft 365 / Excel",
        "description": "Import Excel data and access OneDrive files",
        "oauth": True,
        "icon": "office",
    },
    "whatsapp": {
        "name": "WhatsApp",
        "description": "Send WhatsApp messages to candidates (via MSG91)",
        "oauth": False,
        "icon": "whatsapp",
        "always_on": True,
    },
    "linkedin": {
        "name": "LinkedIn",
        "description": "Enrich candidate profiles with LinkedIn data",
        "oauth": True,
        "icon": "linkedin",
    },
    "slack": {
        "name": "Slack",
        "description": "Post hiring updates to Slack channels",
        "oauth": True,
        "icon": "slack",
    },
    "microsoft_teams": {
        "name": "Microsoft Teams",
        "description": "Post updates via Teams webhooks",
        "oauth": False,
        "icon": "teams",
    },
    "zoom": {
        "name": "Zoom",
        "description": "Create video meetings for interviews",
        "oauth": True,
        "icon": "zoom",
    },
    "instagram": {
        "name": "Instagram",
        "description": "Share job listings on Instagram",
        "oauth": True,
        "icon": "instagram",
    },
    "facebook": {
        "name": "Facebook",
        "description": "Share job listings on Facebook Pages",
        "oauth": True,
        "icon": "facebook",
    },
    "github": {
        "name": "GitHub",
        "description": "View candidate code portfolios (public data)",
        "oauth": False,
        "icon": "github",
        "always_on": True,
    },
    "tallyprime": {
        "name": "TallyPrime",
        "description": "Fetch budget and payment data from Tally",
        "oauth": False,
        "icon": "tally",
    },
    "ocr": {
        "name": "OCR / Document Intelligence",
        "description": "Extract data from PDF, image, and office documents",
        "oauth": False,
        "icon": "ocr",
        "always_on": True,
    },
}


class ConnectorToken(BaseModel):
    provider: str
    access_token: str = Field(min_length=1, max_length=4000)
    refresh_token: str | None = None
    expires_in_seconds: int | None = Field(default=None, ge=0, le=31_536_000)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ConnectorDisconnectRequest(BaseModel):
    provider: str


@router.get("")
async def list_connectors(user: UserResponse = Depends(require_employer)):
    """List all available connectors and their connection status for this employer."""
    employer = JobService._employer_profile(user)
    employer_id = str(employer["id"])

    try:
        response = (
            supabase.table("connector_tokens")
            .select("provider,status,connected_at,expires_at")
            .eq("employer_id", employer_id)
            .execute()
        )
        connected = {
            row["provider"]: row
            for row in (getattr(response, "data", None) or [])
        }
    except Exception:
        logger.exception("Failed to list connectors for employer_id=%s", employer_id)
        connected = {}

    connectors = []
    for provider_id, meta in SUPPORTED_PROVIDERS.items():
        row = connected.get(provider_id, {})
        has_oauth_support = provider_id in PROVIDER_MAP
        connectors.append({
            "id": provider_id,
            "name": meta["name"],
            "description": meta["description"],
            "icon": meta["icon"],
            "requires_oauth": meta["oauth"],
            "oauth_configured": has_oauth_support and is_oauth_configured(provider_id),
            "always_on": meta.get("always_on", False),
            "connected": meta.get("always_on", False) or row.get("status") == "active",
            "connected_at": row.get("connected_at"),
            "expires_at": row.get("expires_at"),
        })

    return {"connectors": connectors}


@router.get("/oauth/{provider_id}/init")
async def oauth_init(provider_id: str, user: UserResponse = Depends(require_employer)):
    """Return the provider's authorize URL so the frontend can redirect the user."""
    if provider_id not in SUPPORTED_PROVIDERS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="UNSUPPORTED_PROVIDER")
    if provider_id not in PROVIDER_MAP:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OAUTH_NOT_SUPPORTED_FOR_PROVIDER")
    if not is_oauth_configured(provider_id):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OAUTH_CLIENT_NOT_CONFIGURED",
        )

    employer = JobService._employer_profile(user)
    employer_id = str(employer["id"])

    try:
        authorize_url = build_authorize_url(provider_id, employer_id)
    except ValueError as exc:
        logger.exception("Failed to build authorize URL for provider=%s", provider_id)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc

    return {"authorize_url": authorize_url}


@router.get("/oauth/{provider_id}/callback")
async def oauth_callback(
    provider_id: str,
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
):
    """OAuth redirect target — exchanges code for access token and stores it."""
    frontend = settings.FRONTEND_URL.rstrip("/")
    connectors_page = f"{frontend}/employer/connectors"

    if error or not code or not state:
        return RedirectResponse(
            url=f"{connectors_page}?error={error or 'MISSING_CODE'}&provider={provider_id}",
            status_code=302,
        )

    try:
        result = await exchange_code_for_token(provider_id, code, state)
    except ValueError as exc:
        logger.warning("OAuth exchange failed for provider=%s: %s", provider_id, exc)
        return RedirectResponse(
            url=f"{connectors_page}?error=exchange_failed&provider={provider_id}",
            status_code=302,
        )

    now = datetime.now(timezone.utc)
    expires_at = None
    if result.get("expires_in"):
        from datetime import timedelta
        expires_at = (now + timedelta(seconds=int(result["expires_in"]))).isoformat()

    row = {
        "employer_id": result["employer_id"],
        "provider": provider_id,
        "access_token": result["access_token"],
        "refresh_token": result.get("refresh_token"),
        "expires_at": expires_at,
        "status": "active",
        "connected_at": now.isoformat(),
        "connector_metadata": {},
    }

    try:
        supabase.table("connector_tokens").upsert(
            row,
            on_conflict="employer_id,provider",
        ).execute()
    except Exception:
        logger.exception("Failed to persist OAuth token for provider=%s", provider_id)
        return RedirectResponse(
            url=f"{connectors_page}?error=storage_failed&provider={provider_id}",
            status_code=302,
        )

    return RedirectResponse(
        url=f"{connectors_page}?connected={provider_id}",
        status_code=302,
    )


@router.post("/connect")
async def connect_provider(
    payload: ConnectorToken,
    user: UserResponse = Depends(require_employer),
):
    """Store an OAuth or API token for a provider.

    OAuth flows should be handled by the frontend (redirecting the user to the provider's
    authorization page); the resulting access_token is then posted here for storage.
    """
    if payload.provider not in SUPPORTED_PROVIDERS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="UNSUPPORTED_PROVIDER")

    employer = JobService._employer_profile(user)
    employer_id = str(employer["id"])

    now = datetime.now(timezone.utc)
    expires_at = None
    if payload.expires_in_seconds:
        from datetime import timedelta
        expires_at = (now + timedelta(seconds=payload.expires_in_seconds)).isoformat()

    row = {
        "employer_id": employer_id,
        "provider": payload.provider,
        "access_token": payload.access_token,
        "refresh_token": payload.refresh_token,
        "expires_at": expires_at,
        "status": "active",
        "connected_at": now.isoformat(),
        "connector_metadata": payload.metadata,
    }

    try:
        supabase.table("connector_tokens").upsert(
            row,
            on_conflict="employer_id,provider",
        ).execute()
    except Exception as exc:
        logger.exception("Failed to store connector token for provider=%s", payload.provider)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="CONNECT_FAILED") from exc

    return {"connected": True, "provider": payload.provider}


@router.post("/disconnect")
async def disconnect_provider(
    payload: ConnectorDisconnectRequest,
    user: UserResponse = Depends(require_employer),
):
    """Revoke stored credentials for a provider."""
    if payload.provider not in SUPPORTED_PROVIDERS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="UNSUPPORTED_PROVIDER")

    employer = JobService._employer_profile(user)
    employer_id = str(employer["id"])

    try:
        supabase.table("connector_tokens").update({"status": "disconnected"}).eq(
            "employer_id", employer_id,
        ).eq("provider", payload.provider).execute()
    except Exception as exc:
        logger.exception("Failed to disconnect provider=%s", payload.provider)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="DISCONNECT_FAILED") from exc

    return {"disconnected": True, "provider": payload.provider}
