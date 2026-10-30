"""General Work conversational workspace API (employer-only, owner-scoped)."""

import logging
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status

from app.core.security import require_employer
from app.schemas.auth import UserResponse
from app.schemas.general_work import (
    ConversationCreate,
    ConversationUpdate,
    GeneralWorkConversation,
    GeneralWorkConversationList,
    GeneralWorkFile,
    GeneralWorkFileList,
    GeneralWorkFileUrl,
    GeneralWorkMessagePage,
    GeneralWorkProject,
    GeneralWorkProjectList,
    MessageCreate,
    MessageExchange,
    ProjectCreate,
    ProjectUpdate,
    TranscriptionResponse,
)
from app.services.general_work_ai_service import GeneralWorkAIError, GeneralWorkAIService
from app.services.general_work_service import (
    MAX_AUDIO_BYTES,
    MAX_DOCUMENT_BYTES,
    GeneralWorkNotFound,
    GeneralWorkService,
    GeneralWorkValidationError,
    validate_audio,
)

router = APIRouter(prefix="/general-work", tags=["general-work"])
logger = logging.getLogger(__name__)


def _raise_for(exc: Exception, fallback: str) -> None:
    if isinstance(exc, GeneralWorkNotFound):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    if isinstance(exc, GeneralWorkValidationError):
        raise HTTPException(status_code=exc.status_code, detail=exc.code) from exc
    logger.exception("General Work request failed: %s", fallback)
    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=fallback) from exc


async def _read_limited(upload: UploadFile, max_bytes: int) -> bytes:
    content = await upload.read(max_bytes + 1)
    if len(content) > max_bytes:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="FILE_TOO_LARGE")
    return content


# ---------- conversations ----------

@router.get("/conversations", response_model=GeneralWorkConversationList)
async def list_conversations(
    search: str | None = Query(default=None, max_length=200),
    project_id: UUID | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    user: UserResponse = Depends(require_employer),
):
    try:
        conversations = GeneralWorkService.list_conversations(user, search, project_id, limit)
    except Exception as exc:
        _raise_for(exc, "CONVERSATION_LIST_FAILED")
    return GeneralWorkConversationList(conversations=conversations)


@router.post("/conversations", response_model=GeneralWorkConversation, status_code=status.HTTP_201_CREATED)
async def create_conversation(payload: ConversationCreate, user: UserResponse = Depends(require_employer)):
    try:
        return GeneralWorkService.create_conversation(user, payload)
    except Exception as exc:
        _raise_for(exc, "CONVERSATION_CREATE_FAILED")


@router.get("/conversations/{conversation_id}", response_model=GeneralWorkConversation)
async def get_conversation(conversation_id: UUID, user: UserResponse = Depends(require_employer)):
    try:
        return GeneralWorkService.get_conversation(user, conversation_id)
    except Exception as exc:
        _raise_for(exc, "CONVERSATION_LOAD_FAILED")


@router.patch("/conversations/{conversation_id}", response_model=GeneralWorkConversation)
async def update_conversation(
    conversation_id: UUID,
    payload: ConversationUpdate,
    user: UserResponse = Depends(require_employer),
):
    try:
        return GeneralWorkService.update_conversation(user, conversation_id, payload)
    except Exception as exc:
        _raise_for(exc, "CONVERSATION_UPDATE_FAILED")


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(conversation_id: UUID, user: UserResponse = Depends(require_employer)):
    try:
        GeneralWorkService.delete_conversation(user, conversation_id)
    except Exception as exc:
        _raise_for(exc, "CONVERSATION_DELETE_FAILED")


@router.get("/conversations/{conversation_id}/messages", response_model=GeneralWorkMessagePage)
async def list_messages(
    conversation_id: UUID,
    before: datetime | None = Query(default=None),
    limit: int = Query(default=30, ge=1, le=100),
    user: UserResponse = Depends(require_employer),
):
    try:
        return GeneralWorkService.list_messages(user, conversation_id, before, limit)
    except Exception as exc:
        _raise_for(exc, "MESSAGE_LIST_FAILED")


@router.post("/conversations/{conversation_id}/messages", response_model=MessageExchange)
async def send_message(
    conversation_id: UUID,
    payload: MessageCreate,
    user: UserResponse = Depends(require_employer),
):
    try:
        return await GeneralWorkService.send_message(user, conversation_id, payload)
    except Exception as exc:
        _raise_for(exc, "MESSAGE_SEND_FAILED")


# ---------- files / library ----------

@router.post("/files", response_model=GeneralWorkFile, status_code=status.HTTP_201_CREATED)
async def upload_file(
    file: UploadFile = File(...),
    source: str = Form(default="upload"),
    user: UserResponse = Depends(require_employer),
):
    content = await _read_limited(file, MAX_DOCUMENT_BYTES)
    try:
        return GeneralWorkService.upload_file(user, file.filename or "", content, source)
    except Exception as exc:
        _raise_for(exc, "UPLOAD_FAILED")


@router.get("/files", response_model=GeneralWorkFileList)
async def list_files(
    kind: str | None = Query(default=None, pattern="^(image|document)$"),
    search: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=60, ge=1, le=200),
    user: UserResponse = Depends(require_employer),
):
    try:
        return GeneralWorkFileList(items=GeneralWorkService.list_files(user, kind, search, limit))
    except Exception as exc:
        _raise_for(exc, "FILE_LIST_FAILED")


@router.get("/files/{file_id}/url", response_model=GeneralWorkFileUrl)
async def file_url(
    file_id: UUID,
    download: bool = Query(default=False),
    user: UserResponse = Depends(require_employer),
):
    try:
        return GeneralWorkFileUrl(url=GeneralWorkService.file_url(user, file_id, download))
    except Exception as exc:
        _raise_for(exc, "FILE_URL_FAILED")


@router.delete("/files/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_file(file_id: UUID, user: UserResponse = Depends(require_employer)):
    try:
        GeneralWorkService.delete_file(user, file_id)
    except Exception as exc:
        _raise_for(exc, "FILE_DELETE_FAILED")


# ---------- projects ----------

@router.get("/projects", response_model=GeneralWorkProjectList)
async def list_projects(user: UserResponse = Depends(require_employer)):
    try:
        return GeneralWorkProjectList(projects=GeneralWorkService.list_projects(user))
    except Exception as exc:
        _raise_for(exc, "PROJECT_LIST_FAILED")


@router.post("/projects", response_model=GeneralWorkProject, status_code=status.HTTP_201_CREATED)
async def create_project(payload: ProjectCreate, user: UserResponse = Depends(require_employer)):
    try:
        return GeneralWorkService.create_project(user, payload)
    except Exception as exc:
        _raise_for(exc, "PROJECT_CREATE_FAILED")


@router.get("/projects/{project_id}", response_model=GeneralWorkProject)
async def get_project(project_id: UUID, user: UserResponse = Depends(require_employer)):
    try:
        return GeneralWorkService.get_project(user, project_id)
    except Exception as exc:
        _raise_for(exc, "PROJECT_LOAD_FAILED")


@router.patch("/projects/{project_id}", response_model=GeneralWorkProject)
async def update_project(project_id: UUID, payload: ProjectUpdate, user: UserResponse = Depends(require_employer)):
    try:
        return GeneralWorkService.update_project(user, project_id, payload)
    except Exception as exc:
        _raise_for(exc, "PROJECT_UPDATE_FAILED")


@router.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(project_id: UUID, user: UserResponse = Depends(require_employer)):
    try:
        GeneralWorkService.delete_project(user, project_id)
    except Exception as exc:
        _raise_for(exc, "PROJECT_DELETE_FAILED")


# ---------- voice ----------

@router.post("/transcribe", response_model=TranscriptionResponse)
async def transcribe(audio: UploadFile = File(...), user: UserResponse = Depends(require_employer)):
    """Speech-to-text fallback for browsers without the Web Speech API. Audio is not stored."""
    content = await _read_limited(audio, MAX_AUDIO_BYTES)
    try:
        mime_type = validate_audio(audio.content_type, content)
        text = await GeneralWorkAIService.transcribe(content, mime_type)
    except GeneralWorkAIError as exc:
        logger.warning("General Work transcription failed: code=%s user_id=%s", exc.code, user.id)
        code = status.HTTP_503_SERVICE_UNAVAILABLE if exc.code == "AI_NOT_CONFIGURED" else status.HTTP_502_BAD_GATEWAY
        raise HTTPException(status_code=code, detail=f"TRANSCRIPTION_{exc.code}") from exc
    except Exception as exc:
        _raise_for(exc, "TRANSCRIPTION_FAILED")
    return TranscriptionResponse(text=text)
