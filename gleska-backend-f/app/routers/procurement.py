"""Authenticated Procurement Phase 1 endpoints."""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.security import require_employer
from app.schemas.auth import UserResponse
from app.schemas.procurement import (
    ProcurementConversationCreateResponse,
    ProcurementConversationMessageRequest,
    ProcurementDraftUpdateRequest,
    ProcurementMaterialRequestPatch,
    ProcurementMaterialRequestResponse,
    ProcurementSaveRequest,
)
from app.services.procurement_service import (
    ProcurementAgentError,
    ProcurementConflict,
    ProcurementNotFound,
    ProcurementService,
    ProcurementServiceError,
)

router = APIRouter(prefix="/procurement", tags=["procurement"])
logger = logging.getLogger(__name__)


def _raise_procurement_error(exc: Exception) -> None:
    if isinstance(exc, ProcurementNotFound):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    if isinstance(exc, ProcurementConflict):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if isinstance(exc, ProcurementAgentError):
        http_status = (
            status.HTTP_502_BAD_GATEWAY
            if "INVALID" in str(exc)
            else status.HTTP_503_SERVICE_UNAVAILABLE
        )
        raise HTTPException(status_code=http_status, detail=str(exc)) from exc
    if isinstance(exc, PermissionError):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    if isinstance(exc, ProcurementServiceError):
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
    raise exc


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
        logger.exception("Procurement conversation create failed: user_id=%s", user.id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="PROCUREMENT_CONVERSATION_CREATE_FAILED",
        ) from exc


@router.get(
    "/conversations",
    response_model=list[ProcurementConversationCreateResponse],
)
async def list_procurement_conversations(
    user: UserResponse = Depends(require_employer),
):
    try:
        return ProcurementService.list_conversations(user)
    except Exception as exc:
        if isinstance(exc, ProcurementServiceError) or isinstance(exc, PermissionError):
            _raise_procurement_error(exc)
        logger.exception("Procurement conversation list failed: user_id=%s", user.id)
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
        logger.exception(
            "Procurement conversation load failed: user_id=%s conversation_id=%s",
            user.id,
            conversation_id,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="PROCUREMENT_CONVERSATION_LOAD_FAILED",
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
        logger.exception(
            "Procurement message processing failed: user_id=%s conversation_id=%s",
            user.id,
            conversation_id,
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
        logger.exception(
            "Procurement draft update failed: user_id=%s conversation_id=%s",
            user.id,
            conversation_id,
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
        logger.exception(
            "Procurement request save failed: user_id=%s conversation_id=%s",
            user.id,
            conversation_id,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="PROCUREMENT_REQUEST_SAVE_FAILED",
        ) from exc


@router.get(
    "/requests",
    response_model=list[ProcurementMaterialRequestResponse],
)
async def list_procurement_requests(
    user: UserResponse = Depends(require_employer),
):
    try:
        return ProcurementService.list_material_requests(user)
    except Exception as exc:
        if isinstance(exc, ProcurementServiceError) or isinstance(exc, PermissionError):
            _raise_procurement_error(exc)
        logger.exception("Procurement request list failed: user_id=%s", user.id)
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
        logger.exception(
            "Procurement request load failed: user_id=%s request_id=%s",
            user.id,
            request_id,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="PROCUREMENT_REQUEST_LOAD_FAILED",
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
        logger.exception(
            "Procurement request update failed: user_id=%s request_id=%s",
            user.id,
            request_id,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="PROCUREMENT_REQUEST_UPDATE_FAILED",
        ) from exc
