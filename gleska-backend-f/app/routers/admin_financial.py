"""Super Admin read-only financial reporting endpoints."""

import logging
from datetime import date
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.security import require_admin
from app.schemas.admin_financial import (
    AdminFinancialAuditRun,
    AdminFinancialAuditRunPage,
    AdminFinancialInvoiceDetail,
    AdminFinancialInvoicePage,
    AdminFinancialOverview,
    AdminFinancialPaymentPage,
    AdminFinancialVendorBillDetail,
    AdminFinancialVendorBillPage,
    AdminFinancialVendorDetail,
    AdminFinancialVendorPage,
)
from app.services.admin_financial_service import AdminFinancialService

logger = logging.getLogger(__name__)
router = APIRouter(
    prefix="/admin/financial",
    tags=["admin-financial"],
    dependencies=[Depends(require_admin)],
)


def _load(error_code: str, operation):
    try:
        return operation()
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Super Admin financial read failed: operation=%s", error_code)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=error_code,
        ) from exc


@router.get("/overview", response_model=AdminFinancialOverview)
async def get_financial_overview():
    return _load("ADMIN_FINANCIAL_OVERVIEW_LOAD_FAILED", AdminFinancialService.overview)


@router.get("/invoices", response_model=AdminFinancialInvoicePage)
async def list_financial_invoices(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    search: str | None = Query(default=None, max_length=200),
    employer: str | None = Query(default=None, max_length=160),
    employer_id: UUID | None = None,
    invoice_status: Literal["DRAFT", "GENERATED"] | None = Query(default=None, alias="status"),
    issue_date_from: date | None = None,
    issue_date_to: date | None = None,
    due_date_from: date | None = None,
    due_date_to: date | None = None,
):
    if issue_date_from and issue_date_to and issue_date_from > issue_date_to:
        raise HTTPException(status_code=422, detail="ISSUE_DATE_RANGE_INVALID")
    if due_date_from and due_date_to and due_date_from > due_date_to:
        raise HTTPException(status_code=422, detail="DUE_DATE_RANGE_INVALID")
    return _load(
        "ADMIN_FINANCIAL_INVOICES_LOAD_FAILED",
        lambda: AdminFinancialService.list_invoices(
            page=page,
            page_size=page_size,
            search=search,
            employer=employer,
            employer_id=employer_id,
            invoice_status=invoice_status,
            issue_date_from=issue_date_from,
            issue_date_to=issue_date_to,
            due_date_from=due_date_from,
            due_date_to=due_date_to,
        ),
    )


@router.get("/invoices/{invoice_id}", response_model=AdminFinancialInvoiceDetail)
async def get_financial_invoice(invoice_id: UUID):
    return _load(
        "ADMIN_FINANCIAL_INVOICE_LOAD_FAILED",
        lambda: AdminFinancialService.get_invoice(invoice_id),
    )


@router.get("/payments", response_model=AdminFinancialPaymentPage)
async def list_financial_payments(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    search: str | None = Query(default=None, max_length=200),
    employer: str | None = Query(default=None, max_length=160),
    employer_id: UUID | None = None,
    invoice_id: UUID | None = None,
    payment_date_from: date | None = None,
    payment_date_to: date | None = None,
):
    if payment_date_from and payment_date_to and payment_date_from > payment_date_to:
        raise HTTPException(status_code=422, detail="PAYMENT_DATE_RANGE_INVALID")
    return _load(
        "ADMIN_FINANCIAL_PAYMENTS_LOAD_FAILED",
        lambda: AdminFinancialService.list_payments(
            page=page,
            page_size=page_size,
            search=search,
            employer=employer,
            employer_id=employer_id,
            invoice_id=invoice_id,
            payment_date_from=payment_date_from,
            payment_date_to=payment_date_to,
        ),
    )


@router.get("/vendors", response_model=AdminFinancialVendorPage)
async def list_financial_vendors(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    search: str | None = Query(default=None, max_length=200),
    employer: str | None = Query(default=None, max_length=160),
    employer_id: UUID | None = None,
    active: bool | None = None,
):
    return _load(
        "ADMIN_FINANCIAL_VENDORS_LOAD_FAILED",
        lambda: AdminFinancialService.list_vendors(
            page=page,
            page_size=page_size,
            search=search,
            employer=employer,
            employer_id=employer_id,
            active=active,
        ),
    )


@router.get("/vendors/{vendor_id}", response_model=AdminFinancialVendorDetail)
async def get_financial_vendor(
    vendor_id: UUID,
    bill_page: int = Query(default=1, ge=1),
    bill_page_size: int = Query(default=25, ge=1, le=100),
):
    return _load(
        "ADMIN_FINANCIAL_VENDOR_LOAD_FAILED",
        lambda: AdminFinancialService.get_vendor(
            vendor_id,
            bill_page=bill_page,
            bill_page_size=bill_page_size,
        ),
    )


@router.get("/vendor-bills", response_model=AdminFinancialVendorBillPage)
async def list_financial_vendor_bills(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    search: str | None = Query(default=None, max_length=200),
    employer: str | None = Query(default=None, max_length=160),
    employer_id: UUID | None = None,
    vendor_id: UUID | None = None,
    unassigned: bool | None = None,
    confirmed_from: date | None = None,
    confirmed_to: date | None = None,
):
    if confirmed_from and confirmed_to and confirmed_from > confirmed_to:
        raise HTTPException(status_code=422, detail="CONFIRMED_DATE_RANGE_INVALID")
    return _load(
        "ADMIN_FINANCIAL_VENDOR_BILLS_LOAD_FAILED",
        lambda: AdminFinancialService.list_vendor_bills(
            page=page,
            page_size=page_size,
            search=search,
            employer=employer,
            employer_id=employer_id,
            vendor_id=vendor_id,
            unassigned=unassigned,
            confirmed_from=confirmed_from,
            confirmed_to=confirmed_to,
        ),
    )


@router.get("/vendor-bills/{bill_id}", response_model=AdminFinancialVendorBillDetail)
async def get_financial_vendor_bill(bill_id: UUID):
    return _load(
        "ADMIN_FINANCIAL_VENDOR_BILL_LOAD_FAILED",
        lambda: AdminFinancialService.get_vendor_bill(bill_id),
    )


@router.get("/audit-runs", response_model=AdminFinancialAuditRunPage)
async def list_financial_audit_runs(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    employer: str | None = Query(default=None, max_length=160),
    employer_id: UUID | None = None,
    run_status: Literal["RUNNING", "COMPLETED", "FAILED"] | None = Query(default=None, alias="status"),
    started_from: date | None = None,
    started_to: date | None = None,
):
    if started_from and started_to and started_from > started_to:
        raise HTTPException(status_code=422, detail="AUDIT_DATE_RANGE_INVALID")
    return _load(
        "ADMIN_FINANCIAL_AUDIT_RUNS_LOAD_FAILED",
        lambda: AdminFinancialService.list_audit_runs(
            page=page,
            page_size=page_size,
            employer=employer,
            employer_id=employer_id,
            run_status=run_status,
            started_from=started_from,
            started_to=started_to,
        ),
    )


@router.get("/audit-runs/{run_id}", response_model=AdminFinancialAuditRun)
async def get_financial_audit_run(run_id: UUID):
    return _load(
        "ADMIN_FINANCIAL_AUDIT_RUN_LOAD_FAILED",
        lambda: AdminFinancialService.get_audit_run(run_id),
    )
