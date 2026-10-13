"""Controlled read-only tool loop for durable employer Procurement conversations."""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from app.agents.shared.runtime import (
    AgentConversationMessage,
    AgentLLMRequest,
    AgentToolSpec,
    RequestedToolCall,
    StructuredAgentResponse,
)
from app.agents.shared.task import AgentTask, TaskState
from app.agents.procurement import PROCUREMENT_AGENT_DEFINITION
from app.llm.providers import GeminiLLMProvider, LLMProviderError
from app.schemas.auth import UserResponse
from app.tools.shared.contracts import ToolExecutionResult

logger = logging.getLogger(__name__)

MAX_TOOL_CALLS = 4
MAX_MODEL_TURNS = 4
MAX_PAGE_SIZE = 10


class _ToolArguments(BaseModel):
    model_config = ConfigDict(extra="forbid")


class _ListPageArguments(_ToolArguments):
    page: int = Field(default=1, ge=1, le=100)
    page_size: int = Field(default=10, ge=1, le=MAX_PAGE_SIZE)


class _MaterialRequestListArguments(_ToolArguments):
    cursor: str | None = Field(default=None, max_length=300)
    page_size: int = Field(default=10, ge=1, le=MAX_PAGE_SIZE)


class _GetRequestArguments(_ToolArguments):
    request_id: str = Field(min_length=36, max_length=36)

    @field_validator("request_id")
    @classmethod
    def validate_request_id(cls, value: str) -> str:
        return str(UUID(value))


class _DiscoverArguments(_GetRequestArguments):
    delivery_location: str | None = Field(default=None, max_length=500)


class _GetRFQArguments(_ToolArguments):
    rfq_id: str = Field(min_length=36, max_length=36)

    @field_validator("rfq_id")
    @classmethod
    def validate_rfq_id(cls, value: str) -> str:
        return str(UUID(value))


_TOOL_ARGUMENTS: dict[str, type[_ToolArguments]] = {
    "list_my_material_requests": _MaterialRequestListArguments,
    "get_my_material_request": _GetRequestArguments,
    "discover_suppliers_for_saved_requirement": _DiscoverArguments,
    "list_my_rfqs_and_quotations": _ListPageArguments,
    "get_my_rfq_and_quotations": _GetRFQArguments,
    "list_my_purchase_orders": _ListPageArguments,
}

_TOOL_DESCRIPTIONS = {
    "list_my_material_requests": (
        "Read this employer's saved material requests. The result includes has_more and "
        "next_cursor. When has_more is true and the user needs additional results, call "
        "this tool again with the returned next_cursor. Use this before asking the user "
        "for a saved request ID or claiming which requirements exist."
    ),
    "get_my_material_request": (
        "Read one of this employer's saved material requests by request ID."
    ),
    "discover_suppliers_for_saved_requirement": (
        "Search current eligible supplier offerings for one of this employer's saved "
        "material requests. Returns only live GLESKA matches; never infer availability "
        "or price if a match or price is absent."
    ),
    "list_my_rfqs_and_quotations": (
        "Read this employer's RFQs, recipient responses, and submitted quotations."
    ),
    "get_my_rfq_and_quotations": (
        "Read one of this employer's RFQs, recipient responses, and submitted quotations."
    ),
    "list_my_purchase_orders": (
        "Read this employer's purchase orders and current fulfillment information."
    ),
}


class ProcurementAgentService:
    """Runs bounded model/tool turns while leaving writes to existing UI actions."""

    @classmethod
    def tool_specs(cls) -> list[AgentToolSpec]:
        return [
            AgentToolSpec(
                name=name,
                description=_TOOL_DESCRIPTIONS[name],
                input_schema=argument_model.model_json_schema(),
                confirmation_required=False,
            )
            for name, argument_model in _TOOL_ARGUMENTS.items()
        ]

    @classmethod
    async def generate_response(
        cls,
        user: UserResponse,
        message: str,
        history: list[AgentConversationMessage],
        task: AgentTask,
        task_state: TaskState,
    ) -> StructuredAgentResponse:
        current_task_state = task_state
        tool_results: list[ToolExecutionResult] = []
        tool_call_count = 0

        for turn_number in range(MAX_MODEL_TURNS):
            tools = cls.tool_specs() if turn_number < MAX_MODEL_TURNS - 1 else []
            response = await GeminiLLMProvider().generate_agent_response(
                AgentLLMRequest(
                    agent=PROCUREMENT_AGENT_DEFINITION,
                    message=message,
                    history=history,
                    task=task,
                    task_state=current_task_state,
                    tools=tools,
                    tool_results=tool_results,
                )
            )
            if response.error is not None or response.tool_results:
                raise LLMProviderError("LLM_INVALID_RESPONSE")
            if response.task_state is not None:
                current_task_state = response.task_state
            if not response.tool_calls:
                return response.model_copy(update={
                    "task_state": current_task_state,
                    "tool_calls": [],
                    "tool_results": [],
                })

            if not tools:
                raise LLMProviderError("LLM_INVALID_RESPONSE")

            for tool_call in response.tool_calls:
                if tool_call_count >= MAX_TOOL_CALLS:
                    tool_results.append(ToolExecutionResult(
                        success=False,
                        tool_name=tool_call.tool_name,
                        error_code="TOOL_CALL_LIMIT_REACHED",
                        message="The live lookup limit for this turn was reached.",
                        tool_error=True,
                        execution_id=tool_call.call_id,
                    ))
                    continue
                tool_call_count += 1
                tool_results.append(await cls._execute_tool(user, tool_call))

        raise LLMProviderError("LLM_INVALID_RESPONSE")

    @classmethod
    async def _execute_tool(
        cls,
        user: UserResponse,
        tool_call: RequestedToolCall,
    ) -> ToolExecutionResult:
        argument_model = _TOOL_ARGUMENTS.get(tool_call.tool_name)
        if argument_model is None:
            return ToolExecutionResult(
                success=False,
                tool_name=tool_call.tool_name,
                error_code="UNKNOWN_TOOL",
                message="This live Procurement operation is not available.",
                tool_error=True,
                execution_id=tool_call.call_id,
            )

        try:
            arguments = argument_model.model_validate(tool_call.arguments)
        except ValidationError:
            return ToolExecutionResult(
                success=False,
                tool_name=tool_call.tool_name,
                error_code="ARGUMENT_VALIDATION_FAILED",
                message="The live lookup arguments were invalid.",
                validation_error=True,
                execution_id=tool_call.call_id,
            )

        try:
            data = cls._dispatch_tool(user, tool_call.tool_name, arguments)
        except Exception as exc:
            from app.services.procurement_service import ProcurementServiceError
            from app.services.rfq_service import RFQServiceError

            if isinstance(exc, (ProcurementServiceError, RFQServiceError, PermissionError)):
                error_code = getattr(exc, "code", None) or str(exc)
                logger.info(
                    "Procurement agent lookup failed: user_id=%s tool=%s error_code=%s",
                    user.id,
                    tool_call.tool_name,
                    error_code,
                )
                return ToolExecutionResult(
                    success=False,
                    tool_name=tool_call.tool_name,
                    error_code=error_code,
                    message=f"GLESKA could not complete this live lookup ({error_code}).",
                    domain_error=True,
                    execution_id=tool_call.call_id,
                )

            logger.exception(
                "Unexpected Procurement agent tool failure: user_id=%s tool=%s exception_type=%s",
                user.id,
                tool_call.tool_name,
                type(exc).__name__,
            )
            return ToolExecutionResult(
                success=False,
                tool_name=tool_call.tool_name,
                error_code="TOOL_EXECUTION_FAILED",
                message="GLESKA could not complete this live lookup because of a service error.",
                unexpected_error=True,
                execution_id=tool_call.call_id,
            )

        return ToolExecutionResult(
            success=True,
            tool_name=tool_call.tool_name,
            data=ProcurementAgentService._bound_result(tool_call.tool_name, data),
            execution_id=tool_call.call_id,
        )

    @staticmethod
    def _bound_result(tool_name: str, data: Any) -> Any:
        if tool_name == "list_my_material_requests" and isinstance(data, dict):
            data = {
                **data,
                "results_incomplete": bool(data.get("has_more")),
            }
        if tool_name == "discover_suppliers_for_saved_requirement" and isinstance(data, dict):
            matches = data.get("matches")
            if isinstance(matches, list):
                data = {
                    **data,
                    "matches": matches[:20],
                    "matches_truncated": len(matches) > 20,
                }
        if tool_name in {
            "list_my_rfqs_and_quotations",
            "get_my_rfq_and_quotations",
        }:
            rfqs = data.get("items") if isinstance(data, dict) else [data]
            if isinstance(rfqs, list):
                bounded_rfqs = []
                for rfq in rfqs:
                    if not isinstance(rfq, dict):
                        bounded_rfqs.append(rfq)
                        continue
                    recipients = rfq.get("recipients")
                    if isinstance(recipients, list):
                        rfq = {
                            **rfq,
                            "recipients": recipients[:20],
                            "recipients_truncated": len(recipients) > 20,
                        }
                    bounded_rfqs.append(rfq)
                if isinstance(data, dict) and "items" in data:
                    data = {**data, "items": bounded_rfqs}
                elif bounded_rfqs:
                    data = bounded_rfqs[0]
        if tool_name == "list_my_purchase_orders" and isinstance(data, dict):
            orders = data.get("items")
            if isinstance(orders, list):
                bounded_orders = []
                for order in orders:
                    if not isinstance(order, dict):
                        bounded_orders.append(order)
                        continue
                    events = order.get("fulfillment_events")
                    if isinstance(events, list):
                        order = {
                            **order,
                            "fulfillment_events": events[:5],
                            "fulfillment_events_truncated": len(events) > 5,
                        }
                    bounded_orders.append(order)
                data = {**data, "items": bounded_orders}
        return data

    @staticmethod
    def _dispatch_tool(
        user: UserResponse,
        tool_name: str,
        arguments: _ToolArguments,
    ) -> Any:
        from app.services.procurement_service import ProcurementService
        from app.services.rfq_service import RFQService

        values = arguments.model_dump()
        if tool_name == "list_my_material_requests":
            return ProcurementService.list_material_requests(
                user,
                page=1,
                page_size=values["page_size"],
                cursor=values.get("cursor"),
            ).model_dump(mode="json")
        if tool_name == "get_my_material_request":
            return ProcurementService.get_material_request(
                user,
                UUID(values["request_id"]),
            ).model_dump(mode="json")
        if tool_name == "discover_suppliers_for_saved_requirement":
            return ProcurementService.discover_supplier_offerings(
                user,
                UUID(values["request_id"]),
                values.get("delivery_location"),
            ).model_dump(mode="json")
        if tool_name == "list_my_rfqs_and_quotations":
            return RFQService.list_buyer(
                user,
                values["page"],
                values["page_size"],
            ).model_dump(mode="json")
        if tool_name == "get_my_rfq_and_quotations":
            return RFQService.get_buyer(
                user,
                UUID(values["rfq_id"]),
            ).model_dump(mode="json")
        if tool_name == "list_my_purchase_orders":
            return RFQService.list_purchase_orders_buyer(
                user,
                values["page"],
                values["page_size"],
            ).model_dump(mode="json")
        raise ValueError("UNKNOWN_TOOL")
