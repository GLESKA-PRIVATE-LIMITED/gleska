"""Google Calendar connector — creates events via Google Calendar API."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

import httpx

from app.core.config import settings
from app.core.supabase import supabase

logger = logging.getLogger(__name__)

CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3"


class CalendarService:
    """Create calendar events through the AI Assistant."""

    @staticmethod
    async def schedule_event(
        title: str,
        start_time: str,
        duration_minutes: int,
        employer_id: str,
        attendees: list[str] | None = None,
        location: str | None = None,
        description: str | None = None,
        add_video_meeting: bool = False,
    ) -> dict[str, Any]:
        access_token = await CalendarService._get_oauth_token(employer_id, "google_calendar")
        if not access_token:
            return {
                "created": False,
                "error": (
                    "Google Calendar is not connected. Please connect your Google account "
                    "in Settings > Connectors to enable calendar scheduling."
                ),
            }

        try:
            start_dt = datetime.fromisoformat(start_time.replace("Z", "+00:00"))
        except ValueError:
            return {"created": False, "error": f"Invalid start_time format: {start_time}. Use ISO 8601."}

        end_dt = start_dt + timedelta(minutes=duration_minutes)

        event: dict[str, Any] = {
            "summary": title,
            "start": {"dateTime": start_dt.isoformat(), "timeZone": "Asia/Kolkata"},
            "end": {"dateTime": end_dt.isoformat(), "timeZone": "Asia/Kolkata"},
        }
        if description:
            event["description"] = description
        if location:
            event["location"] = location
        if attendees:
            event["attendees"] = [{"email": email.strip()} for email in attendees]
        if add_video_meeting:
            event["conferenceData"] = {
                "createRequest": {"requestId": f"gleska-{employer_id[:8]}-{int(start_dt.timestamp())}"},
            }

        params = "conferenceDataVersion=1" if add_video_meeting else ""
        url = f"{CALENDAR_API_BASE}/calendars/primary/events?{params}"

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                response = await client.post(
                    url,
                    json=event,
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Content-Type": "application/json",
                    },
                )

            if 200 <= response.status_code < 300:
                data = response.json()
                result: dict[str, Any] = {
                    "created": True,
                    "event_id": data.get("id", ""),
                    "event_link": data.get("htmlLink", ""),
                }
                conference = data.get("conferenceData", {})
                entry_points = conference.get("entryPoints", [])
                for ep in entry_points:
                    if ep.get("entryPointType") == "video":
                        result["meeting_link"] = ep["uri"]
                        break
                return result

            logger.error("Google Calendar API error: status=%d", response.status_code)
            if response.status_code == 401:
                return {"created": False, "error": "Google Calendar token expired. Please reconnect in Settings."}
            return {"created": False, "error": f"Calendar API returned status {response.status_code}."}

        except httpx.TimeoutException:
            return {"created": False, "error": "Calendar service timed out."}
        except httpx.HTTPError:
            return {"created": False, "error": "Calendar service connection error."}

    @staticmethod
    async def _get_oauth_token(employer_id: str, provider: str) -> str | None:
        try:
            response = (
                supabase.table("connector_tokens")
                .select("access_token,refresh_token,expires_at")
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
            logger.exception("Failed to retrieve OAuth token for provider=%s", provider)
            return None
