from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import employers
from app.schemas.auth import UserResponse
from app.schemas.employer import (
    CompleteOnboardingSchema,
    LegalIdentityOnboardingSchema,
    RegisteredIndustryOnboardingSchema,
)
from app.schemas.verification import VerificationRequestSchema
from app.services import onboarding_service, verification_service
from app.services.onboarding_service import OnboardingService
from app.services.verification_service import VerificationService


USER = UserResponse(
    id="user-id",
    name="Employer",
    mobile="919876543210",
    role="EMPLOYER",
    is_mobile_verified=True,
    is_active=True,
    created_at=datetime.now(timezone.utc),
    updated_at=datetime.now(timezone.utc),
)
CIN = "U12345678901234567890"


class Query:
    def __init__(self, database, table):
        self.database = database
        self.table = table
        self.filters = []
        self.payload = None
        self.single_result = False

    def select(self, *_columns):
        return self

    def eq(self, column, value):
        self.filters.append((column, value))
        return self

    def single(self):
        self.single_result = True
        return self

    def execute(self):
        rows = [
            row for row in self.database[self.table]
            if all(row.get(column) == value for column, value in self.filters)
        ]
        if self.payload is not None:
            matching = next(
                (
                    row for row in self.database[self.table]
                    if row.get("employer_id") == self.payload.get("employer_id")
                    and (
                        self.table != "employer_verifications"
                        or row.get("verification_type") == self.payload.get("verification_type")
                    )
                ),
                None,
            )
            if matching:
                matching.update(self.payload)
                rows = [matching]
            else:
                row = dict(self.payload)
                row.setdefault("id", f"{self.table}-id")
                row.setdefault("created_at", datetime.now(timezone.utc).isoformat())
                row.setdefault("updated_at", datetime.now(timezone.utc).isoformat())
                self.database[self.table].append(row)
                rows = [row]
        return SimpleNamespace(data=rows[0] if self.single_result and rows else (None if self.single_result else rows))

    def upsert(self, payload, **_kwargs):
        self.payload = payload
        return self

    def update(self, payload):
        rows = [
            row for row in self.database[self.table]
            if all(row.get(column) == value for column, value in self.filters)
        ]
        for row in rows:
            row.update(payload)
        self.payload = None
        return self


class Supabase:
    def __init__(self):
        self.database = {
            "employer_profiles": [{
                "id": "employer-id",
                "user_id": USER.id,
                "employer_type": "REGISTERED_INDUSTRY",
                "onboarding_status": "IN_PROGRESS",
            }],
            "users": [{"id": USER.id, "email": "account@example.com", "mobile": USER.mobile}],
            "employer_onboarding_details": [],
            "employer_verifications": [],
        }

    def table(self, table):
        return Query(self.database, table)


def onboarding_details(**overrides):
    data = {
        "industry_type": "Manufacturing",
        "industry_category": "Engineering",
        "registered_address": "1 Main Road",
        "city": "Pune",
        "state": "Maharashtra",
        "pincode": "411001",
        "work_location": "Pune",
        "business_name": "Example Industries",
        "director_name": "Authorized Signatory",
    }
    data.update(overrides)
    return RegisteredIndustryOnboardingSchema(**data).dict()


def verified_record(employer_id="employer-id", status="VERIFIED", verification_type="CIN"):
    now = datetime.now(timezone.utc).isoformat()
    return {
        "id": "verification-id",
        "employer_id": employer_id,
        "verification_type": verification_type,
        "status": status,
        "provider_reference_id": "provider-id",
        "failure_reason": None,
        "verified_at": now if status == "VERIFIED" else None,
        "created_at": now,
        "updated_at": now,
        "provider": "test",
        "provider_metadata": {},
    }


def persisted_identity():
    now = datetime.now(timezone.utc).isoformat()
    return {
        "id": "details-id",
        "employer_id": "employer-id",
        "business_name": "Example Industries",
        "cin_number": CIN,
        "created_at": now,
        "updated_at": now,
    }


@pytest.fixture
def fake_supabase(monkeypatch):
    fake = Supabase()
    monkeypatch.setattr(employers, "supabase", fake)
    monkeypatch.setattr(verification_service, "supabase", fake)
    return fake


@pytest.mark.asyncio
async def test_registered_industry_keeps_verified_cin_through_onboarding_sequence(fake_supabase, monkeypatch):
    await employers.update_legal_identity(
        LegalIdentityOnboardingSchema(business_name="Example Industries", cin_number=CIN, gstin="29AAICP2912R1ZR"),
        USER,
    )

    async def verify(*args, **kwargs):
        return VerificationService._save_state(
            args[0], "CIN", "VERIFIED", "", "provider-id", provider="test", verified=True,
        )

    monkeypatch.setattr(VerificationService, "request_verification", verify)
    verification = await employers.request_onboarding_verification("CIN", VerificationRequestSchema(), USER)
    listing = await employers.get_onboarding_verifications(USER)
    fake_supabase.database["employer_verifications"].append(verified_record(verification_type="AADHAAR"))
    saved = await employers.update_registered_industry_onboarding(
        RegisteredIndustryOnboardingSchema(**onboarding_details(director_aadhaar="123456789012")), USER,
    )

    assert verification.employer_id == saved.employer_id == "employer-id"
    assert verification.verification_type == listing.records[0].verification_type == "CIN"
    assert listing.records[0].status == "VERIFIED"
    assert saved.employer_id == "employer-id"
    assert fake_supabase.database["employer_verifications"][0]["status"] == "VERIFIED"


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["PENDING", "FAILED", "NOT_CONFIGURED"])
async def test_registered_industry_allows_onboarding_with_incomplete_cin(fake_supabase, status):
    fake_supabase.database["employer_onboarding_details"].append(persisted_identity())
    fake_supabase.database["employer_verifications"].append(verified_record(status=status))

    saved = await employers.update_registered_industry_onboarding(
        RegisteredIndustryOnboardingSchema(**onboarding_details()), USER,
    )

    assert saved.director_name == "Authorized Signatory"
    assert fake_supabase.database["employer_verifications"][0]["status"] == status


@pytest.mark.asyncio
async def test_registered_industry_can_save_director_details_without_cin_verification(fake_supabase):
    fake_supabase.database["employer_onboarding_details"].append(persisted_identity())
    other_record = verified_record(employer_id="other-employer")
    fake_supabase.database["employer_verifications"].append(other_record)

    saved = await employers.update_registered_industry_onboarding(
        RegisteredIndustryOnboardingSchema(**onboarding_details()), USER,
    )

    assert saved.director_name == "Authorized Signatory"
    assert fake_supabase.database["employer_verifications"][0]["status"] == "VERIFIED"

@pytest.mark.asyncio
@pytest.mark.parametrize(
    "identity",
    [
        {"business_name": "Example Industries", "cin_number": "U12345678901234567891"},
        {"business_name": "Changed Industries", "cin_number": CIN},
    ],
)
async def test_identity_change_invalidates_cin_without_blocking_onboarding_details(fake_supabase, identity):
    fake_supabase.database["employer_onboarding_details"].append(persisted_identity())
    fake_supabase.database["employer_verifications"].append(verified_record())

    await employers.update_legal_identity(LegalIdentityOnboardingSchema(**identity), USER)

    assert fake_supabase.database["employer_verifications"][0]["status"] == "FAILED"
    saved = await employers.update_registered_industry_onboarding(
        RegisteredIndustryOnboardingSchema(**onboarding_details()), USER,
    )
    assert saved.director_name == "Authorized Signatory"


@pytest.mark.asyncio
async def test_registered_business_can_save_legal_identity_without_cin(fake_supabase):
    fake_supabase.database["employer_profiles"][0]["employer_type"] = "REGISTERED_BUSINESS"

    saved = await employers.update_legal_identity(
        LegalIdentityOnboardingSchema(business_name="Example Business Pvt Ltd"),
        USER,
    )

    assert saved.business_name == "Example Business Pvt Ltd"
    assert saved.cin_number is None


@pytest.mark.asyncio
async def test_registered_industry_cin_aadhaar_are_optional_but_provided_identifiers_are_required(monkeypatch):
    monkeypatch.setattr(verification_service.settings, "EMPLOYER_REQUIRED_VERIFICATIONS", "")

    assert VerificationService.required_for("REGISTERED_INDUSTRY", {}) == []
    assert VerificationService.required_for(
        "REGISTERED_INDUSTRY",
        {"gstin": "29AAICP2912R1ZR", "pan_number": "AAAPA0000A", "registration_number": "REG-1"},
    ) == ["GSTIN", "PAN", "REGISTRATION_NUMBER"]
    assert VerificationService.available_for("REGISTERED_INDUSTRY") == ["CIN", "AADHAAR"]


@pytest.mark.asyncio
async def test_registered_industry_aadhaar_uses_director_field(fake_supabase, monkeypatch):
    fake_supabase.database["employer_onboarding_details"].append(
        persisted_identity() | {
            "director_name": "Authorized Signatory",
            "director_aadhaar": "123456789012",
        }
    )
    captured = {}

    async def verify(employer_id, verification_type, employer_type, reference, expected_details=None):
        captured.update({"type": verification_type, "reference": reference, "details": expected_details})
        return VerificationService._save_state(
            employer_id, verification_type, "VERIFIED", "", "provider-id", provider="test", verified=True,
        )

    monkeypatch.setattr(VerificationService, "request_verification", verify)
    result = await employers.request_onboarding_verification("AADHAAR", VerificationRequestSchema(), USER)

    assert result.status == "VERIFIED"
    assert captured["type"] == "AADHAAR"
    assert captured["reference"] == "123456789012"
    assert captured["details"]["director_name"] == "Authorized Signatory"


@pytest.mark.asyncio
async def test_registered_industry_saves_director_and_work_details_without_verification(fake_supabase):
    saved = await employers.update_registered_industry_onboarding(
        RegisteredIndustryOnboardingSchema(
            director_name="Authorized Signatory",
            work_location="Pune",
        ), USER,
    )

    assert saved.director_name == "Authorized Signatory"
    assert saved.work_location == "Pune"
    assert fake_supabase.database["employer_verifications"] == []


@pytest.mark.asyncio
async def test_registered_business_requires_and_keeps_cin_verification(fake_supabase, monkeypatch):
    fake_supabase.database["employer_profiles"][0]["employer_type"] = "REGISTERED_BUSINESS"

    await employers.update_legal_identity(
        LegalIdentityOnboardingSchema(business_name="Example Business Pvt Ltd", cin_number=CIN),
        USER,
    )

    async def verify(*args, **kwargs):
        return VerificationService._save_state(
            args[0], "CIN", "VERIFIED", "", "provider-id", provider="test", verified=True,
        )

    monkeypatch.setattr(VerificationService, "request_verification", verify)
    verification = await employers.request_onboarding_verification("CIN", VerificationRequestSchema(), USER)
    listing = await employers.get_onboarding_verifications(USER)

    from app.schemas.employer import RegisteredBusinessOnboardingSchema
    saved = await employers.update_registered_business_onboarding(
        RegisteredBusinessOnboardingSchema(
            business_name="Example Business Pvt Ltd",
            business_type="Private Limited",
            business_category="Technology",
            industry_category="Technology",
            registered_address="12 IT Park",
            city="Pune",
            state="Maharashtra",
            pincode="411001",
            work_location="Pune",
            company_email="biz@example.com",
            company_phone="919876543210",
        ),
        USER,
    )

    assert verification.verification_type == listing.records[0].verification_type == "CIN"
    assert listing.records[0].status == "VERIFIED"
    assert saved.employer_id == "employer-id"
    assert fake_supabase.database["employer_verifications"][0]["status"] == "VERIFIED"


def test_registered_business_cin_aadhaar_are_optional_but_provided_identifiers_are_required(monkeypatch):
    monkeypatch.setattr(verification_service.settings, "EMPLOYER_REQUIRED_VERIFICATIONS", "REGISTERED_BUSINESS:GSTIN")

    assert VerificationService.required_for("REGISTERED_BUSINESS", {}) == []
    assert VerificationService.required_for(
        "REGISTERED_BUSINESS",
        {"gstin": "29AAICP2912R1ZR", "pan_number": "AAAPA0000A", "registration_number": "REG-1"},
    ) == ["GSTIN", "PAN"]
    assert VerificationService.available_for("REGISTERED_BUSINESS") == ["CIN", "AADHAAR"]


def test_registered_business_cin_and_aadhaar_remain_available_as_optional_verifications(monkeypatch):
    monkeypatch.setattr(
        verification_service.settings,
        "EMPLOYER_REQUIRED_VERIFICATIONS",
        "REGISTERED_INDUSTRY:CIN;UNREGISTERED_BUSINESS:AADHAAR",
    )

    assert VerificationService.required_for("REGISTERED_BUSINESS", {}) == []
    assert VerificationService.available_for(
        "REGISTERED_BUSINESS",
        {"director_aadhaar": "123456789012", "proprietor_aadhaar": "999999999999"},
    ) == ["CIN", "AADHAAR"]


@pytest.mark.asyncio
async def test_registered_business_aadhaar_uses_director_field(fake_supabase, monkeypatch):
    fake_supabase.database["employer_profiles"][0]["employer_type"] = "REGISTERED_BUSINESS"
    fake_supabase.database["employer_onboarding_details"].append(
        persisted_identity() | {
            "director_name": "Authorized Signatory",
            "director_aadhaar": "123456789012",
            "proprietor_aadhaar": "999999999999",
        }
    )
    captured = {}

    async def verify(employer_id, verification_type, employer_type, reference, expected_details=None):
        captured.update({"employer_id": employer_id, "type": verification_type, "reference": reference, "details": expected_details})
        return VerificationService._save_state(
            employer_id, verification_type, "VERIFIED", "", "provider-id", provider="test", verified=True,
        )

    monkeypatch.setattr(VerificationService, "request_verification", verify)
    result = await employers.request_onboarding_verification("AADHAAR", VerificationRequestSchema(), USER)

    assert result.status == "VERIFIED"
    assert captured["employer_id"] == "employer-id"
    assert captured["type"] == "AADHAAR"
    assert captured["reference"] == "123456789012"
    assert captured["details"]["director_name"] == "Authorized Signatory"


def test_registered_business_registration_number_is_not_falsely_supported(fake_supabase):
    fake_supabase.database["employer_profiles"][0]["employer_type"] = "REGISTERED_BUSINESS"
    fake_supabase.database["employer_onboarding_details"].append(
        persisted_identity() | {"registration_number": "REG-1"}
    )

    with pytest.raises(HTTPException) as error:
        import asyncio
        asyncio.run(
            employers.request_onboarding_verification("REGISTRATION_NUMBER", VerificationRequestSchema(), USER)
        )

    assert error.value.status_code == 422


@pytest.mark.parametrize("missing_type", ["GSTIN", "PAN"])
def test_registered_business_completion_requires_each_applicable_verification(fake_supabase, missing_type):
    details = persisted_identity() | {
        "business_name": "Example Business Pvt Ltd",
        "business_type": "Private Limited",
        "business_category": "Technology",
        "gstin": "29AAICP2912R1ZR",
        "pan_number": "AAAPA0000A",
        "director_name": "Authorized Signatory",
        "director_aadhaar": "123456789012",
    }
    records = []
    for verification_type in ["CIN", "AADHAAR", "GSTIN", "PAN"]:
        if verification_type != missing_type:
            records.append(verified_record(verification_type=verification_type))
    fake_supabase.database["employer_profiles"][0]["employer_type"] = "REGISTERED_BUSINESS"
    fake_supabase.database["employer_onboarding_details"].append(details)
    fake_supabase.database["employer_verifications"].extend(records)

    with pytest.raises(ValueError, match=missing_type):
        VerificationService.assert_required_complete("employer-id", "REGISTERED_BUSINESS", details)


@pytest.mark.parametrize("missing_type", ["CIN", "AADHAAR"])
def test_registered_business_completion_does_not_require_cin_or_aadhaar(fake_supabase, missing_type):
    details = persisted_identity() | {
        "business_name": "Example Business Pvt Ltd",
        "business_type": "Private Limited",
        "business_category": "Technology",
        "director_name": "Authorized Signatory",
        "director_aadhaar": "123456789012",
    }
    fake_supabase.database["employer_profiles"][0]["employer_type"] = "REGISTERED_BUSINESS"
    fake_supabase.database["employer_onboarding_details"].append(details)
    other_type = "AADHAAR" if missing_type == "CIN" else "CIN"
    fake_supabase.database["employer_verifications"].append(verified_record(verification_type=other_type))

    VerificationService.assert_required_complete("employer-id", "REGISTERED_BUSINESS", details)


def test_registered_business_ignores_other_employer_verification(fake_supabase):
    details = persisted_identity() | {
        "business_name": "Example Business Pvt Ltd",
        "business_type": "Private Limited",
        "business_category": "Technology",
        "director_name": "Authorized Signatory",
        "director_aadhaar": "123456789012",
    }
    fake_supabase.database["employer_profiles"][0]["employer_type"] = "REGISTERED_BUSINESS"
    fake_supabase.database["employer_onboarding_details"].append(details)
    fake_supabase.database["employer_verifications"].append(verified_record(employer_id="other-employer", verification_type="CIN"))

    VerificationService.assert_required_complete("employer-id", "REGISTERED_BUSINESS", details)


@pytest.mark.asyncio
async def test_registered_business_can_complete_and_reach_dashboard_without_cin_or_aadhaar(
    fake_supabase, monkeypatch
):
    employer = fake_supabase.database["employer_profiles"][0]
    employer.update({
        "employer_type": "REGISTERED_BUSINESS",
        "contact_person_name": "Employer",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    fake_supabase.database["employer_onboarding_details"].append({
        "employer_id": "employer-id",
        "business_name": "Example Business Pvt Ltd",
        "business_type": "Private Limited",
        "business_category": "Technology",
        "registered_address": "12 IT Park",
        "work_location": "Pune",
        "company_email": "biz@example.com",
        "company_phone": "919876543210",
        "director_name": "Authorized Signatory",
        "director_phone": "919876543211",
        "director_email": "director@example.com",
        "director_address": "Pune",
    })
    monkeypatch.setattr(employers, "supabase", fake_supabase)
    monkeypatch.setattr(verification_service, "supabase", fake_supabase)
    monkeypatch.setattr(onboarding_service, "supabase", fake_supabase)

    result = await employers.complete_onboarding(CompleteOnboardingSchema(), USER)

    assert result.onboarding_status == "COMPLETED"
    assert result.verification_status == "VERIFIED"
    assert OnboardingService.determine_next_step(USER) == "DASHBOARD"


@pytest.mark.asyncio
async def test_registered_industry_can_complete_without_cin_or_aadhaar(fake_supabase, monkeypatch):
    employer = fake_supabase.database["employer_profiles"][0]
    employer.update({
        "employer_type": "REGISTERED_INDUSTRY",
        "contact_person_name": "Employer",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    fake_supabase.database["employer_onboarding_details"].append({
        "employer_id": "employer-id",
        "business_name": "Example Industries",
        "business_type": "Private Limited",
        "business_category": "Technology",
        "industry_type": "Manufacturing",
        "industry_category": "Engineering",
        "registered_address": "12 IT Park",
        "work_location": "Pune",
        "company_email": "biz@example.com",
        "company_phone": "919876543210",
        "director_name": "Authorized Signatory",
        "director_phone": "919876543211",
        "director_email": "director@example.com",
        "director_address": "Pune",
    })
    monkeypatch.setattr(employers, "supabase", fake_supabase)
    monkeypatch.setattr(verification_service, "supabase", fake_supabase)
    monkeypatch.setattr(onboarding_service, "supabase", fake_supabase)

    result = await employers.complete_onboarding(CompleteOnboardingSchema(), USER)

    assert result.onboarding_status == "COMPLETED"
    assert OnboardingService.determine_next_step(USER) == "DASHBOARD"
