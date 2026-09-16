"""Deterministic worker/job matching through Supabase PostGIS RPCs."""

from typing import Any

from app.core.supabase import supabase


class MatchingError(Exception):
    """The database matcher could not complete."""


class MatchingService:
    """Owns candidate-pool reconciliation and worker browse RPC boundaries."""

    MAX_RADIUS_METERS = 30_000

    @staticmethod
    def create_matches(job_id: str) -> list[dict[str, Any]]:
        try:
            response = supabase.rpc(
                "reconcile_job_candidate_pool",
                {"p_job_id": job_id, "p_trigger": "JOB_CREATED"},
            ).execute()
        except Exception as exc:
            raise MatchingError("MATCHING_FAILED") from exc
        return response.data or []

    @staticmethod
    def reconcile_worker(worker_profile_id: str, trigger: str = "WORKER_PROFILE_UPDATED") -> list[dict[str, Any]]:
        try:
            response = supabase.rpc(
                "reconcile_worker_candidate_pools",
                {"p_worker_profile_id": worker_profile_id, "p_trigger": trigger},
            ).execute()
        except Exception as exc:
            raise MatchingError("WORKER_REMATCH_FAILED") from exc
        return response.data or []

    @staticmethod
    def available_jobs(worker_id: str, max_radius: int = MAX_RADIUS_METERS) -> list[dict[str, Any]]:
        if max_radius <= 0 or max_radius > MatchingService.MAX_RADIUS_METERS:
            raise ValueError("INVALID_MATCHING_RADIUS")
        try:
            response = supabase.rpc(
                "find_available_jobs_for_worker",
                {"p_worker_id": worker_id, "p_max_radius": max_radius},
            ).execute()
        except Exception as exc:
            raise MatchingError("AVAILABLE_JOBS_FAILED") from exc
        return response.data or []