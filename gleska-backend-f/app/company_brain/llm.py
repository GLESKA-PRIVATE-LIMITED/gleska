"""Billed model calls for Company Brain. Always via the central AI gateway (never the provider)."""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from app import ai_gateway
from app.core.config import settings

logger = logging.getLogger(__name__)


class BrainModelError(Exception):
    """Model call failed in a way that is not a billing refusal (AIBillingError propagates)."""


def _timeout() -> float:
    return float(getattr(settings, "GEMINI_TIMEOUT_SECONDS", 60) or 60)


async def generate(system: str, contents: list[dict[str, Any]], *, operation: str, json_mode: bool = False,
                   max_output_tokens: int = 2048) -> str:
    payload: dict[str, Any] = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": contents,
        "generationConfig": {"temperature": 0, "maxOutputTokens": max_output_tokens},
    }
    if json_mode:
        payload["generationConfig"]["responseMimeType"] = "application/json"
    try:
        response = await ai_gateway.generate_content(payload, operation=operation, timeout=_timeout())
    except httpx.HTTPError as exc:
        raise BrainModelError("AI_UNAVAILABLE") from exc
    if response.status_code >= 400:
        logger.warning("company_brain model call failed: operation=%s status=%s", operation, response.status_code)
        raise BrainModelError("AI_UNAVAILABLE")
    try:
        body = response.json()
        parts = body["candidates"][0]["content"]["parts"]
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise BrainModelError("AI_INVALID_RESPONSE") from exc
    text = "".join(p.get("text", "") for p in parts if isinstance(p, dict)).strip()
    if not text:
        raise BrainModelError("AI_EMPTY_RESPONSE")
    return text


def parse_json(text: str) -> Any:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        cleaned = cleaned[cleaned.find("{"):]
    return json.loads(cleaned)
