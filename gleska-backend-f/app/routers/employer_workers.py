import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from uuid import UUID

from app.core.security import require_employer
from app.schemas.auth import UserResponse
from app.schemas.employer_worker import EmployerWorkerListResponse, EmployerWorkerResponse
from app.services.employer_worker_service import EmployerWorkerService

router = APIRouter(prefix="/employers/me/workers", tags=["employer-workers"])
logger = logging.getLogger(__name__)


@router.get("", response_model=EmployerWorkerListResponse)
async def list_employer_workers(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    search: str | None = Query(default=None, max_length=120),
    trade: str | None = Query(default=None, max_length=120),
    skill: str | None = Query(default=None, max_length=120),
    min_experience: float | None = Query(default=None, ge=0, le=100),
    max_experience: float | None = Query(default=None, ge=0, le=100),
    min_wage: float | None = Query(default=None, ge=0),
    max_wage: float | None = Query(default=None, ge=0),
    availability: str | None = Query(default=None, pattern="^(AVAILABLE|ON_JOB|OFFLINE)$"),
    city: str | None = Query(default=None, max_length=120),
    sort: str = Query(default="name_asc", pattern="^(name_asc|name_desc|experience_desc|wage_asc|wage_desc)$"),
    user: UserResponse = Depends(require_employer),
):
    if min_experience is not None and max_experience is not None and min_experience > max_experience:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="MIN_EXPERIENCE_GREATER_THAN_MAX")
    if min_wage is not None and max_wage is not None and min_wage > max_wage:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="MIN_WAGE_GREATER_THAN_MAX")
    try:
        return EmployerWorkerService.list_workers(
            user_id=user.id,
            page=page, limit=limit, search=search, trade=trade, skill=skill,
            min_experience=min_experience, max_experience=max_experience,
            min_wage=min_wage, max_wage=max_wage, availability=availability,
            city=city, sort=sort,
        )
    except Exception as exc:
        logger.exception("Employer worker history failed: user_id=%s page=%s limit=%s", user.id, page, limit)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="WORKER_DIRECTORY_FAILED") from exc


@router.get("/{worker_id}", response_model=EmployerWorkerResponse)
async def get_employer_worker(worker_id: UUID, user: UserResponse = Depends(require_employer)):
    try:
        worker = EmployerWorkerService.list_workers(user_id=user.id, page=1, limit=100, worker_id=str(worker_id))
    except Exception as exc:
        logger.exception("Employer worker detail failed: user_id=%s worker_id=%s", user.id, worker_id)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="WORKER_DIRECTORY_FAILED") from exc
    if worker is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="WORKER_NOT_FOUND")
    return worker