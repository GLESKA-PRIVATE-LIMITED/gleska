from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.security import require_employer
from app.main import app
from app.routers import employers
from app.schemas.employer import EmployerPreferencesUpdate


class PreferencesQuery:
    def __init__(self, row=None):
        self.row = row
        self.filters = []
        self.payload = None

    def select(self, _fields):
        return self

    def eq(self, field, value):
        self.filters.append((field, value))
        return self

    def maybe_single(self):
        return self

    def upsert(self, payload, on_conflict):
        assert on_conflict == "user_id"
        self.payload = payload
        self.row = {
            "job_matching_notifications": True,
            "attendance_notifications": True,
            "security_alerts": True,
            "language": "EN",
            "updated_at": datetime.now(timezone.utc).isoformat(),
            **payload,
        }
        return self

    def execute(self):
        return SimpleNamespace(data=self.row)


class FakeSupabase:
    def __init__(self, row=None):
        self.preferences = PreferencesQuery(row)

    def table(self, name):
        assert name == "employer_preferences"
        return self.preferences


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "employer_type",
    ["REGISTERED_INDUSTRY", "REGISTERED_BUSINESS", "UNREGISTERED_BUSINESS", "INDIVIDUAL"],
)
async def test_employer_preferences_default_and_update_are_owner_scoped(monkeypatch, employer_type):
    fake = FakeSupabase()
    monkeypatch.setattr(employers, "supabase", fake)
    user = SimpleNamespace(id="employer-a", role="EMPLOYER", employer_type=employer_type)

    defaults = await employers.get_employer_preferences(user)
    assert defaults.job_matching_notifications is True
    assert fake.preferences.filters == [("user_id", "employer-a")]

    saved = await employers.update_employer_preferences(
        EmployerPreferencesUpdate(
            job_matching_notifications=False,
            attendance_notifications=False,
            language="HI",
        ),
        user,
    )

    assert saved.job_matching_notifications is False
    assert saved.attendance_notifications is False
    assert saved.language == "HI"
    assert fake.preferences.payload["user_id"] == "employer-a"


def test_employer_preferences_reject_invalid_language():
    with pytest.raises(ValidationError):
        EmployerPreferencesUpdate(language="FR")


def test_employer_preferences_reject_unauthenticated_request():
    app.dependency_overrides.pop(require_employer, None)
    response = TestClient(app).get("/api/v1/employers/me/preferences")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_employer_preferences_cannot_read_another_employers_row(monkeypatch):
    fake = FakeSupabase(
        {
            "job_matching_notifications": False,
            "attendance_notifications": True,
            "security_alerts": True,
            "language": "TA",
        }
    )
    monkeypatch.setattr(employers, "supabase", fake)

    result = await employers.get_employer_preferences(SimpleNamespace(id="employer-a", role="EMPLOYER"))

    assert result.language == "TA"
    assert ("user_id", "employer-a") in fake.preferences.filters
    assert ("user_id", "employer-b") not in fake.preferences.filters