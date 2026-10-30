"""Team messaging connectors — Slack and Microsoft Teams."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.supabase import supabase

logger = logging.getLogger(__name__)


class SlackService:
    """Send notifications to Slack through the AI Assistant."""

    @staticmethod
    async def send_message(
        channel: str,
        message: str,
        employer_id: str,
    ) -> dict[str, Any]:
        access_token = await SlackService._get_oauth_token(employer_id, "slack")
        if not access_token:
            return {
                "sent": False,
                "error": (
                    "Slack is not connected. Please connect your Slack workspace "
                    "in Settings > Connectors to send notifications."
                ),
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

    @staticmethod
    async def _get_oauth_token(employer_id: str, provider: str) -> str | None:
        try:
            response = (
                supabase.table("connector_tokens")
                .select("access_token")
                .eq("employer_id", employer_id)
                .eq("provider", provider)
                .eq("status", "active")
                .execute()
            )
            data = getattr(response, "data", None)
            if not data:
                return None
            row = data[0] if isinstance(data, list) else data
            return str(row.get("access_token", "")) or None
        except Exception:
            logger.exception("Failed to retrieve Slack OAuth token")
            return None


class TeamsService:
    """Send notifications to Microsoft Teams through the AI Assistant."""

    @staticmethod
    async def send_message(
        webhook_url: str,
        title: str,
        message: str,
    ) -> dict[str, Any]:
        if not webhook_url or not webhook_url.startswith("https://"):
            return {"sent": False, "error": "Invalid Teams webhook URL."}

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
