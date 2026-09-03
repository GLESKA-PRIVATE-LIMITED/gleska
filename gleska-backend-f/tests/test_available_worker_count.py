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


class Query:
    def __init__(self, count):
        self.count = count
        self.filters = []
        self.select_args = None

    def select(self, fields, **kwargs):
        self.select_args = (fields, kwargs)
        return self

    def eq(self, field, value):
        self.filters.append((field, value))
        return self

    def execute(self):
        return SimpleNamespace(count=self.count)


class FakeSupabase:
    def __init__(self, count):
        self.query = Query(count)

    def table(self, name):
        assert name == "worker_profiles"
        return self.query


@pytest.mark.asyncio
@pytest.mark.parametrize("count", [0, 1, 3])
async def test_available_worker_count_uses_current_completed_profiles(monkeypatch, count):
    fake = FakeSupabase(count)
    monkeypatch.setattr(employers, "supabase", fake)

    result = await employers.get_available_worker_count(USER)

    assert result == {"count": count}
    assert fake.query.select_args == ("id", {"count": "exact", "head": True})
    assert fake.query.filters == [
        ("availability_status", "AVAILABLE"),
        ("profile_completed", True),
    ]


@pytest.mark.asyncio
async def test_available_worker_count_requires_employer_dependency():
    dependency = inspect.signature(employers.get_available_worker_count).parameters["user"].default.dependency
    assert dependency.__name__ == "require_employer"