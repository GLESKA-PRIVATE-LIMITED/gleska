"""Durable Phase 1 Procurement conversations and material requests."""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Iterator, Literal
from uuid import UUID, uuid4

from pydantic import ValidationError

from app.agents.shared.runtime import AgentConversationMessage
from app.agents.shared.task import AgentTask, TaskState
from app.core.supabase import supabase
from app.llm.providers import LLMProviderError
from app.schemas.auth import UserResponse
from app.services.pagination import (
    decode_created_cursor,
    decode_numeric_cursor,
    encode_created_cursor,
)
from app.schemas.procurement import (
    MaterialRequestDraft,
    PROCUREMENT_DRAFT_FIELDS,
    ProcurementConversationCreateResponse,
    ProcurementConversationHistoryPage,
    ProcurementConversationListResponse,
    ProcurementConversationMessage,
    ProcurementConversationMessageRequest,
    ProcurementDraftUpdateRequest,
    ProcurementMaterialRequestPatch,
    ProcurementMaterialRequestResponse,
    ProcurementMaterialRequestListResponse,
    ProcurementSaveRequest,
    ProcurementSettings,
    ProcurementSettingsUpdate,
    ProcurementSupplierDiscoveryResponse,
    ProcurementSupplierOfferingMatch,
)
from app.services.procurement_agent_service import ProcurementAgentService

logger = logging.getLogger(__name__)
HISTORY_LIMIT = 80
DEFAULT_PAGE_SIZE = 25
MAX_PAGE_SIZE = 100
DISCOVERY_SCAN_PAGE_SIZE = 500
DISCOVERY_RESULT_LIMIT = 100
DISCOVERY_COMPANY_BATCH_SIZE = 100


def _search_tokens(value: str | None) -> set[str]:
    return set(re.findall(r"\w+", value.casefold())) if value else set()


def _material_tokens(value: str | None) -> set[str]:
    if not value:
        return set()

    # A steel grade identifies specification, not the underlying material.
    material_name = re.sub(r"\bfe[\s-]*\d+[a-z]?\b", " ", value, flags=re.IGNORECASE)
    tokens = _search_tokens(material_name)
    reinforcement_terms = {
        "bar", "bars", "rebar", "rebars", "reinforcement", "reinforcing",
    }
    if (
        tokens & {"steel", "tmt", "rebar", "rebars", "reinforcement", "reinforcing"}
        and tokens & reinforcement_terms
    ):
        tokens.difference_update(reinforcement_terms)
        tokens.add("rebar")
    return tokens


def _coverage_matches(delivery_location: str, service_coverage: list[str]) -> bool:
    location_parts = [
        tokens
        for part in re.split(r"[,;]", delivery_location)
        if (tokens := _search_tokens(part))
    ]
    coverage_parts = [
        tokens
        for area in service_coverage
        for part in re.split(r"[,;]", area)
        if (tokens := _search_tokens(part))
    ]
    return any(
        location_part == coverage_part
        or location_part <= coverage_part
        or coverage_part <= location_part
        for location_part in location_parts
        for coverage_part in coverage_parts
    )


class ProcurementServiceError(ValueError):
    """Base class for expected Procurement workflow failures."""


class ProcurementNotFound(ProcurementServiceError):
    """A Procurement row is missing or is not owned by the current employer."""


class ProcurementConflict(ProcurementServiceError):
    """The requested state revision or workflow transition is stale."""


class ProcurementAgentError(ProcurementServiceError):
    """The Procurement Agent could not produce a valid response."""


def _is_empty_draft_value(value: Any) -> bool:
    return value is None or value == "" or value == []


def _merge_model_draft_proposal(
    current_draft: dict[str, Any],
    proposal: Any,
    cleared_fields: set[str],
) -> dict[str, Any]:
    if not isinstance(proposal, dict):
        raise ProcurementAgentError("PROCUREMENT_AGENT_INVALID_DRAFT")
    unknown_fields = set(proposal) - set(PROCUREMENT_DRAFT_FIELDS)
    if unknown_fields:
        raise ProcurementAgentError("PROCUREMENT_AGENT_INVALID_DRAFT")

    merged_draft = dict(current_draft)
    for field_name, value in proposal.items():
        if (
            field_name not in cleared_fields
            and _is_empty_draft_value(merged_draft.get(field_name))
        ):
            merged_draft[field_name] = value
    return merged_draft


def _cleared_fields_after_user_edit(
    previous_draft: dict[str, Any],
    updated_draft: dict[str, Any],
    existing_cleared_fields: list[str],
    requested_cleared_fields: list[str],
) -> list[str]:
    cleared_fields = set(existing_cleared_fields) | set(requested_cleared_fields)
    for field_name in PROCUREMENT_DRAFT_FIELDS:
        updated_value = updated_draft.get(field_name)
        if not _is_empty_draft_value(updated_value):
            cleared_fields.discard(field_name)
        elif not _is_empty_draft_value(previous_draft.get(field_name)):
            cleared_fields.add(field_name)
    return sorted(cleared_fields)


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
    def _procurement_settings(user: UserResponse) -> ProcurementSettings:
        try:
            response = (
                supabase.table("employer_preferences")
                .select(
                    "procurement_default_delivery_location, procurement_preferred_units, "
                    "procurement_specification_match_policy, "
                    "procurement_delivery_coverage_policy, updated_at"
                )
                .eq("user_id", str(user.id))
                .maybe_single()
                .execute()
            )
        except Exception as exc:
            logger.error(
                "Procurement settings lookup failed: user_id=%s exception_type=%s",
                user.id,
                type(exc).__name__,
            )
            raise ProcurementServiceError("PROCUREMENT_SETTINGS_LOAD_FAILED") from exc

        row = ProcurementService._row(response)
        if not row:
            return ProcurementSettings()
        try:
            return ProcurementSettings(
                default_delivery_location=row.get("procurement_default_delivery_location"),
                preferred_units=row.get("procurement_preferred_units") or [],
                specification_match_policy=row.get("procurement_specification_match_policy")
                or "REVIEW_DIFFERENCES",
                delivery_coverage_policy=row.get("procurement_delivery_coverage_policy")
                or "ALLOW_UNSPECIFIED",
                updated_at=row.get("updated_at"),
            )
        except ValidationError as exc:
            logger.warning(
                "Procurement settings row is invalid: user_id=%s exception_type=%s",
                user.id,
                type(exc).__name__,
            )
            raise ProcurementServiceError("PROCUREMENT_SETTINGS_INVALID") from exc

    @classmethod
    def get_procurement_settings(cls, user: UserResponse) -> ProcurementSettings:
        cls._employer_id(user)
        return cls._procurement_settings(user)

    @classmethod
    def update_procurement_settings(
        cls,
        user: UserResponse,
        settings: ProcurementSettingsUpdate,
    ) -> ProcurementSettings:
        cls._employer_id(user)
        payload = settings.model_dump(mode="json")
        try:
            response = (
                supabase.table("employer_preferences")
                .upsert(
                    {
                        "user_id": str(user.id),
                        "procurement_default_delivery_location": payload["default_delivery_location"],
                        "procurement_preferred_units": payload["preferred_units"],
                        "procurement_specification_match_policy": payload["specification_match_policy"],
                        "procurement_delivery_coverage_policy": payload["delivery_coverage_policy"],
                    },
                    on_conflict="user_id",
                )
                .execute()
            )
        except Exception as exc:
            logger.error(
                "Procurement settings update failed: user_id=%s exception_type=%s",
                user.id,
                type(exc).__name__,
            )
            raise ProcurementServiceError("PROCUREMENT_SETTINGS_SAVE_FAILED") from exc

        return cls._procurement_settings(user)

    @staticmethod
    def _history(
        value: Any,
        conversation_id: str | None = None,
        user_id: str | None = None,
    ) -> list[ProcurementConversationMessage]:
        if not isinstance(value, list):
            raise ProcurementServiceError("CONVERSATION_HISTORY_INVALID")
        try:
            return [
                ProcurementConversationMessage.model_validate(item)
                for item in value[-HISTORY_LIMIT:]
            ]
        except ValidationError as exc:
            logger.warning(
                "Failed to validate conversation history: conversation_id=%s user_id=%s exception_type=%s",
                conversation_id,
                user_id,
                type(exc).__name__,
            )
            raise ProcurementServiceError("CONVERSATION_HISTORY_INVALID") from exc

    @staticmethod
    def _conversation_response(row: dict[str, Any]) -> ProcurementConversationCreateResponse:
        try:
            draft = MaterialRequestDraft.model_validate(row.get("draft") or {})
            history = ProcurementService._history(
                row.get("history") or [],
                conversation_id=str(row.get("id") or ""),
                user_id=str(row.get("user_id") or ""),
            )
            return ProcurementConversationCreateResponse(
                conversation_id=row["id"],
                status=row["status"],
                history=history,
                history_limit_reached=False,
                draft=draft,
                confirmed_fields=row.get("confirmed_fields") or [],
                cleared_fields=row.get("cleared_fields") or [],
                revision=int(row.get("revision") or 0),
                created_at=row["created_at"],
                updated_at=row["updated_at"],
            )
        except (KeyError, ValidationError, TypeError, ValueError) as exc:
            if isinstance(exc, ProcurementServiceError):
                raise
            logger.warning(
                "Failed to validate conversation row: conversation_id=%s user_id=%s exception_type=%s",
                row.get("id"),
                row.get("user_id"),
                type(exc).__name__,
            )
            raise ProcurementServiceError("CONVERSATION_STATE_INVALID") from exc

    @staticmethod
    def _material_request_response(row: dict[str, Any]) -> ProcurementMaterialRequestResponse:
        try:
            return ProcurementMaterialRequestResponse.model_validate(row)
        except (ValidationError, TypeError, ValueError) as exc:
            logger.warning(
                "Failed to validate material request row: request_id=%s user_id=%s exception_type=%s",
                row.get("id"),
                row.get("user_id"),
                type(exc).__name__,
            )
            raise ProcurementServiceError("MATERIAL_REQUEST_STATE_INVALID") from exc

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
        settings = cls._procurement_settings(user)
        initial_draft = MaterialRequestDraft(
            delivery_location=settings.default_delivery_location,
            unit=settings.preferred_units[0] if settings.preferred_units else None,
        )
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
                "cleared_fields": [],
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
        page: int = 1,
        page_size: int = DEFAULT_PAGE_SIZE,
        cursor: str | None = None,
    ) -> ProcurementConversationListResponse:
        employer_id = cls._employer_id(user)
        query = (
            supabase.table("procurement_conversations")
            .select("*")
            .eq("user_id", str(user.id))
            .eq("employer_id", employer_id)
            .order("created_at", desc=True)
            .order("id", desc=True)
        )
        if cursor:
            try:
                created_at, row_id = decode_created_cursor(cursor)
            except ValueError as exc:
                raise ProcurementServiceError("PAGINATION_CURSOR_INVALID") from exc
            query = query.or_(f"created_at.lt.{created_at},and(created_at.eq.{created_at},id.lt.{row_id})")
        rows = cls._rows(query.range(0, page_size).execute())
        page_rows = rows[:page_size]
        conversations: list[ProcurementConversationCreateResponse] = []
        for row in page_rows:
            try:
                conversations.append(cls._conversation_response(row))
            except Exception as exc:
                logger.warning(
                    "Skipping unparseable conversation row: conversation_id=%s user_id=%s exception_type=%s",
                    row.get("id"),
                    row.get("user_id"),
                    type(exc).__name__,
                )
        return ProcurementConversationListResponse(
            items=conversations,
            page=page,
            page_size=page_size,
            has_more=len(rows) > page_size,
            next_cursor=(
                encode_created_cursor(str(page_rows[-1]["created_at"]), str(page_rows[-1]["id"]))
                if len(rows) > page_size and page_rows else None
            ),
        )

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
            data={
                "draft": draft.model_dump(mode="json"),
                "cleared_fields": conversation.get("cleared_fields") or [],
            },
            current_step="clarify_material_requirement",
        )
        try:
            response = await ProcurementAgentService.generate_response(
                user=user,
                message=request.message,
                history=[
                    AgentConversationMessage(role=item.role, content=item.content)
                    for item in history
                ],
                task=task,
                task_state=task_state,
            )
            if response.error is not None or response.tool_calls:
                raise ProcurementAgentError("PROCUREMENT_AGENT_INVALID_RESPONSE")
            if len(response.assistant_message) > 4000:
                raise ProcurementAgentError("PROCUREMENT_AGENT_RESPONSE_TOO_LONG")
            proposed_state = response.task_state
            proposed_draft = draft.model_dump(mode="json")
            if proposed_state is not None:
                proposed_draft = _merge_model_draft_proposal(
                    proposed_draft,
                    proposed_state.data.get("draft", {}),
                    set(conversation.get("cleared_fields") or []),
                )
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
        result = cls._row(
            supabase.rpc(
                "append_procurement_conversation_turn",
                {
                    "p_conversation_id": str(conversation_id),
                    "p_user_id": str(user.id),
                    "p_employer_id": employer_id,
                    "p_expected_revision": revision,
                    "p_user_message": request.message,
                    "p_assistant_message": response.assistant_message,
                    "p_history": [
                        item.model_dump(mode="json", exclude_none=True)
                        for item in next_history
                    ],
                    "p_draft": validated_draft.model_dump(mode="json"),
                    "p_confirmed_fields": confirmed_fields,
                },
            ).execute()
        )
        if result.get("ok") is not True:
            error_code = str(result.get("error_code") or "CONVERSATION_STATE_INVALID")
            if error_code in {"STALE_CONVERSATION_STATE", "CONVERSATION_NOT_ACTIVE"}:
                raise ProcurementConflict(error_code)
            raise ProcurementServiceError(error_code)
        row = result.get("conversation")
        if not isinstance(row, dict):
            raise ProcurementServiceError("CONVERSATION_STATE_INVALID")
        return cls._conversation_response(row)

    @classmethod
    def list_conversation_history(
        cls,
        user: UserResponse,
        conversation_id: UUID,
        page_size: int = HISTORY_LIMIT,
        cursor: str | None = None,
    ) -> ProcurementConversationHistoryPage:
        employer_id = cls._employer_id(user)
        cls._owned_conversation(conversation_id, user, employer_id)
        query = (
            supabase.table("procurement_conversation_messages")
            .select("id, role, content, created_at")
            .eq("conversation_id", str(conversation_id))
            .eq("user_id", str(user.id))
            .eq("employer_id", employer_id)
            .order("id", desc=True)
        )
        if cursor:
            try:
                before_id = decode_numeric_cursor(cursor)
            except ValueError as exc:
                raise ProcurementServiceError("PAGINATION_CURSOR_INVALID") from exc
            query = query.lt("id", before_id)
        rows = cls._rows(query.range(0, page_size).execute())
        page_rows = rows[:page_size]
        items = [
            ProcurementConversationMessage(
                message_id=int(row["id"]),
                role=row["role"],
                content=row["content"],
                created_at=row["created_at"],
            )
            for row in reversed(page_rows)
        ]
        has_more = len(rows) > page_size
        return ProcurementConversationHistoryPage(
            items=items,
            page_size=page_size,
            has_more=has_more,
            next_cursor=str(page_rows[-1]["id"]) if has_more and page_rows else None,
        )

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
        previous_draft = MaterialRequestDraft.model_validate(
            conversation.get("draft") or {}
        ).model_dump(mode="json")
        updated_draft = request.draft.model_dump(mode="json")
        cleared_fields = _cleared_fields_after_user_edit(
            previous_draft,
            updated_draft,
            conversation.get("cleared_fields") or [],
            request.cleared_fields,
        )
        response = (
            supabase.table("procurement_conversations")
            .update({
                "draft": request.draft.model_dump(mode="json"),
                "confirmed_fields": request.confirmed_fields,
                "cleared_fields": cleared_fields,
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
        page: int = 1,
        page_size: int = DEFAULT_PAGE_SIZE,
        cursor: str | None = None,
    ) -> ProcurementMaterialRequestListResponse:
        employer_id = cls._employer_id(user)
        query = (
            supabase.table("procurement_material_requests")
            .select("*")
            .eq("user_id", str(user.id))
            .eq("employer_id", employer_id)
            .order("created_at", desc=True)
            .order("id", desc=True)
        )
        if cursor:
            try:
                created_at, row_id = decode_created_cursor(cursor)
            except ValueError as exc:
                raise ProcurementServiceError("PAGINATION_CURSOR_INVALID") from exc
            query = query.or_(f"created_at.lt.{created_at},and(created_at.eq.{created_at},id.lt.{row_id})")
        rows = cls._rows(query.range(0, page_size).execute())
        page_rows = rows[:page_size]
        requests: list[ProcurementMaterialRequestResponse] = []
        for row in page_rows:
            try:
                requests.append(cls._material_request_response(row))
            except Exception as exc:
                logger.warning(
                    "Skipping unparseable material request row: request_id=%s user_id=%s exception_type=%s",
                    row.get("id"),
                    row.get("user_id"),
                    type(exc).__name__,
                )
        return ProcurementMaterialRequestListResponse(
            items=requests,
            page=page,
            page_size=page_size,
            has_more=len(rows) > page_size,
            next_cursor=(
                encode_created_cursor(str(page_rows[-1]["created_at"]), str(page_rows[-1]["id"]))
                if len(rows) > page_size and page_rows else None
            ),
        )

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
    def discover_supplier_offerings(
        cls,
        user: UserResponse,
        request_id: UUID,
        delivery_location_override: str | None = None,
    ) -> ProcurementSupplierDiscoveryResponse:
        employer_id = cls._employer_id(user)
        request = cls._owned_request(request_id, user, employer_id)
        settings = cls._procurement_settings(user)

        requested_item_tokens = _material_tokens(str(request.get("item_name") or ""))
        requested_spec_tokens = _search_tokens(request.get("specification"))
        requested_listing_tokens = requested_item_tokens | requested_spec_tokens
        requested_quantity = Decimal(str(request["quantity"]))
        requested_unit = str(request["unit"]).strip().casefold()
        delivery_location = delivery_location_override or request.get("delivery_location")
        ranked_matches: list[
            tuple[float, float, float, int, ProcurementSupplierOfferingMatch]
        ] = []

        def iter_eligible_offerings() -> Iterator[tuple[dict[str, Any], str]]:
            cursor: tuple[str, str] | None = None
            while True:
                try:
                    query = (
                        supabase.table("supplier_material_offerings")
                        .select(
                            "id, company_id, name, specification, unit, indicative_price, "
                            "currency_code, minimum_order_quantity, service_coverage, created_at"
                        )
                        .eq("is_available", True)
                        .is_("archived_at", "null")
                        .order("created_at", desc=True)
                        .order("id", desc=True)
                    )
                    if cursor:
                        created_at, row_id = cursor
                        query = query.or_(
                            f"created_at.lt.{created_at},and(created_at.eq.{created_at},id.lt.{row_id})"
                        )
                    offering_rows = cls._rows(
                        query.range(0, DISCOVERY_SCAN_PAGE_SIZE - 1).execute()
                    )
                    company_ids = list(dict.fromkeys(
                        str(row["company_id"])
                        for row in offering_rows
                        if row.get("company_id")
                    ))
                    eligible_companies: dict[str, str] = {}
                    for start in range(0, len(company_ids), DISCOVERY_COMPANY_BATCH_SIZE):
                        company_batch = company_ids[start:start + DISCOVERY_COMPANY_BATCH_SIZE]
                        companies_response = (
                            supabase.table("supplier_companies")
                            .select("id, name")
                            .in_("id", company_batch)
                            .eq("operational_status", "ACTIVE")
                            .eq("verification_status", "VERIFIED")
                            .execute()
                        )
                        eligible_companies.update({
                            str(company["id"]): str(company["name"])
                            for company in cls._rows(companies_response)
                        })
                except Exception as exc:
                    logger.error(
                        "Supplier discovery query failed: user_id=%s request_id=%s exception_type=%s",
                        user.id,
                        request_id,
                        type(exc).__name__,
                    )
                    raise ProcurementServiceError("SUPPLIER_DISCOVERY_FAILED") from exc

                for offering in offering_rows:
                    supplier_name = eligible_companies.get(str(offering.get("company_id") or ""))
                    if supplier_name:
                        yield offering, supplier_name
                if len(offering_rows) < DISCOVERY_SCAN_PAGE_SIZE:
                    break
                last_offering = offering_rows[-1]
                cursor = (str(last_offering["created_at"]), str(last_offering["id"]))

        matching_count = 0
        for offering, supplier_name in iter_eligible_offerings():
            company_id = str(offering.get("company_id") or "")

            offering_tokens = _material_tokens(str(offering.get("name") or ""))
            offering_spec_tokens = _search_tokens(offering.get("specification"))
            offering_listing_tokens = offering_tokens | offering_spec_tokens
            material_overlap = (
                len(requested_item_tokens & offering_tokens)
                / max(len(requested_item_tokens), 1)
            )
            listing_overlap = (
                len(requested_listing_tokens & offering_listing_tokens)
                / max(len(requested_listing_tokens), 1)
            )
            if material_overlap < 0.5 and listing_overlap < 0.5:
                continue

            coverage = offering.get("service_coverage") or []
            coverage_match = False
            if delivery_location and coverage:
                coverage_match = _coverage_matches(str(delivery_location), coverage)
                if not coverage_match:
                    continue

            offering_unit = str(offering.get("unit") or "").strip().casefold()
            units_match = offering_unit == requested_unit
            minimum_order = offering.get("minimum_order_quantity")
            minimum_order_compatible: bool | None = None
            if minimum_order is not None and units_match:
                minimum_order_compatible = (
                    requested_quantity >= Decimal(str(minimum_order))
                )
                if not minimum_order_compatible:
                    continue

            spec_overlap = (
                len(requested_spec_tokens & offering_spec_tokens)
                / max(len(requested_spec_tokens), 1)
                if requested_spec_tokens and offering_spec_tokens
                else 0.0
            )
            specification_match: Literal[
                "MATCHED", "PARTIAL", "NO_MATCH", "NOT_LISTED", "NOT_REQUESTED"
            ]
            if not requested_spec_tokens:
                specification_match = "NOT_REQUESTED"
            elif not offering_spec_tokens:
                specification_match = "NOT_LISTED"
            elif spec_overlap == 1:
                specification_match = "MATCHED"
            elif spec_overlap > 0:
                specification_match = "PARTIAL"
            else:
                specification_match = "NO_MATCH"
            if (
                requested_spec_tokens
                and settings.specification_match_policy == "REQUIRE_OVERLAP"
                and specification_match not in {"MATCHED", "PARTIAL"}
            ):
                continue

            coverage_match_status: Literal[
                "MATCHED", "NOT_SPECIFIED", "NOT_REQUESTED"
            ]
            if not delivery_location:
                coverage_match_status = "NOT_REQUESTED"
            elif not coverage:
                coverage_match_status = "NOT_SPECIFIED"
            else:
                coverage_match_status = "MATCHED"
            if (
                settings.delivery_coverage_policy == "REQUIRE_MATCH"
                and delivery_location
                and coverage_match_status != "MATCHED"
            ):
                continue

            reasons = ["Material name text matches the saved requirement."]
            if specification_match == "MATCHED":
                reasons.append("Listed specification text matches the requirement.")
            elif specification_match == "PARTIAL":
                reasons.append("Listed specification text overlaps; confirm exact compatibility.")
            elif specification_match == "NO_MATCH":
                reasons.append("Listed specification text does not match; confirm compatibility.")
            elif specification_match == "NOT_LISTED":
                reasons.append("The supplier has not listed a specification.")

            if material_overlap < 0.5 and listing_overlap >= 0.5:
                reasons[0] = (
                    "The offering name and listed specification text together "
                    "match the saved requirement."
                )

            if coverage_match_status == "MATCHED":
                reasons.append("Listed service coverage matches a delivery-location component.")
            elif coverage_match_status == "NOT_SPECIFIED":
                reasons.append("Service coverage is not listed, so delivery coverage is unconfirmed.")

            if minimum_order_compatible is True:
                reasons.append("Requested quantity meets the listed minimum order quantity.")
            elif minimum_order is None:
                reasons.append("No minimum order quantity is listed.")
            elif not units_match:
                reasons.append("Minimum order quantity could not be compared because units differ.")

            match = ProcurementSupplierOfferingMatch(
                supplier_company_id=company_id,
                supplier_name=supplier_name,
                offering_id=offering["id"],
                name=offering["name"],
                specification=offering.get("specification"),
                unit=offering["unit"],
                indicative_price=offering.get("indicative_price"),
                currency_code=offering.get("currency_code"),
                minimum_order_quantity=minimum_order,
                service_coverage=coverage,
                specification_match=specification_match,
                coverage_match=coverage_match_status,
                minimum_order_compatible=minimum_order_compatible,
                match_reasons=reasons,
            )
            ranked_matches.append((
                listing_overlap,
                material_overlap,
                spec_overlap,
                int(coverage_match_status == "MATCHED"),
                match,
            ))
            matching_count += 1
            if len(ranked_matches) >= 2 * DISCOVERY_RESULT_LIMIT:
                ranked_matches.sort(
                    key=lambda row: (
                        -row[0],
                        -row[1],
                        -row[2],
                        -row[3],
                        row[4].supplier_name.casefold(),
                        row[4].name.casefold(),
                    )
                )
                del ranked_matches[DISCOVERY_RESULT_LIMIT:]

        ranked_matches.sort(
            key=lambda row: (
                -row[0],
                -row[1],
                -row[2],
                -row[3],
                row[4].supplier_name.casefold(),
                row[4].name.casefold(),
            )
        )
        return ProcurementSupplierDiscoveryResponse(
            request_id=request_id,
            item_name=str(request["item_name"]),
            specification=request.get("specification"),
            quantity=requested_quantity,
            unit=str(request["unit"]),
            delivery_location=delivery_location,
            matches=[row[4] for row in ranked_matches[:DISCOVERY_RESULT_LIMIT]],
            search_limit_reached=matching_count > DISCOVERY_RESULT_LIMIT,
        )

    @classmethod
    def save_material_request(
        cls,
        user: UserResponse,
        conversation_id: UUID,
        request: ProcurementSaveRequest,
    ) -> ProcurementMaterialRequestResponse:
        employer_id = cls._employer_id(user)
        result = cls._row(
            supabase.rpc(
                "save_procurement_material_request",
                {
                    "p_conversation_id": str(conversation_id),
                    "p_user_id": str(user.id),
                    "p_employer_id": employer_id,
                    "p_expected_revision": request.expected_revision,
                    "p_idempotency_key": str(request.idempotency_key),
                },
            ).execute()
        )
        if result.get("ok") is not True:
            error_code = str(result.get("error_code") or "MATERIAL_REQUEST_SAVE_FAILED")
            if error_code in {"CONVERSATION_NOT_FOUND", "EMPLOYER_NOT_FOUND"}:
                raise ProcurementNotFound(error_code)
            if error_code == "PROCUREMENT_FORBIDDEN":
                raise PermissionError(error_code)
            if error_code in {
                "STALE_CONVERSATION_STATE",
                "CONVERSATION_NOT_ACTIVE",
                "REQUIRED_FIELDS_NOT_CONFIRMED",
                "IDEMPOTENCY_KEY_REUSED",
                "IDEMPOTENCY_PAYLOAD_CONFLICT",
                "CONVERSATION_ALREADY_SAVED",
            }:
                raise ProcurementConflict(error_code)
            raise ProcurementServiceError(error_code)

        saved = result.get("request")
        if not isinstance(saved, dict):
            raise ProcurementServiceError("MATERIAL_REQUEST_SAVE_FAILED")
        
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

    @classmethod
    def delete_material_request(
        cls,
        user: UserResponse,
        request_id: UUID,
    ) -> None:
        employer_id = cls._employer_id(user)
        cls._owned_request(request_id, user, employer_id)
        response = (
            supabase.table("procurement_material_requests")
            .delete()
            .eq("id", str(request_id))
            .eq("user_id", str(user.id))
            .eq("employer_id", employer_id)
            .select("id")
            .execute()
        )
        if not cls._row(response):
            raise ProcurementNotFound("MATERIAL_REQUEST_NOT_FOUND")
