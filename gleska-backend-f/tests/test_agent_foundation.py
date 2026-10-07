from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.agents.hiring.adapter import HiringAgentAdapter
from app.agents.shared.authorization import authorize_agent_context
from app.agents.shared.contracts import AgentDefinition, AgentExecutionContext, AgentExecutionResult
from app.agents.shared.registry import AgentRegistry, register_default_agents
from app.agents.shared.runtime import (
    AgentResponseError,
    AgentRuntimeRequest,
    RequestedToolCall,
    StructuredAgentResponse,
)
from app.agents.shared.session import AgentSessionState
from app.agents.shared.task import (
    AgentTask,
    ConfirmationState,
    ConfirmationStatus,
    ExecutionState,
    ExecutionStatus,
    PendingAction,
    PendingActionStatus,
    TaskState,
    TaskStateRevisionConflict,
    TaskStatus,
)
from app.schemas.auth import UserResponse
from app.schemas.job_assistant import JobAssistantMessageRequest
from app.services.job_assistant_service import JobAssistantService
from app.tools.shared.contracts import ToolDefinition, ToolExecutionResult
from app.tools.shared.registry import ToolRegistry


def test_agent_registration_and_lookup():
    registry = AgentRegistry()
    agent = AgentDefinition(
        id="hiring",
        name="Hiring Agent",
        description="Job creation assistant",
        roles=("EMPLOYER",),
    )

    registry.register(agent)

    assert registry.get("hiring") == agent
    assert len(registry.list()) == 1


def test_agent_duplicate_protection():
    registry = AgentRegistry()
    agent = AgentDefinition(id="logistics", name="Logistics Agent", description="Test")
    registry.register(agent)

    with pytest.raises(ValueError, match="already registered"):
        registry.register(agent)


def test_default_agent_registry_contains_expected_agents():
    registry = AgentRegistry()
    register_default_agents(registry)
    ids = {agent.id for agent in registry.list()}

    assert {"hiring", "logistics", "tender"}.issubset(ids)


def test_tool_registration_and_lookup():
    registry = ToolRegistry()
    tool = ToolDefinition(
        name="job.create",
        description="Creates a job",
        domain="hiring",
        agent_id="hiring",
        required_roles=("EMPLOYER",),
    )

    registry.register(tool)

    assert registry.get("job.create") == tool
    assert registry.list(agent_id="hiring") == [tool]


def test_tool_duplicate_protection():
    registry = ToolRegistry()
    tool = ToolDefinition(name="search.jobs", description="Search jobs", domain="hiring", agent_id="hiring")
    registry.register(tool)

    with pytest.raises(ValueError, match="already registered"):
        registry.register(tool)


def test_execution_context_and_session_state_are_lightweight_and_safe():
    context = AgentExecutionContext(
        agent_id="hiring",
        user_id="user-1",
        role="EMPLOYER",
        session_id="s-123",
        conversation_id="conversation-123",
        task_id="task-123",
        request_id="req-123",
        permissions=("job:create",),
        metadata={"tenant": "goleska"},
    )
    session = AgentSessionState(session_id="s-123", agent_id="hiring", state={"title": "Cook"}, version=2)

    assert context.user_id == "user-1"
    assert context.conversation_id == "conversation-123"
    assert context.task_id == "task-123"
    assert session.state["title"] == "Cook"
    assert "password" not in context.metadata


def test_task_creation_and_generic_task_lifecycle():
    task = AgentTask(task_id="task-1", task_type="collect_requirements")

    waiting = task.transition_to(TaskStatus.WAITING_FOR_INPUT)
    active = waiting.transition_to(TaskStatus.ACTIVE)

    assert task.status is TaskStatus.ACTIVE
    assert waiting.status is TaskStatus.WAITING_FOR_INPUT
    assert waiting.revision == 1
    assert active.revision == 2
    assert active.updated_at >= task.updated_at


def test_invalid_task_transition_is_rejected():
    task = AgentTask(task_id="task-1", task_type="generic", status=TaskStatus.COMPLETED)

    with pytest.raises(ValueError, match="TASK_TRANSITION_NOT_ALLOWED"):
        task.transition_to(TaskStatus.ACTIVE)


def test_task_state_stores_domain_neutral_structured_data():
    state = TaskState(
        data={"item_kind": "ceramic", "quantity": 3},
        missing_information=["destination"],
        current_step="collect_details",
    )

    assert state.data["item_kind"] == "ceramic"
    assert state.data["quantity"] == 3
    assert state.missing_information == ["destination"]
    assert state.revision == 0


def test_pending_action_is_descriptive_only_and_has_typed_status():
    action = PendingAction(
        action_id="action-1",
        action_name="record_request",
        input={"reference": "ref-1"},
        reason="The user requested this action.",
        confirmation_required=True,
    )

    assert action.status is PendingActionStatus.PENDING
    assert action.confirmation_required is True
    assert action.input == {"reference": "ref-1"}


def test_confirmation_state_represents_each_generic_outcome():
    assert {
        ConfirmationStatus.NOT_REQUIRED,
        ConfirmationStatus.PENDING,
        ConfirmationStatus.CONFIRMED,
        ConfirmationStatus.REJECTED,
        ConfirmationStatus.EXPIRED,
    } == {status for status in ConfirmationStatus}
    assert ConfirmationState(status=ConfirmationStatus.PENDING).status is ConfirmationStatus.PENDING


def test_execution_state_tracks_lifecycle_and_rejects_invalid_transition():
    running = ExecutionState(execution_id="exec-1").transition_to(ExecutionStatus.RUNNING)
    finished = running.transition_to(ExecutionStatus.SUCCEEDED)

    assert running.started_at is not None
    assert finished.status is ExecutionStatus.SUCCEEDED
    assert finished.finished_at is not None

    with pytest.raises(ValueError, match="EXECUTION_TRANSITION_NOT_ALLOWED"):
        finished.transition_to(ExecutionStatus.RUNNING)


def test_task_state_revision_update_is_optimistic_and_returns_new_state():
    initial = TaskState(data={"quantity": 2})
    updated = initial.update_if_revision(0, {"data": {"quantity": 4}})

    assert initial.revision == 0
    assert initial.data["quantity"] == 2
    assert updated.revision == 1
    assert updated.data["quantity"] == 4

    with pytest.raises(TaskStateRevisionConflict) as error:
        updated.update_if_revision(0, {"data": {"quantity": 9}})

    assert error.value.expected_revision == 0
    assert error.value.current_revision == 1


def test_runtime_request_and_structured_response_validate_typed_tool_calls():
    context = AgentExecutionContext(
        agent_id="generic",
        user_id="user-1",
        session_id="session-1",
        conversation_id="conversation-1",
        task_id="task-1",
        request_id="request-1",
    )
    request = AgentRuntimeRequest(context=context, message="  Continue  ", task_state=TaskState())
    response = StructuredAgentResponse(
        assistant_message="I can continue.",
        tool_calls=[
            RequestedToolCall(
                call_id="call-1",
                tool_name="record_request",
                arguments={"reference": "ref-1"},
            )
        ],
        confirmation=ConfirmationState(status=ConfirmationStatus.PENDING),
    )
    failed_response = StructuredAgentResponse(
        assistant_message="The request could not be completed.",
        completed=True,
        error=AgentResponseError(code="REQUEST_FAILED", message="The request failed."),
    )

    assert request.message == "Continue"
    assert request.context.task_id == "task-1"
    assert response.tool_calls[0].tool_name == "record_request"
    assert response.confirmation.status is ConfirmationStatus.PENDING
    assert response.completed is False
    assert failed_response.completed is True
    assert failed_response.error.code == "REQUEST_FAILED"

    with pytest.raises(ValueError):
        RequestedToolCall(call_id="call-1", tool_name="record_request", arguments=[], extra="rejected")


def test_result_and_error_contract_supports_expected_failures():
    result = AgentExecutionResult(
        success=False,
        agent_id="hiring",
        error_code="AUTH_FAILED",
        message="Unauthorized",
        authorization_error=True,
    )

    assert result.success is False
    assert result.authorization_error is True
    assert result.error_code == "AUTH_FAILED"


def test_authorization_helper_enforces_role_and_permission_context():
    context = AgentExecutionContext(agent_id="logistics", user_id="u-1", role="EMPLOYER", permissions=("dispatch:read",))
    authorize_agent_context(context, required_roles=("EMPLOYER",), required_permissions=("dispatch:read",))

    with pytest.raises(PermissionError, match="Role"):
        authorize_agent_context(context, required_roles=("ADMIN",))

    with pytest.raises(PermissionError, match="Role"):
        authorize_agent_context(
            AgentExecutionContext(agent_id="logistics", user_id="u-1"),
            required_roles=("EMPLOYER",),
        )

    with pytest.raises(PermissionError, match="Missing required permissions"):
        authorize_agent_context(context, required_permissions=("dispatch:write",))


def test_hiring_agent_adapter_builds_context_for_existing_service():
    user = UserResponse(
        id="user-123",
        name="Test Employer",
        mobile="919876543210",
        role="EMPLOYER",
        is_mobile_verified=True,
        is_active=True,
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )

    context = HiringAgentAdapter.build_context(user, session_id="session-1", request_id="request-1")

    assert context.agent_id == "hiring"
    assert context.user_id == "user-123"
    assert context.role == "EMPLOYER"
    assert "assistant:message" in context.permissions


@pytest.mark.asyncio
async def test_existing_hiring_agent_behavior_is_unchanged(monkeypatch):
    class FakeSupabaseTable:
        def __init__(self, data):
            self.data = data
            self._filters = []
            self._single = False
            self._inserted = None
            self._update_payload = None

        def select(self, *_args, **_kwargs):
            return self

        def eq(self, field_name, value):
            self._filters.append((field_name, value))
            return self

        def insert(self, payload):
            row = {**payload, "id": payload.get("id", "generated")}
            self.data.append(row)
            self._inserted = row
            return self

        def update(self, payload):
            self._update_payload = payload
            return self

        def single(self):
            self._single = True
            return self

        def execute(self):
            filtered = self.data
            if self._filters:
                for field_name, value in self._filters:
                    filtered = [row for row in filtered if str(row.get(field_name)) == str(value)]
            if self._single:
                return SimpleNamespace(data=filtered[0] if filtered else {})
            if self._update_payload is not None:
                for row in filtered:
                    row.update(self._update_payload)
                return SimpleNamespace(data=filtered)
            if self._inserted is not None:
                return SimpleNamespace(data=[self._inserted])
            return SimpleNamespace(data=filtered)

    class FakeSupabaseAssistant:
        def __init__(self):
            self.employer_profiles = [
                {"id": "employer-profile-1", "user_id": "user-123", "onboarding_status": "COMPLETED"},
            ]
            self.job_sites = [
                {"id": "11111111-1111-1111-1111-111111111111", "employer_id": "employer-profile-1", "name": "Nanded Site", "address": "Nanded City"},
            ]
            self.assistant_conversations = []

        def table(self, name):
            if name == "employer_profiles":
                return FakeSupabaseTable(self.employer_profiles)
            if name == "job_sites":
                return FakeSupabaseTable(self.job_sites)
            if name == "assistant_conversations":
                return FakeSupabaseTable(self.assistant_conversations)
            return FakeSupabaseTable([])

    fake_db = FakeSupabaseAssistant()
    monkeypatch.setattr("app.services.job_assistant_service.supabase", fake_db)
    monkeypatch.setattr("app.core.config.settings.GEMINI_API_KEY", "")

    request = JobAssistantMessageRequest(
        message="I need 5 cooks at my Nanded site for 20 days, paying ₹700 per day, 8 AM to 5 PM, minimum 1 year experience, South Indian breakfast cooking skills.",
    )
    response = await JobAssistantService.process_message(
        UserResponse(
            id="user-123",
            name="Test Employer",
            mobile="919876543210",
            role="EMPLOYER",
            is_mobile_verified=True,
            is_active=True,
            created_at="2026-01-01T00:00:00Z",
            updated_at="2026-01-01T00:00:00Z",
        ),
        request,
    )

    assert response.structured_state.headcount_required == 5
    assert response.structured_state.title == "Cook"
    assert response.structured_state.work_duration_days == 20
    assert response.structured_state.max_daily_salary == 700.0
    assert response.ready_to_create is True
    assert not response.validation_errors


def test_tool_metadata_and_error_contract():
    tool = ToolDefinition(
        name="tool.verify",
        description="Validate authorizations",
        domain="shared",
        agent_id="hiring",
        required_roles=("EMPLOYER",),
        confirmation_required=True,
    )
    result = ToolExecutionResult(
        success=False,
        tool_name="tool.verify",
        error_code="VALIDATION_FAILED",
        message="Input invalid",
        validation_error=True,
    )

    assert tool.required_roles == ("EMPLOYER",)
    assert tool.confirmation_required is True
    assert result.validation_error is True
    assert result.tool_name == "tool.verify"
