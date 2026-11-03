"""Connector management endpoints — list, connect, disconnect external services."""

from __future__ import annotations

import logging
from typing import Any

import jwt

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.security import require_employer
from app.schemas.auth import UserResponse
from app.services.connectors import token_store
from app.services.connectors.messaging_service import is_allowed_teams_webhook
from app.services.connectors.oauth_service import (
    PROVIDER_MAP,
    build_authorize_url,
    credential_group,
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
        "description": "Read your inbox and send emails from your Gmail account",
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
        "description": "Send WhatsApp messages to candidates from the GO LESKA business number (via MSG91)",
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
        "description": "Post updates to a Teams channel (paste the channel's incoming webhook URL)",
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
        connected = token_store.connection_statuses(employer_id)
    except Exception:
        logger.exception("Failed to list connectors for employer_id=%s", employer_id)
        connected = {}

    connectors = []
    for provider_id, meta in SUPPORTED_PROVIDERS.items():
        row = connected.get(provider_id, {})
        has_oauth_support = provider_id in PROVIDER_MAP
        always_on = meta.get("always_on", False)
        connectors.append({
            "id": provider_id,
            "name": meta["name"],
            "description": meta["description"],
            "icon": meta["icon"],
            "requires_oauth": meta["oauth"],
            "oauth_configured": has_oauth_support and is_oauth_configured(provider_id),
            "always_on": always_on,
            "connected": always_on or row.get("status") == "active",
            # Additive: "active" | "expired" | "disconnected" | null — "expired" means reconnect.
            "status": "active" if always_on else row.get("status"),
            "connected_at": row.get("connected_at"),
            # A refreshable token renews itself, so its access-token expiry is not user-facing.
            "expires_at": None if row.get("refresh_token") else row.get("expires_at"),
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

    # The URL provider_id may be a canonical name (e.g. "google") while the
    # state token carries the original connector id (e.g. "gmail").  Use the
    # original so exchange_code_for_token passes the state-mismatch check and
    # the token is stored under the correct connector id.
    try:
        state_data = jwt.decode(state, settings.JWT_SECRET_KEY, algorithms=["HS256"])
        original_provider = state_data.get("provider", provider_id)
    except jwt.PyJWTError:
        original_provider = provider_id

    try:
        result = await exchange_code_for_token(original_provider, code, state)
    except ValueError as exc:
        logger.warning("OAuth exchange failed for provider=%s: %s", original_provider, str(exc)[:120])
        return RedirectResponse(
            url=f"{connectors_page}?error=exchange_failed&provider={original_provider}",
            status_code=302,
        )

    try:
        token_store.store_token(
            employer_id=result["employer_id"],
            provider=original_provider,
            access_token=result["access_token"],
            refresh_token=result.get("refresh_token"),
            expires_in=result.get("expires_in"),
        )
    except Exception:
        logger.exception("Failed to persist OAuth token for provider=%s", original_provider)
        return RedirectResponse(
            url=f"{connectors_page}?error=storage_failed&provider={original_provider}",
            status_code=302,
        )

    return RedirectResponse(
        url=f"{connectors_page}?connected={original_provider}",
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
    if payload.provider == "microsoft_teams" and not is_allowed_teams_webhook(payload.access_token):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="INVALID_TEAMS_WEBHOOK_URL")

    employer = JobService._employer_profile(user)
    employer_id = str(employer["id"])

    try:
        token_store.store_token(
            employer_id=employer_id,
            provider=payload.provider,
            access_token=payload.access_token.strip(),
            refresh_token=payload.refresh_token,
            expires_in=payload.expires_in_seconds,
            metadata=payload.metadata,
        )
    except Exception as exc:
        logger.exception("Failed to store connector token for provider=%s", payload.provider)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="CONNECT_FAILED") from exc

    return {"connected": True, "provider": payload.provider}


@router.post("/disconnect")
async def disconnect_provider(
    payload: ConnectorDisconnectRequest,
    user: UserResponse = Depends(require_employer),
):
    """Revoke stored credentials for a provider (and connectors sharing its OAuth grant)."""
    if payload.provider not in SUPPORTED_PROVIDERS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="UNSUPPORTED_PROVIDER")

    employer = JobService._employer_profile(user)
    employer_id = str(employer["id"])

    try:
        token_store.disconnect(employer_id, payload.provider)
    except Exception as exc:
        logger.exception("Failed to disconnect provider=%s", payload.provider)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="DISCONNECT_FAILED") from exc

    return {
        "disconnected": True,
        "provider": payload.provider,
        # Additive: every connector id that shared this grant and is now disconnected too.
        "disconnected_providers": list(credential_group(payload.provider)),
    }
