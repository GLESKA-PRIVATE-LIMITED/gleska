"""Email connector — sends professional emails via Resend on behalf of the employer."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

RESEND_API_URL = "https://api.resend.com/emails"


class EmailConnectorService:
    """Send emails through the AI Assistant using the configured Resend provider."""

    @staticmethod
    async def send_email(
        to: str,
        subject: str,
        body: str,
        purpose: str,
        employer_name: str | None = None,
    ) -> dict[str, Any]:
        api_key = (settings.RESEND_API_KEY or "").strip()
        from_address = (settings.EMAIL_FROM_ADDRESS or "").strip()
        from_name = employer_name or (settings.EMAIL_FROM_NAME or "GO LESKA").strip()

        if not api_key:
            return {"sent": False, "error": "Email service not configured (RESEND_API_KEY missing)."}
        if not from_address:
            return {"sent": False, "error": "Email service not configured (EMAIL_FROM_ADDRESS missing)."}

        from_header = f"{from_name} <{from_address}>"

        payload = {
            "from": from_header,
            "to": [to.strip()],
            "subject": subject.strip(),
            "text": body.strip(),
            "tags": [{"name": "purpose", "value": purpose}],
        }

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

        timeout = settings.EMAIL_TIMEOUT_SECONDS

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(RESEND_API_URL, json=payload, headers=headers)

            if 200 <= response.status_code < 300:
                data = response.json()
                return {
                    "sent": True,
                    "email_id": data.get("id", "unknown"),
                    "recipient": to.strip(),
                }

            logger.error("Resend rejected email: status=%d", response.status_code)
            return {"sent": False, "error": f"Email provider returned status {response.status_code}."}

        except httpx.TimeoutException:
            return {"sent": False, "error": "Email service timed out."}
        except httpx.HTTPError:
            return {"sent": False, "error": "Email service connection error."}
