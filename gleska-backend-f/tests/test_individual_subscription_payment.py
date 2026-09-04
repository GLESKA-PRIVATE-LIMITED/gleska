from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.routers import payments
from app.schemas.auth import UserResponse
from app.schemas.payment import IndividualSubscriptionOrderRequest


@pytest.mark.asyncio
async def test_individual_subscription_calculates_amount_and_keeps_employer_owner(monkeypatch):
    inserted = {}

    class Query:
        def __init__(self, data):
            self.data = data

        def select(self, _fields): return self
        def eq(self, *_args): return self
        def single(self): return self
        def insert(self, record):
            inserted.update(record)
            self.data = [record]
            return self
        def execute(self): return SimpleNamespace(data=self.data)

    class Supabase:
        def table(self, name):
            if name == "employer_profiles":
                return Query({"id": "individual-employer", "employer_type": "INDIVIDUAL"})
            return Query([])

    calls = []

    async def fake_create(cls, owner_id, phone, email, **kwargs):
        calls.append((owner_id, kwargs))
        return {"order_id": "sub-individual", "cf_order_id": "cf-individual", "payment_session_id": "session"}

    monkeypatch.setattr(payments, "supabase", Supabase())
    monkeypatch.setattr(payments.CashfreePaymentService, "create_subscription_order", classmethod(fake_create))
    user = UserResponse(
        id="individual-user", name="Individual", mobile="919876543210", email="individual@example.com",
        role="EMPLOYER", is_mobile_verified=True, is_active=True,
        created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc),
    )

    result = await payments.create_subscription_order(user, IndividualSubscriptionOrderRequest(employee_count=5))

    assert result.order_id == "sub-individual"
    assert calls == [("individual-employer", {"amount": 150.0, "order_note": "Individual Hirer Employee Subscription"})]
    assert inserted["employer_id"] == "individual-employer"
    assert inserted["employee_count"] == 5
    assert inserted["amount"] == 150.0