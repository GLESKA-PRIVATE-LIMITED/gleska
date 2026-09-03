from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.core.config import settings
from app.schemas.auth import UserResponse
from app.schemas.job_site import JobSiteCreate
from app.services import job_site_service
from app.services.job_site_service import JobSiteHasJobs, JobSiteNotFound, JobSiteService


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


class Query:
    def __init__(self, table, rows):
        self.table = table
        self.rows = rows
        self.payload = None
        self.filters = []
        self.deleted = False

    def select(self, _fields):
        return self

    def eq(self, field, value):
        self.filters.append((field, value))
        return self

    def single(self):
        return self

    def maybe_single(self):
        return self

    def order(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def insert(self, payload):
        self.payload = payload
        return self

    def delete(self):
        self.deleted = True
        return self

    def execute(self):
        if self.payload is not None:
            now = datetime.now(timezone.utc)
            row = {
                "id": "site-id",
                "employer_id": self.payload["employer_id"],
                "name": self.payload["name"],
                "address": self.payload["address"],
                "location": {"type": "Point", "coordinates": [73.8567, 18.5204]},
                "created_at": now,
                "updated_at": now,
            }
            self.rows[:] = [row]
            return SimpleNamespace(data=[row])
        if self.deleted:
            deleted = self.rows[:]
            self.rows[:] = []
            return SimpleNamespace(data=deleted)
        if self.table == "employers":
            return SimpleNamespace(data=self.rows[0] if self.rows else {})
        if self.table == "employer_profiles":
            return SimpleNamespace(data=self.rows[0] if self.rows else {})
        if self.table == "job_sites" and any(field == "id" for field, _ in self.filters):
            return SimpleNamespace(data=self.rows[0] if self.rows else {})
        return SimpleNamespace(data=self.rows)


class FakeSupabase:
    def __init__(self, jobs=None):
        self.tables = {
            "employers": Query("employers", [{"id": "employer-id", "supabase_auth_id": "user-id", "is_active": True, "is_deleted": False}]),
            "employer_profiles": Query("employer_profiles", [{"id": "profile-id", "onboarding_status": "COMPLETED"}]),
            "job_sites": Query("job_sites", []),
            "jobs": Query("jobs", jobs or []),
        }

    def table(self, name):
        return self.tables[name]


@pytest.fixture
def site_request():
    return JobSiteCreate(name="  Main site  ", address="Main Road, Pune", latitude=18.5204, longitude=73.8567)


def test_create_job_site_uses_authenticated_employer_and_normalizes_text(monkeypatch, site_request):
    fake = FakeSupabase()
    monkeypatch.setattr(job_site_service, "supabase", fake)

    result = JobSiteService.create(USER, site_request)

    assert result.employer_id == "profile-id"
    assert result.name == "Main site"
    assert fake.tables["job_sites"].payload["id"]
    assert fake.tables["job_sites"].payload["employer_id"] == "profile-id"
    assert ("user_id", "user-id") in fake.tables["employer_profiles"].filters
    assert fake.tables["job_sites"].payload["location"] == "POINT(73.8567 18.5204)"
    assert fake.tables["job_sites"].payload["created_at"]


def test_list_job_sites_is_owner_scoped(monkeypatch):
    fake = FakeSupabase()
    fake.tables["job_sites"].rows = [{
        "id": "site-id", "employer_id": "employer-id", "name": "Site",
        "address": "Main Road, Pune", "location": {"type": "Point", "coordinates": [73.8, 18.5]},
        "created_at": datetime.now(timezone.utc), "updated_at": None,
    }]
    monkeypatch.setattr(job_site_service, "supabase", fake)

    result = JobSiteService.list_for_user(USER)

    assert [site.id for site in result] == ["site-id"]
    assert ("employer_id", "profile-id") in fake.tables["job_sites"].filters


def test_delete_rejects_site_with_jobs(monkeypatch):
    fake = FakeSupabase(jobs=[{"id": "job-id"}])
    fake.tables["job_sites"].rows = [{"id": "site-id"}]
    monkeypatch.setattr(job_site_service, "supabase", fake)

    with pytest.raises(JobSiteHasJobs, match="JOB_SITE_HAS_JOBS"):
        JobSiteService.delete(USER, "site-id")


def test_delete_rejects_site_not_owned(monkeypatch):
    fake = FakeSupabase()
    monkeypatch.setattr(job_site_service, "supabase", fake)

    with pytest.raises(JobSiteNotFound, match="JOB_SITE_NOT_FOUND"):
        JobSiteService.delete(USER, "other-site")


def test_site_creation_requires_completed_onboarding(monkeypatch, site_request):
    fake = FakeSupabase()
    fake.tables["employer_profiles"].rows[0]["onboarding_status"] = "IN_PROGRESS"
    monkeypatch.setattr(job_site_service, "supabase", fake)

    with pytest.raises(PermissionError, match="EMPLOYER_ONBOARDING_INCOMPLETE"):
        JobSiteService.create(USER, site_request)


def test_missing_employer_is_rejected(monkeypatch, site_request):
    fake = FakeSupabase()
    fake.tables["employer_profiles"].rows = []
    monkeypatch.setattr(job_site_service, "supabase", fake)

    with pytest.raises(JobSiteNotFound, match="EMPLOYER_NOT_FOUND"):
        JobSiteService.create(USER, site_request)


@pytest.mark.parametrize("coordinates", [(91, 0), (-91, 0), (0, 181), (0, -181), (0, 0), (float("inf"), 1), (1, float("-inf"))])
def test_invalid_coordinates_are_rejected(coordinates):
    with pytest.raises(ValueError):
        JobSiteCreate(name="Site", address="Main Road", latitude=coordinates[0], longitude=coordinates[1])


def test_blank_name_is_rejected():
    with pytest.raises(ValueError):
        JobSiteCreate(name="   ", address="Main Road", latitude=18.5, longitude=73.8)


@pytest.mark.parametrize("changes", [{"onboarding_status": "IN_PROGRESS"}])
def test_inactive_or_deleted_employer_is_rejected(monkeypatch, site_request, changes):
    fake = FakeSupabase()
    fake.tables["employer_profiles"].rows[0].update(changes)
    monkeypatch.setattr(job_site_service, "supabase", fake)

    with pytest.raises(PermissionError, match="EMPLOYER_ONBOARDING_INCOMPLETE"):
        JobSiteService.create(USER, site_request)
