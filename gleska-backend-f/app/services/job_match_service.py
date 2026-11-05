"""Employer-owned retrieval of safe worker match projections."""

from typing import Any

from app.core.supabase import supabase
from app.schemas.auth import UserResponse
from app.schemas.job import JobMatchAcceptResponse, JobMatchRejectResponse, JobMatchSummary, JobMatchWorkerResponse, JobMatchesResponse
from app.services.entitlements import employer_state
from app.services.job_service import JobNotFound, JobService
from app.services.matching_service import MatchingService


class JobMatchService:
    """Reads matches for jobs owned by the authenticated employer."""

    @staticmethod
    def _current_rows(employer_id: str, job_id: str | None = None) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"p_employer_id": employer_id}
        if job_id is not None:
            params["p_job_id"] = job_id
        response = supabase.rpc("get_current_job_match_workers", params).execute()
        return [row for row in (response.data or []) if row.get("status") == "PENDING"]

    @staticmethod
    def _accepted_rows(employer_id: str, job_id: str) -> list[dict[str, Any]]:
        response = (
            supabase.table("job_matches")
            .select(
                "worker_profile_id,status,created_at,composite_score,"
                "worker_profiles!inner(id,trade_id,skills,experience_years,expected_daily_wage,"
                "availability_status,users!inner(name)),jobs!inner(employer_id)"
            )
            .eq("job_id", job_id)
            .eq("jobs.employer_id", employer_id)
            .eq("status", "ACCEPTED")
            .execute()
        )
        return response.data or []

    @classmethod
    def get_worker_contact_for_user(cls, user: UserResponse, job_id: str, worker_profile_id: str) -> dict[str, Any]:
        """Reveal a worker's phone/email to the employer — ONLY after that worker has been
        selected/hired (ACCEPTED) on one of the employer's jobs. Enforces job ownership and the
        hire gate before resolving the contact server-side."""
        job = JobService.get_for_user(user, job_id)  # raises JobNotFound if not owned
        employer_id = job.employer_id
        accepted = (
            supabase.table("job_matches")
            .select("id,status,jobs!inner(employer_id)")
            .eq("job_id", job_id)
            .eq("worker_profile_id", worker_profile_id)
            .eq("jobs.employer_id", employer_id)
            .eq("status", "ACCEPTED")
            .limit(1)
            .execute()
        )
        if not (accepted.data or []):
            raise ValueError("WORKER_NOT_HIRED")
        response = supabase.rpc(
            "get_worker_contact_secure", {"p_worker_profile_id": worker_profile_id}
        ).execute()
        rows = response.data or []
        if not rows:
            raise ValueError("WORKER_NOT_FOUND")
        row = rows[0]
        return {
            "name": (row.get("name") or "").strip() or None,
            "mobile": (row.get("mobile") or "").strip() or None,
            "email": (row.get("email") or "").strip() or None,
        }

    @staticmethod
    def _rejected_rows(employer_id: str, job_id: str) -> list[dict[str, Any]]:
        response = (
            supabase.table("job_matches")
            .select(
                "worker_profile_id,status,created_at,composite_score,"
                "worker_profiles!inner(id,trade_id,skills,experience_years,expected_daily_wage,"
                "availability_status,users!inner(name)),jobs!inner(employer_id)"
            )
            .eq("job_id", job_id)
            .eq("jobs.employer_id", employer_id)
            .eq("status", "REJECTED")
            .execute()
        )
        return response.data or []

    @staticmethod
    def _worker_response(match: dict[str, Any]) -> JobMatchWorkerResponse:
        profile = match.get("worker_profiles") or {}
        user = profile.get("users") or {}
        return JobMatchWorkerResponse(
            worker_profile_id=str(match.get("worker_profile_id") or profile.get("id")),
            name=match.get("name") or user.get("name"),
            trade_id=match.get("trade_id") or profile.get("trade_id"),
            skills=match.get("skills") or profile.get("skills") or [],
            experience_years=match.get("experience_years") if match.get("experience_years") is not None else profile.get("experience_years"),
            expected_daily_wage=match.get("expected_daily_wage") if match.get("expected_daily_wage") is not None else profile.get("expected_daily_wage"),
            availability_status=match.get("availability_status") or profile.get("availability_status"),
            distance_m=match.get("distance_m"),
            composite_score=match["composite_score"],
            status=match["status"],
            created_at=match["created_at"],
        )

    @classmethod
    def list_for_user(cls, user: UserResponse, job_id: str) -> JobMatchesResponse:
        job = JobService.get_for_user(user, job_id)
        if job.status == "SEARCHING":
            MatchingService.create_matches(job_id, "EMPLOYER_MATCHES_REFRESHED")
        pending_matches = cls._current_rows(str(job.employer_id), job_id)
        accepted_matches = cls._accepted_rows(str(job.employer_id), job_id)
        rejected_matches = cls._rejected_rows(str(job.employer_id), job_id)
        matching_workers = [cls._worker_response(match) for match in pending_matches]
        selected_workers = [cls._worker_response(match) for match in accepted_matches]
        rejected_workers = [cls._worker_response(match) for match in rejected_matches]
        selected_count = len(selected_workers)
        return JobMatchesResponse(
            matching_status="FOUND" if matching_workers else "NO_MATCHES",
            matches=matching_workers,
            selected_workers=selected_workers,
            rejected_workers=rejected_workers,
            headcount_required=job.headcount_required,
            selected_count=selected_count,
            remaining_count=max(job.headcount_required - selected_count, 0),
        )

    @classmethod
    def summaries_for_user(cls, user: UserResponse) -> list[JobMatchSummary]:
        jobs = JobService.list_for_user(user)
        employer_id = str(jobs[0].employer_id) if jobs else str(JobService._employer_profile(user)["id"])
        rows = cls._current_rows(employer_id)
        counts: dict[str, int] = {}
        for row in rows:
            if row.get("status") == "PENDING":
                job_id = str(row["job_id"])
                counts[job_id] = counts.get(job_id, 0) + 1
        accepted_counts: dict[str, int] = {}
        if jobs:
            try:
                accepted_rows = (
                    supabase.table("job_matches")
                    .select("job_id, status, jobs!inner(employer_id)")
                    .eq("jobs.employer_id", employer_id)
                    .eq("status", "ACCEPTED")
                    .execute()
                    .data
                    or []
                )
                for row in accepted_rows:
                    job_id = str(row["job_id"])
                    accepted_counts[job_id] = accepted_counts.get(job_id, 0) + 1
            except Exception:
                accepted_counts = {}
        return [
            JobMatchSummary(
                job_id=job.id,
                current_match_count=counts.get(job.id, 0),
                accepted_count=accepted_counts.get(job.id, 0),
                matching_status="FOUND" if counts.get(job.id, 0) else "NO_MATCHES",
            )
            for job in jobs
        ]

    @classmethod
    def available_worker_count_for_user(cls, user: UserResponse) -> int:
        employer = JobService._employer_profile(user)
        rows = cls._current_rows(str(employer["id"]))
        return len({str(row["worker_profile_id"]) for row in rows if row.get("worker_profile_id")})

    @staticmethod
    def active_worker_count_for_user(user: UserResponse) -> int:
        employer = JobService._employer_profile(user)
        response = (
            supabase.table("job_matches")
            .select("worker_profile_id,jobs!inner(status,employer_id)")
            .eq("jobs.employer_id", employer["id"])
            .eq("status", "ACCEPTED")
            .in_("jobs.status", ["SEARCHING", "FILLED"])
            .execute()
        )
        return len({str(row["worker_profile_id"]) for row in (response.data or []) if row.get("worker_profile_id")})

    @classmethod
    def accept_for_user(cls, user: UserResponse, job_id: str, worker_profile_id: str) -> JobMatchAcceptResponse:
        from datetime import datetime, timezone
        job = JobService.get_for_user(user, job_id)
        employer = JobService._employer_profile(user)
        employer_type = employer.get("employer_type")

        # 1. Business Employers must have an active paid subscription or an active trial.
        if employer_type in {"REGISTERED_INDUSTRY", "REGISTERED_BUSINESS", "UNREGISTERED_BUSINESS"}:
            entitlements = employer_state(employer)
            if not entitlements["subscription_active"]:
                raise ValueError("SUBSCRIPTION_REQUIRED")

        try:
            rpc_response = supabase.rpc("accept_job_match", {
                "p_employer_id": job.employer_id,
                "p_job_id": job_id,
                "p_worker_profile_id": worker_profile_id,
            })
            if hasattr(rpc_response, "execute"):
                response = rpc_response.execute()
            else:
                response = rpc_response
        except Exception as exc:
            raise ValueError(str(exc)) from exc
        accepted = response.data[0] if isinstance(getattr(response, "data", None), list) and response.data else getattr(response, "data", None)
        if not accepted:
            raise ValueError("MATCH_ACCEPT_FAILED")

        return JobMatchAcceptResponse(
            match_id=str(accepted["match_id"]),
            worker_profile_id=str(accepted["worker_profile_id"]),
            match_status=accepted["match_status"],
            job_status=accepted["job_status"],
            accepted_count=accepted["accepted_count"],
        )

    @classmethod
    def reject_for_user(cls, user: UserResponse, job_id: str, worker_profile_id: str) -> JobMatchRejectResponse:
        job = JobService.get_for_user(user, job_id)
        try:
            rpc_response = supabase.rpc("reject_job_match", {
                "p_employer_id": job.employer_id,
                "p_job_id": job_id,
                "p_worker_profile_id": worker_profile_id,
            })
            response = rpc_response.execute() if hasattr(rpc_response, "execute") else rpc_response
        except Exception as exc:
            raise ValueError(str(exc)) from exc
        rejected = response.data[0] if isinstance(getattr(response, "data", None), list) and response.data else getattr(response, "data", None)
        if not rejected:
            raise ValueError("MATCH_REJECT_FAILED")

        return JobMatchRejectResponse(
            match_id=str(rejected["match_id"]),
            worker_profile_id=str(rejected["worker_profile_id"]),
            match_status=rejected["match_status"],
            job_status=rejected["job_status"],
            rejected_count=rejected["rejected_count"],
        )