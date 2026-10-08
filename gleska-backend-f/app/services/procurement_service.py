"""Durable Phase 1 Procurement conversations and material requests."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from pydantic import ValidationError

from app.agents.procurement import PROCUREMENT_AGENT_DEFINITION
from app.agents.shared.runtime import AgentConversationMessage, AgentLLMRequest
from app.agents.shared.task import AgentTask, TaskState
from app.core.supabase import supabase
from app.llm.providers import GeminiLLMProvider, LLMProviderError
from app.schemas.auth import UserResponse
from app.schemas.procurement import (
    MaterialRequestDraft,
    PROCUREMENT_DRAFT_FIELDS,
    ProcurementConversationCreateResponse,
    ProcurementConversationMessage,
    ProcurementConversationMessageRequest,
    ProcurementDraftUpdateRequest,
    ProcurementMaterialRequestPatch,
    ProcurementMaterialRequestResponse,
    ProcurementSaveRequest,
)

logger = logging.getLogger(__name__)
HISTORY_LIMIT = 80
LIST_LIMIT = 100


class ProcurementServiceError(ValueError):
    """Base class for expected Procurement workflow failures."""


class ProcurementNotFound(ProcurementServiceError):
    """A Procurement row is missing or is not owned by the current employer."""


class ProcurementConflict(ProcurementServiceError):
    """The requested state revision or workflow transition is stale."""


class ProcurementAgentError(ProcurementServiceError):
    """The Procurement Agent could not produce a valid response."""


class ProcurementService:
    """Owner-scoped persistence boundary for Procurement Phase 1."""

    @staticmethod
    def _row(response: Any) -> dict[str, Any]:
        data = getattr(response, "data", None)
        if isinstance(data, list):
            return data[0] if data else {}
        return data or {}

    @staticmethod
    def _rows(response: Any) -> list[dict[str, Any]]:
        data = getattr(response, "data", None)
        return data if isinstance(data, list) else []

    @staticmethod
    def _employer_id(user: UserResponse) -> str:
        response = (
            supabase.table("employer_profiles")
            .select("id,onboarding_status")
            .eq("user_id", str(user.id))
            .maybe_single()
            .execute()
        )
        employer = ProcurementService._row(response)
        if not employer.get("id"):
            raise ProcurementNotFound("EMPLOYER_NOT_FOUND")
        if employer.get("onboarding_status") != "COMPLETED":
            raise PermissionError("EMPLOYER_ONBOARDING_INCOMPLETE")
        return str(employer["id"])

    @staticmethod
    def _history(value: Any) -> list[ProcurementConversationMessage]:
        if not isinstance(value, list):
            raise ProcurementConflict("CONVERSATION_HISTORY_INVALID")
        try:
            return [
                ProcurementConversationMessage.model_validate(item)
                for item in value[-HISTORY_LIMIT:]
            ]
        except ValidationError as exc:
            raise ProcurementConflict("CONVERSATION_HISTORY_INVALID") from exc

    @staticmethod
    def _conversation_response(row: dict[str, Any]) -> ProcurementConversationCreateResponse:
        try:
            draft = MaterialRequestDraft.model_validate(row.get("draft") or {})
            history = ProcurementService._history(row.get("history") or [])
            return ProcurementConversationCreateResponse(
                conversation_id=row["id"],
                status=row["status"],
                history=history,
                draft=draft,
                confirmed_fields=row.get("confirmed_fields") or [],
                revision=int(row.get("revision") or 0),
                created_at=row["created_at"],
                updated_at=row["updated_at"],
            )
        except (KeyError, ValidationError, TypeError, ValueError) as exc:
            if isinstance(exc, ProcurementServiceError):
                raise
            raise ProcurementConflict("CONVERSATION_STATE_INVALID") from exc

    @staticmethod
    def _material_request_response(row: dict[str, Any]) -> ProcurementMaterialRequestResponse:
        try:
            return ProcurementMaterialRequestResponse.model_validate(row)
        except (ValidationError, TypeError, ValueError) as exc:
            raise ProcurementConflict("MATERIAL_REQUEST_STATE_INVALID") from exc

    @staticmethod
    def _owned_conversation(
        conversation_id: UUID,
        user: UserResponse,
        employer_id: str,
    ) -> dict[str, Any]:
        response = (
            supabase.table("procurement_conversations")
            .select("*")
            .eq("id", str(conversation_id))
            .eq("user_id", str(user.id))
            .eq("employer_id", employer_id)
            .maybe_single()
            .execute()
        )
        conversation = ProcurementService._row(response)
        if not conversation:
            raise ProcurementNotFound("CONVERSATION_NOT_FOUND")
        return conversation

    @staticmethod
    def _owned_request(
        request_id: UUID,
        user: UserResponse,
        employer_id: str,
    ) -> dict[str, Any]:
        response = (
            supabase.table("procurement_material_requests")
            .select("*")
            .eq("id", str(request_id))
            .eq("user_id", str(user.id))
            .eq("employer_id", employer_id)
            .maybe_single()
            .execute()
        )
        material_request = ProcurementService._row(response)
        if not material_request:
            raise ProcurementNotFound("MATERIAL_REQUEST_NOT_FOUND")
        return material_request

    @classmethod
    def create_conversation(
        cls,
        user: UserResponse,
    ) -> ProcurementConversationCreateResponse:
        employer_id = cls._employer_id(user)
        now = datetime.now(timezone.utc).isoformat()
        initial_draft = MaterialRequestDraft()
        response = (
            supabase.table("procurement_conversations")
            .insert({
                "id": str(uuid4()),
                "employer_id": employer_id,
                "user_id": str(user.id),
                "status": "ACTIVE",
                "history": [],
                "draft": initial_draft.model_dump(mode="json"),
                "confirmed_fields": [],
                "revision": 0,
                "created_at": now,
                "updated_at": now,
            })
            .execute()
        )
        row = cls._row(response)
        if not row:
            raise ProcurementServiceError("CONVERSATION_CREATE_FAILED")
        return cls._conversation_response(row)

    @classmethod
    def list_conversations(
        cls,
        user: UserResponse,
    ) -> list[ProcurementConversationCreateResponse]:
        employer_id = cls._employer_id(user)
        response = (
            supabase.table("procurement_conversations")
            .select("*")
            .eq("user_id", str(user.id))
            .eq("employer_id", employer_id)
            .order("updated_at", desc=True)
            .limit(LIST_LIMIT)
            .execute()
        )
        return [cls._conversation_response(row) for row in cls._rows(response)]

    @classmethod
    def get_conversation(
        cls,
        user: UserResponse,
        conversation_id: UUID,
    ) -> ProcurementConversationCreateResponse:
        employer_id = cls._employer_id(user)
        return cls._conversation_response(
            cls._owned_conversation(conversation_id, user, employer_id)
        )

    @classmethod
    async def process_message(
        cls,
        user: UserResponse,
        conversation_id: UUID,
        request: ProcurementConversationMessageRequest,
    ) -> ProcurementConversationCreateResponse:
        employer_id = cls._employer_id(user)
        conversation = cls._owned_conversation(conversation_id, user, employer_id)
        revision = int(conversation.get("revision") or 0)
        if revision != request.expected_revision:
            raise ProcurementConflict("STALE_CONVERSATION_STATE")
        if conversation.get("status") != "ACTIVE":
            raise ProcurementConflict("CONVERSATION_NOT_ACTIVE")

        history = cls._history(conversation.get("history") or [])
        draft = MaterialRequestDraft.model_validate(conversation.get("draft") or {})
        task = AgentTask(
            task_id=str(conversation_id),
            task_type="procurement_material_request",
        )
        task_state = TaskState(
            data={"draft": draft.model_dump(mode="json")},
            current_step="clarify_material_requirement",
        )
        try:
            response = await GeminiLLMProvider().generate_agent_response(
                AgentLLMRequest(
                    agent=PROCUREMENT_AGENT_DEFINITION,
                    message=request.message,
                    history=[
                        AgentConversationMessage(role=item.role, content=item.content)
                        for item in history
                    ],
                    task=task,
                    task_state=task_state,
                )
            )
            if response.error is not None or response.tool_calls:
                raise ProcurementAgentError("PROCUREMENT_AGENT_INVALID_RESPONSE")
            proposed_state = response.task_state
            proposed_draft = draft.model_dump(mode="json")
            if proposed_state is not None:
                draft_proposal = proposed_state.data.get("draft", {})
                if not isinstance(draft_proposal, dict):
                    raise ProcurementAgentError("PROCUREMENT_AGENT_INVALID_DRAFT")
                unknown_fields = set(draft_proposal) - set(PROCUREMENT_DRAFT_FIELDS)
                if unknown_fields:
                    raise ProcurementAgentError("PROCUREMENT_AGENT_INVALID_DRAFT")
                proposed_draft.update(draft_proposal)
            validated_draft = MaterialRequestDraft.model_validate(proposed_draft)
        except LLMProviderError as exc:
            logger.warning(
                "Procurement LLM request failed: user_id=%s code=%s",
                user.id,
                exc.code,
            )
            raise ProcurementAgentError(exc.code) from exc
        except ValidationError as exc:
            raise ProcurementAgentError("PROCUREMENT_AGENT_INVALID_DRAFT") from exc

        old_values = draft.model_dump(mode="json")
        new_values = validated_draft.model_dump(mode="json")
        confirmed_fields = [
            field_name
            for field_name in conversation.get("confirmed_fields") or []
            if old_values.get(field_name) == new_values.get(field_name)
        ]
        now = datetime.now(timezone.utc)
        next_history = [
            *history,
            ProcurementConversationMessage(
                role="user",
                content=request.message,
                created_at=now,
            ),
            ProcurementConversationMessage(
                role="assistant",
                content=response.assistant_message,
                created_at=now,
            ),
        ][-HISTORY_LIMIT:]
        update = (
            supabase.table("procurement_conversations")
            .update({
                "history": [item.model_dump(mode="json") for item in next_history],
                "draft": validated_draft.model_dump(mode="json"),
                "confirmed_fields": confirmed_fields,
                "revision": revision + 1,
                "updated_at": now.isoformat(),
            })
            .eq("id", str(conversation_id))
            .eq("user_id", str(user.id))
            .eq("employer_id", employer_id)
            .eq("revision", revision)
            .eq("status", "ACTIVE")
            .execute()
        )
        row = cls._row(update)
        if not row:
            raise ProcurementConflict("STALE_CONVERSATION_STATE")
        return cls._conversation_response(row)

    @classmethod
    def update_draft(
        cls,
        user: UserResponse,
        conversation_id: UUID,
        request: ProcurementDraftUpdateRequest,
    ) -> ProcurementConversationCreateResponse:
        employer_id = cls._employer_id(user)
        conversation = cls._owned_conversation(conversation_id, user, employer_id)
        revision = int(conversation.get("revision") or 0)
        if revision != request.expected_revision:
            raise ProcurementConflict("STALE_CONVERSATION_STATE")
        if conversation.get("status") != "ACTIVE":
            raise ProcurementConflict("CONVERSATION_NOT_ACTIVE")

        now = datetime.now(timezone.utc)
        response = (
            supabase.table("procurement_conversations")
            .update({
                "draft": request.draft.model_dump(mode="json"),
                "confirmed_fields": request.confirmed_fields,
                "revision": revision + 1,
                "updated_at": now.isoformat(),
            })
            .eq("id", str(conversation_id))
            .eq("user_id", str(user.id))
            .eq("employer_id", employer_id)
            .eq("revision", revision)
            .eq("status", "ACTIVE")
            .execute()
        )
        row = cls._row(response)
        if not row:
            raise ProcurementConflict("STALE_CONVERSATION_STATE")
        return cls._conversation_response(row)

    @classmethod
    def list_material_requests(
        cls,
        user: UserResponse,
    ) -> list[ProcurementMaterialRequestResponse]:
        employer_id = cls._employer_id(user)
        response = (
            supabase.table("procurement_material_requests")
            .select("*")
            .eq("user_id", str(user.id))
            .eq("employer_id", employer_id)
            .order("updated_at", desc=True)
            .limit(LIST_LIMIT)
            .execute()
        )
        return [
            cls._material_request_response(row)
            for row in cls._rows(response)
        ]

    @classmethod
    def get_material_request(
        cls,
        user: UserResponse,
        request_id: UUID,
    ) -> ProcurementMaterialRequestResponse:
        employer_id = cls._employer_id(user)
        return cls._material_request_response(
            cls._owned_request(request_id, user, employer_id)
        )

    @classmethod
    def save_material_request(
        cls,
        user: UserResponse,
        conversation_id: UUID,
        request: ProcurementSaveRequest,
    ) -> ProcurementMaterialRequestResponse:
        employer_id = cls._employer_id(user)
        existing_response = (
            supabase.table("procurement_material_requests")
            .select("*")
            .eq("employer_id", employer_id)
            .eq("user_id", str(user.id))
            .eq("idempotency_key", str(request.idempotency_key))
            .maybe_single()
            .execute()
        )
        existing = cls._row(existing_response)
        if existing:
            if str(existing.get("origin_conversation_id")) != str(conversation_id):
                raise ProcurementConflict("IDEMPOTENCY_KEY_REUSED")
            return cls._material_request_response(existing)

        conversation = cls._owned_conversation(conversation_id, user, employer_id)
        revision = int(conversation.get("revision") or 0)
        if revision != request.expected_revision:
            raise ProcurementConflict("STALE_CONVERSATION_STATE")
        if conversation.get("status") != "ACTIVE":
            raise ProcurementConflict("CONVERSATION_NOT_ACTIVE")

        draft = MaterialRequestDraft.model_validate(conversation.get("draft") or {})
        confirmed_fields = list(conversation.get("confirmed_fields") or [])
        for required_field in ("item_name", "quantity", "unit"):
            if required_field not in confirmed_fields or getattr(draft, required_field) is None:
                raise ProcurementConflict("REQUIRED_FIELDS_NOT_CONFIRMED")

        now = datetime.now(timezone.utc).isoformat()
        payload = draft.model_dump(mode="json")
        try:
            inserted = (
                supabase.table("procurement_material_requests")
                .insert({
                    "employer_id": employer_id,
                    "user_id": str(user.id),
                    "origin_conversation_id": str(conversation_id),
                    "idempotency_key": str(request.idempotency_key),
                    **payload,
                    "confirmed_fields": confirmed_fields,
                    "status": "SAVED",
                    "revision": 0,
                    "created_at": now,
                    "updated_at": now,
                })
                .execute()
            )
            saved = cls._row(inserted)
        except Exception:
            replay = (
                supabase.table("procurement_material_requests")
                .select("*")
                .eq("employer_id", employer_id)
                .eq("user_id", str(user.id))
                .eq("idempotency_key", str(request.idempotency_key))
                .maybe_single()
                .execute()
            )
            saved = cls._row(replay)
            if not saved:
                raise
            if str(saved.get("origin_conversation_id")) != str(conversation_id):
                raise ProcurementConflict("IDEMPOTENCY_KEY_REUSED")
            return cls._material_request_response(saved)

        if not saved:
            raise ProcurementServiceError("MATERIAL_REQUEST_SAVE_FAILED")

        completed = (
            supabase.table("procurement_conversations")
            .update({
                "status": "COMPLETED",
                "revision": revision + 1,
                "updated_at": now,
            })
            .eq("id", str(conversation_id))
            .eq("user_id", str(user.id))
            .eq("employer_id", employer_id)
            .eq("revision", revision)
            .eq("status", "ACTIVE")
            .execute()
        )
        if not cls._row(completed):
            raise ProcurementConflict("REQUEST_SAVED_CONVERSATION_STALE")
        return cls._material_request_response(saved)

    @classmethod
    def update_material_request(
        cls,
        user: UserResponse,
        request_id: UUID,
        request: ProcurementMaterialRequestPatch,
    ) -> ProcurementMaterialRequestResponse:
        employer_id = cls._employer_id(user)
        existing = cls._owned_request(request_id, user, employer_id)
        revision = int(existing.get("revision") or 0)
        if revision != request.expected_revision:
            raise ProcurementConflict("STALE_MATERIAL_REQUEST")

        current = MaterialRequestDraft.model_validate({
            field_name: existing.get(field_name)
            for field_name in PROCUREMENT_DRAFT_FIELDS
        })
        current_values = current.model_dump(mode="python")
        patch_values = request.model_dump(
            mode="python",
            exclude_unset=True,
            exclude={"expected_revision"},
        )
        current_values.update(patch_values)
        try:
            updated_draft = MaterialRequestDraft.model_validate(current_values)
        except ValidationError as exc:
            raise ProcurementConflict("MATERIAL_REQUEST_INVALID") from exc

        confirmed_fields = set(existing.get("confirmed_fields") or [])
        for field_name in patch_values:
            value = getattr(updated_draft, field_name)
            if value is None or value == []:
                confirmed_fields.discard(field_name)
            else:
                confirmed_fields.add(field_name)
        for required_field in ("item_name", "quantity", "unit"):
            if getattr(updated_draft, required_field) is None:
                raise ProcurementConflict("REQUIRED_FIELDS_CANNOT_BE_EMPTY")
            confirmed_fields.add(required_field)

        now = datetime.now(timezone.utc).isoformat()
        response = (
            supabase.table("procurement_material_requests")
            .update({
                **updated_draft.model_dump(mode="json"),
                "confirmed_fields": sorted(confirmed_fields),
                "revision": revision + 1,
                "updated_at": now,
            })
            .eq("id", str(request_id))
            .eq("user_id", str(user.id))
            .eq("employer_id", employer_id)
            .eq("revision", revision)
            .execute()
        )
        row = cls._row(response)
        if not row:
            raise ProcurementConflict("STALE_MATERIAL_REQUEST")
        return cls._material_request_response(row)
