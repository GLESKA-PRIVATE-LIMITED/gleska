"""Server-side Cashfree Payment Gateway integration."""

import base64
import hashlib
import hmac
import logging
import time
import uuid
from typing import Any
from urllib.parse import urlsplit

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


class CashfreePaymentError(Exception):
    """A safe Cashfree payment error."""


class CashfreePaymentService:
    PAYMENT_AMOUNT = 2000.0
    PAYMENT_CURRENCY = "INR"
    WEBHOOK_MAX_AGE_SECONDS = 300

    @staticmethod
    def _base_url() -> str:
        environment = settings.CASHFREE_ENV.strip().upper()
        return "https://api.cashfree.com/pg" if environment == "PRODUCTION" else "https://sandbox.cashfree.com/pg"

    @staticmethod
    def _headers() -> dict[str, str]:
        if not settings.CASHFREE_PG_CLIENT_ID or not settings.CASHFREE_PG_CLIENT_SECRET:
            raise CashfreePaymentError("CASHFREE_PAYMENT_NOT_CONFIGURED")
        return {
            "accept": "application/json",
            "content-type": "application/json",
            "x-api-version": settings.CASHFREE_PG_API_VERSION,
            "x-client-id": settings.CASHFREE_PG_CLIENT_ID,
            "x-client-secret": settings.CASHFREE_PG_CLIENT_SECRET,
        }

    @classmethod
    async def create_subscription_order(cls, employer_id: str, phone: str | None, email: str | None) -> dict[str, Any]:
        order_id = f"sub_{uuid.uuid4().hex[:16]}"
        order_meta = {"return_url": f"{settings.FRONTEND_URL}/employer/dashboard?order_id={{order_id}}"}
        if settings.WEBHOOK_URL.strip():
            order_meta["notify_url"] = f"{settings.WEBHOOK_URL.rstrip('/')}/api/v1/payments/webhook"
        payload = {
            "customer_details": {
                "customer_id": employer_id,
                "customer_email": email or "",
                "customer_phone": (phone or "").replace("+", ""),
            },
            "order_meta": order_meta,
            "order_amount": cls.PAYMENT_AMOUNT,
            "order_currency": cls.PAYMENT_CURRENCY,
            "order_id": order_id,
            "order_note": "Employer Monthly Subscription",
        }
        try:
            async with httpx.AsyncClient(timeout=settings.CASHFREE_PAYMENT_TIMEOUT_SECONDS) as client:
                endpoint = f"{cls._base_url()}/orders"
                response = await client.post(endpoint, headers=cls._headers(), json=payload)
                if getattr(response, "is_error", False):
                    try:
                        error_response = response.json()
                    except ValueError:
                        error_response = {}
                    error_response = error_response if isinstance(error_response, dict) else {}
                    parsed_endpoint = urlsplit(endpoint)
                    logger.error(
                        "Cashfree PG /orders diagnostic: endpoint=%s status=%s error_code=%s error_type=%s error_message=%s CASHFREE_ENV=%s client_id_present=%s client_secret_present=%s api_version=%s",
                        f"{parsed_endpoint.hostname}{parsed_endpoint.path}",
                        response.status_code,
                        error_response.get("code"),
                        error_response.get("type"),
                        error_response.get("message"),
                        settings.CASHFREE_ENV,
                        bool(settings.CASHFREE_PG_CLIENT_ID.strip()),
                        bool(settings.CASHFREE_PG_CLIENT_SECRET.strip()),
                        settings.CASHFREE_PG_API_VERSION,
                    )
                response.raise_for_status()
                data = response.json()
        except CashfreePaymentError:
            raise
        except (httpx.HTTPError, ValueError) as exc:
            raise CashfreePaymentError("CASHFREE_ORDER_CREATE_FAILED") from exc

        payment_session_id = data.get("payment_session_id") if isinstance(data, dict) else None
        if not payment_session_id:
            raise CashfreePaymentError("CASHFREE_MALFORMED_ORDER_RESPONSE")
        return {
            "order_id": order_id,
            "cf_order_id": data.get("cf_order_id"),
            "payment_session_id": payment_session_id,
        }

    @classmethod
    async def get_order_status(cls, order_id: str) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=settings.CASHFREE_PAYMENT_TIMEOUT_SECONDS) as client:
                response = await client.get(f"{cls._base_url()}/orders/{order_id}", headers=cls._headers())
                response.raise_for_status()
                data = response.json()
        except CashfreePaymentError:
            raise
        except (httpx.HTTPError, ValueError) as exc:
            raise CashfreePaymentError("CASHFREE_PAYMENT_VERIFY_FAILED") from exc
        if not isinstance(data, dict) or not data.get("order_status"):
            raise CashfreePaymentError("CASHFREE_MALFORMED_STATUS_RESPONSE")
        return data

    @classmethod
    def verify_webhook_signature(cls, signature: str, timestamp: str, raw_body: bytes) -> bool:
        try:
            if not settings.CASHFREE_PG_CLIENT_SECRET:
                return False
            timestamp_value = float(timestamp)
            if timestamp_value > 10_000_000_000:
                timestamp_value /= 1000
            if abs(time.time() - timestamp_value) > cls.WEBHOOK_MAX_AGE_SECONDS:
                return False
            payload = timestamp.encode("utf-8") + raw_body
            expected = base64.b64encode(
                hmac.new(settings.CASHFREE_PG_CLIENT_SECRET.encode("utf-8"), payload, hashlib.sha256).digest()
            ).decode("utf-8")
            return hmac.compare_digest(expected, signature)
        except (TypeError, ValueError):
            return False
