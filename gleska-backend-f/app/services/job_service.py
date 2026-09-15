"""Job creation and employer-owned job persistence."""

from datetime import datetime, timezone
import logging
from typing import Any
from uuid import uuid4

from app.core.supabase import supabase
from app.schemas.auth import UserResponse
from app.schemas.job import JobCreate, JobDetailsResponse, JobResponse, JobSiteDetailsResponse
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

    @staticmethod
    def _employer_profile(user: UserResponse) -> dict[str, Any]:
        response = (
            supabase.table("employer_profiles")
            .select("id, onboarding_status, employer_type, subscription_valid_until, has_availed_free_dispatch")
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
            trade_id=row.get("trade_id"),
            required_skills=row.get("required_skills") or [],
            work_duration_days=row.get("work_duration_days"),
            work_timing=row.get("work_timing"),
            status=row["status"],
            created_at=row["created_at"],
            updated_at=row.get("updated_at"),
        )

    @classmethod
    def create(cls, user: UserResponse, request: JobCreate) -> JobResponse:
        employer = cls._employer_profile(user)
        cls._owned_site(str(employer["id"]), str(request.job_site_id))
        is_individual = employer.get("employer_type") == "INDIVIDUAL"

        # Business employers require an active subscription to create jobs
        if not is_individual:
            subscription_until = employer.get("subscription_valid_until")
            if isinstance(subscription_until, str):
                subscription_until = datetime.fromisoformat(subscription_until.replace("Z", "+00:00"))
            if subscription_until and subscription_until.tzinfo is None:
                subscription_until = subscription_until.replace(tzinfo=timezone.utc)
            if not subscription_until or subscription_until <= datetime.now(timezone.utc):
                raise JobPaymentRequired("SUBSCRIPTION_REQUIRED")

        rpc_params = {
            "p_employer_id": employer["id"],
            "p_job_site_id": str(request.job_site_id),
            "p_title": request.title,
            "p_headcount_required": request.headcount_required,
            "p_max_daily_salary": float(request.max_daily_salary) if request.max_daily_salary is not None else None,
            "p_min_experience": request.min_experience,
            "p_trade_id": request.trade_id,
            "p_required_skills": request.required_skills or [],
        }
        if request.work_duration_days is not None:
            rpc_params["p_work_duration_days"] = request.work_duration_days
        if request.work_timing is not None:
            rpc_params["p_work_timing"] = request.work_timing

        try:
            try:
                response = supabase.rpc("create_job_for_employer", rpc_params).execute()
            except Exception as rpc_err:
                # If remote RPC signature hasn't been migrated yet, retry with legacy params
                if "p_work_duration_days" in str(rpc_err) or "function" in str(rpc_err).lower():
                    legacy_params = {k: v for k, v in rpc_params.items() if k not in {"p_work_duration_days", "p_work_timing"}}
                    response = supabase.rpc("create_job_for_employer", legacy_params).execute()
                    # Update the new columns directly if provided
                    if response.data and (request.work_duration_days is not None or request.work_timing is not None):
                        created_id = response.data[0]["id"] if isinstance(response.data, list) else response.data["id"]
                        upd = {}
                        if request.work_duration_days is not None:
                            upd["work_duration_days"] = request.work_duration_days
                        if request.work_timing is not None:
                            upd["work_timing"] = request.work_timing
                        try:
                            upd_res = supabase.table("jobs").update(upd).eq("id", created_id).execute()
                            if upd_res.data:
                                response = upd_res
                        except Exception:
                            pass
                else:
                    raise rpc_err
        except Exception as exc:
            message = str(exc)
            logger.error("Job creation RPC failed: error_type=%s message=%s", type(exc).__name__, message)
            if "SUBSCRIPTION_REQUIRED" in message:
                if is_individual:
                    # Individual employers are entitled to post jobs without monthly subscriptions.
                    # If the database RPC is still rejecting due to legacy free-dispatch check, insert directly.
                    insert_data = {
                        "employer_id": employer["id"],
                        "job_site_id": str(request.job_site_id),
                        "title": request.title,
                        "headcount_required": request.headcount_required,
                        "max_daily_salary": float(request.max_daily_salary) if request.max_daily_salary is not None else None,
                        "min_experience": request.min_experience,
                        "trade_id": request.trade_id,
                        "required_skills": request.required_skills or [],
                        "work_duration_days": request.work_duration_days,
                        "work_timing": request.work_timing,
                        "status": "SEARCHING",
                    }
                    direct_res = supabase.table("jobs").insert(insert_data).execute()
                    job_data = direct_res.data[0] if isinstance(direct_res.data, list) and direct_res.data else direct_res.data
                    if not job_data:
                        raise RuntimeError("JOB_CREATE_FAILED")
                    try:
                        MatchingService.create_matches(str(job_data["id"]))
                    except MatchingError:
                        logger.exception("Matching failed after job creation: job_id=%s", job_data["id"])
                    return cls._to_response(job_data)
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

    @classmethod
    def get_for_user(cls, user: UserResponse, job_id: str) -> JobDetailsResponse:
        employer_id = cls._employer_profile(user)["id"]
        response = (
            supabase.table("jobs")
            .select("*")
            .eq("id", job_id)
            .eq("employer_id", employer_id)
            .single()
            .execute()
        )
        job = response.data or {}
        if not job:
            raise JobNotFound("JOB_NOT_FOUND")

        site_response = (
            supabase.table("job_sites")
            .select("*")
            .eq("id", job["job_site_id"])
            .eq("employer_id", employer_id)
            .single()
            .execute()
        )
        site = site_response.data or {}
        if not site:
            raise JobNotFound("JOB_SITE_NOT_FOUND")

        location = site.get("location") or {}
        coordinates = location.get("coordinates") if isinstance(location, dict) else str(location).removeprefix("POINT(").removesuffix(")").split()
        longitude, latitude = coordinates[:2]
        return JobDetailsResponse(
            **cls._to_response(job).model_dump(),
            job_site=JobSiteDetailsResponse(
                id=str(site["id"]),
                name=site["name"],
                address=site.get("address"),
                latitude=float(latitude),
                longitude=float(longitude),
            ),
        )