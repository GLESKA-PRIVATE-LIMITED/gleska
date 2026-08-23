from types import SimpleNamespace

import pytest

from app.core.config import settings
from app.services import verification_service
from app.services.verification_service import VerificationService


class FakeClient:
    def __init__(self, response, calls=None):
        self.response = response
        self.calls = calls

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def post(self, *args, **kwargs):
        if self.calls is not None:
            self.calls.append((args, kwargs))
        return self.response


@pytest.mark.asyncio
async def test_cashfree_gstin_requires_valid_and_active_response(monkeypatch):
    monkeypatch.setattr(settings, "EMPLOYER_VERIFICATION_PROVIDER", "cashfree")
    monkeypatch.setattr(settings, "CASHFREE_CLIENT_ID", "client")
    monkeypatch.setattr(settings, "CASHFREE_CLIENT_SECRET", "secret")
    response = SimpleNamespace(
        status_code=200,
        content=b"{}",
        json=lambda: {
            "valid": True,
            "gst_in_status": "Active",
            "GSTIN": "29AAICP2912R1ZR",
            "reference_id": 19,
            "legal_name_of_business": "Example Industries",
        },
    )
    monkeypatch.setattr(verification_service.httpx, "AsyncClient", lambda **kwargs: FakeClient(response))

    status, reason, metadata, reference = await VerificationService._verify_cashfree_gstin("29AAICP2912R1ZR", None)

    assert status == "VERIFIED"
    assert reason is None
    assert metadata["gst_in_status"] == "Active"
    assert reference == "19"


@pytest.mark.asyncio
async def test_cashfree_gstin_sends_production_vrs_request_with_normalized_credentials(monkeypatch):
    monkeypatch.setattr(settings, "EMPLOYER_VERIFICATION_PROVIDER", "cashfree")
    monkeypatch.setattr(settings, "CASHFREE_ENV", " production ")
    monkeypatch.setattr(settings, "EMPLOYER_VERIFICATION_API_BASE_URL", " https://api.cashfree.com/verification ")
    monkeypatch.setattr(settings, "CASHFREE_API_VERSION", " 2022-09-01 ")
    monkeypatch.setattr(settings, "CASHFREE_CLIENT_ID", " 'client' ")
    monkeypatch.setattr(settings, "CASHFREE_CLIENT_SECRET", ' "secret" ')
    calls = []
    response = SimpleNamespace(
        status_code=200,
        content=b"{}",
        json=lambda: {"valid": False, "message": "GSTIN Doesn't Exist"},
    )
    monkeypatch.setattr(verification_service.httpx, "AsyncClient", lambda **kwargs: FakeClient(response, calls))

    await VerificationService._verify_cashfree_gstin("22ABCDE1234F1Z5", "Example Industries")

    args, kwargs = calls[0]
    assert args[0] == "https://api.cashfree.com/verification/gstin"
    assert kwargs["headers"] == {
        "x-client-id": "client",
        "x-client-secret": "secret",
        "x-api-version": "2022-09-01",
        "content-type": "application/json",
    }
    assert kwargs["json"] == {"GSTIN": "22ABCDE1234F1Z5", "business_name": "Example Industries"}


@pytest.mark.asyncio
async def test_cashfree_http_200_invalid_result_is_failed(monkeypatch):
    monkeypatch.setattr(settings, "EMPLOYER_VERIFICATION_PROVIDER", "cashfree")
    monkeypatch.setattr(settings, "CASHFREE_CLIENT_ID", "client")
    monkeypatch.setattr(settings, "CASHFREE_CLIENT_SECRET", "secret")
    response = SimpleNamespace(
        status_code=200,
        content=b"{}",
        json=lambda: {"valid": False, "message": "GSTIN Doesn't Exist"},
    )
    monkeypatch.setattr(verification_service.httpx, "AsyncClient", lambda **kwargs: FakeClient(response))

    status, reason, _, _ = await VerificationService._verify_cashfree_gstin("22ABCDE1234F1Z5", None)

    assert status == "FAILED"
    assert reason == "GSTIN Doesn't Exist"


@pytest.mark.asyncio
async def test_cashfree_auth_error_is_failed(monkeypatch):
    monkeypatch.setattr(settings, "EMPLOYER_VERIFICATION_PROVIDER", "cashfree")
    monkeypatch.setattr(settings, "CASHFREE_CLIENT_ID", "client")
    monkeypatch.setattr(settings, "CASHFREE_CLIENT_SECRET", "secret")
    response = SimpleNamespace(
        status_code=401,
        content=b"{}",
        json=lambda: {"code": "authentication_failed", "message": "invalid credentials"},
    )
    monkeypatch.setattr(verification_service.httpx, "AsyncClient", lambda **kwargs: FakeClient(response))

    status, reason, _, _ = await VerificationService._verify_cashfree_gstin("29AAICP2912R1ZR", None)

    assert status == "FAILED"
    assert reason == "CASHFREE_AUTHENTICATION_FAILED"
