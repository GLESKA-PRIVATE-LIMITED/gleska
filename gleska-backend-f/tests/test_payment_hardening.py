from decimal import Decimal
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi import HTTPException

from app.main import app
from app.routers import payments
from app.routers.payments import _validate_paid_order, _validate_success_webhook
from app.schemas.auth import UserResponse
from app.services import job_service
from app.services.cashfree_payment_service import CashfreePaymentError
from app.services.job_service import JobService


def test_payment_routes_are_registered():
    paths = set()
    for included in app.routes:
        context = getattr(included, "include_context", None)
        if context:
            paths.update((context.prefix + route.path, tuple(route.methods or ())) for route in context.included_router.routes)
    assert ("/api/v1/payments/create-subscription-order", ("POST",)) in paths
    assert ("/api/v1/payments/verify/{order_id}", ("POST",)) in paths
    assert ("/api/v1/payments/webhook", ("POST",)) in paths


@pytest.mark.asyncio
async def test_create_subscription_order_generates_transaction_id(monkeypatch):
    inserted = {}

    class Query:
        def __init__(self, data):
            self.data = data

        def select(self, _fields): return self
        def eq(self, *_args): return self
        def limit(self, *_args): return self
        def single(self): return self

        def insert(self, record):
            inserted.update(record)
            self.data = [record]
            return self

        def execute(self): return SimpleNamespace(data=self.data)

    class Supabase:
        def table(self, name):
            if name == "employer_profiles":
                return Query({"id": "employer-id"})
            return Query([])

    async def fake_create(cls, employer_id, phone, email):
        return {
            "order_id": "sub-order",
            "cf_order_id": "cashfree-order",
            "payment_session_id": "session",
        }

    monkeypatch.setattr(payments, "supabase", Supabase())
    monkeypatch.setattr(payments.CashfreePaymentService, "create_subscription_order", classmethod(fake_create))
    user = UserResponse(
        id="user-id",
        name="Employer",
        mobile="919876543210",
        email="employer@example.com",
        role="EMPLOYER",
        is_mobile_verified=True,
        is_active=True,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )

    result = await payments.create_subscription_order(user)

    UUID(inserted["id"])
    assert inserted["created_at"]
    assert inserted["order_id"] == result.order_id
    assert inserted["status"] == "PENDING"


@pytest.mark.asyncio
async def test_verify_success_transaction_is_idempotent(monkeypatch):
    employer = {"id": "employer-id", "subscription_valid_until": "2026-10-27T00:00:00+00:00"}
    transaction = {"order_id": "sub-order", "employer_id": "employer-id", "status": "SUCCESS"}
    rpc_called = False
    cashfree_called = False

    class Query:
        def select(self, _fields): return self
        def eq(self, *_args): return self
        def maybe_single(self): return self
        def execute(self): return SimpleNamespace(data=transaction)

    class Supabase:
        def table(self, _name): return Query()

        def rpc(self, *_args):
            nonlocal rpc_called
            rpc_called = True
            return Query()

    async def fake_status(cls, _order_id):
        nonlocal cashfree_called
        cashfree_called = True
        return {"order_status": "PAID"}

    monkeypatch.setattr(payments, "supabase", Supabase())
    monkeypatch.setattr(payments, "_employer", lambda _user, _fields="id": _async_value(employer))
    monkeypatch.setattr(payments.CashfreePaymentService, "get_order_status", classmethod(fake_status))

    result = await payments.verify_payment("sub-order", SimpleNamespace())

    assert result.status == "SUCCESS"
    assert result.subscription_valid_until.isoformat() == employer["subscription_valid_until"]
    assert not rpc_called
    assert not cashfree_called


async def _async_value(value):
    return value


@pytest.mark.asyncio
async def test_verify_pending_paid_order_marks_success_and_extends_once(monkeypatch):
    transaction = {
        "order_id": "sub-order",
        "employer_id": "employer-id",
        "status": "PENDING",
        "amount": "2000",
        "currency": "INR",
    }
    employer = {"id": "employer-id", "subscription_valid_until": None}
    rpc_calls = []

    class Query:
        def select(self, _fields): return self
        def eq(self, *_args): return self
        def maybe_single(self): return self
        def execute(self): return SimpleNamespace(data=transaction)

    class Supabase:
        def table(self, _name): return Query()
        def rpc(self, name, payload):
            rpc_calls.append((name, payload))
            return SimpleNamespace(execute=lambda: SimpleNamespace(data="SUCCESS"))

    async def fake_status(cls, _order_id):
        return {
            "order_id": "sub-order",
            "cf_order_id": "cf-order",
            "order_status": "PAID",
            "order_amount": 2000,
            "order_currency": "INR",
        }

    monkeypatch.setattr(payments, "supabase", Supabase())
    monkeypatch.setattr(payments, "_employer", lambda _user, _fields="id": _async_value(employer))
    monkeypatch.setattr(payments.CashfreePaymentService, "get_order_status", classmethod(fake_status))

    result = await payments.verify_payment("sub-order", SimpleNamespace())

    assert result.status == "SUCCESS"
    assert len(rpc_calls) == 1
    assert rpc_calls[0][1]["p_order_id"] == "sub-order"


@pytest.mark.asyncio
async def test_verify_pending_failed_order_keeps_failure_controlled(monkeypatch):
    transaction = {"order_id": "sub-order", "employer_id": "employer-id", "status": "PENDING"}
    updates = []

    class Query:
        def select(self, _fields): return self
        def eq(self, *_args): return self
        def maybe_single(self): return self
        def update(self, payload):
            updates.append(payload)
            return self
        def execute(self): return SimpleNamespace(data=transaction)

    class Supabase:
        def table(self, _name): return Query()

    async def fake_status(cls, _order_id): return {"order_status": "FAILED", "cf_order_id": "cf-order"}

    monkeypatch.setattr(payments, "supabase", Supabase())
    monkeypatch.setattr(payments, "_employer", lambda _user, _fields="id": _async_value({"id": "employer-id"}))
    monkeypatch.setattr(payments.CashfreePaymentService, "get_order_status", classmethod(fake_status))

    result = await payments.verify_payment("sub-order", SimpleNamespace())

    assert result.status == "FAILED"
    assert updates == [{"status": "FAILED", "cf_order_id": "cf-order"}]


@pytest.mark.asyncio
async def test_verify_failed_transaction_cannot_be_reported_as_success(monkeypatch):
    transaction = {
        "order_id": "sub-order",
        "employer_id": "employer-id",
        "status": "FAILED",
        "amount": "2000",
        "currency": "INR",
    }

    class Query:
        def select(self, _fields): return self
        def eq(self, *_args): return self
        def maybe_single(self): return self
        def execute(self): return SimpleNamespace(data=transaction)

    class Supabase:
        def table(self, _name): return Query()
        def rpc(self, *_args):
            return SimpleNamespace(execute=lambda: SimpleNamespace(data="INVALID_STATE"))

    async def fake_status(cls, _order_id):
        return {
            "order_id": "sub-order",
            "cf_order_id": "cf-order",
            "order_status": "PAID",
            "order_amount": 2000,
            "order_currency": "INR",
        }

    monkeypatch.setattr(payments, "supabase", Supabase())
    monkeypatch.setattr(payments, "_employer", lambda _user, _fields="id": _async_value({"id": "employer-id"}))
    monkeypatch.setattr(payments.CashfreePaymentService, "get_order_status", classmethod(fake_status))

    with pytest.raises(HTTPException) as error:
        await payments.verify_payment("sub-order", SimpleNamespace())

    assert error.value.status_code == 409
    assert error.value.detail == "PAYMENT_STATE_INVALID"


@pytest.mark.asyncio
async def test_verify_missing_transaction_returns_not_found(monkeypatch):
    class Query:
        def select(self, _fields): return self
        def eq(self, *_args): return self
        def maybe_single(self): return self
        def execute(self): return SimpleNamespace(data=None)

    class Supabase:
        def table(self, _name): return Query()

    monkeypatch.setattr(payments, "supabase", Supabase())
    monkeypatch.setattr(payments, "_employer", lambda _user, _fields="id": _async_value({"id": "employer-id"}))

    with pytest.raises(HTTPException) as error:
        await payments.verify_payment("missing-order", SimpleNamespace())

    assert error.value.status_code == 404
    assert error.value.detail == "PAYMENT_ORDER_NOT_FOUND"


@pytest.mark.asyncio
async def test_verify_cashfree_failure_returns_service_unavailable(monkeypatch):
    transaction = {"order_id": "sub-order", "employer_id": "employer-id", "status": "PENDING"}

    class Query:
        def select(self, _fields): return self
        def eq(self, *_args): return self
        def maybe_single(self): return self
        def execute(self): return SimpleNamespace(data=transaction)

    class Supabase:
        def table(self, _name): return Query()

    async def fake_status(cls, _order_id): raise CashfreePaymentError("CASHFREE_PAYMENT_VERIFY_FAILED")

    monkeypatch.setattr(payments, "supabase", Supabase())
    monkeypatch.setattr(payments, "_employer", lambda _user, _fields="id": _async_value({"id": "employer-id"}))
    monkeypatch.setattr(payments.CashfreePaymentService, "get_order_status", classmethod(fake_status))

    with pytest.raises(HTTPException) as error:
        await payments.verify_payment("sub-order", SimpleNamespace())

    assert error.value.status_code == 503
    assert error.value.detail == "CASHFREE_PAYMENT_VERIFY_FAILED"


@pytest.mark.asyncio
async def test_success_webhook_does_not_reprocess_success_transaction(monkeypatch):
    updates = []
    rpc_called = False

    class Query:
        def select(self, _fields): return self
        def eq(self, *_args): return self
        def maybe_single(self): return self
        def update(self, payload):
            updates.append(payload)
            return self
        def execute(self):
            return SimpleNamespace(data={
                "order_id": "sub-order",
                "employer_id": "employer-id",
                "status": "SUCCESS",
                "amount": "2000",
                "currency": "INR",
            })

    class Supabase:
        def table(self, _name): return Query()

        def rpc(self, *_args):
            nonlocal rpc_called
            rpc_called = True
            return Query()

    class Request:
        headers = {"x-webhook-signature": "signature", "x-webhook-timestamp": "timestamp"}

        async def body(self): return b"{}"
        async def json(self):
            return {
                "type": "PAYMENT_SUCCESS_WEBHOOK",
                "data": {
                    "order": {
                        "order_id": "sub-order",
                        "cf_order_id": "cf-order",
                        "order_amount": 2000,
                        "order_currency": "INR",
                    },
                    "payment": {"payment_status": "SUCCESS"},
                },
            }

    monkeypatch.setattr(payments, "supabase", Supabase())
    monkeypatch.setattr(payments.CashfreePaymentService, "verify_webhook_signature", staticmethod(lambda *_args: True))

    result = await payments.cashfree_webhook(Request())

    assert result == {"status": "OK"}
    assert updates == [{"raw_webhook_payload": (await Request().json())}]
    assert not rpc_called


def test_provider_order_validation_requires_matching_details():
    transaction = {"order_id": "sub-1", "amount": Decimal("2000.00"), "currency": "INR"}
    valid = {
        "order_id": "sub-1",
        "cf_order_id": "cf-1",
        "order_status": "PAID",
        "order_amount": 2000,
        "order_currency": "INR",
    }
    _validate_paid_order(valid, "sub-1", transaction)

    for field, value in (("order_amount", 1999), ("order_currency", "USD"), ("order_id", "other")):
        invalid = {**valid, field: value}
        with pytest.raises(HTTPException):
            _validate_paid_order(invalid, "sub-1", transaction)


def test_success_webhook_requires_success_payment_and_matching_order():
    transaction = {"order_id": "sub-1", "amount": "2000.00", "currency": "INR", "status": "PENDING"}
    order = {"order_id": "sub-1", "cf_order_id": "cf-1", "order_amount": "2000.00", "order_currency": "INR"}
    _validate_success_webhook(order, {"payment_status": "SUCCESS"}, transaction)

    with pytest.raises(HTTPException):
        _validate_success_webhook(order, {"payment_status": "FAILED"}, transaction)


def test_list_jobs_does_not_use_dispatch_authorization(monkeypatch):
    class Query:
        def select(self, _fields): return self
        def eq(self, *_args): return self
        def order(self, *_args, **_kwargs): return self
        def execute(self): return SimpleNamespace(data=[])

    class Supabase:
        def table(self, _name): return Query()

    monkeypatch.setattr(job_service, "supabase", Supabase())
    monkeypatch.setattr(JobService, "_employer_profile", staticmethod(lambda _user: {"id": "employer-id"}))
    monkeypatch.setattr(JobService, "_employer_id", staticmethod(lambda _user: (_ for _ in ()).throw(AssertionError("payment gate used"))))
    assert JobService.list_for_user(SimpleNamespace(id="user-id")) == []
