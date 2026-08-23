"""Worker-specific endpoints."""

import logging

from fastapi import APIRouter, HTTPException, Query, status, Depends
from app.core.security import get_current_user, require_worker
from app.core.supabase import supabase
from app.schemas.auth import UserResponse
from app.schemas.worker import WorkerLocationUpdate, WorkerProfileResponse, UpdateWorkerProfileSchema
from app.services.matching_service import MatchingError, MatchingService

router = APIRouter(prefix="/workers", tags=["workers"])
logger = logging.getLogger(__name__)


@router.get("/me", response_model=WorkerProfileResponse)
async def get_worker_profile(user: UserResponse = Depends(require_worker)):
    """Get current worker's profile."""
    try:
        response = (
            supabase.table("worker_profiles")
            .select("*")
            .eq("user_id", user.id)
            .single()
            .execute()
        )

        if not response.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Worker profile not found",
            )

        return WorkerProfileResponse(**response.data)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )


@router.put("/me", response_model=WorkerProfileResponse)
async def update_worker_profile(
    update_data: UpdateWorkerProfileSchema,
    user: UserResponse = Depends(require_worker),
):
    """Update worker profile."""
    try:
        # Build update dict with only non-None values
        update_dict = {
            k: v for k, v in update_data.dict().items() if v is not None
        }

        if update_data.availability_status and update_data.availability_status not in {"AVAILABLE", "ON_JOB", "OFFLINE"}:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid availability status")

        if {"trade_id", "experience_years", "expected_daily_wage", "city", "state"} & update_dict.keys():
            current_response = supabase.table("worker_profiles").select("*").eq("user_id", user.id).single().execute()
            current_profile = current_response.data or {}
            merged_profile = {**current_profile, **update_dict}
            update_dict["profile_completed"] = all(
                merged_profile.get(field) is not None and str(merged_profile.get(field)).strip() != ""
                for field in ("trade_id", "experience_years", "expected_daily_wage", "city", "state")
            )
            update_dict["onboarding_status"] = "COMPLETED" if update_dict["profile_completed"] else "IN_PROGRESS"

        if not update_dict:
            # Get and return current profile if no updates
            response = (
                supabase.table("worker_profiles")
                .select("*")
                .eq("user_id", user.id)
                .single()
                .execute()
            )
            return WorkerProfileResponse(**response.data)

        # Update worker profile
        response = (
            supabase.table("worker_profiles")
            .update(update_dict)
            .eq("user_id", user.id)
            .execute()
        )

        if not response.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Worker profile not found",
            )

        return WorkerProfileResponse(**response.data[0])

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )


@router.put("/me/location", response_model=WorkerProfileResponse)
async def update_worker_location(
    location: WorkerLocationUpdate,
    user: UserResponse = Depends(require_worker),
):
    """Store browser-provided coordinates on the authenticated worker profile."""
    try:
        response = (
            supabase.table("worker_profiles")
            .update({"latitude": location.latitude, "longitude": location.longitude})
            .eq("user_id", user.id)
            .execute()
        )
        if not response.data:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Worker profile not found")
        return WorkerProfileResponse(**response.data[0])
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Worker location update failed: user_id=%s", user.id)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="WORKER_LOCATION_UPDATE_FAILED") from exc


@router.get("/me/available-jobs")
async def get_available_jobs(
    user: UserResponse = Depends(require_worker),
    max_radius: int = Query(default=30_000, ge=1, le=30_000),
):
    """Return nearby SEARCHING jobs ordered by PostGIS distance."""
    try:
        worker_response = (
            supabase.table("worker_profiles")
            .select("id, latitude, longitude, profile_completed, availability_status")
            .eq("user_id", user.id)
            .execute()
        )
        workers = worker_response.data or []
        if not workers:
            return {"jobs": []}
        jobs = MatchingService.available_jobs(str(workers[0]["id"]), max_radius)
    except MatchingError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Available jobs request failed: user_id=%s", user.id)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="AVAILABLE_JOBS_FAILED") from exc

    return {"jobs": jobs}
