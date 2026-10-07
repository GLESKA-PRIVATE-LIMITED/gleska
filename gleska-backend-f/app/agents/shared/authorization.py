from __future__ import annotations

from app.agents.shared.contracts import AgentExecutionContext


def authorize_agent_context(
    context: AgentExecutionContext,
    required_roles: tuple[str, ...] = (),
    required_permissions: tuple[str, ...] = (),
) -> None:
    """Validates the execution context using the existing role/permission model.

    This helper does not replace GLESKA auth; it simply enforces role and permission
    metadata for service-backed agent/tool execution.
    """

    if required_roles:
        allowed_roles = {role.upper() for role in required_roles}
        if not context.role or context.role.upper() not in allowed_roles:
            raise PermissionError("Role is missing or not allowed for this agent action")

    if required_permissions:
        missing_permissions = [permission for permission in required_permissions if permission not in context.permissions]
        if missing_permissions:
            joined = ", ".join(missing_permissions)
            raise PermissionError(f"Missing required permissions: {joined}")
