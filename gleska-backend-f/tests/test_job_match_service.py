from datetime import datetime, timezone
from types import SimpleNamespace
from pathlib import Path

import pytest

from app.schemas.auth import UserResponse
from app.services import job_match_service
from app.services.job_match_service import JobMatchService
from app.services.job_service import JobService


USER = UserResponse(
    id="employer-user", name="Employer", mobile="919876543210", role="EMPLOYER",
    is_mobile_verified=True, is_active=True, created_at=datetime.now(timezone.utc),
    updated_at=datetime.now(timezone.utc),
)


class Rpc:
    def __init__(self, rows):
        self.rows = rows

    def execute(self):
        return SimpleNamespace(data=self.rows)


class FakeSupabase:
    def __init__(self, rows):
        self.rows = rows
        self.params = None

    def rpc(self, name, params):
        assert name in {"get_current_job_match_workers", "accept_job_match"}
        self.params = params
        return Rpc(self.rows)


def match_row(job_id="job-id", status="AVAILABLE"):
    return {
        "job_id": job_id,
        "worker_profile_id": "worker-id",
        "name": "Worker",
        "trade_id": "Cook",
        "skills": ["Cooking"],
        "experience_years": 3,
        "expected_daily_wage": 800,
        "availability_status": status,
        "distance_m": 1000,
        "composite_score": 0.9,
        "status": "PENDING",
        "created_at": datetime.now(timezone.utc),
    }


@pytest.mark.parametrize("availability, expected", [("AVAILABLE", 1), ("OFFLINE", 0), ("ON_JOB", 0)])
def test_summary_uses_only_current_projection_rows(monkeypatch, availability, expected):
    fake = FakeSupabase([match_row(status=availability)] if availability == "AVAILABLE" else [])
    monkeypatch.setattr(job_match_service, "supabase", fake)
    monkeypatch.setattr(JobService, "list_for_user", staticmethod(lambda user: [SimpleNamespace(id="job-id", employer_id="employer-id")]))

    summaries = JobMatchService.summaries_for_user(USER)

    assert sum(summary.current_match_count for summary in summaries) == expected
    assert summaries[0].matching_status == ("FOUND" if expected else "NO_MATCHES")


def test_current_projection_keeps_all_eligibility_rules_and_safe_fields():
    migration = (
        Path(__file__).resolve().parents[2]
        / "gleska-website"
        / "supabase"
        / "migrations"
        / "039_current_employer_match_projection.sql"
    ).read_text(encoding="utf-8")
    for clause in (
        "profile.profile_completed = TRUE",
        "profile.availability_status = 'AVAILABLE'",
        "lower(trim(profile.trade_id)) = lower(trim(job.trade_id))",
        "profile.experience_years >= job.min_experience",
        "profile.expected_daily_wage <= job.max_daily_salary",
        "current_location.accuracy_m <= 1000",
        "current_location.updated_at >= NOW() - INTERVAL '10 minutes'",
        "ELSE profile.latitude",
        "distance.distance_m <= 30000",
    ):
        assert clause in migration
    assert "arrival_otp" not in migration
    assert "completion_otp" not in migration
    assert "aadhaar" not in migration.lower()
    assert "documents" not in migration.lower()


def test_employer_accepts_a_specific_worker_for_a_specific_job(monkeypatch):
    fake = FakeSupabase([{
        "match_id": "match-id",
        "worker_profile_id": "worker-id",
        "match_status": "ACCEPTED",
        "job_status": "SEARCHING",
        "accepted_count": 1,
    }])
    monkeypatch.setattr(job_match_service, "supabase", fake)
    monkeypatch.setattr(JobService, "get_for_user", staticmethod(lambda user, job_id: SimpleNamespace(employer_id="employer-id")))
    monkeypatch.setattr(JobService, "_employer_profile", staticmethod(lambda user: {"id": "employer-id", "employer_type": "INDIVIDUAL"}))

    result = JobMatchService.accept_for_user(USER, "job-id", "worker-id")

    assert result.match_status == "ACCEPTED"
    assert result.job_status == "SEARCHING"
    assert result.accepted_count == 1
    assert fake.params == {
        "p_employer_id": "employer-id",
        "p_job_id": "job-id",
        "p_worker_profile_id": "worker-id",
    }


def test_claim_count_uses_unique_authoritative_rows_and_ignores_legacy_flag(monkeypatch):
    from app.services import entitlements

    class ClaimsQuery:
        def select(self, fields):
            assert fields == "worker_profile_id"
            return self

        def eq(self, field, value):
            assert (field, value) == ("employer_id", "employer-id")
            return self

        def execute(self):
            return SimpleNamespace(data=[{"worker_profile_id": f"worker-{index}"} for index in range(used)])

    class ClaimsSupabase:
        def table(self, name):
            assert name == "individual_free_worker_claims"
            return ClaimsQuery()

    for used in range(4):
        monkeypatch.setattr(entitlements, "supabase", ClaimsSupabase())
        state = entitlements.employer_state({
            "id": "employer-id",
            "employer_type": "INDIVIDUAL",
            "has_availed_free_dispatch": True,
        })
        assert state["free_worker_limit"] == 3
        assert state["free_workers_used"] == used
        assert state["free_workers_remaining"] == max(3 - used, 0)
        assert state["commission_required_for_next_worker"] is (used >= 3)
        assert state["commission_amount"] == 30.0


def test_acceptance_migrations_qualify_worker_profile_id_references():
    migrations_dir = Path(__file__).resolve().parents[2] / "gleska-website" / "supabase" / "migrations"
    for filename in ("040_accept_job_match.sql", "041_fix_accept_job_match_worker_profile_id.sql"):
        migration = (migrations_dir / filename).read_text(encoding="utf-8")
        assert "WHERE jm.job_id = p_job_id AND jm.worker_profile_id = p_worker_profile_id" in migration
        assert "WHERE jm.job_id = p_job_id AND jm.status = 'ACCEPTED'" in migration
        assert "UPDATE public.job_matches AS jm" in migration or "UPDATE public.job_matches\n  SET" in migration


def test_current_projection_excludes_expired_matches():
    migration = (
        Path(__file__).resolve().parents[2]
        / "gleska-website"
        / "supabase"
        / "migrations"
        / "042_exclude_expired_employer_matches.sql"
    ).read_text(encoding="utf-8")
    assert "job_match.expires_at > NOW()" in migration


def test_match_creation_uses_24_hour_pending_expiry_without_old_window():
    migration = (
        Path(__file__).resolve().parents[2]
        / "gleska-website"
        / "supabase"
        / "migrations"
        / "043_extend_pending_match_expiry.sql"
    ).read_text(encoding="utf-8")
    assert "NOW() + INTERVAL '24 hours'" in migration
    assert "INTERVAL '2 minutes'" not in migration