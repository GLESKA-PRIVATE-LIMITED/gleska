"""Worker-specific endpoints."""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query, status, Depends
from app.core.security import get_current_user, require_worker
from app.core.supabase import supabase
from app.schemas.auth import UserResponse
from app.schemas.worker import (
    WorkerCurrentLocationResponse,
    WorkerJobRouteResponse,
    WorkerLocationUpdate,
    WorkerProfileResponse,
    UpdateWorkerProfileSchema,
)
from app.schemas.worker import (
    WorkerCurrentLocationResponse,
    WorkerJobRouteResponse,
    WorkerLocationUpdate,
    WorkerProfileResponse,
    UpdateWorkerProfileSchema,
    WorkerDocumentResponse,
    WorkerDocumentListResponse,
    DocumentUploadRequest,
    ProfilePhotoUploadRequest,
)
from app.services.document_service import WorkerDocumentService
from app.services.profile_photo_service import (
    PROFILE_PHOTOS_BUCKET,
    delete_profile_photo,
    get_profile_photo_path,
    get_signed_profile_photo_url,
    now_iso,
    validate_profile_photo,
)
from app.services.geocoding_service import GeocodingError, GeocodingService
from app.services.google_routes_service import GoogleRoutesError, GoogleRoutesService
from app.services.matching_service import MatchingError, MatchingService

router = APIRouter(prefix="/workers", tags=["workers"])
logger = logging.getLogger(__name__)
CURRENT_LOCATION_MAX_AGE = timedelta(minutes=10)


@router.post("/me/profile-photo/upload-start")
async def start_profile_photo_upload(request: ProfilePhotoUploadRequest, user: UserResponse = Depends(require_worker)):
    validate_profile_photo(request)
    return {"storage_path": get_profile_photo_path(user.id, request.original_filename)}


@router.post("/me/profile-photo/upload-complete", response_model=UserResponse)
async def complete_profile_photo_upload(request: ProfilePhotoUploadRequest, user: UserResponse = Depends(require_worker)):
    validate_profile_photo(request)
    expected_prefix = f"users/{user.id}/"
    if not request.storage_path or not request.storage_path.startswith(expected_prefix):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid profile photo path")

    current = supabase.table("users").select("profile_photo_path").eq("id", user.id).single().execute().data or {}
    old_path = current.get("profile_photo_path")
    supabase.table("users").update({"profile_photo_path": request.storage_path, "updated_at": now_iso()}).eq("id", user.id).execute()
    if old_path and old_path != request.storage_path:
        delete_profile_photo(old_path)
    updated = supabase.table("users").select("*").eq("id", user.id).single().execute().data
    return UserResponse(**updated, profile_photo_url=get_signed_profile_photo_url(request.storage_path))


@router.delete("/me/profile-photo", status_code=status.HTTP_204_NO_CONTENT)
async def delete_profile_photo_upload(user: UserResponse = Depends(require_worker)):
    current = supabase.table("users").select("profile_photo_path").eq("id", user.id).single().execute().data or {}
    delete_profile_photo(current.get("profile_photo_path"))
    supabase.table("users").update({"profile_photo_path": None, "updated_at": now_iso()}).eq("id", user.id).execute()


def _is_current_location_fresh(updated_at: Any) -> bool:
    if not updated_at:
        return False
    if isinstance(updated_at, str):
        updated_at = datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
    if updated_at.tzinfo is None:
        updated_at = updated_at.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - updated_at <= CURRENT_LOCATION_MAX_AGE


def _parse_location_coordinates(value: Any) -> tuple[float, float] | None:
    if value is None:
        return None
    if isinstance(value, dict):
        coordinates = value.get("coordinates") or []
        if len(coordinates) >= 2:
            try:
                return float(coordinates[0]), float(coordinates[1])
            except (TypeError, ValueError):
                return None
        return None
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        if text.startswith("POINT(") and text.endswith(")"):
            inner = text[len("POINT("):-1].strip()
            parts = inner.split()
            if len(parts) >= 2:
                try:
                    return float(parts[0]), float(parts[1])
                except ValueError:
                    return None
    return None


async def get_worker_job_route(job_id: str, user: UserResponse):
    """Return the best road route from the worker's current location to the selected job site."""
    profile_response = (
        supabase.table("worker_profiles")
        .select("id, latitude, longitude")
        .eq("user_id", user.id)
        .single()
        .execute()
    )
    profile_data = profile_response.data or {}
    if isinstance(profile_data, list):
        profile = profile_data[0] if profile_data else {}
    else:
        profile = profile_data
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Worker profile not found")

    location_response = (
        supabase.table("worker_current_locations")
        .select("latitude, longitude, accuracy_m, updated_at")
        .eq("worker_profile_id", profile["id"])
        .maybe_single()
        .execute()
    )
    current_location = location_response.data or {}
    if isinstance(current_location, list):
        current_location = current_location[0] if current_location else {}
    use_current = (
        current_location.get("latitude") is not None
        and current_location.get("longitude") is not None
        and current_location.get("accuracy_m", 0) <= 1000
        and _is_current_location_fresh(current_location.get("updated_at"))
    )
    worker_latitude = current_location.get("latitude") if use_current else profile.get("latitude")
    worker_longitude = current_location.get("longitude") if use_current else profile.get("longitude")
    if worker_latitude is None or worker_longitude is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CURRENT_LOCATION_REQUIRED")

    available_jobs = MatchingService.available_jobs(str(profile["id"]))
    available_ids = {str(job.get("job_id") or job.get("id")) for job in available_jobs}
    if job_id not in available_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="JOB_NOT_AVAILABLE_FOR_WORKER")

    job_response = (
        supabase.table("jobs")
        .select("id, title, job_site_id, status")
        .eq("id", job_id)
        .single()
        .execute()
    )
    job_data = job_response.data or {}
    if isinstance(job_data, list):
        job = job_data[0] if job_data else {}
    else:
        job = job_data
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")

    site_response = (
        supabase.table("job_sites")
        .select("id, name, location")
        .eq("id", job.get("job_site_id"))
        .single()
        .execute()
    )
    site_data = site_response.data or {}
    if isinstance(site_data, list):
        site = site_data[0] if site_data else {}
    else:
        site = site_data
    if not site:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job site not found")

    site_coordinates = _parse_location_coordinates(site.get("location"))
    if site_coordinates is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="JOB_LOCATION_UNAVAILABLE")

    destination_lng, destination_lat = site_coordinates
    origin_lat = float(worker_latitude)
    origin_lng = float(worker_longitude)

    try:
        route_result = await GoogleRoutesService.compute_route(origin_lat, origin_lng, destination_lat, destination_lng)
    except GoogleRoutesError as exc:
        if str(exc) == "NO_ROUTE_FOUND":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No drivable route could be found between your location and this work site.") from exc
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="ROUTE_CALCULATION_FAILED") from exc

    distance_km = round((route_result["distance_meters"] / 1000.0), 1)
    duration_minutes = max(1, round(route_result["duration_seconds"] / 60.0)) if route_result["duration_seconds"] else 0
    return {
        "job_id": str(job["id"]),
        "origin": {"latitude": origin_lat, "longitude": origin_lng},
        "destination": {"latitude": destination_lat, "longitude": destination_lng, "name": site.get("name") or "Work site"},
        "route": {
            "distance_meters": route_result["distance_meters"],
            "distance_km": distance_km,
            "duration_seconds": route_result["duration_seconds"],
            "duration_minutes": duration_minutes,
            "encoded_polyline": route_result["encoded_polyline"],
        },
    }


@router.get("/me/jobs/{job_id}/route", response_model=WorkerJobRouteResponse)
async def get_worker_job_route_endpoint(
    job_id: str,
    user: UserResponse = Depends(require_worker),
):
    """Compute the driving route for the selected available job."""
    return await get_worker_job_route(job_id, user)


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

        if update_data.location_source and update_data.location_source not in {"PROFILE", "GPS", "SEARCH", "MAP"}:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid location source")
        if ("latitude" in update_dict) != ("longitude" in update_dict):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Location coordinates must be provided together")
        if "latitude" in update_dict:
            update_dict["location_updated_at"] = datetime.now(timezone.utc).isoformat()

        # Always recalculate profile_completed to align with frontend's 8-field requirement:
        # 1. user.name (from users table)
        # 2. user.mobile (from users table)
        # 3. user.email (from users table)
        # 4. profile.trade_id
        # 5. profile.experience_years
        # 6. profile.expected_daily_wage
        # 7. profile.city OR profile.address
        # 8. profile.availability_status (must not be "OFFLINE")
        current_response = supabase.table("worker_profiles").select("*").eq("user_id", user.id).single().execute()
        current_profile = current_response.data or {}
        merged_profile = {**current_profile, **update_dict}

        # Check user fields from UserResponse object
        has_name = user.name is not None and str(user.name).strip() != ""
        has_mobile = user.mobile is not None and str(user.mobile).strip() != ""
        has_email = user.email is not None and str(user.email).strip() != ""

        # Check profile fields with merged updates
        has_trade_id = merged_profile.get("trade_id") is not None and str(merged_profile.get("trade_id")).strip() != ""
        has_experience = merged_profile.get("experience_years") is not None
        has_wage = merged_profile.get("expected_daily_wage") is not None
        has_location = (
            (merged_profile.get("city") is not None and str(merged_profile.get("city")).strip() != "")
            or (merged_profile.get("address") is not None and str(merged_profile.get("address")).strip() != "")
        )
        availability = merged_profile.get("availability_status")
        has_availability = (
            availability is not None 
            and str(availability).strip() != "" 
            and str(availability).strip() != "OFFLINE"
        )

        # Profile is complete only if all 8 fields are satisfied
        update_dict["profile_completed"] = all([
            has_name,
            has_mobile,
            has_email,
            has_trade_id,
            has_experience,
            has_wage,
            has_location,
            has_availability,
        ])
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


@router.put("/me/location", response_model=WorkerCurrentLocationResponse)
async def update_worker_location(
    location: WorkerLocationUpdate,
    user: UserResponse = Depends(require_worker),
):
    """Reverse geocode and upsert the browser-provided current location."""
    try:
        profile_response = (
            supabase.table("worker_profiles")
            .select("id")
            .eq("user_id", user.id)
            .single()
            .execute()
        )
        profile = profile_response.data or {}
        if isinstance(profile, list):
            profile = profile[0] if profile else {}
        if not profile.get("id"):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Worker profile not found")
        try:
            address = await GeocodingService.reverse_geocode(location.latitude, location.longitude)
        except GeocodingError:
            address = None
        response = (
            supabase.table("worker_current_locations")
            .upsert({
                "worker_profile_id": profile["id"],
                "latitude": location.latitude,
                "longitude": location.longitude,
                "accuracy_m": location.accuracy_m,
                "address": address,
            }, on_conflict="worker_profile_id")
            .execute()
        )
        if not response.data:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Worker profile not found")
        return WorkerCurrentLocationResponse(**response.data[0])
    except GeocodingError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
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
            .select("id, profile_completed, availability_status, latitude, longitude")
            .eq("user_id", user.id)
            .single()
            .execute()
        )
        worker = worker_response.data or {}
        if isinstance(worker, list):
            worker = worker[0] if worker else {}
        if not worker:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Worker profile not found")
        current_location = (
            supabase.table("worker_current_locations")
            .select("id, latitude, longitude, accuracy_m, updated_at")
            .eq("worker_profile_id", worker["id"])
            .maybe_single()
            .execute()
        )
        current_data = {}
        if current_location is not None and getattr(current_location, "data", None) is not None:
            current_data = current_location.data or {}
            if isinstance(current_data, list):
                current_data = current_data[0] if current_data else {}
        has_current = (
            current_data.get("latitude") is not None
            and current_data.get("longitude") is not None
            and current_data.get("accuracy_m", 0) <= 1000
            and _is_current_location_fresh(current_data.get("updated_at"))
        )
        if not has_current and (worker.get("latitude") is None or worker.get("longitude") is None):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CURRENT_LOCATION_REQUIRED")
        jobs = MatchingService.available_jobs(str(worker["id"]), max_radius)
    except HTTPException:
        raise
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


# ============================================================================
# Document Management Endpoints
# ============================================================================

@router.post("/me/documents/upload-start", response_model=dict)
async def start_document_upload(
    upload_request: DocumentUploadRequest,
    user: UserResponse = Depends(require_worker)
):
    """
    Start a document upload session.
    Frontend calls this before uploading the file to Storage.
    Returns storage path and upload URL.
    
    Args:
        upload_request: Document metadata (type, filename, mime_type, file_size)
        user: Authenticated worker user
        
    Returns:
        {
            "storage_path": "workers/{worker_id}/documents/{type}/{uuid}_{filename}",
            "document_type": "EXPERIENCE_CERTIFICATE|POLICE_VERIFICATION"
        }
    """
    try:
        # Get worker profile
        profile_response = (
            supabase.table("worker_profiles")
            .select("id")
            .eq("user_id", user.id)
            .single()
            .execute()
        )
        
        profile = profile_response.data
        if not profile:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Worker profile not found"
            )
        
        worker_profile_id = profile["id"]
        
        # Initialize document service
        doc_service = WorkerDocumentService(supabase, supabase)
        
        # Validate file metadata
        doc_service.validate_file_metadata(upload_request)
        
        # Generate storage path
        storage_path = doc_service.get_document_storage_path(
            worker_profile_id,
            upload_request.document_type,
            upload_request.original_filename
        )
        
        return {
            "storage_path": storage_path,
            "document_type": upload_request.document_type,
            "worker_profile_id": worker_profile_id,
        }
        
    except ValueError as e:
        logger.warning("Document validation failed: user_id=%s, error=%s", user.id, str(e))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.exception("Document upload start failed: user_id=%s", user.id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="DOCUMENT_UPLOAD_START_FAILED"
        )


@router.post("/me/documents/upload-complete", response_model=WorkerDocumentResponse)
async def complete_document_upload(
    upload_request: DocumentUploadRequest,
    user: UserResponse = Depends(require_worker)
):
    """
    Complete a document upload.
    Frontend calls this AFTER successfully uploading file to Storage.
    Creates metadata record in database.
    
    Args:
        upload_request: Document metadata (type, filename, mime_type, file_size)
        user: Authenticated worker user
        
    Returns:
        WorkerDocumentResponse with created document metadata
    """
    try:
        # Get worker profile
        profile_response = (
            supabase.table("worker_profiles")
            .select("id")
            .eq("user_id", user.id)
            .single()
            .execute()
        )
        
        profile = profile_response.data
        if not profile:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Worker profile not found"
            )
        
        worker_profile_id = profile["id"]
        
        # Initialize document service
        doc_service = WorkerDocumentService(supabase, supabase)
        
        # Validate file metadata
        doc_service.validate_file_metadata(upload_request)
        
        # Delete old document from Storage if it exists (replacement scenario)
        await doc_service.delete_old_document_storage(
            worker_profile_id,
            upload_request.document_type
        )
        
        # Generate storage path
        storage_path = doc_service.get_document_storage_path(
            worker_profile_id,
            upload_request.document_type,
            upload_request.original_filename
        )
        
        # Create/update metadata in database (UPSERT)
        document = await doc_service.create_document_metadata(
            worker_profile_id,
            upload_request,
            storage_path
        )
        
        return document
        
    except ValueError as e:
        logger.warning("Document validation failed: user_id=%s, error=%s", user.id, str(e))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.exception("Document upload complete failed: user_id=%s", user.id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="DOCUMENT_UPLOAD_COMPLETE_FAILED"
        )


@router.get("/me/documents", response_model=WorkerDocumentListResponse)
async def list_worker_documents(user: UserResponse = Depends(require_worker)):
    """
    List all documents for the authenticated worker.
    
    Args:
        user: Authenticated worker user
        
    Returns:
        WorkerDocumentListResponse with list of documents
    """
    try:
        # Get worker profile
        profile_response = (
            supabase.table("worker_profiles")
            .select("id")
            .eq("user_id", user.id)
            .single()
            .execute()
        )
        
        profile = profile_response.data
        if not profile:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Worker profile not found"
            )
        
        worker_profile_id = profile["id"]
        
        # Initialize document service
        doc_service = WorkerDocumentService(supabase, supabase)
        
        # Get documents
        documents = await doc_service.get_worker_documents(worker_profile_id)
        
        return WorkerDocumentListResponse(
            documents=documents,
            total_count=len(documents)
        )
        
    except Exception as e:
        logger.exception("Document list failed: user_id=%s", user.id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="DOCUMENT_LIST_FAILED"
        )


@router.get("/me/documents/{document_id}", response_model=WorkerDocumentResponse)
async def get_worker_document(
    document_id: str,
    user: UserResponse = Depends(require_worker)
):
    """
    Retrieve metadata for a single document.
    
    Args:
        document_id: UUID of the document
        user: Authenticated worker user
        
    Returns:
        WorkerDocumentResponse
    """
    try:
        # Get worker profile
        profile_response = (
            supabase.table("worker_profiles")
            .select("id")
            .eq("user_id", user.id)
            .single()
            .execute()
        )
        
        profile = profile_response.data
        if not profile:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Worker profile not found"
            )
        
        worker_profile_id = profile["id"]
        
        # Initialize document service
        doc_service = WorkerDocumentService(supabase, supabase)
        
        # Get document
        document = await doc_service.get_document(worker_profile_id, document_id)
        
        return document
        
    except ValueError as e:
        logger.warning("Document not found: user_id=%s, document_id=%s", user.id, document_id)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )
    except Exception as e:
        logger.exception("Document retrieval failed: user_id=%s, document_id=%s", user.id, document_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="DOCUMENT_RETRIEVAL_FAILED"
        )


@router.get("/me/documents/{document_id}/view")
async def view_worker_document(
    document_id: str,
    user: UserResponse = Depends(require_worker)
):
    try:
        profile_response = supabase.table("worker_profiles").select("id").eq("user_id", user.id).single().execute()
        profile = profile_response.data
        if not profile:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Worker profile not found")
        doc_service = WorkerDocumentService(supabase, supabase)
        url = await doc_service.get_document_view_url(profile["id"], document_id)
        return {"url": url, "expires_in": 3600}
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found") from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Document view failed: user_id=%s, document_id=%s", user.id, document_id)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="DOCUMENT_VIEW_FAILED") from exc


@router.delete("/me/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_worker_document(
    document_id: str,
    user: UserResponse = Depends(require_worker)
):
    """
    Delete a document (both metadata and Storage file).
    
    Args:
        document_id: UUID of the document
        user: Authenticated worker user
    """
    try:
        # Get worker profile
        profile_response = (
            supabase.table("worker_profiles")
            .select("id")
            .eq("user_id", user.id)
            .single()
            .execute()
        )
        
        profile = profile_response.data
        if not profile:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Worker profile not found"
            )
        
        worker_profile_id = profile["id"]
        
        # Initialize document service
        doc_service = WorkerDocumentService(supabase, supabase)
        
        # Delete document
        await doc_service.delete_document(worker_profile_id, document_id)
        
    except ValueError as e:
        logger.warning("Document not found for deletion: user_id=%s, document_id=%s", user.id, document_id)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )
    except Exception as e:
        logger.exception("Document deletion failed: user_id=%s, document_id=%s", user.id, document_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="DOCUMENT_DELETION_FAILED"
        )
