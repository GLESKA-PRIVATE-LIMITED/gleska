"""Read-only invoice lookup tool for the Financial Agent."""

from app.tools.shared.contracts import ToolDefinition

LIST_FINANCIAL_INVOICES_TOOL = ToolDefinition(
    name="list_financial_invoices",
    description=(
        "Search the authenticated employer's persisted invoices. Returns invoice number, "
        "client, dates, currency, amounts, status, and line items. This is read-only."
    ),
    domain="financial",
    agent_id="financial",
    input_schema={
        "type": "object",
        "properties": {
            "search": {"type": "string", "maxLength": 200},
        },
        "additionalProperties": False,
    },
    output_schema={
        "type": "object",
        "properties": {
            "invoices": {"type": "array"},
        },
        "required": ["invoices"],
        "additionalProperties": False,
    },
    required_roles=("EMPLOYER",),
    confirmation_required=False,
    enabled=True,
)

__all__ = ["LIST_FINANCIAL_INVOICES_TOOL"]
