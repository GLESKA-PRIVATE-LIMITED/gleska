from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.agents.shared.task import ExecutionState, PendingAction


@dataclass(frozen=True, slots=True)
class ToolDefinition:
    """Shared metadata contract for a service-backed tool."""

    name: str
    description: str
    domain: str
    agent_id: str
    input_schema: dict[str, Any] = field(default_factory=dict)
    output_schema: dict[str, Any] = field(default_factory=dict)
    required_roles: tuple[str, ...] = ()
    confirmation_required: bool = False
    enabled: bool = True
    metadata: dict[str, Any] = field(default_factory=dict)
    required_permissions: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class ToolExecutionResult:
    """Small result contract for tool execution."""

    success: bool
    tool_name: str
    data: Any = None
    error_code: str | None = None
    message: str | None = None
    validation_error: bool = False
    authorization_error: bool = False
    tool_error: bool = False
    domain_error: bool = False
    unexpected_error: bool = False
    metadata: dict[str, Any] = field(default_factory=dict)
    execution_id: str | None = None
    execution_state: ExecutionState | None = None
    pending_action: PendingAction | None = None
    replayed: bool = False
    idempotency_scope: str = "process_memory"
