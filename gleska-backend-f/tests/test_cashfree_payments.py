import base64
import hashlib
import hmac
import json
import time
from types import SimpleNamespace

import pytest

from app.core.config import settings
from app.services import cashfree_payment_service
from app.services.cashfree_payment_service import CashfreePaymentService


class FakeClient:
    def __init__(self, response, calls):
        self.response = response
        self.calls = calls

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def post(self, *args, **kwargs):
        self.calls.append(("POST", args, kwargs))
        return self.response

    async def get(self, *args, **kwargs):
        self.calls.append(("GET", args, kwargs))
        return self.response


@pytest.fixture
def payment_settings(monkeypatch):
    monkeypatch.setattr(settings, "CASHFREE_PG_CLIENT_ID", "client-id")
    monkeypatch.setattr(settings, "CASHFREE_PG_CLIENT_SECRET", "secret")
    monkeypatch.setattr(settings, "CASHFREE_ENV", "SANDBOX")
    monkeypatch.setattr(settings, "CASHFREE_PG_API_VERSION", "2023-08-01")
    monkeypatch.setattr(settings, "FRONTEND_URL", "https://goleska.in")
    monkeypatch.setattr(settings, "WEBHOOK_URL", "https://api.goleska.in")


@pytest.mark.asyncio
async def test_create_subscription_order_uses_server_amount_and_payment_payload(monkeypatch, payment_settings):
    response = SimpleNamespace(
        raise_for_status=lambda: None,
        json=lambda: {"cf_order_id": "cf-order", "payment_session_id": "session"},
    )
    calls = []
    monkeypatch.setattr(cashfree_payment_service.httpx, "AsyncClient", lambda **_kwargs: FakeClient(response, calls))

    result = await CashfreePaymentService.create_subscription_order("employer-id", "+919876543210", "employer@example.com")

    assert result["cf_order_id"] == "cf-order"
    assert result["payment_session_id"] == "session"
    _, args, kwargs = calls[0]
    assert args[0] == "https://sandbox.cashfree.com/pg/orders"
    assert kwargs["headers"]["x-api-version"] == "2023-08-01"
    assert kwargs["json"]["order_amount"] == 2000.0
    assert kwargs["json"]["order_currency"] == "INR"
    assert kwargs["json"]["customer_details"]["customer_phone"] == "919876543210"
    assert kwargs["json"]["order_meta"]["notify_url"] == "https://api.goleska.in/api/v1/payments/webhook"


@pytest.mark.asyncio
async def test_get_order_status_uses_server_cashfree_call(monkeypatch, payment_settings):
    response = SimpleNamespace(
        raise_for_status=lambda: None,
        json=lambda: {"order_status": "PAID", "cf_order_id": "cf-order"},
    )
    calls = []
    monkeypatch.setattr(cashfree_payment_service.httpx, "AsyncClient", lambda **_kwargs: FakeClient(response, calls))

    result = await CashfreePaymentService.get_order_status("sub-order")

    assert result["order_status"] == "PAID"
    assert calls[0][0] == "GET"
    assert calls[0][1][0] == "https://sandbox.cashfree.com/pg/orders/sub-order"


def test_webhook_signature_requires_fresh_raw_body(payment_settings):
    timestamp = str(int(time.time()))
    raw_body = json.dumps({"type": "PAYMENT_SUCCESS_WEBHOOK"}).encode()
    signed = timestamp.encode() + raw_body
    signature = base64.b64encode(hmac.new(b"secret", signed, hashlib.sha256).digest()).decode()

    assert CashfreePaymentService.verify_webhook_signature(signature, timestamp, raw_body)
    assert not CashfreePaymentService.verify_webhook_signature(signature, str(int(time.time()) - 301), raw_body)
