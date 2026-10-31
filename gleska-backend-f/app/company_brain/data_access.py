"""Read-only, tenant-scoped data access for Company Brain tools.

There is no free-form query path: callers pass a fixed table name from `ALLOWED_TABLES`, a column
list from the same allowlist and simple filters. The organisation filter is added here from the
server-side context, so a tool cannot forget it and the model can never choose it.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any, Iterable

from app.core.supabase import supabase

logger = logging.getLogger(__name__)

PAGE = 1000
MAX_ROWS = 5000

# table -> (organisation column or None for shared lookup tables, allowed columns)
ALLOWED_TABLES: dict[str, tuple[str | None, frozenset[str]]] = {
    "jobs": ("employer_id", frozenset({
        "id", "title", "status", "headcount_required", "max_daily_salary", "monthly_salary",
        "job_site_id", "work_duration_days", "created_at", "updated_at"})),
    "job_sites": ("employer_id", frozenset({"id", "name", "city", "state", "updated_at"})),
    "job_matches": (None, frozenset({  # scoped through job ids of the organisation
        "id", "job_id", "worker_profile_id", "status", "created_at", "started_at", "completed_at"})),
    "attendance": ("employer_id", frozenset({
        "id", "job_id", "job_match_id", "worker_profile_id", "attendance_date", "status",
        "check_in_at", "check_out_at", "updated_at"})),
    "worker_profiles": (None, frozenset({"id", "user_id", "trade_id", "expected_daily_wage"})),
    "users": (None, frozenset({"id", "name"})),
    "payment_transactions": ("employer_id", frozenset({
        "id", "order_id", "amount", "currency", "status", "payment_category", "payment_success_at",
        "created_at", "updated_at"})),
    "financial_invoices": ("employer_id", frozenset({
        "id", "invoice_number", "client_name", "issue_date", "due_date", "currency", "subtotal",
        "tax_amount", "total", "status", "updated_at"})),
    "financial_invoice_payments": ("employer_id", frozenset({"id", "invoice_id", "amount", "payment_date", "created_at"})),
    "financial_vendor_bills": ("employer_id", frozenset({
        "id", "vendor_name", "vendor_id", "bill_number", "bill_date", "due_date", "currency", "subtotal",
        "tax_amount", "total", "confirmed_at"})),
    "financial_audit_runs": ("employer_id", frozenset({"id", "status", "summary", "started_at", "completed_at"})),
    "procurement_purchase_orders": ("employer_id", frozenset({
        "id", "order_reference", "supplier_company_id", "item_name", "quantity", "unit", "unit_price",
        "currency", "status", "created_at", "updated_at", "dispatch_date", "estimated_delivery_date",
        "delivery_date", "delivered_quantity"})),
    "procurement_rfqs": ("employer_id", frozenset({"id", "item_name", "status", "quotation_deadline", "created_at", "updated_at"})),
    "supplier_companies": (None, frozenset({"id", "name"})),
    "credit_wallets": (None, frozenset({"account_id", "available", "reserved", "total_consumed", "updated_at"})),
    "ai_usage_events": (None, frozenset({"id", "account_id", "executing_agent", "status", "credits_charged", "started_at"})),
    "credit_purchase_orders": (None, frozenset({"id", "account_id", "order_id", "credits", "amount_inr", "status", "paid_at"})),
    "employer_onboarding_details": ("employer_id", frozenset({
        "business_name", "business_type", "industry_category", "industry_type", "city", "state", "updated_at"})),
    "logistics_vehicle_listings": ("employer_id", frozenset({
        "id", "category", "vehicle_type", "status", "price_amount", "price_unit", "currency", "available_from",
        "available_until", "location", "created_at", "updated_at"})),
    "logistics_rental_requests": ("employer_id", frozenset({
        "id", "vehicle_title", "category", "source_location", "destination_location", "pickup_date", "offered_price",
        "price_unit", "currency", "status", "created_at", "updated_at"})),
}

Filter = tuple[str, str, Any]  # (op, column, value) with op in eq|in|gte|lt|lte|neq


class DataAccessError(Exception):
    pass


@dataclass
class Rows:
    table: str
    rows: list[dict[str, Any]]
    truncated: bool
    duration_ms: int


def _check(table: str, columns: Iterable[str]) -> tuple[str | None, frozenset[str]]:
    if table not in ALLOWED_TABLES:
        raise DataAccessError(f"TABLE_NOT_ALLOWED:{table}")
    org_column, allowed = ALLOWED_TABLES[table]
    bad = [c for c in columns if c not in allowed]
    if bad:
        raise DataAccessError(f"COLUMN_NOT_ALLOWED:{table}.{bad[0]}")
    return org_column, allowed


def fetch(
    table: str,
    columns: list[str],
    *,
    employer_id: str | None,
    filters: list[Filter] = (),
    order: tuple[str, bool] | None = None,
    max_rows: int = MAX_ROWS,
) -> Rows:
    """Read rows. Tables with an organisation column REQUIRE `employer_id` and are filtered by it.

    Shared tables (no organisation column) may only be read with an `in` filter on ids that the
    caller obtained from organisation-filtered rows.
    """
    org_column, _ = _check(table, columns + [f[1] for f in filters] + ([order[0]] if order else []))
    if org_column and not employer_id:
        raise DataAccessError("ORGANISATION_REQUIRED")
    if not org_column and not any(op == "in" or (op == "eq" and col in ("account_id", "id")) for op, col, _ in filters):
        raise DataAccessError(f"SHARED_TABLE_NEEDS_ID_FILTER:{table}")
    started = time.monotonic()
    rows: list[dict[str, Any]] = []
    offset = 0
    truncated = False
    while True:
        query = supabase.table(table).select(",".join(columns))
        if org_column:
            query = query.eq(org_column, employer_id)
        for op, column, value in filters:
            if op == "in":
                values = list(value)
                if not values:
                    return Rows(table, [], False, 0)
                query = query.in_(column, values)
            elif op in ("eq", "gte", "lt", "lte", "neq"):
                query = getattr(query, op)(column, value)
            else:
                raise DataAccessError(f"FILTER_NOT_ALLOWED:{op}")
        if order:
            query = query.order(order[0], desc=order[1])
        page = getattr(query.range(offset, offset + PAGE - 1).execute(), "data", None) or []
        rows.extend(page)
        if len(rows) >= max_rows:
            truncated = len(page) == PAGE or len(rows) > max_rows
            rows = rows[:max_rows]
            break
        if len(page) < PAGE:
            break
        offset += PAGE
    duration = int((time.monotonic() - started) * 1000)
    logger.info("company_brain.fetch table=%s rows=%s truncated=%s ms=%s", table, len(rows), truncated, duration)
    return Rows(table, rows, truncated, duration)
