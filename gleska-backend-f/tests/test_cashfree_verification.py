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


def test_provider_business_name_mismatch_fails_comparison():
    reason = VerificationService._comparison_error(
        "CIN",
        "U12345678901234567890",
        {"valid": True, "company_name": "Different Company"},
        {"business_name": "Expected Company"},
    )

    assert reason == "Provider business name does not match onboarding business name"


def test_cin_comparison_requires_provider_identifier_and_company_name():
    reason = VerificationService._comparison_error(
        "CIN",
        "U12345678901234567890",
        {"valid": True},
        {"business_name": "Example Company"},
    )

    assert reason == "Provider response did not include the verified CIN"


def test_identity_change_is_detected_without_comparing_sensitive_values():
    assert VerificationService.identity_changed(
        {"business_name": "Example Company", "cin_number": "U12345678901234567890"},
        {"business_name": "Other Company", "cin_number": "U12345678901234567890"},
    )


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


@pytest.mark.asyncio
async def test_cashfree_cin_requires_matching_identifier_and_company_name(monkeypatch):
    monkeypatch.setattr(settings, "EMPLOYER_VERIFICATION_PROVIDER", "cashfree")
    monkeypatch.setattr(settings, "CASHFREE_ENV", "sandbox")
    monkeypatch.setattr(settings, "EMPLOYER_VERIFICATION_API_BASE_URL", "https://sandbox.cashfree.com/verification")
    monkeypatch.setattr(settings, "CASHFREE_CLIENT_ID", "client")
    monkeypatch.setattr(settings, "CASHFREE_CLIENT_SECRET", "secret")
    calls = []
    response = SimpleNamespace(
        status_code=200,
        content=b"{}",
        json=lambda: {
            "valid": True,
            "status": "VALID",
            "cin": "U12345678901234567890",
            "companyName": "Example Industries",
        },
    )
    monkeypatch.setattr(verification_service.httpx, "AsyncClient", lambda **kwargs: FakeClient(response, calls))

    result = await VerificationService._verify_cashfree_identifier(
        "CIN",
        "U12345678901234567890",
        {"business_name": "Example Industries"},
    )

    assert result[0] == "VERIFIED"
    assert calls[0][0][0] == "https://sandbox.cashfree.com/verification/cin"
    assert "x-api-version" not in calls[0][1]["headers"]
    assert calls[0][1]["json"]["cin"] == "U12345678901234567890"


def test_registered_industry_does_not_require_empty_gstin(monkeypatch):
    monkeypatch.setattr(settings, "EMPLOYER_REQUIRED_VERIFICATIONS", "REGISTERED_INDUSTRY:CIN|GSTIN")

    assert VerificationService.required_for("REGISTERED_INDUSTRY", {"gstin": ""}) == ["CIN"]
    assert VerificationService.required_for("REGISTERED_INDUSTRY", {"gstin": "27AAAAA0000A1Z5"}) == ["CIN", "GSTIN"]


@pytest.mark.asyncio
async def test_cashfree_cin_ambiguous_response_is_not_verified(monkeypatch):
    monkeypatch.setattr(settings, "EMPLOYER_VERIFICATION_PROVIDER", "cashfree")
    monkeypatch.setattr(settings, "CASHFREE_CLIENT_ID", "client")
    monkeypatch.setattr(settings, "CASHFREE_CLIENT_SECRET", "secret")
    response = SimpleNamespace(status_code=200, content=b"{}", json=lambda: {"message": "processing"})
    monkeypatch.setattr(verification_service.httpx, "AsyncClient", lambda **kwargs: FakeClient(response))

    result = await VerificationService._verify_cashfree_identifier(
        "CIN",
        "U12345678901234567890",
        {"business_name": "Example Industries"},
    )

    assert result[0] == "PENDING"


@pytest.mark.asyncio
async def test_cashfree_cin_legacy_company_name_and_cin_number_shape_is_verified(monkeypatch):
    monkeypatch.setattr(settings, "EMPLOYER_VERIFICATION_PROVIDER", "cashfree")
    monkeypatch.setattr(settings, "CASHFREE_CLIENT_ID", "client")
    monkeypatch.setattr(settings, "CASHFREE_CLIENT_SECRET", "secret")
    response = SimpleNamespace(
        status_code=200,
        content=b"{}",
        json=lambda: {
            "valid": True,
            "status": "VALID",
            "cin_number": "U12345678901234567890",
            "companyName": "Example Industries",
        },
    )
    monkeypatch.setattr(verification_service.httpx, "AsyncClient", lambda **kwargs: FakeClient(response))

    result = await VerificationService._verify_cashfree_identifier(
        "CIN",
        "U12345678901234567890",
        {"business_name": "Example Industries"},
    )

    assert result[0] == "VERIFIED"


def test_cin_is_a_supported_verification_type():
    from app.schemas.verification import VERIFICATION_TYPES

    assert "CIN" in VERIFICATION_TYPES
