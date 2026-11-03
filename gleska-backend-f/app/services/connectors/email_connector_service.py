"""Email connector — sends emails from the employer's own mailbox, or via Resend as fallback.

Order: connected Gmail → connected Outlook → platform Resend sender. If a mailbox is connected
but its grant has expired, the employer is asked to reconnect rather than the email silently
going out from the platform address.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.config import settings
from app.services.connectors import token_store
from app.services.connectors.gmail_service import GmailService

logger = logging.getLogger(__name__)

RESEND_API_URL = "https://api.resend.com/emails"
GRAPH_SEND_MAIL_URL = "https://graph.microsoft.com/v1.0/me/sendMail"


class EmailConnectorService:
    """Send emails through the AI Assistant."""

    @staticmethod
    async def send_email(
        to: str,
        subject: str,
        body: str,
        purpose: str,
        employer_id: str | None = None,
        employer_name: str | None = None,
    ) -> dict[str, Any]:
        to, subject, body = to.strip(), subject.strip(), body.strip()
        if employer_id:
            gmail = await token_store.get_credential(employer_id, "gmail")
            if gmail.token:
                return await GmailService.send_email(gmail.token, to, subject, body)
            outlook = await token_store.get_credential(employer_id, "outlook")
            if outlook.token:
                return await EmailConnectorService._send_via_outlook(outlook.token, to, subject, body)
            if gmail.status == "expired":
                return {"sent": False, "error": gmail.error_message("Gmail")}
            if outlook.status == "expired":
                return {"sent": False, "error": outlook.error_message("Outlook")}
        return await EmailConnectorService._send_via_resend(to, subject, body, purpose, employer_name)

    @staticmethod
    async def _send_via_outlook(access_token: str, to: str, subject: str, body: str) -> dict[str, Any]:
        payload = {
            "message": {
                "subject": subject,
                "body": {"contentType": "Text", "content": body},
                "toRecipients": [{"emailAddress": {"address": to}}],
            },
            "saveToSentItems": True,
        }
        try:
            async with httpx.AsyncClient(timeout=settings.EMAIL_TIMEOUT_SECONDS) as client:
                response = await client.post(
                    GRAPH_SEND_MAIL_URL,
                    json=payload,
                    headers={"Authorization": f"Bearer {access_token}"},
                )
        except httpx.TimeoutException:
            return {"sent": False, "error": "Outlook service timed out."}
        except httpx.HTTPError:
            return {"sent": False, "error": "Outlook service connection error."}

        if response.status_code == 202:
            return {"sent": True, "email_id": "", "recipient": to, "sent_via": "outlook"}
        if response.status_code in (401, 403):
            return {"sent": False, "error": "Outlook refused the request. Please reconnect Outlook in Settings > Connectors."}
        logger.error("Outlook sendMail failed: status=%d", response.status_code)
        return {"sent": False, "error": f"Outlook returned status {response.status_code}."}

    @staticmethod
    async def _send_via_resend(
        to: str,
        subject: str,
        body: str,
        purpose: str,
        employer_name: str | None,
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
                    "sent_via": "goleska",
                }

            logger.error("Resend rejected email: status=%d", response.status_code)
            return {"sent": False, "error": f"Email provider returned status {response.status_code}."}

        except httpx.TimeoutException:
            return {"sent": False, "error": "Email service timed out."}
        except httpx.HTTPError:
            return {"sent": False, "error": "Email service connection error."}
