"""Authenticated Procurement Phase 1 endpoints."""

import logging
from typing import Union
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from app.core.security import get_current_user, require_employer
from app.schemas.auth import UserResponse
from app.schemas.procurement import (
    ProcurementConversationCreateResponse,
    ProcurementConversationHistoryPage,
    ProcurementConversationListResponse,
    ProcurementConversationMessageRequest,
    ProcurementDraftUpdateRequest,
    ProcurementMaterialRequestListResponse,
    ProcurementMaterialRequestPatch,
    ProcurementMaterialRequestResponse,
    ProcurementSaveRequest,
    ProcurementSettings,
    ProcurementSettingsUpdate,
    ProcurementSupplierDiscoveryResponse,
    ProcurementWorkspacePreferenceUpdate,
    ProcurementWorkspacesResponse,
)
from app.schemas.rfq import (
    ProcurementQuotationSelectionRequest,
    ProcurementRFQCreateRequest,
    ProcurementRFQListResponse,
    ProcurementRFQResponse,
    ProcurementRFQUpdateRequest,
    PurchaseOrderListResponse,
    PurchaseOrderResponse,
)
from app.services.rfq_service import RFQService, RFQServiceError
from app.services.procurement_service import (
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    ProcurementAgentError,
    ProcurementConflict,
    ProcurementNotFound,
    ProcurementService,
    ProcurementServiceError,
)
from app.services.procurement_workspace_service import ProcurementWorkspaceService

router = APIRouter(prefix="/procurement", tags=["procurement"])
logger = logging.getLogger(__name__)


@router.get("/workspaces", response_model=ProcurementWorkspacesResponse)
async def get_procurement_workspaces(
    user: UserResponse = Depends(get_current_user),
):
    try:
        return ProcurementWorkspaceService.get_workspaces(user)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(
            "Procurement workspace load failed: user_id=%s exception_type=%s",
            user.id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="PROCUREMENT_WORKSPACES_LOAD_FAILED",
        ) from exc


@router.put("/workspaces/preference", response_model=ProcurementWorkspacesResponse)
async def update_procurement_workspace_preference(
    request: ProcurementWorkspacePreferenceUpdate,
    user: UserResponse = Depends(get_current_user),
):
    try:
        return ProcurementWorkspaceService.update_preference(user, request)
    except PermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(
            "Procurement workspace preference update failed: user_id=%s exception_type=%s",
            user.id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="PROCUREMENT_WORKSPACE_PREFERENCE_UPDATE_FAILED",
        ) from exc


@router.get("/settings", response_model=ProcurementSettings)
async def get_procurement_settings(
    user: UserResponse = Depends(require_employer),
):
    try:
        return ProcurementService.get_procurement_settings(user)
    except Exception as exc:
        if isinstance(exc, ProcurementServiceError) or isinstance(exc, PermissionError):
            _raise_procurement_error(exc)
        logger.error(
            "Procurement settings load failed: user_id=%s exception_type=%s",
            user.id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="PROCUREMENT_SETTINGS_LOAD_FAILED",
        ) from exc


@router.put("/settings", response_model=ProcurementSettings)
async def update_procurement_settings(
    request: ProcurementSettingsUpdate,
    user: UserResponse = Depends(require_employer),
):
    try:
        return ProcurementService.update_procurement_settings(user, request)
    except Exception as exc:
        if isinstance(exc, ProcurementServiceError) or isinstance(exc, PermissionError):
            _raise_procurement_error(exc)
        logger.error(
            "Procurement settings save failed: user_id=%s exception_type=%s",
            user.id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="PROCUREMENT_SETTINGS_SAVE_FAILED",
        ) from exc


def _raise_procurement_error(exc: Exception) -> None:
    if isinstance(exc, ProcurementNotFound):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    if isinstance(exc, ProcurementConflict):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if isinstance(exc, ProcurementAgentError):
        if str(exc) == "LLM_RATE_LIMITED":
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=str(exc),
                headers={"Retry-After": "30"},
            ) from exc
        http_status = (
            status.HTTP_502_BAD_GATEWAY
            if "INVALID" in str(exc)
            else status.HTTP_503_SERVICE_UNAVAILABLE
        )
        raise HTTPException(status_code=http_status, detail=str(exc)) from exc
    if isinstance(exc, PermissionError):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    if isinstance(exc, ProcurementServiceError):
        if str(exc) == "PAGINATION_CURSOR_INVALID":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(exc),
            ) from exc
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
    raise exc


def _raise_rfq_error(exc: RFQServiceError) -> None:
    raise HTTPException(status_code=exc.http_status, detail=exc.code) from exc


@router.post(
    "/rfqs",
    response_model=ProcurementRFQResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_procurement_rfq(
    request: ProcurementRFQCreateRequest,
    user: UserResponse = Depends(require_employer),
):
    try:
        return RFQService.create(user, request)
    except RFQServiceError as exc:
        _raise_rfq_error(exc)
    except Exception as exc:
        logger.error(
            "Procurement RFQ create failed: user_id=%s exception_type=%s",
            user.id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="RFQ_CREATE_FAILED",
        ) from exc


@router.put("/rfqs/{rfq_id}", response_model=ProcurementRFQResponse)
async def update_procurement_rfq(
    rfq_id: UUID,
    request: ProcurementRFQUpdateRequest,
    user: UserResponse = Depends(require_employer),
):
    try:
        return RFQService.update_buyer(user, rfq_id, request)
    except RFQServiceError as exc:
        _raise_rfq_error(exc)
    except Exception as exc:
        logger.error(
            "Procurement RFQ update failed: user_id=%s rfq_id=%s exception_type=%s",
            user.id,
            rfq_id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="RFQ_UPDATE_FAILED",
        ) from exc


@router.post("/rfqs/{rfq_id}/close", response_model=ProcurementRFQResponse)
async def close_procurement_rfq(
    rfq_id: UUID,
    user: UserResponse = Depends(require_employer),
):
    try:
        return RFQService.close_buyer(user, rfq_id)
    except RFQServiceError as exc:
        _raise_rfq_error(exc)
    except Exception as exc:
        logger.error(
            "Procurement RFQ close failed: user_id=%s rfq_id=%s exception_type=%s",
            user.id,
            rfq_id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="RFQ_CLOSE_FAILED",
        ) from exc


@router.get(
    "/rfqs",
    response_model=Union[list[ProcurementRFQResponse], ProcurementRFQListResponse],
)
async def list_procurement_rfqs(
    response: Response,
    page: int | None = Query(default=None, ge=1),
    page_size: int | None = Query(default=None, ge=1, le=MAX_PAGE_SIZE),
    user: UserResponse = Depends(require_employer),
):
    try:
        legacy_response = page is None and page_size is None
        result = RFQService.list_buyer(
            user,
            page or 1,
            MAX_PAGE_SIZE if legacy_response else page_size or DEFAULT_PAGE_SIZE,
        )
        if legacy_response:
            response.headers["X-Results-Truncated"] = str(result.has_more).lower()
            return result.items
        return result
    except RFQServiceError as exc:
        _raise_rfq_error(exc)
    except Exception as exc:
        logger.error(
            "Procurement RFQ list failed: user_id=%s exception_type=%s",
            user.id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="RFQ_LIST_FAILED",
        ) from exc


@router.get("/rfqs/{rfq_id}", response_model=ProcurementRFQResponse)
async def get_procurement_rfq(
    rfq_id: UUID,
    user: UserResponse = Depends(require_employer),
):
    try:
        return RFQService.get_buyer(user, rfq_id)
    except RFQServiceError as exc:
        _raise_rfq_error(exc)
    except Exception as exc:
        logger.error(
            "Procurement RFQ load failed: user_id=%s rfq_id=%s exception_type=%s",
            user.id,
            rfq_id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="RFQ_LOAD_FAILED",
        ) from exc


@router.get(
    "/purchase-orders",
    response_model=Union[list[PurchaseOrderResponse], PurchaseOrderListResponse],
)
async def list_procurement_purchase_orders(
    response: Response,
    page: int | None = Query(default=None, ge=1),
    page_size: int | None = Query(default=None, ge=1, le=MAX_PAGE_SIZE),
    user: UserResponse = Depends(require_employer),
):
    try:
        legacy_response = page is None and page_size is None
        result = RFQService.list_purchase_orders_buyer(
            user,
            page or 1,
            MAX_PAGE_SIZE if legacy_response else page_size or DEFAULT_PAGE_SIZE,
        )
        if legacy_response:
            response.headers["X-Results-Truncated"] = str(result.has_more).lower()
            return result.items
        return result
    except RFQServiceError as exc:
        _raise_rfq_error(exc)
    except Exception as exc:
        logger.error(
            "Purchase order list failed: user_id=%s exception_type=%s",
            user.id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="PURCHASE_ORDER_LIST_FAILED",
        ) from exc


@router.post(
    "/rfqs/{rfq_id}/select-quotation",
    response_model=PurchaseOrderResponse,
    status_code=status.HTTP_201_CREATED,
)
async def select_procurement_quotation(
    rfq_id: UUID,
    request: ProcurementQuotationSelectionRequest,
    user: UserResponse = Depends(require_employer),
):
    try:
        return RFQService.select_quotation(user, rfq_id, request)
    except RFQServiceError as exc:
        _raise_rfq_error(exc)
    except Exception as exc:
        logger.error(
            "Procurement quotation selection failed: user_id=%s rfq_id=%s exception_type=%s",
            user.id,
            rfq_id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="QUOTATION_SELECTION_FAILED",
        ) from exc


@router.post(
    "/purchase-orders/{order_id}/cancel",
    response_model=PurchaseOrderResponse,
)
async def cancel_procurement_purchase_order(
    order_id: UUID,
    user: UserResponse = Depends(require_employer),
):
    try:
        return RFQService.cancel_purchase_order(user, order_id)
    except RFQServiceError as exc:
        _raise_rfq_error(exc)
    except Exception as exc:
        logger.error(
            "Purchase order cancellation failed: user_id=%s order_id=%s exception_type=%s",
            user.id,
            order_id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="PURCHASE_ORDER_UPDATE_FAILED",
        ) from exc


@router.post(
    "/conversations",
    response_model=ProcurementConversationCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_procurement_conversation(
    user: UserResponse = Depends(require_employer),
):
    try:
        return ProcurementService.create_conversation(user)
    except Exception as exc:
        if isinstance(exc, ProcurementServiceError) or isinstance(exc, PermissionError):
            _raise_procurement_error(exc)
        logger.error(
            "Procurement conversation create failed: user_id=%s exception_type=%s",
            user.id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="PROCUREMENT_CONVERSATION_CREATE_FAILED",
        ) from exc


@router.get(
    "/conversations",
    response_model=Union[
        list[ProcurementConversationCreateResponse],
        ProcurementConversationListResponse,
    ],
)
async def list_procurement_conversations(
    response: Response,
    page: int | None = Query(default=None, ge=1),
    page_size: int | None = Query(default=None, ge=1, le=MAX_PAGE_SIZE),
    cursor: str | None = Query(default=None, max_length=300),
    user: UserResponse = Depends(require_employer),
):
    try:
        legacy_response = page is None and page_size is None
        result = ProcurementService.list_conversations(
            user,
            page or 1,
            MAX_PAGE_SIZE if legacy_response else page_size or DEFAULT_PAGE_SIZE,
            cursor,
        )
        if legacy_response:
            response.headers["X-Results-Truncated"] = str(result.has_more).lower()
            return result.items
        return result
    except Exception as exc:
        if isinstance(exc, ProcurementServiceError) or isinstance(exc, PermissionError):
            _raise_procurement_error(exc)
        logger.error(
            "Procurement conversation list failed: user_id=%s exception_type=%s",
            user.id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="PROCUREMENT_CONVERSATION_LIST_FAILED",
        ) from exc


@router.get(
    "/conversations/{conversation_id}",
    response_model=ProcurementConversationCreateResponse,
)
async def get_procurement_conversation(
    conversation_id: UUID,
    user: UserResponse = Depends(require_employer),
):
    try:
        return ProcurementService.get_conversation(user, conversation_id)
    except Exception as exc:
        if isinstance(exc, ProcurementServiceError) or isinstance(exc, PermissionError):
            _raise_procurement_error(exc)
        logger.error(
            "Procurement conversation load failed: user_id=%s conversation_id=%s exception_type=%s",
            user.id,
            conversation_id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="PROCUREMENT_CONVERSATION_LOAD_FAILED",
        ) from exc


@router.get(
    "/conversations/{conversation_id}/history",
    response_model=ProcurementConversationHistoryPage,
)
async def list_procurement_conversation_history(
    conversation_id: UUID,
    page_size: int = Query(default=80, ge=1, le=MAX_PAGE_SIZE),
    cursor: str | None = Query(default=None, max_length=100),
    user: UserResponse = Depends(require_employer),
):
    try:
        return ProcurementService.list_conversation_history(
            user,
            conversation_id,
            page_size,
            cursor,
        )
    except Exception as exc:
        if isinstance(exc, ProcurementServiceError) or isinstance(exc, PermissionError):
            _raise_procurement_error(exc)
        logger.error(
            "Procurement conversation history load failed: user_id=%s conversation_id=%s exception_type=%s",
            user.id,
            conversation_id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="PROCUREMENT_CONVERSATION_HISTORY_LOAD_FAILED",
        ) from exc


@router.post(
    "/conversations/{conversation_id}/messages",
    response_model=ProcurementConversationCreateResponse,
)
async def send_procurement_message(
    conversation_id: UUID,
    request: ProcurementConversationMessageRequest,
    user: UserResponse = Depends(require_employer),
):
    try:
        return await ProcurementService.process_message(user, conversation_id, request)
    except Exception as exc:
        if isinstance(exc, ProcurementServiceError) or isinstance(exc, PermissionError):
            _raise_procurement_error(exc)
        logger.error(
            "Procurement message processing failed: user_id=%s conversation_id=%s exception_type=%s",
            user.id,
            conversation_id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="PROCUREMENT_AGENT_FAILED",
        ) from exc


@router.patch(
    "/conversations/{conversation_id}/draft",
    response_model=ProcurementConversationCreateResponse,
)
async def update_procurement_draft(
    conversation_id: UUID,
    request: ProcurementDraftUpdateRequest,
    user: UserResponse = Depends(require_employer),
):
    try:
        return ProcurementService.update_draft(user, conversation_id, request)
    except Exception as exc:
        if isinstance(exc, ProcurementServiceError) or isinstance(exc, PermissionError):
            _raise_procurement_error(exc)
        logger.error(
            "Procurement draft update failed: user_id=%s conversation_id=%s exception_type=%s",
            user.id,
            conversation_id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="PROCUREMENT_DRAFT_UPDATE_FAILED",
        ) from exc


@router.post(
    "/conversations/{conversation_id}/save",
    response_model=ProcurementMaterialRequestResponse,
    status_code=status.HTTP_201_CREATED,
)
async def save_procurement_request(
    conversation_id: UUID,
    request: ProcurementSaveRequest,
    user: UserResponse = Depends(require_employer),
):
    try:
        return ProcurementService.save_material_request(user, conversation_id, request)
    except Exception as exc:
        if isinstance(exc, ProcurementServiceError) or isinstance(exc, PermissionError):
            _raise_procurement_error(exc)
        logger.error(
            "Procurement request save failed: user_id=%s conversation_id=%s exception_type=%s",
            user.id,
            conversation_id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="PROCUREMENT_REQUEST_SAVE_FAILED",
        ) from exc


@router.get(
    "/requests",
    response_model=Union[
        list[ProcurementMaterialRequestResponse],
        ProcurementMaterialRequestListResponse,
    ],
)
async def list_procurement_requests(
    response: Response,
    page: int | None = Query(default=None, ge=1),
    page_size: int | None = Query(default=None, ge=1, le=MAX_PAGE_SIZE),
    cursor: str | None = Query(default=None, max_length=300),
    user: UserResponse = Depends(require_employer),
):
    try:
        legacy_response = page is None and page_size is None
        result = ProcurementService.list_material_requests(
            user,
            page or 1,
            MAX_PAGE_SIZE if legacy_response else page_size or DEFAULT_PAGE_SIZE,
            cursor,
        )
        if legacy_response:
            response.headers["X-Results-Truncated"] = str(result.has_more).lower()
            return result.items
        return result
    except Exception as exc:
        if isinstance(exc, ProcurementServiceError) or isinstance(exc, PermissionError):
            _raise_procurement_error(exc)
        logger.error(
            "Procurement request list failed: user_id=%s exception_type=%s",
            user.id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="PROCUREMENT_REQUEST_LIST_FAILED",
        ) from exc


@router.get(
    "/requests/{request_id}",
    response_model=ProcurementMaterialRequestResponse,
)
async def get_procurement_request(
    request_id: UUID,
    user: UserResponse = Depends(require_employer),
):
    try:
        return ProcurementService.get_material_request(user, request_id)
    except Exception as exc:
        if isinstance(exc, ProcurementServiceError) or isinstance(exc, PermissionError):
            _raise_procurement_error(exc)
        logger.error(
            "Procurement request load failed: user_id=%s request_id=%s exception_type=%s",
            user.id,
            request_id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="PROCUREMENT_REQUEST_LOAD_FAILED",
        ) from exc


@router.get(
    "/requests/{request_id}/matches",
    response_model=ProcurementSupplierDiscoveryResponse,
)
async def discover_suppliers_for_request(
    request_id: UUID,
    delivery_location: str | None = Query(default=None, max_length=500),
    user: UserResponse = Depends(require_employer),
):
    try:
        return ProcurementService.discover_supplier_offerings(
            user,
            request_id,
            delivery_location_override=delivery_location,
        )
    except Exception as exc:
        if isinstance(exc, ProcurementServiceError) or isinstance(exc, PermissionError):
            _raise_procurement_error(exc)
        logger.error(
            "Supplier discovery failed: user_id=%s request_id=%s exception_type=%s",
            user.id,
            request_id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="SUPPLIER_DISCOVERY_FAILED",
        ) from exc


@router.patch(
    "/requests/{request_id}",
    response_model=ProcurementMaterialRequestResponse,
)
async def update_procurement_request(
    request_id: UUID,
    request: ProcurementMaterialRequestPatch,
    user: UserResponse = Depends(require_employer),
):
    try:
        return ProcurementService.update_material_request(user, request_id, request)
    except Exception as exc:
        if isinstance(exc, ProcurementServiceError) or isinstance(exc, PermissionError):
            _raise_procurement_error(exc)
        logger.error(
            "Procurement request update failed: user_id=%s request_id=%s exception_type=%s",
            user.id,
            request_id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="PROCUREMENT_REQUEST_UPDATE_FAILED",
        ) from exc


@router.delete(
    "/requests/{request_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def delete_procurement_request(
    request_id: UUID,
    user: UserResponse = Depends(require_employer),
):
    try:
        ProcurementService.delete_material_request(user, request_id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except Exception as exc:
        if isinstance(exc, ProcurementServiceError) or isinstance(exc, PermissionError):
            _raise_procurement_error(exc)
        logger.error(
            "Procurement request deletion failed: user_id=%s request_id=%s exception_type=%s",
            user.id,
            request_id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="PROCUREMENT_REQUEST_DELETE_FAILED",
        ) from exc
