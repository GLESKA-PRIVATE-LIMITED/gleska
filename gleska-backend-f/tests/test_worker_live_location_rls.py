from pathlib import Path


def test_worker_current_location_rls_uses_worker_profile_relationship():
    migration = (
        Path(__file__).resolve().parents[2]
        / "gleska-website"
        / "supabase"
        / "migrations"
        / "033_fix_worker_current_locations_rls.sql"
    )
    assert migration.exists(), "Missing worker_current_locations ownership fix migration"
    sql = migration.read_text(encoding="utf-8")

    assert "public.worker_current_locations" in sql
    assert "JOIN public.worker_profiles" in sql
    assert "wp.user_id = auth.uid()" in sql
    assert "user_id = auth.uid()" not in sql
