"""Shared agent contracts and runtime primitives."""

from app.agents.shared.authorization import authorize_agent_context
from app.agents.shared.contracts import AgentDefinition, AgentExecutionContext, AgentExecutionResult
from app.agents.shared.engine import AgentRuntime
from app.agents.shared.registry import AgentRegistry, default_agent_registry, register_default_agents
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
    TaskError,
    TaskState,
    TaskStateRevisionConflict,
    TaskStatus,
)

__all__ = [
    "AgentResponseError",
    "AgentRuntimeRequest",
    "AgentDefinition",
    "AgentExecutionContext",
    "AgentExecutionResult",
    "AgentRegistry",
    "AgentRuntime",
    "AgentSessionState",
    "AgentTask",
    "ConfirmationState",
    "ConfirmationStatus",
    "ExecutionState",
    "ExecutionStatus",
    "PendingAction",
    "PendingActionStatus",
    "RequestedToolCall",
    "StructuredAgentResponse",
    "TaskError",
    "TaskState",
    "TaskStateRevisionConflict",
    "TaskStatus",
    "authorize_agent_context",
    "default_agent_registry",
    "register_default_agents",
]
