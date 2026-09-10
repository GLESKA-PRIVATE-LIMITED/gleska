from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field


class EmployerWorkerResponse(BaseModel):
    worker_profile_id: str
    name: str
    profile_photo_url: Optional[str] = None
    trade_id: Optional[str] = None
    skills: list[str] = Field(default_factory=list)
    experience_years: Optional[int] = None
    expected_daily_wage: Optional[Decimal] = None
    availability_status: str
    city: Optional[str] = None
    state: Optional[str] = None
    profile_completed: bool
    is_verified: bool
    job_id: str
    job_title: str
    job_status: str
    match_status: str
    match_created_at: datetime
    match_expires_at: datetime
    completed_at: Optional[datetime] = None
    job_site_id: str
    site_name: str
    site_address: Optional[str] = None
    site_city: Optional[str] = None
    site_state: Optional[str] = None
    site_pincode: Optional[str] = None
    attendance: list["EmployerWorkerAttendanceResponse"] = Field(default_factory=list)


class EmployerWorkerAttendanceResponse(BaseModel):
    attendance_date: date
    status: str
    check_in_at: Optional[datetime] = None
    check_out_at: Optional[datetime] = None
    duration_minutes: Optional[int] = None


class EmployerWorkerListResponse(BaseModel):
    items: list[EmployerWorkerResponse] = Field(default_factory=list)
    page: int
    limit: int
    total: int
    has_more: bool