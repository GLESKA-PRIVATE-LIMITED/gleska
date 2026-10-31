from datetime import datetime, timezone
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.core.security import get_current_user
from app.main import app
from app.schemas.auth import UserResponse
from app.services import billing_service
from app.services.billing_service import summarize
from tests.test_general_work import FakeQuery, FakeResult


def make_user(user_id: str, role: str) -> UserResponse:
    now = datetime.now(timezone.utc)
    return UserResponse(id=user_id, name="T", mobile="910000000000", role=role,
                        is_mobile_verified=True, is_active=True, created_at=now, updated_at=now)


EMPLOYER_A = make_user("11111111-1111-1111-1111-111111111111", "EMPLOYER")
EMPLOYER_B = make_user("22222222-2222-2222-2222-222222222222", "EMPLOYER")
ADMIN = make_user("99999999-9999-9999-9999-999999999999", "ADMIN")
WORKER = make_user("33333333-3333-3333-3333-333333333333", "WORKER")


class FakeDB:
    def __init__(self):
        self.tables = {
            "employer_profiles": [
                {"id": "emp-a", "user_id": EMPLOYER_A.id, "contact_person_name": "Asha"},
                {"id": "emp-b", "user_id": EMPLOYER_B.id, "contact_person_name": "Bina"},
            ],
            "employer_onboarding_details": [{"employer_id": "emp-a", "business_name": "Alpha"}],
            "users": [
                {"id": EMPLOYER_A.id, "name": "A", "email": "a@example.com", "mobile": "+91 90000 01234"},
                {"id": EMPLOYER_B.id, "name": "B", "email": "b@example.com", "mobile": None},
            ],
            "billing_accounts": [
                {"id": "acc-a", "employer_id": "emp-a", "status": "active", "created_at": "2026-10-01"},
                {"id": "acc-b", "employer_id": "emp-b", "status": "active", "created_at": "2026-10-01"},
            ],
            "credit_wallets": [
                {"account_id": "acc-a", "available": "12.500000", "reserved": "0.25", "total_purchased": "0",
                 "total_consumed": "1.1", "total_refunded": "0", "total_adjusted": "13.85", "total_unrecovered": "0"},
                {"account_id": "acc-b", "available": "99", "reserved": "0", "total_purchased": "0",
                 "total_consumed": "0", "total_refunded": "0", "total_adjusted": "99", "total_unrecovered": "0"},
            ],
            "billing_settings": [{"id": "s1", "version": 1, "credit_value_inr": "20", "markup_multiplier": "1.10",
                                  "effective_from": "2026-01-01T00:00:00+00:00"}],
            "ai_usage_events": [
                {"id": "e1", "account_id": "acc-a", "executing_agent": "hiring", "model": "m", "provider": "gemini",
                 "status": "succeeded", "input_tokens": 100, "output_tokens": 50, "total_tokens": 150,
                 "credits_charged": "0.5", "customer_charge_inr": "10", "provider_cost_inr": "9.0909", "started_at": "2026-10-30"},
                {"id": "e2", "account_id": "acc-b", "executing_agent": "financial", "model": "m", "provider": "gemini",
                 "status": "succeeded", "input_tokens": 999, "output_tokens": 1, "total_tokens": 1000,
                 "credits_charged": "3", "started_at": "2026-10-30"},
            ],
            "ai_model_pricing": [],
            "billing_audit_logs": [],
            "credit_ledger": [],
            "fx_rates": [],
        }
        self.rpcs = []

    def table(self, name):
        db = self

        class Query(FakeQuery):
            def __init__(self):
                super().__init__(None, name)
                self.db = db

            def lte(self, field, value):
                return self._add(lambda row: str(row.get(field)) <= str(value))

            def gte(self, field, value):
                return self._add(lambda row: str(row.get(field)) >= str(value))

            def execute(self):
                rows = db.tables[name]
                if self.op == "insert":
                    row = {"id": f"{name}-{len(rows) + 1}", **self.payload}
                    rows.append(row)
                    return FakeResult([row])
                if self.op == "update":
                    matched = [r for r in rows if all(f(r) for f in self.filters)]
                    for r in matched:
                        r.update(self.payload)
                    return FakeResult(matched)
                result = [r for r in rows if all(f(r) for f in self.filters)]
                if self.order_by:
                    result.sort(key=lambda r: str(r.get(self.order_by[0])), reverse=self.order_by[1])
                return FakeResult(result[: self.limit_n] if self.limit_n else result)

        return Query()

    def rpc(self, name, params):
        self.rpcs.append((name, params))
        if name == "billing_ensure_account":
            data = next(a["id"] for a in self.tables["billing_accounts"] if a["employer_id"] == params["p_employer_id"])
        elif name == "billing_admin_adjust":
            if params["p_account_id"] == "00000000-0000-0000-0000-000000000000":
                raise RuntimeError("BILLING_ACCOUNT_NOT_FOUND")
            data = {"status": "adjustment"}
        else:
            data = None
        return type("R", (), {"execute": lambda self: FakeResult(data)})()


@pytest.fixture
def db(monkeypatch):
    fake = FakeDB()
    monkeypatch.setattr(billing_service, "supabase", fake)
    return fake


@pytest.fixture
def client_as():
    def _client(user):
        app.dependency_overrides[get_current_user] = lambda: user
        return TestClient(app)

    yield _client
    app.dependency_overrides.pop(get_current_user, None)


def test_employer_sees_only_own_wallet_and_usage(db, client_as):
    client = client_as(EMPLOYER_A)
    wallet = client.get("/api/v1/billing/wallet").json()
    assert (wallet["account_id"], wallet["available"], wallet["credit_value_inr"]) == ("acc-a", "12.500000", "20")
    assert "markup_multiplier" not in wallet
    usage = client.get("/api/v1/billing/usage").json()
    assert [e["id"] for e in usage["events"]] == ["e1"]
    assert usage["totals"]["credits_charged"] == "0.5" and usage["by_agent"][0]["agent"] == "hiring"
    # Gleska's provider cost (and therefore the markup) is never shown to employers.
    assert "provider_cost_inr" not in usage["totals"] and "provider_cost_inr" not in usage["by_agent"][0]
    assert "provider_cost_inr" not in usage["events"][0] and usage["events"][0]["customer_charge_inr"] == "10"


def test_workers_cannot_use_billing_and_employers_cannot_use_admin(db, client_as):
    assert client_as(WORKER).get("/api/v1/billing/wallet").status_code == 403
    employer = client_as(EMPLOYER_A)
    assert employer.get("/api/v1/admin/billing/accounts").status_code == 403
    assert employer.post("/api/v1/admin/billing/accounts/acc-a/adjust",
                         json={"credits": "100", "reason": "self service", "idempotency_key": "attack-0001"}).status_code == 403
    assert employer.post("/api/v1/admin/billing/pricing", json={}).status_code == 403
    assert db.rpcs == [] or all(name != "billing_admin_adjust" for name, _ in db.rpcs)


def test_admin_pricing_versions_are_validated_numbered_and_audited(db, client_as):
    admin = client_as(ADMIN)
    payload = {"model": "gemini-x", "currency": "USD", "input_price": "0.30", "output_price": "2.50",
               "source_note": "Verified on provider pricing page 2026-10-31"}
    first = admin.post("/api/v1/admin/billing/pricing", json=payload)
    second = admin.post("/api/v1/admin/billing/pricing", json={**payload, "output_price": "2.40"})
    assert (first.status_code, second.status_code) == (201, 201)
    assert [r["version"] for r in db.tables["ai_model_pricing"]] == [1, 2]
    assert [a["action"] for a in db.tables["billing_audit_logs"]] == ["pricing_version_created"] * 2
    assert db.tables["billing_audit_logs"][0]["actor_user_id"] == ADMIN.id
    bad = admin.post("/api/v1/admin/billing/pricing", json={**payload, "input_price": "-1"})
    no_source = admin.post("/api/v1/admin/billing/pricing", json={**payload, "source_note": ""})
    too_precise = admin.post("/api/v1/admin/billing/pricing", json={**payload, "input_price": "0.123456789"})
    assert (bad.status_code, no_source.status_code, too_precise.status_code) == (422, 422, 422)


def test_admin_adjustment_requires_reason_and_passes_exact_decimal(db, client_as):
    admin = client_as(ADMIN)
    acc = "11111111-0000-0000-0000-000000000001"
    assert admin.post(f"/api/v1/admin/billing/accounts/{acc}/adjust",
                      json={"credits": "5", "reason": "", "idempotency_key": "grant-0001"}).status_code == 422
    ok = admin.post(f"/api/v1/admin/billing/accounts/{acc}/adjust",
                    json={"credits": "2.500001", "reason": "Launch credits", "idempotency_key": "grant-0002"})
    assert ok.status_code == 200
    name, params = db.rpcs[-1]
    assert (name, params["p_delta"], params["p_actor"]) == ("billing_admin_adjust", "2.500001", ADMIN.id)
    missing = admin.post("/api/v1/admin/billing/accounts/00000000-0000-0000-0000-000000000000/adjust",
                         json={"credits": "1", "reason": "Launch credits", "idempotency_key": "grant-0003"})
    assert missing.status_code == 404


def test_fx_rate_for_inr_is_rejected(db, client_as):
    response = client_as(ADMIN).post("/api/v1/admin/billing/fx-rates",
                                     json={"base_currency": "INR", "rate": "1", "source": "manual"})
    assert response.status_code == 422


def test_summary_is_exact_decimal_arithmetic():
    totals, by_agent, by_model = summarize([
        {"executing_agent": "hiring", "credits_charged": "0.1", "total_tokens": 10, "status": "succeeded"},
        {"executing_agent": "hiring", "credits_charged": "0.2", "total_tokens": 20, "status": "failed"},
    ])
    assert totals.credits_charged == Decimal("0.3") and totals.failed_requests == 1
    assert by_agent[0].requests == 2 and by_model[0]["credits_charged"] == "0.3"


def test_admin_status_lists_what_is_missing(db, client_as, ai_billing, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "GEMINI_API_KEY", "k")
    monkeypatch.setattr(settings, "GEMINI_MODEL", "gemini-x")
    ai_billing.active_price = lambda provider, model: None
    body = client_as(ADMIN).get("/api/v1/admin/billing/status").json()
    assert body["ready"] is False and body["missing"] == ["Add a verified price for model 'gemini-x'"]
    assert client_as(EMPLOYER_A).get("/api/v1/admin/billing/status").status_code == 403

    def broken():
        raise RuntimeError("relation does not exist")

    ai_billing.active_settings = broken
    assert client_as(ADMIN).get("/api/v1/admin/billing/status").json()["migration_applied"] is False


def test_admin_account_list_creates_wallets_for_employers_without_one(db, client_as):
    db.tables["employer_profiles"].append({"id": "emp-c", "user_id": "c", "contact_person_name": " "})
    db.tables["users"].append({"id": "c", "name": "Gamma", "email": None, "mobile": "12"})
    original_rpc = db.rpc

    def rpc(name, params):
        if name == "billing_ensure_account" and params["p_employer_id"] == "emp-c":
            db.tables["billing_accounts"].append({"id": "acc-c", "employer_id": "emp-c", "status": "active"})
        return original_rpc(name, params)

    db.rpc = rpc
    accounts = client_as(ADMIN).get("/api/v1/admin/billing/accounts").json()["accounts"]
    # Business name first, then contact person, then the user's account name.
    assert [a["employer_name"] for a in accounts] == ["Alpha", "Bina", "Gamma"]
    alpha = accounts[0]
    assert (alpha["employer_email"], alpha["employer_phone_last4"]) == ("a@example.com", "1234")
    assert accounts[2]["employer_phone_last4"] is None
    assert all("mobile" not in a for a in accounts)
