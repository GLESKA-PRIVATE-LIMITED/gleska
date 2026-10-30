"""WhatsApp connector — sends messages via MSG91 WhatsApp API."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

MSG91_WHATSAPP_URL = "https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/"


class WhatsAppService:
    """Send WhatsApp messages through the AI Assistant using MSG91."""

    @staticmethod
    async def send_message(
        phone: str,
        message: str,
        template_name: str | None = None,
    ) -> dict[str, Any]:
        auth_key = (settings.MSG91_AUTH_KEY or "").strip()
        if not auth_key:
            return {"sent": False, "error": "WhatsApp service not configured (MSG91_AUTH_KEY missing)."}

        phone = phone.strip().lstrip("+")
        if not phone.isdigit() or len(phone) < 10:
            return {"sent": False, "error": "Invalid phone number format."}

        headers = {
            "authkey": auth_key,
            "Content-Type": "application/json",
        }

        if template_name:
            payload: dict[str, Any] = {
                "integrated_number": settings.MSG91_WIDGET_ID or "",
                "content_type": "template",
                "payload": {
                    "messaging_product": "whatsapp",
                    "type": "template",
                    "template": {
                        "name": template_name,
                        "language": {"code": "en", "policy": "deterministic"},
                        "to_and_components": [{"to": [phone]}],
                    },
                },
            }
        else:
            payload = {
                "integrated_number": settings.MSG91_WIDGET_ID or "",
                "content_type": "text",
                "payload": {
                    "messaging_product": "whatsapp",
                    "type": "text",
                    "text": {"body": message},
                    "to": phone,
                },
            }

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                response = await client.post(
                    MSG91_WHATSAPP_URL,
                    json=payload,
                    headers=headers,
                )

            if 200 <= response.status_code < 300:
                data = response.json()
                return {
                    "sent": True,
                    "message_id": data.get("request_id") or data.get("id", "sent"),
                }

            logger.error("MSG91 WhatsApp API error: status=%d body=%s", response.status_code, response.text[:200])
            return {"sent": False, "error": f"WhatsApp API returned status {response.status_code}."}

        except httpx.TimeoutException:
            return {"sent": False, "error": "WhatsApp service timed out."}
        except httpx.HTTPError:
            return {"sent": False, "error": "WhatsApp service connection error."}
