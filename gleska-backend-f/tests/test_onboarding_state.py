from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.routers import employers
from app.services import onboarding_service
from app.schemas.auth import UserResponse
from app.schemas.employer import SelectEmployerTypeSchema
from app.services.onboarding_service import OnboardingService
from app.schemas.employer import (
    RegisteredIndustryOnboardingSchema,
    UnregisteredBusinessOnboardingSchema,
)


def test_worker_does_not_require_profile_completion_to_reach_dashboard(monkeypatch):
    class FakeSupabase:
        def table(self, name):
            raise AssertionError("Worker routing must not depend on profile state")

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


def test_directory_snapshots_restore_only_the_selected_directory_fields():
    details_by_type = {
        "REGISTERED_BUSINESS": {
            "business_name": "Registered Co",
            "business_type": "Private Limited",
            "cin_number": "CIN-REGISTERED",
            "director_name": "Authorized Signatory",
        },
        "REGISTERED_INDUSTRY": {
            "business_name": "Industrial Co",
            "business_type": "Private Limited",
            "cin_number": "CIN-INDUSTRY",
            "industry_type": "Manufacturing",
            "industry_category": "Engineering",
        },
        "UNREGISTERED_BUSINESS": {
            "business_name": "Local Shop",
            "number_of_proprietors": 4,
            "proprietor_names": ["Rahul", "Amit", "Priya", "Sneha"],
            "proprietor_aadhaar": "redacted",
        },
    }

    for previous_type, current_type in (
        ("REGISTERED_BUSINESS", "REGISTERED_INDUSTRY"),
        ("REGISTERED_BUSINESS", "UNREGISTERED_BUSINESS"),
        ("REGISTERED_INDUSTRY", "REGISTERED_BUSINESS"),
        ("REGISTERED_INDUSTRY", "UNREGISTERED_BUSINESS"),
        ("UNREGISTERED_BUSINESS", "REGISTERED_BUSINESS"),
        ("UNREGISTERED_BUSINESS", "REGISTERED_INDUSTRY"),
    ):
        snapshots = OnboardingService.directory_snapshots(
            previous_type, details_by_type[previous_type]
        )
        snapshots = OnboardingService.directory_snapshots(
            current_type, details_by_type[current_type], snapshots
        )
        active = OnboardingService.active_details_for_type(
            current_type, {"directory_data": snapshots}
        )

        if current_type == "REGISTERED_BUSINESS":
            assert active["business_name"] == "Registered Co"
            assert active["cin_number"] == "CIN-REGISTERED"
            assert "proprietor_names" not in active
            assert "industry_type" not in active
        elif current_type == "REGISTERED_INDUSTRY":
            assert active["business_name"] == "Industrial Co"
            assert active["industry_type"] == "Manufacturing"
            assert "proprietor_names" not in active
            assert "number_of_proprietors" not in active
        else:
            assert active["business_name"] == "Local Shop"
            assert active["proprietor_names"] == ["Rahul", "Amit", "Priya", "Sneha"]
            assert active["number_of_proprietors"] == 4
            assert "cin_number" not in active
            assert "director_name" not in active


def test_directory_snapshot_round_trip_preserves_each_type_independently():
    registered_details = {
        "business_name": "Registered Co",
        "business_type": "Private Limited",
        "cin_number": "CIN-REGISTERED",
        "director_name": "Authorized Signatory",
    }
    unregistered_details = {
        "business_name": "Local Shop",
        "number_of_proprietors": 4,
        "proprietor_names": ["Rahul", "Amit", "Priya", "Sneha"],
        "proprietor_aadhaar": "redacted",
    }

    snapshots = OnboardingService.directory_snapshots("REGISTERED_BUSINESS", registered_details)
    snapshots = OnboardingService.directory_snapshots(
        "UNREGISTERED_BUSINESS", unregistered_details, snapshots
    )
    row = {"directory_data": snapshots}

    assert OnboardingService.active_details_for_type("REGISTERED_BUSINESS", row)["cin_number"] == "CIN-REGISTERED"
    unregistered = OnboardingService.active_details_for_type("UNREGISTERED_BUSINESS", row)
    assert unregistered["proprietor_names"] == ["Rahul", "Amit", "Priya", "Sneha"]
    assert "cin_number" not in unregistered


def test_saving_active_directory_refreshes_its_snapshot_without_inactive_fields():
    existing = {
        "directory_data": {
            "REGISTERED_BUSINESS": {
                "business_name": "Registered Co",
                "cin_number": "OLD-CIN",
            },
            "UNREGISTERED_BUSINESS": {
                "business_name": "Local Shop",
                "number_of_proprietors": 4,
                "proprietor_names": ["Rahul", "Amit", "Priya", "Sneha"],
            },
        },
        "business_name": "Local Shop",
        "number_of_proprietors": 4,
        "proprietor_names": ["Rahul", "Amit", "Priya", "Sneha"],
        "cin_number": "OLD-CIN",
    }

    payload = OnboardingService.active_details_payload(
        "REGISTERED_BUSINESS",
        existing,
        {"business_name": "Updated Co", "cin_number": "NEW-CIN", "proprietor_names": ["Stale"]},
    )

    registered = OnboardingService.active_details_for_type(
        "REGISTERED_BUSINESS", payload
    )
    unregistered = OnboardingService.active_details_for_type(
        "UNREGISTERED_BUSINESS", payload
    )
    assert registered["business_name"] == "Updated Co"
    assert registered["cin_number"] == "NEW-CIN"
    assert "proprietor_names" not in registered
    assert unregistered["proprietor_names"] == ["Rahul", "Amit", "Priya", "Sneha"]


def test_directory_switch_restores_target_snapshot_and_latest_common_fields():
    existing = {
        "business_name": "Latest Shared Name",
        "company_email": "latest@example.com",
        "directory_data": {
            "REGISTERED_BUSINESS": {
                "business_name": "Old Registered Name",
                "cin_number": "REGISTERED-CIN",
            },
            "UNREGISTERED_BUSINESS": {
                "business_name": "Saved Unregistered Name",
                "proprietor_names": ["Rahul", "Amit", "Priya", "Sneha"],
                "number_of_proprietors": 4,
            },
        },
        "cin_number": "REGISTERED-CIN",
    }

    target, snapshots = OnboardingService.switch_directory_details(
        "REGISTERED_BUSINESS", "UNREGISTERED_BUSINESS", existing
    )

    assert target["business_name"] == "Latest Shared Name"
    assert target["company_email"] == "latest@example.com"
    assert target["number_of_proprietors"] == 4
    assert "cin_number" not in target
    assert snapshots["UNREGISTERED_BUSINESS"]["proprietor_names"] == ["Rahul", "Amit", "Priya", "Sneha"]


def test_all_directory_transitions_restore_only_target_type_data():
    data_by_type = {
        "REGISTERED_BUSINESS": {
            "business_name": "Registered Co",
            "cin_number": "REGISTERED-CIN",
            "director_name": "Registered Signatory",
        },
        "REGISTERED_INDUSTRY": {
            "business_name": "Industrial Co",
            "cin_number": "INDUSTRY-CIN",
            "industry_type": "Manufacturing",
            "industry_category": "Engineering",
        },
        "UNREGISTERED_BUSINESS": {
            "business_name": "Local Shop",
            "number_of_proprietors": 4,
            "proprietor_names": ["Rahul", "Amit", "Priya", "Sneha"],
            "proprietor_aadhaar": "redacted",
        },
    }
    transitions = (
        ("REGISTERED_BUSINESS", "REGISTERED_INDUSTRY"),
        ("REGISTERED_BUSINESS", "UNREGISTERED_BUSINESS"),
        ("REGISTERED_INDUSTRY", "REGISTERED_BUSINESS"),
        ("REGISTERED_INDUSTRY", "UNREGISTERED_BUSINESS"),
        ("UNREGISTERED_BUSINESS", "REGISTERED_BUSINESS"),
        ("UNREGISTERED_BUSINESS", "REGISTERED_INDUSTRY"),
    )

    for previous_type, next_type in transitions:
        snapshots = {
            employer_type: OnboardingService.directory_snapshots(employer_type, details)[employer_type]
            for employer_type, details in data_by_type.items()
        }
        existing = {
            **data_by_type[previous_type],
            "directory_data": snapshots,
        }
        target, next_snapshots = OnboardingService.switch_directory_details(
            previous_type, next_type, existing
        )
        active = OnboardingService.active_details_for_type(
            next_type, {"directory_data": next_snapshots, **target}
        )

        if next_type == "REGISTERED_BUSINESS":
            assert active["cin_number"] == "REGISTERED-CIN"
            assert "proprietor_names" not in active
            assert "industry_type" not in active
        elif next_type == "REGISTERED_INDUSTRY":
            assert active["industry_type"] == "Manufacturing"
            assert "proprietor_names" not in active
            assert "number_of_proprietors" not in active
        else:
            assert active["proprietor_names"] == ["Rahul", "Amit", "Priya", "Sneha"]
            assert active["number_of_proprietors"] == 4
            assert "cin_number" not in active
            assert "director_name" not in active


def test_individual_employer_always_routes_to_dashboard(monkeypatch):
    class FakeQuery:
        def select(self, *_fields):
            return self

        def eq(self, *_args):
            return self

        def single(self):
            return self

        def execute(self):
            return type("Response", (), {"data": {
                "employer_type": "INDIVIDUAL",
                "onboarding_status": "NOT_STARTED",
            }})()

    class FakeSupabase:
        def table(self, _name):
            return FakeQuery()

    monkeypatch.setattr(onboarding_service, "supabase", FakeSupabase())
    user = UserResponse(
        id="user-id",
        name="Individual Employer",
        role="EMPLOYER",
        is_mobile_verified=True,
        is_active=True,
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )

    assert OnboardingService.determine_next_step(user) == "DASHBOARD"


def employer_profile(employer_type=None, onboarding_status="NOT_STARTED"):
    now = datetime.now(timezone.utc)
    return {
        "id": "employer-id",
        "user_id": "user-id",
        "employer_type": employer_type,
        "onboarding_status": onboarding_status,
        "verification_status": "PENDING",
        "contact_person_name": "Employer",
        "created_at": now,
        "updated_at": now,
    }


class EmployerTypeSelectionSupabase:
    def __init__(self, profile):
        self.profile = profile
        self.table_calls = []
        self.details_upsert = None
        self.details = {}
        self.verification_update = None

    def table(self, name):
        self.table_calls.append(name)
        return EmployerTypeSelectionQuery(self, name)


class EmployerTypeSelectionQuery:
    def __init__(self, database, table_name):
        self.database = database
        self.table_name = table_name
        self.update_payload = None
        self.upsert_payload = None

    def select(self, *_fields):
        return self

    def eq(self, *_args):
        return self

    def single(self):
        return self

    def update(self, payload):
        self.update_payload = payload
        return self

    def upsert(self, payload, **_kwargs):
        self.upsert_payload = payload
        return self

    def execute(self):
        if self.table_name == "employer_profiles":
            if self.update_payload is not None:
                self.database.profile.update(self.update_payload)
                return SimpleNamespace(data=[self.database.profile])
            return SimpleNamespace(data=self.database.profile)
        if self.table_name == "employer_onboarding_details":
            if self.upsert_payload is not None:
                self.database.details_upsert = self.upsert_payload
                self.database.details = {**self.database.details, **self.upsert_payload}
                return SimpleNamespace(data=[self.database.details])
            return SimpleNamespace(data=[self.database.details] if self.database.details else [])
        if self.table_name == "employer_verifications":
            self.database.verification_update = self.update_payload
            return SimpleNamespace(data=[])
        raise AssertionError(f"Unexpected table access: {self.table_name}")


def employer_user():
    now = datetime.now(timezone.utc)
    return UserResponse(
        id="user-id",
        name="Employer",
        role="EMPLOYER",
        is_mobile_verified=True,
        is_active=True,
        created_at=now,
        updated_at=now,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("previous_type", [None, "INDIVIDUAL", "REGISTERED_BUSINESS"])
async def test_individual_type_assignment_completes_without_onboarding_details(monkeypatch, previous_type):
    database = EmployerTypeSelectionSupabase(
        employer_profile(previous_type, onboarding_status="IN_PROGRESS")
    )
    monkeypatch.setattr(employers, "supabase", database)
    monkeypatch.setattr(onboarding_service, "supabase", database)

    selected = await employers.select_employer_type(
        SelectEmployerTypeSchema(employer_type="INDIVIDUAL"), employer_user()
    )

    assert selected.employer_type == "INDIVIDUAL"
    assert selected.onboarding_status == "COMPLETED"
    if previous_type in {None, "INDIVIDUAL"}:
        assert "employer_onboarding_details" not in database.table_calls
        assert database.details_upsert is None
        assert database.verification_update is None
    else:
        assert database.details_upsert is not None
        assert database.verification_update is not None
    assert OnboardingService.determine_next_step(employer_user()) == "DASHBOARD"


@pytest.mark.parametrize(
    "employer_type",
    ["REGISTERED_BUSINESS", "REGISTERED_INDUSTRY", "UNREGISTERED_BUSINESS"],
)
@pytest.mark.asyncio
async def test_business_type_assignment_still_persists_directory_snapshot(monkeypatch, employer_type):
    database = EmployerTypeSelectionSupabase(employer_profile())
    monkeypatch.setattr(employers, "supabase", database)

    selected = await employers.select_employer_type(
        SelectEmployerTypeSchema(employer_type=employer_type), employer_user()
    )

    assert selected.employer_type == employer_type
    assert selected.onboarding_status == "IN_PROGRESS"
    assert "employer_onboarding_details" in database.table_calls
    assert database.details_upsert["employer_id"] == "employer-id"
    assert employer_type in database.details_upsert["directory_data"]


def test_registered_business_completion_requires_location_fields():
    valid, message = OnboardingService.validate_onboarding_fields(
        "REGISTERED_BUSINESS",
        {
            "business_name": "Example Pvt Ltd",
            "business_type": "Private Limited",
            "business_category": "Construction",
            "company_email": "company@example.com",
            "company_phone": "919876543210",
            "director_name": "Authorized Signatory",
            "director_phone": "919876543211",
            "director_email": "director@example.com",
            "director_address": "1 Main Road",
            "director_aadhaar": "123456789012",
        },
    )

    assert valid is False
    assert message == "registered_address is required for registered business"


def test_unregistered_business_requires_proprietor_and_contact_details():
    valid, message = OnboardingService.validate_onboarding_fields(
        "UNREGISTERED_BUSINESS",
        {
            "business_name": "Example",
            "business_type": "Sole proprietorship",
            "business_category": "Retail",
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


def test_unregistered_step_one_draft_preserves_proprietors_and_accepts_optional_revenue():
    draft = UnregisteredBusinessOnboardingSchema(
        business_name="Local Shop",
        business_category="Retail",
        number_of_proprietors=2,
        proprietor_names=["Owner One", "Owner Two"],
        annual_revenue="Under 10 Lakhs",
    )

    assert draft.number_of_proprietors == 2
    assert draft.address is None
    assert draft.work_location is None
    assert draft.annual_revenue == "Under 10 Lakhs"
    assert draft.proprietor_names == ["Owner One", "Owner Two"]

    valid, message = OnboardingService.validate_onboarding_fields(
        "UNREGISTERED_BUSINESS",
        {
            "business_name": "Local Shop",
            "business_category": "Retail",
            "number_of_proprietors": 2,
        },
        require_all_fields=False,
    )
    assert valid is True
    assert message == ""

    valid, message = OnboardingService.validate_onboarding_fields(
        "UNREGISTERED_BUSINESS",
        {
            "business_name": "Local Shop",
            "business_category": "Retail",
            "company_email": "owner@example.com",
            "company_phone": "919876543210",
            "proprietor_name": "Owner",
            "proprietor_aadhaar": "123456789012",
            "industry_category": "Retail",
            "address": "Main Road",
            "work_location": "Town",
        },
    )
    assert valid is False
    assert message == "number_of_proprietors is required for unregistered business"


def test_unregistered_business_supports_selected_proprietor_counts():
    base_data = {
        "business_name": "Local Shop",
        "business_category": "Retail",
        "company_email": "owner@example.com",
        "company_phone": "919876543210",
        "proprietor_aadhaar": "123456789012",
        "address": "Main Road",
        "work_location": "Town",
    }

    for names in (["Owner"], ["Owner One", "Owner Two"], ["Owner One", "Owner Two", "Owner Three"]):
        valid, message = OnboardingService.validate_onboarding_fields(
            "UNREGISTERED_BUSINESS",
            {
                **base_data,
                "number_of_proprietors": len(names),
                "proprietor_name": names[0],
                "proprietor_names": names,
            },
        )
        assert valid is True
        assert message == ""

    valid, message = OnboardingService.validate_onboarding_fields(
        "UNREGISTERED_BUSINESS",
        {
            **base_data,
            "number_of_proprietors": 2,
            "proprietor_name": "Owner One",
            "proprietor_names": ["Owner One"],
        },
    )
    assert valid is False
    assert message == "proprietor_names must match number_of_proprietors"


def test_registered_industry_keeps_required_industrial_fields_with_shared_business_fields():
    data = {
        "business_name": "Example Industries",
        "business_type": "Private Limited",
        "business_category": "Manufacturing",
        "industry_type": "Heavy Manufacturing",
        "industry_category": "Engineering",
        "registered_address": "1 Main Road",
        "company_email": "company@example.com",
        "company_phone": "919876543210",
        "work_location": "Pune",
        "director_name": "Authorized Signatory",
        "director_phone": "919876543211",
        "director_email": "director@example.com",
        "director_address": "2 Main Road",
        "director_aadhaar": "123456789012",
    }

    valid, message = OnboardingService.validate_onboarding_fields(
        "REGISTERED_INDUSTRY", data
    )
    schema_data = RegisteredIndustryOnboardingSchema(**data).model_dump()

    assert valid is True
    assert message == ""
    assert schema_data["business_type"] == "Private Limited"
    assert schema_data["industry_type"] == "Heavy Manufacturing"
    assert schema_data["industry_category"] == "Engineering"

    for field in ("industry_type", "industry_category"):
        incomplete = data.copy()
        incomplete.pop(field)
        valid, message = OnboardingService.validate_onboarding_fields(
            "REGISTERED_INDUSTRY", incomplete
        )
        assert valid is False
        assert message == f"{field} is required for registered industry"


def test_individual_profile_details_are_optional_without_onboarding():
    valid, message = OnboardingService.validate_onboarding_fields(
        "INDIVIDUAL",
        {"address": "   "},
    )

    assert valid is True
    assert message == ""


def test_individual_profile_fields_remain_supported_without_becoming_requirements():
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


def test_individual_profile_can_be_partially_populated():
    valid, message = OnboardingService.validate_onboarding_fields(
        "INDIVIDUAL",
        {"address": "12 Main Road"},
        require_all_fields=False,
    )

    assert valid is True
    assert message == ""


def test_individual_profile_can_be_empty():
    valid, message = OnboardingService.validate_onboarding_fields(
        "INDIVIDUAL",
        {"address": "12 Main Road"},
    )

    assert valid is True
    assert message == ""
