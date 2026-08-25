"""Business logic for employer-owned job sites."""

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from app.core.supabase import supabase
from app.schemas.auth import UserResponse
from app.schemas.job_site import JobSiteCreate, JobSiteResponse


class JobSiteNotFound(Exception):
    """The site does not exist or is not owned by the current employer."""


class JobSiteHasJobs(Exception):
    """The site is referenced by an existing job."""


class JobSiteService:
    """Owns site persistence and owner-scoped access."""

    @staticmethod
    def _employer_id(user: UserResponse) -> str:
        employer_response = (
            supabase.table("employer_profiles")
            .select("id, user_id, onboarding_status")
            .eq("user_id", user.id)
            .single()
            .execute()
        )
        employer = employer_response.data or {}
        if not employer.get("id"):
            raise JobSiteNotFound("EMPLOYER_NOT_FOUND")
        if employer.get("onboarding_status") != "COMPLETED":
            raise PermissionError("EMPLOYER_ONBOARDING_INCOMPLETE")
        return str(employer["id"])

    @staticmethod
    def _to_response(row: dict[str, Any]) -> JobSiteResponse:
        location = row.get("location") or {}
        if isinstance(location, dict):
            coordinates = location.get("coordinates") or []
            longitude, latitude = coordinates[:2]
        else:
            coordinates = str(location).removeprefix("POINT(").removesuffix(")").split()
            longitude, latitude = (float(coordinates[0]), float(coordinates[1]))
        return JobSiteResponse(
            id=str(row["id"]),
            employer_id=str(row["employer_id"]),
            name=row["name"],
            latitude=float(latitude),
            longitude=float(longitude),
            created_at=row["created_at"],
            updated_at=row.get("updated_at"),
        )

    @classmethod
    def create(cls, user: UserResponse, request: JobSiteCreate) -> JobSiteResponse:
        employer_id = cls._employer_id(user)
        payload = {
            "id": str(uuid4()),
            "employer_id": employer_id,
            "name": request.name.strip(),
            "location": f"POINT({request.longitude} {request.latitude})",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        response = supabase.table("job_sites").insert(payload).execute()
        if not response.data:
            raise RuntimeError("JOB_SITE_CREATE_FAILED")
        return cls._to_response(response.data[0])

    @classmethod
    def list_for_user(cls, user: UserResponse) -> list[JobSiteResponse]:
        employer_id = cls._employer_id(user)
        response = (
            supabase.table("job_sites")
            .select("*")
            .eq("employer_id", employer_id)
            .order("created_at", desc=True)
            .execute()
        )
        return [cls._to_response(row) for row in (response.data or [])]

    @classmethod
    def delete(cls, user: UserResponse, site_id: str) -> None:
        employer_id = cls._employer_id(user)
        site_response = (
            supabase.table("job_sites")
            .select("id")
            .eq("id", site_id)
            .eq("employer_id", employer_id)
            .single()
            .execute()
        )
        if not site_response.data:
            raise JobSiteNotFound("JOB_SITE_NOT_FOUND")

        jobs_response = (
            supabase.table("jobs")
            .select("id")
            .eq("job_site_id", site_id)
            .limit(1)
            .execute()
        )
        if jobs_response.data:
            raise JobSiteHasJobs("JOB_SITE_HAS_JOBS")

        response = (
            supabase.table("job_sites")
            .delete()
            .eq("id", site_id)
            .eq("employer_id", employer_id)
            .execute()
        )
        if not response.data:
            raise JobSiteNotFound("JOB_SITE_NOT_FOUND")