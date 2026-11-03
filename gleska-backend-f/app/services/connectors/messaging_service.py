"""Team messaging connectors — Slack and Microsoft Teams."""

from __future__ import annotations

import logging
from typing import Any
from urllib.parse import urlparse

import httpx

from app.services.connectors import token_store

logger = logging.getLogger(__name__)

# Teams incoming-webhook hosts (classic connectors and Power Automate workflows).
# The backend POSTs to this URL, so arbitrary hosts would be a server-side request forgery.
TEAMS_WEBHOOK_HOST_SUFFIXES = (".webhook.office.com", ".logic.azure.com", ".powerplatform.com")


def is_allowed_teams_webhook(url: str) -> bool:
    try:
        parsed = urlparse((url or "").strip())
    except ValueError:
        return False
    host = (parsed.hostname or "").lower()
    return (
        parsed.scheme == "https"
        and not parsed.username
        and not parsed.password
        and any(host.endswith(suffix) for suffix in TEAMS_WEBHOOK_HOST_SUFFIXES)
    )


class SlackService:
    """Send notifications to Slack through the AI Assistant."""

    @staticmethod
    async def send_message(
        channel: str,
        message: str,
        employer_id: str,
    ) -> dict[str, Any]:
        credential = await token_store.get_credential(employer_id, "slack")
        access_token = credential.token
        if not access_token:
            return {
                "sent": False,
                "error": credential.error_message("Slack"),
            }

        channel = channel.strip().lstrip("#")

        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.post(
                    "https://slack.com/api/chat.postMessage",
                    json={"channel": channel, "text": message, "unfurl_links": False},
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Content-Type": "application/json",
                    },
                )

            data = response.json()
            if data.get("ok"):
                return {
                    "sent": True,
                    "timestamp": data.get("ts", ""),
                    "channel": data.get("channel", channel),
                }

            error = data.get("error", "unknown_error")
            if error == "channel_not_found":
                return {"sent": False, "error": f"Slack channel '{channel}' not found."}
            if error in ("invalid_auth", "token_expired"):
                return {"sent": False, "error": "Slack token expired. Please reconnect."}
            return {"sent": False, "error": f"Slack API error: {error}"}

        except httpx.TimeoutException:
            return {"sent": False, "error": "Slack service timed out."}
        except httpx.HTTPError:
            return {"sent": False, "error": "Slack service connection error."}



class TeamsService:
    """Send notifications to Microsoft Teams through the AI Assistant."""

    @staticmethod
    async def send_message(
        title: str,
        message: str,
        employer_id: str,
    ) -> dict[str, Any]:
        # The webhook URL is the credential the employer saved in Settings > Connectors;
        # it is never taken from model output.
        credential = await token_store.get_credential(employer_id, "microsoft_teams")
        webhook_url = credential.token
        if not webhook_url:
            return {"sent": False, "error": credential.error_message("Microsoft Teams")}
        if not is_allowed_teams_webhook(webhook_url):
            return {
                "sent": False,
                "error": "The saved Teams webhook URL is not a Microsoft webhook. Please reconnect Teams in Settings > Connectors.",
            }

        card = {
            "@type": "MessageCard",
            "@context": "http://schema.org/extensions",
            "summary": title,
            "themeColor": "0076D7",
            "title": title,
            "sections": [{"text": message}],
        }

        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.post(
                    webhook_url,
                    json=card,
                    headers={"Content-Type": "application/json"},
                )

            if 200 <= response.status_code < 300:
                return {"sent": True}

            return {"sent": False, "error": f"Teams webhook returned status {response.status_code}."}

        except httpx.TimeoutException:
            return {"sent": False, "error": "Teams service timed out."}
        except httpx.HTTPError:
            return {"sent": False, "error": "Teams service connection error."}
