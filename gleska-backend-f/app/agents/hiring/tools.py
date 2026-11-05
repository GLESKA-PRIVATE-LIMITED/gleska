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


SEARCH_WORKERS_TOOL = ToolDefinition(
    name="hiring.search_workers",
    description=(
        "Search the whole worker pool for workers matching a trade (e.g. 'electrician', 'mason') "
        "and optional skill, experience, wage and city. Use this when the employer describes who "
        "they want to hire (e.g. 'I want 5 electricians') WITHOUT first creating a job. Not tied to "
        "any job or prior match. If the employer names a location/city, pass it in 'city' for "
        "location-aware results; otherwise omit it to search everywhere. Returns each worker's name, "
        "trade, skills, experience, expected daily wage, city, availability and verification status. "
        "Read-only — it creates nothing."
    ),
    domain="hiring",
    agent_id="hiring",
    input_schema={
        "type": "object",
        "properties": {
            "trade": {"type": "string", "description": "Trade/occupation to search for, e.g. 'electrician'."},
            "skill": {"type": "string", "description": "Optional specific skill to require."},
            "min_experience": {"type": "integer", "minimum": 0, "description": "Minimum years of experience."},
            "max_wage": {"type": "number", "minimum": 0, "description": "Maximum expected daily wage (INR)."},
            "city": {"type": "string", "description": "City for location-aware search; omit to search everywhere."},
            "only_available": {"type": "boolean", "description": "Limit to workers whose status is AVAILABLE."},
            "limit": {"type": "integer", "minimum": 1, "maximum": 50, "description": "Max workers to return (default 10)."},
        },
        "required": ["trade"],
        "additionalProperties": False,
    },
    output_schema={
        "type": "object",
        "properties": {
            "status": {"type": "string", "enum": ["FOUND", "NO_MATCHES"]},
            "trade": {"type": "string"},
            "location_filtered": {"type": "boolean"},
            "total_count": {"type": "integer", "minimum": 0},
            "returned_count": {"type": "integer", "minimum": 0},
            "workers": {"type": "array", "items": {"type": "object"}},
        },
        "required": ["status", "total_count", "returned_count", "workers"],
    },
    required_roles=("EMPLOYER",),
    required_permissions=("job:read",),
)


LIST_MY_WORKERS_TOOL = ToolDefinition(
    name="hiring.list_my_workers",
    description=(
        "List the workers THIS employer has already selected (or completed work with) on their own "
        "jobs — the same people shown on the employer's Workers page. Use this when the employer asks "
        "about 'my workers', 'the workers I selected/hired', how many workers they have, or names a "
        "worker they already selected (e.g. before sending an interview invite). Returns each worker's "
        "worker_profile_id, name, trade, skills, experience, expected daily wage, city, availability, "
        "verification and the jobs they were selected for. It does NOT contain phone or email; to "
        "reach a worker use hiring.send_interview_invite with the returned worker_profile_id. "
        "Read-only."
    ),
    domain="hiring",
    agent_id="hiring",
    input_schema={
        "type": "object",
        "properties": {
            "limit": {"type": "integer", "minimum": 1, "maximum": 100, "description": "Max workers to return (default 50)."},
        },
        "additionalProperties": False,
    },
    output_schema={
        "type": "object",
        "properties": {
            "status": {"type": "string", "enum": ["FOUND", "NONE_SELECTED"]},
            "returned_count": {"type": "integer", "minimum": 0},
            "workers": {"type": "array", "items": {"type": "object"}},
        },
        "required": ["status", "returned_count", "workers"],
    },
    required_roles=("EMPLOYER",),
    required_permissions=("job:read",),
)
