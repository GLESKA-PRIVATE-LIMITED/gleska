"""Google Drive connector — fetches files from Drive."""

from __future__ import annotations

import logging
import re
from typing import Any

import httpx

from app.core.supabase import supabase

logger = logging.getLogger(__name__)

DRIVE_API_BASE = "https://www.googleapis.com/drive/v3"


class DriveService:
    """Fetch files from Google Drive through the AI Assistant."""

    @staticmethod
    def _extract_file_id(file_url: str) -> str | None:
        patterns = [
            r"/d/([a-zA-Z0-9_-]+)",
            r"id=([a-zA-Z0-9_-]+)",
            r"^([a-zA-Z0-9_-]{20,})$",
        ]
        for pattern in patterns:
            match = re.search(pattern, file_url)
            if match:
                return match.group(1)
        return None

    @staticmethod
    async def fetch_file(
        file_url: str,
        employer_id: str,
        extract_text: bool = True,
    ) -> dict[str, Any]:
        access_token = await DriveService._get_oauth_token(employer_id, "google_drive")
        if not access_token:
            return {
                "file_name": "",
                "mime_type": "",
                "error": (
                    "Google Drive is not connected. Please connect your Google account "
                    "in Settings > Connectors to access Drive files."
                ),
            }

        file_id = DriveService._extract_file_id(file_url)
        if not file_id:
            return {"file_name": "", "mime_type": "", "error": "Could not extract file ID from the provided URL."}

        headers = {"Authorization": f"Bearer {access_token}"}

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                meta_resp = await client.get(
                    f"{DRIVE_API_BASE}/files/{file_id}",
                    params={"fields": "id,name,mimeType,size"},
                    headers=headers,
                )

                if meta_resp.status_code != 200:
                    if meta_resp.status_code == 401:
                        return {"file_name": "", "mime_type": "", "error": "Drive token expired. Please reconnect."}
                    if meta_resp.status_code == 404:
                        return {"file_name": "", "mime_type": "", "error": "File not found in Google Drive."}
                    return {"file_name": "", "mime_type": "", "error": f"Drive API returned status {meta_resp.status_code}."}

                meta = meta_resp.json()
                result: dict[str, Any] = {
                    "file_name": meta.get("name", ""),
                    "mime_type": meta.get("mimeType", ""),
                    "size_bytes": int(meta.get("size", 0)),
                }

                if extract_text:
                    mime = meta.get("mimeType", "")
                    if mime.startswith("application/vnd.google-apps."):
                        export_resp = await client.get(
                            f"{DRIVE_API_BASE}/files/{file_id}/export",
                            params={"mimeType": "text/plain"},
                            headers=headers,
                        )
                        if export_resp.status_code == 200:
                            result["content"] = export_resp.text[:50_000]
                    else:
                        size = int(meta.get("size", 0))
                        if size <= 5_000_000:
                            dl_resp = await client.get(
                                f"{DRIVE_API_BASE}/files/{file_id}",
                                params={"alt": "media"},
                                headers=headers,
                            )
                            if dl_resp.status_code == 200:
                                try:
                                    result["content"] = dl_resp.text[:50_000]
                                except Exception:
                                    result["content"] = "(Binary file — text extraction not available)"
                        else:
                            result["content"] = "(File too large for inline text extraction)"

                return result

        except httpx.TimeoutException:
            return {"file_name": "", "mime_type": "", "error": "Drive service timed out."}
        except httpx.HTTPError:
            return {"file_name": "", "mime_type": "", "error": "Drive service connection error."}

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
