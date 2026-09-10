from datetime import datetime, timezone
from typing import Any

from app.core.supabase import supabase
from app.schemas.employer_worker import EmployerWorkerAttendanceResponse, EmployerWorkerListResponse, EmployerWorkerResponse
from app.services.profile_photo_service import get_signed_profile_photo_url


class EmployerWorkerService:
    MAX_LIMIT = 100
    SORTS = {"name_asc", "name_desc", "experience_desc", "wage_asc", "wage_desc"}

    @classmethod
    def list_workers(
        cls,
        *,
        user_id: str,
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
        employer_response = (
            supabase.table("employer_profiles")
            .select("id")
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
        employer = employer_response.data or {}
        if not employer.get("id"):
            return None if worker_id else EmployerWorkerListResponse(items=[], page=page, limit=limit, total=0, has_more=False)

        query = supabase.table("job_matches").select(
            "id,status,created_at,expires_at,completed_at,"
            "worker_profiles!inner(id,trade_id,skills,experience_years,expected_daily_wage,"
            "availability_status,city,state,profile_completed,is_verified,users!inner(name,profile_photo_path)),"
            "jobs!inner(id,title,status,job_site_id,employer_id,"
            "job_sites!inner(id,name,address,city,state,pincode)),"
            "attendance(id,attendance_date,status,check_in_at,check_out_at)",
            count="exact",
        ).eq("jobs.employer_id", employer["id"])
        if worker_id:
            query = query.eq("worker_profiles.id", worker_id)
        if search:
            escaped = search.replace("%", "\\%").replace("_", "\\_")
            query = query.or_(f"users.name.ilike.%{escaped}%,trade_id.ilike.%{escaped}%,skills.cs.{{{escaped}}}", reference_table="worker_profiles")
        if trade:
            query = query.ilike("worker_profiles.trade_id", trade)
        if skill:
            query = query.contains("worker_profiles.skills", [skill])
        if min_experience is not None:
            query = query.gte("worker_profiles.experience_years", min_experience)
        if max_experience is not None:
            query = query.lte("worker_profiles.experience_years", max_experience)
        if min_wage is not None:
            query = query.gte("worker_profiles.expected_daily_wage", min_wage)
        if max_wage is not None:
            query = query.lte("worker_profiles.expected_daily_wage", max_wage)
        if availability:
            query = query.eq("worker_profiles.availability_status", availability)
        if city:
            query = query.ilike("worker_profiles.city", city)

        order_column = {
            "experience_desc": "experience_years",
            "wage_asc": "expected_daily_wage",
            "wage_desc": "expected_daily_wage",
        }.get(sort)
        if order_column:
            query = query.order(order_column, foreign_table="worker_profiles", desc=sort.endswith("desc"), nullsfirst=False)
        else:
            query = query.order("name", foreign_table="worker_profiles.users", desc=sort == "name_desc")
        if worker_id:
            query = query.limit(100)
        else:
            offset = (page - 1) * limit
            query = query.range(offset, offset + limit - 1)
        response = query.execute()
        rows = response.data or []
        if worker_id:
            return cls._item(rows[0]) if rows else None

        items = [cls._item(row) for row in rows]
        total = int(getattr(response, "count", None) or 0)
        return EmployerWorkerListResponse(
            items=items,
            page=page,
            limit=limit,
            total=total,
            has_more=page * limit < total,
        )

    @classmethod
    def _item(cls, row: dict[str, Any]) -> EmployerWorkerResponse:
        profile = row.get("worker_profiles") or {}
        user = profile.get("users") or {}
        job = row.get("jobs") or {}
        site = job.get("job_sites") or {}
        attendance = []
        for record in row.get("attendance") or []:
            check_in = record.get("check_in_at")
            check_out = record.get("check_out_at")
            duration = None
            if check_in and check_out:
                duration = max(0, round((cls._as_datetime(check_out) - cls._as_datetime(check_in)).total_seconds() / 60))
            attendance.append(EmployerWorkerAttendanceResponse(
                attendance_date=record["attendance_date"],
                status=record["status"],
                check_in_at=check_in,
                check_out_at=check_out,
                duration_minutes=duration,
            ))
        return EmployerWorkerResponse(
            worker_profile_id=str(profile["id"]),
            name=user.get("name") or "Worker",
            profile_photo_url=get_signed_profile_photo_url(user.get("profile_photo_path")),
            trade_id=profile.get("trade_id"),
            skills=profile.get("skills") or [],
            experience_years=profile.get("experience_years"),
            expected_daily_wage=profile.get("expected_daily_wage"),
            availability_status=profile.get("availability_status") or "OFFLINE",
            city=profile.get("city"),
            state=profile.get("state"),
            profile_completed=bool(profile.get("profile_completed")),
            is_verified=bool(profile.get("is_verified")),
            job_id=str(job["id"]),
            job_title=job["title"],
            job_status=job["status"],
            match_status=row["status"],
            match_created_at=row["created_at"],
            match_expires_at=row["expires_at"],
            completed_at=row.get("completed_at"),
            job_site_id=str(site["id"]),
            site_name=site["name"],
            site_address=site.get("address"),
            site_city=site.get("city"),
            site_state=site.get("state"),
            site_pincode=site.get("pincode"),
            attendance=attendance,
        )

    @staticmethod
    def _as_datetime(value: datetime | str) -> datetime:
        parsed = value if isinstance(value, datetime) else datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)