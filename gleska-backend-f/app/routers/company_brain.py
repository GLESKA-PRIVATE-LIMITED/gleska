"""Company Brain API (employer owner only). Read-only over company data; see docs/company-brain/."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Path, Query, UploadFile, status
from pydantic import BaseModel, Field

from app.ai_gateway import AIBillingError
from app.company_brain import documents, service
from app.company_brain.documents import DocumentError
from app.company_brain.periods import PeriodSpec
from app.company_brain.service import BrainError
from app.core.security import require_admin, require_employer
from app.core.supabase import supabase
from app.schemas.auth import UserResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/company-brain", tags=["company-brain"])
admin_router = APIRouter(prefix="/admin/company-brain", tags=["admin-company-brain"])

UUID_PATTERN = r"^[0-9a-fA-F-]{36}$"
MAX_UPLOAD_BYTES = 25 * 1024 * 1024


class AskRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=service.MAX_QUESTION_CHARS)
    conversation_id: str | None = Field(default=None, pattern=r"^[0-9a-fA-F-]{36}$")


class SummaryRequest(BaseModel):
    period: PeriodSpec = Field(default_factory=lambda: PeriodSpec(name="today"))
    conversation_id: str | None = Field(default=None, pattern=r"^[0-9a-fA-F-]{36}$")


class RenameRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)


def _http(exc: BrainError | DocumentError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.code)


def _ctx(user: UserResponse):
    try:
        return service.org_context(user)
    except BrainError as exc:
        raise _http(exc) from exc


async def _sync_quietly(ctx) -> None:
    from app.ai_gateway import billing_scope

    try:
        with billing_scope(agent=service.AGENT, user_id=ctx.user_id):
            await documents.sync(ctx)
    except Exception:
        logger.exception("company_brain background sync failed")


@router.get("/status")
async def get_status(background: BackgroundTasks, user: UserResponse = Depends(require_employer)):
    ctx = _ctx(user)
    background.add_task(_sync_quietly, ctx)  # incremental: new/changed/deleted sources, bounded indexing
    return service.status(ctx)


@router.post("/ask")
async def ask(payload: AskRequest, user: UserResponse = Depends(require_employer)):
    try:
        return await service.ask(user, payload.question, payload.conversation_id)
    except BrainError as exc:
        raise _http(exc) from exc
    except AIBillingError:
        raise  # 402/503 with code; never swallowed


@router.post("/summary")
async def summary(payload: SummaryRequest, user: UserResponse = Depends(require_employer)):
    try:
        return await service.summary(user, payload.period.model_dump(mode="json"), payload.conversation_id)
    except BrainError as exc:
        raise _http(exc) from exc


@router.get("/conversations")
async def list_conversations(search: str | None = Query(default=None, max_length=100),
                             user: UserResponse = Depends(require_employer)):
    return {"conversations": service.list_conversations(_ctx(user), search)}


@router.get("/conversations/{conversation_id}")
async def get_conversation(conversation_id: str = Path(..., pattern=UUID_PATTERN), user: UserResponse = Depends(require_employer)):
    ctx = _ctx(user)
    try:
        return {"conversation": service.get_conversation(ctx, conversation_id),
                "messages": service.messages(ctx, conversation_id)}
    except BrainError as exc:
        raise _http(exc) from exc


@router.patch("/conversations/{conversation_id}")
async def rename_conversation(payload: RenameRequest, conversation_id: str = Path(..., pattern=UUID_PATTERN),
                              user: UserResponse = Depends(require_employer)):
    try:
        return service.rename(_ctx(user), conversation_id, payload.title)
    except BrainError as exc:
        raise _http(exc) from exc


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(conversation_id: str = Path(..., pattern=UUID_PATTERN), user: UserResponse = Depends(require_employer)):
    try:
        service.delete(_ctx(user), conversation_id)
    except BrainError as exc:
        raise _http(exc) from exc


@router.get("/documents")
async def list_documents(user: UserResponse = Depends(require_employer)):
    return {"documents": documents.list_documents(_ctx(user))}


@router.post("/documents", status_code=status.HTTP_201_CREATED)
async def upload_document(background: BackgroundTasks, file: UploadFile = File(...),
                          user: UserResponse = Depends(require_employer)):
    ctx = _ctx(user)
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="FILE_TOO_LARGE")
    try:
        doc = await documents.upload(ctx, file.filename or "", content)
    except DocumentError as exc:
        raise _http(exc) from exc

    async def index_with_billing() -> None:
        from app.ai_gateway import billing_scope

        with billing_scope(agent=service.AGENT, user_id=ctx.user_id):
            await documents.index_document(doc)

    background.add_task(index_with_billing)
    return {"document": {k: doc.get(k) for k in ("id", "filename", "status", "source_type", "created_at")}}


@router.delete("/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(document_id: str = Path(..., pattern=UUID_PATTERN), user: UserResponse = Depends(require_employer)):
    try:
        documents.delete_upload(_ctx(user), document_id)
    except DocumentError as exc:
        raise _http(exc) from exc


@router.post("/documents/sync")
async def sync_documents(user: UserResponse = Depends(require_employer)):
    from app.ai_gateway import billing_scope

    ctx = _ctx(user)
    with billing_scope(agent=service.AGENT, user_id=ctx.user_id):
        return await documents.sync(ctx)


@router.get("/documents/{document_id}/url")
async def document_url(document_id: str = Path(..., pattern=UUID_PATTERN), user: UserResponse = Depends(require_employer)):
    ctx = _ctx(user)
    rows = service._rows(supabase.table("company_brain_documents").select("storage_bucket, storage_path, status")
                         .eq("id", document_id).eq("employer_id", ctx.employer_id).limit(1).execute())
    if not rows or rows[0]["status"] == "deleted" or not rows[0].get("storage_path"):
        raise HTTPException(status_code=404, detail="DOCUMENT_NOT_FOUND")
    signed = supabase.storage.from_(rows[0]["storage_bucket"]).create_signed_url(rows[0]["storage_path"], 300)
    url = signed.get("signedURL") or signed.get("signedUrl") if isinstance(signed, dict) else None
    if not url:
        raise HTTPException(status_code=502, detail="SIGNED_URL_FAILED")
    return {"url": url, "expires_in": 300}


@admin_router.get("/health")
async def health(_: UserResponse = Depends(require_admin)) -> dict[str, Any]:
    """Operational counts only (no question text, no company data)."""
    since = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    audits = service._rows(supabase.table("company_brain_query_audit").select("tool, status, duration_ms")
                           .gte("created_at", since).limit(20000).execute())
    answers = service._rows(supabase.table("company_brain_messages").select("answer_status, status")
                            .eq("role", "assistant").gte("created_at", since).limit(20000).execute())
    docs = service._rows(supabase.table("company_brain_documents").select("status, embedding_status, error_code")
                         .limit(50000).execute())

    def count(rows: list[dict[str, Any]], key: str) -> dict[str, int]:
        out: dict[str, int] = {}
        for r in rows:
            out[str(r.get(key))] = out.get(str(r.get(key)), 0) + 1
        return out

    slow = sum(1 for a in audits if int(a.get("duration_ms") or 0) > 5000)
    return {
        "window": "last 24 hours",
        "tool_calls": count(audits, "status"),
        "failed_tools": count([a for a in audits if a["status"] != "ok"], "tool"),
        "slow_tool_calls": slow,
        "answers": count(answers, "answer_status"),
        "failed_answers": sum(1 for a in answers if a.get("status") == "failed"),
        "documents": count(docs, "status"),
        "embeddings": count(docs, "embedding_status"),
        "document_errors": count([d for d in docs if d.get("error_code")], "error_code"),
    }
