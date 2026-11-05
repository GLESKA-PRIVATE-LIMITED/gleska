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


class FakeRpc:
    def __init__(self, rows):
        self.rows = rows
        self.calls = []

    def rpc(self, name, params):
        self.calls.append((name, params))
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=self.rows))


def test_search_available_workers_calls_pool_rpc_and_shapes_result(monkeypatch):
    rows = [{
        "worker_profile_id": "w1", "name": "Asha", "trade_id": "electrician",
        "skills": ["wiring"], "experience_years": 4, "expected_daily_wage": 700,
        "availability_status": "AVAILABLE", "city": "Hyderabad", "state": "TS",
        "is_verified": True, "total_count": 1,
    }]
    fake = FakeRpc(rows)
    monkeypatch.setattr(employer_worker_service, "supabase", fake)

    result = employer_worker_service.EmployerWorkerService.search_available_workers(
        trade="electrician", limit=5,
    )

    name, params = fake.calls[0]
    assert name == "list_employer_workers"
    assert params["p_trade"] == "electrician"
    assert params["p_limit"] == 5
    assert params["p_availability"] is None  # only_available defaults False
    assert params["p_city"] is None
    assert result["status"] == "FOUND"
    assert result["total_count"] == 1 and result["location_filtered"] is False
    assert result["workers"][0] == {
        "worker_profile_id": "w1", "name": "Asha", "trade": "electrician",
        "skills": ["wiring"], "experience_years": 4, "expected_daily_wage": 700.0,
        "availability_status": "AVAILABLE", "city": "Hyderabad", "state": "TS", "is_verified": True,
    }


def test_search_available_workers_applies_city_and_availability_filters(monkeypatch):
    fake = FakeRpc([])
    monkeypatch.setattr(employer_worker_service, "supabase", fake)

    result = employer_worker_service.EmployerWorkerService.search_available_workers(
        trade="mason", city="Pune", only_available=True, limit=100,
    )

    _, params = fake.calls[0]
    assert params["p_city"] == "Pune"
    assert params["p_availability"] == "AVAILABLE"
    assert params["p_limit"] == 50  # capped at 50
    assert result["status"] == "NO_MATCHES" and result["location_filtered"] is True


class FakeQuery:
    def __init__(self, data, count=None):
        self.data = data
        self.count = count
        self.filters = []
        self.select_args = []
        self.execution_ranges = []

    def select(self, *_args, **_kwargs):
        self.select_args.extend(_args)
        return self

    def eq(self, *args):
        self.filters.append(("eq", *args))
        return self

    def maybe_single(self):
        return self

    def execute(self):
        bounds = next((item[1:3] for item in reversed(self.filters) if item[0] == "range"), None)
        if bounds:
            self.execution_ranges.append(bounds)
            data = self.data[bounds[0]:bounds[1] + 1]
        else:
            data = self.data
        return SimpleNamespace(data=data, count=self.count)

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


def history_row(job_id, title, attendance=None, name="Worker A"):
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
            "users": {"name": name, "profile_photo_path": None},
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


@pytest.mark.parametrize(
    ("sort", "expected_names"),
    [
        ("name_asc", [f"Worker {index:03}" for index in range(12, 24)]),
        ("name_desc", [f"Worker {index:03}" for index in range(92, 80, -1)]),
    ],
)
def test_name_sort_sorts_all_filtered_rows_before_pagination(monkeypatch, sort, expected_names):
    matches = [
        history_row(f"job-{index}", "Installation", name=f"Worker {index:03}")
        for index in reversed(range(105))
    ]
    fake = FakeSupabase(matches)
    monkeypatch.setattr(employer_worker_service, "supabase", fake)

    result = employer_worker_service.EmployerWorkerService.list_workers(
        user_id="employer-user-a", page=2, limit=12, sort=sort,
        trade="Electrician", skill="Wiring", min_experience=2, max_experience=8,
        min_wage=500, max_wage=1000, availability="ON_JOB", city="Pune",
        search="Worker",
    )

    assert [item.name for item in result.items] == expected_names
    assert result.total == 105
    assert fake.match_query.execution_ranges == [(0, 99), (100, 199)]
    assert not any(
        entry[0] == "order" and entry[2].get("foreign_table") == "worker_profiles.users"
        for entry in fake.match_query.filters
    )
    assert ("eq", "jobs.employer_id", "employer-a") in fake.match_query.filters
    assert ("ilike", "worker_profiles.trade_id", "Electrician", {}) in fake.match_query.filters
    assert ("contains", "worker_profiles.skills", ["Wiring"], {}) in fake.match_query.filters
    assert ("gte", "worker_profiles.experience_years", 2, {}) in fake.match_query.filters
    assert ("lte", "worker_profiles.experience_years", 8, {}) in fake.match_query.filters
    assert ("gte", "worker_profiles.expected_daily_wage", 500, {}) in fake.match_query.filters
    assert ("lte", "worker_profiles.expected_daily_wage", 1000, {}) in fake.match_query.filters
    assert ("eq", "worker_profiles.availability_status", "ON_JOB") in fake.match_query.filters
    assert ("ilike", "worker_profiles.city", "Pune", {}) in fake.match_query.filters
    assert any(entry[0] == "or_" for entry in fake.match_query.filters)


@pytest.mark.parametrize(
    ("sort", "column", "descending"),
    [
        ("experience_desc", "experience_years", True),
        ("wage_asc", "expected_daily_wage", False),
        ("wage_desc", "expected_daily_wage", True),
    ],
)
def test_non_name_sorts_keep_database_order_and_requested_page(monkeypatch, sort, column, descending):
    fake = FakeSupabase([history_row("job-a", "Installation")])
    monkeypatch.setattr(employer_worker_service, "supabase", fake)

    employer_worker_service.EmployerWorkerService.list_workers(
        user_id="employer-user-a", page=3, limit=12, sort=sort,
    )

    assert (
        "order", column, {"foreign_table": "worker_profiles", "desc": descending, "nullsfirst": False}
    ) in fake.match_query.filters
    assert fake.match_query.execution_ranges == [(24, 35)]