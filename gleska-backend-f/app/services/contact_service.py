"""Contact inquiry service for processing business inquiries."""

from __future__ import annotations

import logging
from typing import Any

from app.core.supabase import supabase
from app.services.email_service import EmailService

logger = logging.getLogger(__name__)


class ContactService:
    """Service for handling contact inquiries."""

    @staticmethod
    async def submit_inquiry(
        name: str,
        company: str | None,
        email: str,
        message: str,
    ) -> dict[str, Any]:
        """
        Process a contact inquiry: store it and send notification email.
        
        Args:
            name: Inquiry sender's name
            company: Inquiry sender's company (optional)
            email: Inquiry sender's email
            message: The inquiry message
            
        Returns:
            Dictionary with inquiry_id and status
            
        Raises:
            ValueError: If inquiry cannot be stored
        """
        inquiry_data = {
            "name": name.strip(),
            "company": company.strip() if company else None,
            "email": email.strip().lower(),
            "message": message.strip(),
            "email_status": "PENDING",
        }

        try:
            logger.info("Received contact inquiry for email_suffix=%s", email[-4:] if len(email) >= 4 else email)
            
            # Store inquiry in database
            response = (
                supabase.table("contact_inquiries")
                .insert(inquiry_data)
                .execute()
            )

            if not response.data:
                logger.error("Failed to create contact inquiry in database")
                raise ValueError("INQUIRY_STORAGE_FAILED")

            inquiry = response.data[0]
            inquiry_id = str(inquiry["id"])

            logger.info("Contact inquiry stored with inquiry_id=%s", inquiry_id)

            # Attempt to send email notification
            try:
                logger.info("Attempting to send contact inquiry email for inquiry_id=%s", inquiry_id)
                await EmailService.send_contact_inquiry(
                    name=name.strip(),
                    company=company.strip() if company else None,
                    sender_email=email.strip().lower(),
                    message=message.strip(),
                )
                
                # Update email status to SENT upon confirmed acceptance
                supabase.table("contact_inquiries").update(
                    {"email_status": "SENT"}
                ).eq("id", inquiry_id).execute()
                logger.info(
                    "Contact inquiry email sent successfully for inquiry_id=%s",
                    inquiry_id,
                )
                
            except Exception as exc:
                # Inquiry is safely stored, but email sending failed
                safe_error = str(exc)
                logger.error(
                    "Failed to send contact inquiry email for inquiry_id=%s: %s",
                    inquiry_id,
                    safe_error,
                )
                
                # Mark email as failed in database
                supabase.table("contact_inquiries").update(
                    {"email_status": "FAILED"}
                ).eq("id", inquiry_id).execute()
                
                # Still return success response since the inquiry itself was persisted

            return {
                "success": True,
                "message": "Your inquiry has been received. We will respond within 4 hours.",
                "inquiry_id": inquiry_id,
            }

        except ValueError:
            raise
        except Exception as exc:
            logger.error("Contact inquiry processing failed: %s", exc)
            raise ValueError("INQUIRY_PROCESSING_FAILED") from exc

