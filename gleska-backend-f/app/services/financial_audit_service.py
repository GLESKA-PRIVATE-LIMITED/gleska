"""Persisted financial data checks, separate from financial action history."""

from collections import defaultdict
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import logging
from typing import Any
from uuid import UUID

from app.core.supabase import supabase
from app.schemas.auth import UserResponse
from app.schemas.financial import (
    FinancialAuditCheckResult,
    FinancialAuditRun,
    FinancialAuditRunsResponse,
)
from app.services.financial_service import (
    FinancialConflict,
    FinancialNotFound,
    FinancialService,
    FinancialServiceError,
    _row,
    _rows,
)

logger = logging.getLogger(__name__)
PAGE_SIZE = 500
RESULT_BATCH_SIZE = 200
CENT = Decimal("0.01")
RUN_COLUMNS = (
    "id, status, started_at, completed_at, total_checks, passed_checks, failed_checks, "
    "not_applicable_checks, pass_rate, summary, error_message"
)
CHECK_COLUMNS = (
    "id, check_id, title, result, explanation, entity_type, entity_id, findings, checked_at"
)


def _decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return None


def _money(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def _checked_at() -> str:
    return datetime.now(timezone.utc).isoformat()


def _check(
    check_id: str,
    title: str,
    result: str,
    explanation: str,
    *,
    entity_type: str | None = None,
    entity_id: str | None = None,
    findings: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "check_id": check_id,
        "title": title,
        "result": result,
        "explanation": explanation,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "findings": findings or [],
        "checked_at": _checked_at(),
    }


def _fetch_owned(table: str, columns: str, user_id: str, employer_id: str) -> list[dict[str, Any]]:
    query = (
        supabase.table(table)
        .select(columns)
        .eq("user_id", user_id)
        .eq("employer_id", employer_id)
        .order("id")
    )
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        page = _rows(query.range(offset, offset + PAGE_SIZE - 1).execute())
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            return rows
        offset += PAGE_SIZE


class FinancialAuditService:
    @staticmethod
    def _run_response(row: dict[str, Any], checks: list[dict[str, Any]] | None = None) -> FinancialAuditRun:
        values = {field: row.get(field) for field in RUN_COLUMNS.split(", ")}
        parsed_checks = [
            FinancialAuditCheckResult.model_validate({
                field: check.get(field)
                for field in CHECK_COLUMNS.split(", ")
            })
            for check in checks or []
        ]
        return FinancialAuditRun.model_validate({**values, "checks": parsed_checks})

    @classmethod
    def list_runs(cls, user: UserResponse) -> FinancialAuditRunsResponse:
        user_id, employer_id = FinancialService._employer_scope(user)
        try:
            rows: list[dict[str, Any]] = []
            offset = 0
            while True:
                page = _rows(
                    supabase.table("financial_audit_runs")
                    .select(RUN_COLUMNS)
                    .eq("user_id", user_id)
                    .eq("employer_id", employer_id)
                    .order("started_at", desc=True)
                    .range(offset, offset + 99)
                    .execute()
                )
                rows.extend(page)
                if len(page) < 100:
                    break
                offset += 100
            return FinancialAuditRunsResponse(runs=[cls._run_response(row) for row in rows])
        except Exception as exc:
            logger.error(
                "Financial audit run history load failed: user_id=%s exception_type=%s",
                user_id,
                type(exc).__name__,
            )
            raise FinancialServiceError("FINANCIAL_AUDIT_RUNS_LOAD_FAILED") from exc

    @classmethod
    def get_run(cls, user: UserResponse, run_id: UUID) -> FinancialAuditRun:
        user_id, employer_id = FinancialService._employer_scope(user)
        try:
            run_row = _row(
                supabase.table("financial_audit_runs")
                .select(RUN_COLUMNS)
                .eq("id", str(run_id))
                .eq("user_id", user_id)
                .eq("employer_id", employer_id)
                .maybe_single()
                .execute()
            )
            if not run_row:
                raise FinancialNotFound("FINANCIAL_AUDIT_RUN_NOT_FOUND")
            checks: list[dict[str, Any]] = []
            offset = 0
            while True:
                page = _rows(
                    supabase.table("financial_audit_check_results")
                    .select(CHECK_COLUMNS)
                    .eq("run_id", str(run_id))
                    .eq("user_id", user_id)
                    .eq("employer_id", employer_id)
                    .order("checked_at")
                    .order("check_id")
                    .range(offset, offset + PAGE_SIZE - 1)
                    .execute()
                )
                checks.extend(page)
                if len(page) < PAGE_SIZE:
                    break
                offset += PAGE_SIZE
            return cls._run_response(run_row, checks)
        except FinancialNotFound:
            raise
        except Exception as exc:
            logger.error(
                "Financial audit run detail load failed: user_id=%s run_id=%s exception_type=%s",
                user_id,
                run_id,
                type(exc).__name__,
            )
            raise FinancialServiceError("FINANCIAL_AUDIT_RUN_LOAD_FAILED") from exc

    @classmethod
    def start_run(cls, user: UserResponse, idempotency_key: UUID) -> FinancialAuditRun:
        user_id, employer_id = FinancialService._employer_scope(user)
        try:
            start_response = _row(
                supabase.rpc(
                    "start_financial_audit_run",
                    {
                        "p_user_id": user_id,
                        "p_employer_id": employer_id,
                        "p_idempotency_key": str(idempotency_key),
                    },
                ).execute()
            )
            run_row = start_response.get("run", start_response)
            if not run_row.get("id"):
                raise ValueError("Financial audit start RPC returned no run")
        except Exception as exc:
            if "financial_audit_runs_one_running_per_employer" in str(exc):
                raise FinancialConflict("FINANCIAL_AUDIT_ALREADY_RUNNING") from exc
            if "FINANCIAL_AUDIT_IDEMPOTENCY_KEY_REUSED" in str(exc):
                raise FinancialConflict("FINANCIAL_AUDIT_IDEMPOTENCY_KEY_REUSED") from exc
            logger.error(
                "Financial audit run start failed: user_id=%s exception_type=%s",
                user_id,
                type(exc).__name__,
            )
            raise FinancialServiceError("FINANCIAL_AUDIT_RUN_START_FAILED") from exc

        run_id = str(run_row["id"])
        if start_response.get("created") is False:
            return cls.get_run(user, UUID(run_id))
        results: list[dict[str, Any]] = []
        try:
            cls._collect_checks(user_id, employer_id, results)
            cls._persist_results(user_id, employer_id, run_id, results)
        except Exception as exc:
            logger.error(
                "Financial audit checks failed: user_id=%s run_id=%s exception_type=%s",
                user_id,
                run_id,
                type(exc).__name__,
            )
            cls._finish(user_id, employer_id, run_id, "FAILED", [], "Financial data checks could not finish.")
            return cls.get_run(user, UUID(run_id))

        try:
            cls._finish(user_id, employer_id, run_id, "COMPLETED", [], None)
        except Exception as exc:
            logger.error(
                "Financial audit run completion failed: user_id=%s run_id=%s exception_type=%s",
                user_id,
                run_id,
                type(exc).__name__,
            )
            try:
                existing = cls.get_run(user, UUID(run_id))
                if existing.status != "RUNNING":
                    return existing
            except FinancialServiceError:
                pass
            cls._finish(user_id, employer_id, run_id, "FAILED", [], "Audit results could not be finalized.")
        return cls.get_run(user, UUID(run_id))

    @staticmethod
    def _persist_results(
        user_id: str,
        employer_id: str,
        run_id: str,
        results: list[dict[str, Any]],
    ) -> None:
        for offset in range(0, len(results), RESULT_BATCH_SIZE):
            batch = results[offset : offset + RESULT_BATCH_SIZE]
            try:
                supabase.rpc(
                    "save_financial_audit_check_results",
                    {
                        "p_run_id": run_id,
                        "p_user_id": user_id,
                        "p_employer_id": employer_id,
                        "p_results": batch,
                    },
                ).execute()
            except Exception as exc:
                logger.error(
                    "Financial audit check batch could not be persisted: run_id=%s batch_offset=%s exception_type=%s",
                    run_id,
                    offset,
                    type(exc).__name__,
                )
                raise FinancialServiceError("FINANCIAL_AUDIT_CHECKS_SAVE_FAILED") from exc

    @staticmethod
    def _finish(
        user_id: str,
        employer_id: str,
        run_id: str,
        run_status: str,
        results: list[dict[str, Any]],
        error_message: str | None,
    ) -> None:
        try:
            supabase.rpc(
                "finish_financial_audit_run",
                {
                    "p_run_id": run_id,
                    "p_user_id": user_id,
                    "p_employer_id": employer_id,
                    "p_status": run_status,
                    "p_results": results,
                    "p_error_message": error_message,
                },
            ).execute()
        except Exception as exc:
            logger.error(
                "Financial audit results could not be persisted: run_id=%s status=%s exception_type=%s",
                run_id,
                run_status,
                type(exc).__name__,
            )
            raise FinancialServiceError("FINANCIAL_AUDIT_RUN_FINALIZE_FAILED") from exc

    @classmethod
    def _collect_checks(
        cls,
        user_id: str,
        employer_id: str,
        results: list[dict[str, Any]],
    ) -> None:
        invoices = _fetch_owned(
            "financial_invoices",
            "id, invoice_number, client_name, issue_date, due_date, currency, tax_rate, subtotal, tax_amount, total, status",
            user_id,
            employer_id,
        )
        items = _fetch_owned(
            "financial_invoice_items",
            "id, invoice_id, description, quantity, unit_price, line_total",
            user_id,
            employer_id,
        )
        payments = _fetch_owned(
            "financial_invoice_payments",
            "id, invoice_id, amount, payment_date",
            user_id,
            employer_id,
        )
        bills = _fetch_owned(
            "financial_vendor_bills",
            "id, vendor_id, vendor_name, bill_number, bill_date, currency, line_items, subtotal, tax_amount, total",
            user_id,
            employer_id,
        )
        vendors = _fetch_owned("financial_vendors", "id", user_id, employer_id)
        items_by_invoice: dict[str, list[dict[str, Any]]] = defaultdict(list)
        payments_by_invoice: dict[str, list[dict[str, Any]]] = defaultdict(list)
        vendor_ids = {str(vendor["id"]) for vendor in vendors}
        for item in items:
            items_by_invoice[str(item["invoice_id"])].append(item)
        for payment in payments:
            payments_by_invoice[str(payment["invoice_id"])].append(payment)

        for invoice in invoices:
            invoice_id = str(invoice["id"])
            invoice_items = items_by_invoice[invoice_id]
            generated = invoice.get("status") == "GENERATED"
            item_findings = []
            if not invoice_items:
                item_result = "FAIL" if generated else "NOT_APPLICABLE"
                item_findings.append({"field": "line_items", "issue": "No line items are stored."})
            else:
                line_total_values = [_decimal(item.get("line_total")) for item in invoice_items]
                if any(value is None or value < 0 for value in line_total_values):
                    item_result = "FAIL"
                    item_findings.append({"field": "line_total", "issue": "A line item has a missing or negative amount."})
                else:
                    item_sum = _money(sum(
                        (value for value in line_total_values if value is not None),
                        Decimal("0"),
                    ))
                    subtotal = _decimal(invoice.get("subtotal"))
                    item_result = "PASS" if subtotal is not None and item_sum == _money(subtotal) else "FAIL"
                    if item_result == "FAIL":
                        item_findings.append({
                            "field": "subtotal",
                            "stored": str(subtotal),
                            "line_items_sum": str(item_sum),
                        })
            results.append(_check(
                "invoice_line_items_subtotal",
                "Invoice line items match subtotal",
                item_result,
                "Compares the persisted sum of line-item amounts with the stored invoice subtotal.",
                entity_type="invoice",
                entity_id=invoice_id,
                findings=item_findings,
            ))

            subtotal = _decimal(invoice.get("subtotal"))
            tax_amount = _decimal(invoice.get("tax_amount"))
            total = _decimal(invoice.get("total"))
            arithmetic_findings = []
            if subtotal is None or tax_amount is None or total is None:
                arithmetic_result = "FAIL"
                arithmetic_findings.append({"field": "amounts", "issue": "Subtotal, tax amount, and total are required."})
            else:
                expected_total = _money(subtotal + tax_amount)
                arithmetic_result = "PASS" if _money(total) == expected_total else "FAIL"
                if arithmetic_result == "FAIL":
                    arithmetic_findings.append({
                        "field": "total",
                        "stored": str(total),
                        "subtotal_plus_tax": str(expected_total),
                    })
            results.append(_check(
                "invoice_total_matches_subtotal_and_tax",
                "Invoice total matches subtotal plus tax",
                arithmetic_result,
                "Rechecks persisted arithmetic; database constraints enforce this for newly written invoices, so failures may indicate legacy or out-of-band data.",
                entity_type="invoice",
                entity_id=invoice_id,
                findings=arithmetic_findings,
            ))

            if generated:
                missing = [
                    field for field in ("invoice_number", "client_name", "issue_date", "due_date", "currency")
                    if not str(invoice.get(field) or "").strip()
                ]
                amount_values = {
                    "tax_rate": _decimal(invoice.get("tax_rate")),
                    "subtotal": subtotal,
                    "tax_amount": tax_amount,
                    "total": total,
                }
                invalid_amounts = [
                    field for field, value in amount_values.items()
                    if value is None or value < 0
                ]
                if amount_values["tax_rate"] is not None and amount_values["tax_rate"] > 100:
                    invalid_amounts.append("tax_rate")
                if invoice.get("currency") not in {"INR", "USD", "EUR"}:
                    invalid_amounts.append("currency")
                try:
                    issue_date = date.fromisoformat(str(invoice.get("issue_date")))
                    due_date = date.fromisoformat(str(invoice.get("due_date")))
                    if due_date < issue_date:
                        invalid_amounts.append("due_date")
                except (TypeError, ValueError):
                    invalid_amounts.append("issue_date_or_due_date")
                if missing or invalid_amounts:
                    generated_result = "FAIL"
                    generated_findings = [
                        {"field": field, "issue": "Required generated invoice field is missing."}
                        for field in missing
                    ] + [
                        {"field": field, "issue": "Amount or tax rate is invalid."}
                        for field in sorted(set(invalid_amounts))
                    ]
                else:
                    generated_result = "PASS"
                    generated_findings = []
            else:
                generated_result = "NOT_APPLICABLE"
                generated_findings = [{"field": "status", "value": "DRAFT", "issue": "Required-field validation applies to generated invoices."}]
            results.append(_check(
                "generated_invoice_required_fields",
                "Generated invoice fields and amounts",
                generated_result,
                "Checks generated invoices for required identifying, date, currency, amount, and tax-rate values.",
                entity_type="invoice",
                entity_id=invoice_id,
                findings=generated_findings,
            ))

            invoice_payments = payments_by_invoice[invoice_id]
            if not generated:
                payment_result = "FAIL" if invoice_payments else "NOT_APPLICABLE"
                payment_findings = (
                    [{
                        "payment_id": str(payment["id"]),
                        "issue": "A payment is recorded against a draft invoice.",
                    } for payment in invoice_payments]
                    if invoice_payments
                    else [{"field": "status", "value": "DRAFT", "issue": "Receivables validation applies to generated invoices."}]
                )
            else:
                payment_findings = []
                invalid_payments = []
                for payment in invoice_payments:
                    payment_amount = _decimal(payment.get("amount"))
                    try:
                        date.fromisoformat(str(payment.get("payment_date")))
                        payment_date_valid = True
                    except (TypeError, ValueError):
                        payment_date_valid = False
                    if payment_amount is None or payment_amount <= 0 or not payment_date_valid:
                        invalid_payments.append(payment)
                if invalid_payments:
                    payment_findings.extend({
                        "payment_id": str(payment["id"]),
                        "amount": str(payment.get("amount")),
                        "payment_date": str(payment.get("payment_date")),
                        "issue": "Payment amount or date is invalid.",
                    } for payment in invalid_payments)
                paid_amount = sum(
                    (_decimal(payment.get("amount")) or Decimal("0") for payment in invoice_payments),
                    Decimal("0"),
                )
                outstanding = (total or Decimal("0")) - paid_amount
                if total is None:
                    payment_findings.append({"field": "invoice_total", "issue": "Cannot derive outstanding balance without invoice total."})
                elif outstanding < 0:
                    payment_findings.append({
                        "field": "outstanding_amount",
                        "invoice_total": str(total),
                        "paid_amount": str(paid_amount),
                        "outstanding_amount": str(outstanding),
                        "issue": "Recorded payments exceed invoice total.",
                    })
                payment_result = "FAIL" if payment_findings else "PASS"
            results.append(_check(
                "invoice_payment_ledger_consistency",
                "Payment ledger and receivable balance",
                payment_result,
                "Recomputes paid amount from persisted payments and outstanding as invoice total minus that sum. No separate stored balance exists; validates positive ledger amounts and prevents negative derived balances.",
                entity_type="invoice",
                entity_id=invoice_id,
                findings=payment_findings,
            ))

        for bill in bills:
            bill_id = str(bill["id"])
            line_items = bill.get("line_items")
            line_amounts = (
                [_decimal(item.get("total")) for item in line_items]
                if isinstance(line_items, list) and all(isinstance(item, dict) for item in line_items)
                else []
            )
            if any(value is not None and value < 0 for value in line_amounts):
                line_result = "FAIL"
                line_findings = [{
                    "field": "line_items",
                    "issue": "A scanned line-item total is negative.",
                }]
            elif (
                not isinstance(line_items, list)
                or not line_items
                or len(line_amounts) != len(line_items)
                or any(value is None for value in line_amounts)
            ):
                line_result = "NOT_APPLICABLE"
                line_findings = [{
                    "field": "line_items",
                    "issue": "Scanned line-item totals are missing or incomplete; no subtotal comparison was made.",
                }]
            else:
                line_sum = _money(sum(
                    (value for value in line_amounts if value is not None),
                    Decimal("0"),
                ))
                bill_subtotal = _decimal(bill.get("subtotal"))
                if bill_subtotal is None:
                    line_result = "NOT_APPLICABLE"
                    line_findings = [{"field": "subtotal", "issue": "OCR subtotal is unavailable; comparison was skipped."}]
                else:
                    line_result = "PASS" if line_sum == _money(bill_subtotal) else "FAIL"
                    line_findings = [] if line_result == "PASS" else [{
                        "field": "subtotal",
                        "stored": str(bill_subtotal),
                        "line_items_sum": str(line_sum),
                        "issue": "Scanned line-item sum does not match stored subtotal.",
                    }]
            results.append(_check(
                "vendor_bill_line_items_subtotal",
                "Vendor bill line items match subtotal",
                line_result,
                "Compares extracted line-item totals with stored subtotal only when every line item has an amount.",
                entity_type="vendor_bill",
                entity_id=bill_id,
                findings=line_findings,
            ))

            bill_subtotal = _decimal(bill.get("subtotal"))
            bill_tax = _decimal(bill.get("tax_amount"))
            bill_total = _decimal(bill.get("total"))
            if bill_subtotal is None or bill_tax is None or bill_total is None:
                total_result = "NOT_APPLICABLE"
                absent = [
                    field for field, value in (
                        ("subtotal", bill_subtotal),
                        ("tax_amount", bill_tax),
                        ("total", bill_total),
                    ) if value is None
                ]
                total_findings = [{"field": field, "issue": "OCR value is unavailable; arithmetic comparison was skipped."} for field in absent]
            else:
                expected = _money(bill_subtotal + bill_tax)
                invalid_bill_amounts = {
                    field: str(value)
                    for field, value in (
                        ("subtotal", bill_subtotal),
                        ("tax_amount", bill_tax),
                        ("total", bill_total),
                    )
                    if value < 0
                }
                total_result = (
                    "FAIL"
                    if invalid_bill_amounts or _money(bill_total) != expected
                    else "PASS"
                )
                total_findings = ([{
                    "issue": "Stored bill amount is negative.",
                    **invalid_bill_amounts,
                }] if invalid_bill_amounts else []) + ([] if _money(bill_total) == expected else [{
                    "field": "total",
                    "stored": str(bill_total),
                    "subtotal_plus_tax": str(expected),
                }])
            results.append(_check(
                "vendor_bill_total_matches_subtotal_and_tax",
                "Vendor bill total matches subtotal plus tax",
                total_result,
                "Checks stored bill arithmetic only when subtotal, tax, and total were all extracted.",
                entity_type="vendor_bill",
                entity_id=bill_id,
                findings=total_findings,
            ))

            completeness_fields = ("vendor_name", "bill_number", "bill_date", "currency", "total")
            missing_fields = [field for field in completeness_fields if bill.get(field) is None or not str(bill.get(field)).strip()]
            results.append(_check(
                "vendor_bill_extracted_field_completeness",
                "Vendor bill extracted field completeness",
                "NOT_APPLICABLE" if missing_fields else "PASS",
                "Reports missing key OCR fields as informational findings; nullable extraction fields are not automatically treated as accounting failures.",
                entity_type="vendor_bill",
                entity_id=bill_id,
                findings=[{"field": field, "issue": "No value was available from the confirmed scan."} for field in missing_fields],
            ))

            vendor_id = bill.get("vendor_id")
            if vendor_id is None:
                link_result = "NOT_APPLICABLE"
                link_findings = [{"field": "vendor_id", "issue": "Historical or unmatched bill remains explicitly unlinked."}]
            elif str(vendor_id) in vendor_ids:
                link_result = "PASS"
                link_findings = []
            else:
                link_result = "FAIL"
                link_findings = [{"field": "vendor_id", "value": str(vendor_id), "issue": "Linked vendor is not present in this employer's vendor directory."}]
            results.append(_check(
                "vendor_bill_vendor_link_integrity",
                "Vendor bill association integrity",
                link_result,
                "Validates existing explicit vendor associations; an unlinked historical bill is not an error.",
                entity_type="vendor_bill",
                entity_id=bill_id,
                findings=link_findings,
            ))
