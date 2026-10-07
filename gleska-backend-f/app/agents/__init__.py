"""Shared agent abstractions for future multi-agent foundation work."""

from app.agents.shared.contracts import AgentDefinition, AgentExecutionContext, AgentExecutionResult
from app.agents.shared.engine import AgentRuntime
from app.agents.shared.registry import AgentRegistry, default_agent_registry, register_default_agents
from app.agents.shared.runtime import AgentRuntimeRequest, StructuredAgentResponse
from app.agents.shared.task import AgentTask, TaskState

__all__ = [
    "AgentRuntimeRequest",
    "AgentDefinition",
    "AgentExecutionContext",
    "AgentExecutionResult",
    "AgentRegistry",
    "AgentRuntime",
    "AgentTask",
    "StructuredAgentResponse",
    "TaskState",
    "default_agent_registry",
    "register_default_agents",
]
