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


class EmployerWorkerListResponse(BaseModel):
    items: list[EmployerWorkerResponse] = Field(default_factory=list)
    page: int
    limit: int
    total: int
    has_more: bool