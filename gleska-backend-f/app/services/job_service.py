"""Job creation and employer-owned job persistence."""

from datetime import datetime, timezone
import logging
from typing import Any
from uuid import uuid4

from app.core.supabase import supabase
from app.schemas.auth import UserResponse
from app.schemas.job import JobCreate, JobResponse
from app.services.matching_service import MatchingError, MatchingService

logger = logging.getLogger(__name__)


class JobNotFound(Exception):
    """The employer profile or selected job site was not found."""


class JobService:
    """Owns job validation context and persistence boundary."""

    @staticmethod
    def _employer_id(user: UserResponse) -> str:
        response = (
            supabase.table("employer_profiles")
            .select("id, onboarding_status")
            .eq("user_id", user.id)
            .single()
            .execute()
        )
        employer = response.data or {}
        if not employer.get("id"):
            raise JobNotFound("EMPLOYER_NOT_FOUND")
        if employer.get("onboarding_status") != "COMPLETED":
            raise PermissionError("EMPLOYER_ONBOARDING_INCOMPLETE")
        return str(employer["id"])

    @classmethod
    def _owned_site(cls, employer_id: str, site_id: str) -> None:
        response = (
            supabase.table("job_sites")
            .select("id")
            .eq("id", site_id)
            .eq("employer_id", employer_id)
            .single()
            .execute()
        )
        if not response.data:
            raise JobNotFound("JOB_SITE_NOT_FOUND")

    @staticmethod
    def _to_response(row: dict[str, Any]) -> JobResponse:
        return JobResponse(
            id=str(row["id"]),
            employer_id=str(row["employer_id"]),
            job_site_id=str(row["job_site_id"]),
            title=row["title"],
            headcount_required=int(row["headcount_required"]),
            max_daily_salary=row.get("max_daily_salary"),
            min_experience=row.get("min_experience"),
            status=row["status"],
            created_at=row["created_at"],
            updated_at=row.get("updated_at"),
        )

    @classmethod
    def create(cls, user: UserResponse, request: JobCreate) -> JobResponse:
        employer_id = cls._employer_id(user)
        cls._owned_site(employer_id, str(request.job_site_id))
        response = supabase.table("jobs").insert({
            "id": str(uuid4()),
            "employer_id": employer_id,
            "job_site_id": str(request.job_site_id),
            "title": request.title,
            "headcount_required": request.headcount_required,
            "max_daily_salary": str(request.max_daily_salary) if request.max_daily_salary is not None else None,
            "min_experience": request.min_experience,
            "status": "SEARCHING",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }).execute()
        if not response.data:
            raise RuntimeError("JOB_CREATE_FAILED")
        job = response.data[0]
        try:
            MatchingService.create_matches(str(job["id"]))
        except MatchingError:
            logger.exception("Matching failed after job creation: job_id=%s", job["id"])
        return cls._to_response(job)

    @classmethod
    def list_for_user(cls, user: UserResponse) -> list[JobResponse]:
        employer_id = cls._employer_id(user)
        response = (
            supabase.table("jobs")
            .select("*")
            .eq("employer_id", employer_id)
            .order("created_at", desc=True)
            .execute()
        )
        return [cls._to_response(row) for row in (response.data or [])]