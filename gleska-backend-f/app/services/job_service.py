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


class JobPaymentRequired(Exception):
    """The employer has no active subscription or free dispatch available."""


class JobService:
    """Owns job validation context and persistence boundary."""

    @staticmethod
    def _employer_id(user: UserResponse) -> str:
        response = (
            supabase.table("employer_profiles")
            .select("id, onboarding_status, subscription_valid_until, has_availed_free_dispatch")
            .eq("user_id", user.id)
            .single()
            .execute()
        )
        employer = response.data or {}
        if not employer.get("id"):
            raise JobNotFound("EMPLOYER_NOT_FOUND")
        if employer.get("onboarding_status") != "COMPLETED":
            raise PermissionError("EMPLOYER_ONBOARDING_INCOMPLETE")
        subscription_until = employer.get("subscription_valid_until")
        if isinstance(subscription_until, str):
            subscription_until = datetime.fromisoformat(subscription_until.replace("Z", "+00:00"))
        if subscription_until and subscription_until.tzinfo is None:
            subscription_until = subscription_until.replace(tzinfo=timezone.utc)
        if subscription_until and subscription_until > datetime.now(timezone.utc):
            return str(employer["id"])

        if employer.get("has_availed_free_dispatch", False):
            raise JobPaymentRequired("SUBSCRIPTION_REQUIRED")
        free_dispatch = (
            supabase.table("employer_profiles")
            .update({"has_availed_free_dispatch": True})
            .eq("id", employer["id"])
            .eq("has_availed_free_dispatch", False)
            .execute()
        )
        if not free_dispatch.data:
            raise JobPaymentRequired("SUBSCRIPTION_REQUIRED")
        return str(employer["id"])

    @staticmethod
    def _employer_profile(user: UserResponse) -> dict[str, Any]:
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
        return employer

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
        employer = cls._employer_profile(user)
        cls._owned_site(str(employer["id"]), str(request.job_site_id))
        try:
            response = supabase.rpc("create_job_for_employer", {
                "p_employer_id": employer["id"],
                "p_job_site_id": str(request.job_site_id),
                "p_title": request.title,
                "p_headcount_required": request.headcount_required,
                "p_max_daily_salary": float(request.max_daily_salary) if request.max_daily_salary is not None else None,
                "p_min_experience": request.min_experience,
            }).execute()
        except Exception as exc:
            message = str(exc)
            logger.error("Job creation RPC failed: error_type=%s message=%s", type(exc).__name__, message)
            if "SUBSCRIPTION_REQUIRED" in message:
                raise JobPaymentRequired("SUBSCRIPTION_REQUIRED") from exc
            if "JOB_SITE_NOT_FOUND" in message:
                raise JobNotFound("JOB_SITE_NOT_FOUND") from exc
            if "EMPLOYER_ONBOARDING_INCOMPLETE" in message:
                raise PermissionError("EMPLOYER_ONBOARDING_INCOMPLETE") from exc
            raise
        job = response.data[0] if isinstance(response.data, list) and response.data else response.data
        if not job:
            raise RuntimeError("JOB_CREATE_FAILED")
        try:
            MatchingService.create_matches(str(job["id"]))
        except MatchingError:
            logger.exception("Matching failed after job creation: job_id=%s", job["id"])
        return cls._to_response(job)

    @classmethod
    def list_for_user(cls, user: UserResponse) -> list[JobResponse]:
        employer_id = cls._employer_profile(user)["id"]
        response = (
            supabase.table("jobs")
            .select("*")
            .eq("employer_id", employer_id)
            .order("created_at", desc=True)
            .execute()
        )
        return [cls._to_response(row) for row in (response.data or [])]