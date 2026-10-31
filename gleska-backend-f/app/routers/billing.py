"""Employer billing: wallet, usage and ledger for the caller's own organisation only."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.security import require_employer
from app.schemas.auth import UserResponse
from app.schemas.billing import EmployerUsageReport, WalletSummary
from app.services.billing_service import BillingNotFound, BillingService

router = APIRouter(prefix="/billing", tags=["billing"])


@router.get("/wallet", response_model=WalletSummary, response_model_exclude={"markup_multiplier"})
async def get_wallet(user: UserResponse = Depends(require_employer)):
    try:
        return BillingService.wallet(BillingService.account_for(user))
    except BillingNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/usage", response_model=EmployerUsageReport)
async def get_usage(
    start: datetime | None = Query(default=None),
    end: datetime | None = Query(default=None),
    agent: str | None = Query(default=None, max_length=40),
    model: str | None = Query(default=None, max_length=100),
    status_filter: str | None = Query(default=None, alias="status", pattern="^(reserved|succeeded|failed|rejected|pending_reconciliation)$"),
    limit: int = Query(default=100, ge=1, le=500),
    user: UserResponse = Depends(require_employer),
):
    report = BillingService.usage(
        BillingService.account_for(user), start=start, end=end, agent=agent, model=model,
        status=status_filter, limit=limit,
    )
    return EmployerUsageReport.from_report(report)


@router.get("/ledger")
async def get_ledger(limit: int = Query(default=100, ge=1, le=500), user: UserResponse = Depends(require_employer)):
    return {"entries": BillingService.ledger(BillingService.account_for(user), limit)}
