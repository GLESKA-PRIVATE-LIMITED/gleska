from types import SimpleNamespace

from app.services import onboarding_service
from app.services.onboarding_service import OnboardingService
from app.schemas.auth import UserResponse


def test_completed_worker_uses_persisted_onboarding_state(monkeypatch):
    class Query:
        def select(self, value):
            return self

        def eq(self, field, value):
            return self

        def single(self):
            return self

        def execute(self):
            return SimpleNamespace(data={"onboarding_status": "COMPLETED", "profile_completed": False})

    class FakeSupabase:
        def table(self, name):
            return Query()

    monkeypatch.setattr(onboarding_service, "supabase", FakeSupabase())
    user = UserResponse(
        id="user-id",
        name="Worker",
        role="WORKER",
        is_mobile_verified=True,
        is_active=True,
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )

    assert OnboardingService.determine_next_step(user) == "DASHBOARD"


def test_unregistered_business_requires_proprietor_and_contact_details():
    valid, message = OnboardingService.validate_onboarding_fields(
        "UNREGISTERED_BUSINESS",
        {
            "business_name": "Example",
            "business_type": "Sole proprietorship",
            "nature_of_business": "Repair",
            "number_of_proprietors": 1,
            "company_email": "owner@example.com",
            "company_phone": "919876543210",
            "proprietor_name": "Owner",
            "proprietor_aadhaar": "redacted",
            "industry_category": "Services",
            "address": "Main road",
            "city": "Pune",
            "state": "Maharashtra",
            "pincode": "411001",
            "work_location": "Pune",
        },
    )

    assert valid is True
    assert message == ""


def test_individual_requires_separate_address_and_preserves_location_fields():
    valid, message = OnboardingService.validate_onboarding_fields(
        "INDIVIDUAL",
        {
            "address": "12 Main Road",
            "company_email": "account@example.com",
            "company_phone": "919876543210",
            "city": "Pune",
            "state": "Maharashtra",
            "pincode": "411001",
            "work_location": "Pune",
        },
    )

    assert valid is True
    assert message == ""
