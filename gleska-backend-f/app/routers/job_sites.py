"""Employer-owned job-site endpoints."""

from uuid import UUID
import logging

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.security import require_employer
from app.schemas.auth import UserResponse
from app.schemas.job_site import JobSiteCreate, JobSiteResponse
from app.services.job_site_service import JobSiteHasJobs, JobSiteNotFound, JobSiteService

router = APIRouter(prefix="/job-sites", tags=["job-sites"])
logger = logging.getLogger(__name__)


@router.get("/me", response_model=list[JobSiteResponse])
async def get_my_job_sites(user: UserResponse = Depends(require_employer)):
    try:
        return JobSiteService.list_for_user(user)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except JobSiteNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/", response_model=JobSiteResponse, status_code=status.HTTP_201_CREATED)
async def create_job_site(
    request: JobSiteCreate,
    user: UserResponse = Depends(require_employer),
):
    try:
        return JobSiteService.create(user, request)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except JobSiteNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Job-site creation failed: exception_type=%s", type(exc).__name__)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="JOB_SITE_CREATE_FAILED") from exc


@router.delete("/{site_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_job_site(
    site_id: UUID,
    user: UserResponse = Depends(require_employer),
):
    try:
        JobSiteService.delete(user, str(site_id))
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except JobSiteHasJobs as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except JobSiteNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc