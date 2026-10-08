from __future__ import annotations

import json
import logging
from dataclasses import asdict
from typing import Any, Protocol

import httpx
from pydantic import ValidationError
from pydantic_core import to_jsonable_python

from app.agents.shared.runtime import AgentLLMRequest, StructuredAgentResponse
from app.core.config import settings
from app.services.gemini_service import GeminiService

logger = logging.getLogger(__name__)


class LLMProvider(Protocol):
    """Provider boundary for generic structured agent turns."""

    provider_name: str

    async def generate(self, prompt: str, **kwargs: Any) -> Any: ...

    async def generate_agent_response(
        self,
        request: AgentLLMRequest,
    ) -> StructuredAgentResponse: ...


class LLMProviderError(Exception):
    """Provider request failed or returned an invalid structured response."""

    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


class GeminiLLMProvider:
    """Adapter preserving the extraction API and adding generic agent responses."""

    provider_name = "gemini"

    async def generate(self, prompt: str, **kwargs: Any) -> Any:
        return await GeminiService.extract_job_requirements(prompt)

    async def generate_agent_response(
        self,
        request: AgentLLMRequest,
    ) -> StructuredAgentResponse:
        api_key = settings.GEMINI_API_KEY.strip()
        model = settings.GEMINI_MODEL.strip()
        timeout = settings.GEMINI_TIMEOUT_SECONDS
        if not api_key or not model or timeout <= 0:
            raise LLMProviderError("LLM_CONFIGURATION_ERROR")

        payload = {
            "system_instruction": {
                "parts": [{
                    "text": (
                        "You are a domain-neutral conversational agent. Use only the supplied "
                        "agent description, conversation, task state, and registered tool "
                        "descriptions. Never claim a tool succeeded unless a tool result says so. "
                        "Return one JSON object with assistant_message, task_state (or null), "
                        "tool_calls (each with call_id, tool_name, arguments), and completed. "
                        "Do not return confirmation decisions, execution results, or extra fields."
                    )
                }]
            },
            "contents": [{
                "role": "user",
                "parts": [{
                    "text": request.model_dump_json(exclude={"tool_results"}),
                }],
            }, *[
                {
                    "role": "user",
                    "parts": [{
                        "text": (
                            "Trusted tool execution result; use this as execution evidence only: "
                            + json.dumps(to_jsonable_python(asdict(result)))
                        )
                    }],
                }
                for result in request.tool_results
            ]],
            "generationConfig": {
                "temperature": 0,
                "responseMimeType": "application/json",
            },
        }
        endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(
                    endpoint,
                    headers={"x-goog-api-key": api_key, "content-type": "application/json"},
                    json=payload,
                )
        except httpx.TimeoutException as exc:
            raise LLMProviderError("LLM_TIMEOUT") from exc
        except httpx.HTTPError as exc:
            raise LLMProviderError("LLM_UNAVAILABLE") from exc

        if response.status_code >= 400:
            try:
                body = response.json()
            except ValueError:
                body = {}
            provider_error = body.get("error", {}) if isinstance(body, dict) else {}
            provider_error_code = (
                provider_error.get("status") or provider_error.get("code")
                if isinstance(provider_error, dict)
                else None
            )
            logger.error(
                "Gemini agent request failed: model=%s status_code=%s provider_error_code=%s",
                model,
                response.status_code,
                provider_error_code,
            )
            if response.status_code == 429 or provider_error_code == "RESOURCE_EXHAUSTED":
                raise LLMProviderError("LLM_RATE_LIMITED")
            raise LLMProviderError("LLM_PROVIDER_ERROR")

        try:
            body = response.json()
            raw_text = body["candidates"][0]["content"]["parts"][0]["text"]
            parsed = json.loads(raw_text)
            if not isinstance(parsed, dict):
                raise ValueError("Structured response must be an object")
            return StructuredAgentResponse.model_validate(parsed)
        except (ValueError, KeyError, IndexError, TypeError, ValidationError) as exc:
            raise LLMProviderError("LLM_INVALID_RESPONSE") from exc
