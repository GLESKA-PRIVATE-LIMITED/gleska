"""Zoom connector — creates meetings for interviews."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.services.connectors import token_store

logger = logging.getLogger(__name__)

ZOOM_API_BASE = "https://api.zoom.us/v2"


class ZoomService:
    """Create Zoom meetings through the AI Assistant."""

    @staticmethod
    async def create_meeting(
        topic: str,
        start_time: str,
        duration_minutes: int,
        employer_id: str,
        password: str | None = None,
    ) -> dict[str, Any]:
        credential = await token_store.get_credential(employer_id, "zoom")
        access_token = credential.token
        if not access_token:
            return {
                "created": False,
                "error": credential.error_message("Zoom"),
            }

        meeting_data: dict[str, Any] = {
            "topic": topic,
            "type": 2,
            "start_time": start_time,
            "duration": duration_minutes,
            "timezone": "Asia/Kolkata",
            "settings": {
                "host_video": True,
                "participant_video": True,
                "join_before_host": True,
                "waiting_room": False,
                "auto_recording": "none",
            },
        }
        if password:
            meeting_data["password"] = password

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                response = await client.post(
                    f"{ZOOM_API_BASE}/users/me/meetings",
                    json=meeting_data,
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Content-Type": "application/json",
                    },
                )

            if response.status_code in (200, 201):
                data = response.json()
                return {
                    "created": True,
                    "meeting_id": str(data.get("id", "")),
                    "join_url": data.get("join_url", ""),
                    "password": data.get("password", ""),
                }

            if response.status_code == 401:
                return {"created": False, "error": "Zoom token expired. Please reconnect."}
            return {"created": False, "error": f"Zoom API returned status {response.status_code}."}

        except httpx.TimeoutException:
            return {"created": False, "error": "Zoom service timed out."}
        except httpx.HTTPError:
            return {"created": False, "error": "Zoom service connection error."}
