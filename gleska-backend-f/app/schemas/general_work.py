"""Schemas for the General Work conversational workspace."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

MAX_MESSAGE_CHARS = 20_000
MAX_ATTACHMENTS_PER_MESSAGE = 10

FileKind = Literal["image", "document"]
FileSource = Literal["upload", "camera", "generated"]


def _clean_text(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


class GeneralWorkFile(BaseModel):
    id: str
    filename: str
    mime_type: str
    size_bytes: int
    kind: FileKind
    source: FileSource
    conversation_id: str | None = None
    created_at: datetime
    url: str | None = None


class GeneralWorkFileList(BaseModel):
    items: list[GeneralWorkFile]


class GeneralWorkFileUrl(BaseModel):
    url: str


class MessageAttachment(BaseModel):
    file_id: str
    filename: str
    mime_type: str
    size_bytes: int
    kind: FileKind
    url: str | None = None


class GeneralWorkMessage(BaseModel):
    id: str
    conversation_id: str
    role: Literal["user", "assistant"]
    content: str
    attachments: list[MessageAttachment] = Field(default_factory=list)
    status: Literal["completed", "failed"] = "completed"
    client_message_id: str | None = None
    created_at: datetime


class GeneralWorkMessagePage(BaseModel):
    messages: list[GeneralWorkMessage]
    has_more: bool


class GeneralWorkConversation(BaseModel):
    id: str
    title: str
    project_id: str | None = None
    created_at: datetime
    updated_at: datetime
    last_message_at: datetime


class GeneralWorkConversationList(BaseModel):
    conversations: list[GeneralWorkConversation]


class ConversationCreate(BaseModel):
    project_id: UUID | None = None


class ConversationUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    project_id: UUID | None = None
    clear_project: bool = False

    @field_validator("title")
    @classmethod
    def validate_title(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = _clean_text(value)
        if not cleaned:
            raise ValueError("Title cannot be empty")
        return cleaned


class MessageCreate(BaseModel):
    content: str = Field(default="", max_length=MAX_MESSAGE_CHARS)
    attachment_ids: list[UUID] = Field(default_factory=list, max_length=MAX_ATTACHMENTS_PER_MESSAGE)
    client_message_id: UUID

    @field_validator("content")
    @classmethod
    def strip_content(cls, value: str) -> str:
        return value.strip()


class MessageExchange(BaseModel):
    conversation: GeneralWorkConversation
    user_message: GeneralWorkMessage
    assistant_message: GeneralWorkMessage


class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        cleaned = _clean_text(value)
        if not cleaned:
            raise ValueError("Project name cannot be empty")
        return cleaned

    @field_validator("description")
    @classmethod
    def validate_description(cls, value: str | None) -> str | None:
        return _clean_text(value)


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=2000)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = _clean_text(value)
        if not cleaned:
            raise ValueError("Project name cannot be empty")
        return cleaned

    @field_validator("description")
    @classmethod
    def validate_description(cls, value: str | None) -> str | None:
        return _clean_text(value)


class GeneralWorkProject(BaseModel):
    id: str
    name: str
    description: str | None = None
    conversation_count: int = 0
    created_at: datetime
    updated_at: datetime


class GeneralWorkProjectList(BaseModel):
    projects: list[GeneralWorkProject]


class TranscriptionResponse(BaseModel):
    text: str
