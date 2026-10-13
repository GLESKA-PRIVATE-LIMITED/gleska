"""Persistence and calculations for employer-owned financial records."""

from decimal import Decimal, ROUND_HALF_UP
import logging
from typing import Any
from uuid import UUID

from app.core.supabase import supabase
from app.schemas.auth import UserResponse
from app.schemas.financial import (
    FinancialDashboardRecord,
    FinancialDashboardResponse,
    FinancialDashboardSummary,
    FinancialSettings,
    FinancialSettingsUpdate,
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
    def get_settings(cls, user: UserResponse) -> FinancialSettings:
        user_id, employer_id = cls._employer_scope(user)
        try:
            response = (
                supabase.table("financial_settings")
                .select("base_currency, tax_identifier, auto_reconcile_incoming_bills")
                .eq("user_id", user_id)
                .eq("employer_id", employer_id)
                .maybe_single()
                .execute()
            )
            row = _row(response)
            return FinancialSettings.model_validate(row or {})
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
        payload = request.model_dump(mode="json")
        payload.update({"user_id": user_id, "employer_id": employer_id})
        try:
            response = (
                supabase.table("financial_settings")
                .upsert(payload, on_conflict="employer_id")
                .execute()
            )
            return FinancialSettings.model_validate(_row(response) or payload)
        except Exception as exc:
            logger.error(
                "Financial settings save failed: user_id=%s exception_type=%s",
                user_id,
                type(exc).__name__,
            )
            raise FinancialServiceError("FINANCIAL_SETTINGS_SAVE_FAILED") from exc

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
        total_invoiced = sum((_decimal(invoice.total) for invoice in generated), Decimal("0"))
        records = [
            FinancialDashboardRecord(
                id=str(invoice.id),
                type="INVOICE",
                title=f"Invoice {invoice.invoice_number}",
                entity=invoice.client_name,
                reference=invoice.invoice_number,
                amount=float(invoice.total),
                status=invoice.status,
                date=invoice.issue_date.isoformat(),
                category="INVOICE",
            )
            for invoice in invoices
        ]
        return FinancialDashboardResponse(
            summary=FinancialDashboardSummary(
                total_invoiced=float(total_invoiced),
                # Payment state is not persisted, so receivables cannot be inferred safely.
                pending_receivables=None,
                active_invoices=len(generated),
                audits_passed=None,
                audit_pass_rate=None,
                active_vendors=None,
            ),
            records=records,
        )
