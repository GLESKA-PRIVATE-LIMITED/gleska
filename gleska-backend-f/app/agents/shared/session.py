from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class AgentSessionState:
    """Low-cost conversation/session abstraction for future agents.

    This intentionally avoids a new database model and keeps state as a small in-memory
    or persisted JSON-like structure that existing services can use when needed.
    """

    session_id: str | None = None
    agent_id: str | None = None
    status: str = "ACTIVE"
    version: int = 1
    state: dict[str, Any] = field(default_factory=dict)
    history: list[dict[str, Any]] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
