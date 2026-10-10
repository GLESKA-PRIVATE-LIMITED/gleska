"""Durable Phase 1 Procurement conversations and material requests."""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Literal
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
    ProcurementSettings,
    ProcurementSettingsUpdate,
    ProcurementSupplierDiscoveryResponse,
    ProcurementSupplierOfferingMatch,
)

logger = logging.getLogger(__name__)
HISTORY_LIMIT = 80
LIST_LIMIT = 100
DISCOVERY_SCAN_LIMIT = 1000
DISCOVERY_RESULT_LIMIT = 100
DISCOVERY_COMPANY_BATCH_SIZE = 100


def _search_tokens(value: str | None) -> set[str]:
    return set(re.findall(r"\w+", value.casefold())) if value else set()


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
            logger.exception(
                "Procurement settings lookup failed: user_id=%s",
                user.id,
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
            logger.exception(
                "Procurement settings row is invalid: user_id=%s",
                user.id,
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
            logger.exception(
                "Procurement settings update failed: user_id=%s",
                user.id,
            )
            raise ProcurementServiceError("PROCUREMENT_SETTINGS_SAVE_FAILED") from exc

        return cls._procurement_settings(user)

    @staticmethod
    def _history(value: Any) -> list[ProcurementConversationMessage]:
        if not isinstance(value, list):
            raise ProcurementServiceError("CONVERSATION_HISTORY_INVALID")
        try:
            return [
                ProcurementConversationMessage.model_validate(item)
                for item in value[-HISTORY_LIMIT:]
            ]
        except ValidationError as exc:
            logger.exception("Failed to validate conversation history: %s", value)
            raise ProcurementServiceError("CONVERSATION_HISTORY_INVALID") from exc

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
            logger.exception("Failed to validate conversation row: %s", row)
            raise ProcurementServiceError("CONVERSATION_STATE_INVALID") from exc

    @staticmethod
    def _material_request_response(row: dict[str, Any]) -> ProcurementMaterialRequestResponse:
        try:
            return ProcurementMaterialRequestResponse.model_validate(row)
        except (ValidationError, TypeError, ValueError) as exc:
            logger.exception("Failed to validate material request row: %s", row)
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
        conversations: list[ProcurementConversationCreateResponse] = []
        for row in cls._rows(response):
            try:
                conversations.append(cls._conversation_response(row))
            except Exception as exc:
                logger.warning("Skipping unparseable conversation row id=%s: %s", row.get("id"), exc)
        return conversations

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
        requests: list[ProcurementMaterialRequestResponse] = []
        for row in cls._rows(response):
            try:
                requests.append(cls._material_request_response(row))
            except Exception as exc:
                logger.warning("Skipping unparseable material request row id=%s: %s", row.get("id"), exc)
        return requests

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
    ) -> ProcurementSupplierDiscoveryResponse:
        employer_id = cls._employer_id(user)
        request = cls._owned_request(request_id, user, employer_id)
        settings = cls._procurement_settings(user)

        try:
            offerings_response = (
                supabase.table("supplier_material_offerings")
                .select(
                    "id, company_id, name, specification, unit, indicative_price, "
                    "currency_code, minimum_order_quantity, service_coverage, updated_at"
                )
                .eq("is_available", True)
                .is_("archived_at", "null")
                .order("updated_at", desc=True)
                .limit(DISCOVERY_SCAN_LIMIT)
                .execute()
            )
            offering_rows = cls._rows(offerings_response)
            company_ids = list(dict.fromkeys(
                str(row["company_id"]) for row in offering_rows if row.get("company_id")
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
            logger.exception(
                "Supplier discovery query failed: user_id=%s request_id=%s",
                user.id,
                request_id,
            )
            raise ProcurementServiceError("SUPPLIER_DISCOVERY_FAILED") from exc

        requested_item_tokens = _search_tokens(str(request.get("item_name") or ""))
        requested_spec_tokens = _search_tokens(request.get("specification"))
        requested_listing_tokens = requested_item_tokens | requested_spec_tokens
        requested_quantity = Decimal(str(request["quantity"]))
        requested_unit = str(request["unit"]).strip().casefold()
        delivery_location = request.get("delivery_location")
        ranked_matches: list[
            tuple[float, float, float, int, ProcurementSupplierOfferingMatch]
        ] = []

        for offering in offering_rows:
            company_id = str(offering.get("company_id") or "")
            supplier_name = eligible_companies.get(company_id)
            if not supplier_name:
                continue

            offering_tokens = _search_tokens(str(offering.get("name") or ""))
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
            search_limit_reached=len(offering_rows) >= DISCOVERY_SCAN_LIMIT
            or len(ranked_matches) > DISCOVERY_RESULT_LIMIT,
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
