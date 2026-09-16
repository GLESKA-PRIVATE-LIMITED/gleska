"""Internal admin endpoints backed by the existing platform tables."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator

from app.core.security import require_admin
from app.core.supabase import supabase
from app.schemas.auth import UserResponse
from app.services.auth_service import AuthService
from app.services.matching_service import MatchingError, MatchingService
from app.services.document_service import WORKER_DOCUMENTS_BUCKET, WorkerDocumentService
from app.services.profile_photo_service import get_signed_profile_photo_url, now_iso

router = APIRouter(prefix="/admin", tags=["admin"])
audit_logger = logging.getLogger("admin.audit")
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class AdminWorkerItem(BaseModel):
    id: str  # worker_profiles.id
    user_id: str
    name: Optional[str] = None
    mobile: Optional[str] = None
    email: Optional[str] = None
    trade_id: Optional[str] = None
    skills: Optional[list[str]] = None
    experience_years: Optional[int] = None
    expected_daily_wage: Optional[float] = None
    availability_status: str
    is_verified: bool
    is_active: bool
    profile_completed: bool
    onboarding_status: str
    city: Optional[str] = None
    state: Optional[str] = None
    profile_photo_url: Optional[str] = None
    created_at: datetime


class AdminWorkerListResponse(BaseModel):
    items: list[AdminWorkerItem]
    total: int
    page: int
    page_size: int
    total_pages: int


class AdminWorkerDocumentItem(BaseModel):
    id: str
    worker_profile_id: str
    document_type: str
    original_filename: str
    mime_type: str
    file_size_bytes: int
    uploaded_at: datetime
    view_url: Optional[str] = None


class AdminWorkerDetailResponse(BaseModel):
    id: str  # worker_profiles.id
    user_id: str
    name: Optional[str] = None
    mobile: Optional[str] = None
    email: Optional[str] = None
    role: str = "WORKER"
    is_active: bool = True
    is_mobile_verified: bool = False
    profile_photo_url: Optional[str] = None

    # Work & Profile Details
    trade_id: Optional[str] = None
    skills: Optional[list[str]] = None
    experience_years: Optional[int] = None
    expected_daily_wage: Optional[float] = None
    availability_status: str = "OFFLINE"
    is_verified: bool = False
    profile_completed: bool = False
    onboarding_status: str = "NOT_STARTED"
    overall_rating: float = 5.0
    total_jobs: int = 0
    marital_status: Optional[str] = None
    blood_group: Optional[str] = None

    # Location Details
    city: Optional[str] = None
    state: Optional[str] = None
    address: Optional[str] = None
    pincode: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None

    # Metadata & Timestamps
    created_at: datetime
    updated_at: datetime

    # Private Documents with short-lived signed URLs
    documents: list[AdminWorkerDocumentItem] = []

    # Job Match Metrics
    total_matches: int = 0


class AdminWorkerVerificationRequest(BaseModel):
    action: Literal["VERIFY", "REVOKE"]


class AdminWorkerStatusRequest(BaseModel):
    is_active: bool


class AdminWorkerUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=120)
    mobile: Optional[str] = Field(default=None, min_length=10, max_length=32)
    trade_id: Optional[str] = Field(default=None, min_length=1, max_length=120)
    experience_years: Optional[int] = Field(default=None, ge=0)
    expected_daily_wage: Optional[float] = Field(default=None, ge=0, le=1_000_000)
    availability_status: Optional[Literal["AVAILABLE", "ON_JOB", "OFFLINE"]] = None
    city: Optional[str] = None
    state: Optional[str] = None
    address: Optional[str] = Field(default=None, max_length=500)
    pincode: Optional[str] = Field(default=None, min_length=6, max_length=6)
    marital_status: Optional[str] = None
    blood_group: Optional[str] = None
    skills: Optional[list[str]] = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Name must not be empty")
        return trimmed

    @field_validator("trade_id")
    @classmethod
    def validate_trade_id(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Trade ID must not be blank")
        return trimmed

    @field_validator("marital_status")
    @classmethod
    def validate_marital_status(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        valid_values = {"Unmarried", "Married", "Divorced", "Widowed", "Separated"}
        if value not in valid_values:
            raise ValueError(f"marital_status must be one of {valid_values}")
        return value

    @field_validator("blood_group")
    @classmethod
    def validate_blood_group(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        valid_values = {"A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"}
        if value not in valid_values:
            raise ValueError(f"blood_group must be one of {valid_values}")
        return value


class AdminEmployerItem(BaseModel):
    id: str  # canonical employer_profiles.id
    user_id: str
    name: Optional[str] = None
    mobile: Optional[str] = None
    email: Optional[str] = None
    contact_person_name: Optional[str] = None
    business_name: Optional[str] = None
    employer_type: Optional[str] = None
    onboarding_status: str = "NOT_STARTED"
    verification_status: str = "PENDING"
    is_active: bool = True
    city: Optional[str] = None
    state: Optional[str] = None
    created_at: str


class AdminEmployerListResponse(BaseModel):
    items: list[AdminEmployerItem]
    total: int
    page: int
    page_size: int
    total_pages: int


class AdminEmployerVerificationItem(BaseModel):
    id: str
    verification_type: str
    status: str
    provider_reference_id: Optional[str] = None
    failure_reason: Optional[str] = None
    verified_at: Optional[str] = None
    created_at: str


class AdminEmployerDetailResponse(BaseModel):
    id: str
    user_id: str
    name: Optional[str] = None
    mobile: Optional[str] = None
    email: Optional[str] = None
    role: str = "EMPLOYER"
    is_active: bool = True
    is_mobile_verified: bool = False
    created_at: str
    updated_at: Optional[str] = None

    # Profile fields
    contact_person_name: Optional[str] = None
    employer_type: Optional[str] = None
    onboarding_status: str = "NOT_STARTED"
    verification_status: str = "PENDING"
    subscription_valid_until: Optional[str] = None
    has_availed_free_dispatch: bool = False

    # Onboarding / Business Details
    business_name: Optional[str] = None
    business_type: Optional[str] = None
    business_category: Optional[str] = None
    industry_category: Optional[str] = None
    industry_type: Optional[str] = None
    registered_address: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    pincode: Optional[str] = None
    gstin: Optional[str] = None
    pan_number: Optional[str] = None
    cin_number: Optional[str] = None
    udyam_number: Optional[str] = None
    registration_number: Optional[str] = None
    work_location: Optional[str] = None
    website_url: Optional[str] = None
    description: Optional[str] = None
    nature_of_business: Optional[str] = None
    annual_revenue: Optional[str] = None
    number_of_proprietors: Optional[int] = None
    company_email: Optional[str] = None
    company_phone: Optional[str] = None
    proprietor_name: Optional[str] = None
    director_name: Optional[str] = None
    director_phone: Optional[str] = None
    director_email: Optional[str] = None
    director_address: Optional[str] = None
    business_document_url: Optional[str] = None
    hiring_mode: Optional[str] = None
    bank_account_holder_name: Optional[str] = None
    bank_ifsc: Optional[str] = None
    bank_account_number: Optional[str] = None

    # Verification records
    verifications: list[AdminEmployerVerificationItem] = []

    # Live aggregated counts (queried only for single detail view)
    total_jobs: int = 0
    active_jobs: int = 0
    total_job_sites: int = 0


class AdminEmployerStatusRequest(BaseModel):
    is_active: bool


class AdminEmployerUpdateRequest(BaseModel):
    name: Optional[str] = None
    mobile: Optional[str] = None
    contact_person_name: Optional[str] = None
    employer_type: Optional[str] = None
    business_name: Optional[str] = None
    business_type: Optional[str] = None
    business_category: Optional[str] = None
    industry_category: Optional[str] = None
    industry_type: Optional[str] = None
    registered_address: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    pincode: Optional[str] = None
    gstin: Optional[str] = None
    pan_number: Optional[str] = None
    cin_number: Optional[str] = None
    udyam_number: Optional[str] = None
    registration_number: Optional[str] = None
    work_location: Optional[str] = None
    website_url: Optional[str] = None
    description: Optional[str] = None
    nature_of_business: Optional[str] = None
    annual_revenue: Optional[str] = None
    number_of_proprietors: Optional[int] = None
    company_email: Optional[str] = None
    company_phone: Optional[str] = None
    proprietor_name: Optional[str] = None
    director_name: Optional[str] = None
    director_phone: Optional[str] = None
    director_email: Optional[str] = None
    director_address: Optional[str] = None

    @field_validator("employer_type")
    @classmethod
    def validate_employer_type(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        valid_types = {"REGISTERED_INDUSTRY", "REGISTERED_BUSINESS", "UNREGISTERED_BUSINESS", "INDIVIDUAL"}
        if value not in valid_types:
            raise ValueError(f"employer_type must be one of {valid_types}")
        return value



# ---------------------------------------------------------------------------
# Audit Logging Helper
# ---------------------------------------------------------------------------

def log_admin_mutation(
    admin: UserResponse,
    target_user_id: str,
    event_type: str,
    description: str,
) -> None:
    """Record an administrative audit event in public.security_activity and the server log."""
    audit_logger.info(
        "ADMIN_AUDIT: admin_id=%s admin_email=%s target_user_id=%s event=%s desc=%s",
        admin.id,
        admin.email,
        target_user_id,
        event_type,
        description,
    )
    try:
        supabase.table("security_activity").insert({
            "user_id": target_user_id,
            "event_type": event_type,
            "description": f"[Admin: {admin.name or admin.email or admin.id}] {description}",
            "device_name": "Admin Operations Portal",
            "browser": "Gleska Admin Shell",
        }).execute()
    except Exception as exc:  # pragma: no cover
        audit_logger.warning("Failed to persist audit log into security_activity: %s", exc)


def _safe_profile_photo_url(path: Optional[str]) -> Optional[str]:
    """Generate a signed profile photo URL safely without raising exceptions."""
    if not path:
        return None
    try:
        return get_signed_profile_photo_url(path)
    except Exception:
        return None


def _resolve_worker_profile(worker_id: str) -> dict[str, Any]:
    """Look up a worker profile by worker_profile_id or user_id."""
    res = (
        supabase.table("worker_profiles")
        .select("*, users!inner(*)")
        .eq("id", worker_id)
        .maybe_single()
        .execute()
    )
    if not res or not res.data:
        res = (
            supabase.table("worker_profiles")
            .select("*, users!inner(*)")
            .eq("user_id", worker_id)
            .maybe_single()
            .execute()
        )
    if not res or not res.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="WORKER_NOT_FOUND")

    user_info = res.data.get("users") or {}
    if user_info.get("role") != "WORKER":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="WORKER_NOT_FOUND")

    return res.data


def _resolve_employer_profile(employer_id: str) -> dict[str, Any]:
    """Look up an employer profile strictly by canonical employer_profiles.id.
    
    Verifies that the linked user account has role='EMPLOYER'.
    """
    res = (
        supabase.table("employer_profiles")
        .select("*, users!inner(*), employer_onboarding_details(*)")
        .eq("id", employer_id)
        .maybe_single()
        .execute()
    )
    if not res or not res.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="EMPLOYER_NOT_FOUND")

    user_info = res.data.get("users") or {}
    if user_info.get("role") != "EMPLOYER":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="EMPLOYER_NOT_FOUND")

    return res.data



# ---------------------------------------------------------------------------
# Existing Admin Overview Endpoint
# ---------------------------------------------------------------------------

@router.get("/overview")
async def get_admin_overview(
    user: UserResponse = Depends(require_admin),
    workers_limit: int = Query(default=5, ge=1, le=20),
    employers_limit: int = Query(default=5, ge=1, le=20),
    jobs_limit: int = Query(default=5, ge=1, le=20),
):
    """Return a compact admin dashboard snapshot using the live database tables."""
    del user

    try:
        workers_response = (
            supabase.table("worker_profiles")
            .select("id, user_id, availability_status, profile_completed, onboarding_status, created_at, users!inner(name, mobile, role)")
            .eq("users.role", "WORKER")
            .limit(workers_limit)
            .order("created_at", desc=True)
            .execute()
        )
        employers_response = (
            supabase.table("employer_profiles")
            .select("id, user_id, employer_type, onboarding_status, verification_status, contact_person_name, created_at, users!inner(name, mobile, role)")
            .eq("users.role", "EMPLOYER")
            .limit(employers_limit)
            .order("created_at", desc=True)
            .execute()
        )
        jobs_response = (
            supabase.table("jobs")
            .select("id, title, status, created_at, max_daily_salary, employer_id, employer_profiles(contact_person_name), job_sites(name)")
            .limit(jobs_limit)
            .order("created_at", desc=True)
            .execute()
        )

        total_workers = (
            supabase.table("worker_profiles")
            .select("id, users!inner(role)", count="exact")
            .eq("users.role", "WORKER")
            .execute()
        )
        total_employers = (
            supabase.table("employer_profiles")
            .select("id, users!inner(role)", count="exact")
            .eq("users.role", "EMPLOYER")
            .execute()
        )
        total_jobs = supabase.table("jobs").select("id", count="exact").execute()
        active_jobs = supabase.table("jobs").select("id", count="exact").eq("status", "SEARCHING").execute()
        pending_employers = (
            supabase.table("employer_profiles")
            .select("id, users!inner(role)", count="exact")
            .eq("users.role", "EMPLOYER")
            .eq("verification_status", "PENDING")
            .execute()
        )

        workers = workers_response.data or []
        employers = employers_response.data or []
        jobs = jobs_response.data or []

        return {
            "summary": {
                "total_workers": int((total_workers.count if hasattr(total_workers, "count") else 0) or 0),
                "total_employers": int((total_employers.count if hasattr(total_employers, "count") else 0) or 0),
                "total_jobs": int((total_jobs.count if hasattr(total_jobs, "count") else 0) or 0),
                "active_jobs": int((active_jobs.count if hasattr(active_jobs, "count") else 0) or 0),
                "pending_employers": int((pending_employers.count if hasattr(pending_employers, "count") else 0) or 0),
            },
            "workers": [
                {
                    "id": item.get("id"),
                    "name": (item.get("users") or {}).get("name") if isinstance(item.get("users"), dict) else None,
                    "mobile": (item.get("users") or {}).get("mobile") if isinstance(item.get("users"), dict) else None,
                    "availability_status": item.get("availability_status"),
                    "profile_completed": item.get("profile_completed"),
                    "onboarding_status": item.get("onboarding_status"),
                    "created_at": item.get("created_at"),
                }
                for item in workers
            ],
            "employers": [
                {
                    "id": item.get("id"),
                    "name": (item.get("users") or {}).get("name") if isinstance(item.get("users"), dict) else (item.get("contact_person_name") or "Unknown"),
                    "mobile": (item.get("users") or {}).get("mobile") if isinstance(item.get("users"), dict) else None,
                    "employer_type": item.get("employer_type"),
                    "onboarding_status": item.get("onboarding_status"),
                    "verification_status": item.get("verification_status"),
                    "contact_person_name": item.get("contact_person_name"),
                    "created_at": item.get("created_at"),
                }
                for item in employers
            ],
            "jobs": [
                {
                    "id": item.get("id"),
                    "title": item.get("title"),
                    "status": item.get("status"),
                    "max_daily_salary": item.get("max_daily_salary"),
                    "site_name": (item.get("job_sites") or {}).get("name") if isinstance(item.get("job_sites"), dict) else None,
                    "employer_name": (item.get("employer_profiles") or {}).get("contact_person_name") if isinstance(item.get("employer_profiles"), dict) else None,
                    "created_at": item.get("created_at"),
                }
                for item in jobs
            ],
        }
    except Exception as exc:  # pragma: no cover
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="ADMIN_DASHBOARD_FAILED",
        ) from exc


# ---------------------------------------------------------------------------
# Workers Module Endpoints
# ---------------------------------------------------------------------------

@router.get("/workers", response_model=AdminWorkerListResponse)
async def list_admin_workers(
    admin: UserResponse = Depends(require_admin),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
    search: Optional[str] = Query(default=None),
    availability: Optional[str] = Query(default=None),
    is_verified: Optional[bool] = Query(default=None),
    is_active: Optional[bool] = Query(default=None),
    sort_by: str = Query(default="created_at"),
    sort_order: str = Query(default="desc"),
):
    """List workers with real-time filtering, search across name/mobile/trade, and pagination."""
    del admin

    try:
        # Normalize parameters safely
        page_val = page if isinstance(page, int) else 1
        page_size_val = page_size if isinstance(page_size, int) else 10
        search_term = search.strip() if isinstance(search, str) and search.strip() else None
        availability_val = availability.strip().upper() if isinstance(availability, str) and availability.strip() else None
        is_verified_val = is_verified if isinstance(is_verified, bool) else None
        is_active_val = is_active if isinstance(is_active, bool) else None
        sort_by_val = sort_by.strip().lower() if isinstance(sort_by, str) and sort_by.strip() else "created_at"
        sort_order_val = sort_order.strip().lower() if isinstance(sort_order, str) and sort_order.strip() else "desc"

        # Base query
        select_clause = (
            "id, user_id, trade_id, skills, experience_years, expected_daily_wage, "
            "availability_status, is_verified, profile_completed, onboarding_status, "
            "city, state, created_at, users!inner(id, name, mobile, email, role, is_active, profile_photo_path)"
        )
        query = supabase.table("worker_profiles").select(select_clause, count="exact")
        query = query.eq("users.role", "WORKER")

        # 1. Multi-field Search Handling (name, mobile, trade_id)
        if search_term:
            # Match user name or mobile
            users_match = (
                supabase.table("users")
                .select("id")
                .eq("role", "WORKER")
                .or_(f"name.ilike.%{search_term}%,mobile.ilike.%{search_term}%")
                .execute()
            )
            matching_user_ids = [u["id"] for u in (users_match.data or [])]

            # Match worker profile trade_id
            wp_match = (
                supabase.table("worker_profiles")
                .select("id, user_id")
                .ilike("trade_id", f"%{search_term}%")
                .execute()
            )
            matching_wp_ids = {w["id"] for w in (wp_match.data or [])}

            # If users matched, find their worker_profile IDs
            if matching_user_ids:
                user_wp = (
                    supabase.table("worker_profiles")
                    .select("id")
                    .in_("user_id", matching_user_ids)
                    .execute()
                )
                for w in (user_wp.data or []):
                    matching_wp_ids.add(w["id"])

            if not matching_wp_ids:
                # No records match the search term
                return AdminWorkerListResponse(
                    items=[],
                    total=0,
                    page=page_val,
                    page_size=page_size_val,
                    total_pages=0,
                )

            query = query.in_("id", list(matching_wp_ids))

        # 2. Filters
        if availability_val:
            query = query.eq("availability_status", availability_val)

        if is_verified_val is not None:
            query = query.eq("is_verified", is_verified_val)

        if is_active_val is not None:
            query = query.eq("users.is_active", is_active_val)

        # 3. Sorting
        desc = (sort_order_val == "desc")
        if sort_by_val == "name":
            query = query.order("name", foreign_table="users", desc=desc).order("id", desc=desc)
        elif sort_by_val == "experience_years":
            query = query.order("experience_years", desc=desc).order("id", desc=desc)
        else:
            query = query.order("created_at", desc=desc).order("id", desc=desc)

        # 4. Pagination
        start = (page_val - 1) * page_size_val
        end = start + page_size_val - 1
        query = query.range(start, end)

        response = query.execute()
        data = response.data or []
        total = int(response.count or 0)
        total_pages = (total + page_size_val - 1) // page_size_val if total > 0 else 0

        items: list[AdminWorkerItem] = []
        for row in data:
            user_info = row.get("users") or {}
            items.append(
                AdminWorkerItem(
                    id=row["id"],
                    user_id=row["user_id"],
                    name=user_info.get("name"),
                    mobile=user_info.get("mobile"),
                    email=user_info.get("email"),
                    trade_id=row.get("trade_id"),
                    skills=row.get("skills"),
                    experience_years=row.get("experience_years"),
                    expected_daily_wage=float(row["expected_daily_wage"]) if row.get("expected_daily_wage") is not None else None,
                    availability_status=row.get("availability_status") or "OFFLINE",
                    is_verified=bool(row.get("is_verified", False)),
                    is_active=bool(user_info.get("is_active", True)),
                    profile_completed=bool(row.get("profile_completed", False)),
                    onboarding_status=row.get("onboarding_status") or "NOT_STARTED",
                    city=row.get("city"),
                    state=row.get("state"),
                    profile_photo_url=_safe_profile_photo_url(user_info.get("profile_photo_path")),
                    created_at=row["created_at"],
                )
            )

        return AdminWorkerListResponse(
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            total_pages=total_pages,
        )

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Admin list workers error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="ADMIN_WORKERS_FETCH_FAILED",
        ) from exc


@router.get("/workers/{worker_id}", response_model=AdminWorkerDetailResponse)
async def get_admin_worker_details(
    worker_id: str,
    admin: UserResponse = Depends(require_admin),
):
    """Retrieve full worker profile, account details, and private documents with short-lived signed URLs."""
    del admin

    worker_row = _resolve_worker_profile(worker_id)
    user_row = worker_row.get("users") or {}
    worker_profile_id = worker_row["id"]

    # 1. Fetch private documents and generate short-lived signed URLs (15 minutes)
    doc_service = WorkerDocumentService(supabase, supabase)
    docs_response = (
        supabase.table("worker_documents")
        .select("*")
        .eq("worker_profile_id", worker_profile_id)
        .order("uploaded_at", desc=True)
        .execute()
    )
    raw_docs = docs_response.data or []

    document_items: list[AdminWorkerDocumentItem] = []
    for doc in raw_docs:
        signed_url: Optional[str] = None
        try:
            signed_url = await doc_service.get_document_view_url(worker_profile_id, doc["id"])
        except Exception as doc_exc:
            logger.warning("Could not create signed URL for doc %s: %s", doc.get("id"), doc_exc)

        document_items.append(
            AdminWorkerDocumentItem(
                id=doc["id"],
                worker_profile_id=doc["worker_profile_id"],
                document_type=doc["document_type"],
                original_filename=doc["original_filename"],
                mime_type=doc["mime_type"],
                file_size_bytes=int(doc.get("file_size_bytes") or 0),
                uploaded_at=doc["uploaded_at"],
                view_url=signed_url,
            )
        )

    # 2. Fetch matched jobs count
    matches_count_res = (
        supabase.table("job_matches")
        .select("id", count="exact")
        .eq("worker_profile_id", worker_profile_id)
        .execute()
    )
    total_matches = int((matches_count_res.count if hasattr(matches_count_res, "count") else 0) or 0)

    return AdminWorkerDetailResponse(
        id=worker_profile_id,
        user_id=worker_row["user_id"],
        name=user_row.get("name"),
        mobile=user_row.get("mobile"),
        email=user_row.get("email"),
        role=user_row.get("role") or "WORKER",
        is_active=bool(user_row.get("is_active", True)),
        is_mobile_verified=bool(user_row.get("is_mobile_verified", False)),
        profile_photo_url=_safe_profile_photo_url(user_row.get("profile_photo_path")),
        trade_id=worker_row.get("trade_id"),
        skills=worker_row.get("skills"),
        experience_years=worker_row.get("experience_years"),
        expected_daily_wage=float(worker_row["expected_daily_wage"]) if worker_row.get("expected_daily_wage") is not None else None,
        availability_status=worker_row.get("availability_status") or "OFFLINE",
        is_verified=bool(worker_row.get("is_verified", False)),
        profile_completed=bool(worker_row.get("profile_completed", False)),
        onboarding_status=worker_row.get("onboarding_status") or "NOT_STARTED",
        overall_rating=float(worker_row.get("overall_rating") or 5.0),
        total_jobs=int(worker_row.get("total_jobs") or 0),
        marital_status=worker_row.get("marital_status"),
        blood_group=worker_row.get("blood_group"),
        city=worker_row.get("city"),
        state=worker_row.get("state"),
        address=worker_row.get("address"),
        pincode=worker_row.get("pincode"),
        latitude=float(worker_row["latitude"]) if worker_row.get("latitude") is not None else None,
        longitude=float(worker_row["longitude"]) if worker_row.get("longitude") is not None else None,
        created_at=worker_row["created_at"],
        updated_at=worker_row.get("updated_at") or worker_row["created_at"],
        documents=document_items,
        total_matches=total_matches,
    )


@router.get("/workers/{worker_id}/documents/{document_id}/url")
async def get_admin_worker_document_url(
    worker_id: str,
    document_id: str,
    admin: UserResponse = Depends(require_admin),
):
    """Generate an on-demand short-lived signed URL for an admin to view a worker document."""
    del admin

    worker_row = _resolve_worker_profile(worker_id)
    worker_profile_id = worker_row["id"]

    # 1. Fetch document record and verify ownership
    doc_res = (
        supabase.table("worker_documents")
        .select("id, worker_profile_id, document_type, original_filename, mime_type, storage_path")
        .eq("id", document_id)
        .eq("worker_profile_id", worker_profile_id)
        .maybe_single()
        .execute()
    )
    if not doc_res or not doc_res.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="DOCUMENT_NOT_FOUND",
        )
    doc = doc_res.data

    # 2. Generate fresh short-lived signed URL (15 minutes)
    doc_service = WorkerDocumentService(supabase, supabase)
    try:
        view_url = await doc_service.get_document_view_url(worker_profile_id, document_id)
    except Exception as exc:
        logger.exception("Failed to generate signed URL for document %s: %s", document_id, exc)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="DOCUMENT_STORAGE_NOT_FOUND",
        ) from exc

    return {
        "document_id": document_id,
        "worker_profile_id": worker_profile_id,
        "original_filename": doc["original_filename"],
        "mime_type": doc["mime_type"],
        "document_type": doc["document_type"],
        "url": view_url,
        "expires_in": 900,
    }


@router.patch("/workers/{worker_id}/verify")
async def verify_admin_worker(
    worker_id: str,
    payload: AdminWorkerVerificationRequest,
    admin: UserResponse = Depends(require_admin),
):
    """Explicit administrative action to verify or revoke verification for a worker profile."""
    worker_row = _resolve_worker_profile(worker_id)
    profile_id = worker_row["id"]
    target_user_id = worker_row["user_id"]
    prev_verified = bool(worker_row.get("is_verified", False))
    new_verified = (payload.action == "VERIFY")

    if prev_verified == new_verified:
        return {
            "id": profile_id,
            "user_id": target_user_id,
            "is_verified": new_verified,
            "message": f"Worker verification already set to {new_verified}",
        }

    updated_time = now_iso()
    supabase.table("worker_profiles").update({
        "is_verified": new_verified,
        "updated_at": updated_time,
    }).eq("id", profile_id).execute()

    event_type = "ADMIN_WORKER_VERIFIED" if new_verified else "ADMIN_WORKER_REVOKED"
    desc = f"Verification updated: action={payload.action}, previous={prev_verified}, new={new_verified}"
    log_admin_mutation(admin, target_user_id, event_type, desc)

    return {
        "id": profile_id,
        "user_id": target_user_id,
        "is_verified": new_verified,
        "updated_at": updated_time,
    }


@router.patch("/workers/{worker_id}/status")
async def update_admin_worker_status(
    worker_id: str,
    payload: AdminWorkerStatusRequest,
    admin: UserResponse = Depends(require_admin),
):
    """Explicit administrative action to activate or deactivate a worker user account."""
    worker_row = _resolve_worker_profile(worker_id)
    profile_id = worker_row["id"]
    target_user_id = worker_row["user_id"]
    user_row = worker_row.get("users") or {}
    prev_active = bool(user_row.get("is_active", True))
    new_active = payload.is_active

    if prev_active == new_active:
        return {
            "id": profile_id,
            "user_id": target_user_id,
            "is_active": new_active,
            "message": f"Worker active state already set to {new_active}",
        }

    updated_time = now_iso()
    supabase.table("users").update({
        "is_active": new_active,
        "updated_at": updated_time,
    }).eq("id", target_user_id).execute()

    event_type = "ADMIN_WORKER_ACTIVATED" if new_active else "ADMIN_WORKER_DEACTIVATED"
    desc = f"Account status updated: previous={prev_active}, new={new_active}"
    log_admin_mutation(admin, target_user_id, event_type, desc)

    return {
        "id": profile_id,
        "user_id": target_user_id,
        "is_active": new_active,
        "updated_at": updated_time,
    }


@router.patch("/workers/{worker_id}", response_model=AdminWorkerDetailResponse)
async def update_admin_worker_profile(
    worker_id: str,
    payload: AdminWorkerUpdateRequest,
    admin: UserResponse = Depends(require_admin),
):
    """Update safe worker profile fields while prohibiting modification of IDs, roles, credentials, and timestamps."""
    worker_row = _resolve_worker_profile(worker_id)
    profile_id = worker_row["id"]
    target_user_id = worker_row["user_id"]

    values = payload.model_dump(exclude_none=True)
    if not values:
        return await get_admin_worker_details(profile_id, admin)

    user_updates: dict[str, Any] = {}
    if "name" in values:
        user_updates["name"] = values.pop("name")
    if "mobile" in values:
        user_updates["mobile"] = AuthService.normalize_mobile(values.pop("mobile"))

    profile_updates = values
    updated_fields = list(user_updates.keys()) + list(profile_updates.keys())

    # Execute user table updates
    if user_updates:
        user_updates["updated_at"] = now_iso()
        supabase.table("users").update(user_updates).eq("id", target_user_id).execute()

    # Recalculate profile_completed state if profile fields or user contact changes
    merged_profile = {**worker_row, **profile_updates}
    has_name = bool(user_updates.get("name") or worker_row.get("users", {}).get("name"))
    has_mobile = bool(user_updates.get("mobile") or worker_row.get("users", {}).get("mobile"))
    has_trade = bool(merged_profile.get("trade_id") and str(merged_profile.get("trade_id")).strip())
    has_exp = merged_profile.get("experience_years") is not None
    has_wage = merged_profile.get("expected_daily_wage") is not None
    has_loc = bool(
        (merged_profile.get("city") and str(merged_profile.get("city")).strip())
        or (merged_profile.get("address") and str(merged_profile.get("address")).strip())
    )
    avail = merged_profile.get("availability_status")
    has_avail = bool(avail and avail != "OFFLINE")

    profile_updates["profile_completed"] = all([
        has_name,
        has_mobile,
        has_trade,
        has_exp,
        has_wage,
        has_loc,
        has_avail,
    ])
    profile_updates["onboarding_status"] = "COMPLETED" if profile_updates["profile_completed"] else "IN_PROGRESS"
    profile_updates["updated_at"] = now_iso()

    supabase.table("worker_profiles").update(profile_updates).eq("id", profile_id).execute()

    if any(field in profile_updates for field in (
        "profile_completed", "availability_status", "trade_id", "skills",
        "experience_years", "expected_daily_wage", "latitude", "longitude",
    )):
        try:
            MatchingService.reconcile_worker(profile_id, "ADMIN_WORKER_PROFILE_UPDATED")
        except MatchingError:
            logger.exception("Admin worker candidate reconciliation failed: worker_profile_id=%s", profile_id)

    # Audit logging
    log_admin_mutation(
        admin,
        target_user_id,
        "ADMIN_WORKER_PROFILE_EDIT",
        f"Safe profile edited: modified_fields=[{', '.join(updated_fields)}]",
    )

    return await get_admin_worker_details(profile_id, admin)


# ---------------------------------------------------------------------------
# Employers Module Endpoints
# ---------------------------------------------------------------------------

@router.get("/employers", response_model=AdminEmployerListResponse)
async def list_admin_employers(
    admin: UserResponse = Depends(require_admin),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
    search: Optional[str] = Query(default=None),
    onboarding_status: Optional[str] = Query(default=None),
    is_active: Optional[bool] = Query(default=None),
    employer_type: Optional[str] = Query(default=None),
    verification_status: Optional[str] = Query(default=None),
    sort_by: str = Query(default="created_at"),
    sort_order: str = Query(default="desc"),
):
    """List employers with server-side filtering, multi-field search, and pagination without N+1 count queries."""
    del admin

    try:
        page_val = page if isinstance(page, int) and page >= 1 else 1
        page_size_val = page_size if isinstance(page_size, int) and 1 <= page_size <= 100 else 10
        search_term = search.strip() if isinstance(search, str) and search.strip() else None
        onboarding_status_val = onboarding_status.strip().upper() if isinstance(onboarding_status, str) and onboarding_status.strip() else None
        is_active_val = is_active if isinstance(is_active, bool) else None
        employer_type_val = employer_type.strip().upper() if isinstance(employer_type, str) and employer_type.strip() else None
        verification_status_val = verification_status.strip().upper() if isinstance(verification_status, str) and verification_status.strip() else None
        sort_by_val = sort_by.strip().lower() if isinstance(sort_by, str) and sort_by.strip() else "created_at"
        sort_order_val = sort_order.strip().lower() if isinstance(sort_order, str) and sort_order.strip() else "desc"

        # Base select query: joins users!inner (role=EMPLOYER) and optional employer_onboarding_details
        select_clause = (
            "id, user_id, employer_type, onboarding_status, verification_status, "
            "contact_person_name, created_at, updated_at, "
            "users!inner(id, name, mobile, email, role, is_active, profile_photo_path), "
            "employer_onboarding_details(id, business_name, city, state)"
        )
        query = supabase.table("employer_profiles").select(select_clause, count="exact")
        query = query.eq("users.role", "EMPLOYER")

        # 1. Multi-field Search Handling
        if search_term:
            # A. Match users by name, mobile, or email
            users_match = (
                supabase.table("users")
                .select("id")
                .eq("role", "EMPLOYER")
                .or_(f"name.ilike.%{search_term}%,mobile.ilike.%{search_term}%,email.ilike.%{search_term}%")
                .execute()
            )
            matching_user_ids = [u["id"] for u in (users_match.data or [])]

            # B. Match employer_onboarding_details by business_name
            onb_match = (
                supabase.table("employer_onboarding_details")
                .select("employer_id")
                .ilike("business_name", f"%{search_term}%")
                .execute()
            )
            matching_ep_ids = {o["employer_id"] for o in (onb_match.data or []) if o.get("employer_id")}

            # C. Match employer_profiles by contact_person_name
            ep_match = (
                supabase.table("employer_profiles")
                .select("id")
                .ilike("contact_person_name", f"%{search_term}%")
                .execute()
            )
            for e in (ep_match.data or []):
                matching_ep_ids.add(e["id"])

            # Map matched user_ids to employer_profile IDs
            if matching_user_ids:
                ep_from_users = (
                    supabase.table("employer_profiles")
                    .select("id")
                    .in_("user_id", matching_user_ids)
                    .execute()
                )
                for e in (ep_from_users.data or []):
                    matching_ep_ids.add(e["id"])

            if not matching_ep_ids:
                return AdminEmployerListResponse(
                    items=[],
                    total=0,
                    page=page_val,
                    page_size=page_size_val,
                    total_pages=0,
                )

            query = query.in_("id", list(matching_ep_ids))

        # 2. Filters
        if onboarding_status_val and onboarding_status_val != "ALL":
            query = query.eq("onboarding_status", onboarding_status_val)

        if is_active_val is not None:
            query = query.eq("users.is_active", is_active_val)

        if employer_type_val and employer_type_val != "ALL":
            query = query.eq("employer_type", employer_type_val)

        if verification_status_val and verification_status_val != "ALL":
            query = query.eq("verification_status", verification_status_val)

        # 3. Sorting
        desc = (sort_order_val == "desc")
        if sort_by_val == "name":
            query = query.order("name", foreign_table="users", desc=desc).order("id", desc=desc)
        elif sort_by_val == "contact_person_name":
            query = query.order("contact_person_name", desc=desc).order("id", desc=desc)
        else:
            query = query.order("created_at", desc=desc).order("id", desc=desc)

        # 4. Pagination
        start = (page_val - 1) * page_size_val
        end = start + page_size_val - 1
        query = query.range(start, end)

        response = query.execute()
        data = response.data or []
        total = int(response.count or 0)
        total_pages = (total + page_size_val - 1) // page_size_val if total > 0 else 0

        items: list[AdminEmployerItem] = []
        for row in data:
            user_info = row.get("users") or {}
            onb_raw = row.get("employer_onboarding_details")
            onb_info = onb_raw[0] if isinstance(onb_raw, list) and onb_raw else (onb_raw if isinstance(onb_raw, dict) else {})

            items.append(
                AdminEmployerItem(
                    id=row["id"],
                    user_id=row["user_id"],
                    name=user_info.get("name"),
                    mobile=user_info.get("mobile"),
                    email=user_info.get("email"),
                    contact_person_name=row.get("contact_person_name"),
                    business_name=onb_info.get("business_name"),
                    employer_type=row.get("employer_type"),
                    onboarding_status=row.get("onboarding_status") or "NOT_STARTED",
                    verification_status=row.get("verification_status") or "PENDING",
                    is_active=bool(user_info.get("is_active", True)),
                    city=onb_info.get("city"),
                    state=onb_info.get("state"),
                    created_at=row["created_at"],
                )
            )

        return AdminEmployerListResponse(
            items=items,
            total=total,
            page=page_val,
            page_size=page_size_val,
            total_pages=total_pages,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Admin list employers error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="ADMIN_EMPLOYERS_FETCH_FAILED",
        ) from exc


@router.get("/employers/{employer_id}", response_model=AdminEmployerDetailResponse)
async def get_admin_employer_details(
    employer_id: str,
    admin: UserResponse = Depends(require_admin),
):
    """Retrieve full employer profile, business details, live job counts, and verification records."""
    del admin

    employer_row = _resolve_employer_profile(employer_id)
    profile_id = employer_row["id"]
    target_user_id = employer_row["user_id"]
    user_info = employer_row.get("users") or {}

    # 1. Onboarding details (if any)
    onb_raw = employer_row.get("employer_onboarding_details")
    onb = onb_raw[0] if isinstance(onb_raw, list) and onb_raw else (onb_raw if isinstance(onb_raw, dict) else {})

    # 2. Employer verifications
    verifications_res = (
        supabase.table("employer_verifications")
        .select("id, verification_type, status, provider_reference_id, failure_reason, verified_at, created_at")
        .eq("employer_id", profile_id)
        .order("created_at", desc=True)
        .execute()
    )
    raw_verifs = verifications_res.data or []
    verif_items = [
        AdminEmployerVerificationItem(
            id=v["id"],
            verification_type=v["verification_type"],
            status=v["status"],
            provider_reference_id=v.get("provider_reference_id"),
            failure_reason=v.get("failure_reason"),
            verified_at=v.get("verified_at"),
            created_at=v["created_at"],
        )
        for v in raw_verifs
    ]

    # 3. Live counts (single aggregation query each for the requested employer)
    total_jobs_res = (
        supabase.table("jobs")
        .select("id", count="exact")
        .eq("employer_id", profile_id)
        .execute()
    )
    total_jobs = int((total_jobs_res.count if hasattr(total_jobs_res, "count") else 0) or 0)

    active_jobs_res = (
        supabase.table("jobs")
        .select("id", count="exact")
        .eq("employer_id", profile_id)
        .eq("status", "SEARCHING")
        .execute()
    )
    active_jobs = int((active_jobs_res.count if hasattr(active_jobs_res, "count") else 0) or 0)

    total_sites_res = (
        supabase.table("job_sites")
        .select("id", count="exact")
        .eq("employer_id", profile_id)
        .execute()
    )
    total_job_sites = int((total_sites_res.count if hasattr(total_sites_res, "count") else 0) or 0)

    # Mask bank account if present (e.g. *******1234)
    raw_bank_num = onb.get("bank_account_number")
    masked_bank_num = None
    if raw_bank_num:
        clean_num = str(raw_bank_num).strip()
        masked_bank_num = ("*" * max(0, len(clean_num) - 4)) + clean_num[-4:] if len(clean_num) > 4 else clean_num

    return AdminEmployerDetailResponse(
        id=profile_id,
        user_id=target_user_id,
        name=user_info.get("name"),
        mobile=user_info.get("mobile"),
        email=user_info.get("email"),
        role=user_info.get("role") or "EMPLOYER",
        is_active=bool(user_info.get("is_active", True)),
        is_mobile_verified=bool(user_info.get("is_mobile_verified", False)),
        created_at=employer_row["created_at"],
        updated_at=employer_row.get("updated_at"),
        contact_person_name=employer_row.get("contact_person_name"),
        employer_type=employer_row.get("employer_type"),
        onboarding_status=employer_row.get("onboarding_status") or "NOT_STARTED",
        verification_status=employer_row.get("verification_status") or "PENDING",
        subscription_valid_until=str(employer_row.get("subscription_valid_until")) if employer_row.get("subscription_valid_until") else None,
        has_availed_free_dispatch=bool(employer_row.get("has_availed_free_dispatch", False)),
        business_name=onb.get("business_name"),
        business_type=onb.get("business_type"),
        business_category=onb.get("business_category"),
        industry_category=onb.get("industry_category"),
        industry_type=onb.get("industry_type"),
        registered_address=onb.get("registered_address"),
        address=onb.get("address"),
        city=onb.get("city"),
        state=onb.get("state"),
        pincode=onb.get("pincode"),
        gstin=onb.get("gstin"),
        pan_number=onb.get("pan_number"),
        cin_number=onb.get("cin_number"),
        udyam_number=onb.get("udyam_number"),
        registration_number=onb.get("registration_number"),
        work_location=onb.get("work_location"),
        website_url=onb.get("website_url"),
        description=onb.get("description"),
        nature_of_business=onb.get("nature_of_business"),
        annual_revenue=onb.get("annual_revenue"),
        number_of_proprietors=onb.get("number_of_proprietors"),
        company_email=onb.get("company_email"),
        company_phone=onb.get("company_phone"),
        proprietor_name=onb.get("proprietor_name"),
        director_name=onb.get("director_name"),
        director_phone=onb.get("director_phone"),
        director_email=onb.get("director_email"),
        director_address=onb.get("director_address"),
        business_document_url=onb.get("business_document_url"),
        hiring_mode=onb.get("hiring_mode"),
        bank_account_holder_name=onb.get("bank_account_holder_name"),
        bank_ifsc=onb.get("bank_ifsc"),
        bank_account_number=masked_bank_num,
        verifications=verif_items,
        total_jobs=total_jobs,
        active_jobs=active_jobs,
        total_job_sites=total_job_sites,
    )


@router.patch("/employers/{employer_id}/status")
async def update_admin_employer_status(
    employer_id: str,
    payload: AdminEmployerStatusRequest,
    admin: UserResponse = Depends(require_admin),
):
    """Explicit administrative action to activate or deactivate an employer user account."""
    employer_row = _resolve_employer_profile(employer_id)
    profile_id = employer_row["id"]
    target_user_id = employer_row["user_id"]
    user_row = employer_row.get("users") or {}
    prev_active = bool(user_row.get("is_active", True))
    new_active = payload.is_active

    if prev_active == new_active:
        return {
            "id": profile_id,
            "user_id": target_user_id,
            "is_active": new_active,
            "message": f"Employer active state already set to {new_active}",
        }

    updated_time = now_iso()
    supabase.table("users").update({
        "is_active": new_active,
        "updated_at": updated_time,
    }).eq("id", target_user_id).execute()

    event_type = "ADMIN_EMPLOYER_ACTIVATED" if new_active else "ADMIN_EMPLOYER_DEACTIVATED"
    desc = f"Account status updated: previous={prev_active}, new={new_active}"
    log_admin_mutation(admin, target_user_id, event_type, desc)

    return {
        "id": profile_id,
        "user_id": target_user_id,
        "is_active": new_active,
        "updated_at": updated_time,
    }


@router.patch("/employers/{employer_id}", response_model=AdminEmployerDetailResponse)
async def update_admin_employer_profile(
    employer_id: str,
    payload: AdminEmployerUpdateRequest,
    admin: UserResponse = Depends(require_admin),
):
    """Update safe employer and business fields while prohibiting modification of IDs, roles, credentials, and timestamps."""
    employer_row = _resolve_employer_profile(employer_id)
    profile_id = employer_row["id"]
    target_user_id = employer_row["user_id"]

    values = payload.model_dump(exclude_none=True)
    if not values:
        return await get_admin_employer_details(profile_id, admin)

    # Segregate updates by destination table:
    # 1. users table: name, mobile
    user_updates: dict[str, Any] = {}
    if "name" in values:
        val_name = values.pop("name")
        if val_name and val_name.strip():
            user_updates["name"] = val_name.strip()
    if "mobile" in values:
        user_updates["mobile"] = AuthService.normalize_mobile(values.pop("mobile"))

    # 2. employer_profiles table: contact_person_name, employer_type
    profile_updates: dict[str, Any] = {}
    if "contact_person_name" in values:
        val_cp = values.pop("contact_person_name")
        if val_cp and val_cp.strip():
            profile_updates["contact_person_name"] = val_cp.strip()
    if "employer_type" in values:
        profile_updates["employer_type"] = values.pop("employer_type")

    # 3. employer_onboarding_details table: remainder of values
    onb_updates = values
    updated_fields = list(user_updates.keys()) + list(profile_updates.keys()) + list(onb_updates.keys())

    updated_time = now_iso()

    # Execute user table updates
    if user_updates:
        user_updates["updated_at"] = updated_time
        supabase.table("users").update(user_updates).eq("id", target_user_id).execute()

    # Execute employer_profiles updates
    if profile_updates:
        profile_updates["updated_at"] = updated_time
        supabase.table("employer_profiles").update(profile_updates).eq("id", profile_id).execute()

    # Execute employer_onboarding_details updates or insert if missing
    if onb_updates:
        onb_raw = employer_row.get("employer_onboarding_details")
        has_existing_onb = bool(onb_raw[0] if isinstance(onb_raw, list) and onb_raw else (onb_raw if isinstance(onb_raw, dict) else None))

        onb_updates["updated_at"] = updated_time
        if has_existing_onb:
            supabase.table("employer_onboarding_details").update(onb_updates).eq("employer_id", profile_id).execute()
        else:
            onb_updates["employer_id"] = profile_id
            onb_updates["created_at"] = updated_time
            supabase.table("employer_onboarding_details").insert(onb_updates).execute()

    # Audit logging
    log_admin_mutation(
        admin,
        target_user_id,
        "ADMIN_EMPLOYER_PROFILE_EDIT",
        f"Safe employer profile edited: modified_fields=[{', '.join(updated_fields)}]",
    )

    return await get_admin_employer_details(profile_id, admin)


# ---------------------------------------------------------------------------
# Admin Jobs — Schemas
# ---------------------------------------------------------------------------

class AdminJobItem(BaseModel):
    id: str
    title: str
    status: str
    headcount_required: Optional[int] = None
    max_daily_salary: Optional[float] = None
    min_experience: Optional[float] = None
    trade_id: Optional[str] = None
    required_skills: Optional[list[str]] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    employer_id: Optional[str] = None       # employer_profiles.id
    employer_name: Optional[str] = None     # users.name
    business_name: Optional[str] = None     # employer_onboarding_details.business_name
    employer_mobile: Optional[str] = None
    job_site_id: Optional[str] = None
    site_name: Optional[str] = None
    site_city: Optional[str] = None
    site_state: Optional[str] = None
    total_matches: int = 0
    accepted_matches: int = 0
    pending_matches: int = 0


class AdminJobListResponse(BaseModel):
    items: list[AdminJobItem]
    total: int
    page: int
    page_size: int
    total_pages: int


class AdminJobMatchItem(BaseModel):
    id: str
    worker_profile_id: Optional[str] = None
    worker_name: Optional[str] = None
    worker_mobile: Optional[str] = None
    worker_trade_id: Optional[str] = None
    composite_score: Optional[float] = None
    status: str
    created_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class AdminJobSiteDetail(BaseModel):
    id: str
    name: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    pincode: Optional[str] = None


class AdminJobDetailResponse(BaseModel):
    id: str
    title: str
    status: str
    headcount_required: Optional[int] = None
    max_daily_salary: Optional[float] = None
    min_experience: Optional[float] = None
    trade_id: Optional[str] = None
    required_skills: Optional[list[str]] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    # Employer info (may be null for orphaned jobs)
    employer_id: Optional[str] = None
    employer_user_id: Optional[str] = None
    employer_name: Optional[str] = None
    business_name: Optional[str] = None
    employer_mobile: Optional[str] = None
    employer_email: Optional[str] = None
    # Site info
    job_site_id: Optional[str] = None
    site: Optional[AdminJobSiteDetail] = None
    # Matches
    matches: list[AdminJobMatchItem] = []
    total_matches: int = 0
    accepted_matches: int = 0
    pending_matches: int = 0
    attendance_count: int = 0


class AdminJobStatusRequest(BaseModel):
    new_status: Literal["CANCELLED"]


# ---------------------------------------------------------------------------
# Admin Jobs — Helpers
# ---------------------------------------------------------------------------

def _resolve_job(job_id: str) -> dict[str, Any]:
    """Fetch a single job with employer and site. Raises 404 if not found."""
    res = (
        supabase.table("jobs")
        .select(
            "id, title, status, headcount_required, max_daily_salary, min_experience, "
            "trade_id, required_skills, created_at, updated_at, employer_id, job_site_id, "
            "employer_profiles(id, user_id, contact_person_name, "
            "  users(id, name, mobile, email), "
            "  employer_onboarding_details(business_name)), "
            "job_sites(id, name, address, city, state, pincode)"
        )
        .eq("id", job_id)
        .maybe_single()
        .execute()
    )
    if not res or not res.data:
        raise HTTPException(status_code=404, detail="JOB_NOT_FOUND")
    return res.data


def _batch_match_counts(job_ids: list[str]) -> dict[str, dict[str, int]]:
    """
    Fetch match counts for a list of job IDs in a SINGLE query and return
    a map of  job_id → {total, accepted, pending, completed, cancelled}.
    """
    if not job_ids:
        return {}
    res = (
        supabase.table("job_matches")
        .select("job_id, status")
        .in_("job_id", job_ids)
        .execute()
    )
    rows = res.data or []
    counts: dict[str, dict[str, int]] = {}
    for row in rows:
        jid = row.get("job_id")
        st = (row.get("status") or "").upper()
        if jid not in counts:
            counts[jid] = {"total": 0, "accepted": 0, "pending": 0, "completed": 0, "cancelled": 0}
        counts[jid]["total"] += 1
        key = st.lower() if st.lower() in ("accepted", "pending", "completed", "cancelled") else "other"
        if key in counts[jid]:
            counts[jid][key] += 1
    return counts


def _extract_job_item(row: dict[str, Any], match_counts: dict[str, dict[str, int]]) -> AdminJobItem:
    """Convert a raw jobs row (with embedded relations) into AdminJobItem."""
    ep = row.get("employer_profiles") or {}
    # employer_profiles may be list (supabase returns list for left join) or dict
    if isinstance(ep, list):
        ep = ep[0] if ep else {}
    onb_raw = ep.get("employer_onboarding_details") or {}
    if isinstance(onb_raw, list):
        onb_raw = onb_raw[0] if onb_raw else {}
    user_raw = ep.get("users") or {}
    if isinstance(user_raw, list):
        user_raw = user_raw[0] if user_raw else {}

    site = row.get("job_sites") or {}
    if isinstance(site, list):
        site = site[0] if site else {}

    jid = row["id"]
    mc = match_counts.get(jid, {"total": 0, "accepted": 0, "pending": 0})

    return AdminJobItem(
        id=jid,
        title=row.get("title") or "",
        status=row.get("status") or "",
        headcount_required=row.get("headcount_required"),
        max_daily_salary=row.get("max_daily_salary"),
        min_experience=row.get("min_experience"),
        trade_id=row.get("trade_id"),
        required_skills=row.get("required_skills"),
        created_at=row["created_at"],
        updated_at=row.get("updated_at"),
        employer_id=ep.get("id"),
        employer_name=user_raw.get("name"),
        business_name=onb_raw.get("business_name"),
        employer_mobile=user_raw.get("mobile"),
        job_site_id=site.get("id"),
        site_name=site.get("name"),
        site_city=site.get("city"),
        site_state=site.get("state"),
        total_matches=mc.get("total", 0),
        accepted_matches=mc.get("accepted", 0),
        pending_matches=mc.get("pending", 0),
    )


# ---------------------------------------------------------------------------
# Admin Jobs — Endpoints
# ---------------------------------------------------------------------------

@router.get("/jobs", response_model=AdminJobListResponse)
async def list_admin_jobs(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    search: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    trade_id: Optional[str] = Query(None),
    employer_id: Optional[str] = Query(None),
    admin: UserResponse = Depends(require_admin),
):
    """
    Paginated list of all jobs.
    Filters: status (SEARCHING|FILLED|CANCELLED), trade_id, employer_id, search (title ilike).
    Match counts are fetched in a single batched query (no N+1).
    """
    start = (page - 1) * page_size
    end = start + page_size - 1

    select_cols = (
        "id, title, status, headcount_required, max_daily_salary, min_experience, "
        "trade_id, required_skills, created_at, updated_at, employer_id, job_site_id, "
        "employer_profiles(id, user_id, contact_person_name, "
        "  users(id, name, mobile), "
        "  employer_onboarding_details(business_name)), "
        "job_sites(id, name, city, state)"
    )

    q = supabase.table("jobs").select(select_cols, count="exact")

    if status_filter and status_filter.upper() != "ALL":
        q = q.eq("status", status_filter.upper())

    if trade_id:
        q = q.eq("trade_id", trade_id)

    if employer_id:
        q = q.eq("employer_id", employer_id)

    if search:
        term = search.strip()
        q = q.ilike("title", f"%{term}%")

    q = q.order("created_at", desc=True).order("id", desc=True).range(start, end)
    res = q.execute()

    rows = res.data or []
    total = int((res.count if hasattr(res, "count") else 0) or 0)

    job_ids = [r["id"] for r in rows]
    match_counts = _batch_match_counts(job_ids)

    items = [_extract_job_item(r, match_counts) for r in rows]
    total_pages = max(1, -(-total // page_size))  # ceil division

    return AdminJobListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get("/jobs/{job_id}", response_model=AdminJobDetailResponse)
async def get_admin_job_details(
    job_id: str,
    admin: UserResponse = Depends(require_admin),
):
    """Full job detail with employer info, site info, matches, and attendance count."""
    row = _resolve_job(job_id)

    # --- Employer extraction ---
    ep = row.get("employer_profiles") or {}
    if isinstance(ep, list):
        ep = ep[0] if ep else {}
    onb_raw = ep.get("employer_onboarding_details") or {}
    if isinstance(onb_raw, list):
        onb_raw = onb_raw[0] if onb_raw else {}
    user_raw = ep.get("users") or {}
    if isinstance(user_raw, list):
        user_raw = user_raw[0] if user_raw else {}

    # --- Site extraction ---
    site_raw = row.get("job_sites") or {}
    if isinstance(site_raw, list):
        site_raw = site_raw[0] if site_raw else {}
    site_detail: Optional[AdminJobSiteDetail] = None
    if site_raw.get("id"):
        site_detail = AdminJobSiteDetail(
            id=site_raw["id"],
            name=site_raw.get("name"),
            address=site_raw.get("address"),
            city=site_raw.get("city"),
            state=site_raw.get("state"),
            pincode=site_raw.get("pincode"),
        )

    # --- Matches (single query with worker info) ---
    matches_res = (
        supabase.table("job_matches")
        .select(
            "id, worker_id, worker_profile_id, composite_score, status, created_at, expires_at, completed_at, "
            "worker_profiles(user_id, trade_id, users(name, mobile))"
        )
        .eq("job_id", job_id)
        .order("created_at", desc=True)
        .execute()
    )
    raw_matches = matches_res.data or []
    match_items: list[AdminJobMatchItem] = []
    total_matches = 0
    accepted_matches = 0
    pending_matches = 0

    for m in raw_matches:
        total_matches += 1
        m_status = (m.get("status") or "").upper()
        if m_status == "ACCEPTED":
            accepted_matches += 1
        elif m_status == "PENDING":
            pending_matches += 1

        wp = m.get("worker_profiles") or {}
        if isinstance(wp, list):
            wp = wp[0] if wp else {}
        w_user = wp.get("users") or {}
        if isinstance(w_user, list):
            w_user = w_user[0] if w_user else {}

        match_items.append(AdminJobMatchItem(
            id=m["id"],
            worker_profile_id=m.get("worker_profile_id") or m.get("worker_id"),
            worker_name=w_user.get("name"),
            worker_mobile=w_user.get("mobile"),
            worker_trade_id=wp.get("trade_id"),
            composite_score=m.get("composite_score"),
            status=m.get("status") or "",
            created_at=m.get("created_at"),
            expires_at=m.get("expires_at"),
            completed_at=m.get("completed_at"),
        ))

    # --- Attendance count ---
    att_res = (
        supabase.table("attendance")
        .select("id", count="exact")
        .eq("job_id", job_id)
        .execute()
    )
    attendance_count = int((att_res.count if hasattr(att_res, "count") else 0) or 0)

    return AdminJobDetailResponse(
        id=row["id"],
        title=row.get("title") or "",
        status=row.get("status") or "",
        headcount_required=row.get("headcount_required"),
        max_daily_salary=row.get("max_daily_salary"),
        min_experience=row.get("min_experience"),
        trade_id=row.get("trade_id"),
        required_skills=row.get("required_skills"),
        created_at=row["created_at"],
        updated_at=row.get("updated_at"),
        employer_id=ep.get("id"),
        employer_user_id=user_raw.get("id"),
        employer_name=user_raw.get("name"),
        business_name=onb_raw.get("business_name"),
        employer_mobile=user_raw.get("mobile"),
        employer_email=user_raw.get("email"),
        job_site_id=site_raw.get("id"),
        site=site_detail,
        matches=match_items,
        total_matches=total_matches,
        accepted_matches=accepted_matches,
        pending_matches=pending_matches,
        attendance_count=attendance_count,
    )


@router.patch("/jobs/{job_id}/status")
async def update_admin_job_status(
    job_id: str,
    payload: AdminJobStatusRequest,
    admin: UserResponse = Depends(require_admin),
):
    """
    Cancel an active job. Only SEARCHING jobs can be cancelled.
    FILLED jobs represent a completed hiring cycle and must not be overridden.
    """
    row = _resolve_job(job_id)
    current_status = (row.get("status") or "").upper()

    if current_status == "CANCELLED":
        return {"id": job_id, "status": "CANCELLED", "message": "Job is already cancelled"}

    if current_status != "SEARCHING":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel a job with status '{current_status}'. Only SEARCHING jobs can be cancelled.",
        )

    cancellation = supabase.rpc("cancel_job_for_employer", {
        "p_employer_id": row.get("employer_id"),
        "p_job_id": job_id,
    }).execute()
    updated_row = cancellation.data[0] if isinstance(cancellation.data, list) and cancellation.data else cancellation.data
    updated_time = (updated_row or {}).get("updated_at") or now_iso()

    # Audit — target is the employer's user_id (may be None for orphaned jobs)
    ep = row.get("employer_profiles") or {}
    if isinstance(ep, list):
        ep = ep[0] if ep else {}
    u = ep.get("users") or {}
    if isinstance(u, list):
        u = u[0] if u else {}
    employer_user_id = u.get("id")

    log_admin_mutation(
        admin,
        employer_user_id or job_id,
        "ADMIN_JOB_CANCELLED",
        f"Admin cancelled job '{row.get('title')}' (id={job_id})",
    )

    return {"id": job_id, "status": "CANCELLED", "updated_at": updated_time}


# ===========================================================================
# PAYMENTS MODULE
# ===========================================================================

# ---------------------------------------------------------------------------
# Payment Schemas
# ---------------------------------------------------------------------------

class AdminPaymentItem(BaseModel):
    id: str
    order_id: str
    cf_order_id: Optional[str] = None
    user_type: str                          # "WORKER" or "EMPLOYER"
    payment_category: str = "UNKNOWN"  # "WORKER_SUBSCRIPTION" | "BUSINESS_SUBSCRIPTION" | "INDIVIDUAL_COMMISSION" | "LEGACY_PAYMENT" | "UNKNOWN"
    job_id: Optional[str] = None
    job_title: Optional[str] = None
    worker_name: Optional[str] = None
    user_id: Optional[str] = None
    user_name: Optional[str] = None
    user_mobile: Optional[str] = None
    employer_id: Optional[str] = None
    worker_profile_id: Optional[str] = None
    amount: float
    currency: str
    status: str
    employee_count: Optional[int] = None
    created_at: str
    updated_at: Optional[str] = None
    payment_success_at: Optional[str] = None
    subscription_valid_from: Optional[str] = None
    subscription_valid_until: Optional[str] = None
    validity_status: str                    # "ACTIVE", "EXPIRED", "UNKNOWN", "N/A"


class AdminPaymentListResponse(BaseModel):
    items: list[AdminPaymentItem]
    total: int
    page: int
    page_size: int
    total_pages: int
    total_success: int = 0
    total_pending: int = 0
    total_active_validity: int = 0
    total_active_payment_validity: int = 0


class AdminPaymentDetailResponse(AdminPaymentItem):
    user_email: Optional[str] = None
    user_role: Optional[str] = None
    user_is_active: Optional[bool] = None
    employer_type: Optional[str] = None
    has_availed_free_dispatch: Optional[bool] = None
    onboarding_status: Optional[str] = None


# ---------------------------------------------------------------------------
# Payment Helpers
# ---------------------------------------------------------------------------

def _compute_validity_status(payment_category: str, subscription_valid_until: Optional[str]) -> str:
    """Compute validity status based on payment category and payment-level subscription_valid_until.
    
    Returns:
        - "ACTIVE" if valid_until > NOW (for subscription categories)
        - "EXPIRED" if valid_until <= NOW (for subscription categories)
        - "UNKNOWN" if subscription category but no valid_until data (historical data gap)
        - "N/A" if not a subscription category (Individual Commission, Legacy, etc.)
    """
    # Only subscription payments have validity status
    if payment_category in ("WORKER_SUBSCRIPTION", "BUSINESS_SUBSCRIPTION"):
        if not subscription_valid_until:
            return "UNKNOWN"  # Historical data missing for subscription
        try:
            exp = datetime.fromisoformat(subscription_valid_until.replace("Z", "+00:00"))
            now = datetime.now(timezone.utc)
            return "ACTIVE" if exp > now else "EXPIRED"
        except Exception:
            return "UNKNOWN"  # Malformed date for subscription
    if payment_category == "UNKNOWN":
        return "UNKNOWN"
    else:
        # Individual Commission, Legacy, or other non-subscription
        return "N/A"


def _resolve_job_titles(job_ids: list[str]) -> dict:
    """Resolve job titles for a list of job IDs."""
    if not job_ids:
        return {}
    res = {}
    try:
        rows = supabase.table("jobs").select("id, title").in_("id", job_ids).execute().data or []
        for r in rows:
            res[str(r["id"])] = r.get("title")
    except Exception as exc:
        logger.warning("Failed to resolve job titles: %s", exc)
    return res


def _build_payment_item(
    row: dict,
    worker_map: dict,     # worker_profile_id → {user_id, name, mobile, subscription_valid_until}
    employer_map: dict,   # employer_id → {user_id, name, mobile, subscription_valid_until, employer_type}
    job_map: dict = None, # job_id -> title
) -> AdminPaymentItem:
    """Build AdminPaymentItem from a payment_transactions row + resolved profile maps.
    Uses payment-level subscription_valid_from/until for validity, not profile-level."""
    job_map = job_map or {}
    wp_id = row.get("worker_profile_id")
    ep_id = row.get("employer_id")
    w_name = None
    raw_payload = row.get("raw_webhook_payload") if isinstance(row.get("raw_webhook_payload"), dict) else {}
    job_id = str(row.get("job_id") or raw_payload.get("job_id") or "") or None
    job_title = job_map.get(job_id) if job_id else None
    
    # Payment-level subscription validity (new fields)
    payment_valid_from = row.get("subscription_valid_from")
    payment_valid_until = row.get("subscription_valid_until")

    if wp_id and not ep_id:
        user_type = "WORKER"
        profile = worker_map.get(str(wp_id), {})
        w_name = None
    elif ep_id:
        user_type = "EMPLOYER"
        profile = employer_map.get(str(ep_id), {})
    else:
        user_type = "UNKNOWN"
        profile = {}
        w_name = None

    payment_category = str(row.get("payment_category") or "UNKNOWN").upper()
    if payment_category not in {
        "WORKER_SUBSCRIPTION",
        "BUSINESS_SUBSCRIPTION",
        "INDIVIDUAL_COMMISSION",
        "LEGACY_PAYMENT",
        "UNKNOWN",
    }:
        payment_category = "UNKNOWN"
    if payment_category == "INDIVIDUAL_COMMISSION" and wp_id:
        w_name = worker_map.get(str(wp_id), {}).get("name")

    # Compute validity using payment-level data
    validity = _compute_validity_status(payment_category, payment_valid_until)

    return AdminPaymentItem(
        id=str(row["id"]),
        order_id=row.get("order_id") or "",
        cf_order_id=row.get("cf_order_id"),
        user_type=user_type,
        payment_category=payment_category,
        job_id=job_id,
        job_title=job_title,
        worker_name=w_name,
        user_id=profile.get("user_id"),
        user_name=profile.get("name"),
        user_mobile=profile.get("mobile"),
        employer_id=str(ep_id) if ep_id else None,
        worker_profile_id=str(wp_id) if wp_id else None,
        amount=float(row.get("amount") or 0),
        currency=row.get("currency") or "INR",
        status=row.get("status") or "",
        employee_count=row.get("employee_count"),
        created_at=row.get("created_at") or "",
        updated_at=row.get("updated_at"),
        payment_success_at=row.get("payment_success_at"),
        subscription_valid_from=payment_valid_from,
        subscription_valid_until=payment_valid_until,
        validity_status=validity,
    )


def _resolve_worker_payment_profiles(worker_profile_ids: list[str]) -> dict:
    """Batch-fetch worker profile data for a list of worker_profile_ids.
    Returns dict keyed by worker_profile_id."""
    if not worker_profile_ids:
        return {}
    result = {}
    try:
        rows = (
            supabase.table("worker_profiles")
            .select("id, user_id, subscription_valid_until, users!inner(id, name, mobile, role)")
            .in_("id", worker_profile_ids)
            .eq("users.role", "WORKER")
            .execute()
            .data or []
        )
        for r in rows:
            u = r.get("users") or {}
            if isinstance(u, list):
                u = u[0] if u else {}
            result[str(r["id"])] = {
                "user_id": u.get("id"),
                "name": u.get("name"),
                "mobile": u.get("mobile"),
                "subscription_valid_until": r.get("subscription_valid_until"),
            }
    except Exception as exc:
        logger.warning("Failed to resolve worker payment profiles: %s", exc)
    return result


def _resolve_employer_payment_profiles(employer_ids: list[str]) -> dict:
    """Batch-fetch employer profile data for a list of employer_ids.
    Returns dict keyed by employer_profile_id."""
    if not employer_ids:
        return {}
    result = {}
    try:
        ep_rows = (
            supabase.table("employer_profiles")
            .select("id, user_id, subscription_valid_until, employer_type, has_availed_free_dispatch")
            .in_("id", employer_ids)
            .execute()
            .data or []
        )
        if not ep_rows:
            return {}

        user_ids = [r["user_id"] for r in ep_rows if r.get("user_id")]
        user_map: dict = {}
        if user_ids:
            u_rows = (
                supabase.table("users")
                .select("id, name, mobile, email, role, is_active")
                .in_("id", user_ids)
                .execute()
                .data or []
            )
            user_map = {str(u["id"]): u for u in u_rows}

        for r in ep_rows:
            uid = str(r.get("user_id") or "")
            u = user_map.get(uid, {})
            result[str(r["id"])] = {
                "user_id": uid or None,
                "name": u.get("name"),
                "mobile": u.get("mobile"),
                "email": u.get("email"),
                "role": u.get("role"),
                "is_active": u.get("is_active"),
                "subscription_valid_until": r.get("subscription_valid_until"),
                "employer_type": r.get("employer_type"),
                "has_availed_free_dispatch": r.get("has_availed_free_dispatch"),
            }
    except Exception as exc:
        logger.warning("Failed to resolve employer payment profiles: %s", exc)
    return result


# ---------------------------------------------------------------------------
# Payment Endpoints
# ---------------------------------------------------------------------------

@router.get("/payments", response_model=AdminPaymentListResponse)
async def list_admin_payments(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    user_type: str = Query("ALL"),       # ALL | WORKER | EMPLOYER
    status: str = Query("ALL"),          # ALL | PENDING | SUCCESS | FAILED | CANCELLED | EXPIRED
    validity_status: str = Query("ALL"), # ALL | ACTIVE | EXPIRED | UNKNOWN | N/A
    payment_category: str = Query("ALL"),
    search: str = Query(""),             # order_id / name / mobile
    admin: UserResponse = Depends(require_admin),
):
    """Paginated list of payment transactions — read-only admin view."""
    page_size_val = min(page_size, 100)
    offset = (page - 1) * page_size_val

    # --- Build base query (never expose payment_session_id or raw_webhook_payload) ---
    query = (
        supabase.table("payment_transactions")
        .select(
            "id, order_id, cf_order_id, employer_id, worker_profile_id, "
            "amount, currency, status, employee_count, created_at, updated_at, payment_success_at, "
            "subscription_valid_from, subscription_valid_until, payment_category, job_id, raw_webhook_payload",
            count="exact",
        )
    )

    # --- Filters ---
    if user_type == "WORKER":
        query = query.not_.is_("worker_profile_id", "null")
    elif user_type == "EMPLOYER":
        query = query.not_.is_("employer_id", "null")

    if status != "ALL":
        query = query.eq("status", status.upper())

    data = query.order("created_at", desc=True).order("id").execute().data or []

    # --- Resolve profiles and jobs ---
    wp_ids = [str(r["worker_profile_id"]) for r in data if r.get("worker_profile_id")]
    ep_ids = [str(r["employer_id"]) for r in data if r.get("employer_id")]
    job_ids = []
    for r in data:
        jid = r.get("job_id")
        if not jid and isinstance(r.get("raw_webhook_payload"), dict):
            jid = r["raw_webhook_payload"].get("job_id")
        if jid:
            job_ids.append(str(jid))

    worker_map = _resolve_worker_payment_profiles(wp_ids)
    employer_map = _resolve_employer_payment_profiles(ep_ids)
    job_map = _resolve_job_titles(job_ids)

    # --- Build and filter the complete candidate set before pagination ---
    items = [_build_payment_item(r, worker_map, employer_map, job_map) for r in data]

    if search.strip():
        search_value = search.strip().lower()
        items = [
            item for item in items
            if search_value in (item.order_id or "").lower()
            or search_value in (item.user_name or "").lower()
            or search_value in (item.user_mobile or "").lower()
        ]

    if payment_category != "ALL":
        items = [item for item in items if item.payment_category == payment_category.upper()]

    # --- Filter by validity_status (post-processing, since it's a computed field) ---
    if validity_status != "ALL":
        normalized_validity = validity_status.upper()
        if normalized_validity == "NONE":
            normalized_validity = "N/A"
        items = [item for item in items if item.validity_status == normalized_validity]

    total = len(items)
    total_pages = max(1, (total + page_size_val - 1) // page_size_val)
    items = items[offset:offset + page_size_val]

    # --- Compute global KPI totals (lightweight count queries, dataset-wide) ---
    success_count_res = supabase.table("payment_transactions").select("id", count="exact").eq("status", "SUCCESS").execute()
    total_success = int((success_count_res.count if hasattr(success_count_res, "count") else 0) or 0)

    pending_count_res = supabase.table("payment_transactions").select("id", count="exact").eq("status", "PENDING").execute()
    total_pending = int((pending_count_res.count if hasattr(pending_count_res, "count") else 0) or 0)

    # Active validity count across business employers and workers
    now_iso_str = datetime.now(timezone.utc).isoformat()
    active_emp_res = supabase.table("employer_profiles").select("id", count="exact").gt("subscription_valid_until", now_iso_str).execute()
    active_wrk_res = supabase.table("worker_profiles").select("id", count="exact").gt("subscription_valid_until", now_iso_str).execute()
    total_active_validity = int(((active_emp_res.count or 0) + (active_wrk_res.count or 0)) if hasattr(active_emp_res, "count") else 0)
    active_payment_res = (
        supabase.table("payment_transactions")
        .select("id", count="exact")
        .eq("status", "SUCCESS")
        .in_("payment_category", ["WORKER_SUBSCRIPTION", "BUSINESS_SUBSCRIPTION"])
        .gt("subscription_valid_until", now_iso_str)
        .execute()
    )
    total_active_payment_validity = int((active_payment_res.count if hasattr(active_payment_res, "count") else 0) or 0)

    return AdminPaymentListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size_val,
        total_pages=total_pages,
        total_success=total_success,
        total_pending=total_pending,
        total_active_validity=total_active_validity,
        total_active_payment_validity=total_active_payment_validity,
    )


@router.get("/payments/{payment_id}", response_model=AdminPaymentDetailResponse)
async def get_admin_payment_detail(
    payment_id: str,
    admin: UserResponse = Depends(require_admin),
):
    """Full detail for a single payment transaction — read-only admin view."""
    res = (
        supabase.table("payment_transactions")
        .select(
            "id, order_id, cf_order_id, employer_id, worker_profile_id, "
            "amount, currency, status, employee_count, created_at, updated_at, payment_success_at, "
            "subscription_valid_from, subscription_valid_until, payment_category, job_id, raw_webhook_payload"
        )
        .eq("id", payment_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Payment not found")

    row = res.data[0]
    wp_id = row.get("worker_profile_id")
    ep_id = row.get("employer_id")
    jid = row.get("job_id")
    if not jid and isinstance(row.get("raw_webhook_payload"), dict):
        jid = row["raw_webhook_payload"].get("job_id")

    worker_map: dict = _resolve_worker_payment_profiles([str(wp_id)]) if wp_id else {}
    employer_map: dict = _resolve_employer_payment_profiles([str(ep_id)]) if ep_id else {}
    job_map: dict = _resolve_job_titles([str(jid)]) if jid else {}

    base = _build_payment_item(row, worker_map, employer_map, job_map)

    # --- Extra detail fields ---
    user_email = None
    user_role = None
    user_is_active = None
    employer_type = None
    has_availed_free_dispatch = None
    onboarding_status = None

    if wp_id:
        profile = worker_map.get(str(wp_id), {})
        uid = profile.get("user_id")
        if uid:
            try:
                u_res = (
                    supabase.table("users")
                    .select("email, role, is_active")
                    .eq("id", uid)
                    .limit(1)
                    .execute()
                )
                if u_res.data:
                    user_email = u_res.data[0].get("email")
                    user_role = u_res.data[0].get("role")
                    user_is_active = u_res.data[0].get("is_active")
            except Exception as exc:
                logger.warning("Failed to fetch worker user detail for payment %s: %s", payment_id, exc)
        # Onboarding status
        try:
            ob_res = (
                supabase.table("worker_onboarding_status")
                .select("status")
                .eq("worker_profile_id", str(wp_id))
                .limit(1)
                .execute()
            )
            if ob_res.data:
                onboarding_status = ob_res.data[0].get("status")
        except Exception:
            pass

    elif ep_id:
        emp_profile = employer_map.get(str(ep_id), {})
        employer_type = emp_profile.get("employer_type")
        has_availed_free_dispatch = emp_profile.get("has_availed_free_dispatch")
        user_email = emp_profile.get("email")
        user_role = emp_profile.get("role")
        user_is_active = emp_profile.get("is_active")
        uid = emp_profile.get("user_id")
        if uid:
            try:
                ob_res = (
                    supabase.table("employer_onboarding_status")
                    .select("onboarding_status")
                    .eq("employer_profile_id", str(ep_id))
                    .limit(1)
                    .execute()
                )
                if ob_res.data:
                    onboarding_status = ob_res.data[0].get("onboarding_status")
            except Exception:
                pass

    return AdminPaymentDetailResponse(
        **base.model_dump(),
        user_email=user_email,
        user_role=user_role,
        user_is_active=user_is_active,
        employer_type=employer_type,
        has_availed_free_dispatch=has_availed_free_dispatch,
        onboarding_status=onboarding_status,
    )


# ===========================================================================
# REGIONAL / LOCATIONS MODULE
# ===========================================================================

# ---------------------------------------------------------------------------
# Location Schemas
# ---------------------------------------------------------------------------

class AdminLocationKPI(BaseModel):
    total_workers: int
    total_employers: int
    workers_with_location: int
    employers_with_location: int
    workers_without_location: int
    employers_without_location: int
    states_covered: int
    cities_covered: int


class AdminStateAggregationItem(BaseModel):
    state: str
    worker_count: int
    employer_count: int
    total_count: int


class AdminCityAggregationItem(BaseModel):
    city: str
    state: str
    worker_count: int
    employer_count: int
    total_count: int


class AdminRegionalSummaryResponse(BaseModel):
    kpis: AdminLocationKPI
    states: list[AdminStateAggregationItem]
    cities: list[AdminCityAggregationItem]


class AdminUserLocationItem(BaseModel):
    user_id: str
    profile_id: str
    user_name: str
    user_mobile: Optional[str] = None
    user_email: Optional[str] = None
    user_type: str  # "WORKER" | "EMPLOYER"
    employer_type: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    pincode: Optional[str] = None
    address: Optional[str] = None
    registered_address: Optional[str] = None
    work_location: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    location_source: Optional[str] = None
    location_updated_at: Optional[str] = None
    is_active: bool
    location_available: bool
    onboarding_status: Optional[str] = None
    profile_completed: Optional[bool] = None
    verification_status: Optional[str] = None
    created_at: str


class AdminUserLocationListResponse(BaseModel):
    items: list[AdminUserLocationItem]
    total: int
    page: int
    page_size: int
    total_pages: int


# ---------------------------------------------------------------------------
# Location Helpers
# ---------------------------------------------------------------------------

def _clean_location_str(val: Optional[str]) -> Optional[str]:
    if not val:
        return None
    s = val.strip()
    return s if s else None


def _canonicalize_state(raw: str) -> str:
    s = raw.strip()
    if s.lower() == "delhi":
        return "Delhi"
    if s.lower() == "maharashtra":
        return "Maharashtra"
    return s.title()


def _canonicalize_city(raw: str) -> str:
    s = raw.strip()
    if s.lower() == "south delhi":
        return "South Delhi"
    if s.lower() == "delhi":
        return "Delhi"
    return s


def _fetch_unified_location_users() -> list[AdminUserLocationItem]:
    """Retrieve all authoritative worker and employer locations."""
    # 1. Workers with role='WORKER'
    raw_workers = (
        supabase.table("worker_profiles")
        .select(
            "id, user_id, city, state, pincode, address, latitude, longitude, "
            "location_source, location_updated_at, onboarding_status, profile_completed, "
            "created_at, users!inner(id, name, mobile, email, role, is_active, created_at)"
        )
        .eq("users.role", "WORKER")
        .order("id")
        .execute()
        .data or []
    )

    # 2. Employers with role='EMPLOYER'
    raw_employers = (
        supabase.table("employer_profiles")
        .select(
            "id, user_id, employer_type, onboarding_status, verification_status, "
            "created_at, users!inner(id, name, mobile, email, role, is_active, created_at)"
        )
        .eq("users.role", "EMPLOYER")
        .order("id")
        .execute()
        .data or []
    )

    # Batch fetch employer_onboarding_details
    emp_ids = [e["id"] for e in raw_employers if e.get("id")]
    eod_map: dict[str, dict] = {}
    if emp_ids:
        raw_eod = (
            supabase.table("employer_onboarding_details")
            .select(
                "employer_id, business_name, registered_address, address, city, state, "
                "pincode, work_location, latitude, longitude"
            )
            .in_("employer_id", emp_ids)
            .execute()
            .data or []
        )
        for row in raw_eod:
            eod_map[str(row["employer_id"])] = row

    items: list[AdminUserLocationItem] = []

    # Process workers
    for w in raw_workers:
        u = w.get("users") or {}
        if isinstance(u, list):
            u = u[0] if u else {}
        city = _clean_location_str(w.get("city"))
        state = _clean_location_str(w.get("state"))
        pincode = _clean_location_str(w.get("pincode"))
        has_loc = bool(city and state)
        lat = float(w["latitude"]) if w.get("latitude") is not None else None
        lng = float(w["longitude"]) if w.get("longitude") is not None else None

        items.append(
            AdminUserLocationItem(
                user_id=str(u.get("id") or w.get("user_id")),
                profile_id=str(w["id"]),
                user_name=u.get("name") or "Unnamed Worker",
                user_mobile=u.get("mobile"),
                user_email=u.get("email"),
                user_type="WORKER",
                employer_type=None,
                city=_canonicalize_city(city) if city else None,
                state=_canonicalize_state(state) if state else None,
                pincode=pincode,
                address=_clean_location_str(w.get("address")),
                registered_address=None,
                work_location=None,
                latitude=lat,
                longitude=lng,
                location_source=w.get("location_source"),
                location_updated_at=w.get("location_updated_at"),
                is_active=bool(u.get("is_active", True)),
                location_available=has_loc,
                onboarding_status=w.get("onboarding_status"),
                profile_completed=w.get("profile_completed"),
                verification_status=None,
                created_at=str(u.get("created_at") or w.get("created_at") or ""),
            )
        )

    # Process employers
    for e in raw_employers:
        u = e.get("users") or {}
        if isinstance(u, list):
            u = u[0] if u else {}
        eid = str(e["id"])
        det = eod_map.get(eid, {})
        city = _clean_location_str(det.get("city"))
        state = _clean_location_str(det.get("state"))
        pincode = _clean_location_str(det.get("pincode"))
        has_loc = bool(city and state)
        lat = float(det["latitude"]) if det.get("latitude") is not None else None
        lng = float(det["longitude"]) if det.get("longitude") is not None else None

        name = det.get("business_name") or u.get("name") or "Unnamed Employer"

        items.append(
            AdminUserLocationItem(
                user_id=str(u.get("id") or e.get("user_id")),
                profile_id=eid,
                user_name=name,
                user_mobile=u.get("mobile"),
                user_email=u.get("email"),
                user_type="EMPLOYER",
                employer_type=e.get("employer_type"),
                city=_canonicalize_city(city) if city else None,
                state=_canonicalize_state(state) if state else None,
                pincode=pincode,
                address=_clean_location_str(det.get("address")),
                registered_address=_clean_location_str(det.get("registered_address")),
                work_location=_clean_location_str(det.get("work_location")),
                latitude=lat,
                longitude=lng,
                location_source=None,
                location_updated_at=None,
                is_active=bool(u.get("is_active", True)),
                location_available=has_loc,
                onboarding_status=e.get("onboarding_status"),
                profile_completed=None,
                verification_status=e.get("verification_status"),
                created_at=str(u.get("created_at") or e.get("created_at") or ""),
            )
        )

    return items


# ---------------------------------------------------------------------------
# Location Endpoints
# ---------------------------------------------------------------------------

@router.get("/locations/summary", response_model=AdminRegionalSummaryResponse)
async def get_admin_locations_summary(
    admin: UserResponse = Depends(require_admin),
):
    """Return high-level regional summary, state distributions, and city distributions."""
    all_users = _fetch_unified_location_users()

    total_workers = len([u for u in all_users if u.user_type == "WORKER"])
    total_employers = len([u for u in all_users if u.user_type == "EMPLOYER"])
    workers_with_loc = len([u for u in all_users if u.user_type == "WORKER" and u.location_available])
    employers_with_loc = len([u for u in all_users if u.user_type == "EMPLOYER" and u.location_available])

    state_map: dict[str, dict] = {}
    city_map: dict[str, dict] = {}

    for u in all_users:
        if not u.location_available or not u.state or not u.city:
            continue

        s_key = u.state.lower().strip()
        c_key = f"{u.city.lower().strip()}||{s_key}"

        # State grouping
        if s_key not in state_map:
            state_map[s_key] = {
                "state": u.state,
                "worker_count": 0,
                "employer_count": 0,
                "total_count": 0,
            }
        if u.user_type == "WORKER":
            state_map[s_key]["worker_count"] += 1
        else:
            state_map[s_key]["employer_count"] += 1
        state_map[s_key]["total_count"] += 1

        # City grouping
        if c_key not in city_map:
            city_map[c_key] = {
                "city": u.city,
                "state": u.state,
                "worker_count": 0,
                "employer_count": 0,
                "total_count": 0,
            }
        if u.user_type == "WORKER":
            city_map[c_key]["worker_count"] += 1
        else:
            city_map[c_key]["employer_count"] += 1
        city_map[c_key]["total_count"] += 1

    states_list = sorted(
        [AdminStateAggregationItem(**val) for val in state_map.values()],
        key=lambda x: (-x.total_count, x.state),
    )
    cities_list = sorted(
        [AdminCityAggregationItem(**val) for val in city_map.values()],
        key=lambda x: (-x.total_count, x.city),
    )

    kpis = AdminLocationKPI(
        total_workers=total_workers,
        total_employers=total_employers,
        workers_with_location=workers_with_loc,
        employers_with_location=employers_with_loc,
        workers_without_location=total_workers - workers_with_loc,
        employers_without_location=total_employers - employers_with_loc,
        states_covered=len(state_map),
        cities_covered=len(city_map),
    )

    return AdminRegionalSummaryResponse(
        kpis=kpis,
        states=states_list,
        cities=cities_list,
    )


@router.get("/locations/users", response_model=AdminUserLocationListResponse)
async def list_admin_user_locations(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    user_type: str = Query("ALL"),  # ALL | WORKER | EMPLOYER
    state: str = Query("ALL"),
    city: str = Query("ALL"),
    is_active: str = Query("ALL"),  # ALL | ACTIVE | INACTIVE
    search: str = Query(""),
    admin: UserResponse = Depends(require_admin),
):
    """Paginated directory of user geographic locations."""
    # Normalize query params if passed directly in tests or FastAPI
    p_num = page.default if hasattr(page, "default") else page
    p_size = page_size.default if hasattr(page_size, "default") else page_size
    p_num = int(p_num or 1)
    p_size = int(p_size or 10)
    page_size_val = min(p_size, 100)

    u_type = user_type.default if hasattr(user_type, "default") else user_type
    st = state.default if hasattr(state, "default") else state
    ct = city.default if hasattr(city, "default") else city
    act = is_active.default if hasattr(is_active, "default") else is_active
    q_search = search.default if hasattr(search, "default") else search

    u_type = str(u_type or "ALL")
    st = str(st or "ALL")
    ct = str(ct or "ALL")
    act = str(act or "ALL")
    q_search = str(q_search or "")

    all_users = _fetch_unified_location_users()

    # Apply filters
    filtered = all_users

    # 1. user_type
    if u_type != "ALL":
        filtered = [u for u in filtered if u.user_type == u_type.upper()]

    # 2. state
    if st != "ALL":
        filtered = [u for u in filtered if u.state and u.state.lower() == st.lower()]

    # 3. city
    if ct != "ALL":
        filtered = [u for u in filtered if u.city and u.city.lower() == ct.lower()]

    # 4. is_active
    if act == "ACTIVE":
        filtered = [u for u in filtered if u.is_active is True]
    elif act == "INACTIVE":
        filtered = [u for u in filtered if u.is_active is False]

    # 5. search (name, city, state, pincode)
    s = q_search.strip().lower()
    if s:
        filtered = [
            u for u in filtered
            if s in (u.user_name or "").lower()
            or s in (u.city or "").lower()
            or s in (u.state or "").lower()
            or s in (u.pincode or "").lower()
            or s in (u.user_mobile or "").lower()
        ]

    # Deterministic secondary ID sort
    filtered.sort(key=lambda x: (x.user_name.lower(), x.user_id))

    total = len(filtered)
    total_pages = max(1, (total + page_size_val - 1) // page_size_val)
    offset = (p_num - 1) * page_size_val
    paginated_items = filtered[offset : offset + page_size_val]

    return AdminUserLocationListResponse(
        items=paginated_items,
        total=total,
        page=p_num,
        page_size=page_size_val,
        total_pages=total_pages,
    )
