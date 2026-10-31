"""AI credit purchases (migration 105): server-priced orders, Cashfree confirmation, idempotent credit."""

import json
from decimal import Decimal

import pytest

from app.routers import payments
from app.services import billing_service, credit_purchase_service
from app.services.cashfree_payment_service import CashfreePaymentError
from tests.test_billing_api import EMPLOYER_A, EMPLOYER_B, WORKER, FakeDB, FakeResult, client_as  # noqa: F401

ORDER = "cred_" + "a" * 24


class PurchaseDB(FakeDB):
    def __init__(self):
        super().__init__()
        self.tables["credit_purchase_orders"] = []
        self.tables["billing_settings"][0]["id"] = "s1"

    def rpc(self, name, params):
        if name != "billing_complete_purchase":
            return super().rpc(name, params)
        self.rpcs.append((name, params))
        order = next(o for o in self.tables["credit_purchase_orders"] if o["order_id"] == params["p_order_id"])
        if order["status"] == "PENDING":
            assert Decimal(params["p_paid_amount"]) == Decimal(order["amount_inr"])
            order.update(status="PAID", receipt_number="GLK-CR-000001", paid_at="2026-10-31T10:00:00+00:00",
                         cf_payment_id=params["p_cf_payment_id"], payment_method=params["p_payment_method"])
            wallet = next(w for w in self.tables["credit_wallets"] if w["account_id"] == order["account_id"])
            wallet["available"] = str(Decimal(wallet["available"]) + Decimal(order["credits"]))
        return type("R", (), {"execute": lambda self: FakeResult({"status": "PAID"})})()


@pytest.fixture
def db(monkeypatch):
    fake = PurchaseDB()
    monkeypatch.setattr(billing_service, "supabase", fake)
    monkeypatch.setattr(credit_purchase_service, "supabase", fake)
    return fake


@pytest.fixture
def cashfree(monkeypatch):
    calls = {"create": [], "status": {}}

    async def create(cls, owner_id, phone, email, amount=None, order_note="", return_path="", order_id=None):
        calls["create"].append({"amount": amount, "return_path": return_path, "order_id": order_id, "owner": owner_id})
        if calls.get("fail"):
            raise CashfreePaymentError("CASHFREE_ORDER_CREATE_FAILED")
        return {"order_id": order_id, "cf_order_id": "cf-1", "payment_session_id": "session-1"}

    async def get_status(cls, order_id):
        return calls["status"][order_id]

    svc = credit_purchase_service.CashfreePaymentService
    monkeypatch.setattr(svc, "create_subscription_order", classmethod(create))
    monkeypatch.setattr(svc, "get_order_status", classmethod(get_status))
    return calls


def completions(db):
    return [params for name, params in db.rpcs if name == "billing_complete_purchase"]


def add_order(db, order_id=ORDER, account="acc-a", credits="25", amount="500.00", status="PENDING"):
    row = {"order_id": order_id, "account_id": account, "user_id": EMPLOYER_A.id, "credits": credits,
           "credit_value_inr": "20", "amount_inr": amount, "currency": "INR", "status": status,
           "receipt_number": None, "payment_method": None, "paid_at": None, "cf_payment_id": None,
           "created_at": "2026-10-31T09:00:00+00:00"}
    db.tables["credit_purchase_orders"].append(row)
    return row


def test_server_computes_amount_and_ignores_client_amount(db, cashfree, client_as):
    response = client_as(EMPLOYER_A).post("/api/v1/billing/purchases", json={"credits": 25, "amount_inr": "1"})
    assert response.status_code == 201
    body = response.json()
    assert (body["credits"], body["amount_inr"], body["payment_session_id"]) == ("25", "500.00", "session-1")
    call = cashfree["create"][0]
    assert call["amount"] == 500.0 and call["return_path"] == "/employer/billing"
    assert call["order_id"].startswith("cred_") and call["order_id"] == body["order_id"]
    row = db.tables["credit_purchase_orders"][0]
    assert (row["status"], row["amount_inr"], row["account_id"], row["cf_order_id"]) == ("PENDING", "500.00", "acc-a", "cf-1")


def test_purchase_limits_and_roles(db, cashfree, client_as):
    employer = client_as(EMPLOYER_A)
    for credits in (4, 2501, 2.5, -10):
        assert employer.post("/api/v1/billing/purchases", json={"credits": credits}).status_code == 422
    assert employer.post("/api/v1/billing/purchases", json={"credits": 5}).status_code == 201
    assert employer.post("/api/v1/billing/purchases", json={"credits": 2500}).status_code == 201
    assert employer.get("/api/v1/billing/purchase-options").json() == {
        "min_credits": 5, "max_credits": 2500, "credit_value_inr": "20"}
    assert client_as(WORKER).post("/api/v1/billing/purchases", json={"credits": 5}).status_code == 403


def test_suspended_account_cannot_buy(db, cashfree, client_as):
    db.tables["billing_accounts"][0]["status"] = "suspended"
    response = client_as(EMPLOYER_A).post("/api/v1/billing/purchases", json={"credits": 5})
    assert response.status_code == 403 and cashfree["create"] == []


def test_provider_failure_marks_order_failed(db, cashfree, client_as):
    cashfree["fail"] = True
    response = client_as(EMPLOYER_A).post("/api/v1/billing/purchases", json={"credits": 5})
    assert (response.status_code, response.json()["detail"]) == (503, "PAYMENT_PROVIDER_UNAVAILABLE")
    assert db.tables["credit_purchase_orders"][0]["status"] == "FAILED"


def _webhook(client, monkeypatch, event, order_amount="500.00", currency="INR", payment_status="SUCCESS"):
    monkeypatch.setattr(payments.CashfreePaymentService, "verify_webhook_signature", staticmethod(lambda *_a: True))
    monkeypatch.setattr(payments, "supabase", None)  # subscription path must not be touched
    body = {"type": event, "data": {
        "order": {"order_id": ORDER, "cf_order_id": "cf-1", "order_amount": order_amount, "order_currency": currency},
        "payment": {"payment_status": payment_status, "cf_payment_id": "pay-1", "payment_group": "upi"},
    }}
    return client.post("/api/v1/payments/webhook", content=json.dumps(body),
                       headers={"x-webhook-signature": "s", "x-webhook-timestamp": "1"})


def test_success_webhook_credits_once_and_never_runs_subscription_logic(db, client_as, monkeypatch):
    add_order(db)
    client = client_as(EMPLOYER_A)
    assert _webhook(client, monkeypatch, "PAYMENT_SUCCESS_WEBHOOK").json() == {"status": "OK"}
    assert _webhook(client, monkeypatch, "PAYMENT_SUCCESS_WEBHOOK").status_code == 200
    wallet = db.tables["credit_wallets"][0]
    assert Decimal(wallet["available"]) == Decimal("37.5")
    params = completions(db)[0]
    assert len(completions(db)) == 2  # second delivery reaches SQL, which makes it a no-op
    assert (params["p_paid_amount"], params["p_currency"], params["p_cf_payment_id"], params["p_payment_method"]) == (
        "500.00", "INR", "pay-1", "upi")


def test_webhook_with_wrong_amount_is_rejected(db, client_as, monkeypatch):
    add_order(db)
    response = _webhook(client_as(EMPLOYER_A), monkeypatch, "PAYMENT_SUCCESS_WEBHOOK", order_amount="1.00")
    assert (response.status_code, response.json()["detail"]) == (400, "PAYMENT_PROVIDER_DETAILS_MISMATCH")
    assert completions(db) == [] and db.tables["credit_purchase_orders"][0]["status"] == "PENDING"


def test_failed_payment_webhook_keeps_order_open_for_retry(db, client_as, monkeypatch):
    add_order(db)
    response = _webhook(client_as(EMPLOYER_A), monkeypatch, "PAYMENT_FAILED_WEBHOOK", payment_status="FAILED")
    assert response.status_code == 200
    row = db.tables["credit_purchase_orders"][0]
    assert (row["status"], row["last_payment_status"]) == ("PENDING", "FAILED")


def test_unsigned_webhook_is_rejected(db, client_as):
    response = client_as(EMPLOYER_A).post("/api/v1/payments/webhook", json={"type": "PAYMENT_SUCCESS_WEBHOOK"})
    assert response.status_code == 401 and completions(db) == []


def test_return_page_verification_credits_paid_order(db, cashfree, client_as):
    add_order(db)
    cashfree["status"][ORDER] = {"order_id": ORDER, "order_status": "PAID", "order_amount": 500, "order_currency": "INR", "cf_order_id": "cf-1"}
    response = client_as(EMPLOYER_A).post(f"/api/v1/billing/purchases/{ORDER}/verify")
    assert response.status_code == 200 and response.json()["status"] == "PAID"
    assert response.json()["receipt_number"] == "GLK-CR-000001"


def test_expired_order_is_closed_without_credit(db, cashfree, client_as):
    add_order(db)
    cashfree["status"][ORDER] = {"order_id": ORDER, "order_status": "EXPIRED", "order_amount": 500, "order_currency": "INR"}
    assert client_as(EMPLOYER_A).post(f"/api/v1/billing/purchases/{ORDER}/verify").json()["status"] == "EXPIRED"
    assert completions(db) == []


def test_other_employers_orders_and_receipts_are_hidden(db, cashfree, client_as):
    add_order(db, status="PAID")
    db.tables["credit_purchase_orders"][0].update(receipt_number="GLK-CR-000009", paid_at="2026-10-31T10:00:00+00:00")
    other = client_as(EMPLOYER_B)
    assert other.post(f"/api/v1/billing/purchases/{ORDER}/verify").status_code == 404
    assert other.get(f"/api/v1/billing/purchases/{ORDER}/receipt").status_code == 404
    assert other.get("/api/v1/billing/purchases").json() == {"purchases": []}
    assert other.post("/api/v1/billing/purchases/not-an-order/verify").status_code == 422


def test_receipt_only_for_paid_orders(db, cashfree, client_as):
    row = add_order(db)
    owner = client_as(EMPLOYER_A)
    assert owner.get(f"/api/v1/billing/purchases/{ORDER}/receipt").status_code == 404
    row.update(status="PAID", receipt_number="GLK-CR-000009", paid_at="2026-10-31T10:00:00+00:00", payment_method="upi")
    receipt = owner.get(f"/api/v1/billing/purchases/{ORDER}/receipt").json()
    assert (receipt["receipt_number"], receipt["amount_inr"], receipt["credits"], receipt["buyer_name"]) == (
        "GLK-CR-000009", "500.00", "25", "Alpha")
    assert "not GST-registered" in receipt["note"]
