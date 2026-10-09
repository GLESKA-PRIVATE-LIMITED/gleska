from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True, slots=True)
class AgentDefinition:
    """Shared metadata contract for a service-backed agent."""

    id: str
    name: str
    description: str
    version: str = "1.0.0"
    capabilities: tuple[str, ...] = ()
    enabled: bool = True
    roles: tuple[str, ...] = ()
    metadata: dict[str, Any] = field(default_factory=dict)
    system_instruction: str | None = None


@dataclass(frozen=True, slots=True)
class AgentExecutionContext:
    """Authenticated request context passed to future agent and tool layers."""

    agent_id: str
    user_id: str | None = None
    role: str | None = None
    session_id: str | None = None
    conversation_id: str | None = None
    task_id: str | None = None
    request_id: str | None = None
    permissions: tuple[str, ...] = ()
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class AgentExecutionResult:
    """Small shared result contract used across agent and tool execution."""

    success: bool
    agent_id: str
    data: Any = None
    error_code: str | None = None
    message: str | None = None
    validation_error: bool = False
    authorization_error: bool = False
    tool_error: bool = False
    domain_error: bool = False
    unexpected_error: bool = False
    warnings: tuple[str, ...] = ()
