"""Employer-owned retrieval of safe worker match projections."""

from decimal import Decimal, InvalidOperation
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
        pending_matches = cls._current_rows(str(job.employer_id), job_id)
        accepted_matches = cls._accepted_rows(str(job.employer_id), job_id)
        matching_workers = [cls._worker_response(match) for match in pending_matches]
        selected_workers = [cls._worker_response(match) for match in accepted_matches]
        selected_count = len(selected_workers)
        return JobMatchesResponse(
            matching_status="FOUND" if matching_workers else "NO_MATCHES",
            matches=matching_workers,
            selected_workers=selected_workers,
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
    def accept_for_user(cls, user: UserResponse, job_id: str, worker_profile_id: str) -> JobMatchAcceptResponse:
        from datetime import datetime, timezone
        job = JobService.get_for_user(user, job_id)
        employer = JobService._employer_profile(user)
        employer_type = employer.get("employer_type")

        # 1. Business Employers must have an active subscription
        if employer_type in {"REGISTERED_INDUSTRY", "REGISTERED_BUSINESS", "UNREGISTERED_BUSINESS"}:
            subscription_until = employer.get("subscription_valid_until")
            if isinstance(subscription_until, str):
                subscription_until = datetime.fromisoformat(subscription_until.replace("Z", "+00:00"))
            if subscription_until and subscription_until.tzinfo is None:
                subscription_until = subscription_until.replace(tzinfo=timezone.utc)
            if not subscription_until or subscription_until <= datetime.now(timezone.utc):
                raise ValueError("SUBSCRIPTION_REQUIRED")

        # 2. Individual Employers: 1st dispatch is free; subsequent dispatches require ₹30 commission
        consumed_free_dispatch = False
        if employer_type == "INDIVIDUAL":
            has_availed_free_dispatch = employer.get("has_availed_free_dispatch", False)
            if not has_availed_free_dispatch:
                # Qualifies for free dispatch
                consumed_free_dispatch = True
            else:
                # Requires a successful ₹30 commission payment for this specific worker + job
                paid_commission_resp = (
                    supabase.table("payment_transactions")
                    .select("id, job_id, amount, payment_category, raw_webhook_payload")
                    .eq("employer_id", employer["id"])
                    .eq("payment_category", "INDIVIDUAL_COMMISSION")
                    .eq("status", "SUCCESS")
                    .execute()
                )
                has_paid = False
                for p in (paid_commission_resp.data or []):
                    payload = p.get("raw_webhook_payload") or {}
                    p_job_id = p.get("job_id") or payload.get("job_id")
                    p_worker_id = payload.get("worker_profile_id")
                    try:
                        p_amount = Decimal(str(p.get("amount")))
                    except (InvalidOperation, TypeError):
                        p_amount = Decimal("0")
                    if (
                        str(p_job_id) == str(job_id)
                        and str(p_worker_id) == str(worker_profile_id)
                        and p_amount == Decimal("30")
                    ):
                        has_paid = True
                        break
                if not has_paid:
                    raise ValueError("COMMISSION_REQUIRED")

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

        # Atomically record consumption of the free dispatch if this was the qualifying first dispatch
        if consumed_free_dispatch:
            supabase.table("employer_profiles").update({"has_availed_free_dispatch": True}).eq("id", employer["id"]).execute()

        return JobMatchAcceptResponse(
            match_id=str(accepted["match_id"]),
            worker_profile_id=str(accepted["worker_profile_id"]),
            match_status=accepted["match_status"],
            job_status=accepted["job_status"],
            accepted_count=accepted["accepted_count"],
        )