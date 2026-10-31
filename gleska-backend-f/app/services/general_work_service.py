"""Persistence and ownership rules for the General Work conversational workspace.

Every query is scoped to the authenticated user's id. The backend uses the service-role
client, so these filters (not RLS) are what isolate one user's data from another's.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Any
from urllib.parse import quote
from uuid import UUID, uuid4

from app.ai_gateway import AIBillingError
from app.core.supabase import supabase
from app.schemas.auth import UserResponse
from app.schemas.general_work import (
    ConversationCreate,
    ConversationUpdate,
    GeneralWorkConversation,
    GeneralWorkFile,
    GeneralWorkMessage,
    GeneralWorkMessagePage,
    GeneralWorkProject,
    MessageAttachment,
    MessageCreate,
    MessageExchange,
    ProjectCreate,
    ProjectUpdate,
)
from app.services.general_work_ai_service import (
    AttachmentContent,
    GeneralWorkAIError,
    GeneralWorkAIService,
    HistoryTurn,
)

logger = logging.getLogger(__name__)

STORAGE_BUCKET = "assistant-uploads"
SIGNED_URL_TTL_SECONDS = 3600
DEFAULT_TITLE = "New chat"
MAX_TITLE_CHARS = 60
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_DOCUMENT_BYTES = 25 * 1024 * 1024
MAX_AUDIO_BYTES = 10 * 1024 * 1024

CONVERSATIONS = "general_work_conversations"
MESSAGES = "general_work_messages"
FILES = "general_work_files"
PROJECTS = "general_work_projects"

# extension -> (mime type, kind, size limit). The mime type is derived from the extension
# and checked against the file signature; the client's declared content type is ignored.
ALLOWED_FILE_TYPES: dict[str, tuple[str, str, int]] = {
    "png": ("image/png", "image", MAX_IMAGE_BYTES),
    "jpg": ("image/jpeg", "image", MAX_IMAGE_BYTES),
    "jpeg": ("image/jpeg", "image", MAX_IMAGE_BYTES),
    "webp": ("image/webp", "image", MAX_IMAGE_BYTES),
    "pdf": ("application/pdf", "document", MAX_DOCUMENT_BYTES),
    "docx": ("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "document", MAX_DOCUMENT_BYTES),
    "xlsx": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "document", MAX_DOCUMENT_BYTES),
    "csv": ("text/csv", "document", MAX_DOCUMENT_BYTES),
    "txt": ("text/plain", "document", MAX_DOCUMENT_BYTES),
}

ALLOWED_AUDIO_TYPES = {"audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/aac"}

AI_ERROR_MESSAGES = {
    "AI_NOT_CONFIGURED": "The AI service is not configured on the server yet, so I can't answer right now.",
    "AI_TIMEOUT": "The AI service took too long to respond. Please try again.",
}
DEFAULT_AI_ERROR_MESSAGE = "I couldn't generate a response right now. Please try again."
BILLING_ERROR_MESSAGES = {
    "INSUFFICIENT_CREDITS": "You don't have enough Gleska credits for this request. Add credits in Billing Management and try again.",
    "BILLING_ACCOUNT_SUSPENDED": "Your billing account is suspended. Please contact Gleska support.",
}
DEFAULT_BILLING_ERROR_MESSAGE = "AI usage can't be billed right now, so the request wasn't sent. Please try again later."


class GeneralWorkNotFound(Exception):
    """The record does not exist or is not owned by the current user."""


class GeneralWorkValidationError(Exception):
    """The request is invalid; `status_code` is 400 or 413."""

    def __init__(self, code: str, status_code: int = 400) -> None:
        self.code = code
        self.status_code = status_code
        super().__init__(code)


def _rows(response: Any) -> list[dict[str, Any]]:
    data = getattr(response, "data", None)
    if data is None:
        return []
    return data if isinstance(data, list) else [data]


def _first(response: Any) -> dict[str, Any] | None:
    rows = _rows(response)
    return rows[0] if rows else None


def _like_pattern(term: str) -> str:
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def make_title(content: str, fallback: str | None = None) -> str:
    """Build a short conversation title from the first user message."""
    text = re.sub(r"[#*_`>\[\]]", "", content or "")
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        text = (fallback or "").strip()
    if not text:
        return DEFAULT_TITLE
    if len(text) <= MAX_TITLE_CHARS:
        return text
    cut = text[:MAX_TITLE_CHARS].rsplit(" ", 1)[0] or text[:MAX_TITLE_CHARS]
    return cut.rstrip(" ,.;:-") + "…"


def safe_filename(filename: str, ext: str) -> str:
    base = filename.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    cleaned = "".join(c for c in base if c.isalnum() or c in ("-", "_", ".", " ")).strip(" .")
    cleaned = re.sub(r"\s+", "_", cleaned)[:120]
    return cleaned or f"upload.{ext}"


def _matches_signature(ext: str, content: bytes) -> bool:
    if ext == "png":
        return content.startswith(b"\x89PNG\r\n\x1a\n")
    if ext in ("jpg", "jpeg"):
        return content.startswith(b"\xff\xd8\xff")
    if ext == "webp":
        return content[:4] == b"RIFF" and content[8:12] == b"WEBP"
    if ext == "pdf":
        return content.startswith(b"%PDF-")
    if ext in ("docx", "xlsx"):
        return content.startswith(b"PK\x03\x04")
    if ext in ("csv", "txt"):
        return b"\x00" not in content[:8192]
    return False


def validate_upload(filename: str, content: bytes) -> tuple[str, str, str]:
    """Return (safe filename, mime type, kind) or raise GeneralWorkValidationError."""
    name = (filename or "").strip()
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in ALLOWED_FILE_TYPES:
        raise GeneralWorkValidationError("UNSUPPORTED_FILE_TYPE")
    mime_type, kind, max_bytes = ALLOWED_FILE_TYPES[ext]
    if not content:
        raise GeneralWorkValidationError("FILE_EMPTY")
    if len(content) > max_bytes:
        raise GeneralWorkValidationError("FILE_TOO_LARGE", 413)
    if not _matches_signature(ext, content):
        raise GeneralWorkValidationError("FILE_CONTENT_MISMATCH")
    return safe_filename(name, ext), mime_type, kind


def validate_audio(content_type: str | None, content: bytes) -> str:
    mime_type = (content_type or "").split(";", 1)[0].strip().lower()
    if mime_type not in ALLOWED_AUDIO_TYPES:
        raise GeneralWorkValidationError("UNSUPPORTED_AUDIO_TYPE")
    if not content:
        raise GeneralWorkValidationError("AUDIO_EMPTY")
    if len(content) > MAX_AUDIO_BYTES:
        raise GeneralWorkValidationError("AUDIO_TOO_LARGE", 413)
    return "audio/wav" if mime_type == "audio/x-wav" else mime_type


def _signed_urls(paths: list[str]) -> dict[str, str]:
    if not paths:
        return {}
    try:
        results = supabase.storage.from_(STORAGE_BUCKET).create_signed_urls(paths, SIGNED_URL_TTL_SECONDS)
    except Exception:
        logger.exception("General Work signed URL batch failed")
        return {}
    urls: dict[str, str] = {}
    for item in results or []:
        if not isinstance(item, dict):
            continue
        url = item.get("signedURL") or item.get("signedUrl")
        if item.get("path") and url:
            urls[item["path"]] = url
    return urls


def _file_model(row: dict[str, Any], url: str | None = None) -> GeneralWorkFile:
    return GeneralWorkFile(
        id=str(row["id"]),
        filename=row["filename"],
        mime_type=row["mime_type"],
        size_bytes=int(row["size_bytes"]),
        kind=row["kind"],
        source=row["source"],
        conversation_id=str(row["conversation_id"]) if row.get("conversation_id") else None,
        created_at=row["created_at"],
        url=url,
    )


def _conversation_model(row: dict[str, Any]) -> GeneralWorkConversation:
    return GeneralWorkConversation(
        id=str(row["id"]),
        title=row.get("title") or DEFAULT_TITLE,
        project_id=str(row["project_id"]) if row.get("project_id") else None,
        created_at=row["created_at"],
        updated_at=row.get("updated_at") or row["created_at"],
        last_message_at=row.get("last_message_at") or row["created_at"],
    )


def _message_model(row: dict[str, Any], urls: dict[str, str] | None = None) -> GeneralWorkMessage:
    urls = urls or {}
    attachments = [
        MessageAttachment(
            file_id=str(item["file_id"]),
            filename=item.get("filename", "file"),
            mime_type=item.get("mime_type", "application/octet-stream"),
            size_bytes=int(item.get("size_bytes", 0)),
            kind=item.get("kind", "document"),
            url=urls.get(str(item["file_id"])),
        )
        for item in (row.get("attachments") or [])
        if isinstance(item, dict) and item.get("file_id")
    ]
    return GeneralWorkMessage(
        id=str(row["id"]),
        conversation_id=str(row["conversation_id"]),
        role=row["role"],
        content=row.get("content") or "",
        attachments=attachments,
        status=row.get("status") or "completed",
        client_message_id=str(row["client_message_id"]) if row.get("client_message_id") else None,
        created_at=row["created_at"],
    )


class GeneralWorkService:
    """Owner-scoped General Work data access."""

    # ---------- files / library ----------

    @staticmethod
    def upload_file(user: UserResponse, filename: str, content: bytes, source: str) -> GeneralWorkFile:
        if source not in ("upload", "camera"):
            raise GeneralWorkValidationError("UNSUPPORTED_FILE_SOURCE")
        safe_name, mime_type, kind = validate_upload(filename, content)
        file_id = str(uuid4())
        storage_path = f"{user.id}/general-work/{file_id}/{safe_name}"

        try:
            supabase.storage.from_(STORAGE_BUCKET).upload(
                path=storage_path,
                file=content,
                file_options={"content-type": mime_type, "upsert": "false"},
            )
        except Exception as exc:
            logger.exception("General Work storage upload failed for user_id=%s", user.id)
            raise RuntimeError("UPLOAD_FAILED") from exc

        try:
            row = _first(supabase.table(FILES).insert({
                "id": file_id,
                "user_id": user.id,
                "storage_bucket": STORAGE_BUCKET,
                "storage_path": storage_path,
                "filename": safe_name,
                "mime_type": mime_type,
                "size_bytes": len(content),
                "kind": kind,
                "source": source,
            }).execute())
        except Exception as exc:
            logger.exception("General Work file record insert failed for user_id=%s", user.id)
            try:
                supabase.storage.from_(STORAGE_BUCKET).remove([storage_path])
            except Exception:
                logger.exception("General Work orphan cleanup failed for user_id=%s", user.id)
            raise RuntimeError("UPLOAD_FAILED") from exc
        if not row:
            raise RuntimeError("UPLOAD_FAILED")
        return _file_model(row, _signed_urls([storage_path]).get(storage_path))

    @staticmethod
    def list_files(user: UserResponse, kind: str | None, search: str | None, limit: int) -> list[GeneralWorkFile]:
        query = (
            supabase.table(FILES)
            .select("*")
            .eq("user_id", user.id)
            .order("created_at", desc=True)
            .limit(limit)
        )
        if kind:
            query = query.eq("kind", kind)
        if search and search.strip():
            query = query.ilike("filename", _like_pattern(search.strip()))
        rows = _rows(query.execute())
        urls = _signed_urls([row["storage_path"] for row in rows])
        return [_file_model(row, urls.get(row["storage_path"])) for row in rows]

    @staticmethod
    def _owned_file(user: UserResponse, file_id: UUID) -> dict[str, Any]:
        row = _first(
            supabase.table(FILES)
            .select("*")
            .eq("id", str(file_id))
            .eq("user_id", user.id)
            .limit(1)
            .execute()
        )
        if not row:
            raise GeneralWorkNotFound("FILE_NOT_FOUND")
        return row

    @classmethod
    def file_url(cls, user: UserResponse, file_id: UUID, download: bool) -> str:
        row = cls._owned_file(user, file_id)
        try:
            result = supabase.storage.from_(STORAGE_BUCKET).create_signed_url(row["storage_path"], SIGNED_URL_TTL_SECONDS)
        except Exception as exc:
            logger.exception("General Work signed URL failed for user_id=%s", user.id)
            raise RuntimeError("FILE_URL_FAILED") from exc
        url = (result or {}).get("signedURL") or (result or {}).get("signedUrl")
        if not url:
            raise RuntimeError("FILE_URL_FAILED")
        if download:
            # Supabase serves the object as an attachment when `download` is on the signed URL.
            url = f"{url}{'&' if '?' in url else '?'}download={quote(row['filename'])}"
        return url

    @classmethod
    def delete_file(cls, user: UserResponse, file_id: UUID) -> None:
        row = cls._owned_file(user, file_id)
        try:
            supabase.storage.from_(STORAGE_BUCKET).remove([row["storage_path"]])
        except Exception as exc:
            logger.exception("General Work storage delete failed for user_id=%s", user.id)
            raise RuntimeError("FILE_DELETE_FAILED") from exc
        supabase.table(FILES).delete().eq("id", row["id"]).eq("user_id", user.id).execute()

    # ---------- projects ----------

    @staticmethod
    def _owned_project(user: UserResponse, project_id: UUID | str) -> dict[str, Any]:
        row = _first(
            supabase.table(PROJECTS)
            .select("*")
            .eq("id", str(project_id))
            .eq("user_id", user.id)
            .limit(1)
            .execute()
        )
        if not row:
            raise GeneralWorkNotFound("PROJECT_NOT_FOUND")
        return row

    @staticmethod
    def _project_counts(user: UserResponse) -> dict[str, int]:
        rows = _rows(
            supabase.table(CONVERSATIONS)
            .select("project_id")
            .eq("user_id", user.id)
            .not_.is_("project_id", "null")
            .execute()
        )
        counts: dict[str, int] = {}
        for row in rows:
            key = str(row["project_id"])
            counts[key] = counts.get(key, 0) + 1
        return counts

    @staticmethod
    def _project_model(row: dict[str, Any], count: int) -> GeneralWorkProject:
        return GeneralWorkProject(
            id=str(row["id"]),
            name=row["name"],
            description=row.get("description"),
            conversation_count=count,
            created_at=row["created_at"],
            updated_at=row.get("updated_at") or row["created_at"],
        )

    @classmethod
    def list_projects(cls, user: UserResponse) -> list[GeneralWorkProject]:
        rows = _rows(
            supabase.table(PROJECTS)
            .select("*")
            .eq("user_id", user.id)
            .order("updated_at", desc=True)
            .execute()
        )
        counts = cls._project_counts(user)
        return [cls._project_model(row, counts.get(str(row["id"]), 0)) for row in rows]

    @classmethod
    def get_project(cls, user: UserResponse, project_id: UUID) -> GeneralWorkProject:
        row = cls._owned_project(user, project_id)
        return cls._project_model(row, cls._project_counts(user).get(str(row["id"]), 0))

    @classmethod
    def create_project(cls, user: UserResponse, payload: ProjectCreate) -> GeneralWorkProject:
        row = _first(supabase.table(PROJECTS).insert({
            "user_id": user.id,
            "name": payload.name,
            "description": payload.description,
        }).execute())
        if not row:
            raise RuntimeError("PROJECT_CREATE_FAILED")
        return cls._project_model(row, 0)

    @classmethod
    def update_project(cls, user: UserResponse, project_id: UUID, payload: ProjectUpdate) -> GeneralWorkProject:
        cls._owned_project(user, project_id)
        changes: dict[str, Any] = {}
        if payload.name is not None:
            changes["name"] = payload.name
        if "description" in payload.model_fields_set:
            changes["description"] = payload.description
        if changes:
            supabase.table(PROJECTS).update(changes).eq("id", str(project_id)).eq("user_id", user.id).execute()
        return cls.get_project(user, project_id)

    @classmethod
    def delete_project(cls, user: UserResponse, project_id: UUID) -> None:
        cls._owned_project(user, project_id)
        # Conversations are kept; the foreign key sets their project_id to NULL.
        supabase.table(PROJECTS).delete().eq("id", str(project_id)).eq("user_id", user.id).execute()

    # ---------- conversations ----------

    @staticmethod
    def _owned_conversation(user: UserResponse, conversation_id: UUID | str) -> dict[str, Any]:
        row = _first(
            supabase.table(CONVERSATIONS)
            .select("*")
            .eq("id", str(conversation_id))
            .eq("user_id", user.id)
            .limit(1)
            .execute()
        )
        if not row:
            raise GeneralWorkNotFound("CONVERSATION_NOT_FOUND")
        return row

    @staticmethod
    def list_conversations(
        user: UserResponse,
        search: str | None,
        project_id: UUID | None,
        limit: int,
    ) -> list[GeneralWorkConversation]:
        query = (
            supabase.table(CONVERSATIONS)
            .select("*")
            .eq("user_id", user.id)
            .order("last_message_at", desc=True)
            .limit(limit)
        )
        if project_id:
            query = query.eq("project_id", str(project_id))
        if search and search.strip():
            query = query.ilike("title", _like_pattern(search.strip()))
        return [_conversation_model(row) for row in _rows(query.execute())]

    @classmethod
    def get_conversation(cls, user: UserResponse, conversation_id: UUID) -> GeneralWorkConversation:
        return _conversation_model(cls._owned_conversation(user, conversation_id))

    @classmethod
    def create_conversation(cls, user: UserResponse, payload: ConversationCreate) -> GeneralWorkConversation:
        if payload.project_id:
            cls._owned_project(user, payload.project_id)
        row = _first(supabase.table(CONVERSATIONS).insert({
            "user_id": user.id,
            "project_id": str(payload.project_id) if payload.project_id else None,
            "title": DEFAULT_TITLE,
        }).execute())
        if not row:
            raise RuntimeError("CONVERSATION_CREATE_FAILED")
        return _conversation_model(row)

    @classmethod
    def update_conversation(
        cls,
        user: UserResponse,
        conversation_id: UUID,
        payload: ConversationUpdate,
    ) -> GeneralWorkConversation:
        cls._owned_conversation(user, conversation_id)
        changes: dict[str, Any] = {}
        if payload.title is not None:
            changes["title"] = payload.title
        if payload.clear_project:
            changes["project_id"] = None
        elif payload.project_id is not None:
            cls._owned_project(user, payload.project_id)
            changes["project_id"] = str(payload.project_id)
        if changes:
            supabase.table(CONVERSATIONS).update(changes).eq("id", str(conversation_id)).eq("user_id", user.id).execute()
        return cls.get_conversation(user, conversation_id)

    @classmethod
    def delete_conversation(cls, user: UserResponse, conversation_id: UUID) -> None:
        cls._owned_conversation(user, conversation_id)
        # Messages cascade; library files stay and lose their conversation link.
        supabase.table(CONVERSATIONS).delete().eq("id", str(conversation_id)).eq("user_id", user.id).execute()

    # ---------- messages ----------

    @staticmethod
    def _messages_with_urls(user: UserResponse, rows: list[dict[str, Any]]) -> list[GeneralWorkMessage]:
        file_ids = {
            str(item["file_id"])
            for row in rows
            for item in (row.get("attachments") or [])
            if isinstance(item, dict) and item.get("file_id")
        }
        urls: dict[str, str] = {}
        if file_ids:
            files = _rows(
                supabase.table(FILES)
                .select("id, storage_path")
                .eq("user_id", user.id)
                .in_("id", sorted(file_ids))
                .execute()
            )
            path_urls = _signed_urls([f["storage_path"] for f in files])
            urls = {str(f["id"]): path_urls[f["storage_path"]] for f in files if f["storage_path"] in path_urls}
        return [_message_model(row, urls) for row in rows]

    @classmethod
    def list_messages(
        cls,
        user: UserResponse,
        conversation_id: UUID,
        before: datetime | None,
        limit: int,
    ) -> GeneralWorkMessagePage:
        cls._owned_conversation(user, conversation_id)
        query = (
            supabase.table(MESSAGES)
            .select("*")
            .eq("conversation_id", str(conversation_id))
            .eq("user_id", user.id)
            .order("created_at", desc=True)
            .limit(limit + 1)
        )
        if before:
            query = query.lt("created_at", before.isoformat())
        rows = _rows(query.execute())
        has_more = len(rows) > limit
        rows = list(reversed(rows[:limit]))
        return GeneralWorkMessagePage(messages=cls._messages_with_urls(user, rows), has_more=has_more)

    @staticmethod
    def _history(user: UserResponse, conversation_id: str, exclude_id: str) -> list[HistoryTurn]:
        rows = _rows(
            supabase.table(MESSAGES)
            .select("id, role, content, status, attachments")
            .eq("conversation_id", conversation_id)
            .eq("user_id", user.id)
            .order("created_at", desc=True)
            .limit(21)
            .execute()
        )
        turns: list[HistoryTurn] = []
        for row in reversed(rows):
            if str(row["id"]) == exclude_id or row.get("status") == "failed":
                continue
            content = row.get("content") or ""
            names = [a.get("filename") for a in (row.get("attachments") or []) if isinstance(a, dict)]
            if names:
                content = f"{content}\n[Earlier attachments: {', '.join(n for n in names if n)}]".strip()
            turns.append(HistoryTurn(role=row["role"], content=content))
        return turns

    @staticmethod
    def _load_attachments(user: UserResponse, file_rows: list[dict[str, Any]]) -> list[AttachmentContent]:
        contents: list[AttachmentContent] = []
        for row in file_rows:
            try:
                data = supabase.storage.from_(STORAGE_BUCKET).download(row["storage_path"])
            except Exception:
                logger.exception("General Work attachment download failed for user_id=%s", user.id)
                continue
            contents.append(AttachmentContent(filename=row["filename"], mime_type=row["mime_type"], data=data))
        return contents

    @classmethod
    async def _assistant_reply(
        cls,
        user: UserResponse,
        conversation_id: str,
        user_row: dict[str, Any],
        file_rows: list[dict[str, Any]],
    ) -> tuple[str, str]:
        try:
            text = await GeneralWorkAIService.generate_reply(
                cls._history(user, conversation_id, str(user_row["id"])),
                user_row.get("content") or "",
                cls._load_attachments(user, file_rows),
            )
            return text, "completed"
        except GeneralWorkAIError as exc:
            logger.warning("General Work AI reply failed: code=%s user_id=%s", exc.code, user.id)
            return AI_ERROR_MESSAGES.get(exc.code, DEFAULT_AI_ERROR_MESSAGE), "failed"
        except AIBillingError as exc:
            logger.warning("General Work AI reply not billed: code=%s user_id=%s", exc.code, user.id)
            return BILLING_ERROR_MESSAGES.get(exc.code, DEFAULT_BILLING_ERROR_MESSAGE), "failed"

    @classmethod
    async def send_message(
        cls,
        user: UserResponse,
        conversation_id: UUID,
        payload: MessageCreate,
    ) -> MessageExchange:
        conversation = cls._owned_conversation(user, conversation_id)
        conv_id = str(conversation["id"])
        if not payload.content and not payload.attachment_ids:
            raise GeneralWorkValidationError("EMPTY_MESSAGE")

        existing_user = _first(
            supabase.table(MESSAGES)
            .select("*")
            .eq("conversation_id", conv_id)
            .eq("user_id", user.id)
            .eq("client_message_id", str(payload.client_message_id))
            .limit(1)
            .execute()
        )
        if existing_user:
            return await cls._replay(user, conversation, existing_user)

        file_ids = list(dict.fromkeys(str(file_id) for file_id in payload.attachment_ids))
        file_rows: list[dict[str, Any]] = []
        if file_ids:
            file_rows = _rows(
                supabase.table(FILES)
                .select("*")
                .eq("user_id", user.id)
                .in_("id", file_ids)
                .execute()
            )
            if len(file_rows) != len(file_ids):
                raise GeneralWorkValidationError("ATTACHMENT_NOT_FOUND")
            order = {file_id: index for index, file_id in enumerate(file_ids)}
            file_rows.sort(key=lambda row: order[str(row["id"])])
            supabase.table(FILES).update({"conversation_id": conv_id}).eq("user_id", user.id).in_("id", file_ids).is_("conversation_id", "null").execute()

        attachments = [
            {
                "file_id": str(row["id"]),
                "filename": row["filename"],
                "mime_type": row["mime_type"],
                "size_bytes": int(row["size_bytes"]),
                "kind": row["kind"],
            }
            for row in file_rows
        ]
        try:
            user_row = _first(supabase.table(MESSAGES).insert({
                "conversation_id": conv_id,
                "user_id": user.id,
                "role": "user",
                "content": payload.content,
                "attachments": attachments,
                "client_message_id": str(payload.client_message_id),
            }).execute())
        except Exception:
            # A concurrent duplicate submission hit the unique (conversation, client id) index.
            duplicate = _first(
                supabase.table(MESSAGES)
                .select("*")
                .eq("conversation_id", conv_id)
                .eq("user_id", user.id)
                .eq("client_message_id", str(payload.client_message_id))
                .limit(1)
                .execute()
            )
            if duplicate:
                return await cls._replay(user, conversation, duplicate)
            raise
        if not user_row:
            raise RuntimeError("MESSAGE_CREATE_FAILED")

        text, status = await cls._assistant_reply(user, conv_id, user_row, file_rows)
        assistant_row = _first(supabase.table(MESSAGES).insert({
            "conversation_id": conv_id,
            "user_id": user.id,
            "role": "assistant",
            "content": text,
            "status": status,
            "reply_to_message_id": user_row["id"],
        }).execute())
        if not assistant_row:
            raise RuntimeError("MESSAGE_CREATE_FAILED")

        changes: dict[str, Any] = {"last_message_at": assistant_row["created_at"]}
        if (conversation.get("title") or DEFAULT_TITLE) == DEFAULT_TITLE:
            changes["title"] = make_title(payload.content, file_rows[0]["filename"] if file_rows else None)
        updated = _first(
            supabase.table(CONVERSATIONS).update(changes).eq("id", conv_id).eq("user_id", user.id).execute()
        ) or {**conversation, **changes}

        messages = cls._messages_with_urls(user, [user_row, assistant_row])
        return MessageExchange(
            conversation=_conversation_model(updated),
            user_message=messages[0],
            assistant_message=messages[1],
        )

    @classmethod
    async def _replay(
        cls,
        user: UserResponse,
        conversation: dict[str, Any],
        user_row: dict[str, Any],
    ) -> MessageExchange:
        """Return the stored exchange for a repeated client_message_id, regenerating a failed reply."""
        conv_id = str(conversation["id"])
        assistant_row = _first(
            supabase.table(MESSAGES)
            .select("*")
            .eq("conversation_id", conv_id)
            .eq("user_id", user.id)
            .eq("reply_to_message_id", str(user_row["id"]))
            .limit(1)
            .execute()
        )
        if assistant_row is None or assistant_row.get("status") == "failed":
            file_ids = [str(a["file_id"]) for a in (user_row.get("attachments") or []) if isinstance(a, dict)]
            file_rows = _rows(
                supabase.table(FILES).select("*").eq("user_id", user.id).in_("id", file_ids).execute()
            ) if file_ids else []
            text, status = await cls._assistant_reply(user, conv_id, user_row, file_rows)
            if assistant_row is None:
                assistant_row = _first(supabase.table(MESSAGES).insert({
                    "conversation_id": conv_id,
                    "user_id": user.id,
                    "role": "assistant",
                    "content": text,
                    "status": status,
                    "reply_to_message_id": user_row["id"],
                }).execute())
            else:
                assistant_row = _first(
                    supabase.table(MESSAGES)
                    .update({"content": text, "status": status})
                    .eq("id", assistant_row["id"])
                    .eq("user_id", user.id)
                    .execute()
                ) or {**assistant_row, "content": text, "status": status}
            if not assistant_row:
                raise RuntimeError("MESSAGE_CREATE_FAILED")
        messages = cls._messages_with_urls(user, [user_row, assistant_row])
        return MessageExchange(
            conversation=_conversation_model(cls._owned_conversation(user, conv_id)),
            user_message=messages[0],
            assistant_message=messages[1],
        )
