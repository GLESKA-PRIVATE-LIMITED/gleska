from datetime import datetime, timezone
import inspect
from types import SimpleNamespace

import pytest

from app.routers import employers
from app.schemas.auth import UserResponse


USER = UserResponse(
    id="employer-user",
    name="Employer",
    mobile="919876543210",
    role="EMPLOYER",
    is_mobile_verified=True,
    is_active=True,
    created_at=datetime.now(timezone.utc),
    updated_at=datetime.now(timezone.utc),
)


@pytest.mark.asyncio
@pytest.mark.parametrize("count", [0, 1, 3])
async def test_available_worker_count_uses_employer_match_candidates(monkeypatch, count):
    monkeypatch.setattr(
        employers.JobMatchService,
        "available_worker_count_for_user",
        lambda user: count,
    )
    monkeypatch.setattr(employers.JobMatchService, "active_worker_count_for_user", lambda user: 1)

    result = await employers.get_available_worker_count(USER)

    assert result == {"count": count, "active_count": 1}


@pytest.mark.asyncio
async def test_available_worker_count_is_zero_without_current_matches(monkeypatch):
    from app.services.job_match_service import JobMatchService
    from app.services.job_service import JobService

    monkeypatch.setattr(JobService, "_employer_profile", staticmethod(lambda user: {"id": "employer-id"}))
    monkeypatch.setattr(JobMatchService, "_current_rows", staticmethod(lambda employer_id: []))

    assert JobMatchService.available_worker_count_for_user(USER) == 0


def test_active_worker_count_is_distinct(monkeypatch):
    from app.services import job_match_service
    from app.services.job_match_service import JobMatchService
    from app.services.job_service import JobService

    class Query:
        def select(self, fields):
            assert fields == "worker_profile_id,jobs!inner(status,employer_id)"
            return self

        def eq(self, field, value):
            return self

        def in_(self, field, values):
            assert (field, values) == ("jobs.status", ["SEARCHING", "FILLED"])
            return self

        def execute(self):
            return SimpleNamespace(data=[
                {"worker_profile_id": "worker-a"},
                {"worker_profile_id": "worker-a"},
                {"worker_profile_id": "worker-b"},
            ])

    monkeypatch.setattr(JobService, "_employer_profile", staticmethod(lambda user: {"id": "employer-id"}))
    monkeypatch.setattr(job_match_service.supabase, "table", lambda name: Query())

    assert JobMatchService.active_worker_count_for_user(USER) == 2


@pytest.mark.asyncio
async def test_available_worker_count_requires_employer_dependency():
    dependency = inspect.signature(employers.get_available_worker_count).parameters["user"].default.dependency
    assert dependency.__name__ == "require_employer"