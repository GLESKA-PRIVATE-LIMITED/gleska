"""Persistent Financial Agent conversations backed by the shared runtime."""

import logging
from typing import Any
from uuid import UUID, uuid4

from app.agents.financial.tools import LIST_FINANCIAL_INVOICES_TOOL
from app.agents.shared.contracts import AgentExecutionContext
from app.agents.shared.engine import AgentRuntime
from app.agents.shared.registry import default_agent_registry
from app.agents.shared.runtime import AgentConversationMessage, AgentRuntimeRequest
from app.agents.shared.task import AgentTask, TaskState
from app.core.supabase import supabase
from app.llm.providers import GeminiLLMProvider
from app.schemas.auth import UserResponse
from app.schemas.financial import (
    FinancialAgentConversationCreateResponse,
    FinancialAgentConversationListResponse,
    FinancialAgentHistoryResponse,
    FinancialAgentMessage,
    FinancialAgentMessageRequest,
    FinancialAgentTurnResponse,
)
from app.services.financial_service import FinancialNotFound, FinancialService, FinancialServiceError
from app.tools.shared.executor import ToolExecutor
from app.tools.shared.registry import ToolRegistry

logger = logging.getLogger(__name__)
MAX_HISTORY = 80


class FinancialAgentError(ValueError):
    def __init__(self, code: str, http_status: int = 500):
        self.code = code
        self.http_status = http_status
        super().__init__(code)


def _row(response: Any) -> dict[str, Any]:
    data = getattr(response, "data", None)
    if isinstance(data, list):
        return data[0] if data else {}
    return data or {}


def _rows(response: Any) -> list[dict[str, Any]]:
    data = getattr(response, "data", None)
    return data if isinstance(data, list) else []


class FinancialAgentService:
    @staticmethod
    def _scope(user: UserResponse) -> tuple[str, str]:
        try:
            return FinancialService._employer_scope(user)
        except FinancialNotFound as exc:
            raise FinancialAgentError(str(exc), 404) from exc
        except FinancialServiceError as exc:
            raise FinancialAgentError(str(exc), 500) from exc

    @staticmethod
    def _conversation_response(row: dict[str, Any]) -> FinancialAgentConversationCreateResponse:
        return FinancialAgentConversationCreateResponse(
            id=row["id"],
            status=row["status"],
            revision=int(row.get("revision") or 0),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    @staticmethod
    def _owned_conversation(user_id: str, employer_id: str, conversation_id: UUID) -> dict[str, Any]:
        try:
            response = (
                supabase.table("financial_agent_conversations")
                .select("*")
                .eq("id", str(conversation_id))
                .eq("user_id", user_id)
                .eq("employer_id", employer_id)
                .maybe_single()
                .execute()
            )
        except Exception as exc:
            logger.error("Financial conversation load failed: exception_type=%s", type(exc).__name__)
            raise FinancialAgentError("FINANCIAL_AGENT_CONVERSATION_LOAD_FAILED") from exc
        row = _row(response)
        if not row:
            raise FinancialAgentError("FINANCIAL_AGENT_CONVERSATION_NOT_FOUND", 404)
        return row

    @classmethod
    def get_conversation(
        cls,
        user: UserResponse,
        conversation_id: UUID,
    ) -> FinancialAgentConversationCreateResponse:
        user_id, employer_id = cls._scope(user)
        return cls._conversation_response(
            cls._owned_conversation(user_id, employer_id, conversation_id)
        )

    @classmethod
    def create_conversation(cls, user: UserResponse) -> FinancialAgentConversationCreateResponse:
        user_id, employer_id = cls._scope(user)
        try:
            response = (
                supabase.table("financial_agent_conversations")
                .insert({
                    "id": str(uuid4()),
                    "user_id": user_id,
                    "employer_id": employer_id,
                    "status": "ACTIVE",
                    "revision": 0,
                })
                .execute()
            )
            row = _row(response)
            if not row:
                raise FinancialAgentError("FINANCIAL_AGENT_CONVERSATION_CREATE_FAILED")
            return cls._conversation_response(row)
        except FinancialAgentError:
            raise
        except Exception as exc:
            logger.error("Financial conversation create failed: exception_type=%s", type(exc).__name__)
            raise FinancialAgentError("FINANCIAL_AGENT_CONVERSATION_CREATE_FAILED") from exc

    @classmethod
    def list_conversations(
        cls,
        user: UserResponse,
        page: int = 1,
        page_size: int = 25,
    ) -> FinancialAgentConversationListResponse:
        user_id, employer_id = cls._scope(user)
        try:
            response = (
                supabase.table("financial_agent_conversations")
                .select("*")
                .eq("user_id", user_id)
                .eq("employer_id", employer_id)
                .order("updated_at", desc=True)
                .range((page - 1) * page_size, page * page_size)
                .execute()
            )
            rows = _rows(response)
            page_rows = rows[:page_size]
            return FinancialAgentConversationListResponse(
                conversations=[cls._conversation_response(row) for row in page_rows],
                page=page,
                page_size=page_size,
                has_more=len(rows) > page_size,
            )
        except FinancialAgentError:
            raise
        except Exception as exc:
            logger.error("Financial conversation listing failed: exception_type=%s", type(exc).__name__)
            raise FinancialAgentError("FINANCIAL_AGENT_CONVERSATION_LIST_FAILED") from exc

    @classmethod
    def get_history(
        cls,
        user: UserResponse,
        conversation_id: UUID,
        page_size: int = 80,
        cursor: int | None = None,
    ) -> FinancialAgentHistoryResponse:
        user_id, employer_id = cls._scope(user)
        cls._owned_conversation(user_id, employer_id, conversation_id)
        try:
            query = (
                supabase.table("financial_agent_messages")
                .select("id, role, content, created_at")
                .eq("conversation_id", str(conversation_id))
                .eq("user_id", user_id)
                .eq("employer_id", employer_id)
                .order("id", desc=True)
            )
            if cursor is not None:
                query = query.lt("id", cursor)
            response = query.range(0, page_size).execute()
            rows = _rows(response)
            page_rows = rows[:page_size]
            return FinancialAgentHistoryResponse(
                messages=[
                    FinancialAgentMessage(**row)
                    for row in reversed(page_rows)
                ],
                page_size=page_size,
                has_more=len(rows) > page_size,
                next_cursor=str(page_rows[-1]["id"]) if len(rows) > page_size and page_rows else None,
            )
        except FinancialAgentError:
            raise
        except Exception as exc:
            logger.error("Financial conversation history failed: exception_type=%s", type(exc).__name__)
            raise FinancialAgentError("FINANCIAL_AGENT_HISTORY_LOAD_FAILED") from exc

    @classmethod
    async def send_message(
        cls,
        user: UserResponse,
        conversation_id: UUID,
        request: FinancialAgentMessageRequest,
    ) -> FinancialAgentTurnResponse:
        user_id, employer_id = cls._scope(user)
        conversation = cls._owned_conversation(user_id, employer_id, conversation_id)
        revision = int(conversation.get("revision") or 0)
        if conversation.get("status") != "ACTIVE":
            raise FinancialAgentError("FINANCIAL_AGENT_CONVERSATION_NOT_ACTIVE", 409)
        if request.expected_revision != revision:
            raise FinancialAgentError("STALE_FINANCIAL_AGENT_CONVERSATION", 409)

        try:
            history_response = (
                supabase.table("financial_agent_messages")
                .select("role, content")
                .eq("conversation_id", str(conversation_id))
                .eq("user_id", user_id)
                .eq("employer_id", employer_id)
                .order("id", desc=True)
                .range(0, MAX_HISTORY)
                .execute()
            )
            history = [
                AgentConversationMessage(role=row["role"], content=row["content"])
                for row in reversed(_rows(history_response))
            ]
        except Exception as exc:
            logger.error("Financial conversation history load failed: exception_type=%s", type(exc).__name__)
            raise FinancialAgentError("FINANCIAL_AGENT_HISTORY_LOAD_FAILED") from exc

        tools = ToolRegistry()
        tools.register(LIST_FINANCIAL_INVOICES_TOOL)
        executor = ToolExecutor(tools)

        async def list_invoices(arguments: dict[str, Any], context: AgentExecutionContext) -> dict[str, Any]:
            if context.user_id != user_id or context.role != "EMPLOYER":
                raise PermissionError("FINANCIAL_AGENT_CONTEXT_INVALID")
            invoices = FinancialService.list_invoices(user, arguments.get("search"))
            return {"invoices": [invoice.model_dump(mode="json") for invoice in invoices]}

        executor.register_handler(LIST_FINANCIAL_INVOICES_TOOL.name, list_invoices)
        runtime = AgentRuntime(
            agent_registry=default_agent_registry,
            tool_registry=tools,
            tool_executor=executor,
            llm_provider=GeminiLLMProvider(),
            max_iterations=4,
        )
        try:
            runtime_response = await runtime.run(AgentRuntimeRequest(
                context=AgentExecutionContext(
                    agent_id="financial",
                    user_id=user_id,
                    role="EMPLOYER",
                    session_id=str(conversation_id),
                    conversation_id=str(conversation_id),
                    task_id=str(conversation_id),
                    metadata={"employer_id": employer_id},
                ),
                message=request.message,
                task=AgentTask(task_id=str(conversation_id), task_type="financial_conversation"),
                task_state=TaskState(),
                history=history,
            ))
        except Exception as exc:
            logger.error("Financial Agent provider call failed: exception_type=%s", type(exc).__name__)
            raise FinancialAgentError("FINANCIAL_AGENT_PROVIDER_UNAVAILABLE", 503) from exc

        if runtime_response.error:
            code = runtime_response.error.code
            http_status = 503 if code in {
                "LLM_CONFIGURATION_ERROR",
                "LLM_TIMEOUT",
                "LLM_UNAVAILABLE",
                "LLM_RATE_LIMITED",
                "AGENT_RUNTIME_FAILED",
            } else 502
            raise FinancialAgentError(code, http_status)
        if any(not result.success for result in runtime_response.tool_results):
            raise FinancialAgentError("FINANCIAL_AGENT_INVOICE_LOOKUP_FAILED", 503)

        answer = runtime_response.assistant_message.strip()
        if not answer or len(answer) > 4000:
            raise FinancialAgentError("FINANCIAL_AGENT_INVALID_RESPONSE", 502)

        try:
            persisted = _row(supabase.rpc(
                "append_financial_agent_turn",
                {
                    "p_conversation_id": str(conversation_id),
                    "p_user_id": user_id,
                    "p_employer_id": employer_id,
                    "p_expected_revision": revision,
                    "p_user_message": request.message,
                    "p_assistant_message": answer,
                },
            ).execute())
        except Exception as exc:
            logger.error("Financial Agent turn persistence failed: exception_type=%s", type(exc).__name__)
            raise FinancialAgentError("FINANCIAL_AGENT_TURN_SAVE_FAILED") from exc

        if persisted.get("ok") is not True:
            error = persisted.get("error_code")
            if error in {"STALE_CONVERSATION_STATE", "CONVERSATION_NOT_ACTIVE"}:
                raise FinancialAgentError(str(error), 409)
            raise FinancialAgentError("FINANCIAL_AGENT_TURN_SAVE_FAILED")
        conversation_row = persisted.get("conversation")
        if not isinstance(conversation_row, dict):
            raise FinancialAgentError("FINANCIAL_AGENT_TURN_SAVE_FAILED")
        messages = persisted.get("messages") or []
        return FinancialAgentTurnResponse(
            conversation=cls._conversation_response(conversation_row),
            assistant_message=answer,
            messages=[FinancialAgentMessage(**row) for row in messages],
        )
