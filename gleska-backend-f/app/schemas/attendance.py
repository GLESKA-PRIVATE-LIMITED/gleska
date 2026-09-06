from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator


AttendanceStatus = Literal["PRESENT", "LATE", "ABSENT"]


class AttendanceLocationRequest(BaseModel):
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    accuracy: float = Field(..., gt=0, le=1000)

    @model_validator(mode="after")
    def reject_null_island(self) -> "AttendanceLocationRequest":
        if self.latitude == 0 and self.longitude == 0:
            raise ValueError("latitude and longitude cannot both be zero")
        return self


class WorkerCheckInRequest(AttendanceLocationRequest):
    job_match_id: UUID


class WorkerCheckOutRequest(AttendanceLocationRequest):
    attendance_id: UUID


class EmployerAttendanceUpdateRequest(BaseModel):
    status: AttendanceStatus
    check_in_at: datetime | None = None
    check_out_at: datetime | None = None
    reason: str = Field(..., min_length=1, max_length=500)

    @model_validator(mode="after")
    def validate_times(self) -> "EmployerAttendanceUpdateRequest":
        if not self.reason.strip():
            raise ValueError("reason must not be blank")
        if self.check_out_at is not None and self.check_in_at is None:
            raise ValueError("check-in is required when check-out is provided")
        if self.check_in_at and self.check_out_at and self.check_out_at < self.check_in_at:
            raise ValueError("check-out cannot be before check-in")
        return self


class EmployerAttendanceMarkRequest(BaseModel):
    job_match_id: UUID
    attendance_date: date
    status: AttendanceStatus
    reason: str = Field(..., min_length=1, max_length=500)

    @field_validator("reason")
    @classmethod
    def reason_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("reason must not be blank")
        return value.strip()


class AttendanceRecordResponse(BaseModel):
    id: str
    job_match_id: str
    worker_profile_id: str
    employer_id: str | None = None
    job_id: str
    job_site_id: str
    worker_name: str
    job_title: str
    site_name: str
    attendance_date: date
    status: AttendanceStatus
    check_in_at: datetime | None = None
    check_out_at: datetime | None = None
    employer_manual_override: bool = False
    correction_reason: str | None = None
    distance_m: Decimal | None = None


class AttendanceListResponse(BaseModel):
    items: list[AttendanceRecordResponse]
    page: int
    limit: int
    total: int
    has_more: bool
    present_count: int = 0
    late_count: int = 0
    absent_count: int = 0


class AttendanceAuditResponse(BaseModel):
    id: str
    attendance_id: str
    actor_user_id: str
    actor_role: str
    action: str
    previous_status: AttendanceStatus | None = None
    new_status: AttendanceStatus | None = None
    previous_check_in_at: datetime | None = None
    new_check_in_at: datetime | None = None
    previous_check_out_at: datetime | None = None
    new_check_out_at: datetime | None = None
    reason: str | None = None
    created_at: datetime


class AttendanceSummaryResponse(BaseModel):
    present: int
    late: int
    absent: int


class AttendanceMatchOption(BaseModel):
    job_match_id: str
    worker_name: str
    job_title: str
    site_name: str
