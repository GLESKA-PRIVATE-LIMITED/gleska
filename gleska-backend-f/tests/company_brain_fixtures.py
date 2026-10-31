"""Controlled ground-truth dataset for Company Brain tests and the evaluation suite.

Two organisations (ORG_A, ORG_B) with hand-checked expected values. Today is fixed at 2026-10-31.
Every expected number in EXPECTED was computed by hand from these rows, not by the code under test.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime, timezone
from uuid import uuid4
from decimal import Decimal
from typing import Any

TODAY = date(2026, 10, 31)
ORG_A, ORG_B = "org-a", "org-b"
USER_A, USER_B = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
ACC_A, ACC_B = "acc-a", "acc-b"

ROWS: dict[str, list[dict[str, Any]]] = {
    "employer_profiles": [
        {"id": ORG_A, "user_id": USER_A},
        {"id": ORG_B, "user_id": USER_B},
    ],
    "billing_accounts": [
        {"id": ACC_A, "employer_id": ORG_A, "status": "active"},
        {"id": ACC_B, "employer_id": ORG_B, "status": "active"},
    ],
    "employer_onboarding_details": [
        {"employer_id": ORG_A, "business_name": "Alpha Builders", "industry_category": "Construction",
         "city": "Pune", "state": "Maharashtra", "updated_at": "2026-09-01T00:00:00+00:00"},
        {"employer_id": ORG_B, "business_name": "Beta Foods", "city": "Delhi"},
    ],
    "jobs": [
        {"id": "j1", "employer_id": ORG_A, "title": "Mason", "status": "SEARCHING", "headcount_required": 3,
         "max_daily_salary": "800.00", "updated_at": "2026-10-20T00:00:00+00:00"},
        {"id": "j2", "employer_id": ORG_A, "title": "Helper", "status": "FILLED", "headcount_required": 1,
         "max_daily_salary": "500", "updated_at": "2026-10-21T00:00:00+00:00"},
        {"id": "j3", "employer_id": ORG_A, "title": "Old job", "status": "CANCELLED", "headcount_required": 2,
         "max_daily_salary": "900", "updated_at": "2026-09-01T00:00:00+00:00"},
        {"id": "jb", "employer_id": ORG_B, "title": "Cook", "status": "SEARCHING", "headcount_required": 9,
         "max_daily_salary": "99999", "updated_at": "2026-10-01T00:00:00+00:00"},
    ],
    "job_matches": [
        {"id": "m1", "job_id": "j1", "worker_profile_id": "w1", "status": "ACCEPTED"},
        {"id": "m2", "job_id": "j1", "worker_profile_id": "w2", "status": "PENDING"},
        {"id": "m3", "job_id": "j1", "worker_profile_id": "w3", "status": "PENDING"},
        {"id": "m4", "job_id": "j2", "worker_profile_id": "w4", "status": "IN_PROGRESS"},
        {"id": "m5", "job_id": "j3", "worker_profile_id": "w5", "status": "ACCEPTED"},   # job cancelled -> not active, engaged
        {"id": "m6", "job_id": "j1", "worker_profile_id": "w6", "status": "COMPLETED"},
        {"id": "m7", "job_id": "j1", "worker_profile_id": "w7", "status": "REJECTED"},
        {"id": "mb", "job_id": "jb", "worker_profile_id": "w9", "status": "ACCEPTED"},   # org B
    ],
    "worker_profiles": [
        {"id": "w1", "user_id": "u-w1"}, {"id": "w4", "user_id": "u-w4"}, {"id": "w9", "user_id": "u-w9"},
    ],
    "users": [
        {"id": "u-w1", "name": "Ravi Kumar"}, {"id": "u-w4", "name": "Sita Devi"}, {"id": "u-w9", "name": "Other Org Worker"},
    ],
    "attendance": [
        {"id": "a1", "employer_id": ORG_A, "worker_profile_id": "w1", "attendance_date": "2026-10-28", "status": "PRESENT", "updated_at": "2026-10-28T10:00:00+00:00"},
        {"id": "a2", "employer_id": ORG_A, "worker_profile_id": "w1", "attendance_date": "2026-10-29", "status": "LATE", "updated_at": "2026-10-29T10:00:00+00:00"},
        {"id": "a3", "employer_id": ORG_A, "worker_profile_id": "w1", "attendance_date": "2026-10-30", "status": "ABSENT", "updated_at": "2026-10-30T10:00:00+00:00"},
        {"id": "a4", "employer_id": ORG_A, "worker_profile_id": "w4", "attendance_date": "2026-10-30", "status": "LATE", "updated_at": "2026-10-30T10:00:00+00:00"},
        {"id": "a5", "employer_id": ORG_A, "worker_profile_id": "w4", "attendance_date": "2026-09-15", "status": "ABSENT", "updated_at": "2026-09-15T10:00:00+00:00"},
        {"id": "ab", "employer_id": ORG_B, "worker_profile_id": "w9", "attendance_date": "2026-10-30", "status": "ABSENT"},
    ],
    "financial_invoices": [
        {"id": "i1", "employer_id": ORG_A, "invoice_number": "INV-1", "client_name": "Acme", "issue_date": "2026-10-05",
         "due_date": "2026-10-20", "currency": "INR", "total": "10000.00", "status": "GENERATED", "updated_at": "2026-10-05T00:00:00+00:00"},
        {"id": "i2", "employer_id": ORG_A, "invoice_number": "INV-2", "client_name": "Acme", "issue_date": "2026-10-10",
         "due_date": "2026-11-30", "currency": "INR", "total": "5000.50", "status": "GENERATED", "updated_at": "2026-10-10T00:00:00+00:00"},
        {"id": "i3", "employer_id": ORG_A, "invoice_number": "INV-3", "client_name": "Zen Ltd", "issue_date": "2026-09-01",
         "due_date": "2026-09-30", "currency": "INR", "total": "2000", "status": "GENERATED", "updated_at": "2026-09-01T00:00:00+00:00"},
        {"id": "i4", "employer_id": ORG_A, "invoice_number": "INV-4", "client_name": "Euro Co", "issue_date": "2026-10-15",
         "due_date": "2026-10-25", "currency": "USD", "total": "300", "status": "GENERATED", "updated_at": "2026-10-15T00:00:00+00:00"},
        {"id": "i5", "employer_id": ORG_A, "invoice_number": "DRAFT-1", "client_name": "Acme", "issue_date": "2026-10-12",
         "due_date": "2026-10-20", "currency": "INR", "total": "999999", "status": "DRAFT"},
        {"id": "ib", "employer_id": ORG_B, "invoice_number": "B-1", "client_name": "Secret", "issue_date": "2026-10-01",
         "due_date": "2026-10-02", "currency": "INR", "total": "777777", "status": "GENERATED"},
    ],
    "financial_invoice_payments": [
        {"id": "p1", "employer_id": ORG_A, "invoice_id": "i1", "amount": "4000", "payment_date": "2026-10-18"},
        {"id": "p2", "employer_id": ORG_A, "invoice_id": "i3", "amount": "2000.00", "payment_date": "2026-09-25"},
        {"id": "p3", "employer_id": ORG_A, "invoice_id": "i4", "amount": "100", "payment_date": "2026-10-26"},
    ],
    "financial_vendor_bills": [
        {"id": "b1", "employer_id": ORG_A, "vendor_name": "Cement Co", "bill_date": "2026-10-03", "currency": "INR", "total": "12000.10", "confirmed_at": "2026-10-04T00:00:00+00:00"},
        {"id": "b2", "employer_id": ORG_A, "vendor_name": "Steel Ltd", "bill_date": "2026-10-09", "currency": "INR", "total": "30000", "confirmed_at": "2026-10-09T00:00:00+00:00"},
        {"id": "b3", "employer_id": ORG_A, "vendor_name": "Cement Co", "bill_date": "2026-09-20", "currency": "INR", "total": "5000", "confirmed_at": "2026-09-21T00:00:00+00:00"},
        {"id": "b4", "employer_id": ORG_A, "vendor_name": "Unknown", "bill_date": "2026-10-11", "currency": "INR", "total": None, "confirmed_at": "2026-10-11T00:00:00+00:00"},
        {"id": "bb", "employer_id": ORG_B, "vendor_name": "B vendor", "bill_date": "2026-10-11", "currency": "INR", "total": "1"},
    ],
    "payment_transactions": [
        {"id": "t1", "employer_id": ORG_A, "amount": 2000.0, "currency": "INR", "status": "SUCCESS", "payment_category": "BUSINESS_SUBSCRIPTION", "payment_success_at": "2026-10-02T06:00:00+00:00"},
        {"id": "t2", "employer_id": ORG_A, "amount": 30.0, "currency": "INR", "status": "FAILED", "payment_category": "INDIVIDUAL_COMMISSION", "payment_success_at": None},
    ],
    "procurement_purchase_orders": [
        {"id": "po1", "employer_id": ORG_A, "order_reference": "PO-1", "supplier_company_id": "s1", "item_name": "Cement", "quantity": "100", "unit_price": "350.5000", "currency": "INR", "status": "ACCEPTED", "created_at": "2026-10-01T00:00:00+00:00", "updated_at": "2026-10-01T00:00:00+00:00", "estimated_delivery_date": "2026-10-25"},
        {"id": "po2", "employer_id": ORG_A, "order_reference": "PO-2", "supplier_company_id": "s2", "item_name": "Steel", "quantity": "2", "unit_price": "45000", "currency": "INR", "status": "DISPATCHED", "created_at": "2026-10-05T00:00:00+00:00", "updated_at": "2026-10-06T00:00:00+00:00", "estimated_delivery_date": "2026-11-05"},
        {"id": "po3", "employer_id": ORG_A, "order_reference": "PO-3", "supplier_company_id": "s1", "item_name": "Sand", "quantity": "10", "unit_price": "1000", "currency": "INR", "status": "ISSUED", "created_at": "2026-10-20T00:00:00+00:00", "updated_at": "2026-10-20T00:00:00+00:00"},
        {"id": "po4", "employer_id": ORG_A, "order_reference": "PO-4", "supplier_company_id": "s2", "item_name": "Bricks", "quantity": "1000", "unit_price": "8", "currency": "INR", "status": "DELIVERED", "created_at": "2026-10-02T00:00:00+00:00", "updated_at": "2026-10-12T00:00:00+00:00", "delivery_date": "2026-10-12"},
        {"id": "po5", "employer_id": ORG_A, "order_reference": "PO-5", "supplier_company_id": "s1", "item_name": "Paint", "quantity": "5", "unit_price": "999", "currency": "INR", "status": "CANCELLED", "created_at": "2026-10-03T00:00:00+00:00", "updated_at": "2026-10-04T00:00:00+00:00"},
        {"id": "pob", "employer_id": ORG_B, "order_reference": "B-PO", "supplier_company_id": "s1", "item_name": "Rice", "quantity": "1", "unit_price": "123456", "currency": "INR", "status": "ACCEPTED", "created_at": "2026-10-01T00:00:00+00:00", "updated_at": "2026-10-01T00:00:00+00:00", "estimated_delivery_date": "2026-10-01"},
    ],
    "procurement_rfqs": [
        {"id": "r1", "employer_id": ORG_A, "status": "OPEN", "updated_at": "2026-10-28T00:00:00+00:00"},
        {"id": "r2", "employer_id": ORG_A, "status": "CLOSED"},
    ],
    "supplier_companies": [{"id": "s1", "name": "BuildMart"}, {"id": "s2", "name": "SteelCo"}],
    "credit_wallets": [{"account_id": ACC_A, "available": "42.500000", "updated_at": "2026-10-30T00:00:00+00:00"}],
    "ai_usage_events": [
        {"id": "e1", "account_id": ACC_A, "executing_agent": "hiring", "credits_charged": "1.25", "started_at": "2026-10-10T00:00:00+05:30"},
        {"id": "e2", "account_id": ACC_A, "executing_agent": "financial", "credits_charged": "0.5", "started_at": "2026-10-11T00:00:00+05:30"},
        {"id": "eb", "account_id": ACC_B, "executing_agent": "hiring", "credits_charged": "99", "started_at": "2026-10-11T00:00:00+05:30"},
    ],
    "credit_purchase_orders": [
        {"id": "c1", "account_id": ACC_A, "amount_inr": "500.00", "status": "PAID", "paid_at": "2026-10-15T00:00:00+00:00"},
    ],
    "logistics_vehicle_listings": [
        {"id": "v1", "employer_id": ORG_A, "status": "ACTIVE", "price_amount": "2500", "price_unit": "per day"},
        {"id": "v2", "employer_id": ORG_A, "status": "DISPATCHED", "price_amount": "40", "price_unit": "per km"},
        {"id": "v3", "employer_id": ORG_A, "status": "ARCHIVED", "price_amount": "1", "price_unit": "per day"},
        {"id": "vb", "employer_id": ORG_B, "status": "ACTIVE", "price_amount": "9", "price_unit": "per day"},
    ],
    "logistics_rental_requests": [
        {"id": "q1", "employer_id": ORG_A, "status": "SUBMITTED", "offered_price": "3000", "price_unit": "per day"},
        {"id": "q2", "employer_id": ORG_A, "status": "IN_TRANSIT", "offered_price": "1500.50", "price_unit": "per day"},
        {"id": "q3", "employer_id": ORG_A, "status": "COMPLETED", "offered_price": "9999", "price_unit": "per day"},
        {"id": "q4", "employer_id": ORG_A, "status": "CONFIRMED", "offered_price": "55", "price_unit": "per km"},
    ],
}

# Hand-computed answers (ORG_A, today 2026-10-31, "this_month" = 2026-10-01..2026-10-31)
EXPECTED = {
    "workforce.active_workers": Decimal(2),          # w1 (m1 on SEARCHING j1), w4 (m4 IN_PROGRESS on FILLED j2)
    "workforce.engaged_workers": Decimal(4),         # w1, w4, w5, w6
    "workforce.pending_candidates": Decimal(2),      # m2, m3
    "workforce.open_jobs": Decimal(1),               # j1
    "workforce.headcount_gap": Decimal(2),           # j1: 3 - 1 active
    "workforce.daily_wage_cap_commitment:INR": Decimal("1300.00"),  # 800 + 500
    "attendance.present": Decimal(1), "attendance.late": Decimal(2), "attendance.absent": Decimal(1),  # October only
    "receivables.invoiced:INR": Decimal("15000.50"),   # i1 10000 + i2 5000.50 (i3 is September, i5 draft)
    "receivables.invoiced:USD": Decimal("300.00"),
    "receivables.received:INR": Decimal("4000.00"),    # p1 (p2 is September)
    "receivables.received:USD": Decimal("100.00"),
    "receivables.outstanding:INR": Decimal("11000.50"),  # i1 6000 + i2 5000.50 ; i3 fully paid
    "receivables.outstanding:USD": Decimal("200.00"),
    "receivables.overdue:INR": Decimal("6000.00"),     # i1 due 10-20
    "receivables.overdue:USD": Decimal("200.00"),      # i4 due 10-25
    "spend.supplier_bills:INR": Decimal("42000.10"),   # b1 + b2 (b4 has no total, b3 September)
    "spend.platform_payments:INR": Decimal("2000.00"),
    "spend.ai_credits_purchased:INR": Decimal("500.00"),
    "procurement.open_commitments:INR": Decimal("125050.00"),  # 100*350.5 + 2*45000
    "procurement.awaiting_supplier:INR": Decimal("10000.00"),  # po3
    "procurement.delivered_value:INR": Decimal("8000.00"),     # po4
    "procurement.cancelled_or_rejected": Decimal(1),
    "procurement.open_rfqs": Decimal(1),
    "procurement.delayed_deliveries": Decimal(1),              # po1 eta 10-25 < 10-31
    "logistics.listings_active": Decimal(1), "logistics.listings_dispatched": Decimal(1),  # v3 archived, vb org B
    "logistics.requests_submitted": Decimal(1), "logistics.requests_in_transit": Decimal(1),
    "logistics.requests_completed": Decimal(1), "logistics.requests_confirmed": Decimal(1),
}


class Result:
    def __init__(self, data):
        self.data = data


class Query:
    def __init__(self, db: "FakeDB", table: str):
        self.db, self.table, self.filters = db, table, []
        self.order_by, self.rng, self.op, self.payload, self.cols = None, None, "select", None, "*"

    def select(self, cols="*", **_):
        self.cols = cols
        return self

    def _f(self, fn):
        self.filters.append(fn)
        return self

    def eq(self, c, v):
        return self._f(lambda r: str(r.get(c)) == str(v))

    def neq(self, c, v):
        return self._f(lambda r: str(r.get(c)) != str(v))

    def in_(self, c, vs):
        vs = {str(v) for v in vs}
        return self._f(lambda r: str(r.get(c)) in vs)

    def gte(self, c, v):
        return self._f(lambda r: r.get(c) is not None and str(r.get(c)) >= str(v))

    def lt(self, c, v):
        return self._f(lambda r: r.get(c) is not None and str(r.get(c)) < str(v))

    def lte(self, c, v):
        return self._f(lambda r: r.get(c) is not None and str(r.get(c)) <= str(v))

    def is_(self, c, v):
        return self._f(lambda r: r.get(c) is None)

    def order(self, c, desc=False):
        self.order_by = (c, desc)
        return self

    def limit(self, n):
        self.rng = (0, n - 1)
        return self

    def range(self, a, b):
        self.rng = (a, b)
        return self

    def insert(self, payload):
        self.op, self.payload = "insert", payload
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def delete(self):
        self.op = "delete"
        return self

    def execute(self):
        self.db.queries.append((self.table, self.op))
        rows = self.db.tables.setdefault(self.table, [])
        if self.op == "insert":
            items = self.payload if isinstance(self.payload, list) else [self.payload]
            out = []
            for item in items:
                row = {"id": str(uuid4()), "created_at": datetime.now(timezone.utc).isoformat(), **item}
                rows.append(row)
                out.append(dict(row))
            return Result(out)
        hit = [r for r in rows if all(f(r) for f in self.filters)]
        if self.op == "update":
            for r in hit:
                r.update(self.payload)
            return Result([dict(r) for r in hit])
        if self.op == "delete":
            self.db.tables[self.table] = [r for r in rows if r not in hit]
            return Result([dict(r) for r in hit])
        if self.order_by:
            hit.sort(key=lambda r: str(r.get(self.order_by[0]) or ""), reverse=self.order_by[1])
        if self.rng:
            hit = hit[self.rng[0]: self.rng[1] + 1]
        return Result([dict(r) for r in hit])


class FakeDB:
    def __init__(self, rows: dict[str, list[dict[str, Any]]] | None = None):
        self.tables = deepcopy(rows if rows is not None else ROWS)
        self.queries: list[tuple[str, str]] = []
        self.rpcs: list[tuple[str, dict]] = []
        self.rpc_handlers: dict[str, Any] = {}

    def table(self, name):
        return Query(self, name)

    def rpc(self, name, params):
        self.rpcs.append((name, params))
        handler = self.rpc_handlers.get(name)
        data = handler(params) if handler else None
        return type("R", (), {"execute": lambda _self: Result(data)})()
