"""Social media connectors — Instagram and Facebook posting."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.supabase import supabase

logger = logging.getLogger(__name__)

META_GRAPH_API = "https://graph.facebook.com/v18.0"


class SocialMediaService:
    """Post job listings to Instagram and Facebook through the AI Assistant."""

    @staticmethod
    async def post_to_platform(
        platform: str,
        caption: str,
        job_title: str,
        employer_id: str,
        location: str | None = None,
        hashtags: list[str] | None = None,
    ) -> dict[str, Any]:
        access_token = await SocialMediaService._get_oauth_token(employer_id, platform)
        if not access_token:
            return {
                "posted": False,
                "error": (
                    f"{platform.title()} is not connected. Please connect your "
                    f"{platform.title()} account in Settings > Connectors to post jobs."
                ),
            }

        if hashtags:
            hashtag_text = " " + " ".join(f"#{tag.strip('#')}" for tag in hashtags)
            caption = caption.rstrip() + hashtag_text

        if platform == "facebook":
            return await SocialMediaService._post_to_facebook(access_token, caption)
        if platform == "instagram":
            return await SocialMediaService._post_to_instagram(access_token, caption, employer_id)

        return {"posted": False, "error": f"Unsupported platform: {platform}"}

    @staticmethod
    async def _post_to_facebook(access_token: str, caption: str) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    f"{META_GRAPH_API}/me",
                    params={"fields": "id", "access_token": access_token},
                )
                if resp.status_code != 200:
                    return {"posted": False, "error": "Failed to retrieve Facebook page info."}

                page_id = resp.json().get("id", "")

                post_resp = await client.post(
                    f"{META_GRAPH_API}/{page_id}/feed",
                    data={"message": caption, "access_token": access_token},
                )

                if 200 <= post_resp.status_code < 300:
                    data = post_resp.json()
                    post_id = data.get("id", "")
                    return {
                        "posted": True,
                        "post_id": post_id,
                        "post_url": f"https://facebook.com/{post_id}" if post_id else "",
                    }

                if post_resp.status_code == 401:
                    return {"posted": False, "error": "Facebook token expired. Please reconnect."}
                return {"posted": False, "error": f"Facebook API returned status {post_resp.status_code}."}

        except httpx.TimeoutException:
            return {"posted": False, "error": "Facebook service timed out."}
        except httpx.HTTPError:
            return {"posted": False, "error": "Facebook service connection error."}

    @staticmethod
    async def _post_to_instagram(access_token: str, caption: str, employer_id: str) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    f"{META_GRAPH_API}/me/accounts",
                    params={"fields": "instagram_business_account", "access_token": access_token},
                )
                if resp.status_code != 200:
                    return {"posted": False, "error": "Failed to retrieve Instagram business account."}

                accounts = resp.json().get("data", [])
                ig_account_id = None
                for account in accounts:
                    ig = account.get("instagram_business_account", {})
                    if ig.get("id"):
                        ig_account_id = ig["id"]
                        break

                if not ig_account_id:
                    return {
                        "posted": False,
                        "error": "No Instagram Business account found. Instagram posting requires a Business or Creator account linked to a Facebook Page.",
                    }

                return {
                    "posted": False,
                    "error": (
                        "Instagram text-only posts are not supported by the API. "
                        "Instagram requires an image or video. The job description has been "
                        "prepared — upload an image to proceed with posting."
                    ),
                    "prepared_caption": caption,
                    "ig_account_id": ig_account_id,
                }

        except httpx.TimeoutException:
            return {"posted": False, "error": "Instagram service timed out."}
        except httpx.HTTPError:
            return {"posted": False, "error": "Instagram service connection error."}

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
