"""Paginated, read-only Super Admin access to persisted financial data."""

import re
from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from uuid import UUID

from fastapi import HTTPException, status

from app.core.supabase import supabase
from app.schemas.admin_financial import (
    AdminFinancialAuditCheck,
    AdminFinancialAuditRun,
    AdminFinancialAuditRunPage,
    AdminFinancialCurrencyAmount,
    AdminFinancialEmployer,
    AdminFinancialInvoice,
    AdminFinancialInvoiceDetail,
    AdminFinancialInvoiceItem,
    AdminFinancialInvoicePage,
    AdminFinancialOverview,
    AdminFinancialPayment,
    AdminFinancialPaymentPage,
    AdminFinancialVendor,
    AdminFinancialVendorDetail,
    AdminFinancialVendorBill,
    AdminFinancialVendorBillDetail,
    AdminFinancialVendorBillPage,
    AdminFinancialVendorPage,
)

FETCH_PAGE_SIZE = 500


def _rows(response: Any) -> list[dict[str, Any]]:
    data = getattr(response, "data", None)
    return data if isinstance(data, list) else ([data] if isinstance(data, dict) else [])


def _row(response: Any) -> dict[str, Any]:
    rows = _rows(response)
    return rows[0] if rows else {}


def _json_rows(response: Any) -> list[dict[str, Any]]:
    data = getattr(response, "data", None)
    if isinstance(data, list):
        return [row for row in data if isinstance(row, dict)]
    if isinstance(data, dict):
        return [data]
    return []


def _clean_search(value: str | None) -> str | None:
    if not value or not value.strip():
        return None
    cleaned = re.sub(r"[^a-zA-Z0-9 ._#-]", "", value).strip()
    return cleaned[:200] or None


def _page_response(model, rows, count, page, page_size):
    total = int(count or 0)
    return model(
        items=rows,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=(total + page_size - 1) // page_size if total else 0,
    )


class AdminFinancialService:
    """Read-only reporting queries; callers must authorize with ``require_admin``."""

    @staticmethod
    def _employers(employer_ids: list[str]) -> dict[str, AdminFinancialEmployer]:
        ids = list(dict.fromkeys(str(value) for value in employer_ids if value))
        if not ids:
            return {}
        profiles: list[dict[str, Any]] = []
        onboarding: list[dict[str, Any]] = []
        for start in range(0, len(ids), 100):
            chunk = ids[start:start + 100]
            profiles.extend(_rows(
                supabase.table("employer_profiles")
                .select("id, contact_person_name")
                .in_("id", chunk)
                .execute()
            ))
            onboarding.extend(_rows(
                supabase.table("employer_onboarding_details")
                .select("employer_id, business_name")
                .in_("employer_id", chunk)
                .execute()
            ))
        names = {
            str(row["employer_id"]): row.get("business_name")
            for row in onboarding
            if row.get("employer_id")
        }
        return {
            str(row["id"]): AdminFinancialEmployer(
                id=str(row["id"]),
                name=str(names.get(str(row["id"])) or row.get("contact_person_name") or "Employer"),
            )
            for row in profiles
        }

    @staticmethod
    def _matching_employers(search: str | None) -> list[str] | None:
        if not search or not search.strip():
            return None
        term = _clean_search(search)
        if not term:
            return []
        ids: set[str] = set()
        for table, id_column, name_column in (
            ("employer_profiles", "id", "contact_person_name"),
            ("employer_onboarding_details", "employer_id", "business_name"),
        ):
            offset = 0
            while True:
                rows = _rows(
                    supabase.table(table)
                    .select(id_column)
                    .ilike(name_column, f"%{term}%")
                    .order(id_column)
                    .range(offset, offset + FETCH_PAGE_SIZE - 1)
                    .execute()
                )
                ids.update(str(row[id_column]) for row in rows if row.get(id_column))
                if len(rows) < FETCH_PAGE_SIZE:
                    break
                offset += FETCH_PAGE_SIZE
        return sorted(ids)

    @staticmethod
    def _balances(invoice_ids: list[str]) -> dict[str, dict[str, Any]]:
        if not invoice_ids:
            return {}
        result = supabase.rpc(
            "admin_financial_invoice_balances",
            {"p_invoice_ids": invoice_ids},
        ).execute()
        return {
            str(row["invoice_id"]): row
            for row in _json_rows(result)
            if row.get("invoice_id")
        }

    @staticmethod
    def _vendor_stats(vendor_ids: list[str]) -> dict[str, dict[str, Any]]:
        if not vendor_ids:
            return {}
        result = supabase.rpc(
            "admin_financial_vendor_stats",
            {"p_vendor_ids": vendor_ids},
        ).execute()
        return {
            str(row["vendor_id"]): row
            for row in _json_rows(result)
            if row.get("vendor_id")
        }

    @classmethod
    def overview(cls) -> AdminFinancialOverview:
        result = supabase.rpc("admin_financial_overview", {}).execute()
        data = getattr(result, "data", None)
        if not isinstance(data, dict):
            raise ValueError("Financial overview RPC returned an invalid response")
        return AdminFinancialOverview.model_validate(data)

    @classmethod
    def list_invoices(
        cls,
        *,
        page: int,
        page_size: int,
        search: str | None,
        employer: str | None,
        employer_id: UUID | None,
        invoice_status: str | None,
        issue_date_from: date | None,
        issue_date_to: date | None,
        due_date_from: date | None,
        due_date_to: date | None,
    ) -> AdminFinancialInvoicePage:
        matching_ids = cls._matching_employers(employer)
        if matching_ids == []:
            return _page_response(AdminFinancialInvoicePage, [], 0, page, page_size)
        query = supabase.table("financial_invoices").select(
            "id, employer_id, invoice_number, client_name, issue_date, due_date, currency, "
            "status, subtotal, tax_rate, tax_amount, total, created_at",
            count="exact",
        )
        if employer_id:
            query = query.eq("employer_id", str(employer_id))
        if matching_ids is not None:
            query = query.in_("employer_id", matching_ids)
        term = _clean_search(search)
        if term:
            query = query.or_(
                f"invoice_number.ilike.%{term}%,client_name.ilike.%{term}%"
            )
        if invoice_status:
            query = query.eq("status", invoice_status)
        if issue_date_from:
            query = query.gte("issue_date", issue_date_from.isoformat())
        if issue_date_to:
            query = query.lte("issue_date", issue_date_to.isoformat())
        if due_date_from:
            query = query.gte("due_date", due_date_from.isoformat())
        if due_date_to:
            query = query.lte("due_date", due_date_to.isoformat())
        offset = (page - 1) * page_size
        response = (
            query.order("issue_date", desc=True)
            .order("created_at", desc=True)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows = _rows(response)
        employers = cls._employers([str(row["employer_id"]) for row in rows])
        balances = cls._balances([str(row["id"]) for row in rows if row.get("status") == "GENERATED"])
        items = [
            AdminFinancialInvoice(
                **{
                    field: row.get(field)
                    for field in (
                        "id", "invoice_number", "client_name", "issue_date", "due_date",
                        "currency", "status", "subtotal", "tax_rate", "tax_amount", "total",
                        "created_at",
                    )
                },
                employer=employers[str(row["employer_id"])],
                paid_amount=(balances.get(str(row["id"])) or {}).get("paid_amount", 0),
                outstanding_amount=(balances.get(str(row["id"])) or {}).get("outstanding_amount", 0),
                is_overdue=bool((balances.get(str(row["id"])) or {}).get("is_overdue", False)),
            )
            for row in rows
        ]
        return _page_response(AdminFinancialInvoicePage, items, response.count, page, page_size)

    @classmethod
    def get_invoice(cls, invoice_id: UUID) -> AdminFinancialInvoiceDetail:
        invoice = _row(
            supabase.table("financial_invoices")
            .select(
                "id, employer_id, invoice_number, client_name, issue_date, due_date, "
                "payment_terms_notes, currency, status, subtotal, tax_rate, tax_amount, "
                "total, created_at, updated_at"
            )
            .eq("id", str(invoice_id))
            .maybe_single()
            .execute()
        )
        if not invoice:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="FINANCIAL_INVOICE_NOT_FOUND")
        item_rows = _rows(
            supabase.table("financial_invoice_items")
            .select("id, description, quantity, unit_price, line_total")
            .eq("invoice_id", str(invoice_id))
            .order("created_at")
            .execute()
        )
        employer = cls._employers([str(invoice["employer_id"])])[str(invoice["employer_id"])]
        balance = cls._balances([str(invoice_id)]).get(str(invoice_id), {})
        base = AdminFinancialInvoice(
            **{
                field: invoice.get(field)
                for field in (
                    "id", "invoice_number", "client_name", "issue_date", "due_date", "currency",
                    "status", "subtotal", "tax_rate", "tax_amount", "total", "created_at",
                )
            },
            employer=employer,
            paid_amount=balance.get("paid_amount", 0),
            outstanding_amount=balance.get("outstanding_amount", 0),
            is_overdue=bool(balance.get("is_overdue", False)),
        )
        return AdminFinancialInvoiceDetail(
            **base.model_dump(),
            payment_terms_notes=invoice.get("payment_terms_notes") or "",
            updated_at=invoice["updated_at"],
            items=[AdminFinancialInvoiceItem.model_validate(row) for row in item_rows],
        )

    @classmethod
    def list_payments(
        cls,
        *,
        page: int,
        page_size: int,
        search: str | None,
        employer: str | None,
        employer_id: UUID | None,
        invoice_id: UUID | None,
        payment_date_from: date | None,
        payment_date_to: date | None,
    ) -> AdminFinancialPaymentPage:
        matching_ids = cls._matching_employers(employer)
        if matching_ids == []:
            return _page_response(AdminFinancialPaymentPage, [], 0, page, page_size)
        query = supabase.table("financial_invoice_payments").select(
            "id, invoice_id, employer_id, amount, payment_date, payment_reference, notes, created_at",
            count="exact",
        )
        if employer_id:
            query = query.eq("employer_id", str(employer_id))
        if invoice_id:
            query = query.eq("invoice_id", str(invoice_id))
        if matching_ids is not None:
            query = query.in_("employer_id", matching_ids)
        term = _clean_search(search)
        if term:
            query = query.ilike("payment_reference", f"%{term}%")
        if payment_date_from:
            query = query.gte("payment_date", payment_date_from.isoformat())
        if payment_date_to:
            query = query.lte("payment_date", payment_date_to.isoformat())
        offset = (page - 1) * page_size
        response = (
            query.order("payment_date", desc=True)
            .order("created_at", desc=True)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        payments = _rows(response)
        invoice_ids = list(dict.fromkeys(str(row["invoice_id"]) for row in payments))
        invoice_map: dict[str, dict[str, Any]] = {}
        for start in range(0, len(invoice_ids), 100):
            invoice_map.update({
                str(row["id"]): row
                for row in _rows(
                    supabase.table("financial_invoices")
                    .select("id, invoice_number, client_name, currency")
                    .in_("id", invoice_ids[start:start + 100])
                    .execute()
                )
            })
        employers = cls._employers([str(row["employer_id"]) for row in payments])
        items = []
        for row in payments:
            invoice = invoice_map.get(str(row["invoice_id"]))
            if not invoice:
                continue
            items.append(AdminFinancialPayment(
                id=str(row["id"]),
                employer=employers[str(row["employer_id"])],
                invoice_id=str(row["invoice_id"]),
                invoice_number=invoice["invoice_number"],
                client_name=invoice["client_name"],
                amount=row["amount"],
                currency=invoice["currency"],
                payment_date=row["payment_date"],
                payment_reference=row.get("payment_reference"),
                notes=row.get("notes") or "",
                created_at=row["created_at"],
            ))
        return _page_response(AdminFinancialPaymentPage, items, response.count, page, page_size)

    @classmethod
    def list_vendors(
        cls,
        *,
        page: int,
        page_size: int,
        search: str | None,
        employer: str | None,
        employer_id: UUID | None,
        active: bool | None,
    ) -> AdminFinancialVendorPage:
        matching_ids = cls._matching_employers(employer)
        if matching_ids == []:
            return _page_response(AdminFinancialVendorPage, [], 0, page, page_size)
        query = supabase.table("financial_vendors").select(
            "id, employer_id, vendor_name, contact_email, contact_phone, address, "
            "tax_identifier, is_active, created_at, updated_at",
            count="exact",
        )
        if employer_id:
            query = query.eq("employer_id", str(employer_id))
        if matching_ids is not None:
            query = query.in_("employer_id", matching_ids)
        term = _clean_search(search)
        if term:
            query = query.or_(
                f"vendor_name.ilike.%{term}%,contact_email.ilike.%{term}%,tax_identifier.ilike.%{term}%"
            )
        if active is not None:
            query = query.eq("is_active", active)
        offset = (page - 1) * page_size
        response = (
            query.order("vendor_name")
            .order("created_at", desc=True)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows = _rows(response)
        stats = cls._vendor_stats([str(row["id"]) for row in rows])
        employers = cls._employers([str(row["employer_id"]) for row in rows])
        items = []
        for row in rows:
            vendor_stats = stats.get(str(row["id"]), {})
            items.append(AdminFinancialVendor(
                id=str(row["id"]),
                employer=employers[str(row["employer_id"])],
                vendor_name=row["vendor_name"],
                contact_email=row.get("contact_email"),
                contact_phone=row.get("contact_phone"),
                address=row.get("address"),
                tax_identifier=row.get("tax_identifier"),
                is_active=row["is_active"],
                created_at=row["created_at"],
                updated_at=row["updated_at"],
                bill_count=int(vendor_stats.get("bill_count", 0)),
                bill_totals_by_currency=[
                    AdminFinancialCurrencyAmount.model_validate(total)
                    for total in vendor_stats.get("bill_totals_by_currency", [])
                ],
            ))
        return _page_response(AdminFinancialVendorPage, items, response.count, page, page_size)

    @classmethod
    def get_vendor(
        cls,
        vendor_id: UUID,
        *,
        bill_page: int = 1,
        bill_page_size: int = 25,
    ) -> AdminFinancialVendorDetail:
        vendor = _row(
            supabase.table("financial_vendors")
            .select(
                "id, employer_id, vendor_name, contact_email, contact_phone, address, "
                "tax_identifier, is_active, created_at, updated_at"
            )
            .eq("id", str(vendor_id))
            .maybe_single()
            .execute()
        )
        if not vendor:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="FINANCIAL_VENDOR_NOT_FOUND")
        stats = cls._vendor_stats([str(vendor_id)]).get(str(vendor_id), {})
        bills = cls.list_vendor_bills(
            page=bill_page,
            page_size=bill_page_size,
            search=None,
            employer=None,
            employer_id=None,
            vendor_id=vendor_id,
            unassigned=None,
            confirmed_from=None,
            confirmed_to=None,
        )
        base = AdminFinancialVendor(
            id=str(vendor["id"]),
            employer=cls._employers([str(vendor["employer_id"])])[str(vendor["employer_id"])],
            vendor_name=vendor["vendor_name"],
            contact_email=vendor.get("contact_email"),
            contact_phone=vendor.get("contact_phone"),
            address=vendor.get("address"),
            tax_identifier=vendor.get("tax_identifier"),
            is_active=vendor["is_active"],
            created_at=vendor["created_at"],
            updated_at=vendor["updated_at"],
            bill_count=int(stats.get("bill_count", 0)),
            bill_totals_by_currency=[
                AdminFinancialCurrencyAmount.model_validate(total)
                for total in stats.get("bill_totals_by_currency", [])
            ],
        )
        return AdminFinancialVendorDetail(
            **base.model_dump(),
            bills=bills.items,
            bill_page=bills.page,
            bill_page_size=bills.page_size,
            bill_total_pages=bills.total_pages,
        )

    @classmethod
    def list_vendor_bills(
        cls,
        *,
        page: int,
        page_size: int,
        search: str | None,
        employer: str | None,
        employer_id: UUID | None,
        vendor_id: UUID | None,
        unassigned: bool | None,
        confirmed_from: date | None,
        confirmed_to: date | None,
    ) -> AdminFinancialVendorBillPage:
        matching_ids = cls._matching_employers(employer)
        if matching_ids == []:
            return _page_response(AdminFinancialVendorBillPage, [], 0, page, page_size)
        query = supabase.table("financial_vendor_bills").select(
            "id, employer_id, vendor_id, vendor_name, bill_number, bill_date, due_date, "
            "currency, subtotal, tax_amount, total, confirmed_at",
            count="exact",
        )
        if employer_id:
            query = query.eq("employer_id", str(employer_id))
        if matching_ids is not None:
            query = query.in_("employer_id", matching_ids)
        if vendor_id:
            query = query.eq("vendor_id", str(vendor_id))
        elif unassigned:
            query = query.is_("vendor_id", "null")
        term = _clean_search(search)
        if term:
            query = query.or_(f"vendor_name.ilike.%{term}%,bill_number.ilike.%{term}%")
        if confirmed_from:
            query = query.gte("confirmed_at", datetime.combine(confirmed_from, time.min, timezone.utc).isoformat())
        if confirmed_to:
            end = datetime.combine(confirmed_to + timedelta(days=1), time.min, timezone.utc)
            query = query.lt("confirmed_at", end.isoformat())
        offset = (page - 1) * page_size
        response = (
            query.order("confirmed_at", desc=True)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows = _rows(response)
        employers = cls._employers([str(row["employer_id"]) for row in rows])
        items = [
            AdminFinancialVendorBill(
                **{
                    field: row.get(field)
                    for field in (
                        "id", "vendor_id", "vendor_name", "bill_number", "bill_date",
                        "due_date", "currency", "subtotal", "tax_amount", "total", "confirmed_at",
                    )
                },
                employer=employers[str(row["employer_id"])],
                is_assigned=row.get("vendor_id") is not None,
            )
            for row in rows
        ]
        return _page_response(AdminFinancialVendorBillPage, items, response.count, page, page_size)

    @classmethod
    def get_vendor_bill(cls, bill_id: UUID) -> AdminFinancialVendorBillDetail:
        bill = _row(
            supabase.table("financial_vendor_bills")
            .select(
                "id, employer_id, vendor_id, vendor_name, bill_number, bill_date, due_date, "
                "currency, subtotal, tax_amount, total, line_items, confirmed_at"
            )
            .eq("id", str(bill_id))
            .maybe_single()
            .execute()
        )
        if not bill:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="FINANCIAL_VENDOR_BILL_NOT_FOUND")
        return AdminFinancialVendorBillDetail(
            **{
                field: bill.get(field)
                for field in (
                    "id", "vendor_id", "vendor_name", "bill_number", "bill_date", "due_date",
                    "currency", "subtotal", "tax_amount", "total", "confirmed_at",
                )
            },
            employer=cls._employers([str(bill["employer_id"])])[str(bill["employer_id"])],
            is_assigned=bill.get("vendor_id") is not None,
            line_items=bill.get("line_items") or [],
        )

    @classmethod
    def list_audit_runs(
        cls,
        *,
        page: int,
        page_size: int,
        employer: str | None,
        employer_id: UUID | None,
        run_status: str | None,
        started_from: date | None,
        started_to: date | None,
    ) -> AdminFinancialAuditRunPage:
        matching_ids = cls._matching_employers(employer)
        if matching_ids == []:
            return _page_response(AdminFinancialAuditRunPage, [], 0, page, page_size)
        query = supabase.table("financial_audit_runs").select(
            "id, employer_id, status, started_at, completed_at, total_checks, passed_checks, "
            "failed_checks, not_applicable_checks, pass_rate, summary, error_message",
            count="exact",
        )
        if employer_id:
            query = query.eq("employer_id", str(employer_id))
        if matching_ids is not None:
            query = query.in_("employer_id", matching_ids)
        if run_status:
            query = query.eq("status", run_status)
        if started_from:
            query = query.gte("started_at", datetime.combine(started_from, time.min, timezone.utc).isoformat())
        if started_to:
            query = query.lt(
                "started_at",
                datetime.combine(started_to + timedelta(days=1), time.min, timezone.utc).isoformat(),
            )
        offset = (page - 1) * page_size
        response = (
            query.order("started_at", desc=True)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows = _rows(response)
        employers = cls._employers([str(row["employer_id"]) for row in rows])
        items = [
            AdminFinancialAuditRun(
                **{
                    field: row.get(field)
                    for field in (
                        "id", "status", "started_at", "completed_at", "total_checks",
                        "passed_checks", "failed_checks", "not_applicable_checks", "pass_rate",
                        "summary", "error_message",
                    )
                },
                employer=employers[str(row["employer_id"])],
            )
            for row in rows
        ]
        return _page_response(AdminFinancialAuditRunPage, items, response.count, page, page_size)

    @classmethod
    def get_audit_run(cls, run_id: UUID) -> AdminFinancialAuditRun:
        run = _row(
            supabase.table("financial_audit_runs")
            .select(
                "id, employer_id, status, started_at, completed_at, total_checks, passed_checks, "
                "failed_checks, not_applicable_checks, pass_rate, summary, error_message"
            )
            .eq("id", str(run_id))
            .maybe_single()
            .execute()
        )
        if not run:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="FINANCIAL_AUDIT_RUN_NOT_FOUND")
        checks: list[dict[str, Any]] = []
        offset = 0
        while True:
            page = _rows(
                supabase.table("financial_audit_check_results")
                .select(
                    "id, check_id, title, result, explanation, entity_type, entity_id, findings, checked_at"
                )
                .eq("run_id", str(run_id))
                .eq("employer_id", str(run["employer_id"]))
                .order("checked_at")
                .order("check_id")
                .range(offset, offset + FETCH_PAGE_SIZE - 1)
                .execute()
            )
            checks.extend(page)
            if len(page) < FETCH_PAGE_SIZE:
                break
            offset += FETCH_PAGE_SIZE
        return AdminFinancialAuditRun(
            **{
                field: run.get(field)
                for field in (
                    "id", "status", "started_at", "completed_at", "total_checks", "passed_checks",
                    "failed_checks", "not_applicable_checks", "pass_rate", "summary", "error_message",
                )
            },
            employer=cls._employers([str(run["employer_id"])])[str(run["employer_id"])],
            checks=[AdminFinancialAuditCheck.model_validate(check) for check in checks],
        )
