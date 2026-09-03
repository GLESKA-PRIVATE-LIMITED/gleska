"""Employer-owned retrieval of safe worker match projections."""

from typing import Any

from app.core.supabase import supabase
from app.schemas.auth import UserResponse
from app.schemas.job import JobMatchAcceptResponse, JobMatchSummary, JobMatchWorkerResponse, JobMatchesResponse
from app.services.job_service import JobNotFound, JobService


class JobMatchService:
    """Reads matches for jobs owned by the authenticated employer."""

    @staticmethod
    def _current_rows(employer_id: str, job_id: str | None = None) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"p_employer_id": employer_id}
        if job_id is not None:
            params["p_job_id"] = job_id
        response = supabase.rpc("get_current_job_match_workers", params).execute()
        return response.data or []

    @classmethod
    def list_for_user(cls, user: UserResponse, job_id: str) -> JobMatchesResponse:
        job = JobService.get_for_user(user, job_id)
        matches = cls._current_rows(str(job.employer_id), job_id)
        if not matches:
            return JobMatchesResponse(matching_status="COMPLETED", matches=[])
        result = []
        for match in matches:
            result.append(JobMatchWorkerResponse(
                worker_profile_id=str(match["worker_profile_id"]),
                name=match.get("name"),
                trade_id=match.get("trade_id"),
                skills=match.get("skills") or [],
                experience_years=match.get("experience_years"),
                expected_daily_wage=match.get("expected_daily_wage"),
                availability_status=match.get("availability_status"),
                distance_m=match.get("distance_m"),
                composite_score=match["composite_score"],
                status=match["status"],
                created_at=match["created_at"],
            ))
        return JobMatchesResponse(matching_status="COMPLETED", matches=result)

    @classmethod
    def summaries_for_user(cls, user: UserResponse) -> list[JobMatchSummary]:
        jobs = JobService.list_for_user(user)
        employer_id = str(jobs[0].employer_id) if jobs else str(JobService._employer_profile(user)["id"])
        rows = cls._current_rows(employer_id)
        counts: dict[str, int] = {}
        for row in rows:
            job_id = str(row["job_id"])
            counts[job_id] = counts.get(job_id, 0) + 1
        return [
            JobMatchSummary(
                job_id=job.id,
                current_match_count=counts.get(job.id, 0),
                matching_status="FOUND" if counts.get(job.id, 0) else "NO_MATCHES",
            )
            for job in jobs
        ]

    @classmethod
    def accept_for_user(cls, user: UserResponse, job_id: str, worker_profile_id: str) -> JobMatchAcceptResponse:
        job = JobService.get_for_user(user, job_id)
        try:
            response = supabase.rpc("accept_job_match", {
                "p_employer_id": job.employer_id,
                "p_job_id": job_id,
                "p_worker_profile_id": worker_profile_id,
            }).execute()
        except Exception as exc:
            raise ValueError(str(exc)) from exc
        accepted = response.data[0] if isinstance(response.data, list) and response.data else response.data
        if not accepted:
            raise ValueError("MATCH_ACCEPT_FAILED")
        return JobMatchAcceptResponse(
            match_id=str(accepted["match_id"]),
            worker_profile_id=str(accepted["worker_profile_id"]),
            match_status=accepted["match_status"],
            job_status=accepted["job_status"],
            accepted_count=accepted["accepted_count"],
        )