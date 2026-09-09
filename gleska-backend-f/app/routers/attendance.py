from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import JSONResponse

from app.core.security import require_employer, require_worker
from app.schemas.attendance import (
    AttendanceAuditResponse,
    AttendanceListResponse,
    AttendanceMatchOption,
    AttendanceRecordResponse,
    EmployerAttendanceMarkRequest,
    EmployerAttendanceUpdateRequest,
    WorkerCheckInRequest,
    WorkerCheckOutRequest,
)
from app.schemas.auth import UserResponse
from app.services.attendance_service import AttendanceError, AttendanceService

worker_router = APIRouter(prefix="/workers/me/attendance", tags=["worker-attendance"])
employer_router = APIRouter(prefix="/employers/me/attendance", tags=["employer-attendance"])


def attendance_http_error(exc: AttendanceError) -> JSONResponse:
    messages = {
        "OUTSIDE_ATTENDANCE_GEOFENCE": "You're too far from the work site to check in.",
        "JOB_MATCH_NOT_ACCEPTED": "This job is not currently available for attendance.",
        "JOB_MATCH_EXPIRED": "This job assignment has expired.",
        "ATTENDANCE_ALREADY_EXISTS": "You're already checked in.",
        "ATTENDANCE_ALREADY_CHECKED_OUT": "You're already checked out.",
        "CHECK_IN_REQUIRED": "You can't check out because you haven't checked in.",
    }
    mapping = {
        "WORKER_PROFILE_NOT_FOUND": (404, "WORKER_PROFILE_NOT_FOUND"),
        "JOB_MATCH_NOT_FOUND": (404, "JOB_MATCH_NOT_FOUND"),
        "ATTENDANCE_NOT_FOUND": (404, "ATTENDANCE_NOT_FOUND"),
        "JOB_MATCH_NOT_ACCEPTED": (409, "JOB_MATCH_NOT_ACCEPTED"),
        "ATTENDANCE_ALREADY_EXISTS": (409, "ATTENDANCE_ALREADY_EXISTS"),
        "ATTENDANCE_ALREADY_CHECKED_OUT": (409, "ATTENDANCE_ALREADY_CHECKED_OUT"),
        "CHECK_IN_REQUIRED": (409, "CHECK_IN_REQUIRED"),
        "OUTSIDE_ATTENDANCE_GEOFENCE": (422, "OUTSIDE_ATTENDANCE_GEOFENCE"),
        "JOB_SITE_LOCATION_UNAVAILABLE": (422, "JOB_SITE_LOCATION_UNAVAILABLE"),
        "CURRENT_LOCATION_REQUIRED": (422, "CURRENT_LOCATION_REQUIRED"),
        "INVALID_GPS_ACCURACY": (422, "INVALID_GPS_ACCURACY"),
        "CORRECTION_REASON_REQUIRED": (422, "CORRECTION_REASON_REQUIRED"),
        "CHECK_OUT_BEFORE_CHECK_IN": (422, "CHECK_OUT_BEFORE_CHECK_IN"),
    }
    status_code, fallback_detail = mapping.get(exc.code, (500, "ATTENDANCE_OPERATION_FAILED"))
    if status_code == 500:
        return JSONResponse(status_code=500, content={"code": "ATTENDANCE_OPERATION_FAILED", "message": fallback_detail, "retryable": False})
    return JSONResponse(status_code=status_code, content={
        "code": exc.code,
        "message": messages.get(exc.code, exc.message),
        "retryable": exc.retryable,
    })


@worker_router.post("/check-in", response_model=AttendanceRecordResponse)
async def worker_check_in(request: WorkerCheckInRequest, user: UserResponse = Depends(require_worker)):
    try:
        return AttendanceService.check_in(user.id, request)
    except AttendanceError as exc:
        return attendance_http_error(exc)


@worker_router.post("/check-out", response_model=AttendanceRecordResponse)
async def worker_check_out(request: WorkerCheckOutRequest, user: UserResponse = Depends(require_worker)):
    try:
        return AttendanceService.check_out(user.id, request)
    except AttendanceError as exc:
        return attendance_http_error(exc)


@worker_router.get("", response_model=AttendanceListResponse)
async def worker_attendance_history(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    attendance_date: date | None = Query(default=None, alias="date"),
    user: UserResponse = Depends(require_worker),
):
    try:
        return AttendanceService.worker_history(user.id, page, limit, attendance_date)
    except AttendanceError as exc:
        return attendance_http_error(exc)


@worker_router.get("/today", response_model=AttendanceListResponse)
async def worker_attendance_today(user: UserResponse = Depends(require_worker)):
    try:
        return AttendanceService.worker_history(user.id, 1, 100, date.today())
    except AttendanceError as exc:
        return attendance_http_error(exc)


@employer_router.get("", response_model=AttendanceListResponse)
async def employer_attendance_history(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    attendance_date: date | None = Query(default=None, alias="date"),
    worker: str | None = Query(default=None, max_length=120),
    job_id: UUID | None = Query(default=None),
    job_site_id: UUID | None = Query(default=None),
    attendance_status: str | None = Query(default=None, alias="status", pattern="^(PRESENT|LATE|ABSENT)$"),
    user: UserResponse = Depends(require_employer),
):
    try:
        return AttendanceService.employer_history(user.id, page, limit, attendance_date, worker, job_id, job_site_id, attendance_status)
    except AttendanceError as exc:
        return attendance_http_error(exc)


@employer_router.post("/mark", response_model=AttendanceRecordResponse)
async def employer_mark_attendance(request: EmployerAttendanceMarkRequest, user: UserResponse = Depends(require_employer)):
    try:
        return AttendanceService.employer_mark(user.id, request)
    except AttendanceError as exc:
        return attendance_http_error(exc)


@employer_router.get("/match-options", response_model=list[AttendanceMatchOption])
async def employer_attendance_match_options(user: UserResponse = Depends(require_employer)):
    try:
        return AttendanceService.employer_match_options(user.id)
    except AttendanceError as exc:
        return attendance_http_error(exc)


@employer_router.get("/{attendance_id}", response_model=AttendanceRecordResponse)
async def employer_attendance_detail(attendance_id: UUID, user: UserResponse = Depends(require_employer)):
    try:
        result = AttendanceService.employer_detail(user.id, attendance_id)
    except AttendanceError as exc:
        return attendance_http_error(exc)
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ATTENDANCE_NOT_FOUND")
    return result


@employer_router.post("/{attendance_id}/mark", response_model=AttendanceRecordResponse)
@employer_router.patch("/{attendance_id}", response_model=AttendanceRecordResponse)
async def employer_attendance_update(attendance_id: UUID, request: EmployerAttendanceUpdateRequest, user: UserResponse = Depends(require_employer)):
    try:
        return AttendanceService.employer_update(user.id, attendance_id, request)
    except AttendanceError as exc:
        return attendance_http_error(exc)


@employer_router.get("/{attendance_id}/audit", response_model=list[AttendanceAuditResponse])
async def employer_attendance_audit(attendance_id: UUID, user: UserResponse = Depends(require_employer)):
    try:
        return AttendanceService.employer_audit(user.id, attendance_id)
    except AttendanceError as exc:
        return attendance_http_error(exc)
