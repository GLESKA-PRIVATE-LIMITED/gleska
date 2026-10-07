from __future__ import annotations

from app.agents.shared.contracts import AgentExecutionContext
from app.schemas.auth import UserResponse


class HiringAgentAdapter:
    """Thin adapter around the existing job assistant service without altering its behavior."""

    agent_id = "hiring"

    @staticmethod
    def build_context(
        user: UserResponse,
        *,
        session_id: str | None = None,
        request_id: str | None = None,
        **metadata: object,
    ) -> AgentExecutionContext:
        return AgentExecutionContext(
            agent_id="hiring",
            user_id=str(user.id),
            role=user.role,
            session_id=session_id,
            request_id=request_id,
            permissions=("job:create", "job:read", "assistant:message"),
            metadata={"service": "JobAssistantService", **metadata},
        )
