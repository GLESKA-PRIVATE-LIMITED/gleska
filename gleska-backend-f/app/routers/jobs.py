"""Job-related endpoints."""

from fastapi import APIRouter, Depends, HTTPException, status
import logging

from app.core.security import require_employer
from app.schemas.auth import UserResponse
from app.schemas.job import JobCreate, JobResponse
from app.schemas.job_extraction import JobExtractionRequest, JobExtractionResponse
from app.services.job_service import JobNotFound, JobPaymentRequired, JobService
from app.services.matching_service import MatchingError
from app.services.gemini_service import (
    GeminiConfigurationError,
    GeminiProviderError,
    GeminiService,
)

router = APIRouter(prefix="/jobs", tags=["jobs"])
logger = logging.getLogger(__name__)


@router.get("", response_model=list[JobResponse])
async def get_my_jobs(user: UserResponse = Depends(require_employer)):
    """Return jobs owned by the authenticated employer."""
    try:
        return JobService.list_for_user(user)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except JobNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except JobPaymentRequired as exc:
        raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail=str(exc)) from exc


@router.post("", response_model=JobResponse, status_code=status.HTTP_201_CREATED)
async def create_job(
    request: JobCreate,
    user: UserResponse = Depends(require_employer),
):
    """Create a job for an owned site without invoking matching yet."""
    try:
        return JobService.create(user, request)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except JobNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except MatchingError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Job creation failed: exception_type=%s message=%s", type(exc).__name__, str(exc))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="JOB_CREATE_FAILED") from exc


@router.post("/nlp", response_model=JobExtractionResponse)
async def extract_job_requirements(
    request: JobExtractionRequest,
    user: UserResponse = Depends(require_employer),
):
    """Extract job requirements without persisting or dispatching a job yet."""
    del user
    try:
        extraction = await GeminiService.extract_job_requirements(request.prompt)
    except GeminiConfigurationError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except GeminiProviderError as exc:
        error_status = {
            "GEMINI_AUTHENTICATION_FAILED": status.HTTP_502_BAD_GATEWAY,
            "GEMINI_RATE_LIMITED": status.HTTP_503_SERVICE_UNAVAILABLE,
            "GEMINI_TIMEOUT": status.HTTP_504_GATEWAY_TIMEOUT,
            "GEMINI_INVALID_RESPONSE": status.HTTP_502_BAD_GATEWAY,
            "GEMINI_SERVICE_UNAVAILABLE": status.HTTP_503_SERVICE_UNAVAILABLE,
            "GEMINI_PROVIDER_ERROR": status.HTTP_502_BAD_GATEWAY,
        }.get(str(exc), status.HTTP_502_BAD_GATEWAY)
        raise HTTPException(status_code=error_status, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    return JobExtractionResponse(parsed_data=extraction)