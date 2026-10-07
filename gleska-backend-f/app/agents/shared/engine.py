from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import asdict, dataclass, field, replace
from typing import Any
from uuid import uuid4

from pydantic import ValidationError
from pydantic_core import to_jsonable_python

from app.agents.shared.authorization import authorize_agent_context
from app.agents.shared.contracts import AgentDefinition, AgentExecutionContext
from app.agents.shared.observability import AgentObserver, NoopObserver
from app.agents.shared.registry import AgentRegistry, default_agent_registry
from app.agents.shared.runtime import (
    AgentConversationMessage,
    AgentLLMRequest,
    AgentRuntimeRequest,
    AgentToolSpec,
    RequestedToolCall,
    StructuredAgentResponse,
)
from app.agents.shared.session import AgentSessionState
from app.agents.shared.task import (
    AgentTask,
    ConfirmationState,
    ConfirmationStatus,
    ExecutionStatus,
    TaskError,
    TaskState,
    TaskStatus,
)
from app.llm.providers import LLMProvider, LLMProviderError
from app.tools.shared.contracts import ToolExecutionResult
from app.tools.shared.executor import ToolExecutor
from app.tools.shared.registry import ToolRegistry, default_tool_registry

logger = logging.getLogger(__name__)


@dataclass
class _RuntimeConversation:
    session: AgentSessionState
    task: AgentTask
    task_state: TaskState
    history: list[AgentConversationMessage] = field(default_factory=list)
    current_message: str = ""
    pending_calls: list[RequestedToolCall] = field(default_factory=list)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class AgentRuntime:
    """Coordinates one bounded generic agent turn without persisting state."""

    def __init__(
        self,
        *,
        agent_registry: AgentRegistry,
        tool_registry: ToolRegistry,
        tool_executor: ToolExecutor,
        llm_provider: LLMProvider,
        observer: AgentObserver | None = None,
        max_iterations: int = 4,
    ) -> None:
        if max_iterations <= 0:
            raise ValueError("max_iterations must be greater than zero")
        self._agent_registry = agent_registry
        self._tool_registry = tool_registry
        self._tool_executor = tool_executor
        self._llm_provider = llm_provider
        self._observer = observer or NoopObserver()
        self._max_iterations = max_iterations
        self._conversations: dict[tuple[str, str, str, str], _RuntimeConversation] = {}
        self._conversations_lock = asyncio.Lock()

    async def run(
        self,
        request: AgentRuntimeRequest,
        *,
        trusted_confirmation: ConfirmationState | None = None,
    ) -> StructuredAgentResponse:
        initial_context = request.context
        self._observer.on_agent_start(
            initial_context,
            request_id=initial_context.request_id,
            agent_id=initial_context.agent_id,
        )
        try:
            definition, context = self._resolve_agent(initial_context)
            conversation_id = context.conversation_id or str(uuid4())
            task_id = context.task_id or str(uuid4())
            request_id = context.request_id or str(uuid4())
            context = replace(
                context,
                conversation_id=conversation_id,
                task_id=task_id,
                request_id=request_id,
            )
            record = await self._get_conversation(request, definition, context)

            async with record.lock:
                conflict = self._check_revision(request, record.task_state)
                if conflict:
                    response = self._error_response(
                        "TASK_STATE_REVISION_CONFLICT",
                        "Task state has changed. Reload the latest task state before continuing.",
                        definition,
                        context,
                        record,
                    )
                    self._observer.on_agent_error(
                        context,
                        RuntimeError("TASK_STATE_REVISION_CONFLICT"),
                        error_code="TASK_STATE_REVISION_CONFLICT",
                    )
                    return response

                if record.task.status in {TaskStatus.COMPLETED, TaskStatus.CANCELLED}:
                    response = self._error_response(
                        "TASK_NOT_ACTIVE",
                        "This task is no longer active.",
                        definition,
                        context,
                        record,
                    )
                    self._observer.on_agent_error(
                        context,
                        RuntimeError("TASK_NOT_ACTIVE"),
                        error_code="TASK_NOT_ACTIVE",
                    )
                    return response

                record.history.append(AgentConversationMessage(role="user", content=request.message))
                record.current_message = request.message
                if record.task.status == TaskStatus.FAILED:
                    record.task = record.task.transition_to(TaskStatus.ACTIVE)
                    record.task_state = self._update_task_state(
                        record.task_state,
                        {"error": None},
                    )

                if record.pending_calls:
                    initial_tool_results: list[ToolExecutionResult] = []
                    pending_response = await self._resume_pending(
                        definition,
                        context,
                        record,
                        trusted_confirmation,
                        tool_results=initial_tool_results,
                    )
                    if pending_response is not None:
                        if pending_response.error is not None:
                            self._observer.on_agent_error(
                                context,
                                RuntimeError(pending_response.error.code),
                                error_code=pending_response.error.code,
                            )
                        self._observer.on_agent_complete(
                            context,
                            success=pending_response.error is None,
                            conversation_id=conversation_id,
                            task_id=task_id,
                        )
                        return pending_response

                else:
                    initial_tool_results = []

                response = await self._run_turns(
                    definition,
                    context,
                    record,
                    initial_tool_results=initial_tool_results,
                )
                if response.completed and record.task.status == TaskStatus.ACTIVE:
                    record.task = record.task.transition_to(TaskStatus.COMPLETED)
                final_response = self._runtime_response(response, definition, context, record)
                if final_response.error is not None:
                    self._observer.on_agent_error(
                        context,
                        RuntimeError(final_response.error.code),
                        error_code=final_response.error.code,
                    )
                self._observer.on_agent_complete(
                    context,
                    success=final_response.error is None,
                    conversation_id=conversation_id,
                    task_id=task_id,
                )
                return final_response
        except PermissionError:
            self._observer.on_agent_error(
                initial_context,
                RuntimeError("AGENT_NOT_AUTHORIZED"),
                error_code="AGENT_NOT_AUTHORIZED",
            )
            return self._bare_error(
                "AGENT_NOT_AUTHORIZED",
                "The current user is not authorized to use this agent.",
                initial_context.agent_id,
            )
        except _RuntimeFailure as exc:
            self._observer.on_agent_error(
                exc.context,
                RuntimeError(exc.code),
                error_code=exc.code,
            )
            return exc.response
        except Exception as exc:
            logger.warning(
                "Agent runtime failed: agent=%s request_id=%s exception_type=%s",
                initial_context.agent_id,
                initial_context.request_id,
                type(exc).__name__,
            )
            safe_error = RuntimeError("AGENT_RUNTIME_FAILED")
            self._observer.on_agent_error(
                initial_context,
                safe_error,
                error_code="AGENT_RUNTIME_FAILED",
            )
            return self._bare_error(
                "AGENT_RUNTIME_FAILED",
                "The request could not be completed.",
                initial_context.agent_id,
            )

    def _resolve_agent(
        self,
        context: AgentExecutionContext,
    ) -> tuple[AgentDefinition, AgentExecutionContext]:
        definition = self._agent_registry.get(context.agent_id)
        if definition is None:
            raise _RuntimeFailure(
                "UNKNOWN_AGENT",
                context,
                self._bare_error("UNKNOWN_AGENT", "The requested agent is unavailable.", context.agent_id),
            )
        if not definition.enabled:
            raise _RuntimeFailure(
                "AGENT_UNAVAILABLE",
                context,
                self._bare_error("AGENT_UNAVAILABLE", "The requested agent is unavailable.", context.agent_id),
            )
        if not context.user_id:
            raise PermissionError("Authenticated user context is required")
        authorize_agent_context(context, required_roles=definition.roles)
        return definition, context

    async def _get_conversation(
        self,
        request: AgentRuntimeRequest,
        definition: AgentDefinition,
        context: AgentExecutionContext,
    ) -> _RuntimeConversation:
        key = (
            context.user_id or "",
            definition.id,
            context.conversation_id or "",
            context.task_id or "",
        )
        async with self._conversations_lock:
            existing = self._conversations.get(key)
            if existing is not None:
                return existing
            task = request.task or AgentTask(
                task_id=context.task_id or str(uuid4()),
                task_type="general",
            )
            if task.task_id != context.task_id:
                raise _RuntimeFailure(
                    "TASK_CONTEXT_MISMATCH",
                    context,
                    self._bare_error(
                        "TASK_CONTEXT_MISMATCH",
                        "The supplied task does not match the execution context.",
                        definition.id,
                    ),
                )
            record = _RuntimeConversation(
                session=AgentSessionState(
                    session_id=context.session_id,
                    agent_id=definition.id,
                ),
                task=task,
                task_state=request.task_state or TaskState(),
            )
            self._conversations[key] = record
            return record

    @staticmethod
    def _check_revision(request: AgentRuntimeRequest, current: TaskState) -> bool:
        expected = request.expected_revision
        if expected is None and request.task_state is not None:
            expected = request.task_state.revision
        return expected is not None and expected != current.revision

    async def _run_turns(
        self,
        definition: AgentDefinition,
        context: AgentExecutionContext,
        record: _RuntimeConversation,
        *,
        initial_tool_results: list[ToolExecutionResult] | None = None,
    ) -> StructuredAgentResponse:
        tool_results = list(initial_tool_results or [])

        for iteration in range(1, self._max_iterations + 1):
            provider_request = self._provider_request(definition, record, tool_results)
            self._observer.on_llm_start(
                context,
                request_id=context.request_id,
                iteration=iteration,
                provider=self._llm_provider.provider_name,
            )
            try:
                raw_response = await self._llm_provider.generate_agent_response(provider_request)
                response = StructuredAgentResponse.model_validate(raw_response)
            except LLMProviderError as exc:
                safe_codes = {
                    "LLM_CONFIGURATION_ERROR",
                    "LLM_TIMEOUT",
                    "LLM_UNAVAILABLE",
                    "LLM_PROVIDER_ERROR",
                    "LLM_INVALID_RESPONSE",
                }
                code = exc.code if exc.code in safe_codes else "LLM_PROVIDER_ERROR"
                return self._fail_task(
                    record,
                    code,
                    "The language model could not complete the request.",
                )
            except (ValidationError, TypeError, ValueError):
                return self._fail_task(
                    record,
                    "LLM_INVALID_RESPONSE",
                    "The language model returned an invalid response.",
                )
            except Exception as exc:
                logger.warning(
                    "LLM invocation failed: provider=%s exception_type=%s",
                    self._llm_provider.provider_name,
                    type(exc).__name__,
                )
                return self._fail_task(
                    record,
                    "LLM_PROVIDER_ERROR",
                    "The language model could not complete the request.",
                )
            self._observer.on_llm_complete(
                context,
                request_id=context.request_id,
                iteration=iteration,
                provider=self._llm_provider.provider_name,
                has_tool_calls=bool(response.tool_calls),
            )

            self._apply_model_state(record, response.task_state)
            if not response.tool_calls:
                if record.task.status == TaskStatus.EXECUTING:
                    record.task = record.task.transition_to(TaskStatus.ACTIVE)
                return response.model_copy(update={
                    "task_state": record.task_state,
                    "tool_results": tool_results,
                    "pending_action": None,
                    "confirmation": ConfirmationState(),
                })

            if iteration == self._max_iterations:
                return self._fail_task(
                    record,
                    "ITERATION_LIMIT_EXCEEDED",
                    "The agent reached its tool-use limit before completing the request.",
                )

            record.history.append(AgentConversationMessage(
                role="assistant",
                content=response.assistant_message,
            ))
            record.pending_calls = [
                call.model_copy(update={
                    "call_id": f"{context.request_id}:{call.call_id}",
                })
                for call in response.tool_calls
            ]
            pending_response = await self._resume_pending(
                definition,
                context,
                record,
                trusted_confirmation=None,
                tool_results=tool_results,
            )
            if pending_response is not None:
                return pending_response

        return self._fail_task(
            record,
            "ITERATION_LIMIT_EXCEEDED",
            "The agent reached its tool-use limit before completing the request.",
        )

    async def _resume_pending(
        self,
        definition: AgentDefinition,
        context: AgentExecutionContext,
        record: _RuntimeConversation,
        trusted_confirmation: ConfirmationState | None,
        tool_results: list[ToolExecutionResult] | None = None,
    ) -> StructuredAgentResponse | None:
        results = tool_results if tool_results is not None else []
        first_confirmation = trusted_confirmation

        while record.pending_calls:
            tool_call = record.pending_calls[0]
            tool = self._tool_registry.get(tool_call.tool_name)
            self._observer.on_tool_requested(
                context,
                tool_call.tool_name,
                request_id=context.request_id,
                execution_id=tool_call.call_id,
            )
            self._observer.on_tool_start(
                context,
                tool_call.tool_name,
                request_id=context.request_id,
                execution_id=tool_call.call_id,
            )
            result = await self._tool_executor.execute(
                tool_call,
                context,
                confirmation=first_confirmation,
            )
            first_confirmation = None
            self._observer.on_tool_complete(
                context,
                tool_call.tool_name,
                request_id=context.request_id,
                execution_id=tool_call.call_id,
                success=result.success,
            )
            self._observer.on_tool_result(
                context,
                tool_call.tool_name,
                request_id=context.request_id,
                execution_id=tool_call.call_id,
                success=result.success,
                error_code=result.error_code,
            )

            if result.error_code == "CONFIRMATION_REQUIRED":
                if record.task.status != TaskStatus.WAITING_FOR_CONFIRMATION:
                    record.task = record.task.transition_to(TaskStatus.WAITING_FOR_CONFIRMATION)
                record.pending_calls[0] = tool_call
                record.task_state = self._update_task_state(
                    record.task_state,
                    {
                        "pending_action": result.pending_action,
                        "confirmation": ConfirmationState(
                            status=ConfirmationStatus.PENDING,
                            action_id=tool_call.call_id,
                            requested_at=result.pending_action.created_at if result.pending_action else None,
                            expires_at=result.pending_action.expires_at if result.pending_action else None,
                        ),
                    },
                )
                return StructuredAgentResponse(
                    assistant_message="This action requires your confirmation before it can proceed.",
                    conversation_id=context.conversation_id,
                    task_id=context.task_id,
                    task=record.task,
                    task_state=record.task_state,
                    pending_action=result.pending_action,
                    confirmation=record.task_state.confirmation,
                    tool_results=results,
                    completed=False,
                )

            if not result.success:
                record.pending_calls.clear()
                record.task = record.task.transition_to(TaskStatus.FAILED)
                record.task_state = self._update_task_state(
                    record.task_state,
                    {
                        "execution": result.execution_state,
                        "pending_action": None,
                        "confirmation": ConfirmationState(),
                        "error": TaskError(
                            code=result.error_code or "TOOL_EXECUTION_FAILED",
                            message="The requested operation could not be completed.",
                        ),
                    },
                )
                return StructuredAgentResponse(
                    assistant_message="The requested operation could not be completed.",
                    conversation_id=context.conversation_id,
                    task_id=context.task_id,
                    task=record.task,
                    task_state=record.task_state,
                    tool_results=[*results, result],
                    completed=False,
                    error={
                        "code": result.error_code or "TOOL_EXECUTION_FAILED",
                        "message": "The requested operation could not be completed.",
                        "retryable": False,
                    },
                )

            if record.task.status in {TaskStatus.ACTIVE, TaskStatus.WAITING_FOR_CONFIRMATION}:
                record.task = record.task.transition_to(TaskStatus.EXECUTING)
            record.task_state = self._update_task_state(
                record.task_state,
                {
                    "execution": result.execution_state,
                    "pending_action": None,
                    "confirmation": ConfirmationState(),
                    "result": result.data,
                    "error": None,
                },
            )
            record.pending_calls.pop(0)
            results.append(result)
            record.history.append(AgentConversationMessage(
                role="tool",
                content=json.dumps(asdict(result), default=to_jsonable_python),
                tool_name=result.tool_name,
                call_id=result.execution_id,
            ))

        if record.task.status == TaskStatus.EXECUTING:
            record.task = record.task.transition_to(TaskStatus.ACTIVE)
        return None

    def _provider_request(
        self,
        definition: AgentDefinition,
        record: _RuntimeConversation,
        tool_results: list[ToolExecutionResult],
    ) -> AgentLLMRequest:
        tools = [
            AgentToolSpec(
                name=tool.name,
                description=tool.description,
                input_schema=tool.input_schema,
                confirmation_required=tool.confirmation_required,
            )
            for tool in self._tool_registry.list(agent_id=definition.id)
            if tool.enabled
        ]
        return AgentLLMRequest(
            agent=definition,
            message=record.current_message,
            history=record.history,
            task=record.task,
            task_state=record.task_state,
            tools=tools,
            tool_results=tool_results,
        )

    @staticmethod
    def _apply_model_state(record: _RuntimeConversation, proposed: TaskState | None) -> None:
        if proposed is None:
            return
        current = record.task_state
        changes = {
            field_name: getattr(proposed, field_name)
            for field_name in ("data", "missing_information", "current_step")
        }
        if all(getattr(current, name) == value for name, value in changes.items()):
            return
        record.task_state = AgentRuntime._update_task_state(current, changes)

    @staticmethod
    def _update_task_state(current: TaskState, changes: dict[str, Any]) -> TaskState:
        return current.update_if_revision(current.revision, changes)

    def _fail_task(
        self,
        record: _RuntimeConversation,
        code: str,
        message: str,
    ) -> StructuredAgentResponse:
        record.pending_calls.clear()
        if record.task.status not in {TaskStatus.FAILED, TaskStatus.COMPLETED, TaskStatus.CANCELLED}:
            record.task = record.task.transition_to(TaskStatus.FAILED)
        record.task_state = self._update_task_state(
            record.task_state,
            {"error": TaskError(code=code, message=message)},
        )
        return StructuredAgentResponse(
            assistant_message=message,
            task=record.task,
            task_state=record.task_state,
            completed=False,
            error={"code": code, "message": message, "retryable": code != "ITERATION_LIMIT_EXCEEDED"},
        )

    @staticmethod
    def _runtime_response(
        response: StructuredAgentResponse,
        definition: AgentDefinition,
        context: AgentExecutionContext,
        record: _RuntimeConversation,
    ) -> StructuredAgentResponse:
        return response.model_copy(update={
            "conversation_id": context.conversation_id,
            "task_id": context.task_id,
            "task": record.task,
            "task_state": record.task_state,
            "pending_action": response.pending_action,
            "confirmation": (
                record.task_state.confirmation
                if response.pending_action is not None
                else ConfirmationState()
            ),
        })

    @staticmethod
    def _bare_error(code: str, message: str, agent_id: str) -> StructuredAgentResponse:
        return StructuredAgentResponse(
            assistant_message=message,
            completed=False,
            error={"code": code, "message": message, "retryable": False},
        )

    def _error_response(
        self,
        code: str,
        message: str,
        definition: AgentDefinition,
        context: AgentExecutionContext,
        record: _RuntimeConversation,
    ) -> StructuredAgentResponse:
        return StructuredAgentResponse(
            assistant_message=message,
            conversation_id=context.conversation_id,
            task_id=context.task_id,
            task=record.task,
            task_state=record.task_state,
            completed=False,
            error={"code": code, "message": message, "retryable": False},
        )


class _RuntimeFailure(Exception):
    def __init__(
        self,
        code: str,
        context: AgentExecutionContext,
        response: StructuredAgentResponse,
    ) -> None:
        self.code = code
        self.context = context
        self.response = response
        super().__init__(code)
