"""Employer financial APIs."""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.security import require_employer
from app.schemas.auth import UserResponse
from app.schemas.financial import (
    FinancialAuditsResponse,
    FinancialAgentConversationCreateResponse,
    FinancialAgentConversationListResponse,
    FinancialAgentHistoryResponse,
    FinancialAgentMessageRequest,
    FinancialAgentTurnResponse,
    FinancialDashboardResponse,
    FinancialSettings,
    FinancialSettingsUpdate,
    InvoiceCreateRequest,
    InvoiceListResponse,
    InvoiceResponse,
)
from app.services.financial_agent_service import FinancialAgentError, FinancialAgentService
from app.services.financial_service import (
    FinancialConflict,
    FinancialNotFound,
    FinancialService,
    FinancialServiceError,
)

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
            if code in {"INVOICE_AMOUNT_OUT_OF_RANGE", "INVOICE_INPUT_INVALID"}
            else status.HTTP_500_INTERNAL_SERVER_ERROR
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
        return InvoiceListResponse(invoices=FinancialService.list_invoices(user, search))
    except (FinancialNotFound, FinancialServiceError) as exc:
        _raise_financial_error(exc)
    except Exception as exc:
        logger.error("Financial invoice listing failed: exception_type=%s", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="FINANCIAL_INVOICES_LOAD_FAILED",
        ) from exc


@router.post("/invoices", response_model=InvoiceResponse, status_code=status.HTTP_201_CREATED)
async def create_financial_invoice(
    request: InvoiceCreateRequest,
    user: UserResponse = Depends(require_employer),
):
    try:
        return FinancialService.create_invoice(user, request)
    except (FinancialNotFound, FinancialConflict, FinancialServiceError) as exc:
        _raise_financial_error(exc)
    except Exception as exc:
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
        _raise_financial_error(exc)
    except Exception as exc:
        logger.error("Financial invoice update failed: exception_type=%s", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="FINANCIAL_INVOICE_UPDATE_FAILED",
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
    request: FinancialSettingsUpdate,
    user: UserResponse = Depends(require_employer),
):
    try:
        return FinancialService.update_settings(user, request)
    except (FinancialNotFound, FinancialServiceError) as exc:
        _raise_financial_error(exc)
    except Exception as exc:
        logger.error("Financial settings save failed: exception_type=%s", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="FINANCIAL_SETTINGS_SAVE_FAILED",
        ) from exc


@router.get("/audits", response_model=FinancialAuditsResponse)
async def list_financial_audits(user: UserResponse = Depends(require_employer)):
    return FinancialAuditsResponse()


@router.post("/scans")
async def create_financial_scan(user: UserResponse = Depends(require_employer)):
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="OCR_DOCUMENT_STORAGE_NOT_CONFIGURED",
    )


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
