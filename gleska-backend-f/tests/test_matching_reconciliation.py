from types import SimpleNamespace

from app.services import matching_service
from app.services.matching_service import MatchingService


class Rpc:
    def __init__(self, rows):
        self.rows = rows

    def execute(self):
        return SimpleNamespace(data=self.rows)


class FakeSupabase:
    def __init__(self):
        self.calls = []

    def rpc(self, name, params):
        self.calls.append((name, params))
        return Rpc([{"status": "SUCCEEDED"}])


def test_create_matches_uses_authoritative_candidate_reconciliation(monkeypatch):
    fake = FakeSupabase()
    monkeypatch.setattr(matching_service, "supabase", fake)

    result = MatchingService.create_matches("job-id")

    assert result == [{"status": "SUCCEEDED"}]
    assert fake.calls == [(
        "reconcile_job_candidate_pool",
        {"p_job_id": "job-id", "p_trigger": "JOB_CREATED"},
    )]


def test_worker_profile_reconciliation_uses_worker_scoped_rpc(monkeypatch):
    fake = FakeSupabase()
    monkeypatch.setattr(matching_service, "supabase", fake)

    result = MatchingService.reconcile_worker("worker-id", "WORKER_PROFILE_UPDATED")

    assert result == [{"status": "SUCCEEDED"}]
    assert fake.calls == [(
        "reconcile_worker_candidate_pools",
        {
            "p_worker_profile_id": "worker-id",
            "p_trigger": "WORKER_PROFILE_UPDATED",
        },
    )]


def test_reconciliation_migration_preserves_assignment_rows_and_active_read_rules():
    from pathlib import Path

    migration = (
        Path(__file__).resolve().parents[2]
        / "gleska-website"
        / "supabase"
        / "migrations"
        / "059_matching_candidate_reconciliation.sql"
    ).read_text(encoding="utf-8")

    assert "status = 'PENDING'" in migration
    assert "SET status = 'CANCELLED'" in migration
    assert "status = 'ACCEPTED'" in migration
    assert "SET status = 'ACCEPTED'" not in migration
    assert "SET status = 'COMPLETED'" not in migration
    assert "worker_match.expires_at > NOW()" in migration
    assert "job.max_daily_salary" in migration
    assert "COALESCE(job.max_daily_salary, 0)" not in migration
    assert "job_matching_runs" in migration
    assert "reconcile_worker_candidate_pools" in migration
    assert "job_matches_profile_job_unique" not in migration
