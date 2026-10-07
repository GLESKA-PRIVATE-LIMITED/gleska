from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from pydantic import ValidationError

from app.agents.shared.contracts import AgentExecutionContext
from app.agents.shared.runtime import RequestedToolCall
from app.agents.shared.task import (
    ConfirmationState,
    ConfirmationStatus,
    ExecutionStatus,
)
from app.tools.shared.contracts import ToolDefinition
from app.tools.shared.executor import ToolExecutor
from app.tools.shared.registry import ToolRegistry


def make_tool(
    *,
    name: str = "generic.record",
    requires_confirmation: bool = False,
    roles: tuple[str, ...] = ("EMPLOYER",),
    agent_id: str = "generic",
) -> ToolDefinition:
    return ToolDefinition(
        name=name,
        description="Records a generic request.",
        domain="generic",
        agent_id=agent_id,
        input_schema={
            "type": "object",
            "properties": {"reference": {"type": "string"}},
            "required": ["reference"],
            "additionalProperties": False,
        },
        required_roles=roles,
        confirmation_required=requires_confirmation,
    )


def make_context(
    *,
    role: str | None = "EMPLOYER",
    user_id: str | None = "user-1",
    agent_id: str = "generic",
    permissions: tuple[str, ...] = (),
) -> AgentExecutionContext:
    return AgentExecutionContext(
        agent_id=agent_id,
        user_id=user_id,
        role=role,
        session_id="session-1",
        conversation_id="conversation-1",
        task_id="task-1",
        request_id="request-1",
        permissions=permissions,
    )


def make_call(
    *,
    call_id: str = "execution-1",
    tool_name: str = "generic.record",
    arguments: dict[str, Any] | None = None,
) -> RequestedToolCall:
    return RequestedToolCall(
        call_id=call_id,
        tool_name=tool_name,
        arguments=arguments if arguments is not None else {"reference": "ref-1"},
    )


def make_executor(
    tool: ToolDefinition | None = None,
    *,
    handler=None,
    timeout_seconds: float = 1,
) -> ToolExecutor:
    registry = ToolRegistry()
    registered_tool = tool or make_tool()
    registry.register(registered_tool)
    executor = ToolExecutor(registry, timeout_seconds=timeout_seconds)
    if handler is not None:
        executor.register_handler(registered_tool.name, handler)
    return executor


@pytest.mark.asyncio
async def test_registered_tool_executes_successfully():
    calls = []

    async def handler(arguments, context):
        calls.append((arguments, context.user_id))
        return {"accepted": arguments["reference"]}

    executor = make_executor(handler=handler)
    result = await executor.execute(make_call(), make_context())

    assert result.success is True
    assert result.data == {"accepted": "ref-1"}
    assert result.execution_state.status is ExecutionStatus.SUCCEEDED
    assert result.execution_id == "execution-1"
    assert calls == [({"reference": "ref-1"}, "user-1")]


@pytest.mark.asyncio
async def test_unknown_tool_is_rejected_without_executing_handler():
    calls = []

    async def handler(arguments, context):
        calls.append(arguments)

    executor = make_executor(handler=handler)
    result = await executor.execute(make_call(tool_name="unregistered.tool"), make_context())

    assert result.success is False
    assert result.error_code == "UNKNOWN_TOOL"
    assert result.execution_state.status is ExecutionStatus.NOT_STARTED
    assert calls == []


@pytest.mark.asyncio
async def test_invalid_arguments_are_rejected_with_safe_validation_details():
    calls = []

    async def handler(arguments, context):
        calls.append(arguments)

    executor = make_executor(handler=handler)
    result = await executor.execute(
        make_call(arguments={"reference": "ref-1", "extra": "secret-value"}),
        make_context(),
    )

    assert result.error_code == "ARGUMENT_VALIDATION_FAILED"
    assert result.validation_error is True
    assert result.metadata["validation_errors"]
    assert "secret-value" not in str(result.metadata)
    assert calls == []


@pytest.mark.asyncio
async def test_unauthorized_tool_is_rejected_before_handler_invocation():
    calls = []

    async def handler(arguments, context):
        calls.append(arguments)

    executor = make_executor(handler=handler)
    result = await executor.execute(make_call(), make_context(role="WORKER"))

    assert result.error_code == "AUTHORIZATION_FAILED"
    assert result.authorization_error is True
    assert calls == []


@pytest.mark.asyncio
async def test_confirmation_required_returns_pending_action_without_execution():
    calls = []

    async def handler(arguments, context):
        calls.append(arguments)

    executor = make_executor(make_tool(requires_confirmation=True), handler=handler)
    result = await executor.execute(make_call(), make_context())

    assert result.error_code == "CONFIRMATION_REQUIRED"
    assert result.metadata["confirmation_required"] is True
    assert result.execution_state.status is ExecutionStatus.NOT_STARTED
    assert result.pending_action.action_id == "execution-1"
    assert result.pending_action.action_name == "generic.record"
    assert result.pending_action.input == {"reference": "ref-1"}
    assert result.pending_action.expires_at is not None
    assert calls == []


@pytest.mark.asyncio
async def test_confirmed_action_executes_only_for_matching_action_and_user():
    calls = []

    async def handler(arguments, context):
        calls.append(arguments)
        return {"done": True}

    executor = make_executor(make_tool(requires_confirmation=True), handler=handler)
    result = await executor.execute(
        make_call(),
        make_context(),
        confirmation=ConfirmationState(
            status=ConfirmationStatus.CONFIRMED,
            action_id="execution-1",
            resolved_by="user-1",
        ),
    )

    assert result.success is True
    assert calls == [{"reference": "ref-1"}]


@pytest.mark.asyncio
async def test_confirmation_for_another_action_or_actor_is_rejected():
    calls = []

    async def handler(arguments, context):
        calls.append(arguments)

    executor = make_executor(make_tool(requires_confirmation=True), handler=handler)
    result = await executor.execute(
        make_call(),
        make_context(),
        confirmation=ConfirmationState(
            status=ConfirmationStatus.CONFIRMED,
            action_id="different-execution",
            resolved_by="user-1",
        ),
    )

    assert result.error_code == "CONFIRMATION_INVALID"
    assert result.pending_action is not None
    assert calls == []


@pytest.mark.asyncio
async def test_expired_confirmation_is_rejected():
    calls = []

    async def handler(arguments, context):
        calls.append(arguments)

    executor = make_executor(make_tool(requires_confirmation=True), handler=handler)
    result = await executor.execute(
        make_call(),
        make_context(),
        confirmation=ConfirmationState(
            status=ConfirmationStatus.CONFIRMED,
            action_id="execution-1",
            resolved_by="user-1",
            expires_at=datetime.now(timezone.utc) - timedelta(seconds=1),
        ),
    )

    assert result.error_code == "CONFIRMATION_EXPIRED"
    assert calls == []


@pytest.mark.asyncio
async def test_non_confirmation_tool_executes_without_confirmation():
    async def handler(arguments, context):
        return "ok"

    result = await make_executor(handler=handler).execute(make_call(), make_context())

    assert result.success is True
    assert result.data == "ok"


@pytest.mark.asyncio
async def test_handler_failure_is_structured_and_does_not_leak_exception_details():
    async def handler(arguments, context):
        raise RuntimeError("private-token=top-secret\ninternal stack details")

    result = await make_executor(handler=handler).execute(make_call(), make_context())

    assert result.success is False
    assert result.error_code == "TOOL_EXECUTION_FAILED"
    assert result.execution_state.status is ExecutionStatus.FAILED
    assert "top-secret" not in str(result)
    assert "internal stack details" not in str(result)


@pytest.mark.asyncio
async def test_duplicate_execution_id_returns_cached_result_without_repeating_side_effect():
    calls = []

    async def handler(arguments, context):
        calls.append(arguments)
        return {"count": len(calls)}

    executor = make_executor(handler=handler)
    first = await executor.execute(make_call(), make_context())
    duplicate = await executor.execute(make_call(), make_context())

    assert first.success is True
    assert duplicate.success is True
    assert duplicate.replayed is True
    assert duplicate.data == first.data
    assert duplicate.idempotency_scope == "process_memory"
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_same_execution_id_with_different_arguments_is_rejected():
    calls = []

    async def handler(arguments, context):
        calls.append(arguments)

    executor = make_executor(handler=handler)
    await executor.execute(make_call(), make_context())
    conflicting = await executor.execute(
        make_call(arguments={"reference": "different"}),
        make_context(),
    )

    assert conflicting.error_code == "EXECUTION_ID_CONFLICT"
    assert calls == [{"reference": "ref-1"}]


@pytest.mark.asyncio
async def test_concurrent_duplicate_execution_is_single_flight():
    calls = []

    async def handler(arguments, context):
        calls.append(arguments)
        await asyncio.sleep(0.02)
        return "done"

    executor = make_executor(handler=handler)
    first, second = await asyncio.gather(
        executor.execute(make_call(), make_context()),
        executor.execute(make_call(), make_context()),
    )

    assert len(calls) == 1
    assert first.success is True
    assert second.success is True
    assert first.replayed != second.replayed


@pytest.mark.asyncio
async def test_timeout_returns_terminal_execution_state():
    async def handler(arguments, context):
        await asyncio.sleep(0.1)

    executor = make_executor(handler=handler, timeout_seconds=0.01)
    result = await executor.execute(make_call(), make_context())

    assert result.error_code == "TOOL_EXECUTION_TIMEOUT"
    assert result.execution_state.status is ExecutionStatus.TIMED_OUT
    assert result.execution_state.finished_at is not None


@pytest.mark.asyncio
async def test_cancelled_handler_is_recorded_and_not_retried():
    started = asyncio.Event()
    never_finish = asyncio.Event()
    calls = []

    async def handler(arguments, context):
        calls.append(arguments)
        started.set()
        await never_finish.wait()

    executor = make_executor(handler=handler)
    pending_execution = asyncio.create_task(executor.execute(make_call(), make_context()))
    await started.wait()
    pending_execution.cancel()

    with pytest.raises(asyncio.CancelledError):
        await pending_execution

    replay = await executor.execute(make_call(), make_context())
    assert replay.error_code == "TOOL_EXECUTION_CANCELLED"
    assert replay.execution_state.status is ExecutionStatus.CANCELLED
    assert replay.replayed is True
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_missing_trusted_handler_fails_closed():
    executor = make_executor()
    result = await executor.execute(make_call(), make_context())

    assert result.error_code == "TOOL_HANDLER_NOT_REGISTERED"
    assert result.success is False


def test_llm_cannot_supply_callable_or_unregistered_handler():
    with pytest.raises(ValidationError):
        RequestedToolCall(
            call_id="execution-1",
            tool_name="generic.record",
            arguments={"reference": "ref-1"},
            handler=lambda: None,
        )

    registry = ToolRegistry()
    executor = ToolExecutor(registry)

    async def arbitrary_handler(arguments, context):
        return "should not register"

    with pytest.raises(ValueError, match="TOOL_NOT_REGISTERED"):
        executor.register_handler("unregistered.tool", arbitrary_handler)


def test_executor_and_registry_contracts_remain_domain_neutral_and_compatible():
    registry = ToolRegistry()
    tool = make_tool()
    registry.register(tool)
    executor = ToolExecutor(registry)

    assert registry.get("generic.record") == tool
    assert registry.list(agent_id="generic", domain="generic") == [tool]
    assert not hasattr(executor, "supabase")
    assert tool.domain == "generic"
