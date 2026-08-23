from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.routers import employers
from app.schemas.employer import IndividualOnboardingSchema
from app.services import verification_service
from app.services.verification_service import VerificationService


USER = SimpleNamespace(id="user-id", role="EMPLOYER")


class Query:
    def __init__(self, table, rows):
        self.table = table
        self.rows = rows
        self.payload = None
        self.single_result = False

    def select(self, _fields):
        return self

    def eq(self, _field, _value):
        return self

    def single(self):
        self.single_result = True
        return self

    def upsert(self, payload, on_conflict):
        self.payload = payload
        return self

    def execute(self):
        if self.payload is not None:
            result = {"id": "details-id", "employer_id": "employer-id", **self.payload}
            result.update({"created_at": datetime.now(timezone.utc), "updated_at": datetime.now(timezone.utc)})
            return SimpleNamespace(data=[result])
        if self.single_result:
            return SimpleNamespace(data=self.rows[0] if self.rows else {})
        return SimpleNamespace(data=self.rows)


class FakeSupabase:
    def __init__(self):
        self.queries = {}

    def table(self, name):
        if name not in self.queries:
            rows = {
                "employer_profiles": [{"id": "employer-id", "user_id": "user-id", "employer_type": "INDIVIDUAL"}],
                "users": [{"email": "account@example.com", "mobile": "919876543210"}],
                "employer_onboarding_details": [],
            }.get(name, [])
            self.queries[name] = Query(name, rows)
        return self.queries[name]


@pytest.mark.asyncio
async def test_employer_onboarding_uses_authenticated_account_contacts(monkeypatch):
    fake = FakeSupabase()
    monkeypatch.setattr(employers, "supabase", fake)

    request = IndividualOnboardingSchema(
        address="12 Main Road",
        city="Pune",
        state="Maharashtra",
        pincode="411001",
        work_location="Pune",
        company_email="attacker@example.com",
        company_phone="9000000000",
    )

    result = await employers._update_onboarding(USER, "INDIVIDUAL", request.model_dump())

    assert result.company_email == "account@example.com"
    assert result.company_phone == "919876543210"
    assert fake.queries["employer_onboarding_details"].payload["company_email"] == "account@example.com"
    assert fake.queries["employer_onboarding_details"].payload["company_phone"] == "919876543210"


@pytest.mark.asyncio
async def test_unconfigured_verification_is_persisted_as_not_configured(monkeypatch):
    saved = {}

    def fake_save(*args, **kwargs):
        saved.update({"status": args[2], "reason": args[3], "type": args[1]})
        return saved

    monkeypatch.setattr(VerificationService, "provider_is_configured", staticmethod(lambda: False))
    monkeypatch.setattr(VerificationService, "provider_adapter_available", staticmethod(lambda: False))
    monkeypatch.setattr(VerificationService, "_save_state", staticmethod(fake_save))
    monkeypatch.setattr(verification_service.settings, "EMPLOYER_REQUIRED_VERIFICATIONS", "UNREGISTERED_BUSINESS:AADHAAR")

    result = await VerificationService.request_verification("employer-id", "AADHAAR", "UNREGISTERED_BUSINESS", "500164321189")

    assert result["status"] == "NOT_CONFIGURED"
    assert result["reason"] == VerificationService.PROVIDER_NOT_CONFIGURED
    assert saved == {"status": "NOT_CONFIGURED", "reason": VerificationService.PROVIDER_NOT_CONFIGURED, "type": "AADHAAR"}
