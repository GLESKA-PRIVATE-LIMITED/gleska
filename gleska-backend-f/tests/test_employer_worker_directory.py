from pathlib import Path
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.schemas.worker import UpdateWorkerProfileSchema
from app.services import employer_worker_service


MIGRATION = (
    Path(__file__).resolve().parents[2]
    / "gleska-website"
    / "supabase"
    / "migrations"
    / "046_employer_worker_directory.sql"
).read_text(encoding="utf-8")


def test_worker_wage_reuses_existing_job_salary_ceiling():
    assert UpdateWorkerProfileSchema(expected_daily_wage=1_000_000).expected_daily_wage == 1_000_000
    with pytest.raises(ValidationError):
        UpdateWorkerProfileSchema(expected_daily_wage=1_000_000.01)


def test_directory_projection_requires_worker_role_and_excludes_invalid_wages():
    assert "worker.role = 'WORKER'" in MIGRATION
    assert "profile.expected_daily_wage <= 1000000" in MIGRATION
    assert "arrival_otp" not in MIGRATION
    assert "completion_otp" not in MIGRATION
    assert "latitude" not in MIGRATION
    assert "longitude" not in MIGRATION
    assert "worker.mobile" not in MIGRATION
    assert "worker.email" not in MIGRATION


class FakeQuery:
    def __init__(self, data, count=None):
        self.data = data
        self.count = count
        self.filters = []
        self.select_args = []

    def select(self, *_args, **_kwargs):
        self.select_args.extend(_args)
        return self

    def eq(self, *args):
        self.filters.append(("eq", *args))
        return self

    def maybe_single(self):
        return self

    def execute(self):
        return SimpleNamespace(data=self.data, count=self.count)

    def __getattr__(self, name):
        def chain(*args, **kwargs):
            self.filters.append((name, *args, kwargs))
            return self
        return chain


class FakeSupabase:
    def __init__(self, matches):
        self.employer_query = FakeQuery({"id": "employer-a"})
        self.match_query = FakeQuery(matches, len(matches))

    def table(self, name):
        if name == "employer_profiles":
            return self.employer_query
        if name == "job_matches":
            return self.match_query
        raise AssertionError(f"Unexpected table: {name}")


def history_row(job_id, title, attendance=None):
    return {
        "id": f"match-{job_id}",
        "status": "ACCEPTED",
        "created_at": "2026-01-01T09:00:00+00:00",
        "expires_at": "2026-01-02T09:00:00+00:00",
        "completed_at": None,
        "worker_profiles": {
            "id": "worker-a",
            "trade_id": "Electrician",
            "skills": ["Wiring"],
            "experience_years": 4,
            "expected_daily_wage": 900,
            "availability_status": "ON_JOB",
            "city": "Pune",
            "state": "Maharashtra",
            "profile_completed": True,
            "is_verified": True,
            "users": {"name": "Worker A", "profile_photo_path": None},
        },
        "jobs": {
            "id": job_id,
            "title": title,
            "status": "FILLED",
            "job_site_id": f"site-{job_id}",
            "employer_id": "employer-a",
            "job_sites": {
                "id": f"site-{job_id}",
                "name": "Main site",
                "address": "1 Main Road",
                "city": "Pune",
                "state": "Maharashtra",
                "pincode": "411001",
            },
        },
        "attendance": attendance or [],
    }


def test_history_is_employer_scoped_and_derives_duration(monkeypatch):
    row = history_row("job-a", "Panel installation", [{
        "attendance_date": "2026-01-03",
        "status": "PRESENT",
        "check_in_at": "2026-01-03T09:00:00+00:00",
        "check_out_at": "2026-01-03T11:30:00+00:00",
    }])
    fake = FakeSupabase([row])
    monkeypatch.setattr(employer_worker_service, "supabase", fake)

    result = employer_worker_service.EmployerWorkerService.list_workers(
        user_id="employer-user-a", page=1, limit=12,
    )

    assert result.total == 1
    assert result.items[0].job_id == "job-a"
    assert result.items[0].site_name == "Main site"
    assert result.items[0].attendance[0].duration_minutes == 150
    assert ("eq", "jobs.employer_id", "employer-a") in fake.match_query.filters
    assert "users!inner(name,profile_photo_path)" in fake.match_query.select_args[0]
    assert "worker_profiles!inner" in fake.match_query.select_args[0]
    assert "profile_photo_path,users!inner" not in fake.match_query.select_args[0]
    assert not hasattr(result.items[0], "mobile")
    assert not hasattr(result.items[0], "latitude")


def test_multiple_job_matches_remain_distinguishable(monkeypatch):
    fake = FakeSupabase([
        history_row("job-a", "Panel installation"),
        history_row("job-b", "Factory wiring"),
    ])
    monkeypatch.setattr(employer_worker_service, "supabase", fake)

    result = employer_worker_service.EmployerWorkerService.list_workers(
        user_id="employer-user-a", page=1, limit=12,
    )

    assert [item.job_id for item in result.items] == ["job-a", "job-b"]
    assert [item.job_title for item in result.items] == ["Panel installation", "Factory wiring"]
    assert all(item.completed_at is None for item in result.items)


def test_match_without_attendance_is_returned(monkeypatch):
    fake = FakeSupabase([history_row("job-a", "Panel installation")])
    monkeypatch.setattr(employer_worker_service, "supabase", fake)

    result = employer_worker_service.EmployerWorkerService.list_workers(
        user_id="employer-user-a", page=1, limit=12,
    )

    assert len(result.items) == 1
    assert result.items[0].attendance == []