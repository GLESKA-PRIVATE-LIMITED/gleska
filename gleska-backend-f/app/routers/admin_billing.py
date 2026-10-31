"""Administrator billing console API. Every mutation is attributed and written to billing_audit_logs."""

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status

from app.core.security import require_admin
from app.schemas.auth import UserResponse
from app.schemas.billing import (
    AccountStatusUpdate,
    CreditAdjustment,
    FxRateCreate,
    PricingCreate,
    SettingsCreate,
    UsageReport,
)
from app.services.billing_service import BillingNotFound, BillingService

router = APIRouter(prefix="/admin/billing", tags=["admin-billing"])


def _not_found(exc: Exception) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.get("/pricing")
async def list_pricing(_: UserResponse = Depends(require_admin)):
    return {"pricing": BillingService.list_pricing()}


@router.post("/pricing", status_code=status.HTTP_201_CREATED)
async def create_pricing(payload: PricingCreate, admin: UserResponse = Depends(require_admin)):
    return BillingService.create_pricing(admin, payload)


@router.post("/pricing/{pricing_id}/deactivate")
async def deactivate_pricing(
    pricing_id: UUID,
    reason: str = Body(..., embed=True, min_length=5, max_length=500),
    admin: UserResponse = Depends(require_admin),
):
    try:
        return BillingService.deactivate_pricing(admin, str(pricing_id), reason)
    except BillingNotFound as exc:
        raise _not_found(exc) from exc


@router.get("/fx-rates")
async def list_fx(_: UserResponse = Depends(require_admin)):
    return {"fx_rates": BillingService.list_fx()}


@router.post("/fx-rates", status_code=status.HTTP_201_CREATED)
async def create_fx(payload: FxRateCreate, admin: UserResponse = Depends(require_admin)):
    return BillingService.create_fx(admin, payload)


@router.get("/settings")
async def list_settings(_: UserResponse = Depends(require_admin)):
    return {"settings": BillingService.list_settings()}


@router.post("/settings", status_code=status.HTTP_201_CREATED)
async def create_settings(payload: SettingsCreate, admin: UserResponse = Depends(require_admin)):
    return BillingService.create_settings(admin, payload)


@router.get("/accounts")
async def list_accounts(_: UserResponse = Depends(require_admin)):
    return {"accounts": BillingService.list_accounts()}


@router.post("/accounts/{account_id}/adjust")
async def adjust_credits(account_id: UUID, payload: CreditAdjustment, admin: UserResponse = Depends(require_admin)):
    try:
        return BillingService.adjust(admin, str(account_id), payload)
    except BillingNotFound as exc:
        raise _not_found(exc) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@router.post("/accounts/{account_id}/status")
async def set_account_status(account_id: UUID, payload: AccountStatusUpdate, admin: UserResponse = Depends(require_admin)):
    try:
        return BillingService.set_status(admin, str(account_id), payload)
    except BillingNotFound as exc:
        raise _not_found(exc) from exc


@router.get("/usage", response_model=UsageReport)
async def platform_usage(
    account_id: UUID | None = Query(default=None),
    start: datetime | None = Query(default=None),
    end: datetime | None = Query(default=None),
    agent: str | None = Query(default=None, max_length=40),
    model: str | None = Query(default=None, max_length=100),
    status_filter: str | None = Query(default=None, alias="status", pattern="^(reserved|succeeded|failed|rejected|pending_reconciliation)$"),
    limit: int = Query(default=200, ge=1, le=1000),
    _: UserResponse = Depends(require_admin),
):
    return BillingService.usage(
        str(account_id) if account_id else None, start=start, end=end, agent=agent, model=model,
        status=status_filter, limit=limit,
    )


@router.get("/audit-log")
async def audit_log(limit: int = Query(default=200, ge=1, le=1000), _: UserResponse = Depends(require_admin)):
    return {"entries": BillingService.audit_log(limit)}
