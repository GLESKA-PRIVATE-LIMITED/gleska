from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.routers import workers
from app.routers.workers import get_worker_profile, update_worker_profile
from app.schemas.worker import UpdateWorkerProfileSchema


USER = SimpleNamespace(id="user-id", role="WORKER")


def profile_row(**overrides):
    row = {
        "id": "profile-id",
        "user_id": "user-id",
        "trade_id": "Electrician",
        "experience_years": 8,
        "expected_daily_wage": 999,
        "availability_status": "AVAILABLE",
        "city": "Nanded",
        "state": "Maharashtra",
        "latitude": None,
        "longitude": None,
        "profile_completed": True,
        "onboarding_status": "COMPLETED",
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
    row.update(overrides)
    return row


class FakeQuery:
    def __init__(self, row):
        self.row = row
        self.updated = None
        self.single_result = False

    def select(self, _fields):
        return self

    def eq(self, _field, _value):
        return self

    def single(self):
        self.single_result = True
        return self

    def update(self, data):
        self.updated = data
        self.row.update(data)
        self.single_result = False
        return self

    def execute(self):
        return SimpleNamespace(data=self.row if self.single_result else [self.row] if self.row else [])


class FakeSupabase:
    def __init__(self, row):
        self.query = FakeQuery(row)

    def table(self, _name):
        return self.query


@pytest.mark.asyncio
async def test_worker_profile_save_and_followup_get_persist_trade_and_completion(monkeypatch):
    row = profile_row(trade_id=None, profile_completed=False, onboarding_status="IN_PROGRESS")
    fake_supabase = FakeSupabase(row)
    monkeypatch.setattr(workers, "supabase", fake_supabase)

    request = UpdateWorkerProfileSchema(
        trade_id="Electrician",
        experience_years=8,
        expected_daily_wage=999,
        city="Nanded",
        state="Maharashtra",
        availability_status="AVAILABLE",
    )
    saved = await update_worker_profile(request, USER)
    loaded = await get_worker_profile(USER)

    assert saved.trade_id == "Electrician"
    assert saved.onboarding_status == "COMPLETED"
    assert loaded.trade_id == "Electrician"
    assert loaded.onboarding_status == "COMPLETED"
    assert fake_supabase.query.updated["onboarding_status"] == "COMPLETED"


def test_worker_profile_rejects_blank_trade():
    with pytest.raises(ValidationError):
        UpdateWorkerProfileSchema(trade_id="   ")


@pytest.mark.parametrize("field", ["experience_years", "expected_daily_wage"])
def test_worker_profile_rejects_negative_numeric_values(field):
    with pytest.raises(ValidationError):
        UpdateWorkerProfileSchema(**{field: -1})


# Tests for 8-field profile completion alignment (audit fix)
def user_with_fields(**overrides):
    """Create a UserResponse-like object with required fields."""
    defaults = {
        "id": "user-id",
        "name": "John Doe",
        "mobile": "+919999999999",
        "email": "john@example.com",
        "role": "WORKER",
        "is_mobile_verified": True,
        "is_active": True,
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


@pytest.mark.asyncio
async def test_profile_completed_requires_all_8_fields(monkeypatch):
    """Profile completion requires all 8 fields: name, mobile, email, trade_id, exp, wage, location, availability."""
    # Start with all fields present
    row = profile_row(
        trade_id="Electrician",
        experience_years=8,
        expected_daily_wage=999,
        city="Nanded",
        state="Maharashtra",
        address="Street 1",
        availability_status="AVAILABLE",
    )
    fake_supabase = FakeSupabase(row)
    monkeypatch.setattr(workers, "supabase", fake_supabase)

    # User with all required fields
    user = user_with_fields(
        name="John Doe",
        mobile="+919999999999",
        email="john@example.com",
    )

    request = UpdateWorkerProfileSchema(availability_status="AVAILABLE")
    result = await update_worker_profile(request, user)

    assert result.profile_completed is True
    assert result.onboarding_status == "COMPLETED"


@pytest.mark.asyncio
async def test_profile_incomplete_missing_user_name(monkeypatch):
    """Profile incomplete if user.name is missing."""
    row = profile_row(
        trade_id="Electrician",
        experience_years=8,
        expected_daily_wage=999,
        city="Nanded",
        address="Street 1",
        availability_status="AVAILABLE",
    )
    fake_supabase = FakeSupabase(row)
    monkeypatch.setattr(workers, "supabase", fake_supabase)

    # User with missing name
    user = user_with_fields(name="", mobile="+919999999999", email="john@example.com")

    request = UpdateWorkerProfileSchema(availability_status="AVAILABLE")
    result = await update_worker_profile(request, user)

    assert result.profile_completed is False
    assert result.onboarding_status == "IN_PROGRESS"


@pytest.mark.asyncio
async def test_profile_incomplete_missing_user_mobile(monkeypatch):
    """Profile incomplete if user.mobile is missing."""
    row = profile_row(
        trade_id="Electrician",
        experience_years=8,
        expected_daily_wage=999,
        city="Nanded",
        address="Street 1",
        availability_status="AVAILABLE",
    )
    fake_supabase = FakeSupabase(row)
    monkeypatch.setattr(workers, "supabase", fake_supabase)

    # User with missing mobile
    user = user_with_fields(name="John Doe", mobile=None, email="john@example.com")

    request = UpdateWorkerProfileSchema(availability_status="AVAILABLE")
    result = await update_worker_profile(request, user)

    assert result.profile_completed is False
    assert result.onboarding_status == "IN_PROGRESS"


@pytest.mark.asyncio
async def test_profile_incomplete_missing_user_email(monkeypatch):
    """Profile incomplete if user.email is missing."""
    row = profile_row(
        trade_id="Electrician",
        experience_years=8,
        expected_daily_wage=999,
        city="Nanded",
        address="Street 1",
        availability_status="AVAILABLE",
    )
    fake_supabase = FakeSupabase(row)
    monkeypatch.setattr(workers, "supabase", fake_supabase)

    # User with missing email
    user = user_with_fields(name="John Doe", mobile="+919999999999", email=None)

    request = UpdateWorkerProfileSchema(availability_status="AVAILABLE")
    result = await update_worker_profile(request, user)

    assert result.profile_completed is False
    assert result.onboarding_status == "IN_PROGRESS"


@pytest.mark.asyncio
async def test_profile_incomplete_missing_trade_id(monkeypatch):
    """Profile incomplete if trade_id is missing."""
    row = profile_row(
        trade_id=None,
        experience_years=8,
        expected_daily_wage=999,
        city="Nanded",
        address="Street 1",
        availability_status="AVAILABLE",
    )
    fake_supabase = FakeSupabase(row)
    monkeypatch.setattr(workers, "supabase", fake_supabase)

    user = user_with_fields()
    request = UpdateWorkerProfileSchema(availability_status="AVAILABLE")
    result = await update_worker_profile(request, user)

    assert result.profile_completed is False
    assert result.onboarding_status == "IN_PROGRESS"


@pytest.mark.asyncio
async def test_profile_incomplete_missing_experience_years(monkeypatch):
    """Profile incomplete if experience_years is missing."""
    row = profile_row(
        trade_id="Electrician",
        experience_years=None,
        expected_daily_wage=999,
        city="Nanded",
        address="Street 1",
        availability_status="AVAILABLE",
    )
    fake_supabase = FakeSupabase(row)
    monkeypatch.setattr(workers, "supabase", fake_supabase)

    user = user_with_fields()
    request = UpdateWorkerProfileSchema(availability_status="AVAILABLE")
    result = await update_worker_profile(request, user)

    assert result.profile_completed is False
    assert result.onboarding_status == "IN_PROGRESS"


@pytest.mark.asyncio
async def test_profile_incomplete_missing_expected_daily_wage(monkeypatch):
    """Profile incomplete if expected_daily_wage is missing."""
    row = profile_row(
        trade_id="Electrician",
        experience_years=8,
        expected_daily_wage=None,
        city="Nanded",
        address="Street 1",
        availability_status="AVAILABLE",
    )
    fake_supabase = FakeSupabase(row)
    monkeypatch.setattr(workers, "supabase", fake_supabase)

    user = user_with_fields()
    request = UpdateWorkerProfileSchema(availability_status="AVAILABLE")
    result = await update_worker_profile(request, user)

    assert result.profile_completed is False
    assert result.onboarding_status == "IN_PROGRESS"


@pytest.mark.asyncio
async def test_profile_incomplete_missing_location_both_city_and_address(monkeypatch):
    """Profile incomplete if both city and address are missing."""
    row = profile_row(
        trade_id="Electrician",
        experience_years=8,
        expected_daily_wage=999,
        city=None,
        address=None,
        availability_status="AVAILABLE",
    )
    fake_supabase = FakeSupabase(row)
    monkeypatch.setattr(workers, "supabase", fake_supabase)

    user = user_with_fields()
    request = UpdateWorkerProfileSchema(availability_status="AVAILABLE")
    result = await update_worker_profile(request, user)

    assert result.profile_completed is False
    assert result.onboarding_status == "IN_PROGRESS"


@pytest.mark.asyncio
async def test_profile_complete_with_city_only(monkeypatch):
    """Profile complete if city is present (address not required)."""
    row = profile_row(
        trade_id="Electrician",
        experience_years=8,
        expected_daily_wage=999,
        city="Nanded",
        address=None,
        availability_status="AVAILABLE",
    )
    fake_supabase = FakeSupabase(row)
    monkeypatch.setattr(workers, "supabase", fake_supabase)

    user = user_with_fields()
    request = UpdateWorkerProfileSchema(availability_status="AVAILABLE")
    result = await update_worker_profile(request, user)

    assert result.profile_completed is True
    assert result.onboarding_status == "COMPLETED"


@pytest.mark.asyncio
async def test_profile_complete_with_address_only(monkeypatch):
    """Profile complete if address is present (city not required)."""
    row = profile_row(
        trade_id="Electrician",
        experience_years=8,
        expected_daily_wage=999,
        city=None,
        address="Street 1",
        availability_status="AVAILABLE",
    )
    fake_supabase = FakeSupabase(row)
    monkeypatch.setattr(workers, "supabase", fake_supabase)

    user = user_with_fields()
    request = UpdateWorkerProfileSchema(availability_status="AVAILABLE")
    result = await update_worker_profile(request, user)

    assert result.profile_completed is True
    assert result.onboarding_status == "COMPLETED"


@pytest.mark.asyncio
async def test_profile_incomplete_availability_status_offline(monkeypatch):
    """Profile incomplete if availability_status is OFFLINE."""
    row = profile_row(
        trade_id="Electrician",
        experience_years=8,
        expected_daily_wage=999,
        city="Nanded",
        address="Street 1",
        availability_status="OFFLINE",
    )
    fake_supabase = FakeSupabase(row)
    monkeypatch.setattr(workers, "supabase", fake_supabase)

    user = user_with_fields()
    request = UpdateWorkerProfileSchema(availability_status="OFFLINE")
    result = await update_worker_profile(request, user)

    assert result.profile_completed is False
    assert result.onboarding_status == "IN_PROGRESS"


@pytest.mark.asyncio
async def test_profile_complete_with_availability_on_job(monkeypatch):
    """Profile complete if availability_status is ON_JOB."""
    row = profile_row(
        trade_id="Electrician",
        experience_years=8,
        expected_daily_wage=999,
        city="Nanded",
        address="Street 1",
        availability_status="ON_JOB",
    )
    fake_supabase = FakeSupabase(row)
    monkeypatch.setattr(workers, "supabase", fake_supabase)

    user = user_with_fields()
    request = UpdateWorkerProfileSchema(availability_status="ON_JOB")
    result = await update_worker_profile(request, user)

    assert result.profile_completed is True
    assert result.onboarding_status == "COMPLETED"
