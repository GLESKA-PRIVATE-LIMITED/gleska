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
