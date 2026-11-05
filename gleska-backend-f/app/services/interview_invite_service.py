"""Send interview invites to a worker the agent knows only by worker_profile_id.

The worker's phone/email are resolved server-side (get_worker_contact_secure) and used to send
via WhatsApp (MSG91) and/or email. The raw contact is never returned to the caller — this is the
relay path, usable before a worker is hired. Revealing the raw contact to the employer is a
separate, hire-gated path (EmployerWorkerService.get_selected_worker_contact)."""

import logging
from typing import Any

from app.core.supabase import supabase
from app.services.connectors.whatsapp_service import WhatsAppService
from app.services.connectors.email_connector_service import EmailConnectorService

logger = logging.getLogger(__name__)


class InterviewInviteError(Exception):
    """The invite could not be prepared (e.g. worker not found)."""


class InterviewInviteService:
    @staticmethod
    def _get_contact(worker_profile_id: str) -> dict[str, Any]:
        """Resolve one worker's name/mobile/email. Backend-only (service role)."""
        response = supabase.rpc(
            "get_worker_contact_secure", {"p_worker_profile_id": worker_profile_id}
        ).execute()
        rows = response.data or []
        if not rows:
            raise InterviewInviteError("WORKER_NOT_FOUND")
        row = rows[0]
        return {
            "name": (row.get("name") or "").strip() or None,
            "mobile": (row.get("mobile") or "").strip() or None,
            "email": (row.get("email") or "").strip() or None,
        }

    @staticmethod
    def _default_email_body(worker_name: str | None, job_title: str | None,
                            interview_time: str | None, location: str | None) -> str:
        lines = [f"Hello {worker_name or 'there'},", ""]
        role = f" for the {job_title} role" if job_title else ""
        lines.append(f"You have been invited to an interview{role} via GO LESKA.")
        if interview_time:
            lines.append(f"When: {interview_time}")
        if location:
            lines.append(f"Where: {location}")
        lines += ["", "Please reply to confirm your availability.", "", "— GO LESKA Hiring"]
        return "\n".join(lines)

    @classmethod
    async def send_invite(
        cls,
        *,
        employer_id: str,
        worker_profile_id: str,
        job_title: str | None = None,
        interview_time: str | None = None,
        location: str | None = None,
        channel: str = "both",
        template_name: str | None = None,
        template_variables: list[str] | None = None,
        message: str | None = None,
    ) -> dict[str, Any]:
        """Send an interview invite. Returns per-channel outcomes WITHOUT the raw contact."""
        contact = cls._get_contact(worker_profile_id)
        channel = (channel or "both").lower()
        results: dict[str, Any] = {"worker_name": contact["name"]}

        # ── WhatsApp (phone is always on file for workers) ──
        if channel in ("both", "whatsapp"):
            if contact["mobile"]:
                default_text = message or cls._default_email_body(
                    contact["name"], job_title, interview_time, location
                )
                wa = await WhatsAppService.send_message(
                    phone=contact["mobile"],
                    message=default_text,
                    template_name=template_name,
                    template_variables=template_variables,
                )
                results["whatsapp"] = {"attempted": True, **wa}
            else:
                results["whatsapp"] = {"attempted": False, "reason": "NO_MOBILE_ON_FILE"}

        # ── Email (best-effort; many workers have no email) ──
        if channel in ("both", "email"):
            if contact["email"]:
                subject = (
                    f"Interview invitation — {job_title}" if job_title else "Interview invitation"
                )
                body = message or cls._default_email_body(
                    contact["name"], job_title, interview_time, location
                )
                em = await EmailConnectorService.send_email(
                    to=contact["email"],
                    subject=subject,
                    body=body,
                    purpose="interview_invite",
                    employer_id=employer_id,
                )
                results["email"] = {"attempted": True, **em}
            else:
                results["email"] = {"attempted": False, "reason": "NO_EMAIL_ON_FILE"}

        attempted = [c for c in ("whatsapp", "email") if results.get(c, {}).get("attempted")]
        delivered = [c for c in attempted if results.get(c, {}).get("sent")]
        results["sent_any"] = bool(delivered)
        results["channels_attempted"] = attempted
        results["channels_delivered"] = delivered
        return results
