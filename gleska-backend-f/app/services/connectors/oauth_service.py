"""OAuth 2.0 flow helpers for AI Assistant connectors.

Supports authorization-code flow for Google, Slack, Zoom, LinkedIn, Facebook/Instagram,
Microsoft, and GitHub. Each provider definition lists the authorize/token endpoints,
scopes, and client credentials source so a single init/callback pair handles them all.
"""

from __future__ import annotations

import base64
import hashlib
import logging
import secrets
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode

import httpx
import jwt

from app.core.config import settings

logger = logging.getLogger(__name__)

OAUTH_STATE_TTL_SECONDS = 600  # 10 minutes


@dataclass(frozen=True)
class OAuthProvider:
    name: str
    authorize_url: str
    token_url: str
    scopes: list[str]
    client_id_setting: str
    client_secret_setting: str
    extra_authorize_params: dict[str, str] | None = None
    uses_basic_auth: bool = False
    scope_separator: str = " "


# One Google OAuth client covers all 6 Google services (one project enables them all).
_GOOGLE_SCOPES = [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/forms.body",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.readonly",
    "openid",
    "email",
    "profile",
]

_GOOGLE_PROVIDER = OAuthProvider(
    name="google",
    authorize_url="https://accounts.google.com/o/oauth2/v2/auth",
    token_url="https://oauth2.googleapis.com/token",
    scopes=_GOOGLE_SCOPES,
    client_id_setting="GOOGLE_OAUTH_CLIENT_ID",
    client_secret_setting="GOOGLE_OAUTH_CLIENT_SECRET",
    extra_authorize_params={"access_type": "offline", "prompt": "consent"},
)

# One Microsoft client covers Outlook, Teams, Excel/OneDrive.
_MICROSOFT_PROVIDER = OAuthProvider(
    name="microsoft",
    authorize_url="https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    token_url="https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes=[
        "offline_access",
        "openid",
        "email",
        "profile",
        "Mail.Send",
        "Calendars.ReadWrite",
        "Files.ReadWrite",
        "ChannelMessage.Send",
    ],
    client_id_setting="MICROSOFT_OAUTH_CLIENT_ID",
    client_secret_setting="MICROSOFT_OAUTH_CLIENT_SECRET",
)

# One Facebook client handles Facebook Pages + Instagram Business.
_FACEBOOK_PROVIDER = OAuthProvider(
    name="facebook",
    authorize_url="https://www.facebook.com/v18.0/dialog/oauth",
    token_url="https://graph.facebook.com/v18.0/oauth/access_token",
    scopes=[
        "pages_manage_posts",
        "pages_read_engagement",
        "pages_show_list",
        "instagram_basic",
        "instagram_content_publish",
    ],
    client_id_setting="FACEBOOK_OAUTH_CLIENT_ID",
    client_secret_setting="FACEBOOK_OAUTH_CLIENT_SECRET",
    scope_separator=",",
)

PROVIDER_MAP: dict[str, OAuthProvider] = {
    # Google services — all share one OAuth client
    "google_calendar": _GOOGLE_PROVIDER,
    "google_drive": _GOOGLE_PROVIDER,
    "google_docs": _GOOGLE_PROVIDER,
    "google_sheets": _GOOGLE_PROVIDER,
    "google_forms": _GOOGLE_PROVIDER,
    "gmail": _GOOGLE_PROVIDER,
    # Slack
    "slack": OAuthProvider(
        name="slack",
        authorize_url="https://slack.com/oauth/v2/authorize",
        token_url="https://slack.com/api/oauth.v2.access",
        scopes=["chat:write", "channels:read", "groups:read", "im:write"],
        client_id_setting="SLACK_OAUTH_CLIENT_ID",
        client_secret_setting="SLACK_OAUTH_CLIENT_SECRET",
        scope_separator=",",
    ),
    # Zoom
    "zoom": OAuthProvider(
        name="zoom",
        authorize_url="https://zoom.us/oauth/authorize",
        token_url="https://zoom.us/oauth/token",
        scopes=["meeting:write:meeting", "user:read:user"],
        client_id_setting="ZOOM_OAUTH_CLIENT_ID",
        client_secret_setting="ZOOM_OAUTH_CLIENT_SECRET",
        uses_basic_auth=True,
    ),
    # LinkedIn
    "linkedin": OAuthProvider(
        name="linkedin",
        authorize_url="https://www.linkedin.com/oauth/v2/authorization",
        token_url="https://www.linkedin.com/oauth/v2/accessToken",
        scopes=["openid", "profile", "email", "w_member_social"],
        client_id_setting="LINKEDIN_OAUTH_CLIENT_ID",
        client_secret_setting="LINKEDIN_OAUTH_CLIENT_SECRET",
    ),
    # Facebook + Instagram — same client
    "facebook": _FACEBOOK_PROVIDER,
    "instagram": _FACEBOOK_PROVIDER,
    # Microsoft 365 / Outlook — same client
    "outlook": _MICROSOFT_PROVIDER,
    "microsoft_365": _MICROSOFT_PROVIDER,
    # GitHub
    "github_oauth": OAuthProvider(
        name="github",
        authorize_url="https://github.com/login/oauth/authorize",
        token_url="https://github.com/login/oauth/access_token",
        scopes=["read:user", "read:org", "public_repo"],
        client_id_setting="GITHUB_OAUTH_CLIENT_ID",
        client_secret_setting="GITHUB_OAUTH_CLIENT_SECRET",
    ),
}


def credential_group(provider_id: str) -> tuple[str, ...]:
    """Connector ids that share one OAuth grant with ``provider_id`` (itself first).

    One Google consent grants every Google scope, so connecting Gmail also authorizes
    Calendar, Drive, Docs, Sheets and Forms — and disconnecting any of them revokes all.
    """
    provider = PROVIDER_MAP.get(provider_id)
    if provider is None:
        return (provider_id,)
    siblings = [pid for pid, p in PROVIDER_MAP.items() if p is provider and pid != provider_id]
    return (provider_id, *siblings)


def is_oauth_configured(provider_id: str) -> bool:
    """Return True if OAuth client credentials are set for the provider."""
    provider = PROVIDER_MAP.get(provider_id)
    if not provider:
        return False
    client_id = getattr(settings, provider.client_id_setting, "")
    client_secret = getattr(settings, provider.client_secret_setting, "")
    return bool(client_id and client_secret)


def get_redirect_uri(provider_id: str) -> str:
    """Build the redirect URI using the provider's canonical name so all Google
    connectors (gmail, google_calendar, …) share one URI: /oauth/google/callback."""
    base = settings.OAUTH_CALLBACK_BASE_URL.rstrip("/")
    provider = PROVIDER_MAP.get(provider_id)
    canonical = provider.name if provider else provider_id
    return f"{base}{settings.API_V1_PREFIX}/connectors/oauth/{canonical}/callback"


def _encode_state(employer_id: str, provider_id: str) -> str:
    """Encode a short-lived signed state token so we can verify the callback."""
    payload = {
        "employer_id": employer_id,
        "provider": provider_id,
        "nonce": secrets.token_urlsafe(16),
        "exp": int(time.time()) + OAUTH_STATE_TTL_SECONDS,
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm="HS256")


def _decode_state(state: str) -> dict[str, Any]:
    return jwt.decode(state, settings.JWT_SECRET_KEY, algorithms=["HS256"])


def build_authorize_url(provider_id: str, employer_id: str) -> str:
    """Return the provider's authorize URL for this employer."""
    provider = PROVIDER_MAP.get(provider_id)
    if provider is None:
        raise ValueError(f"UNSUPPORTED_OAUTH_PROVIDER:{provider_id}")

    client_id = getattr(settings, provider.client_id_setting, "")
    if not client_id:
        raise ValueError(f"OAUTH_CLIENT_NOT_CONFIGURED:{provider_id}")

    state = _encode_state(employer_id, provider_id)

    params = {
        "client_id": client_id,
        "redirect_uri": get_redirect_uri(provider_id),
        "response_type": "code",
        "scope": provider.scope_separator.join(provider.scopes),
        "state": state,
    }
    if provider.extra_authorize_params:
        params.update(provider.extra_authorize_params)

    return f"{provider.authorize_url}?{urlencode(params)}"


async def exchange_code_for_token(
    provider_id: str,
    code: str,
    state: str,
) -> dict[str, Any]:
    """Exchange an authorization code for an access token and verify state."""
    provider = PROVIDER_MAP.get(provider_id)
    if provider is None:
        raise ValueError(f"UNSUPPORTED_OAUTH_PROVIDER:{provider_id}")

    try:
        state_data = _decode_state(state)
    except jwt.PyJWTError as exc:
        raise ValueError(f"INVALID_STATE:{exc}") from exc

    if state_data.get("provider") != provider_id:
        raise ValueError("STATE_PROVIDER_MISMATCH")

    body = await _token_request(provider_id, provider, {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": get_redirect_uri(provider_id),
    })

    # Slack puts bot token in authed_user or access_token depending on scope type
    access_token = body.get("access_token") or body.get("authed_user", {}).get("access_token")
    if not access_token:
        raise ValueError("TOKEN_EXCHANGE_NO_TOKEN")

    refresh_token = body.get("refresh_token")
    expires_in = body.get("expires_in")

    if provider is _FACEBOOK_PROVIDER:
        # Code-flow user tokens last ~1-2 hours and Meta issues no refresh token;
        # exchange for a ~60-day long-lived token so posting keeps working.
        long_lived = await _facebook_long_lived_token(access_token)
        if long_lived:
            access_token = long_lived.get("access_token") or access_token
            expires_in = long_lived.get("expires_in", expires_in)

    return {
        "employer_id": state_data["employer_id"],
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_in": expires_in,
    }


async def refresh_access_token(provider_id: str, refresh_token: str) -> dict[str, Any]:
    """Use a stored refresh token to obtain a new access token.

    Returns ``access_token``, ``refresh_token`` (the rotated one if the provider issued it,
    otherwise the one passed in) and ``expires_in``. Raises ValueError on failure.
    """
    provider = PROVIDER_MAP.get(provider_id)
    if provider is None:
        raise ValueError("UNSUPPORTED_OAUTH_PROVIDER")
    data = {"grant_type": "refresh_token", "refresh_token": refresh_token}
    if provider is _MICROSOFT_PROVIDER:
        data["scope"] = " ".join(provider.scopes)
    body = await _token_request(provider_id, provider, data)
    access_token = body.get("access_token")
    if not access_token:
        raise ValueError("TOKEN_REFRESH_NO_TOKEN")
    return {
        "access_token": access_token,
        # Zoom and Microsoft rotate refresh tokens; Google keeps the original.
        "refresh_token": body.get("refresh_token") or refresh_token,
        "expires_in": body.get("expires_in"),
    }


async def _token_request(provider_id: str, provider: OAuthProvider, data: dict[str, str]) -> dict[str, Any]:
    client_id = getattr(settings, provider.client_id_setting, "")
    client_secret = getattr(settings, provider.client_secret_setting, "")
    if not client_id or not client_secret:
        raise ValueError(f"OAUTH_CLIENT_NOT_CONFIGURED:{provider_id}")

    data = dict(data)
    headers = {"Accept": "application/json"}
    if provider.uses_basic_auth:
        basic = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
        headers["Authorization"] = f"Basic {basic}"
    else:
        data["client_id"] = client_id
        data["client_secret"] = client_secret

    async with httpx.AsyncClient(timeout=30) as http:
        resp = await http.post(provider.token_url, data=data, headers=headers)

    try:
        body = resp.json()
    except Exception as exc:
        raise ValueError(f"TOKEN_ENDPOINT_INVALID_RESPONSE:{resp.status_code}") from exc

    # Never log the body: it carries tokens. Provider error codes only.
    if resp.status_code >= 400:
        error = body.get("error") if isinstance(body, dict) else None
        if isinstance(error, dict):
            error = error.get("code") or error.get("type")
        logger.warning(
            "OAuth token request failed: provider=%s grant=%s status=%s error=%s",
            provider_id, data.get("grant_type"), resp.status_code, error,
        )
        raise ValueError(f"TOKEN_REQUEST_FAILED:{error or resp.status_code}")

    # Slack returns 200 with {ok: false, error: ...}
    if provider_id == "slack" and not body.get("ok"):
        raise ValueError(f"TOKEN_REQUEST_FAILED:{body.get('error', 'unknown')}")
    return body


async def _facebook_long_lived_token(short_lived_token: str) -> dict[str, Any] | None:
    try:
        async with httpx.AsyncClient(timeout=30) as http:
            resp = await http.post(
                _FACEBOOK_PROVIDER.token_url,
                data={
                    "grant_type": "fb_exchange_token",
                    "client_id": settings.FACEBOOK_OAUTH_CLIENT_ID,
                    "client_secret": settings.FACEBOOK_OAUTH_CLIENT_SECRET,
                    "fb_exchange_token": short_lived_token,
                },
            )
        if resp.status_code == 200:
            return resp.json()
        logger.warning("Facebook long-lived token exchange failed: status=%s", resp.status_code)
    except (httpx.HTTPError, ValueError):
        logger.warning("Facebook long-lived token exchange errored")
    return None
