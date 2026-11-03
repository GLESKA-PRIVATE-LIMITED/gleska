"""Google Drive connector — fetches files from Drive."""

from __future__ import annotations

import logging
import re
from typing import Any

import httpx

from app.services.connectors import token_store

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
    def _is_textual(mime: str) -> bool:
        return (
            mime.startswith("text/")
            or mime in {"application/json", "application/xml", "application/csv"}
        )

    @staticmethod
    async def _extract_content(file_bytes: bytes, mime: str) -> dict[str, Any]:
        """Turn raw Drive bytes into readable text. Textual files decode directly; binary
        documents (PDF, images, Office) go through Gemini-vision OCR. Never returns raw
        binary, which would corrupt the agent's prompt."""
        if DriveService._is_textual(mime):
            return {"content": file_bytes.decode("utf-8", errors="replace")[:50_000]}

        from app.services.connectors.ocr_service import OCRService, OCR_MIME_TYPES

        if mime in OCR_MIME_TYPES:
            ocr = await OCRService.extract_from_bytes(file_bytes, mime)
            if ocr.get("error"):
                return {"content": "", "extraction_error": ocr["error"]}
            content = ocr.get("extracted_text", "")
            out: dict[str, Any] = {"content": content}
            if ocr.get("structured_data"):
                out["structured_data"] = ocr["structured_data"]
            return out

        return {"content": "(Binary file — text extraction not available for this file type)"}

    @staticmethod
    async def search_files(
        name_query: str,
        employer_id: str,
        max_results: int = 10,
    ) -> dict[str, Any]:
        """Find Drive files whose name contains name_query. Returns matches with id + link
        so the agent can then fetch one by id."""
        credential = await token_store.get_credential(employer_id, "google_drive")
        access_token = credential.token
        if not access_token:
            return {"files": [], "error": credential.error_message("Google Drive")}

        query = (name_query or "").strip()
        if not query:
            return {"files": [], "error": "Provide a file name to search for."}

        # Drive query strings use single quotes as delimiters; escape any in the name.
        escaped = query.replace("\\", "\\\\").replace("'", "\\'")
        q = f"name contains '{escaped}' and trashed = false"
        headers = {"Authorization": f"Bearer {access_token}"}

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    f"{DRIVE_API_BASE}/files",
                    params={
                        "q": q,
                        "fields": "files(id,name,mimeType,size,webViewLink)",
                        "pageSize": max(1, min(max_results, 25)),
                        "orderBy": "modifiedTime desc",
                    },
                    headers=headers,
                )

            if resp.status_code != 200:
                logger.error("Google Drive search error: status=%d", resp.status_code)
                if resp.status_code == 401:
                    return {"files": [], "error": "Drive token expired. Please reconnect."}
                return {"files": [], "error": f"Drive API returned status {resp.status_code}."}

            files = [
                {
                    "file_id": item.get("id", ""),
                    "file_name": item.get("name", ""),
                    "mime_type": item.get("mimeType", ""),
                    "web_view_link": item.get("webViewLink", ""),
                }
                for item in resp.json().get("files", [])
            ]
            return {"files": files}

        except httpx.TimeoutException:
            return {"files": [], "error": "Drive service timed out."}
        except httpx.HTTPError:
            return {"files": [], "error": "Drive service connection error."}

    @staticmethod
    async def fetch_file(
        file_url: str,
        employer_id: str,
        extract_text: bool = True,
    ) -> dict[str, Any]:
        credential = await token_store.get_credential(employer_id, "google_drive")
        access_token = credential.token
        if not access_token:
            return {
                "file_name": "",
                "mime_type": "",
                "error": credential.error_message("Google Drive"),
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
                        if size > 10_000_000:
                            result["content"] = "(File too large for inline text extraction)"
                        else:
                            dl_resp = await client.get(
                                f"{DRIVE_API_BASE}/files/{file_id}",
                                params={"alt": "media"},
                                headers=headers,
                            )
                            if dl_resp.status_code == 200:
                                result.update(
                                    await DriveService._extract_content(dl_resp.content, mime)
                                )

                return result

        except httpx.TimeoutException:
            return {"file_name": "", "mime_type": "", "error": "Drive service timed out."}
        except httpx.HTTPError:
            return {"file_name": "", "mime_type": "", "error": "Drive service connection error."}
