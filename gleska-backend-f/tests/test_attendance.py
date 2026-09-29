from pathlib import Path
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.main import app
from app.routers import attendance as attendance_router
from app.schemas.attendance import AttendanceLocationRequest, EmployerAttendanceUpdateRequest, WorkerCheckInRequest
from app.schemas.auth import UserResponse
from app.services.attendance_service import ATTENDANCE_GEOFENCE_METERS
from app.routers.attendance import attendance_http_error
from app.services.attendance_service import AttendanceError, AttendanceService


MIGRATION = (
    Path(__file__).resolve().parents[2]
    / "gleska-website"
    / "supabase"
    / "migrations"
    / "047_attendance_v1.sql"
).read_text(encoding="utf-8")


def test_attendance_routes_are_registered():
    paths = app.openapi()["paths"]
    assert "/api/v1/workers/me/attendance/check-in" in paths
    assert "/api/v1/workers/me/attendance/check-out" in paths
    assert "/api/v1/workers/me/attendance/today" in paths
    assert "/api/v1/employers/me/attendance" in paths
    assert "/api/v1/employers/me/attendance/mark" in paths
    assert "/api/v1/employers/me/attendance/{attendance_id}/audit" in paths


def test_location_request_rejects_unreliable_or_null_island_coordinates():
    with pytest.raises(ValidationError):
        AttendanceLocationRequest(latitude=0, longitude=0, accuracy=20)
    with pytest.raises(ValidationError):
        AttendanceLocationRequest(latitude=18.5, longitude=73.8, accuracy=1001)


def test_check_in_requires_match_id():
    with pytest.raises(ValidationError):
        WorkerCheckInRequest(latitude=18.5, longitude=73.8, accuracy=20)


@pytest.mark.asyncio
async def test_check_in_uses_shared_entitlement_for_future_trial(monkeypatch):
    now = datetime.now(timezone.utc)

    class ProfileQuery:
        def select(self, *_args):
            return self

        def eq(self, *_args):
            return self

        def single(self):
            return self

        def execute(self):
            return SimpleNamespace(data={
                "subscription_valid_until": None,
                "trial_started_at": (now + timedelta(days=1)).isoformat(),
                "trial_ends_at": (now + timedelta(days=31)).isoformat(),
            })

    class FakeSupabase:
        def table(self, _name):
            return ProfileQuery()

    monkeypatch.setattr(attendance_router, "supabase", FakeSupabase())
    monkeypatch.setattr(
        attendance_router.AttendanceService,
        "check_in",
        lambda *_args: pytest.fail("attendance must not proceed for an inactive trial"),
    )
    user = UserResponse(
        id=str(uuid4()),
        name="Worker",
        mobile="919876543210",
        email="worker@example.com",
        role="WORKER",
        is_mobile_verified=True,
        is_active=True,
        created_at=now,
        updated_at=now,
    )
    request = WorkerCheckInRequest(
        job_match_id=uuid4(),
        latitude=18.5,
        longitude=73.8,
        accuracy=20,
    )

    with pytest.raises(HTTPException) as error:
        await attendance_router.worker_check_in(request, user)

    assert error.value.status_code == 402
    assert error.value.detail == "SUBSCRIPTION_REQUIRED"


def test_correction_requires_reason_and_valid_time_order():
    with pytest.raises(ValidationError):
        EmployerAttendanceUpdateRequest(status="PRESENT", reason=" ")
    with pytest.raises(ValidationError):
        EmployerAttendanceUpdateRequest(
            status="PRESENT",
            check_in_at="2026-09-06T10:00:00Z",
            check_out_at="2026-09-06T09:00:00Z",
            reason="Fix the record",
        )


def test_attendance_contract_keeps_authoritative_security_rules():
    assert ATTENDANCE_GEOFENCE_METERS == 500
    assert "job_match_id, attendance_date)" in MIGRATION
    assert "match_row.status <> 'ACCEPTED'" in MIGRATION
    assert "OUTSIDE_ATTENDANCE_GEOFENCE" in MIGRATION
    assert "updated_at < NOW() - INTERVAL '10 minutes'" in MIGRATION
    assert "accuracy_m > 1000" in MIGRATION
    assert "attendance_audit" in MIGRATION
    assert "CREATE POLICY \"Service role can manage attendance audit\"" in MIGRATION
    assert "UPDATE public.attendance_audit" not in MIGRATION
    assert "DELETE FROM public.attendance_audit" not in MIGRATION


def test_attendance_does_not_add_automatic_absence_generation():
    assert "INSERT INTO public.attendance" in MIGRATION
    assert "CURRENT_DATE" in MIGRATION
    assert "generate_absent" not in MIGRATION.lower()
    assert "schedule" not in MIGRATION.lower()


def test_worker_history_is_scoped_by_authenticated_user_and_checkout_is_single_use():
    assert "list_worker_attendance" in MIGRATION
    assert "WHERE user_id = p_user_id" in MIGRATION
    assert "a.worker_profile_id" in MIGRATION
    assert "ATTENDANCE_ALREADY_CHECKED_OUT" in MIGRATION
    assert "check_out_at = NOW()" in MIGRATION
    assert "check_in_at" in MIGRATION and "check_out_at" in MIGRATION


def test_hours_are_only_available_when_both_authoritative_timestamps_exist():
    assert "check_out_at IS NULL OR check_in_at IS NOT NULL" in MIGRATION
    assert "check_out_at >= check_in_at" in MIGRATION


def test_known_rpc_error_preserves_domain_code_over_postgres_code():
    from postgrest.exceptions import APIError

    error = AttendanceService._rpc_error(APIError({
        "message": "OUTSIDE_ATTENDANCE_GEOFENCE",
        "code": "P0001",
        "details": None,
        "hint": None,
    }))

    response = attendance_http_error(error)

    assert error.code == "OUTSIDE_ATTENDANCE_GEOFENCE"
    assert response.status_code == 422
    assert response.body == b'{"code":"OUTSIDE_ATTENDANCE_GEOFENCE","message":"You\'re too far from the work site to check in.","retryable":true}'


def test_unknown_rpc_error_keeps_generic_fallback():
    error = AttendanceError("ATTENDANCE_OPERATION_FAILED")

    response = attendance_http_error(error)

    assert response.status_code == 500
    assert response.body == b'{"code":"ATTENDANCE_OPERATION_FAILED","message":"ATTENDANCE_OPERATION_FAILED","retryable":false}'
