from datetime import date, datetime
from typing import Any
from uuid import UUID

from app.core.supabase import supabase
from app.schemas.attendance import (
    AttendanceAuditResponse,
    AttendanceMatchOption,
    EmployerAttendanceMarkRequest,
    AttendanceListResponse,
    AttendanceRecordResponse,
    AttendanceSummaryResponse,
    EmployerAttendanceUpdateRequest,
    WorkerCheckInRequest,
    WorkerCheckOutRequest,
)


ATTENDANCE_GEOFENCE_METERS = 500


class AttendanceError(Exception):
    def __init__(self, code: str, message: str | None = None, retryable: bool = False):
        self.code = code
        self.message = message or code
        self.retryable = retryable
        super().__init__(code)


class AttendanceService:
    @staticmethod
    def _row(data: Any) -> dict[str, Any]:
        if isinstance(data, list):
            return data[0] if data else {}
        return data or {}

    @staticmethod
    def _rpc_error(exc: Exception) -> AttendanceError:
        response = getattr(exc, "json", None)
        payload = response() if callable(response) else None
        payload = payload if isinstance(payload, dict) else {}
        message = " ".join(
            str(value)
            for value in (payload.get("message"), payload.get("details"), payload.get("hint"), str(exc))
            if value
        )
        known_codes = (
            "WORKER_PROFILE_NOT_FOUND", "JOB_MATCH_NOT_FOUND", "JOB_MATCH_NOT_ACCEPTED",
            "JOB_MATCH_EXPIRED", "UNAUTHORIZED_ATTENDANCE",
            "JOB_SITE_LOCATION_UNAVAILABLE", "CURRENT_LOCATION_REQUIRED", "OUTSIDE_ATTENDANCE_GEOFENCE",
            "INVALID_GPS_ACCURACY", "ATTENDANCE_ALREADY_EXISTS", "ATTENDANCE_NOT_FOUND",
            "CHECK_IN_REQUIRED", "ATTENDANCE_ALREADY_CHECKED_OUT", "CORRECTION_REASON_REQUIRED",
            "CHECK_OUT_BEFORE_CHECK_IN",
        )
        code = next((known_code for known_code in known_codes if known_code in message), None)
        if code is None and str(payload.get("code") or "") in known_codes:
            code = str(payload["code"])
        code = code or "ATTENDANCE_OPERATION_FAILED"
        return AttendanceError(str(code), retryable=str(code) in {
            "CURRENT_LOCATION_REQUIRED", "OUTSIDE_ATTENDANCE_GEOFENCE", "INVALID_GPS_ACCURACY",
        })

    @staticmethod
    def _map_record(row: dict[str, Any]) -> AttendanceRecordResponse:
        return AttendanceRecordResponse(
            id=str(row["id"]),
            job_match_id=str(row["job_match_id"]),
            worker_profile_id=str(row["worker_profile_id"]),
            employer_id=str(row["employer_id"]) if row.get("employer_id") else None,
            job_id=str(row["job_id"]),
            job_site_id=str(row["job_site_id"]),
            worker_name=row.get("worker_name") or "Worker",
            job_title=row.get("job_title") or "Job",
            site_name=row.get("site_name") or "Work site",
            attendance_date=row["attendance_date"],
            status=row["status"],
            check_in_at=row.get("check_in_at"),
            check_out_at=row.get("check_out_at"),
            employer_manual_override=bool(row.get("employer_manual_override")),
            correction_reason=row.get("correction_reason"),
            distance_m=row.get("distance_m"),
        )

    @staticmethod
    def _save_current_location(user_id: str, request: WorkerCheckInRequest | WorkerCheckOutRequest) -> None:
        profile = supabase.table("worker_profiles").select("id").eq("user_id", user_id).single().execute().data or {}
        if not profile.get("id"):
            raise AttendanceError("WORKER_PROFILE_NOT_FOUND")
        try:
            supabase.table("worker_current_locations").upsert({
                "worker_profile_id": profile["id"],
                "latitude": request.latitude,
                "longitude": request.longitude,
                "accuracy_m": request.accuracy,
            }, on_conflict="worker_profile_id").execute()
        except Exception as exc:
            raise AttendanceError("CURRENT_LOCATION_REQUIRED") from exc

    @classmethod
    def check_in(cls, user_id: str, request: WorkerCheckInRequest) -> AttendanceRecordResponse:
        cls._save_current_location(user_id, request)
        try:
            result = supabase.rpc("worker_check_in", {
                "p_user_id": user_id,
                "p_job_match_id": str(request.job_match_id),
                "p_latitude": request.latitude,
                "p_longitude": request.longitude,
                "p_accuracy": request.accuracy,
                "p_geofence_meters": ATTENDANCE_GEOFENCE_METERS,
            }).execute()
        except Exception as exc:
            raise cls._rpc_error(exc) from exc
        row = cls._row(result.data)
        if not row:
            raise AttendanceError("ATTENDANCE_OPERATION_FAILED")
        return cls._map_record(row)

    @classmethod
    def check_out(cls, user_id: str, request: WorkerCheckOutRequest) -> AttendanceRecordResponse:
        cls._save_current_location(user_id, request)
        try:
            result = supabase.rpc("worker_check_out", {
                "p_user_id": user_id,
                "p_attendance_id": str(request.attendance_id),
                "p_latitude": request.latitude,
                "p_longitude": request.longitude,
                "p_accuracy": request.accuracy,
                "p_geofence_meters": ATTENDANCE_GEOFENCE_METERS,
            }).execute()
        except Exception as exc:
            raise cls._rpc_error(exc) from exc
        row = cls._row(result.data)
        if not row:
            raise AttendanceError("ATTENDANCE_OPERATION_FAILED")
        return cls._map_record(row)

    @classmethod
    def worker_history(cls, user_id: str, page: int, limit: int, attendance_date: date | None = None) -> AttendanceListResponse:
        try:
            result = supabase.rpc("list_worker_attendance", {
                "p_user_id": user_id, "p_date": attendance_date.isoformat() if attendance_date else None,
                "p_page": page, "p_limit": limit,
            }).execute()
        except Exception as exc:
            raise cls._rpc_error(exc) from exc
        rows = result.data or []
        total = int(rows[0].get("total_count") or 0) if rows else 0
        return AttendanceListResponse(
            items=[cls._map_record(row) for row in rows], page=page, limit=limit,
            total=total, has_more=page * limit < total,
        )

    @classmethod
    def employer_history(cls, user_id: str, page: int, limit: int, attendance_date: date | None = None,
                         worker_search: str | None = None, job_id: UUID | None = None,
                         job_site_id: UUID | None = None, status: str | None = None) -> AttendanceListResponse:
        params = {
            "p_user_id": user_id, "p_date": attendance_date.isoformat() if attendance_date else None,
            "p_worker_search": worker_search, "p_job_id": str(job_id) if job_id else None,
            "p_job_site_id": str(job_site_id) if job_site_id else None, "p_status": status,
            "p_page": page, "p_limit": limit,
        }
        try:
            result = supabase.rpc("list_employer_attendance", params).execute()
            summary = supabase.rpc("get_employer_attendance_summary", {
                key: params[key] for key in ("p_user_id", "p_date", "p_worker_search", "p_job_id", "p_job_site_id", "p_status")
            }).execute()
        except Exception as exc:
            raise cls._rpc_error(exc) from exc
        rows = result.data or []
        summary_row = cls._row(summary.data)
        total = int(rows[0].get("total_count") or 0) if rows else 0
        return AttendanceListResponse(
            items=[cls._map_record(row) for row in rows], page=page, limit=limit,
            total=total, has_more=page * limit < total,
            present_count=int(summary_row.get("present_count") or 0),
            late_count=int(summary_row.get("late_count") or 0),
            absent_count=int(summary_row.get("absent_count") or 0),
        )

    @classmethod
    def employer_detail(cls, user_id: str, attendance_id: UUID) -> AttendanceRecordResponse | None:
        try:
            result = supabase.rpc("get_employer_attendance", {
                "p_user_id": user_id, "p_attendance_id": str(attendance_id),
            }).execute()
        except Exception as exc:
            raise cls._rpc_error(exc) from exc
        row = cls._row(result.data)
        return cls._map_record(row) if row else None

    @classmethod
    def employer_update(cls, user_id: str, attendance_id: UUID, request: EmployerAttendanceUpdateRequest) -> AttendanceRecordResponse:
        try:
            result = supabase.rpc("update_employer_attendance", {
                "p_user_id": user_id, "p_attendance_id": str(attendance_id),
                "p_status": request.status, "p_check_in_at": request.check_in_at.isoformat() if request.check_in_at else None,
                "p_check_out_at": request.check_out_at.isoformat() if request.check_out_at else None,
                "p_reason": request.reason,
            }).execute()
        except Exception as exc:
            raise cls._rpc_error(exc) from exc
        row = cls._row(result.data)
        if not row:
            raise AttendanceError("ATTENDANCE_OPERATION_FAILED")
        return cls._map_record(row)

    @classmethod
    def employer_mark(cls, user_id: str, request: EmployerAttendanceMarkRequest) -> AttendanceRecordResponse:
        try:
            result = supabase.rpc("mark_employer_attendance", {
                "p_user_id": user_id,
                "p_job_match_id": str(request.job_match_id),
                "p_attendance_date": request.attendance_date.isoformat(),
                "p_status": request.status,
                "p_reason": request.reason,
            }).execute()
        except Exception as exc:
            raise cls._rpc_error(exc) from exc
        row = cls._row(result.data)
        if not row:
            raise AttendanceError("ATTENDANCE_OPERATION_FAILED")
        return cls._map_record(row)

    @classmethod
    def employer_audit(cls, user_id: str, attendance_id: UUID) -> list[AttendanceAuditResponse]:
        try:
            result = supabase.rpc("list_attendance_audit", {
                "p_user_id": user_id, "p_attendance_id": str(attendance_id),
            }).execute()
        except Exception as exc:
            raise cls._rpc_error(exc) from exc
        return [AttendanceAuditResponse(**{
            **row,
            "id": str(row["id"]),
            "attendance_id": str(row["attendance_id"]),
            "actor_user_id": str(row["actor_user_id"]),
        }) for row in (result.data or [])]

    @classmethod
    def employer_match_options(cls, user_id: str) -> list[AttendanceMatchOption]:
        try:
            result = supabase.rpc("list_employer_accepted_matches", {"p_user_id": user_id}).execute()
        except Exception as exc:
            raise cls._rpc_error(exc) from exc
        return [AttendanceMatchOption(**{
            "job_match_id": str(row["job_match_id"]),
            "worker_name": row.get("worker_name") or "Worker",
            "job_title": row.get("job_title") or "Job",
            "site_name": row.get("site_name") or "Work site",
        }) for row in (result.data or [])]
