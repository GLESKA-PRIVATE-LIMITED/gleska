"""Employer billing: wallet, usage and ledger for the caller's own organisation only."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status

from app.core.security import require_employer
from app.schemas.auth import UserResponse
from app.schemas.billing import (
    CreditPurchase,
    CreditPurchaseCreate,
    CreditPurchaseOptions,
    CreditPurchaseOrder,
    CreditReceipt,
    EmployerUsageReport,
    WalletSummary,
)
from app.services.billing_service import BillingNotFound, BillingService
from app.services.credit_purchase_service import CreditPurchaseService, PurchaseError, settings_row

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


ORDER_ID = Path(..., pattern=r"^cred_[a-f0-9]{16,32}$")
_PURCHASE_ERROR_STATUS = {
    "PAYMENT_PROVIDER_UNAVAILABLE": status.HTTP_503_SERVICE_UNAVAILABLE,
}


def _purchase_http_error(exc: PurchaseError) -> HTTPException:
    code = str(exc)
    return HTTPException(status_code=_PURCHASE_ERROR_STATUS.get(code, status.HTTP_502_BAD_GATEWAY), detail=code)


@router.get("/purchase-options", response_model=CreditPurchaseOptions)
async def purchase_options(_: UserResponse = Depends(require_employer)):
    return CreditPurchaseOptions(credit_value_inr=settings_row()["credit_value_inr"])


@router.post("/purchases", response_model=CreditPurchaseOrder, status_code=status.HTTP_201_CREATED)
async def create_purchase(payload: CreditPurchaseCreate, user: UserResponse = Depends(require_employer)):
    try:
        return await CreditPurchaseService.create(user, payload.credits)
    except PurchaseError as exc:
        raise _purchase_http_error(exc) from exc


@router.get("/purchases")
async def list_purchases(user: UserResponse = Depends(require_employer)):
    return {"purchases": CreditPurchaseService.list(BillingService.account_for(user))}


@router.post("/purchases/{order_id}/verify", response_model=CreditPurchase)
async def verify_purchase(order_id: str = ORDER_ID, user: UserResponse = Depends(require_employer)):
    try:
        return await CreditPurchaseService.verify(BillingService.account_for(user), order_id)
    except BillingNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PurchaseError as exc:
        raise _purchase_http_error(exc) from exc


@router.get("/purchases/{order_id}/receipt", response_model=CreditReceipt)
async def purchase_receipt(order_id: str = ORDER_ID, user: UserResponse = Depends(require_employer)):
    try:
        return CreditPurchaseService.receipt(BillingService.account_for(user), order_id)
    except BillingNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
