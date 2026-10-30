"""LinkedIn connector — candidate profile enrichment."""

from __future__ import annotations

import logging
import re
from typing import Any

import httpx

from app.core.supabase import supabase

logger = logging.getLogger(__name__)

LINKEDIN_API_BASE = "https://api.linkedin.com/v2"


class LinkedInService:
    """Look up LinkedIn profiles through the AI Assistant."""

    @staticmethod
    async def lookup_profile(
        employer_id: str,
        profile_url: str | None = None,
        name: str | None = None,
    ) -> dict[str, Any]:
        access_token = await LinkedInService._get_oauth_token(employer_id, "linkedin")
        if not access_token:
            return {
                "found": False,
                "error": (
                    "LinkedIn is not connected. Please connect your LinkedIn account "
                    "in Settings > Connectors to look up candidate profiles."
                ),
            }

        if profile_url:
            username = LinkedInService._extract_username(profile_url)
            if not username:
                return {"found": False, "error": "Could not extract LinkedIn username from URL."}
        elif name:
            username = None
        else:
            return {"found": False, "error": "Provide either a profile URL or candidate name."}

        headers = {"Authorization": f"Bearer {access_token}"}

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                if username:
                    resp = await client.get(
                        f"{LINKEDIN_API_BASE}/people/(vanityName:{username})",
                        params={"projection": "(id,firstName,lastName,headline)"},
                        headers=headers,
                    )
                else:
                    resp = await client.get(
                        f"{LINKEDIN_API_BASE}/people",
                        params={"q": "search", "keywords": name, "count": 5},
                        headers=headers,
                    )

                if resp.status_code == 401:
                    return {"found": False, "error": "LinkedIn token expired. Please reconnect."}
                if resp.status_code == 404:
                    return {"found": False, "error": "LinkedIn profile not found."}
                if resp.status_code != 200:
                    return {"found": False, "error": f"LinkedIn API returned status {resp.status_code}."}

                data = resp.json()
                first_name = (
                    data.get("firstName", {}).get("localized", {}).get("en_US", "")
                    if isinstance(data.get("firstName"), dict)
                    else str(data.get("firstName", ""))
                )
                last_name = (
                    data.get("lastName", {}).get("localized", {}).get("en_US", "")
                    if isinstance(data.get("lastName"), dict)
                    else str(data.get("lastName", ""))
                )

                return {
                    "found": True,
                    "name": f"{first_name} {last_name}".strip(),
                    "headline": str(data.get("headline", {}).get("localized", {}).get("en_US", ""))
                    if isinstance(data.get("headline"), dict)
                    else str(data.get("headline", "")),
                    "experience": [],
                    "skills": [],
                }

        except httpx.TimeoutException:
            return {"found": False, "error": "LinkedIn service timed out."}
        except httpx.HTTPError:
            return {"found": False, "error": "LinkedIn service connection error."}

    @staticmethod
    def _extract_username(url: str) -> str | None:
        match = re.search(r"linkedin\.com/in/([a-zA-Z0-9_-]+)", url)
        return match.group(1) if match else None

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
            logger.exception("Failed to retrieve OAuth token for provider=%s", provider)
            return None
