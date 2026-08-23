"""Deterministic worker/job matching through Supabase PostGIS RPCs."""

from typing import Any

from app.core.supabase import supabase


class MatchingError(Exception):
    """The database matcher could not complete."""


class MatchingService:
    """Owns the legacy matching and worker browse RPC boundary."""

    MAX_RADIUS_METERS = 30_000

    @staticmethod
    def create_matches(job_id: str) -> list[dict[str, Any]]:
        try:
            response = supabase.rpc("create_job_matches_for_profiles", {"p_job_id": job_id}).execute()
        except Exception as exc:
            raise MatchingError("MATCHING_FAILED") from exc
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