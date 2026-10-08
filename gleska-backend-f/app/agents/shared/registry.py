from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable

from app.agents.shared.contracts import AgentDefinition


@dataclass
class AgentRegistry:
    """Deterministic registry for service-backed agents."""

    _agents: dict[str, AgentDefinition] = field(default_factory=dict)

    def register(self, agent: AgentDefinition) -> AgentDefinition:
        agent_id = agent.id.strip()
        if not agent_id:
            raise ValueError("AGENT_ID_REQUIRED")
        if agent_id in self._agents:
            raise ValueError(f"Agent '{agent_id}' is already registered")
        self._agents[agent_id] = agent
        return agent

    def get(self, agent_id: str) -> AgentDefinition | None:
        return self._agents.get((agent_id or "").strip())

    def list(self) -> list[AgentDefinition]:
        return list(self._agents.values())

    def list_by_role(self, role: str) -> list[AgentDefinition]:
        normalized = (role or "").strip().upper()
        return [agent for agent in self._agents.values() if normalized in {item.upper() for item in agent.roles}]


def _default_agent_definitions() -> Iterable[AgentDefinition]:
    from app.agents.hiring import HIRING_AGENT_DEFINITION
    from app.agents.logistics import LOGISTICS_AGENT_DEFINITION
    from app.agents.procurement import PROCUREMENT_AGENT_DEFINITION
    from app.agents.tender import TENDER_AGENT_DEFINITION

    return (
        HIRING_AGENT_DEFINITION,
        LOGISTICS_AGENT_DEFINITION,
        PROCUREMENT_AGENT_DEFINITION,
        TENDER_AGENT_DEFINITION,
    )


def register_default_agents(registry: AgentRegistry | None = None) -> AgentRegistry:
    target = registry or default_agent_registry
    for agent in _default_agent_definitions():
        if target.get(agent.id) is None:
            target.register(agent)
    return target


default_agent_registry = AgentRegistry()
register_default_agents(default_agent_registry)
