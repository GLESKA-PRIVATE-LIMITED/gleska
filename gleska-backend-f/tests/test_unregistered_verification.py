from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import employers
from app.services.verification_service import VerificationService


class Query:
    def __init__(self, data):
        self.data = data
        self.filters = []

    def select(self, _fields):
        return self

    def eq(self, field, value):
        self.filters.append((field, value))
        return self

    def single(self):
        return self

    def execute(self):
        return SimpleNamespace(data=self.data)


class FakeSupabase:
    def __init__(self, profile, details):
        self.profile = profile
        self.details = details
        self.tables = []

    def table(self, name):
        self.tables.append(name)
        return Query(self.profile if name == "employer_profiles" else self.details)


@pytest.mark.asyncio
async def test_unregistered_aadhaar_uses_authenticated_registrant_name(monkeypatch):
    fake = FakeSupabase(
        {"id": "employer-id", "employer_type": "UNREGISTERED_BUSINESS"},
        {
            "proprietor_aadhaar": "123456789012",
            "proprietor_name": "Amit Kumar",
            "proprietor_names": ["Amit Kumar", "Rahul Sharma"],
        },
    )
    monkeypatch.setattr(employers, "supabase", fake)
    monkeypatch.setattr(
        employers.VerificationService,
        "required_for",
        staticmethod(lambda employer_type, details=None: ["AADHAAR"]),
    )
    captured = {}

    async def request_verification(*args, **kwargs):
        captured["args"] = args
        captured["kwargs"] = kwargs
        return {
            "id": "verification-id",
            "employer_id": "employer-id",
            "verification_type": "AADHAAR",
            "status": "NOT_CONFIGURED",
            "provider_reference_id": None,
            "failure_reason": VerificationService.PROVIDER_NOT_CONFIGURED,
            "verified_at": None,
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
            "provider": None,
            "provider_metadata": None,
        }

    monkeypatch.setattr(VerificationService, "request_verification", staticmethod(request_verification))

    with pytest.raises(HTTPException) as error:
        await employers.request_onboarding_verification(
            "AADHAAR",
            SimpleNamespace(reference=None, registrant_name="Client Supplied Name"),
            SimpleNamespace(id="user-id", role="EMPLOYER", name="Rahul Sharma"),
        )

    assert error.value.status_code == 503
    assert error.value.detail["code"] == VerificationService.PROVIDER_NOT_CONFIGURED
    assert captured["args"] == ("employer-id", "AADHAAR", "UNREGISTERED_BUSINESS", "123456789012")
    assert captured["kwargs"]["expected_details"]["proprietor_name"] == "Rahul Sharma"


@pytest.mark.asyncio
async def test_unregistered_aadhaar_otp_uses_authenticated_registrant_name(monkeypatch):
    fake = FakeSupabase(
        {"id": "employer-id", "employer_type": "UNREGISTERED_BUSINESS"},
        {
            "proprietor_name": "Amit Kumar",
            "proprietor_names": ["Amit Kumar", "Rahul Sharma"],
        },
    )
    monkeypatch.setattr(employers, "supabase", fake)
    captured = {}

    async def verify_aadhaar_otp(employer_id, otp, expected_details):
        captured["employer_id"] = employer_id
        captured["otp"] = otp
        captured["expected_details"] = expected_details
        return {
            "id": "verification-id",
            "employer_id": employer_id,
            "verification_type": "AADHAAR",
            "status": "VERIFIED",
            "provider_reference_id": None,
            "failure_reason": None,
            "verified_at": "2026-01-01T00:00:00Z",
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
            "provider": "cashfree",
            "provider_metadata": None,
        }

    monkeypatch.setattr(VerificationService, "verify_aadhaar_otp", verify_aadhaar_otp)
    result = await employers.verify_onboarding_aadhaar_otp(
        SimpleNamespace(otp="123456"),
        SimpleNamespace(id="user-id", role="EMPLOYER", name="Rahul Sharma"),
    )

    assert result.status == "VERIFIED"
    assert captured["employer_id"] == "employer-id"
    assert captured["otp"] == "123456"
    assert captured["expected_details"]["proprietor_name"] == "Rahul Sharma"


@pytest.mark.asyncio
async def test_unregistered_business_details_can_be_saved_before_aadhaar_verification(monkeypatch):
    profile = {"id": "employer-id", "user_id": "user-id", "employer_type": "UNREGISTERED_BUSINESS", "onboarding_status": "IN_PROGRESS"}
    account = {"email": "owner@example.com", "mobile": "9876543210"}
    details = {}

    class Query:
        def __init__(self, data):
            self.data = data

        def select(self, _fields):
            return self

        def eq(self, field, value):
            return self

        def single(self):
            return self

        def execute(self):
            return SimpleNamespace(data=self.data)

        def upsert(self, payload, on_conflict=None):
            self.payload = payload
            self.on_conflict = on_conflict
            self.data = [{
                **payload,
                "id": "details-id",
                "created_at": "2026-01-01T00:00:00Z",
                "updated_at": "2026-01-01T00:00:00Z",
            }]
            return self

        def update(self, payload):
            self.payload = payload
            self.data = [payload]
            return self

    class FakeSupabase:
        def table(self, name):
            if name == "employer_profiles":
                return Query(profile)
            if name == "users":
                return Query(account)
            if name == "employer_onboarding_details":
                return Query(details)
            if name == "employer_verifications":
                return Query([])
            raise AssertionError(f"Unexpected table: {name}")

    monkeypatch.setattr(employers, "supabase", FakeSupabase())
    monkeypatch.setattr(
        VerificationService,
        "required_for",
        staticmethod(lambda employer_type, details=None: ["AADHAAR"]),
    )
    monkeypatch.setattr(
        VerificationService,
        "list_for_employer",
        staticmethod(lambda employer_id: []),
    )
    monkeypatch.setattr(
        VerificationService,
        "invalidate_for_identity_change",
        staticmethod(lambda employer_id: None),
    )

    result = await employers._update_onboarding(
        SimpleNamespace(id="user-id", role="EMPLOYER"),
        "UNREGISTERED_BUSINESS",
        {
            "business_name": "Local Shop",
            "business_type": "Proprietorship",
            "nature_of_business": "Retail",
            "number_of_proprietors": "1",
            "proprietor_name": "Amit Kumar",
            "proprietor_names": ["Amit Kumar"],
            "proprietor_aadhaar": "123456789012",
            "industry_category": "Retail",
            "address": "Main Road",
            "city": "Nanded",
            "state": "Maharashtra",
            "pincode": "431745",
            "work_location": "Nanded, Maharashtra, India",
            "company_email": "owner@example.com",
            "company_phone": "9876543210",
        },
    )

    assert result.business_name == "Local Shop"
    assert result.company_email == "owner@example.com"
    assert result.proprietor_names == ["Amit Kumar"]
