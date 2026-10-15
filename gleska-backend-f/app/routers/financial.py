"""Employer financial APIs."""

import logging
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, Response, UploadFile, status
from pydantic import ValidationError

from app.core.security import require_employer
from app.schemas.auth import UserResponse
from app.schemas.financial import (
    FinancialAuditEventsResponse,
    FinancialAuditRun,
    FinancialAuditRunCreateRequest,
    FinancialAuditRunsResponse,
    FinancialAgentConversationCreateResponse,
    FinancialAgentConversationListResponse,
    FinancialAgentHistoryResponse,
    FinancialAgentMessageRequest,
    FinancialAgentTurnResponse,
    FinancialDashboardResponse,
    FinancialInvoicePaymentsResponse,
    FinancialPaymentCreateRequest,
    FinancialPaymentRecord,
    FinancialReceivablesResponse,
    FinancialSettings,
    FinancialSettingsUpdate,
    FinancialScanListResponse,
    FinancialScanRecord,
    FinancialScanReviewRequest,
    FinancialVendorBillLinkRequest,
    FinancialVendorBillRecord,
    FinancialVendorBillResponse,
    FinancialVendorCreateRequest,
    FinancialVendorListResponse,
    FinancialVendorResponse,
    FinancialVendorUpdateRequest,
    InvoiceCreateRequest,
    InvoiceListResponse,
    InvoiceResponse,
)
from app.services.financial_agent_service import FinancialAgentError, FinancialAgentService
from app.services.financial_audit_service import FinancialAuditService
from app.services.financial_service import (
    FinancialConflict,
    FinancialNotFound,
    FinancialService,
    FinancialServiceError,
)
from app.services.financial_scan_service import FinancialScanError, FinancialScanService, MAX_UPLOAD_BYTES
from app.services.financial_vendor_service import FinancialVendorService

router = APIRouter(prefix="/financial", tags=["financial"])
logger = logging.getLogger(__name__)


def _raise_financial_error(exc: Exception) -> None:
    if isinstance(exc, FinancialNotFound):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    if isinstance(exc, FinancialConflict):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if isinstance(exc, FinancialServiceError):
        code = str(exc)
        http_status = (
            status.HTTP_422_UNPROCESSABLE_ENTITY
            if code in {
                "INVOICE_AMOUNT_OUT_OF_RANGE",
                "INVOICE_INPUT_INVALID",
                "PAYMENT_INPUT_INVALID",
                "FINANCIAL_VENDOR_INPUT_INVALID",
            }
            else getattr(exc, "http_status", status.HTTP_500_INTERNAL_SERVER_ERROR)
        )
        raise HTTPException(status_code=http_status, detail=code) from exc
    raise exc


def _raise_financial_agent_error(exc: FinancialAgentError) -> None:
    details = {
        "LLM_CONFIGURATION_ERROR": (
            "Financial Agent is not configured. Configure the existing Gemini provider settings "
            "before enabling conversational responses."
        ),
        "LLM_TIMEOUT": "The configured language provider timed out. Retry the request.",
        "LLM_UNAVAILABLE": "The configured language provider is unavailable. Retry later.",
        "LLM_RATE_LIMITED": "The language provider is rate limited. Retry later.",
        "LLM_PROVIDER_ERROR": "The language provider rejected the request.",
        "LLM_INVALID_RESPONSE": "The language provider returned an invalid response.",
        "AGENT_RUNTIME_FAILED": "The Financial Agent could not complete this turn. Retry later.",
        "FINANCIAL_AGENT_INVOICE_LOOKUP_FAILED": (
            "Invoice lookup failed, so the Financial Agent did not complete this turn. Retry later."
        ),
    }
    raise HTTPException(
        status_code=exc.http_status,
        detail=details.get(exc.code, exc.code),
    ) from exc


@router.get("/dashboard", response_model=FinancialDashboardResponse)
async def get_financial_dashboard(
    search: str | None = Query(default=None, max_length=200),
    user: UserResponse = Depends(require_employer),
):
    try:
        return FinancialService.dashboard(user, search)
    except (FinancialNotFound, FinancialServiceError) as exc:
        _raise_financial_error(exc)
    except Exception as exc:
        logger.error("Financial dashboard failed: exception_type=%s", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="FINANCIAL_DASHBOARD_LOAD_FAILED",
        ) from exc


@router.get("/invoices", response_model=InvoiceListResponse)
async def list_financial_invoices(
    search: str | None = Query(default=None, max_length=200),
    user: UserResponse = Depends(require_employer),
):
    try:
        return InvoiceListResponse(
            invoices=FinancialService.list_invoices(user, search),
            company_details=FinancialService.invoice_company_details(user),
        )
    except (FinancialNotFound, FinancialServiceError) as exc:
        _raise_financial_error(exc)
    except Exception as exc:
        logger.error("Financial invoice listing failed: exception_type=%s", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="FINANCIAL_INVOICES_LOAD_FAILED",
        ) from exc


@router.get("/vendors", response_model=FinancialVendorListResponse)
async def list_financial_vendors(
    search: str | None = Query(default=None, max_length=200),
    active: bool | None = Query(default=None),
    user: UserResponse = Depends(require_employer),
):
    try:
        return FinancialVendorService.list_vendors(user, search, active)
    except (FinancialNotFound, FinancialConflict, FinancialServiceError) as exc:
        _raise_financial_error(exc)
    except Exception as exc:
        logger.error("Financial vendor listing failed: exception_type=%s", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="FINANCIAL_VENDORS_LOAD_FAILED",
        ) from exc


@router.post(
    "/vendors",
    response_model=FinancialVendorResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_financial_vendor(
    request: FinancialVendorCreateRequest,
    user: UserResponse = Depends(require_employer),
):
    try:
        return FinancialVendorService.create_vendor(user, request)
    except (FinancialNotFound, FinancialConflict, FinancialServiceError) as exc:
        _raise_financial_error(exc)
    except Exception as exc:
        logger.error("Financial vendor create failed: exception_type=%s", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="FINANCIAL_VENDOR_CREATE_FAILED",
        ) from exc


@router.get(
    "/vendor-bills/unassigned",
    response_model=list[FinancialVendorBillRecord],
)
async def list_unassigned_financial_vendor_bills(
    user: UserResponse = Depends(require_employer),
):
    try:
        return FinancialVendorService.list_unassigned_bills(user)
    except (FinancialNotFound, FinancialConflict, FinancialServiceError) as exc:
        _raise_financial_error(exc)
    except Exception as exc:
        logger.error("Unassigned financial vendor bills load failed: exception_type=%s", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="FINANCIAL_VENDOR_BILLS_LOAD_FAILED",
        ) from exc


@router.get("/vendors/{vendor_id}", response_model=FinancialVendorResponse)
async def get_financial_vendor(
    vendor_id: UUID,
    user: UserResponse = Depends(require_employer),
):
    try:
        return FinancialVendorService.get_vendor(user, vendor_id)
    except (FinancialNotFound, FinancialConflict, FinancialServiceError) as exc:
        _raise_financial_error(exc)
    except Exception as exc:
        logger.error(
            "Financial vendor detail load failed: vendor_id=%s exception_type=%s",
            vendor_id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="FINANCIAL_VENDOR_LOAD_FAILED",
        ) from exc


@router.put("/vendors/{vendor_id}", response_model=FinancialVendorResponse)
async def update_financial_vendor(
    vendor_id: UUID,
    request: FinancialVendorUpdateRequest,
    user: UserResponse = Depends(require_employer),
):
    try:
        return FinancialVendorService.update_vendor(user, vendor_id, request)
    except (FinancialNotFound, FinancialConflict, FinancialServiceError) as exc:
        _raise_financial_error(exc)
    except Exception as exc:
        logger.error(
            "Financial vendor update failed: vendor_id=%s exception_type=%s",
            vendor_id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="FINANCIAL_VENDOR_UPDATE_FAILED",
        ) from exc


@router.post(
    "/vendor-bills/{bill_id}/vendor",
    response_model=FinancialVendorBillResponse,
)
async def link_financial_vendor_bill(
    bill_id: UUID,
    request: FinancialVendorBillLinkRequest,
    user: UserResponse = Depends(require_employer),
):
    try:
        return FinancialVendorService.link_bill(user, bill_id, request.vendor_id)
    except (FinancialNotFound, FinancialConflict, FinancialServiceError) as exc:
        _raise_financial_error(exc)
    except Exception as exc:
        logger.error(
            "Financial vendor bill association failed: bill_id=%s exception_type=%s",
            bill_id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="FINANCIAL_VENDOR_BILL_LINK_FAILED",
        ) from exc


@router.get("/receivables", response_model=FinancialReceivablesResponse)
async def get_financial_receivables(user: UserResponse = Depends(require_employer)):
    try:
        return FinancialService.receivables(user)
    except (FinancialNotFound, FinancialConflict, FinancialServiceError) as exc:
        _raise_financial_error(exc)
    except Exception as exc:
        logger.error("Financial receivables load failed: exception_type=%s", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="FINANCIAL_RECEIVABLES_LOAD_FAILED",
        ) from exc


@router.get(
    "/invoices/{invoice_id}/payments",
    response_model=FinancialInvoicePaymentsResponse,
)
async def list_financial_invoice_payments(
    invoice_id: UUID,
    user: UserResponse = Depends(require_employer),
):
    try:
        return FinancialService.list_invoice_payments(user, invoice_id)
    except (FinancialNotFound, FinancialConflict, FinancialServiceError) as exc:
        _raise_financial_error(exc)
    except Exception as exc:
        logger.error(
            "Financial invoice payment history failed: invoice_id=%s exception_type=%s",
            invoice_id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="FINANCIAL_PAYMENTS_LOAD_FAILED",
        ) from exc


@router.post(
    "/invoices/{invoice_id}/payments",
    response_model=FinancialPaymentRecord,
    status_code=status.HTTP_201_CREATED,
)
async def record_financial_invoice_payment(
    invoice_id: UUID,
    request: FinancialPaymentCreateRequest,
    user: UserResponse = Depends(require_employer),
):
    try:
        return FinancialService.record_invoice_payment(user, invoice_id, request)
    except (FinancialNotFound, FinancialConflict, FinancialServiceError) as exc:
        _raise_financial_error(exc)
    except Exception as exc:
        logger.error(
            "Financial invoice payment create failed: invoice_id=%s exception_type=%s",
            invoice_id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="FINANCIAL_PAYMENT_RECORD_FAILED",
        ) from exc


@router.post("/invoices", response_model=InvoiceResponse, status_code=status.HTTP_201_CREATED)
async def create_financial_invoice(
    request: InvoiceCreateRequest,
    user: UserResponse = Depends(require_employer),
):
    try:
        return FinancialService.create_invoice(user, request)
    except (FinancialNotFound, FinancialConflict, FinancialServiceError) as exc:
        FinancialService.record_failed_action(
            user,
            "INVOICE_GENERATION_FAILED" if request.action == "generate" else "INVOICE_DRAFT_CREATE_FAILED",
            "invoice",
            None,
            str(exc),
        )
        _raise_financial_error(exc)
    except Exception as exc:
        FinancialService.record_failed_action(
            user,
            "INVOICE_GENERATION_FAILED" if request.action == "generate" else "INVOICE_DRAFT_CREATE_FAILED",
            "invoice",
            None,
            "FINANCIAL_INVOICE_CREATE_FAILED",
        )
        logger.error("Financial invoice create failed: exception_type=%s", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="FINANCIAL_INVOICE_CREATE_FAILED",
        ) from exc


@router.put("/invoices/{invoice_id}", response_model=InvoiceResponse)
async def update_financial_invoice(
    invoice_id: UUID,
    request: InvoiceCreateRequest,
    user: UserResponse = Depends(require_employer),
):
    try:
        return FinancialService.update_invoice(user, invoice_id, request)
    except (FinancialNotFound, FinancialConflict, FinancialServiceError) as exc:
        FinancialService.record_failed_action(
            user,
            "INVOICE_GENERATION_FAILED" if request.action == "generate" else "INVOICE_DRAFT_UPDATE_FAILED",
            "invoice",
            str(invoice_id),
            str(exc),
        )
        _raise_financial_error(exc)
    except Exception as exc:
        FinancialService.record_failed_action(
            user,
            "INVOICE_GENERATION_FAILED" if request.action == "generate" else "INVOICE_DRAFT_UPDATE_FAILED",
            "invoice",
            str(invoice_id),
            "FINANCIAL_INVOICE_UPDATE_FAILED",
        )
        logger.error("Financial invoice update failed: exception_type=%s", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="FINANCIAL_INVOICE_UPDATE_FAILED",
        ) from exc


@router.delete("/invoices/{invoice_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_financial_invoice(
    invoice_id: UUID,
    user: UserResponse = Depends(require_employer),
):
    try:
        FinancialService.delete_invoice(user, invoice_id)
    except (FinancialNotFound, FinancialConflict, FinancialServiceError) as exc:
        FinancialService.record_failed_action(
            user, "INVOICE_DRAFT_DELETE_FAILED", "invoice", str(invoice_id), str(exc)
        )
        _raise_financial_error(exc)
    except Exception as exc:
        FinancialService.record_failed_action(
            user, "INVOICE_DRAFT_DELETE_FAILED", "invoice", str(invoice_id),
            "FINANCIAL_INVOICE_DELETE_FAILED",
        )
        logger.error("Financial invoice delete failed: exception_type=%s", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="FINANCIAL_INVOICE_DELETE_FAILED",
        ) from exc


@router.get("/settings", response_model=FinancialSettings)
async def get_financial_settings(user: UserResponse = Depends(require_employer)):
    try:
        return FinancialService.get_settings(user)
    except (FinancialNotFound, FinancialServiceError) as exc:
        _raise_financial_error(exc)
    except Exception as exc:
        logger.error("Financial settings load failed: exception_type=%s", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="FINANCIAL_SETTINGS_LOAD_FAILED",
        ) from exc


@router.put("/settings", response_model=FinancialSettings)
async def update_financial_settings(
    request: dict[str, object],
    user: UserResponse = Depends(require_employer),
):
    try:
        validated_request = FinancialSettingsUpdate.model_validate(request)
    except ValidationError as exc:
        FinancialService.record_failed_action(
            user,
            "FINANCIAL_SETTINGS_UPDATE_FAILED",
            "financial_settings",
            None,
            "FINANCIAL_SETTINGS_INPUT_INVALID",
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Financial settings are invalid. Check the supported currency and tax identifier.",
        ) from exc

    try:
        return FinancialService.update_settings(user, validated_request)
    except (FinancialNotFound, FinancialServiceError) as exc:
        FinancialService.record_failed_action(
            user, "FINANCIAL_SETTINGS_UPDATE_FAILED", "financial_settings", None, str(exc)
        )
        _raise_financial_error(exc)
    except Exception as exc:
        FinancialService.record_failed_action(
            user, "FINANCIAL_SETTINGS_UPDATE_FAILED", "financial_settings", None,
            "FINANCIAL_SETTINGS_SAVE_FAILED",
        )
        logger.error("Financial settings save failed: exception_type=%s", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="FINANCIAL_SETTINGS_SAVE_FAILED",
        ) from exc


@router.get("/audits", response_model=FinancialAuditEventsResponse)
async def list_financial_audits(
    action: str | None = Query(default=None, max_length=100),
    outcome: str | None = Query(default=None, pattern="^(SUCCESS|FAILURE)$"),
    user: UserResponse = Depends(require_employer),
):
    try:
        return FinancialAuditEventsResponse(audits=FinancialService.list_audits(user, action, outcome))
    except (FinancialNotFound, FinancialServiceError) as exc:
        _raise_financial_error(exc)
    except Exception as exc:
        logger.error("Financial audit listing failed: exception_type=%s", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="FINANCIAL_AUDITS_LOAD_FAILED",
        ) from exc


@router.get("/audit-runs", response_model=FinancialAuditRunsResponse)
async def list_financial_audit_runs(user: UserResponse = Depends(require_employer)):
    try:
        return FinancialAuditService.list_runs(user)
    except (FinancialNotFound, FinancialConflict, FinancialServiceError) as exc:
        _raise_financial_error(exc)
    except Exception as exc:
        logger.error("Financial audit run listing failed: exception_type=%s", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="FINANCIAL_AUDIT_RUNS_LOAD_FAILED",
        ) from exc


@router.post(
    "/audit-runs",
    response_model=FinancialAuditRun,
    status_code=status.HTTP_201_CREATED,
)
async def start_financial_audit_run(
    request: FinancialAuditRunCreateRequest,
    user: UserResponse = Depends(require_employer),
):
    try:
        return FinancialAuditService.start_run(user, request.idempotency_key)
    except (FinancialNotFound, FinancialConflict, FinancialServiceError) as exc:
        _raise_financial_error(exc)
    except Exception as exc:
        logger.error("Financial audit run failed: exception_type=%s", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="FINANCIAL_AUDIT_RUN_FAILED",
        ) from exc


@router.get("/audit-runs/{run_id}", response_model=FinancialAuditRun)
async def get_financial_audit_run(
    run_id: UUID,
    user: UserResponse = Depends(require_employer),
):
    try:
        return FinancialAuditService.get_run(user, run_id)
    except (FinancialNotFound, FinancialConflict, FinancialServiceError) as exc:
        _raise_financial_error(exc)
    except Exception as exc:
        logger.error(
            "Financial audit run detail failed: run_id=%s exception_type=%s",
            run_id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="FINANCIAL_AUDIT_RUN_LOAD_FAILED",
        ) from exc


@router.post("/scans", response_model=FinancialScanRecord, status_code=status.HTTP_202_ACCEPTED)
async def create_financial_scan(
    background_tasks: BackgroundTasks,
    response: Response,
    file: UploadFile = File(...),
    user: UserResponse = Depends(require_employer),
):
    try:
        content = await file.read(MAX_UPLOAD_BYTES + 1)
        scan, duplicate = FinancialScanService.submit(
            user, file.filename, file.content_type or "", content
        )
        if duplicate:
            response.status_code = status.HTTP_200_OK
        if scan.status == "QUEUED":
            background_tasks.add_task(
                FinancialScanService.process_scan, str(scan.id), str(user.id),
                FinancialService._employer_scope(user)[1],
            )
        return scan
    except (FinancialNotFound, FinancialScanError, FinancialServiceError) as exc:
        _raise_financial_error(exc)
    except Exception as exc:
        logger.error("Financial scan upload failed: exception_type=%s", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="SCAN_SUBMIT_FAILED",
        ) from exc


@router.get("/scans", response_model=FinancialScanListResponse)
async def list_financial_scans(user: UserResponse = Depends(require_employer)):
    try:
        return FinancialScanListResponse(scans=FinancialScanService.list_scans(user))
    except (FinancialNotFound, FinancialScanError, FinancialServiceError) as exc:
        _raise_financial_error(exc)


@router.get("/scans/{scan_id}", response_model=FinancialScanRecord)
async def get_financial_scan(scan_id: UUID, user: UserResponse = Depends(require_employer)):
    try:
        return FinancialScanService.get_scan(user, scan_id)
    except (FinancialNotFound, FinancialScanError, FinancialServiceError) as exc:
        _raise_financial_error(exc)


@router.post("/scans/{scan_id}/retry", response_model=FinancialScanRecord, status_code=status.HTTP_202_ACCEPTED)
async def retry_financial_scan(
    scan_id: UUID,
    background_tasks: BackgroundTasks,
    user: UserResponse = Depends(require_employer),
):
    try:
        employer_id = FinancialService._employer_scope(user)[1]
        scan = FinancialScanService.retry_scan(user, scan_id)
        background_tasks.add_task(
            FinancialScanService.process_scan, str(scan.id), str(user.id),
            employer_id,
        )
        return scan
    except (FinancialNotFound, FinancialScanError, FinancialServiceError) as exc:
        if str(exc) != "FINANCIAL_AUDIT_WRITE_FAILED":
            FinancialService.record_failed_action(
                user, "SCAN_PROCESSING_RETRY_FAILED", "financial_invoice_scan",
                str(scan_id), str(exc),
            )
        _raise_financial_error(exc)


@router.put("/scans/{scan_id}/review", response_model=FinancialScanRecord)
async def review_financial_scan(
    scan_id: UUID,
    request: FinancialScanReviewRequest,
    user: UserResponse = Depends(require_employer),
):
    try:
        return FinancialScanService.save_review(user, scan_id, request.result)
    except (FinancialNotFound, FinancialScanError, FinancialServiceError) as exc:
        if str(exc) != "FINANCIAL_AUDIT_WRITE_FAILED":
            FinancialService.record_failed_action(
                user, "SCAN_RESULT_REVIEW_FAILED", "financial_invoice_scan",
                str(scan_id), str(exc),
            )
        _raise_financial_error(exc)


@router.post(
    "/scans/{scan_id}/confirm",
    response_model=FinancialVendorBillResponse,
    status_code=status.HTTP_201_CREATED,
)
async def confirm_financial_scan(
    scan_id: UUID,
    request: FinancialScanReviewRequest,
    user: UserResponse = Depends(require_employer),
):
    try:
        return FinancialScanService.confirm_scan(user, scan_id, request.result)
    except (FinancialNotFound, FinancialScanError, FinancialServiceError) as exc:
        if str(exc) != "FINANCIAL_AUDIT_WRITE_FAILED":
            FinancialService.record_failed_action(
                user, "SCAN_BILL_CONFIRMATION_FAILED", "financial_invoice_scan",
                str(scan_id), str(exc),
            )
        _raise_financial_error(exc)


@router.post(
    "/conversations",
    response_model=FinancialAgentConversationCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_financial_agent_conversation(user: UserResponse = Depends(require_employer)):
    try:
        return FinancialAgentService.create_conversation(user)
    except FinancialAgentError as exc:
        _raise_financial_agent_error(exc)


@router.get("/conversations", response_model=FinancialAgentConversationListResponse)
async def list_financial_agent_conversations(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    user: UserResponse = Depends(require_employer),
):
    try:
        return FinancialAgentService.list_conversations(user, page, page_size)
    except FinancialAgentError as exc:
        _raise_financial_agent_error(exc)


@router.get(
    "/conversations/{conversation_id}",
    response_model=FinancialAgentConversationCreateResponse,
)
async def get_financial_agent_conversation(
    conversation_id: str,
    user: UserResponse = Depends(require_employer),
):
    try:
        parsed_id = UUID(conversation_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="INVALID_CONVERSATION_ID") from exc
    try:
        return FinancialAgentService.get_conversation(user, parsed_id)
    except FinancialAgentError as exc:
        _raise_financial_agent_error(exc)


@router.get(
    "/conversations/{conversation_id}/history",
    response_model=FinancialAgentHistoryResponse,
)
async def get_financial_agent_history(
    conversation_id: str,
    page_size: int = Query(default=80, ge=1, le=100),
    cursor: int | None = Query(default=None, ge=1),
    user: UserResponse = Depends(require_employer),
):
    try:
        parsed_id = UUID(conversation_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="INVALID_CONVERSATION_ID") from exc
    try:
        return FinancialAgentService.get_history(user, parsed_id, page_size, cursor)
    except FinancialAgentError as exc:
        _raise_financial_agent_error(exc)


@router.post(
    "/conversations/{conversation_id}/messages",
    response_model=FinancialAgentTurnResponse,
)
async def send_financial_agent_message(
    conversation_id: str,
    request: FinancialAgentMessageRequest,
    user: UserResponse = Depends(require_employer),
):
    try:
        parsed_id = UUID(conversation_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="INVALID_CONVERSATION_ID") from exc
    try:
        return await FinancialAgentService.send_message(user, parsed_id, request)
    except FinancialAgentError as exc:
        _raise_financial_agent_error(exc)
