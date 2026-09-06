from pathlib import Path

import pytest
from pydantic import ValidationError

from app.schemas.worker import UpdateWorkerProfileSchema


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