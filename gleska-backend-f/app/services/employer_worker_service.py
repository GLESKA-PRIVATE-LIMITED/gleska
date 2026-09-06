from typing import Any

from app.core.supabase import supabase
from app.schemas.employer_worker import EmployerWorkerListResponse, EmployerWorkerResponse
from app.services.profile_photo_service import get_signed_profile_photo_url


class EmployerWorkerService:
    MAX_LIMIT = 100
    SORTS = {"name_asc", "name_desc", "experience_desc", "wage_asc", "wage_desc"}

    @classmethod
    def list_workers(
        cls,
        *,
        page: int,
        limit: int,
        search: str | None = None,
        trade: str | None = None,
        skill: str | None = None,
        min_experience: int | None = None,
        max_experience: int | None = None,
        min_wage: float | None = None,
        max_wage: float | None = None,
        availability: str | None = None,
        city: str | None = None,
        sort: str = "name_asc",
        worker_id: str | None = None,
    ) -> EmployerWorkerListResponse | EmployerWorkerResponse | None:
        response = supabase.rpc("list_employer_workers", {
            "p_page": page,
            "p_limit": limit,
            "p_search": search,
            "p_trade": trade,
            "p_skill": skill,
            "p_min_experience": min_experience,
            "p_max_experience": max_experience,
            "p_min_wage": min_wage,
            "p_max_wage": max_wage,
            "p_availability": availability,
            "p_city": city,
            "p_sort": sort,
            "p_worker_id": worker_id,
        }).execute()
        rows = response.data or []
        if worker_id:
            return cls._item(rows[0]) if rows else None

        items = [cls._item(row) for row in rows]
        total = int(rows[0].get("total_count") or 0) if rows else 0
        return EmployerWorkerListResponse(
            items=items,
            page=page,
            limit=limit,
            total=total,
            has_more=page * limit < total,
        )

    @staticmethod
    def _item(row: dict[str, Any]) -> EmployerWorkerResponse:
        return EmployerWorkerResponse(
            worker_profile_id=str(row["worker_profile_id"]),
            name=row["name"],
            profile_photo_url=get_signed_profile_photo_url(row.get("profile_photo_path")),
            trade_id=row.get("trade_id"),
            skills=row.get("skills") or [],
            experience_years=row.get("experience_years"),
            expected_daily_wage=row.get("expected_daily_wage"),
            availability_status=row["availability_status"],
            city=row.get("city"),
            state=row.get("state"),
            profile_completed=bool(row.get("profile_completed")),
            is_verified=bool(row.get("is_verified")),
        )