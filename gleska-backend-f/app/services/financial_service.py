"""Persistence and calculations for employer-owned financial records."""

from collections import defaultdict
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
import logging
import re
from typing import Any
from uuid import UUID, uuid4

from app.core.config import settings
from app.core.supabase import supabase
from app.schemas.auth import UserResponse
from app.schemas.financial import (
    FinancialDashboardRecord,
    FinancialDashboardResponse,
    FinancialDashboardSummary,
    FinancialAuditRecord,
    FinancialCurrencyAmount,
    FinancialInvoicePaymentsResponse,
    FinancialInvoiceCompanyDetails,
    FinancialPaymentCreateRequest,
    FinancialPaymentRecord,
    FinancialReceivableStatus,
    FinancialReceivablesResponse,
    FinancialReceivablesSummary,
    FinancialSettings,
    FinancialSettingsUpdate,
    MAX_FINANCIAL_SCAN_UPLOAD_BYTES,
    InvoiceCreateRequest,
    InvoiceLineItemResponse,
    InvoiceResponse,
)

logger = logging.getLogger(__name__)
CENT = Decimal("0.01")
MAX_MONEY = Decimal("999999999999.99")
INVOICE_SELECT = "*, financial_invoice_items(*)"


class FinancialServiceError(ValueError):
    """Base error with a stable API error code."""


class FinancialNotFound(FinancialServiceError):
    pass


class FinancialConflict(FinancialServiceError):
    pass


def _row(response: Any) -> dict[str, Any]:
    data = getattr(response, "data", None)
    if isinstance(data, list):
        return data[0] if data else {}
    return data or {}


def _rows(response: Any) -> list[dict[str, Any]]:
    data = getattr(response, "data", None)
    return data if isinstance(data, list) else ([data] if isinstance(data, dict) else [])


def _decimal(value: Any) -> Decimal:
    return Decimal(str(value or "0"))


def _money(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def _invoice_response(row: dict[str, Any]) -> InvoiceResponse:
    items = row.get("financial_invoice_items") or []
    return InvoiceResponse(
        id=row["id"],
        invoice_number=row["invoice_number"],
        client_name=row["client_name"],
        issue_date=row["issue_date"],
        due_date=row["due_date"],
        payment_terms_notes=row.get("payment_terms_notes") or "",
        currency=row["currency"],
        tax_rate=row["tax_rate"],
        subtotal=row["subtotal"],
        tax_amount=row["tax_amount"],
        total=row["total"],
        status=row["status"],
        line_items=[
            InvoiceLineItemResponse(
                id=item["id"],
                description=item["description"],
                quantity=item["quantity"],
                unit_price=item["unit_price"],
                line_total=item["line_total"],
            )
            for item in items
        ],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


class FinancialService:
    @staticmethod
    def _employer_scope(user: UserResponse) -> tuple[str, str]:
        try:
            response = (
                supabase.table("employer_profiles")
                .select("id")
                .eq("user_id", str(user.id))
                .maybe_single()
                .execute()
            )
        except Exception as exc:
            logger.error(
                "Financial employer lookup failed: user_id=%s exception_type=%s",
                user.id,
                type(exc).__name__,
            )
            raise FinancialServiceError("FINANCIAL_EMPLOYER_LOOKUP_FAILED") from exc
        employer = _row(response)
        if not employer.get("id"):
            raise FinancialNotFound("EMPLOYER_PROFILE_NOT_FOUND")
        return str(user.id), str(employer["id"])

    @classmethod
    def record_audit_event(
        cls,
        user: UserResponse,
        action: str,
        outcome: str,
        entity_type: str,
        entity_id: str | None,
        event_key: str,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        user_id, employer_id = cls._employer_scope(user)
        cls.record_scoped_audit_event(
            user_id, employer_id, action, outcome, entity_type, entity_id, event_key, metadata
        )

    @classmethod
    def record_scoped_audit_event(
        cls,
        user_id: str,
        employer_id: str,
        action: str,
        outcome: str,
        entity_type: str,
        entity_id: str | None,
        event_key: str,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        try:
            supabase.table("financial_audit_events").insert({
                "user_id": user_id,
                "employer_id": employer_id,
                "actor_user_id": user_id,
                "action": action,
                "outcome": outcome,
                "entity_type": entity_type,
                "entity_id": entity_id,
                "event_key": event_key,
                "metadata": metadata or {},
            }).execute()
        except Exception as exc:
            if getattr(exc, "code", None) == "23505" or "duplicate key" in str(exc).lower():
                return
            logger.error(
                "Financial audit insert failed: action=%s user_id=%s exception_type=%s",
                action, user_id, type(exc).__name__,
            )
            raise FinancialServiceError("FINANCIAL_AUDIT_WRITE_FAILED") from exc

    @classmethod
    def record_failed_action(
        cls,
        user: UserResponse,
        action: str,
        entity_type: str,
        entity_id: str | None,
        error_code: str,
    ) -> None:
        cls.record_audit_event(
            user,
            action,
            "FAILURE",
            entity_type,
            entity_id,
            f"financial-failure:{uuid4()}",
            {"error_code": error_code[:100]},
        )

    @classmethod
    def get_settings(cls, user: UserResponse) -> FinancialSettings:
        user_id, employer_id = cls._employer_scope(user)
        try:
            select_columns = (
                "base_currency, tax_identifier, auto_reconcile_incoming_bills, "
                "created_at, updated_at"
            )
            row = _row(
                supabase.table("financial_settings")
                .select(select_columns)
                .eq("user_id", user_id)
                .eq("employer_id", employer_id)
                .maybe_single()
                .execute()
            )
            if not row:
                try:
                    row = _row(
                        supabase.table("financial_settings")
                        .insert({
                            "user_id": user_id,
                            "employer_id": employer_id,
                            "base_currency": "INR",
                            "tax_identifier": "",
                            "auto_reconcile_incoming_bills": False,
                        })
                        .select(select_columns)
                        .execute()
                    )
                except Exception as insert_exc:
                    if (
                        getattr(insert_exc, "code", None) != "23505"
                        and "duplicate key" not in str(insert_exc).casefold()
                    ):
                        raise
                    row = _row(
                        supabase.table("financial_settings")
                        .select(select_columns)
                        .eq("user_id", user_id)
                        .eq("employer_id", employer_id)
                        .maybe_single()
                        .execute()
                    )
            if not row:
                raise ValueError("Financial settings persistence returned no record")
            return cls._financial_settings_response(row)
        except FinancialServiceError:
            raise
        except Exception as exc:
            logger.error(
                "Financial settings load failed: user_id=%s exception_type=%s",
                user_id,
                type(exc).__name__,
            )
            raise FinancialServiceError("FINANCIAL_SETTINGS_LOAD_FAILED") from exc

    @classmethod
    def update_settings(
        cls,
        user: UserResponse,
        request: FinancialSettingsUpdate,
    ) -> FinancialSettings:
        user_id, employer_id = cls._employer_scope(user)
        try:
            current = cls.get_settings(user)
            payload = {
                "base_currency": current.base_currency,
                "tax_identifier": current.tax_identifier,
                "auto_reconcile_incoming_bills": current.auto_reconcile_incoming_bills,
            }
            supplied = request.model_dump(mode="json", exclude_unset=True)
            for field_name, value in supplied.items():
                payload[field_name] = "" if field_name == "tax_identifier" and value is None else value
            payload.update({"user_id": user_id, "employer_id": employer_id})
            response = (
                supabase.table("financial_settings")
                .upsert(payload, on_conflict="employer_id")
                .select(
                    "base_currency, tax_identifier, auto_reconcile_incoming_bills, "
                    "created_at, updated_at"
                )
                .execute()
            )
            row = _row(response)
            if not row:
                raise ValueError("Financial settings save returned no persisted record")
            return cls._financial_settings_response(row)
        except Exception as exc:
            logger.error(
                "Financial settings save failed: user_id=%s exception_type=%s",
                user_id,
                type(exc).__name__,
            )
            raise FinancialServiceError("FINANCIAL_SETTINGS_SAVE_FAILED") from exc

    @staticmethod
    def _financial_settings_response(row: dict[str, Any]) -> FinancialSettings:
        model = settings.GEMINI_MODEL.strip()
        configured = bool(
            settings.GEMINI_API_KEY.strip()
            and model
            and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}", model)
            and settings.FINANCIAL_SCAN_GEMINI_TIMEOUT_SECONDS > 0
        )
        return FinancialSettings.model_validate({
            **row,
            "document_processing_configured": configured,
            "document_processing_upload_limit_bytes": MAX_FINANCIAL_SCAN_UPLOAD_BYTES,
        })

    @classmethod
    def list_invoices(cls, user: UserResponse, search: str | None = None) -> list[InvoiceResponse]:
        user_id, employer_id = cls._employer_scope(user)
        try:
            query = (
                supabase.table("financial_invoices")
                .select(INVOICE_SELECT)
                .eq("user_id", user_id)
                .eq("employer_id", employer_id)
                .order("issue_date", desc=True)
                .order("created_at", desc=True)
            )
            rows = _rows(query.execute())
            normalized_search = (search or "").strip().casefold()
            if normalized_search:
                rows = [
                    row for row in rows
                    if normalized_search in " ".join(
                        str(row.get(field) or "")
                        for field in (
                            "invoice_number",
                            "client_name",
                            "issue_date",
                            "due_date",
                            "payment_terms_notes",
                            "currency",
                            "tax_rate",
                            "subtotal",
                            "tax_amount",
                            "total",
                            "status",
                        )
                    ).casefold()
                    or any(
                        normalized_search in str(item.get("description") or "").casefold()
                        for item in (row.get("financial_invoice_items") or [])
                    )
                ]
            return [_invoice_response(row) for row in rows]
        except FinancialServiceError:
            raise
        except Exception as exc:
            logger.error(
                "Financial invoices load failed: user_id=%s exception_type=%s",
                user_id,
                type(exc).__name__,
            )
            raise FinancialServiceError("FINANCIAL_INVOICES_LOAD_FAILED") from exc

    @classmethod
    def _invoice_payment_scope(
        cls,
        user: UserResponse,
        invoice_id: UUID,
    ) -> tuple[str, str, dict[str, Any]]:
        user_id, employer_id = cls._employer_scope(user)
        try:
            invoice = _row(
                supabase.table("financial_invoices")
                .select("id, status, total, currency")
                .eq("id", str(invoice_id))
                .eq("user_id", user_id)
                .eq("employer_id", employer_id)
                .maybe_single()
                .execute()
            )
        except Exception as exc:
            logger.error(
                "Financial payment invoice lookup failed: invoice_id=%s exception_type=%s",
                invoice_id,
                type(exc).__name__,
            )
            raise FinancialServiceError("FINANCIAL_PAYMENT_INVOICE_LOAD_FAILED") from exc
        if not invoice:
            raise FinancialNotFound("INVOICE_NOT_FOUND")
        if invoice.get("status") != "GENERATED":
            raise FinancialConflict("INVOICE_NOT_GENERATED")
        return user_id, employer_id, invoice

    @staticmethod
    def _payment_rows(
        user_id: str,
        employer_id: str,
        invoice_ids: list[str],
    ) -> list[dict[str, Any]]:
        if not invoice_ids:
            return []
        try:
            payments: list[dict[str, Any]] = []
            page_size = 500
            for first in range(0, len(invoice_ids), 100):
                invoice_chunk = invoice_ids[first:first + 100]
                offset = 0
                while True:
                    rows = _rows(
                        supabase.table("financial_invoice_payments")
                        .select(
                            "id, invoice_id, amount, payment_date, payment_reference, notes, "
                            "idempotency_key, created_at"
                        )
                        .eq("user_id", user_id)
                        .eq("employer_id", employer_id)
                        .in_("invoice_id", invoice_chunk)
                        .order("payment_date", desc=True)
                        .order("created_at", desc=True)
                        .range(offset, offset + page_size - 1)
                        .execute()
                    )
                    payments.extend(rows)
                    if len(rows) < page_size:
                        break
                    offset += page_size
            return payments
        except Exception as exc:
            logger.error(
                "Financial invoice payments load failed: user_id=%s exception_type=%s",
                user_id,
                type(exc).__name__,
            )
            raise FinancialServiceError("FINANCIAL_PAYMENTS_LOAD_FAILED") from exc

    @classmethod
    def _receivables_from_invoices(
        cls,
        user_id: str,
        employer_id: str,
        invoices: list[InvoiceResponse],
        as_of_date: date,
    ) -> FinancialReceivablesResponse:
        generated = [invoice for invoice in invoices if invoice.status == "GENERATED"]
        payment_rows = cls._payment_rows(
            user_id,
            employer_id,
            [str(invoice.id) for invoice in generated],
        )
        paid_by_invoice: dict[str, Decimal] = defaultdict(Decimal)
        for payment in payment_rows:
            paid_by_invoice[str(payment["invoice_id"])] += _decimal(payment["amount"])

        currency_totals: dict[str, Decimal] = defaultdict(Decimal)
        receivables: list[FinancialReceivableStatus] = []
        unpaid_count = partially_paid_count = overdue_count = paid_count = 0
        outstanding_invoice_count = 0
        for invoice in generated:
            paid_amount = paid_by_invoice[str(invoice.id)]
            invoice_total = _decimal(invoice.total)
            outstanding_amount = _money(invoice_total - paid_amount)
            is_overdue = outstanding_amount > 0 and invoice.due_date < as_of_date
            if outstanding_amount > 0:
                outstanding_invoice_count += 1
                currency_totals[invoice.currency] += outstanding_amount
                if is_overdue:
                    overdue_count += 1
                if paid_amount == 0:
                    unpaid_count += 1
                else:
                    partially_paid_count += 1
                payment_status = "UNPAID" if paid_amount == 0 else "PARTIALLY_PAID"
            else:
                paid_count += 1
                payment_status = "PAID"
            receivables.append(FinancialReceivableStatus(
                invoice_id=invoice.id,
                invoice_number=invoice.invoice_number,
                client_name=invoice.client_name,
                issue_date=invoice.issue_date,
                due_date=invoice.due_date,
                currency=invoice.currency,
                invoice_total=invoice_total,
                paid_amount=paid_amount,
                outstanding_amount=outstanding_amount,
                payment_status=payment_status,
                is_overdue=is_overdue,
            ))

        summary = FinancialReceivablesSummary(
            as_of_date=as_of_date,
            generated_invoice_count=len(generated),
            outstanding_invoice_count=outstanding_invoice_count,
            unpaid_count=unpaid_count,
            partially_paid_count=partially_paid_count,
            overdue_count=overdue_count,
            paid_count=paid_count,
            outstanding_by_currency=[
                FinancialCurrencyAmount(currency=currency, amount=amount)
                for currency, amount in sorted(currency_totals.items())
                if amount > 0
            ],
        )
        return FinancialReceivablesResponse(summary=summary, invoices=receivables)

    @classmethod
    def receivables(cls, user: UserResponse) -> FinancialReceivablesResponse:
        user_id, employer_id = cls._employer_scope(user)
        return cls._receivables_from_invoices(
            user_id,
            employer_id,
            cls.list_invoices(user),
            datetime.now(timezone.utc).date(),
        )

    @classmethod
    def list_invoice_payments(
        cls,
        user: UserResponse,
        invoice_id: UUID,
    ) -> FinancialInvoicePaymentsResponse:
        user_id, employer_id, invoice = cls._invoice_payment_scope(user, invoice_id)
        payment_rows = cls._payment_rows(user_id, employer_id, [str(invoice_id)])
        payments = [
            FinancialPaymentRecord.model_validate({
                **row,
                "currency": invoice["currency"],
            })
            for row in payment_rows
        ]
        paid_amount = sum((_decimal(payment.amount) for payment in payments), Decimal("0"))
        invoice_total = _decimal(invoice["total"])
        return FinancialInvoicePaymentsResponse(
            invoice_id=invoice_id,
            currency=invoice["currency"],
            invoice_total=invoice_total,
            paid_amount=paid_amount,
            outstanding_amount=_money(invoice_total - paid_amount),
            as_of_date=datetime.now(timezone.utc).date(),
            payments=payments,
        )

    @classmethod
    def record_invoice_payment(
        cls,
        user: UserResponse,
        invoice_id: UUID,
        request: FinancialPaymentCreateRequest,
    ) -> FinancialPaymentRecord:
        user_id, employer_id, _ = cls._invoice_payment_scope(user, invoice_id)
        try:
            row = _row(supabase.rpc(
                "record_financial_invoice_payment",
                {
                    "p_invoice_id": str(invoice_id),
                    "p_user_id": user_id,
                    "p_employer_id": employer_id,
                    "p_amount": str(request.amount),
                    "p_payment_date": request.payment_date.isoformat(),
                    "p_payment_reference": request.payment_reference or "",
                    "p_notes": request.notes,
                    "p_idempotency_key": str(request.idempotency_key),
                },
            ).execute())
            if not row:
                raise ValueError("Invoice payment RPC returned no record")
            return FinancialPaymentRecord.model_validate({
                field: row[field]
                for field in (
                    "id",
                    "invoice_id",
                    "amount",
                    "currency",
                    "payment_date",
                    "payment_reference",
                    "notes",
                    "idempotency_key",
                    "created_at",
                )
            })
        except (FinancialConflict, FinancialNotFound, FinancialServiceError):
            raise
        except Exception as exc:
            error_code = getattr(exc, "code", None)
            error_message = str(exc)
            if error_code == "P0002" or "INVOICE_NOT_FOUND" in error_message:
                raise FinancialNotFound("INVOICE_NOT_FOUND") from exc
            if "INVOICE_NOT_GENERATED" in error_message:
                raise FinancialConflict("INVOICE_NOT_GENERATED") from exc
            if "PAYMENT_EXCEEDS_OUTSTANDING" in error_message:
                raise FinancialConflict("PAYMENT_EXCEEDS_OUTSTANDING") from exc
            if "PAYMENT_IDEMPOTENCY_KEY_REUSED" in error_message:
                raise FinancialConflict("PAYMENT_IDEMPOTENCY_KEY_REUSED") from exc
            if "PAYMENT_INPUT_INVALID" in error_message:
                raise FinancialServiceError("PAYMENT_INPUT_INVALID") from exc
            logger.error(
                "Financial invoice payment failed: invoice_id=%s exception_type=%s",
                invoice_id,
                type(exc).__name__,
            )
            raise FinancialServiceError("FINANCIAL_PAYMENT_RECORD_FAILED") from exc

    @classmethod
    def invoice_company_details(cls, user: UserResponse) -> FinancialInvoiceCompanyDetails | None:
        _, employer_id = cls._employer_scope(user)
        try:
            response = (
                supabase.table("employer_onboarding_details")
                .select(
                    "business_name, registered_address, address, city, state, pincode, "
                    "gstin, company_email, company_phone"
                )
                .eq("employer_id", employer_id)
                .maybe_single()
                .execute()
            )
            details = _row(response)
            values = {
                field: str(details[field]).strip() or None
                for field in (
                    "business_name",
                    "registered_address",
                    "address",
                    "city",
                    "state",
                    "pincode",
                    "gstin",
                    "company_email",
                    "company_phone",
                )
                if details.get(field) is not None
            }
            if not any(values.values()):
                return None
            return FinancialInvoiceCompanyDetails(**values)
        except Exception as exc:
            logger.error(
                "Financial invoice company details load failed: user_id=%s exception_type=%s",
                user.id,
                type(exc).__name__,
            )
            raise FinancialServiceError("FINANCIAL_INVOICE_COMPANY_DETAILS_LOAD_FAILED") from exc

    @classmethod
    def delete_invoice(cls, user: UserResponse, invoice_id: UUID) -> None:
        user_id, employer_id = cls._employer_scope(user)
        try:
            existing = (
                supabase.table("financial_invoices")
                .select("id, status")
                .eq("id", str(invoice_id))
                .eq("user_id", user_id)
                .eq("employer_id", employer_id)
                .maybe_single()
                .execute()
            )
            invoice = _row(existing)
            if not invoice:
                raise FinancialNotFound("INVOICE_NOT_FOUND")
            if invoice.get("status") != "DRAFT":
                raise FinancialConflict("GENERATED_INVOICE_CANNOT_BE_DELETED")

            deleted = (
                supabase.table("financial_invoices")
                .delete(count="exact")
                .eq("id", str(invoice_id))
                .eq("user_id", user_id)
                .eq("employer_id", employer_id)
                .eq("status", "DRAFT")
                .execute()
            )
            if deleted.count == 1:
                return
            if deleted.count is None:
                raise FinancialServiceError("FINANCIAL_INVOICE_DELETE_FAILED")

            current = (
                supabase.table("financial_invoices")
                .select("id, status")
                .eq("id", str(invoice_id))
                .eq("user_id", user_id)
                .eq("employer_id", employer_id)
                .maybe_single()
                .execute()
            )
            current_invoice = _row(current)
            if not current_invoice:
                raise FinancialNotFound("INVOICE_NOT_FOUND")
            if current_invoice.get("status") != "DRAFT":
                raise FinancialConflict("GENERATED_INVOICE_CANNOT_BE_DELETED")
            raise FinancialServiceError("FINANCIAL_INVOICE_DELETE_FAILED")
        except (FinancialConflict, FinancialNotFound, FinancialServiceError):
            raise
        except Exception as exc:
            logger.error(
                "Financial invoice delete failed: user_id=%s invoice_id=%s exception_type=%s",
                user_id,
                invoice_id,
                type(exc).__name__,
            )
            raise FinancialServiceError("FINANCIAL_INVOICE_DELETE_FAILED") from exc

    @classmethod
    def list_audits(
        cls,
        user: UserResponse,
        action: str | None = None,
        outcome: str | None = None,
    ) -> list[FinancialAuditRecord]:
        user_id, employer_id = cls._employer_scope(user)
        try:
            audits: list[FinancialAuditRecord] = []
            offset = 0
            page_size = 100
            while True:
                # Retain the employer scope on every page of the canonical history.
                query = supabase.table("financial_audit_events").select(
                    "id, action, outcome, entity_type, entity_id, actor_user_id, metadata, created_at"
                ).eq("user_id", user_id).eq("employer_id", employer_id)
                if action:
                    query = query.eq("action", action)
                if outcome:
                    query = query.eq("outcome", outcome)
                response = query.order("created_at", desc=True).order("id", desc=True).range(
                    offset, offset + page_size - 1
                ).execute()
                rows = _rows(response)
                audits.extend(FinancialAuditRecord.model_validate(row) for row in rows)
                if len(rows) < page_size:
                    return audits
                offset += page_size
        except Exception as exc:
            logger.error(
                "Financial audit load failed: user_id=%s exception_type=%s",
                user_id,
                type(exc).__name__,
            )
            raise FinancialServiceError("FINANCIAL_AUDITS_LOAD_FAILED") from exc

    @classmethod
    def create_invoice(cls, user: UserResponse, request: InvoiceCreateRequest) -> InvoiceResponse:
        user_id, employer_id = cls._employer_scope(user)
        settings = cls.get_settings(user)
        line_items = []
        subtotal = Decimal("0")
        for item in request.line_items:
            line_total = _money(item.quantity * item.unit_price)
            if line_total > MAX_MONEY:
                raise FinancialServiceError("INVOICE_AMOUNT_OUT_OF_RANGE")
            subtotal += line_total
            if subtotal > MAX_MONEY:
                raise FinancialServiceError("INVOICE_AMOUNT_OUT_OF_RANGE")
            line_items.append({
                "description": item.description,
                "quantity": str(item.quantity),
                "unit_price": str(item.unit_price),
                "line_total": str(line_total),
                "user_id": user_id,
                "employer_id": employer_id,
            })
        subtotal = _money(subtotal)
        tax_amount = _money(subtotal * request.tax_rate / Decimal("100"))
        total = _money(subtotal + tax_amount)
        if tax_amount > MAX_MONEY or total > MAX_MONEY:
            raise FinancialServiceError("INVOICE_AMOUNT_OUT_OF_RANGE")
        try:
            response = (
                supabase.rpc(
                    "create_financial_invoice",
                    {
                        "p_user_id": user_id,
                        "p_employer_id": employer_id,
                        "p_client_name": request.client_name,
                        "p_issue_date": request.issue_date.isoformat(),
                        "p_due_date": request.due_date.isoformat(),
                        "p_payment_terms_notes": request.payment_terms_notes,
                        "p_currency": settings.base_currency,
                        "p_tax_rate": str(request.tax_rate),
                        "p_subtotal": str(subtotal),
                        "p_tax_amount": str(tax_amount),
                        "p_total": str(total),
                        "p_status": "DRAFT" if request.action == "save_draft" else "GENERATED",
                        "p_line_items": [
                            {
                                "description": item["description"],
                                "quantity": item["quantity"],
                                "unit_price": item["unit_price"],
                                "line_total": item["line_total"],
                            }
                            for item in line_items
                        ],
                    },
                )
                .execute()
            )
            row = _row(response)
            if not row:
                raise ValueError("Invoice creation RPC returned no record")
            nested_items = row.get("financial_invoice_items")
            if not isinstance(nested_items, list):
                raise ValueError("Invoice creation RPC returned invalid line items")
            return _invoice_response(row)
        except Exception as exc:
            error_code = getattr(exc, "code", None)
            if error_code == "23505" or "duplicate key" in str(exc).casefold() or "unique constraint" in str(exc).casefold():
                raise FinancialConflict("INVOICE_NUMBER_ALREADY_EXISTS") from exc
            logger.exception(
                "Financial invoice create failed: user_id=%s exception_type=%s",
                user_id,
                type(exc).__name__,
            )
            raise FinancialServiceError("FINANCIAL_INVOICE_CREATE_FAILED") from exc

    @classmethod
    def update_invoice(
        cls,
        user: UserResponse,
        invoice_id: UUID,
        request: InvoiceCreateRequest,
    ) -> InvoiceResponse:
        user_id, employer_id = cls._employer_scope(user)
        line_items = []
        subtotal = Decimal("0")
        for item in request.line_items:
            line_total = _money(item.quantity * item.unit_price)
            if line_total > MAX_MONEY:
                raise FinancialServiceError("INVOICE_AMOUNT_OUT_OF_RANGE")
            subtotal += line_total
            if subtotal > MAX_MONEY:
                raise FinancialServiceError("INVOICE_AMOUNT_OUT_OF_RANGE")
            line_items.append({
                "description": item.description,
                "quantity": str(item.quantity),
                "unit_price": str(item.unit_price),
                "line_total": str(line_total),
            })
        subtotal = _money(subtotal)
        tax_amount = _money(subtotal * request.tax_rate / Decimal("100"))
        total = _money(subtotal + tax_amount)
        if tax_amount > MAX_MONEY or total > MAX_MONEY:
            raise FinancialServiceError("INVOICE_AMOUNT_OUT_OF_RANGE")

        try:
            response = supabase.rpc(
                "update_financial_invoice_draft",
                {
                    "p_invoice_id": str(invoice_id),
                    "p_user_id": user_id,
                    "p_employer_id": employer_id,
                    "p_client_name": request.client_name,
                    "p_issue_date": request.issue_date.isoformat(),
                    "p_due_date": request.due_date.isoformat(),
                    "p_payment_terms_notes": request.payment_terms_notes,
                    "p_tax_rate": str(request.tax_rate),
                    "p_subtotal": str(subtotal),
                    "p_tax_amount": str(tax_amount),
                    "p_total": str(total),
                    "p_status": "DRAFT" if request.action == "save_draft" else "GENERATED",
                    "p_line_items": line_items,
                },
            ).execute()
            row = _row(response)
            if not row:
                raise ValueError("Invoice update RPC returned no record")
            nested_items = row.get("financial_invoice_items")
            if not isinstance(nested_items, list):
                raise ValueError("Invoice update RPC returned invalid line items")
            return _invoice_response(row)
        except Exception as exc:
            error_code = getattr(exc, "code", None)
            if error_code == "P0002":
                raise FinancialNotFound("INVOICE_NOT_FOUND") from exc
            if error_code == "55000":
                raise FinancialConflict("INVOICE_ALREADY_GENERATED") from exc
            if error_code == "22023":
                raise FinancialServiceError("INVOICE_INPUT_INVALID") from exc
            logger.exception(
                "Financial invoice update failed: user_id=%s invoice_id=%s exception_type=%s",
                user_id,
                invoice_id,
                type(exc).__name__,
            )
            raise FinancialServiceError("FINANCIAL_INVOICE_UPDATE_FAILED") from exc

    @classmethod
    def dashboard(cls, user: UserResponse, search: str | None = None) -> FinancialDashboardResponse:
        all_invoices = cls.list_invoices(user)
        normalized_search = (search or "").strip().casefold()
        invoices = all_invoices
        if normalized_search:
            invoices = [
                invoice
                for invoice in all_invoices
                if normalized_search in " ".join(
                    str(value or "")
                    for value in (
                        invoice.invoice_number,
                        invoice.client_name,
                        invoice.issue_date,
                        invoice.due_date,
                        invoice.payment_terms_notes,
                        invoice.currency,
                        invoice.tax_rate,
                        invoice.subtotal,
                        invoice.tax_amount,
                        invoice.total,
                        invoice.status,
                    )
                ).casefold()
                or any(
                    normalized_search in item.description.casefold()
                    for item in invoice.line_items
                )
            ]
        generated = [invoice for invoice in all_invoices if invoice.status == "GENERATED"]
        generated_currencies = {invoice.currency for invoice in generated}
        total_invoiced = (
            sum((_decimal(invoice.total) for invoice in generated), Decimal("0"))
            if len(generated_currencies) <= 1
            else None
        )
        total_invoiced_currency = next(iter(generated_currencies), None) if len(generated_currencies) <= 1 else None
        user_id, employer_id = cls._employer_scope(user)
        as_of_date = datetime.now(timezone.utc).date()
        receivables = cls._receivables_from_invoices(
            user_id, employer_id, all_invoices, as_of_date
        )
        outstanding_by_currency = receivables.summary.outstanding_by_currency
        pending_receivables = (
            float(outstanding_by_currency[0].amount)
            if len(outstanding_by_currency) == 1
            else 0.0 if not outstanding_by_currency
            else None
        )
        try:
            active_vendor_response = (
                supabase.table("financial_vendors")
                .select("id", count="exact", head=True)
                .eq("user_id", user_id)
                .eq("employer_id", employer_id)
                .eq("is_active", True)
                .execute()
            )
            active_vendor_count = int(active_vendor_response.count or 0)
        except Exception as exc:
            logger.error(
                "Financial active vendor count failed: user_id=%s exception_type=%s",
                user_id,
                type(exc).__name__,
            )
            raise FinancialServiceError("FINANCIAL_VENDORS_LOAD_FAILED") from exc
        try:
            audit_run_count_response = (
                supabase.table("financial_audit_runs")
                .select("id", count="exact", head=True)
                .eq("user_id", user_id)
                .eq("employer_id", employer_id)
                .execute()
            )
            total_audit_runs = int(audit_run_count_response.count or 0)
            latest_audit_run_rows = _rows(
                supabase.table("financial_audit_runs")
                .select("started_at, status")
                .eq("user_id", user_id)
                .eq("employer_id", employer_id)
                .order("started_at", desc=True)
                .limit(1)
                .execute()
            )
            latest_audit_run = latest_audit_run_rows[0] if latest_audit_run_rows else None
            latest_audit_rows = _rows(
                supabase.table("financial_audit_runs")
                .select("id, passed_checks, failed_checks, pass_rate, completed_at")
                .eq("user_id", user_id)
                .eq("employer_id", employer_id)
                .eq("status", "COMPLETED")
                .order("completed_at", desc=True)
                .limit(1)
                .execute()
            )
            latest_audit = latest_audit_rows[0] if latest_audit_rows else None
        except Exception as exc:
            logger.error(
                "Financial latest audit summary failed: user_id=%s exception_type=%s",
                user_id,
                type(exc).__name__,
            )
            raise FinancialServiceError("FINANCIAL_AUDIT_SUMMARY_LOAD_FAILED") from exc
        records = [
            FinancialDashboardRecord(
                id=str(invoice.id),
                type="INVOICE",
                title=f"Invoice {invoice.invoice_number}",
                entity=invoice.client_name,
                reference=invoice.invoice_number,
                amount=float(invoice.total),
                currency=invoice.currency,
                status=invoice.status,
                date=invoice.issue_date.isoformat(),
                category="INVOICE",
            )
            for invoice in invoices
        ]
        return FinancialDashboardResponse(
            summary=FinancialDashboardSummary(
                total_invoiced=float(total_invoiced) if total_invoiced is not None else None,
                total_invoiced_currency=total_invoiced_currency,
                total_invoiced_has_multiple_currencies=len(generated_currencies) > 1,
                pending_receivables=pending_receivables,
                pending_receivables_by_currency=outstanding_by_currency,
                pending_receivable_count=receivables.summary.outstanding_invoice_count,
                receivables_as_of_date=as_of_date,
                active_invoices=len(generated),
                audits_passed=int(latest_audit["passed_checks"]) if latest_audit else None,
                audit_pass_rate=float(latest_audit["pass_rate"]) if latest_audit and latest_audit["pass_rate"] is not None else None,
                latest_audit_failed_checks=int(latest_audit["failed_checks"]) if latest_audit else None,
                latest_audit_run_id=latest_audit["id"] if latest_audit else None,
                latest_audit_completed_at=latest_audit["completed_at"] if latest_audit else None,
                latest_audit_started_at=latest_audit_run["started_at"] if latest_audit_run else None,
                latest_audit_run_status=latest_audit_run["status"] if latest_audit_run else None,
                total_audit_runs=total_audit_runs,
                active_vendors=active_vendor_count,
            ),
            records=records,
        )
