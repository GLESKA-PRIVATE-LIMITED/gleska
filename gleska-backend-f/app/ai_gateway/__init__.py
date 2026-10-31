"""Central AI gateway: the only entry point for Gleska-owned LLM calls (ADR 0007).

Agents call `generate_content(...)` inside a `billing_scope(...)`; the gateway resolves the
organisation's billing account, prices the model from versioned configuration, reserves credits,
calls the provider adapter, settles actual usage and records an immutable usage event.
"""

from app.ai_gateway.context import BillingContext, billing_scope, current_billing_context
from app.ai_gateway.errors import AIBillingError
from app.ai_gateway.gateway import generate_content

__all__ = ["AIBillingError", "BillingContext", "billing_scope", "current_billing_context", "generate_content"]
