"""Logistics agent persistence (migration 107): vehicle listings (lent) and rental requests (obtained).

Every query is filtered by the caller's employer profile. Prices are server-validated Decimals.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, status
from pydantic import BaseModel, Field, field_validator

from app.core.security import require_employer
from app.core.supabase import supabase
from app.schemas.auth import UserResponse

router = APIRouter(prefix="/logistics", tags=["logistics"])

PriceUnit = Literal["per day", "per trip", "per km", "per ton"]
Money = Annotated[Decimal, Field(ge=0, max_digits=14, decimal_places=2)]
Tons = Annotated[Decimal, Field(ge=0, max_digits=10, decimal_places=2)]
UUID_PATTERN = r"^[0-9a-fA-F-]{36}$"


def _blank_to_none(value: Any) -> Any:
    return None if isinstance(value, str) and not value.strip() else value


class ListingIn(BaseModel):
    model_config = {"protected_namespaces": ()}

    category: str = Field(..., min_length=1, max_length=80)
    vehicle_type: str = Field(..., min_length=1, max_length=80)
    registration_number: str = Field(..., min_length=1, max_length=20)
    make_model: str | None = Field(default=None, max_length=120)
    model_year: int | None = Field(default=None, ge=1950, le=2100)
    capacity_tons: Tons | None = None
    dimensions: str | None = Field(default=None, max_length=120)
    fuel_type: str | None = Field(default=None, max_length=40)
    ownership: str | None = Field(default=None, max_length=60)
    location: str | None = Field(default=None, max_length=200)
    service_area: str | None = Field(default=None, max_length=300)
    available_from: date | None = None
    available_until: date | None = None
    price_amount: Money | None = None
    price_unit: PriceUnit = "per day"
    driver_available: Literal["With Driver", "Without Driver", "On Request"] | None = None
    permitted_usage: str | None = Field(default=None, max_length=300)
    contact_name: str | None = Field(default=None, max_length=120)
    contact_phone: str | None = Field(default=None, max_length=20)
    contact_email: str | None = Field(default=None, max_length=254)
    notes: str | None = Field(default=None, max_length=2000)
    documents: dict[str, bool] = Field(default_factory=dict)
    status: Literal["ACTIVE", "DISPATCHED", "MAINTENANCE"] = "ACTIVE"

    _blanks = field_validator("available_from", "available_until", "model_year", "capacity_tons", "price_amount",
                              mode="before")(_blank_to_none)

    @field_validator("registration_number")
    @classmethod
    def upper(cls, value: str) -> str:
        return value.strip().upper()

    @field_validator("documents")
    @classmethod
    def doc_keys(cls, value: dict[str, bool]) -> dict[str, bool]:
        allowed = {"rcAttached", "fitnessAttached", "insuranceAttached", "permitAttached"}
        return {k: bool(v) for k, v in value.items() if k in allowed}


class RequestIn(BaseModel):
    vehicle_ref: str | None = Field(default=None, max_length=100)
    vehicle_title: str | None = Field(default=None, max_length=200)
    vehicle_registration: str | None = Field(default=None, max_length=20)
    category: str | None = Field(default=None, max_length=80)
    source_location: str = Field(..., min_length=1, max_length=200)
    destination_location: str = Field(..., min_length=1, max_length=200)
    pickup_date: date | None = None
    rental_duration: str | None = Field(default=None, max_length=60)
    offered_price: Money | None = None
    price_unit: PriceUnit | None = None
    driver_required: bool = False
    cargo_type: str | None = Field(default=None, max_length=200)
    instructions: str | None = Field(default=None, max_length=2000)
    status: Literal["SUBMITTED", "CONFIRMED", "IN_TRANSIT", "COMPLETED"] = "SUBMITTED"

    _blanks = field_validator("pickup_date", "offered_price", mode="before")(_blank_to_none)


class StatusIn(BaseModel):
    status: str = Field(..., max_length=20)


class ImportIn(BaseModel):
    listings: list[ListingIn] = Field(default_factory=list, max_length=200)
    requests: list[RequestIn] = Field(default_factory=list, max_length=200)


def _employer_id(user: UserResponse) -> str:
    rows = supabase.table("employer_profiles").select("id").eq("user_id", str(user.id)).limit(1).execute().data or []
    if not rows:
        raise HTTPException(status_code=403, detail="EMPLOYER_PROFILE_REQUIRED")
    return str(rows[0]["id"])


def _row(model: BaseModel, employer_id: str, user: UserResponse) -> dict[str, Any]:
    return {**model.model_dump(mode="json"), "employer_id": employer_id, "user_id": str(user.id)}


@router.get("/vehicles")
async def list_vehicles(user: UserResponse = Depends(require_employer)):
    eid = _employer_id(user)
    rows = supabase.table("logistics_vehicle_listings").select("*").eq("employer_id", eid).neq("status", "ARCHIVED") \
        .order("created_at", desc=True).limit(500).execute().data or []
    return {"vehicles": rows}


@router.post("/vehicles", status_code=status.HTTP_201_CREATED)
async def create_vehicle(payload: ListingIn, user: UserResponse = Depends(require_employer)):
    row = supabase.table("logistics_vehicle_listings").insert(_row(payload, _employer_id(user), user)).execute().data
    return {"vehicle": row[0] if row else None}


@router.patch("/vehicles/{vehicle_id}")
async def update_vehicle_status(payload: StatusIn, vehicle_id: str = Path(..., pattern=UUID_PATTERN), user: UserResponse = Depends(require_employer)):
    if payload.status not in ("ACTIVE", "DISPATCHED", "MAINTENANCE", "ARCHIVED"):
        raise HTTPException(status_code=422, detail="INVALID_STATUS")
    rows = supabase.table("logistics_vehicle_listings").update({"status": payload.status, "updated_at": datetime.now(timezone.utc).isoformat()}) \
        .eq("id", vehicle_id).eq("employer_id", _employer_id(user)).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="VEHICLE_NOT_FOUND")
    return {"vehicle": rows[0]}


@router.get("/rental-requests")
async def list_requests(user: UserResponse = Depends(require_employer)):
    eid = _employer_id(user)
    rows = supabase.table("logistics_rental_requests").select("*").eq("employer_id", eid) \
        .order("created_at", desc=True).limit(500).execute().data or []
    return {"requests": rows}


@router.post("/rental-requests", status_code=status.HTTP_201_CREATED)
async def create_request(payload: RequestIn, user: UserResponse = Depends(require_employer)):
    row = supabase.table("logistics_rental_requests").insert(_row(payload, _employer_id(user), user)).execute().data
    return {"request": row[0] if row else None}


@router.patch("/rental-requests/{request_id}")
async def update_request_status(payload: StatusIn, request_id: str = Path(..., pattern=UUID_PATTERN), user: UserResponse = Depends(require_employer)):
    if payload.status not in ("SUBMITTED", "CONFIRMED", "IN_TRANSIT", "COMPLETED", "CANCELLED"):
        raise HTTPException(status_code=422, detail="INVALID_STATUS")
    rows = supabase.table("logistics_rental_requests").update({"status": payload.status, "updated_at": datetime.now(timezone.utc).isoformat()}) \
        .eq("id", request_id).eq("employer_id", _employer_id(user)).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="REQUEST_NOT_FOUND")
    return {"request": rows[0]}


@router.post("/import")
async def import_browser_data(payload: ImportIn, user: UserResponse = Depends(require_employer)):
    """One-time move of records the website previously kept in localStorage. Skips exact duplicates."""
    eid = _employer_id(user)
    existing = supabase.table("logistics_vehicle_listings").select("registration_number").eq("employer_id", eid) \
        .limit(1000).execute().data or []
    known = {r["registration_number"] for r in existing}
    listings = [_row(item, eid, user) for item in payload.listings if item.registration_number not in known]
    requests = [_row(item, eid, user) for item in payload.requests]
    if listings:
        supabase.table("logistics_vehicle_listings").insert(listings).execute()
    if requests:
        supabase.table("logistics_rental_requests").insert(requests).execute()
    return {"imported_listings": len(listings), "imported_requests": len(requests)}
