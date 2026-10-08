from __future__ import annotations

from app.tools.shared.contracts import ToolDefinition


DISCOVER_CANDIDATES_TOOL = ToolDefinition(
    name="hiring.discover_candidates",
    description=(
        "Read the current eligible pending candidate projection for the employer's "
        "server-selected, owned job. Takes no arguments. Returns only anonymized "
        "candidate facts and backend-derived criteria evidence. This tool is read-only."
    ),
    domain="hiring",
    agent_id="hiring",
    input_schema={
        "type": "object",
        "properties": {},
        "additionalProperties": False,
    },
    output_schema={
        "type": "object",
        "properties": {
            "status": {"type": "string", "enum": ["FOUND", "NO_MATCHES"]},
            "total_candidate_count": {"type": "integer", "minimum": 0},
            "returned_candidate_count": {"type": "integer", "minimum": 0},
            "truncated": {"type": "boolean"},
            "distance_freshness": {"type": "string"},
            "candidates": {"type": "array", "items": {"type": "object"}},
        },
        "required": [
            "status",
            "total_candidate_count",
            "returned_candidate_count",
            "truncated",
            "distance_freshness",
            "candidates",
        ],
    },
    required_roles=("EMPLOYER",),
    required_permissions=("job:read",),
)
