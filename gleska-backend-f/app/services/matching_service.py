"""Deterministic worker/job matching through Supabase PostGIS RPCs."""

import logging
from typing import Any

from app.core.supabase import supabase

logger = logging.getLogger(__name__)


def _is_missing_rpc(exc: Exception) -> bool:
    return getattr(exc, "code", None) == "PGRST202" or "PGRST202" in str(exc)


class MatchingError(Exception):
    """The database matcher could not complete."""


class MatchingService:
    """Owns candidate-pool reconciliation and worker browse RPC boundaries."""

    MAX_RADIUS_METERS = 30_000

    @staticmethod
    def create_matches(job_id: str, trigger: str = "JOB_CREATED") -> list[dict[str, Any]]:
        try:
            response = supabase.rpc(
                "reconcile_job_candidate_pool",
                {"p_job_id": job_id, "p_trigger": trigger},
            ).execute()
        except Exception as exc:
            logger.exception("Job candidate reconciliation RPC failed: job_id=%s", job_id)
            if _is_missing_rpc(exc):
                raise MatchingError("MATCHING_RPC_UNAVAILABLE") from exc
            raise MatchingError("MATCHING_FAILED") from exc
        rows = response.data or []
        if not rows or any(row.get("status") != "SUCCEEDED" for row in rows):
            raise MatchingError("MATCHING_FAILED")
        return rows

    @staticmethod
    def reconcile_worker(worker_profile_id: str, trigger: str = "WORKER_PROFILE_UPDATED") -> list[dict[str, Any]]:
        try:
            response = supabase.rpc(
                "reconcile_worker_candidate_pools",
                {"p_worker_profile_id": worker_profile_id, "p_trigger": trigger},
            ).execute()
        except Exception as exc:
            logger.exception("Worker candidate reconciliation RPC failed: worker_profile_id=%s", worker_profile_id)
            if _is_missing_rpc(exc):
                raise MatchingError("MATCHING_RPC_UNAVAILABLE") from exc
            raise MatchingError("WORKER_REMATCH_FAILED") from exc
        rows = response.data or []
        if not rows:
            raise MatchingError("WORKER_REMATCH_FAILED")
        try:
            if any(int(row.get("failed_count") or 0) > 0 for row in rows):
                raise MatchingError("WORKER_REMATCH_FAILED")
        except (TypeError, ValueError) as exc:
            raise MatchingError("WORKER_REMATCH_FAILED") from exc
        return rows

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
            logger.exception("Available jobs RPC failed: worker_profile_id=%s", worker_id)
            if _is_missing_rpc(exc):
                raise MatchingError("MATCHING_RPC_UNAVAILABLE") from exc
            raise MatchingError("AVAILABLE_JOBS_FAILED") from exc
        return response.data or []