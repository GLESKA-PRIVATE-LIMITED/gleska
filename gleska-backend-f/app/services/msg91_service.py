"""MSG91 verification service."""

from __future__ import annotations

import logging
from typing import Any
from datetime import datetime, timedelta
from collections import defaultdict

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

# In-memory rate limiting for OTP resend attempts
# Format: {mobile: [(timestamp, channel), ...]}
_otp_resend_history: dict[str, list[tuple[datetime, str]]] = defaultdict(list)
OTP_RESEND_COOLDOWN_SECONDS = 30  # Minimum seconds between resend attempts


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

    @staticmethod
    def validate_otp_resend_request(mobile: str, channel: str) -> None:
        """Validate OTP resend request and enforce rate limiting.
        
        Args:
            mobile: Normalized mobile number (e.g., 91XXXXXXXXXX)
            channel: OTP channel ("SMS" or "EMAIL")
            
        Raises:
            ValueError: If resend is rate-limited or invalid parameters
        """
        if not mobile or not isinstance(mobile, str):
            raise ValueError("INVALID_MOBILE")
        
        if channel not in ("SMS", "EMAIL"):
            raise ValueError("INVALID_CHANNEL")
        
        # Clean up old entries (older than cooldown window)
        now = datetime.utcnow()
        cutoff_time = now - timedelta(seconds=OTP_RESEND_COOLDOWN_SECONDS)
        
        if mobile in _otp_resend_history:
            _otp_resend_history[mobile] = [
                (timestamp, ch) for timestamp, ch in _otp_resend_history[mobile]
                if timestamp > cutoff_time
            ]
        
        # Check if last resend was recent
        history = _otp_resend_history.get(mobile, [])
        if history:
            last_timestamp, last_channel = history[-1]
            seconds_since_last = (now - last_timestamp).total_seconds()
            if seconds_since_last < OTP_RESEND_COOLDOWN_SECONDS:
                logger.warning(
                    "OTP resend rate limited for mobile_suffix=%s channel=%s (last resend %d seconds ago)",
                    mobile[-4:] if len(mobile) >= 4 else mobile,
                    last_channel,
                    int(seconds_since_last),
                )
                raise ValueError("OTP_RESEND_COOLDOWN")
        
        # Record this resend attempt
        logger.info(
            "OTP resend request accepted for mobile_suffix=%s channel=%s",
            mobile[-4:] if len(mobile) >= 4 else mobile,
            channel,
        )
        _otp_resend_history[mobile].append((now, channel))

