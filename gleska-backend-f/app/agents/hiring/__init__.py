"""Thin identity layer for the existing Hiring Agent."""

from app.agents.shared.contracts import AgentDefinition

HIRING_AGENT_DEFINITION = AgentDefinition(
    id="hiring",
    name="Hiring Agent",
    description="Existing job-creation and worker matching workflow.",
    version="1.0.0",
    capabilities=("job_creation", "candidate_matching", "conversation_state"),
    enabled=True,
    roles=("EMPLOYER",),
    metadata={"domain": "hiring", "status": "existing"},
)

__all__ = ["HIRING_AGENT_DEFINITION"]
