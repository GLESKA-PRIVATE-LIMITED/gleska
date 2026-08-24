from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import employers
from app.schemas.auth import UserResponse
from app.schemas.employer import LegalIdentityOnboardingSchema, RegisteredIndustryOnboardingSchema
from app.schemas.verification import VerificationRequestSchema
from app.services import verification_service
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


def verified_record(employer_id="employer-id", status="VERIFIED"):
    now = datetime.now(timezone.utc).isoformat()
    return {
        "id": "verification-id",
        "employer_id": employer_id,
        "verification_type": "CIN",
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
    saved = await employers.update_registered_industry_onboarding(
        RegisteredIndustryOnboardingSchema(**onboarding_details()), USER,
    )

    assert verification.employer_id == saved.employer_id == "employer-id"
    assert verification.verification_type == listing.records[0].verification_type == "CIN"
    assert listing.records[0].status == "VERIFIED"
    assert saved.employer_id == "employer-id"
    assert fake_supabase.database["employer_verifications"][0]["status"] == "VERIFIED"


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["PENDING", "FAILED", "NOT_CONFIGURED"])
async def test_registered_industry_blocks_incomplete_cin(fake_supabase, status):
    fake_supabase.database["employer_onboarding_details"].append(persisted_identity())
    fake_supabase.database["employer_verifications"].append(verified_record(status=status))

    with pytest.raises(HTTPException) as error:
        await employers.update_registered_industry_onboarding(
            RegisteredIndustryOnboardingSchema(**onboarding_details()), USER,
        )

    assert error.value.status_code == 409
    assert fake_supabase.database["employer_verifications"][0]["status"] == status


@pytest.mark.asyncio
async def test_registered_industry_blocks_missing_or_other_employer_cin(fake_supabase):
    fake_supabase.database["employer_onboarding_details"].append(persisted_identity())
    other_record = verified_record(employer_id="other-employer")
    fake_supabase.database["employer_verifications"].append(other_record)

    with pytest.raises(HTTPException) as error:
        await employers.update_registered_industry_onboarding(
            RegisteredIndustryOnboardingSchema(**onboarding_details()), USER,
        )

    assert error.value.status_code == 409

    fake_supabase.database["employer_verifications"].clear()
    with pytest.raises(HTTPException) as missing_error:
        await employers.update_registered_industry_onboarding(
            RegisteredIndustryOnboardingSchema(**onboarding_details()), USER,
        )
    assert missing_error.value.status_code == 409


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "identity",
    [
        {"business_name": "Example Industries", "cin_number": "U12345678901234567891"},
        {"business_name": "Changed Industries", "cin_number": CIN},
    ],
)
async def test_identity_change_invalidates_cin_and_blocks_details(fake_supabase, identity):
    fake_supabase.database["employer_onboarding_details"].append(persisted_identity())
    fake_supabase.database["employer_verifications"].append(verified_record())

    await employers.update_legal_identity(LegalIdentityOnboardingSchema(**identity), USER)

    assert fake_supabase.database["employer_verifications"][0]["status"] == "FAILED"
    with pytest.raises(HTTPException) as error:
        await employers.update_registered_industry_onboarding(
            RegisteredIndustryOnboardingSchema(**onboarding_details()), USER,
        )
    assert error.value.status_code == 409
