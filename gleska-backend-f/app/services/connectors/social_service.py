"""Social media connectors — Instagram and Facebook posting."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.services.connectors import token_store

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
        credential = await token_store.get_credential(employer_id, platform)
        access_token = credential.token
        if not access_token:
            return {
                "posted": False,
                "error": credential.error_message(platform.title()),
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
        # The stored token is a *user* token; Meta only allows publishing to a Page's feed
        # with that Page's own access token, which /me/accounts returns.
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    f"{META_GRAPH_API}/me/accounts",
                    params={"fields": "id,name,access_token"},
                    headers={"Authorization": f"Bearer {access_token}"},
                )
                if resp.status_code in (400, 401, 403):
                    return {"posted": False, "error": "Facebook refused the request. Please reconnect Facebook in Settings > Connectors."}
                if resp.status_code != 200:
                    return {"posted": False, "error": "Failed to retrieve Facebook Pages."}

                pages = [p for p in resp.json().get("data", []) if p.get("id") and p.get("access_token")]
                if not pages:
                    return {
                        "posted": False,
                        "error": "No Facebook Page found. Posting requires a Facebook Page you manage, granted during connect.",
                    }
                page = pages[0]

                post_resp = await client.post(
                    f"{META_GRAPH_API}/{page['id']}/feed",
                    data={"message": caption},
                    headers={"Authorization": f"Bearer {page['access_token']}"},
                )

                if 200 <= post_resp.status_code < 300:
                    post_id = post_resp.json().get("id", "")
                    return {
                        "posted": True,
                        "post_id": post_id,
                        "post_url": f"https://facebook.com/{post_id}" if post_id else "",
                        "page_name": page.get("name", ""),
                    }

                if post_resp.status_code in (401, 403):
                    return {"posted": False, "error": "Facebook refused the post. Please reconnect Facebook in Settings > Connectors."}
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
                    params={"fields": "instagram_business_account"},
                    headers={"Authorization": f"Bearer {access_token}"},
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
