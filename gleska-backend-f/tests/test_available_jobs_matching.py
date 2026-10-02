from pathlib import Path


MIGRATION = (
    Path(__file__).resolve().parents[2]
    / "gleska-website"
    / "supabase"
    / "migrations"
    / "015_pending_worker_match_retrieval.sql"
).read_text(encoding="utf-8")


def function_body(name: str) -> str:
    start = MIGRATION.index(f"CREATE OR REPLACE FUNCTION public.{name}")
    end = MIGRATION.index("$$;", start)
    return MIGRATION[start:end]


def test_available_jobs_returns_only_the_current_workers_pending_matches():
    sql = function_body("find_available_jobs_for_worker")

    assert "JOIN job_matches AS worker_match" in sql
    assert "worker_match.job_id = job.id" in sql
    assert "worker_match.worker_profile_id = profile.id" in sql
    assert "COALESCE(worker_match.status, 'PENDING') = 'PENDING'" in sql
    assert "job.status = 'SEARCHING'" in sql
    assert "profile.availability_status = 'AVAILABLE'" in sql
    assert "profile.profile_completed = TRUE" in sql
    assert "profile.latitude IS NOT NULL" in sql
    assert "profile.longitude IS NOT NULL" in sql
    assert "distance.distance_m <= p_max_radius" in sql
    assert "profile.is_verified" not in sql
    assert "profile.account_type" not in sql


def test_available_jobs_does_not_use_unmatched_job_anti_join():
    sql = function_body("find_available_jobs_for_worker")

    assert "NOT EXISTS" not in sql


def test_match_creation_explicitly_sets_pending_status_and_keeps_duplicate_prevention():
    sql = function_body("create_job_matches_for_profiles")

    assert "profile.overall_rating" not in sql
    assert "profile.total_jobs" not in sql
    assert "expires_at, status" in sql
    assert "'PENDING'" in sql
    assert "NOT EXISTS" in sql
    assert "existing_match.job_id = job.id" in sql
    assert "existing_match.worker_profile_id = profile.id" in sql
    assert "profile.is_verified" not in sql
    assert "profile.account_type" not in sql


def test_migration_blocks_new_null_statuses_without_rewriting_legacy_rows():
    assert "ALTER COLUMN status SET DEFAULT 'PENDING'" in MIGRATION
    assert "CHECK (status IS NOT NULL) NOT VALID" in MIGRATION
    assert "UPDATE public.job_matches" not in MIGRATION


def test_worker_matching_migrations_do_not_use_verification_as_eligibility():
    historical_migration = (
        Path(__file__).resolve().parents[2]
        / "gleska-website"
        / "supabase"
        / "migrations"
        / "011_canonical_worker_profile_matching.sql"
    ).read_text(encoding="utf-8")

    assert "profile.is_verified" not in historical_migration
    assert "profile.account_type" not in historical_migration


def test_current_location_migration_uses_live_location_for_available_jobs():
    migration = (
        Path(__file__).resolve().parents[2]
        / "gleska-website"
        / "supabase"
        / "migrations"
        / "018_current_location_accuracy_and_freshness.sql"
    ).read_text(encoding="utf-8")

    start = migration.index("CREATE OR REPLACE FUNCTION public.find_available_jobs_for_worker")
    sql = migration[start:migration.index("$$;", start)]
    assert "JOIN worker_current_locations AS current_location" in sql
    assert "current_location.longitude" in sql
    assert "current_location.latitude" in sql
    assert "current_location.updated_at >= NOW() - INTERVAL '10 minutes'" in sql
    assert "current_location.accuracy_m <= 1000" in sql
    assert "profile.latitude" not in sql
    assert "profile.longitude" not in sql


def test_latest_matching_functions_require_fresh_current_location_without_profile_fallback():
    migration = (
        Path(__file__).resolve().parents[2]
        / "gleska-website"
        / "supabase"
        / "migrations"
        / "067_worker_matching_requires_fresh_location.sql"
    ).read_text(encoding="utf-8")

    for name in (
        "worker_matches_job",
        "reconcile_job_candidate_pool",
        "reconcile_worker_candidate_pools",
        "find_available_jobs_for_worker",
    ):
        start = migration.index(f"CREATE OR REPLACE FUNCTION public.{name}")
        end = migration.index("$$;", start)
        sql = migration[start:end]
        assert "worker_current_locations" in sql
        assert "current_location.accuracy_m <= 1000" in sql
        assert "current_location.updated_at >= NOW() - INTERVAL '10 minutes'" in sql
        assert "ELSE profile.latitude" not in sql
        assert "ELSE profile.longitude" not in sql
        assert "ELSE worker.latitude" not in sql
        assert "ELSE worker.longitude" not in sql
