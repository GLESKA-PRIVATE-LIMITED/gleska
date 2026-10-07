from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.agents.shared.contracts import AgentDefinition, AgentExecutionContext
from app.agents.shared.task import (
    AgentTask,
    ConfirmationState,
    PendingAction,
    TaskState,
)
from app.tools.shared.contracts import ToolExecutionResult


class _RuntimeModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AgentRuntimeRequest(_RuntimeModel):
    """Typed input envelope for one authenticated agent turn."""

    context: AgentExecutionContext
    message: str = Field(min_length=1)
    task: AgentTask | None = None
    task_state: TaskState | None = None
    expected_revision: int | None = Field(default=None, ge=0)

    @field_validator("message")
    @classmethod
    def validate_message(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("message must not be blank")
        return normalized


class RequestedToolCall(_RuntimeModel):
    """A typed model request for a tool, not an authorized or validated invocation."""

    call_id: str = Field(min_length=1)
    tool_name: str = Field(min_length=1)
    arguments: dict[str, Any] = Field(default_factory=dict)


class AgentResponseError(_RuntimeModel):
    code: str = Field(min_length=1)
    message: str
    retryable: bool = False


class AgentConversationMessage(_RuntimeModel):
    role: Literal["user", "assistant", "tool"]
    content: str
    tool_name: str | None = None
    call_id: str | None = None


class AgentToolSpec(_RuntimeModel):
    name: str
    description: str
    input_schema: dict[str, Any]
    confirmation_required: bool


class AgentLLMRequest(_RuntimeModel):
    """Provider input with no authentication credentials or executable handlers."""

    agent: AgentDefinition
    message: str
    history: list[AgentConversationMessage] = Field(default_factory=list)
    task: AgentTask
    task_state: TaskState
    tools: list[AgentToolSpec] = Field(default_factory=list)
    tool_results: list[ToolExecutionResult] = Field(default_factory=list)


class StructuredAgentResponse(_RuntimeModel):
    """Structured response returned by the provider and completed by Runtime."""

    assistant_message: str = Field(min_length=1)
    conversation_id: str | None = None
    task_id: str | None = None
    task: AgentTask | None = None
    task_state: TaskState | None = None
    tool_calls: list[RequestedToolCall] = Field(default_factory=list)
    tool_results: list[ToolExecutionResult] = Field(default_factory=list)
    pending_action: PendingAction | None = None
    confirmation: ConfirmationState = Field(default_factory=ConfirmationState)
    completed: bool = False
    error: AgentResponseError | None = None
