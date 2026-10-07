from __future__ import annotations

from collections import deque
from dataclasses import replace
import json as json_module
from types import SimpleNamespace
from typing import Any

import pytest

from app.agents.shared.contracts import AgentDefinition, AgentExecutionContext
from app.agents.shared.engine import AgentRuntime
from app.agents.shared.observability import NoopObserver
from app.agents.shared.registry import AgentRegistry
from app.agents.shared.runtime import (
    AgentLLMRequest,
    AgentRuntimeRequest,
    RequestedToolCall,
    StructuredAgentResponse,
)
from app.agents.shared.task import (
    ConfirmationState,
    ConfirmationStatus,
    ExecutionStatus,
    AgentTask,
    TaskState,
    TaskStatus,
)
from app.llm.providers import GeminiLLMProvider, LLMProviderError
from app.tools.shared.contracts import ToolDefinition, ToolExecutionResult
from app.tools.shared.executor import ToolExecutor
from app.tools.shared.registry import ToolRegistry


AGENT = AgentDefinition(
    id="generic",
    name="Generic Agent",
    description="A domain-neutral test agent.",
    roles=("EMPLOYER",),
)


class FakeProvider:
    provider_name = "fake"

    def __init__(self, responses):
        self.responses = deque(responses)
        self.requests: list[AgentLLMRequest] = []

    async def generate(self, prompt: str, **kwargs: Any) -> Any:
        raise AssertionError("Runtime must call structured provider method")

    async def generate_agent_response(self, request: AgentLLMRequest):
        self.requests.append(request)
        response = self.responses.popleft()
        if isinstance(response, Exception):
            raise response
        if callable(response):
            return response(request)
        return response


class RecordingObserver(NoopObserver):
    def __init__(self):
        self.events = []

    def on_agent_start(self, context, **metadata):
        self.events.append(("agent_start", context.request_id))

    def on_agent_complete(self, context, **metadata):
        self.events.append(("agent_complete", metadata.get("success")))

    def on_agent_error(self, context, exc, **metadata):
        self.events.append(("agent_error", metadata.get("error_code")))

    def on_llm_start(self, context, **metadata):
        self.events.append(("llm_start", metadata.get("iteration")))

    def on_llm_complete(self, context, **metadata):
        self.events.append(("llm_complete", metadata.get("iteration")))

    def on_tool_requested(self, context, tool_name, **metadata):
        self.events.append(("tool_requested", tool_name))

    def on_tool_start(self, context, tool_name, **metadata):
        self.events.append(("tool_start", tool_name))

    def on_tool_complete(self, context, tool_name, **metadata):
        self.events.append(("tool_complete", metadata.get("success")))

    def on_tool_result(self, context, tool_name, **metadata):
        self.events.append(("tool_result", metadata.get("error_code")))


def build_tool(*, confirmation_required: bool = False):
    return ToolDefinition(
        name="generic.record",
        description="Record a generic value.",
        domain="generic",
        agent_id="generic",
        input_schema={
            "type": "object",
            "properties": {"value": {"type": "string"}},
            "required": ["value"],
            "additionalProperties": False,
        },
        confirmation_required=confirmation_required,
        required_roles=("EMPLOYER",),
    )


def build_context(
    *,
    user_id: str = "user-1",
    role: str | None = "EMPLOYER",
    agent_id: str = "generic",
    conversation_id: str | None = "conversation-1",
    task_id: str | None = "task-1",
):
    return AgentExecutionContext(
        agent_id=agent_id,
        user_id=user_id,
        role=role,
        session_id="session-1",
        conversation_id=conversation_id,
        task_id=task_id,
        request_id="request-1",
    )


def build_request(*, context=None, message="Please proceed.", state=None, revision=None):
    return AgentRuntimeRequest(
        context=context or build_context(),
        message=message,
        task_state=state,
        expected_revision=revision,
    )


def build_runtime(
    provider,
    *,
    tool_handler=None,
    confirmation_required=False,
    observer=None,
    max_iterations=4,
):
    agents = AgentRegistry()
    agents.register(AGENT)
    tools = ToolRegistry()
    tool = build_tool(confirmation_required=confirmation_required)
    tools.register(tool)
    executor = ToolExecutor(tools)
    if tool_handler is not None:
        executor.register_handler(tool.name, tool_handler)
    runtime = AgentRuntime(
        agent_registry=agents,
        tool_registry=tools,
        tool_executor=executor,
        llm_provider=provider,
        observer=observer,
        max_iterations=max_iterations,
    )
    return runtime


@pytest.mark.asyncio
async def test_runtime_resolves_registered_agent_and_returns_response():
    provider = FakeProvider([StructuredAgentResponse(assistant_message="Ready.")])
    runtime = build_runtime(provider)

    result = await runtime.run(build_request())

    assert result.assistant_message == "Ready."
    assert result.error is None
    assert result.task.task_type == "general"
    assert result.task_id == "task-1"
    assert result.conversation_id == "conversation-1"
    assert provider.requests[0].agent.id == "generic"


@pytest.mark.asyncio
async def test_unknown_agent_is_rejected_safely():
    provider = FakeProvider([])
    runtime = build_runtime(provider)

    result = await runtime.run(build_request(context=build_context(agent_id="missing")))

    assert result.error.code == "UNKNOWN_AGENT"
    assert provider.requests == []


@pytest.mark.asyncio
async def test_disabled_agent_is_rejected_as_unavailable():
    agents = AgentRegistry()
    agents.register(AgentDefinition(
        id=AGENT.id,
        name=AGENT.name,
        description=AGENT.description,
        enabled=False,
        roles=AGENT.roles,
    ))
    tools = ToolRegistry()
    provider = FakeProvider([])
    runtime = AgentRuntime(
        agent_registry=agents,
        tool_registry=tools,
        tool_executor=ToolExecutor(tools),
        llm_provider=provider,
    )

    result = await runtime.run(build_request())

    assert result.error.code == "AGENT_UNAVAILABLE"
    assert provider.requests == []


@pytest.mark.asyncio
async def test_unauthorized_agent_is_rejected():
    provider = FakeProvider([])
    runtime = build_runtime(provider)

    result = await runtime.run(build_request(context=build_context(role="WORKER")))

    assert result.error.code == "AGENT_NOT_AUTHORIZED"
    assert provider.requests == []


@pytest.mark.asyncio
async def test_runtime_rejects_context_without_authenticated_user():
    provider = FakeProvider([])
    runtime = build_runtime(provider)

    result = await runtime.run(build_request(context=build_context(user_id="")))

    assert result.error.code == "AGENT_NOT_AUTHORIZED"
    assert provider.requests == []


@pytest.mark.asyncio
async def test_response_without_tools_returns_successfully():
    provider = FakeProvider([StructuredAgentResponse(assistant_message="No action needed.")])
    runtime = build_runtime(provider)

    result = await runtime.run(build_request())

    assert result.assistant_message == "No action needed."
    assert result.tool_results == []


@pytest.mark.asyncio
async def test_tool_call_flows_through_executor_and_trusted_handler():
    calls = []

    async def handler(arguments, context):
        calls.append((arguments, context.user_id))
        return {"stored": arguments["value"]}

    provider = FakeProvider([
        StructuredAgentResponse(
            assistant_message="I will record that.",
            tool_calls=[RequestedToolCall(call_id="call-1", tool_name="generic.record", arguments={"value": "hello"})],
        ),
        StructuredAgentResponse(assistant_message="Recorded.", completed=True),
    ])
    runtime = build_runtime(provider, tool_handler=handler)

    result = await runtime.run(build_request())

    assert result.assistant_message == "Recorded."
    assert result.completed is True
    assert calls == [({"value": "hello"}, "user-1")]
    assert result.task.status is TaskStatus.COMPLETED


@pytest.mark.asyncio
async def test_tool_result_is_given_to_provider_for_follow_up_response():
    requests = []

    async def handler(arguments, context):
        return {"stored": arguments["value"]}

    def final_response(request):
        requests.append(request)
        assert request.message == "Please proceed."
        assert request.tool_results[-1].success is True
        assert request.tool_results[-1].data == {"stored": "hello"}
        assert request.history[-1].role == "tool"
        return StructuredAgentResponse(assistant_message="The operation succeeded.", completed=True)

    provider = FakeProvider([
        StructuredAgentResponse(
            assistant_message="Recording.",
            tool_calls=[RequestedToolCall(call_id="call-1", tool_name="generic.record", arguments={"value": "hello"})],
        ),
        final_response,
    ])
    runtime = build_runtime(provider, tool_handler=handler)

    result = await runtime.run(build_request())

    assert result.assistant_message == "The operation succeeded."
    assert len(requests) == 1


@pytest.mark.asyncio
async def test_multi_turn_tool_loop_is_bounded_and_runs_multiple_calls():
    calls = []

    async def handler(arguments, context):
        calls.append(arguments["value"])
        return {"stored": arguments["value"]}

    provider = FakeProvider([
        StructuredAgentResponse(
            assistant_message="First action.",
            tool_calls=[RequestedToolCall(call_id="call-1", tool_name="generic.record", arguments={"value": "one"})],
        ),
        StructuredAgentResponse(
            assistant_message="Second action.",
            tool_calls=[RequestedToolCall(call_id="call-2", tool_name="generic.record", arguments={"value": "two"})],
        ),
        StructuredAgentResponse(assistant_message="Both actions completed.", completed=True),
    ])
    runtime = build_runtime(provider, tool_handler=handler, max_iterations=3)

    result = await runtime.run(build_request())

    assert result.assistant_message == "Both actions completed."
    assert calls == ["one", "two"]
    assert len(provider.requests) == 3
    assert result.task_state.revision >= 2


@pytest.mark.asyncio
async def test_iteration_limit_returns_failure_and_preserves_task_state():
    calls = []

    async def handler(arguments, context):
        calls.append(arguments["value"])
        return {"stored": arguments["value"]}

    response = StructuredAgentResponse(
        assistant_message="Again.",
        tool_calls=[RequestedToolCall(call_id="call-1", tool_name="generic.record", arguments={"value": "one"})],
    )
    provider = FakeProvider([response, response.model_copy(update={
        "tool_calls": [RequestedToolCall(call_id="call-2", tool_name="generic.record", arguments={"value": "two"})]
    })])
    runtime = build_runtime(provider, tool_handler=handler, max_iterations=2)

    result = await runtime.run(build_request())

    assert result.error.code == "ITERATION_LIMIT_EXCEEDED"
    assert result.task.status is TaskStatus.FAILED
    assert result.task_state is not None
    assert calls == ["one"]
    assert len(provider.requests) == 2


@pytest.mark.asyncio
async def test_confirmation_required_returns_pending_and_untrusted_yes_does_not_confirm():
    calls = []

    async def handler(arguments, context):
        calls.append(arguments)
        return "done"

    provider = FakeProvider([
        StructuredAgentResponse(
            assistant_message="Need to perform an action.",
            tool_calls=[RequestedToolCall(call_id="call-confirm", tool_name="generic.record", arguments={"value": "yes"})],
        )
    ])
    runtime = build_runtime(
        provider,
        tool_handler=handler,
        confirmation_required=True,
    )
    initial = await runtime.run(build_request())

    assert initial.pending_action.action_id == "request-1:call-confirm"
    assert initial.confirmation.status is ConfirmationStatus.PENDING
    assert initial.task.status is TaskStatus.WAITING_FOR_CONFIRMATION
    assert calls == []

    untrusted_text = await runtime.run(build_request(message="yes"))
    assert untrusted_text.pending_action.action_id == "request-1:call-confirm"
    assert calls == []


@pytest.mark.asyncio
async def test_trusted_confirmation_resumes_pending_tool_through_executor():
    calls = []

    async def handler(arguments, context):
        calls.append((arguments, context.user_id))
        return {"stored": arguments["value"]}

    provider = FakeProvider([
        StructuredAgentResponse(
            assistant_message="Pending action.",
            tool_calls=[RequestedToolCall(call_id="call-confirm", tool_name="generic.record", arguments={"value": "safe"})],
        ),
        StructuredAgentResponse(assistant_message="Confirmed operation complete.", completed=True),
    ])
    runtime = build_runtime(
        provider,
        tool_handler=handler,
        confirmation_required=True,
    )
    first = await runtime.run(build_request())
    confirmed = await runtime.run(
        build_request(context=build_context(), message="Proceed."),
        trusted_confirmation=ConfirmationState(
            status=ConfirmationStatus.CONFIRMED,
            action_id=first.pending_action.action_id,
            resolved_by="user-1",
        ),
    )

    assert calls == [({"value": "safe"}, "user-1")]
    assert confirmed.assistant_message == "Confirmed operation complete."
    assert provider.requests[-1].tool_results[-1].success is True


@pytest.mark.asyncio
async def test_runtime_scopes_provider_call_ids_to_request_identity():
    calls = []

    async def handler(arguments, context):
        calls.append(arguments["value"])
        return {"stored": arguments["value"]}

    call = RequestedToolCall(
        call_id="reused-model-id",
        tool_name="generic.record",
        arguments={"value": "value"},
    )
    provider = FakeProvider([
        StructuredAgentResponse(assistant_message="First.", tool_calls=[call]),
        StructuredAgentResponse(assistant_message="First done."),
        StructuredAgentResponse(assistant_message="Second.", tool_calls=[call]),
        StructuredAgentResponse(assistant_message="Second done.", completed=True),
    ])
    runtime = build_runtime(provider, tool_handler=handler)
    first_context = build_context()
    second_context = replace(first_context, request_id="request-2")

    first = await runtime.run(build_request(context=first_context))
    second = await runtime.run(
        build_request(context=second_context, state=first.task_state)
    )

    assert calls == ["value", "value"]
    assert first.tool_results[0].execution_id == "request-1:reused-model-id"
    assert second.tool_results[0].execution_id == "request-2:reused-model-id"


@pytest.mark.asyncio
async def test_stale_task_state_revision_is_rejected_without_provider_call():
    provider = FakeProvider([
        StructuredAgentResponse(
            assistant_message="Updated.",
            task_state=TaskState(data={"item": "value"}),
        )
    ])
    runtime = build_runtime(provider)
    first = await runtime.run(build_request(state=TaskState()))

    stale = await runtime.run(
        build_request(
            message="Stale update.",
            state=TaskState(),
            revision=0,
        )
    )

    assert first.task_state.revision == 1
    assert stale.error.code == "TASK_STATE_REVISION_CONFLICT"
    assert stale.task_state.data == {"item": "value"}
    assert len(provider.requests) == 1


@pytest.mark.asyncio
async def test_unknown_tool_becomes_structured_runtime_failure():
    provider = FakeProvider([
        StructuredAgentResponse(
            assistant_message="Trying unknown tool.",
            tool_calls=[RequestedToolCall(call_id="unknown-1", tool_name="missing.tool")],
        )
    ])
    runtime = build_runtime(provider)

    result = await runtime.run(build_request())

    assert result.error.code == "UNKNOWN_TOOL"
    assert "Traceback" not in result.assistant_message
    assert result.task.status is TaskStatus.FAILED


@pytest.mark.asyncio
async def test_tool_failure_becomes_structured_runtime_failure():
    async def handler(arguments, context):
        raise RuntimeError("secret=not-for-user")

    provider = FakeProvider([
        StructuredAgentResponse(
            assistant_message="Calling tool.",
            tool_calls=[RequestedToolCall(call_id="fail-1", tool_name="generic.record", arguments={"value": "x"})],
        )
    ])
    runtime = build_runtime(provider, tool_handler=handler)

    result = await runtime.run(build_request())

    assert result.error.code == "TOOL_EXECUTION_FAILED"
    assert "not-for-user" not in str(result)


@pytest.mark.asyncio
async def test_llm_failure_returns_safe_structured_error():
    provider = FakeProvider([LLMProviderError("LLM_TIMEOUT")])
    observer = RecordingObserver()
    runtime = build_runtime(provider, observer=observer)

    result = await runtime.run(build_request())

    assert result.error.code == "LLM_TIMEOUT"
    assert "timeout" in result.error.code.lower()
    assert ("agent_error", "LLM_TIMEOUT") in observer.events


@pytest.mark.asyncio
async def test_malformed_provider_response_is_rejected_without_leaking_details():
    provider = FakeProvider([{"assistant_message": "", "internal": "secret"}])
    runtime = build_runtime(provider)

    result = await runtime.run(build_request())

    assert result.error.code == "LLM_INVALID_RESPONSE"
    assert "secret" not in str(result)


@pytest.mark.asyncio
async def test_runtime_never_executes_callable_from_model_response():
    response = {
        "assistant_message": "bad",
        "tool_calls": [{
            "call_id": "bad-1",
            "tool_name": "generic.record",
            "arguments": {"value": "x"},
            "handler": "arbitrary_callable",
        }],
    }
    provider = FakeProvider([response])
    calls = []

    async def handler(arguments, context):
        calls.append(arguments)

    runtime = build_runtime(provider, tool_handler=handler)
    result = await runtime.run(build_request())

    assert result.error.code == "LLM_INVALID_RESPONSE"
    assert calls == []


@pytest.mark.asyncio
async def test_authenticated_context_is_preserved_and_observability_hooks_fire():
    seen_contexts = []

    async def handler(arguments, context):
        seen_contexts.append(context)
        return "ok"

    observer = RecordingObserver()
    provider = FakeProvider([
        StructuredAgentResponse(
            assistant_message="Call.",
            tool_calls=[RequestedToolCall(call_id="observe-1", tool_name="generic.record", arguments={"value": "x"})],
        ),
        StructuredAgentResponse(assistant_message="Done.", completed=True),
    ])
    runtime = build_runtime(provider, tool_handler=handler, observer=observer)
    original_context = build_context()

    await runtime.run(build_request(context=original_context))

    assert seen_contexts[0].user_id == original_context.user_id
    assert seen_contexts[0].role == original_context.role
    assert seen_contexts[0].agent_id == original_context.agent_id
    event_names = [event[0] for event in observer.events]
    assert "agent_start" in event_names
    assert "llm_start" in event_names
    assert "llm_complete" in event_names
    assert "tool_requested" in event_names
    assert "tool_start" in event_names
    assert "tool_complete" in event_names
    assert "tool_result" in event_names
    assert "agent_complete" in event_names


@pytest.mark.asyncio
async def test_runtime_does_not_expose_unexpected_provider_exception_details():
    provider = FakeProvider([RuntimeError("secret-key=abc\nprivate stack trace")])
    runtime = build_runtime(provider)

    result = await runtime.run(build_request())

    assert result.error.code == "LLM_PROVIDER_ERROR"
    assert "secret-key" not in str(result)
    assert "private stack trace" not in str(result)


def test_runtime_requires_bounded_positive_iterations():
    with pytest.raises(ValueError, match="max_iterations"):
        build_runtime(FakeProvider([]), max_iterations=0)


@pytest.mark.asyncio
async def test_gemini_provider_supports_generic_structured_runtime_response(monkeypatch):
    from app.core.config import settings

    captured = {}

    class FakeAsyncClient:
        def __init__(self, timeout):
            captured["timeout"] = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, endpoint, *, headers, json):
            captured["endpoint"] = endpoint
            captured["headers"] = headers
            captured["body"] = json
            return SimpleNamespace(
                status_code=200,
                json=lambda: {
                    "candidates": [{
                        "content": {
                            "parts": [{
                                "text": json_module.dumps({
                                    "assistant_message": "Generic result.",
                                    "tool_calls": [],
                                    "completed": True,
                                })
                            }]
                        }
                    }]
                },
            )

    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(settings, "GEMINI_MODEL", "test-model")
    monkeypatch.setattr(settings, "GEMINI_TIMEOUT_SECONDS", 2)
    monkeypatch.setattr("app.llm.providers.httpx.AsyncClient", FakeAsyncClient)

    result = await GeminiLLMProvider().generate_agent_response(
        AgentLLMRequest(
            agent=AGENT,
            message="Continue.",
            task=AgentTask(
                task_id="task-1",
                task_type="generic",
            ),
            task_state=TaskState(),
            tool_results=[
                ToolExecutionResult(success=True, tool_name="generic.record", data={"accepted": True})
            ],
        )
    )

    assert result.assistant_message == "Generic result."
    assert result.completed is True
    assert captured["timeout"] == 2
    assert captured["endpoint"].endswith("/test-model:generateContent")
    assert "user_id" not in captured["body"]["contents"][0]["parts"][0]["text"]
