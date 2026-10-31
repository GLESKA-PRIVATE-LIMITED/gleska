"""Gemini provider adapter: the only module that knows the Gemini host or reads GEMINI_API_KEY.

`httpx.AsyncClient` is looked up at call time so tests can substitute it.
"""

from __future__ import annotations

from typing import Any

import httpx

from app.ai_gateway.pricing import Usage
from app.core.config import settings

PROVIDER = "gemini"
API_ROOT = "https://generativelanguage.googleapis.com"


def api_key() -> str:
    return settings.GEMINI_API_KEY.strip()


def default_model() -> str:
    return settings.GEMINI_MODEL.strip()


def is_configured() -> bool:
    return bool(api_key() and default_model())


def auth_headers(extra: dict[str, str] | None = None) -> dict[str, str]:
    """Headers for Gemini REST calls. The key travels only in this header, never in URLs."""
    return {"x-goog-api-key": api_key(), **(extra or {})}


def generate_content_url(model: str) -> str:
    return f"{API_ROOT}/v1beta/models/{model}:generateContent"


def files_upload_url() -> str:
    return f"{API_ROOT}/upload/v1beta/files"


def file_url(file_name: str) -> str:
    return f"{API_ROOT}/v1beta/{file_name}"


async def generate_content(model: str, payload: dict[str, Any], timeout: float) -> httpx.Response:
    async with httpx.AsyncClient(timeout=timeout) as client:
        return await client.post(
            generate_content_url(model),
            headers=auth_headers({"content-type": "application/json"}),
            json=payload,
        )


def _int(value: Any) -> int:
    try:
        return max(int(value), 0)
    except (TypeError, ValueError):
        return 0


def parse_usage(body: Any) -> tuple[Usage | None, dict[str, Any] | None, str | None]:
    """Return (usage, raw usageMetadata, responseId). Usage is None when the provider sent none.

    Gemini semantics: promptTokenCount includes cachedContentTokenCount; toolUsePromptTokenCount is
    extra input; candidatesTokenCount excludes thoughtsTokenCount (billed as output).
    """
    if not isinstance(body, dict):
        return None, None, None
    raw = body.get("usageMetadata")
    response_id = body.get("responseId") if isinstance(body.get("responseId"), str) else None
    if not isinstance(raw, dict) or "promptTokenCount" not in raw:
        return None, raw if isinstance(raw, dict) else None, response_id
    audio = sum(
        _int(item.get("tokenCount"))
        for item in raw.get("promptTokensDetails") or []
        if isinstance(item, dict) and item.get("modality") == "AUDIO"
    )
    usage = Usage(
        input_tokens=_int(raw.get("promptTokenCount")) + _int(raw.get("toolUsePromptTokenCount")),
        cached_input_tokens=_int(raw.get("cachedContentTokenCount")),
        audio_input_tokens=audio,
        output_tokens=_int(raw.get("candidatesTokenCount")),
        thinking_tokens=_int(raw.get("thoughtsTokenCount")),
    )
    return usage, raw, response_id


def estimate_input_tokens(payload: dict[str, Any], extra_bytes: int = 0) -> int:
    """Conservative pre-call estimate: ~2 characters per text token, ~100 bytes per media token."""
    chars = 0
    media_bytes = extra_bytes

    def walk(node: Any) -> None:
        nonlocal chars, media_bytes
        if isinstance(node, dict):
            inline = node.get("inline_data") or node.get("inlineData")
            if isinstance(inline, dict) and isinstance(inline.get("data"), str):
                media_bytes += len(inline["data"]) * 3 // 4
            for key, value in node.items():
                if key in ("inline_data", "inlineData"):
                    continue
                if key == "text" and isinstance(value, str):
                    chars += len(value)
                else:
                    walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(payload)
    return chars // 2 + media_bytes // 100 + 256
