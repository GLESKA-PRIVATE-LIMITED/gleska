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


@router.get("/me/jobs")
async def get_worker_jobs(user: UserResponse = Depends(require_worker)):
    """Return active and completed jobs with coordinates from their job sites."""
    try:
        profile_response = (
            supabase.table("worker_profiles")
            .select("id")
            .eq("user_id", user.id)
            .single()
            .execute()
        )
        profile = profile_response.data or {}
        if not profile.get("id"):
            return {"active_job": None, "recent_jobs": []}

        response = (
            supabase.table("job_matches")
            .select("id, status, arrival_otp, completion_otp, completed_at, expires_at, jobs(id, title, max_daily_salary, job_sites(location), employer_profiles(contact_person_name, users(mobile)))")
            .eq("worker_profile_id", profile["id"])
            .order("expires_at", desc=True)
            .execute()
        )
    except Exception as exc:
        logger.exception("Worker jobs request failed: user_id=%s", user.id)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="WORKER_JOBS_FAILED") from exc

    active_statuses = {"ACCEPTED", "IN_PROGRESS", "ARRIVED"}
    active_job = None
    recent_jobs = []
    for match in response.data or []:
        job = match.get("jobs") or {}
        site = job.get("job_sites") or {}
        location = site.get("location") or {}
        coordinates = location.get("coordinates") if isinstance(location, dict) else None
        target_lng, target_lat = (coordinates or [None, None])[:2]
        employer = job.get("employer_profiles") or {}
        employer_user = employer.get("users") or {}
        if isinstance(employer_user, list):
            employer_user = employer_user[0] if employer_user else {}
        item = {
            "match_id": str(match["id"]),
            "job_id": str(job.get("id")),
            "title": job.get("title"),
            "employer_name": employer.get("contact_person_name"),
            "employer_phone": employer_user.get("mobile"),
            "target_lat": float(target_lat) if target_lat is not None else None,
            "target_lng": float(target_lng) if target_lng is not None else None,
            "status": match.get("status"),
            "arrival_otp": match.get("arrival_otp"),
            "completion_otp": match.get("completion_otp"),
            "salary": float(job["max_daily_salary"]) if job.get("max_daily_salary") is not None else 0,
            "completed_at": match.get("completed_at"),
        }
        if match.get("status") in active_statuses and active_job is None:
            active_job = item
        elif match.get("status") == "COMPLETED":
            recent_jobs.append(item)

    return {"active_job": active_job, "recent_jobs": recent_jobs}
