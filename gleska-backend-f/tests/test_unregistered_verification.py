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
async def test_unregistered_aadhaar_requires_real_provider_and_uses_saved_proprietor(monkeypatch):
    fake = FakeSupabase(
        {"id": "employer-id", "employer_type": "UNREGISTERED_BUSINESS"},
        {"proprietor_aadhaar": "123456789012"},
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
        await employers.request_onboarding_verification("AADHAAR", SimpleNamespace(reference=None), SimpleNamespace(id="user-id", role="EMPLOYER"))

    assert error.value.status_code == 503
    assert error.value.detail["code"] == VerificationService.PROVIDER_NOT_CONFIGURED
    assert captured["args"] == ("employer-id", "AADHAAR", "UNREGISTERED_BUSINESS", "123456789012")


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
