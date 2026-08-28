from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import UUID

import pytest
from pydantic import ValidationError

from app.core.config import settings
from app.schemas.auth import UserResponse
from app.schemas.job import JobCreate
from app.services import job_service
from app.services.job_service import JobNotFound, JobService


USER = UserResponse(
    id="user-id", name="Employer", mobile="919876543210", role="EMPLOYER",
    is_mobile_verified=True, is_active=True, created_at=datetime.now(timezone.utc),
    updated_at=datetime.now(timezone.utc),
)
SITE_ID = "11111111-1111-1111-1111-111111111111"


class Query:
    def __init__(self, table, rows):
        self.table = table
        self.rows = rows
        self.payload = None
        self.filters = []

    def select(self, _fields): return self
    def eq(self, field, value): self.filters.append((field, value)); return self
    def single(self): return self
    def order(self, *_args, **_kwargs): return self
    def insert(self, payload): self.payload = payload; return self
    def update(self, payload):
        self.payload = payload
        return self
    def update(self, payload):
        self.payload = payload
        return self

    def execute(self):
        if self.payload is not None:
            now = datetime.now(timezone.utc)
            if self.table == "employer_profiles":
                for row in self.rows:
                    row.update(self.payload)
                return SimpleNamespace(data=self.rows)
            row = {"id": "job-id", **self.payload, "created_at": now, "updated_at": now}
            self.rows[:] = [row]
            return SimpleNamespace(data=[row])
        if self.table in {"employers", "employer_profiles", "job_sites"}:
            return SimpleNamespace(data=self.rows[0] if self.rows else {})
        return SimpleNamespace(data=self.rows)


class FakeSupabase:
    def __init__(self, site_rows=None):
        self.tables = {
            "employers": Query("employers", [{"id": "employer-id", "supabase_auth_id": "user-id", "is_active": True, "is_deleted": False}]),
            "employer_profiles": Query("employer_profiles", [{"id": "profile-id", "onboarding_status": "COMPLETED", "has_availed_free_dispatch": False, "subscription_valid_until": None}]),
            "job_sites": Query("job_sites", site_rows if site_rows is not None else [{"id": SITE_ID}]),
            "jobs": Query("jobs", []),
        }

    def table(self, name): return self.tables[name]


def test_job_schema_applies_defaults_and_normalizes_title():
    job = JobCreate(job_site_id=SITE_ID, title="  Plumber   ", headcount_required=2)
    assert job.title == "Plumber"
    assert job.max_daily_salary is None
    assert job.min_experience is None


@pytest.mark.parametrize("payload", [
    {"job_site_id": SITE_ID, "title": "", "headcount_required": 1},
    {"job_site_id": SITE_ID, "title": "Worker", "headcount_required": 0},
    {"job_site_id": SITE_ID, "title": "Worker", "headcount_required": 1001},
    {"job_site_id": SITE_ID, "title": "Worker", "headcount_required": 1, "max_daily_salary": -1},
    {"job_site_id": SITE_ID, "title": "Worker", "headcount_required": 1, "min_experience": -1},
])
def test_job_schema_rejects_invalid_values(payload):
    with pytest.raises(ValidationError):
        JobCreate(**payload)


def test_create_job_uses_authenticated_employer_and_searching_status(monkeypatch):
    fake = FakeSupabase()
    monkeypatch.setattr(job_service, "supabase", fake)
    monkeypatch.setattr(job_service.MatchingService, "create_matches", lambda job_id: [])
    request = JobCreate(job_site_id=SITE_ID, title="Plumber", headcount_required=3, max_daily_salary=Decimal("800"), min_experience=2)

    result = JobService.create(USER, request)

    UUID(result.id)
    assert result.employer_id == "profile-id"
    assert result.status == "SEARCHING"
    assert fake.tables["jobs"].payload["id"]
    assert fake.tables["jobs"].payload["employer_id"] == "profile-id"
    assert fake.tables["jobs"].payload["max_daily_salary"] == "800"
    assert fake.tables["jobs"].payload["created_at"]
    assert ("user_id", "user-id") in fake.tables["employer_profiles"].filters


def test_create_job_rejects_non_owned_site(monkeypatch):
    fake = FakeSupabase(site_rows=[])
    monkeypatch.setattr(job_service, "supabase", fake)
    request = JobCreate(job_site_id=SITE_ID, title="Plumber", headcount_required=1)

    with pytest.raises(JobNotFound, match="JOB_SITE_NOT_FOUND"):
        JobService.create(USER, request)


def test_create_job_rejects_incomplete_onboarding(monkeypatch):
    fake = FakeSupabase()
    fake.tables["employer_profiles"].rows[0]["onboarding_status"] = "IN_PROGRESS"
    monkeypatch.setattr(job_service, "supabase", fake)
    request = JobCreate(job_site_id=SITE_ID, title="Plumber", headcount_required=1)

    with pytest.raises(PermissionError, match="EMPLOYER_ONBOARDING_INCOMPLETE"):
        JobService.create(USER, request)


def test_list_jobs_is_scoped_to_authenticated_employer(monkeypatch):
    fake = FakeSupabase()
    now = datetime.now(timezone.utc)
    fake.tables["jobs"].rows = [{
        "id": "job-id",
        "employer_id": "employer-id",
        "job_site_id": SITE_ID,
        "title": "Construction Worker",
        "headcount_required": 2,
        "max_daily_salary": "800",
        "min_experience": 1,
        "status": "SEARCHING",
        "created_at": now,
        "updated_at": now,
    }]
    monkeypatch.setattr(job_service, "supabase", fake)

    result = JobService.list_for_user(USER)

    assert len(result) == 1
    assert result[0].title == "Construction Worker"
    assert result[0].status == "SEARCHING"
    assert ("employer_id", "profile-id") in fake.tables["jobs"].filters