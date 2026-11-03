"""Gmail connector — reads emails via the Gmail API using the employer's OAuth token."""

from __future__ import annotations

import base64
import logging
import re
from email.message import EmailMessage
from typing import Any

import httpx

from app.services.connectors import token_store

logger = logging.getLogger(__name__)

GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"
MAX_BODY_CHARS = 8000
# Model-supplied IDs go into the URL path; Gmail IDs are short alphanumeric strings.
_MESSAGE_ID_RE = re.compile(r"[A-Za-z0-9_-]{1,128}")


class GmailService:
    """Read emails through the AI Assistant using the employer's Gmail OAuth token."""

    @staticmethod
    async def list_emails(
        employer_id: str,
        query: str | None = None,
        max_results: int = 5,
    ) -> dict[str, Any]:
        credential = await token_store.get_credential(employer_id, "gmail")
        access_token = credential.token
        if not access_token:
            return {
                "emails": [],
                "error": credential.error_message("Gmail"),
            }

        max_results = min(max(max_results, 1), 10)
        params: dict[str, Any] = {"maxResults": max_results}
        if query:
            params["q"] = query[:200]

        headers = {"Authorization": f"Bearer {access_token}"}

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                list_resp = await client.get(
                    f"{GMAIL_API_BASE}/messages",
                    params=params,
                    headers=headers,
                )

                if list_resp.status_code in (401, 403):
                    return {"emails": [], "error": "Gmail refused the request. Please reconnect Gmail in Settings > Connectors."}
                if list_resp.status_code != 200:
                    return {"emails": [], "error": f"Gmail API returned status {list_resp.status_code}."}

                data = list_resp.json()
                messages = data.get("messages", [])
                if not messages:
                    return {"emails": [], "total_estimate": data.get("resultSizeEstimate", 0)}

                emails = []
                for msg_ref in messages:
                    msg_resp = await client.get(
                        f"{GMAIL_API_BASE}/messages/{msg_ref['id']}",
                        params={"format": "metadata", "metadataHeaders": "From,To,Subject,Date"},
                        headers=headers,
                    )
                    if msg_resp.status_code != 200:
                        continue
                    msg = msg_resp.json()
                    email_data = _parse_message_metadata(msg)
                    emails.append(email_data)

                return {
                    "emails": emails,
                    "total_estimate": data.get("resultSizeEstimate", 0),
                }

        except httpx.TimeoutException:
            return {"emails": [], "error": "Gmail service timed out."}
        except httpx.HTTPError:
            return {"emails": [], "error": "Gmail service connection error."}

    @staticmethod
    async def read_email(
        employer_id: str,
        message_id: str,
    ) -> dict[str, Any]:
        credential = await token_store.get_credential(employer_id, "gmail")
        access_token = credential.token
        if not access_token:
            return {
                "error": credential.error_message("Gmail"),
            }

        if not _MESSAGE_ID_RE.fullmatch(message_id or ""):
            return {"error": "Invalid email message ID."}

        headers = {"Authorization": f"Bearer {access_token}"}

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                msg_resp = await client.get(
                    f"{GMAIL_API_BASE}/messages/{message_id}",
                    params={"format": "full"},
                    headers=headers,
                )

                if msg_resp.status_code in (401, 403):
                    return {"error": "Gmail refused the request. Please reconnect Gmail in Settings > Connectors."}
                if msg_resp.status_code == 404:
                    return {"error": "Email not found."}
                if msg_resp.status_code != 200:
                    return {"error": f"Gmail API returned status {msg_resp.status_code}."}

                msg = msg_resp.json()
                result = _parse_message_metadata(msg)
                result["body"] = _extract_body(msg.get("payload", {}))
                result["message_id"] = message_id
                return result

        except httpx.TimeoutException:
            return {"error": "Gmail service timed out."}
        except httpx.HTTPError:
            return {"error": "Gmail service connection error."}

    @staticmethod
    async def send_email(access_token: str, to: str, subject: str, body: str) -> dict[str, Any]:
        """Send a plain-text email from the employer's own Gmail account (gmail.send scope)."""
        message = EmailMessage()
        try:
            message["To"] = to
            message["Subject"] = subject
        except ValueError:
            return {"sent": False, "error": "Invalid recipient or subject."}
        message.set_content(body)
        raw = base64.urlsafe_b64encode(message.as_bytes()).decode()

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                response = await client.post(
                    f"{GMAIL_API_BASE}/messages/send",
                    json={"raw": raw},
                    headers={"Authorization": f"Bearer {access_token}"},
                )
        except httpx.TimeoutException:
            return {"sent": False, "error": "Gmail service timed out."}
        except httpx.HTTPError:
            return {"sent": False, "error": "Gmail service connection error."}

        if response.status_code == 200:
            return {"sent": True, "email_id": response.json().get("id", ""), "recipient": to, "sent_via": "gmail"}
        if response.status_code in (401, 403):
            return {"sent": False, "error": "Gmail refused the request. Please reconnect Gmail in Settings > Connectors."}
        logger.error("Gmail send failed: status=%d", response.status_code)
        return {"sent": False, "error": f"Gmail API returned status {response.status_code}."}



def _parse_message_metadata(msg: dict[str, Any]) -> dict[str, Any]:
    headers = {
        h["name"].lower(): h["value"]
        for h in msg.get("payload", {}).get("headers", [])
        if h.get("name") and h.get("value")
    }
    return {
        "message_id": msg.get("id", ""),
        "thread_id": msg.get("threadId", ""),
        "from": headers.get("from", ""),
        "to": headers.get("to", ""),
        "subject": headers.get("subject", "(no subject)"),
        "date": headers.get("date", ""),
        "snippet": msg.get("snippet", ""),
        "labels": msg.get("labelIds", []),
    }


def _extract_body(payload: dict[str, Any]) -> str:
    """Extract plain-text body from a Gmail message payload, falling back to HTML."""
    if payload.get("mimeType") == "text/plain" and payload.get("body", {}).get("data"):
        return _decode_body(payload["body"]["data"])

    for part in payload.get("parts", []):
        if part.get("mimeType") == "text/plain" and part.get("body", {}).get("data"):
            return _decode_body(part["body"]["data"])

    for part in payload.get("parts", []):
        if part.get("mimeType") == "text/html" and part.get("body", {}).get("data"):
            return _decode_body(part["body"]["data"])

    for part in payload.get("parts", []):
        nested = _extract_body(part)
        if nested:
            return nested

    return "(Could not extract email body)"


def _decode_body(data: str) -> str:
    try:
        decoded = base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")
        return decoded[:MAX_BODY_CHARS]
    except Exception:
        return "(Could not decode email body)"
