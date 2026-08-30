from app.core.config import settings
import pytest
from app.routers import employers
from app.schemas.auth import UserResponse
from app.schemas.employer import CompleteOnboardingSchema
from datetime import datetime, timezone
from types import SimpleNamespace
from app.services.verification_service import VerificationService


def test_verification_requirements_are_type_specific(monkeypatch):
    monkeypatch.setattr(
        settings,
        "EMPLOYER_REQUIRED_VERIFICATIONS",
        "REGISTERED_INDUSTRY:GSTIN|REGISTRATION_NUMBER;REGISTERED_BUSINESS:GSTIN;UNREGISTERED_BUSINESS:AADHAAR",
    )

    assert VerificationService.required_for("INDIVIDUAL") == []
    assert VerificationService.required_for("UNREGISTERED_BUSINESS") == ["AADHAAR"]
    assert VerificationService.required_for("REGISTERED_BUSINESS") == ["CIN"]
    assert VerificationService.required_for("REGISTERED_INDUSTRY") == ["CIN"]
    assert VerificationService.required_for("REGISTERED_INDUSTRY", {"gstin": ""}) == ["CIN"]
    assert VerificationService.required_for("REGISTERED_INDUSTRY", {"gstin": "29AAICP2912R1ZR"}) == ["CIN", "GSTIN"]


@pytest.mark.asyncio
async def test_individual_completion_sets_existing_verified_state(monkeypatch):
    user = UserResponse(
        id="user-id",
        name="Individual",
        mobile="919876543210",
        role="EMPLOYER",
        is_mobile_verified=True,
        is_active=True,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    employer = {
        "id": "employer-id",
        "user_id": user.id,
        "employer_type": "INDIVIDUAL",
        "onboarding_status": "IN_PROGRESS",
        "verification_status": "PENDING",
        "contact_person_name": "Individual",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    details = {
        "employer_id": employer["id"],
        "address": "1 Main Road",
        "company_email": "individual@example.com",
        "company_phone": "919876543210",
        "city": "Pune",
        "state": "Maharashtra",
        "pincode": "411001",
        "work_location": "Pune",
    }
    updates = []

    class Query:
        def __init__(self, table):
            self.table = table
            self.updated = False
        def select(self, _fields): return self
        def eq(self, *_args): return self
        def single(self): return self
        def execute(self):
            if self.table == "users": return SimpleNamespace(data={"email": user.email, "mobile": user.mobile})
            if self.table == "employer_onboarding_details": return SimpleNamespace(data=[details])
            return SimpleNamespace(data=[employer] if self.updated else employer)
        def update(self, payload):
            updates.append(payload)
            employer.update(payload)
            self.updated = True
            return self

    class Supabase:
        def table(self, table): return Query(table)

    monkeypatch.setattr(employers, "supabase", Supabase())
    monkeypatch.setattr(VerificationService, "assert_required_complete", lambda *_args: None)

    result = await employers.complete_onboarding(CompleteOnboardingSchema(), user)

    assert result.verification_status == "VERIFIED"
    assert updates == [{"onboarding_status": "COMPLETED", "verification_status": "VERIFIED"}]
