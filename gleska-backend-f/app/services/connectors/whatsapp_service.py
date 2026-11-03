"""WhatsApp connector — sends messages via MSG91 from the GO LESKA WhatsApp Business number.

WhatsApp's official API cannot send from personal accounts, so this connector is platform-wide
(``always_on``): messages come from ``MSG91_WHATSAPP_NUMBER``. Free-form text is only delivered
inside WhatsApp's 24-hour customer-service window; to start a conversation, use an approved template.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

MSG91_WHATSAPP_SESSION_URL = "https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/"
MSG91_WHATSAPP_TEMPLATE_URL = "https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/"


class WhatsAppService:
    """Send WhatsApp messages through the AI Assistant using MSG91."""

    @staticmethod
    async def send_message(
        phone: str,
        message: str,
        template_name: str | None = None,
    ) -> dict[str, Any]:
        auth_key = (settings.MSG91_AUTH_KEY or "").strip()
        sender = (settings.MSG91_WHATSAPP_NUMBER or "").strip().lstrip("+")
        if not auth_key:
            return {"sent": False, "error": "WhatsApp service not configured (MSG91_AUTH_KEY missing)."}
        if not sender.isdigit():
            return {"sent": False, "error": "WhatsApp service not configured (MSG91_WHATSAPP_NUMBER missing)."}

        phone = phone.strip().lstrip("+").replace(" ", "")
        if not phone.isdigit() or not 10 <= len(phone) <= 15:
            return {"sent": False, "error": "Invalid phone number format. Use the country code, e.g. 91XXXXXXXXXX."}
        if len(phone) == 10:
            phone = "91" + phone  # Indian mobile number without country code

        headers = {
            "authkey": auth_key,
            "Content-Type": "application/json",
        }

        if template_name:
            url = MSG91_WHATSAPP_TEMPLATE_URL
            payload: dict[str, Any] = {
                "integrated_number": sender,
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
            url = MSG91_WHATSAPP_SESSION_URL
            payload = {
                "integrated_number": sender,
                "recipient_number": phone,
                "content_type": "text",
                "text": message,
            }

        try:
            async with httpx.AsyncClient(timeout=settings.MSG91_TIMEOUT_SECONDS) as client:
                response = await client.post(url, json=payload, headers=headers)
        except httpx.TimeoutException:
            return {"sent": False, "error": "WhatsApp service timed out."}
        except httpx.HTTPError:
            return {"sent": False, "error": "WhatsApp service connection error."}

        try:
            data = response.json()
        except ValueError:
            data = {}
        # MSG91 can return HTTP 200 with {"status": "fail"} / {"hasError": true}.
        failed = isinstance(data, dict) and (data.get("hasError") or data.get("status") == "fail")
        if 200 <= response.status_code < 300 and not failed:
            return {
                "sent": True,
                "message_id": str(data.get("request_id") or data.get("message_uuid") or data.get("id") or "sent"),
                "sent_from": "goleska_business_number",
            }

        logger.error("MSG91 WhatsApp API error: status=%d", response.status_code)
        hint = (
            " Free-form messages only reach people who messaged this number in the last 24 hours; "
            "use an approved template to start a conversation."
            if not template_name
            else ""
        )
        return {"sent": False, "error": f"WhatsApp API rejected the message (status {response.status_code}).{hint}"}
