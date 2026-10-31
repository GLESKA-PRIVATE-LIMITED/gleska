"""Shared test fixtures.

Every AI call now goes through the billing gateway. Tests that are not about billing get an
in-memory backend with a configured INR price and an ambient billing scope, so their behaviour is
unchanged. Billing tests install their own backend and scope.
"""

from decimal import Decimal

import pytest

from app.ai_gateway import backend as billing_backend
from app.ai_gateway.context import billing_scope
from app.ai_gateway.pricing import BillingSettings, FxRate, ModelPrice


class InMemoryBillingBackend:
    def __init__(self, price: ModelPrice | None = None, credits: Decimal = Decimal("1000000")):
        self.price = price or ModelPrice(
            id="price-test", provider="gemini", model="*", version=1, currency="INR",
            input_price=Decimal("10"), output_price=Decimal("30"),
        )
        self.available = credits
        self.events: dict[str, dict] = {}
        self.reserved: dict[str, Decimal] = {}

    def resolve_account(self, user_id):
        return "account-test"

    def active_price(self, provider, model):
        return self.price

    def active_settings(self):
        return BillingSettings(id="settings-test", credit_value_inr=Decimal(20),
                               markup_multiplier=Decimal("1.10"), default_max_output_tokens=8192)

    def active_fx(self, currency):
        return FxRate(id="fx-test", rate=Decimal("83"))

    def create_event(self, fields):
        event_id = f"event-{len(self.events) + 1}"
        self.events[event_id] = dict(fields)
        return event_id

    def update_event(self, event_id, fields):
        self.events[event_id].update(fields)

    def reserve(self, event_id, credits):
        from app.ai_gateway.errors import AIBillingError

        if credits > self.available:
            raise AIBillingError("INSUFFICIENT_CREDITS")
        self.available -= credits
        self.reserved[event_id] = credits

    def settle(self, event_id, credits, fields):
        held = self.reserved.pop(event_id, None)
        if held is None:
            return
        self.available += held - min(credits, held)
        self.available -= min(credits - min(credits, held), self.available)
        self.events[event_id].update(fields, credits_charged=credits)


@pytest.fixture(autouse=True)
def ai_billing():
    backend = InMemoryBillingBackend()
    previous = billing_backend.set_backend(backend)
    with billing_scope(agent="test", user_id="00000000-0000-0000-0000-000000000000"):
        yield backend
    billing_backend.set_backend(previous)
