"""Reserved identity layer for the future Tender Agent."""

from app.agents.shared.contracts import AgentDefinition

TENDER_AGENT_DEFINITION = AgentDefinition(
    id="tender",
    name="Tender Agent",
    description="Reserved future tender filing identity without business logic.",
    version="0.1.0",
    capabilities=(),
    enabled=False,
    roles=("EMPLOYER", "ADMIN"),
    metadata={"domain": "tender", "status": "reserved"},
)

__all__ = ["TENDER_AGENT_DEFINITION"]
