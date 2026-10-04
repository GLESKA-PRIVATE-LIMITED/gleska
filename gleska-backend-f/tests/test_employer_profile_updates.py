from copy import deepcopy
from datetime import datetime, timezone
import asyncio

import pytest
from fastapi.testclient import TestClient

from app.core.security import require_employer
from app.main import app
from app.routers import employers
from app.schemas.auth import UserResponse
from app.schemas.employer import (
    CompanyProfileUpdateSchema,
    DirectorProfileUpdateSchema,
    IndividualOnboardingSchema,
    RegisteredBusinessOnboardingSchema,
    RegisteredIndustryOnboardingSchema,
    UnregisteredBusinessOnboardingSchema,
)
from app.services import entitlements
from app.services.onboarding_service import OnboardingService
from app.services import verification_service

client = TestClient(app)
NOW = datetime(2026, 1, 1, tzinfo=timezone.utc).isoformat()


class FakeResponse:
    def __init__(self, data):
        self.data = data


class EmployerProfileDatabase:
    def __init__(self, employer_type="REGISTERED_BUSINESS", onboarding_status="IN_PROGRESS", details=None):
        self.employer = {
            "id": "employer-123",
            "user_id": "user-123",
            "employer_type": employer_type,
            "onboarding_status": onboarding_status,
            "verification_status": "PENDING",
            "contact_person_name": "Test Employer",
            "created_at": NOW,
            "updated_at": NOW,
        }
        self.account = {
            "id": "user-123",
            "name": "Account Name",
            "email": "account@example.com",
            "mobile": "+919876543210",
            "profile_photo_path": None,
        }
        self.details = {
            "id": "details-123",
            "employer_id": "employer-123",
            "created_at": NOW,
            "updated_at": NOW,
            **(details or {}),
        }
        self.verifications = []
        self.filters = []
        self.updates = []
        self.table_calls = []

    def table(self, name):
        self.table_calls.append(name)
        return FakeQuery(self, name)


class FakeQuery:
    def __init__(self, database, table):
        self.database = database
        self.table_name = table
        self.filters = {}
        self.payload = None
        self.operation = "select"

    def select(self, *_args):
        return self

    def eq(self, key, value):
        self.filters[key] = value
        self.database.filters.append((self.table_name, key, value))
        return self

    def single(self):
        self.single_requested = True
        return self

    def update(self, payload):
        self.operation = "update"
        self.payload = payload
        return self

    def upsert(self, payload, **_kwargs):
        self.operation = "upsert"
        self.payload = payload
        return self

    def execute(self):
        if self.table_name == "employer_profiles":
            if self.operation == "update":
                self.database.employer.update(self.payload)
                self.database.updates.append((self.table_name, deepcopy(self.payload)))
                return FakeResponse([deepcopy(self.database.employer)])
            if self.filters.get("user_id") != self.database.employer["user_id"]:
                return FakeResponse(None if self._is_single() else [])
            return FakeResponse(
                deepcopy(self.database.employer)
                if self._is_single()
                else [deepcopy(self.database.employer)]
            )

        if self.table_name == "employer_onboarding_details":
            if self.operation == "upsert":
                self.database.details.update(self.payload)
                self.database.updates.append((self.table_name, deepcopy(self.payload)))
                return FakeResponse([deepcopy(self.database.details)])
            if self.filters.get("employer_id") != self.database.employer["id"]:
                return FakeResponse([])
            return FakeResponse([deepcopy(self.database.details)])

        if self.table_name == "users":
            if self.filters.get("id") != self.database.account["id"]:
                return FakeResponse(None if self._is_single() else [])
            if self.operation == "update":
                self.database.account.update(self.payload)
                self.database.updates.append((self.table_name, deepcopy(self.payload)))
                return FakeResponse([deepcopy(self.database.account)])
            return FakeResponse(
                deepcopy(self.database.account)
                if self._is_single()
                else [deepcopy(self.database.account)]
            )

        if self.table_name == "employer_verifications":
            if self.operation == "update":
                self.database.updates.append((self.table_name, deepcopy(self.payload)))
                for record in self.database.verifications:
                    record.update(self.payload)
                return FakeResponse(deepcopy(self.database.verifications))
            return FakeResponse(deepcopy(self.database.verifications))

        if self.table_name == "individual_free_worker_claims":
            return FakeResponse([])

        raise AssertionError(f"Unexpected table access: {self.table_name}")

    def _is_single(self):
        return getattr(self, "single_requested", False)


def use_database(monkeypatch, database):
    monkeypatch.setattr(employers, "supabase", database)
    monkeypatch.setattr(entitlements, "supabase", database)
    monkeypatch.setattr(verification_service, "supabase", database)


@pytest.fixture(autouse=True)
def employer_auth():
    now = datetime.now(timezone.utc)
    user = UserResponse(
        id="user-123",
        email="employer@example.com",
        mobile="+919876543210",
        name="Authenticated Employer",
        role="EMPLOYER",
        is_mobile_verified=True,
        is_active=True,
        created_at=now,
        updated_at=now,
    )
    app.dependency_overrides[require_employer] = lambda: user
    yield
    app.dependency_overrides.clear()


@pytest.mark.parametrize(
    ("employer_type", "details", "included", "excluded"),
    [
        (
            "INDIVIDUAL",
            {"address": "12 Main Road", "city": "Pune", "director_name": "Do not expose"},
            {"address", "city"},
            {"director_name", "business_name"},
        ),
        (
            "REGISTERED_BUSINESS",
            {"business_name": "Registered Co", "registered_address": "Registered Rd", "industry_category": "Retail", "industry_type": "Hidden"},
            {"business_name", "registered_address", "industry_category"},
            {"industry_type", "proprietor_name"},
        ),
        (
            "UNREGISTERED_BUSINESS",
            {"business_name": "Local Shop", "business_type": "Sole proprietorship", "industry_category": "Retail", "proprietor_name": "Owner", "cin_number": "Hidden"},
            {"business_name", "business_type", "industry_category", "proprietor_name"},
            {"cin_number", "director_name"},
        ),
        (
            "REGISTERED_INDUSTRY",
            {"business_name": "Industrial Co", "industry_type": "Manufacturing", "director_name": "Director"},
            {"business_name", "industry_type", "director_name"},
            {"proprietor_name"},
        ),
    ],
)
def test_get_employer_profile_returns_type_aware_consolidated_profile(
    monkeypatch, employer_type, details, included, excluded
):
    database = EmployerProfileDatabase(employer_type=employer_type, details=details)
    use_database(monkeypatch, database)

    response = client.get("/api/v1/employers/me")

    assert response.status_code == 200
    result = response.json()
    assert result["employer_type"] == employer_type
    assert result["employer"]["employer_type"] == employer_type
    assert result["account"] == {
        "name": "Account Name",
        "email": "account@example.com",
        "mobile": "+919876543210",
    }
    assert "company_email" not in result["profile"]
    for field in included:
        assert result["profile"][field] == details[field]
    for field in excluded:
        assert field not in result["profile"]
    assert result["verification"] == []
    assert ("employer_profiles", "user_id", "user-123") in database.filters
    assert ("employer_onboarding_details", "employer_id", "employer-123") in database.filters


def test_get_employer_profile_does_not_confuse_account_and_company_email(monkeypatch):
    database = EmployerProfileDatabase(
        details={"company_email": "business@example.com"}
    )
    use_database(monkeypatch, database)

    response = client.get("/api/v1/employers/me")

    assert response.status_code == 200
    result = response.json()
    assert result["account"]["email"] == "account@example.com"
    assert result["profile"]["company_email"] == "business@example.com"


@pytest.mark.parametrize(
    ("employer_type", "onboarding_schema"),
    [
        ("INDIVIDUAL", IndividualOnboardingSchema),
        ("REGISTERED_BUSINESS", RegisteredBusinessOnboardingSchema),
        ("UNREGISTERED_BUSINESS", UnregisteredBusinessOnboardingSchema),
        ("REGISTERED_INDUSTRY", RegisteredIndustryOnboardingSchema),
    ],
)
def test_profile_update_contract_covers_onboarding_fields(employer_type, onboarding_schema):
    profile_update_fields = set(CompanyProfileUpdateSchema.model_fields)
    director_update_fields = set(DirectorProfileUpdateSchema.model_fields)

    assert set(onboarding_schema.model_fields) <= (
        profile_update_fields | director_update_fields
    )
    assert set(onboarding_schema.model_fields) <= OnboardingService.fields_for_type(
        employer_type
    )


@pytest.mark.parametrize(
    ("employer_type", "update", "assert_fields"),
    [
        (
            "INDIVIDUAL",
            {
                "address": "12 Main Road",
                "work_location": "Barad",
                "city": "Nanded",
                "state": "Maharashtra",
                "pincode": "431745",
                "latitude": 19.1,
                "longitude": 77.3,
            },
            {"address", "work_location", "city", "state", "pincode", "latitude", "longitude"},
        ),
        (
            "REGISTERED_BUSINESS",
            {
                "business_type": "Private Limited",
                "registered_address": "Registered Road",
                "services_required": ["Construction"],
                "director_data": [{"name": "Director", "din": "123"}],
            },
            {"business_type", "registered_address", "services_required", "director_data"},
        ),
        (
            "UNREGISTERED_BUSINESS",
            {
                "business_type": "Sole Proprietorship",
                "nature_of_business": "Retail",
                "number_of_proprietors": 1,
                "proprietor_names": ["Owner"],
                "proprietor_name": "Owner",
                "proprietor_aadhaar": "123456789012",
                "udyam_number": "UDYAM-MH-01-1234567",
                "services_required": ["Sales"],
            },
            {
                "business_type", "nature_of_business", "number_of_proprietors",
                "proprietor_names", "proprietor_name", "proprietor_aadhaar",
                "udyam_number", "services_required",
            },
        ),
        (
            "REGISTERED_INDUSTRY",
            {
                "business_type": "Private Limited",
                "industry_type": "Manufacturing",
                "industry_category": "Engineering",
                "services_required": ["Assembly"],
                "director_data": [{"name": "Director"}],
            },
            {"business_type", "industry_type", "industry_category", "services_required", "director_data"},
        ),
    ],
)
def test_profile_update_persists_type_specific_onboarding_data(
    monkeypatch, employer_type, update, assert_fields
):
    database = EmployerProfileDatabase(employer_type=employer_type)
    use_database(monkeypatch, database)

    response = client.put("/api/v1/employers/company-profile", json=update)

    assert response.status_code == 200, response.text
    result = response.json()
    for field in assert_fields:
        assert database.details[field] == update[field]
        assert result["profile"][field] == update[field]


def test_employer_cannot_fetch_another_employers_profile(monkeypatch):
    database = EmployerProfileDatabase()
    database.employer["user_id"] = "different-user"
    use_database(monkeypatch, database)

    response = client.get("/api/v1/employers/me")

    assert response.status_code == 404
    assert ("employer_profiles", "user_id", "user-123") in database.filters


def test_employer_cannot_update_another_employers_profile(monkeypatch):
    database = EmployerProfileDatabase()
    database.employer["user_id"] = "different-user"
    use_database(monkeypatch, database)

    response = client.put(
        "/api/v1/employers/company-profile",
        json={"website_url": "https://example.com"},
    )

    assert response.status_code == 404
    assert database.details.get("website_url") is None
    assert ("employer_profiles", "user_id", "user-123") in database.filters


def test_partial_company_profile_update_returns_authoritative_profile(monkeypatch):
    database = EmployerProfileDatabase(details={"business_name": "Existing Co"})
    use_database(monkeypatch, database)

    response = client.put(
        "/api/v1/employers/company-profile",
        json={"website_url": "https://example.com"},
    )

    assert response.status_code == 200
    result = response.json()
    assert result["website_url"] == "https://example.com"
    assert result["profile"]["website_url"] == "https://example.com"
    assert result["employer"]["id"] == "employer-123"
    assert result["account"]["email"] == "account@example.com"
    assert database.details["business_name"] == "Existing Co"


def test_company_profile_explicit_empty_value_clears_optional_field(monkeypatch):
    database = EmployerProfileDatabase(details={"description": "Old description"})
    use_database(monkeypatch, database)

    response = client.put(
        "/api/v1/employers/company-profile",
        json={"description": ""},
    )

    assert response.status_code == 200
    assert database.details["description"] is None
    assert response.json()["profile"]["description"] is None


def test_company_profile_rejects_inapplicable_fields_and_arbitrary_employer_id(monkeypatch):
    database = EmployerProfileDatabase(employer_type="INDIVIDUAL")
    use_database(monkeypatch, database)

    type_specific = client.put(
        "/api/v1/employers/company-profile",
        json={"business_name": "Not an individual field"},
    )
    other_employer = client.put(
        "/api/v1/employers/company-profile",
        json={"website_url": "https://example.com", "employer_id": "other-employer"},
    )

    assert type_specific.status_code == 422
    assert other_employer.status_code == 422
    assert database.details.get("business_name") is None


def test_individual_contact_name_updates_existing_employer_profile(monkeypatch):
    database = EmployerProfileDatabase(employer_type="INDIVIDUAL")
    use_database(monkeypatch, database)

    response = client.put(
        "/api/v1/employers/company-profile",
        json={"contact_person_name": "Updated Individual"},
    )

    assert response.status_code == 200
    assert database.employer["contact_person_name"] == "Updated Individual"
    assert database.details.get("business_name") is None
    assert response.json()["employer"]["contact_person_name"] == "Updated Individual"


def test_employer_profile_response_includes_signed_profile_photo(monkeypatch):
    database = EmployerProfileDatabase()
    database.account["profile_photo_path"] = "users/user-123/photo.png"
    use_database(monkeypatch, database)
    monkeypatch.setattr(
        employers,
        "get_signed_profile_photo_url",
        lambda path: f"signed:{path}" if path else None,
    )

    response = client.get("/api/v1/employers/me")

    assert response.status_code == 200
    assert response.json()["profile_photo_url"] == "signed:users/user-123/photo.png"
    assert "profile_photo_path" not in response.json()["account"]


def test_employer_profile_photo_upload_persists_owned_storage_path(monkeypatch):
    database = EmployerProfileDatabase()
    database.account["profile_photo_path"] = "users/user-123/old.png"
    use_database(monkeypatch, database)
    deleted_paths = []
    monkeypatch.setattr(
        employers,
        "get_signed_profile_photo_url",
        lambda path: f"signed:{path}" if path else None,
    )
    monkeypatch.setattr(employers, "delete_profile_photo", deleted_paths.append)

    response = client.post(
        "/api/v1/employers/me/profile-photo/upload-complete",
        json={
            "original_filename": "new.png",
            "mime_type": "image/png",
            "file_size_bytes": 1024,
            "storage_path": "users/user-123/new.png",
        },
    )

    assert response.status_code == 200
    assert response.json()["profile_photo_url"] == "signed:users/user-123/new.png"
    assert database.account["profile_photo_path"] == "users/user-123/new.png"
    assert deleted_paths == ["users/user-123/old.png"]


def test_employer_profile_photo_upload_start_uses_authenticated_user_path(monkeypatch):
    monkeypatch.setattr(
        employers,
        "get_profile_photo_path",
        lambda user_id, filename: f"users/{user_id}/generated_{filename}",
    )

    response = client.post(
        "/api/v1/employers/me/profile-photo/upload-start",
        json={
            "original_filename": "logo.png",
            "mime_type": "image/png",
            "file_size_bytes": 1024,
        },
    )

    assert response.status_code == 200
    assert response.json() == {"storage_path": "users/user-123/generated_logo.png"}


def test_employer_cannot_persist_another_users_profile_photo_path(monkeypatch):
    database = EmployerProfileDatabase()
    use_database(monkeypatch, database)
    monkeypatch.setattr(
        employers,
        "get_signed_profile_photo_url",
        lambda path: f"signed:{path}" if path else None,
    )

    response = client.post(
        "/api/v1/employers/me/profile-photo/upload-complete",
        json={
            "original_filename": "other.png",
            "mime_type": "image/png",
            "file_size_bytes": 1024,
            "storage_path": "users/user-456/other.png",
        },
    )

    assert response.status_code == 400
    assert database.account["profile_photo_path"] is None
    assert not any(table == "users" and payload.get("profile_photo_path") for table, payload in database.updates)


def test_employer_profile_photo_removal_clears_reference_and_deletes_file(monkeypatch):
    database = EmployerProfileDatabase()
    database.account["profile_photo_path"] = "users/user-123/photo.png"
    use_database(monkeypatch, database)
    deleted_paths = []
    monkeypatch.setattr(employers, "delete_profile_photo", deleted_paths.append)

    response = client.delete("/api/v1/employers/me/profile-photo")

    assert response.status_code == 200
    assert response.json() == {"profile_photo_url": None}
    assert database.account["profile_photo_path"] is None
    assert deleted_paths == ["users/user-123/photo.png"]


def test_completed_employer_cannot_change_verification_sensitive_identity(monkeypatch):
    database = EmployerProfileDatabase(
        onboarding_status="COMPLETED",
        details={"business_name": "Original Co"},
    )
    use_database(monkeypatch, database)

    response = client.put(
        "/api/v1/employers/company-profile",
        json={"business_name": "Changed Co"},
    )

    assert response.status_code == 409
    assert database.details["business_name"] == "Original Co"


def test_individual_profile_can_clear_optional_address(monkeypatch):
    database = EmployerProfileDatabase(
        employer_type="INDIVIDUAL",
        onboarding_status="COMPLETED",
        details={
            "address": "12 Main Road",
            "company_email": "business@example.com",
            "company_phone": "+919876543210",
            "city": "Pune",
            "state": "Maharashtra",
            "pincode": "411001",
            "work_location": "Pune",
        },
    )
    use_database(monkeypatch, database)

    response = client.put(
        "/api/v1/employers/company-profile",
        json={"address": None},
    )

    assert response.status_code == 200
    assert database.details["address"] is None
    assert response.json()["profile"]["address"] is None


def test_pending_business_identity_update_invalidates_verification(monkeypatch):
    database = EmployerProfileDatabase(details={"business_name": "Original Co"})
    database.verifications = [
        {"verification_type": "CIN", "status": "VERIFIED"},
    ]
    use_database(monkeypatch, database)

    response = client.put(
        "/api/v1/employers/company-profile",
        json={"business_name": "Changed Co"},
    )

    assert response.status_code == 200
    assert database.details["business_name"] == "Changed Co"
    assert database.verifications[0]["status"] == "FAILED"


def test_director_profile_update_maps_to_authoritative_details(monkeypatch):
    database = EmployerProfileDatabase(
        details={
            "business_name": "Registered Co",
            "director_name": "Existing Director",
        }
    )
    use_database(monkeypatch, database)

    response = client.put(
        "/api/v1/employers/director-profile",
        json={"director_email": "director@example.com"},
    )

    assert response.status_code == 200
    assert database.details["director_email"] == "director@example.com"
    assert response.json()["profile"]["director_email"] == "director@example.com"


def test_director_profile_can_clear_optional_field_before_completion(monkeypatch):
    database = EmployerProfileDatabase(details={"director_address": "Old address"})
    use_database(monkeypatch, database)

    response = client.put(
        "/api/v1/employers/director-profile",
        json={"director_address": None},
    )

    assert response.status_code == 200
    assert database.details["director_address"] is None


def test_completed_director_identity_change_is_rejected(monkeypatch):
    database = EmployerProfileDatabase(
        onboarding_status="COMPLETED",
        details={"director_name": "Existing Director"},
    )
    use_database(monkeypatch, database)

    response = client.put(
        "/api/v1/employers/director-profile",
        json={"director_name": "Different Director"},
    )

    assert response.status_code == 409
    assert database.details["director_name"] == "Existing Director"


def test_individual_type_selection_is_dashboard_ready_without_onboarding_details(monkeypatch):
    from app.schemas.employer import SelectEmployerTypeSchema

    database = EmployerProfileDatabase(
        employer_type=None, onboarding_status="NOT_STARTED"
    )
    use_database(monkeypatch, database)
    selected = asyncio.run(
        employers.select_employer_type(
            SelectEmployerTypeSchema(employer_type="INDIVIDUAL"),
            UserResponse(
                id="user-123",
                name="Authenticated Employer",
                email="employer@example.com",
                mobile="+919876543210",
                role="EMPLOYER",
                is_mobile_verified=True,
                is_active=True,
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            ),
        )
    )

    assert selected.employer_type == "INDIVIDUAL"
    assert selected.onboarding_status == "COMPLETED"
    assert "employer_onboarding_details" not in database.table_calls


def test_individual_completion_does_not_require_onboarding_data(monkeypatch):
    database = EmployerProfileDatabase(
        employer_type="INDIVIDUAL",
        onboarding_status="IN_PROGRESS",
    )
    use_database(monkeypatch, database)

    response = client.post("/api/v1/employers/onboarding/complete", json={})

    assert response.status_code == 200
    assert database.employer["onboarding_status"] == "COMPLETED"
