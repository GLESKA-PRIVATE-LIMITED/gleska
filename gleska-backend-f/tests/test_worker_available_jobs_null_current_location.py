from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.routers import workers

USER = SimpleNamespace(id="user-id", role="WORKER")


def _profile_row(**overrides):
    row = {
        "id": "profile-id",
        "user_id": "user-id",
        "latitude": 18.5514,
        "longitude": 73.8219,
        "availability_status": "AVAILABLE",
        "profile_completed": True,
    }
    row.update(overrides)
    return row


class FakeQuery:
    def __init__(self, rows):
        self.rows = rows
        self._field = None
        self._value = None

    def select(self, _fields):
        return self

    def eq(self, _field, _value):
        self._field = _field
        self._value = _value
        return self

    def single(self):
        return self

    def maybe_single(self):
        return self

    def execute(self):
        if isinstance(self.rows, list):
            filtered = [row for row in self.rows if row.get(self._field) == self._value]
            if self._field == "worker_profile_id":
                if not filtered:
                    return None
                return SimpleNamespace(data=filtered[0])
            return SimpleNamespace(data=filtered)
        return SimpleNamespace(data=self.rows)


class FakeSupabase:
    def __init__(self, rows_by_table):
        self.rows_by_table = rows_by_table

    def table(self, name):
        return FakeQuery(self.rows_by_table.get(name, []))


@pytest.mark.asyncio
async def test_available_jobs_no_live_row_falls_back_to_profile(monkeypatch):
    fake_supabase = FakeSupabase({
        "worker_profiles": [_profile_row()],
        "worker_current_locations": [],
    })
    monkeypatch.setattr(workers, "supabase", fake_supabase)
    monkeypatch.setattr(
        workers,
        "MatchingService",
        SimpleNamespace(available_jobs=lambda *args, **kwargs: [{"job_id": "job-123"}]),
    )

    result = await workers.get_available_jobs(USER)

    assert result == {"jobs": [{"job_id": "job-123"}]}


@pytest.mark.asyncio
async def test_available_jobs_fresh_live_location_used(monkeypatch):
    fake_supabase = FakeSupabase({
        "worker_profiles": [_profile_row()],
        "worker_current_locations": [{
            "worker_profile_id": "profile-id",
            "latitude": 18.5514,
            "longitude": 73.8219,
            "accuracy_m": 100,
            "updated_at": datetime.now(timezone.utc),
        }],
    })
    monkeypatch.setattr(workers, "supabase", fake_supabase)
    monkeypatch.setattr(
        workers,
        "MatchingService",
        SimpleNamespace(available_jobs=lambda *args, **kwargs: [{"job_id": "job-live"}]),
    )

    result = await workers.get_available_jobs(USER)

    assert result == {"jobs": [{"job_id": "job-live"}]}


@pytest.mark.asyncio
async def test_available_jobs_stale_live_location_falls_back_to_profile(monkeypatch):
    fake_supabase = FakeSupabase({
        "worker_profiles": [_profile_row()],
        "worker_current_locations": [{
            "worker_profile_id": "profile-id",
            "latitude": 18.5514,
            "longitude": 73.8219,
            "accuracy_m": 100,
            "updated_at": datetime.now(timezone.utc).replace(year=2020),
        }],
    })
    monkeypatch.setattr(workers, "supabase", fake_supabase)
    monkeypatch.setattr(
        workers,
        "MatchingService",
        SimpleNamespace(available_jobs=lambda *args, **kwargs: [{"job_id": "job-profile"}]),
    )

    result = await workers.get_available_jobs(USER)

    assert result == {"jobs": [{"job_id": "job-profile"}]}


@pytest.mark.asyncio
async def test_available_jobs_inaccurate_live_location_falls_back_to_profile(monkeypatch):
    fake_supabase = FakeSupabase({
        "worker_profiles": [_profile_row()],
        "worker_current_locations": [{
            "worker_profile_id": "profile-id",
            "latitude": 18.5514,
            "longitude": 73.8219,
            "accuracy_m": 2000,
            "updated_at": datetime.now(timezone.utc),
        }],
    })
    monkeypatch.setattr(workers, "supabase", fake_supabase)
    monkeypatch.setattr(
        workers,
        "MatchingService",
        SimpleNamespace(available_jobs=lambda *args, **kwargs: [{"job_id": "job-profile"}]),
    )

    result = await workers.get_available_jobs(USER)

    assert result == {"jobs": [{"job_id": "job-profile"}]}


@pytest.mark.asyncio
async def test_available_jobs_without_any_location_errors_cleanly(monkeypatch):
    fake_supabase = FakeSupabase({
        "worker_profiles": [_profile_row(latitude=None, longitude=None)],
        "worker_current_locations": [],
    })
    monkeypatch.setattr(workers, "supabase", fake_supabase)

    with pytest.raises(workers.HTTPException) as exc:
        await workers.get_available_jobs(USER)

    assert exc.value.status_code == 400
    assert exc.value.detail == "CURRENT_LOCATION_REQUIRED"
