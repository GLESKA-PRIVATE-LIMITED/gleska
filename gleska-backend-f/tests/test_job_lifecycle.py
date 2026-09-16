from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.schemas.auth import UserResponse
from app.services import job_service
from app.services.job_service import JobLifecycleError, JobService


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


class Rpc:
    def __init__(self, result=None, error=None):
        self.result = result
        self.error = error

    def execute(self):
        if self.error:
            raise RuntimeError(self.error)
        return SimpleNamespace(data=self.result)


class FakeSupabase:
    def __init__(self, result=None, error=None):
        self.result = result
        self.error = error
        self.calls = []

    def rpc(self, name, params):
        self.calls.append((name, params))
        return Rpc(self.result, self.error)


def job_row(status):
    return {
        "id": "job-id",
        "employer_id": "employer-id",
        "job_site_id": "site-id",
        "title": "Cook",
        "headcount_required": 2,
        "status": status,
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }


def patch_employer(monkeypatch):
    monkeypatch.setattr(
        JobService,
        "_employer_profile",
        staticmethod(lambda user: {"id": "employer-id", "onboarding_status": "COMPLETED"}),
    )


def test_cancel_calls_authoritative_rpc(monkeypatch):
    fake = FakeSupabase([job_row("CANCELLED")])
    monkeypatch.setattr(job_service, "supabase", fake)
    patch_employer(monkeypatch)

    result = JobService.cancel_for_user(USER, "job-id")

    assert result.status == "CANCELLED"
    assert fake.calls == [("cancel_job_for_employer", {"p_employer_id": "employer-id", "p_job_id": "job-id"})]


def test_cancel_rejects_completed_job(monkeypatch):
    fake = FakeSupabase(error="JOB_ALREADY_COMPLETED")
    monkeypatch.setattr(job_service, "supabase", fake)
    patch_employer(monkeypatch)

    with pytest.raises(JobLifecycleError, match="JOB_ALREADY_COMPLETED"):
        JobService.cancel_for_user(USER, "job-id")


def test_complete_calls_authoritative_rpc(monkeypatch):
    fake = FakeSupabase([job_row("COMPLETED")])
    monkeypatch.setattr(job_service, "supabase", fake)
    patch_employer(monkeypatch)

    result = JobService.complete_for_user(USER, "job-id")

    assert result.status == "COMPLETED"
    assert fake.calls == [("complete_job_for_employer", {"p_employer_id": "employer-id", "p_job_id": "job-id"})]


@pytest.mark.parametrize("error", ["JOB_CANCELLED", "JOB_NOT_READY_FOR_COMPLETION", "JOB_ALREADY_COMPLETED"])
def test_completion_rejects_invalid_lifecycle(error, monkeypatch):
    fake = FakeSupabase(error=error)
    monkeypatch.setattr(job_service, "supabase", fake)
    patch_employer(monkeypatch)

    with pytest.raises(JobLifecycleError, match=error):
        JobService.complete_for_user(USER, "job-id")
