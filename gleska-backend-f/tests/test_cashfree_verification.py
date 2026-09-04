from types import SimpleNamespace

import pytest
import httpx

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
async def test_cashfree_aadhaar_otp_initiation_is_pending_and_preserves_ref_id(monkeypatch):
    monkeypatch.setattr(settings, "EMPLOYER_VERIFICATION_PROVIDER", "cashfree")
    monkeypatch.setattr(settings, "CASHFREE_CLIENT_ID", "client")
    monkeypatch.setattr(settings, "CASHFREE_CLIENT_SECRET", "secret")
    response = SimpleNamespace(
        status_code=200,
        content=b"{}",
        json=lambda: {"status": "SUCCESS", "message": "OTP sent successfully", "ref_id": 85506865},
    )
    monkeypatch.setattr(verification_service.httpx, "AsyncClient", lambda **kwargs: FakeClient(response))

    status, reason, metadata, provider_reference = await VerificationService._verify_cashfree_identifier(
        "AADHAAR", "123456789012", {"director_name": "Authorized Signatory"}
    )

    assert (status, reason, provider_reference) == ("PENDING", "OTP_SENT", None)
    assert metadata["cashfree_ref_id"] == "85506865"


@pytest.mark.asyncio
async def test_cashfree_aadhaar_otp_final_verification_uses_ref_id(monkeypatch):
    monkeypatch.setattr(settings, "CASHFREE_ENV", "sandbox")
    monkeypatch.setattr(settings, "EMPLOYER_VERIFICATION_API_BASE_URL", "https://sandbox.cashfree.com/verification")
    calls = []
    response = SimpleNamespace(
        status_code=200,
        content=b"{}",
        json=lambda: {"status": "SUCCESS", "name": "Authorized Signatory"},
    )
    monkeypatch.setattr(verification_service.httpx, "AsyncClient", lambda **kwargs: FakeClient(response, calls))

    status, reason, _ = await VerificationService._verify_cashfree_aadhaar_otp(
        "123456", "85506865", {"director_name": "Authorized Signatory"}
    )

    assert (status, reason) == ("VERIFIED", None)
    assert calls[0][0][0] == "https://sandbox.cashfree.com/verification/offline-aadhaar/verify"
    assert calls[0][1]["json"] == {"otp": "123456", "ref_id": "85506865"}


@pytest.mark.asyncio
async def test_cashfree_aadhaar_otp_name_mismatch_is_failed(monkeypatch):
    response = SimpleNamespace(
        status_code=200,
        content=b"{}",
        json=lambda: {"status": "SUCCESS", "name": "Different Person"},
    )
    monkeypatch.setattr(verification_service.httpx, "AsyncClient", lambda **kwargs: FakeClient(response))

    status, reason, _ = await VerificationService._verify_cashfree_aadhaar_otp(
        "123456", "85506865", {"director_name": "Authorized Signatory"}
    )

    assert status == "FAILED"
    assert reason == "Provider identity name does not match onboarding person"


@pytest.mark.asyncio
async def test_cashfree_aadhaar_otp_provider_rejection_is_failed(monkeypatch):
    response = SimpleNamespace(
        status_code=422,
        content=b"{}",
        json=lambda: {"status": "FAILED", "message": "Invalid OTP"},
    )
    monkeypatch.setattr(verification_service.httpx, "AsyncClient", lambda **kwargs: FakeClient(response))

    status, reason, _ = await VerificationService._verify_cashfree_aadhaar_otp(
        "000000", "85506865", {"director_name": "Authorized Signatory"}
    )

    assert (status, reason) == ("FAILED", "Invalid OTP")

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
        {"valid": True, "CIN": "U12345678901234567890", "company_name": "Different Company"},
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

    assert VerificationService.required_for("REGISTERED_INDUSTRY", {"gstin": ""}) == ["CIN", "AADHAAR"]
    assert VerificationService.required_for("REGISTERED_INDUSTRY", {"gstin": "27AAAAA0000A1Z5"}) == ["CIN", "AADHAAR", "GSTIN"]


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
@pytest.mark.parametrize(
    ("status_code", "body", "expected"),
    [
        (403, {"code": "INSUFFICIENT_BALANCE", "message": "insufficient balance"}, VerificationService.CASHFREE_INSUFFICIENT_BALANCE),
        (401, {"code": "authentication_failed", "message": "invalid credentials"}, VerificationService.CASHFREE_AUTHENTICATION_FAILED),
        (200, {"valid": False, "message": "CIN not found"}, VerificationService.CASHFREE_VERIFICATION_FAILED),
        (429, {"message": "too many requests"}, VerificationService.CASHFREE_RATE_LIMITED),
        (503, {"message": "service unavailable"}, VerificationService.CASHFREE_UNAVAILABLE),
        (200, [], VerificationService.CASHFREE_MALFORMED_RESPONSE),
    ],
)
async def test_cashfree_cin_provider_failures_are_classified(monkeypatch, status_code, body, expected):
    monkeypatch.setattr(settings, "EMPLOYER_VERIFICATION_PROVIDER", "cashfree")
    monkeypatch.setattr(settings, "CASHFREE_CLIENT_ID", "client")
    monkeypatch.setattr(settings, "CASHFREE_CLIENT_SECRET", "secret")
    response = SimpleNamespace(status_code=status_code, content=b"response", json=lambda: body)
    monkeypatch.setattr(verification_service.httpx, "AsyncClient", lambda **kwargs: FakeClient(response))

    result = await VerificationService._verify_cashfree_identifier(
        "CIN",
        "U12345678901234567890",
        {"business_name": "Example Industries"},
    )

    assert result[0] in {"FAILED", "PENDING"}
    assert result[1] == expected
    assert result[2]["http_status"] == status_code
    if isinstance(body, dict):
        expected_code = str(body.get("code") or body.get("error_code") or "").lower() or None
        assert result[2]["provider_code"] == expected_code


@pytest.mark.asyncio
async def test_cashfree_cin_timeout_is_classified(monkeypatch):
    monkeypatch.setattr(settings, "EMPLOYER_VERIFICATION_PROVIDER", "cashfree")
    monkeypatch.setattr(settings, "CASHFREE_CLIENT_ID", "client")
    monkeypatch.setattr(settings, "CASHFREE_CLIENT_SECRET", "secret")

    class TimeoutClient(FakeClient):
        async def post(self, *args, **kwargs):
            raise httpx.TimeoutException("timed out")

    monkeypatch.setattr(verification_service.httpx, "AsyncClient", lambda **kwargs: TimeoutClient(None))

    result = await VerificationService._verify_cashfree_identifier(
        "CIN",
        "U12345678901234567890",
        {"business_name": "Example Industries"},
    )

    assert result[:2] == ("PENDING", VerificationService.CASHFREE_TIMEOUT)


@pytest.mark.asyncio
async def test_request_verification_rejects_missing_or_invalid_cin_before_provider(monkeypatch):
    monkeypatch.setattr(settings, "EMPLOYER_VERIFICATION_PROVIDER", "cashfree")
    monkeypatch.setattr(settings, "CASHFREE_CLIENT_ID", "client")
    monkeypatch.setattr(settings, "CASHFREE_CLIENT_SECRET", "secret")

    with pytest.raises(ValueError, match=VerificationService.CIN_MISSING):
        await VerificationService.request_verification("employer-id", "CIN", "REGISTERED_BUSINESS", None)
    with pytest.raises(ValueError, match=VerificationService.CIN_INVALID):
        await VerificationService.request_verification("employer-id", "CIN", "REGISTERED_BUSINESS", "bad")


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
