"""Reserved identity layer for the future Logistics Agent."""

from app.agents.shared.contracts import AgentDefinition

LOGISTICS_AGENT_DEFINITION = AgentDefinition(
    id="logistics",
    name="Logistics Agent",
    description="Reserved future logistics workspace identity without business logic.",
    version="0.1.0",
    capabilities=(),
    enabled=False,
    roles=("EMPLOYER", "ADMIN"),
    metadata={"domain": "logistics", "status": "reserved"},
)

__all__ = ["LOGISTICS_AGENT_DEFINITION"]
