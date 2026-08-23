"""MSG91 verification service."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


class MSG91Service:
    """Validate MSG91 access tokens returned after OTP widget verification."""

    async def verify_access_token(self, access_token: str) -> dict[str, Any]:
        if not access_token or not access_token.strip():
            logger.warning("MSG91 token missing from request")
            raise ValueError("INVALID_MSG91_TOKEN")

        token = access_token.strip()
        verify_url = (settings.MSG91_ACCESS_TOKEN_VERIFY_URL or "").strip()
        auth_key = (settings.MSG91_AUTH_KEY or "").strip()

        if not verify_url:
            logger.error("MSG91 verification URL is missing from environment")
            raise ValueError("MSG91_CONFIGURATION_ERROR")

        if not auth_key:
            logger.error("MSG91 auth key is missing from environment")
            raise ValueError("MSG91_CONFIGURATION_ERROR")

        headers = {
            "Accept": "application/json",
            "authkey": auth_key,
            "Content-Type": "application/json",
        }

        logger.info("MSG91 verify URL=%s", verify_url)
        logger.info("MSG91 verify method=POST")
        logger.info("MSG91 token present=%s", bool(token))
        logger.info("MSG91 token length=%s", len(token))
        logger.info("MSG91 token prefix=%s", token[:10])
        logger.info("MSG91 token suffix=%s", token[-10:])

        try:
            async with httpx.AsyncClient(timeout=settings.MSG91_TIMEOUT_SECONDS) as client:
                response = await client.post(
                    verify_url,
                    headers=headers,
                    json={"access-token": token},
                )
        except httpx.RequestError as exc:
            logger.error("MSG91 verification request error: %s", exc)
            raise ValueError("MSG91_SERVICE_UNAVAILABLE") from exc

        response_text = response.text or ""
        logger.info("MSG91 response status=%s", response.status_code)
        logger.info("MSG91 response content-type=%s", response.headers.get("content-type"))
        logger.info("MSG91 response body preview=%s", response_text[:500])

        if response.status_code in (401, 403):
            logger.warning("MSG91 rejected the verification token: status=%s", response.status_code)
            raise ValueError("INVALID_MSG91_VERIFICATION")

        if response.status_code >= 500:
            logger.error("MSG91 service unavailable: status=%s", response.status_code)
            raise ValueError("MSG91_SERVICE_UNAVAILABLE")

        if response.status_code != 200:
            logger.warning("MSG91 returned unexpected status=%s", response.status_code)
            raise ValueError("INVALID_MSG91_VERIFICATION")

        try:
            payload: Any = response.json()
        except ValueError as exc:
            logger.warning("MSG91 returned a non-JSON verification response")
            raise ValueError("INVALID_MSG91_VERIFICATION") from exc

        if not isinstance(payload, dict) or payload.get("type") != "success" or not payload.get("message"):
            logger.warning("MSG91 payload did not indicate successful token validation")
            raise ValueError("INVALID_MSG91_VERIFICATION")

        logger.info("MSG91 verification succeeded: status=%s", response.status_code)
        return payload
