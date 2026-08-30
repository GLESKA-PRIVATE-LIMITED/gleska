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
