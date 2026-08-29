"""Email service for sending contact inquiry notifications via Resend."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

RESEND_API_URL = "https://api.resend.com/emails"


class EmailService:
    """Service for sending emails via configured email provider (Resend)."""

    @staticmethod
    async def send_contact_inquiry(
        name: str,
        company: str | None,
        sender_email: str,
        message: str,
    ) -> dict[str, Any]:
        """
        Send a contact inquiry email to the configured recipient via Resend.
        
        Args:
            name: Inquiry sender's name
            company: Inquiry sender's company (optional)
            sender_email: Inquiry sender's email address
            message: The inquiry message
            
        Returns:
            Dictionary with success status, Resend email id, and recipient details.
            
        Raises:
            ValueError: If email service configuration is missing or invalid.
            RuntimeError: If Resend API returns an error or connection fails.
        """
        api_key = (settings.RESEND_API_KEY or "").strip()
        recipient = (settings.CONTACT_RECIPIENT_EMAIL or "").strip()
        from_address = (settings.EMAIL_FROM_ADDRESS or "").strip()
        from_name = (settings.EMAIL_FROM_NAME or "").strip()

        if not api_key:
            logger.error("RESEND_API_KEY is not configured")
            raise ValueError("RESEND_API_KEY_NOT_CONFIGURED")

        if not recipient:
            logger.error("CONTACT_RECIPIENT_EMAIL is not configured")
            raise ValueError("CONTACT_RECIPIENT_EMAIL_NOT_CONFIGURED")

        if not from_address:
            logger.error("EMAIL_FROM_ADDRESS is not configured")
            raise ValueError("EMAIL_FROM_ADDRESS_NOT_CONFIGURED")

        # Format sender header
        from_header = f"{from_name} <{from_address}>" if from_name else from_address

        # Format subject
        subject = f"New Business Inquiry — {name}"

        # Format plain-text body
        company_display = company if company and company.strip() else "Not specified"
        body = (
            f"GO LESKA — New Business Inquiry\n\n"
            f"Name: {name}\n"
            f"Company: {company_display}\n"
            f"Email: {sender_email}\n\n"
            f"Business Need:\n"
            f"{message}\n"
        )

        payload = {
            "from": from_header,
            "to": [recipient],
            "subject": subject,
            "reply_to": sender_email.strip(),
            "text": body,
        }

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

        timeout = getattr(settings, "EMAIL_TIMEOUT_SECONDS", 15)

        logger.info(
            "Attempting to send contact inquiry email via Resend to recipient=%s, reply_to=%s",
            recipient,
            sender_email[-6:] if len(sender_email) >= 6 else sender_email,
        )

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(
                    RESEND_API_URL,
                    json=payload,
                    headers=headers,
                )

            if 200 <= response.status_code < 300:
                data = response.json()
                email_id = data.get("id", "unknown")
                logger.info(
                    "Resend accepted contact inquiry email successfully with id=%s",
                    email_id,
                )
                return {
                    "success": True,
                    "id": email_id,
                    "recipient": recipient,
                }

            # Handle 4xx / 5xx responses from Resend safely
            safe_error_detail = "Unknown provider error"
            try:
                err_data = response.json()
                safe_error_detail = err_data.get("message") or err_data.get("error") or str(err_data)
            except Exception:
                safe_error_detail = response.text[:200]

            logger.error(
                "Resend API rejected email with status_code=%d: %s",
                response.status_code,
                safe_error_detail,
            )
            raise RuntimeError(f"Resend email sending failed (status {response.status_code}): {safe_error_detail}")

        except (httpx.TimeoutException, httpx.ConnectTimeout) as exc:
            logger.error("Resend API request timed out after %ds", timeout)
            raise RuntimeError("Resend API request timed out") from exc

        except (httpx.RequestError, httpx.NetworkError) as exc:
            logger.error("Resend API network error occurred: %s", exc.__class__.__name__)
            raise RuntimeError("Resend API network error") from exc

