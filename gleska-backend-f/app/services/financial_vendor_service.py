"""Employer-scoped financial vendor directory and vendor bill associations."""

from collections import defaultdict
from decimal import Decimal
import logging
import re
from typing import Any
from uuid import UUID

from app.core.supabase import supabase
from app.schemas.auth import UserResponse
from app.schemas.financial import (
    FinancialVendorBillRecord,
    FinancialVendorBillResponse,
    FinancialVendorCreateRequest,
    FinancialVendorCurrencyTotal,
    FinancialVendorListResponse,
    FinancialVendorResponse,
    FinancialVendorUpdateRequest,
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
VENDOR_COLUMNS = (
    "id, user_id, employer_id, vendor_name, normalized_name, contact_email, "
    "contact_phone, address, tax_identifier, is_active, created_at, updated_at"
)
BILL_COLUMNS = (
    "id, scan_id, vendor_id, user_id, employer_id, vendor_name, bill_number, "
    "bill_date, due_date, currency, total, confirmed_at"
)
PAGE_SIZE = 500


def _normalized_search(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip().casefold()


def _decimal(value: Any) -> Decimal:
    return Decimal(str(value or "0"))


class FinancialVendorService:
    @staticmethod
    def _fetch_vendors(
        user_id: str,
        employer_id: str,
        *,
        vendor_id: str | None = None,
        is_active: bool | None = None,
    ) -> list[dict[str, Any]]:
        query = (
            supabase.table("financial_vendors")
            .select(VENDOR_COLUMNS)
            .eq("user_id", user_id)
            .eq("employer_id", employer_id)
            .order("normalized_name")
        )
        if vendor_id:
            query = query.eq("id", vendor_id)
        if is_active is not None:
            query = query.eq("is_active", is_active)
        rows: list[dict[str, Any]] = []
        offset = 0
        while True:
            page = _rows(query.range(offset, offset + PAGE_SIZE - 1).execute())
            rows.extend(page)
            if len(page) < PAGE_SIZE:
                return rows
            offset += PAGE_SIZE

    @staticmethod
    def _fetch_bills(
        user_id: str,
        employer_id: str,
        *,
        vendor_id: str | None = None,
        unassigned_only: bool = False,
    ) -> list[dict[str, Any]]:
        query = (
            supabase.table("financial_vendor_bills")
            .select(BILL_COLUMNS)
            .eq("user_id", user_id)
            .eq("employer_id", employer_id)
            .order("confirmed_at", desc=True)
        )
        if vendor_id:
            query = query.eq("vendor_id", vendor_id)
        if unassigned_only:
            query = query.is_("vendor_id", "null")
        rows: list[dict[str, Any]] = []
        offset = 0
        while True:
            page = _rows(query.range(offset, offset + PAGE_SIZE - 1).execute())
            rows.extend(page)
            if len(page) < PAGE_SIZE:
                return rows
            offset += PAGE_SIZE

    @staticmethod
    def _bill_response(row: dict[str, Any]) -> FinancialVendorBillRecord:
        return FinancialVendorBillRecord.model_validate({
            field: row.get(field)
            for field in (
                "id",
                "scan_id",
                "vendor_id",
                "vendor_name",
                "bill_number",
                "bill_date",
                "due_date",
                "currency",
                "total",
                "confirmed_at",
            )
        })

    @classmethod
    def _vendor_response(
        cls,
        row: dict[str, Any],
        bills: list[dict[str, Any]],
        *,
        include_bills: bool,
    ) -> FinancialVendorResponse:
        totals: dict[str, Decimal] = defaultdict(Decimal)
        for bill in bills:
            if bill.get("currency") and bill.get("total") is not None:
                totals[bill["currency"]] += _decimal(bill["total"])
        values = {
            field: row.get(field)
            for field in (
                "id",
                "vendor_name",
                "normalized_name",
                "contact_email",
                "contact_phone",
                "address",
                "tax_identifier",
                "is_active",
                "created_at",
                "updated_at",
            )
        }
        return FinancialVendorResponse(
            **values,
            bill_count=len(bills),
            bill_totals_by_currency=[
                FinancialVendorCurrencyTotal(currency=currency, total=total)
                for currency, total in sorted(totals.items())
            ],
            bills=[cls._bill_response(bill) for bill in bills] if include_bills else [],
        )

    @classmethod
    def list_vendors(
        cls,
        user: UserResponse,
        search: str | None = None,
        active: bool | None = None,
    ) -> FinancialVendorListResponse:
        user_id, employer_id = FinancialService._employer_scope(user)
        try:
            vendors = cls._fetch_vendors(user_id, employer_id)
            bills = cls._fetch_bills(user_id, employer_id)
        except Exception as exc:
            logger.error(
                "Financial vendor directory load failed: user_id=%s exception_type=%s",
                user_id,
                type(exc).__name__,
            )
            raise FinancialServiceError("FINANCIAL_VENDORS_LOAD_FAILED") from exc

        active_count = sum(1 for vendor in vendors if vendor["is_active"])
        total_count = len(vendors)
        normalized_search = _normalized_search(search or "")
        if active is not None:
            vendors = [vendor for vendor in vendors if vendor["is_active"] is active]
        if normalized_search:
            vendors = [
                vendor for vendor in vendors
                if normalized_search in _normalized_search(" ".join(
                    str(vendor.get(field) or "")
                    for field in ("vendor_name", "contact_email", "contact_phone", "tax_identifier")
                ))
            ]
        bills_by_vendor: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for bill in bills:
            if bill.get("vendor_id"):
                bills_by_vendor[str(bill["vendor_id"])].append(bill)
        return FinancialVendorListResponse(
            vendors=[
                cls._vendor_response(
                    vendor,
                    bills_by_vendor[str(vendor["id"])],
                    include_bills=False,
                )
                for vendor in vendors
            ],
            total_count=total_count,
            active_count=active_count,
            inactive_count=total_count - active_count,
        )

    @classmethod
    def get_vendor(cls, user: UserResponse, vendor_id: UUID) -> FinancialVendorResponse:
        user_id, employer_id = FinancialService._employer_scope(user)
        try:
            vendor_rows = cls._fetch_vendors(
                user_id,
                employer_id,
                vendor_id=str(vendor_id),
            )
            if not vendor_rows:
                raise FinancialNotFound("FINANCIAL_VENDOR_NOT_FOUND")
            bills = cls._fetch_bills(
                user_id,
                employer_id,
                vendor_id=str(vendor_id),
            )
            return cls._vendor_response(vendor_rows[0], bills, include_bills=True)
        except (FinancialNotFound, FinancialServiceError):
            raise
        except Exception as exc:
            logger.error(
                "Financial vendor detail load failed: vendor_id=%s exception_type=%s",
                vendor_id,
                type(exc).__name__,
            )
            raise FinancialServiceError("FINANCIAL_VENDOR_LOAD_FAILED") from exc

    @classmethod
    def list_unassigned_bills(cls, user: UserResponse) -> list[FinancialVendorBillRecord]:
        user_id, employer_id = FinancialService._employer_scope(user)
        try:
            return [
                cls._bill_response(row)
                for row in cls._fetch_bills(
                    user_id,
                    employer_id,
                    unassigned_only=True,
                )
            ]
        except Exception as exc:
            logger.error(
                "Unassigned financial vendor bills load failed: user_id=%s exception_type=%s",
                user_id,
                type(exc).__name__,
            )
            raise FinancialServiceError("FINANCIAL_VENDOR_BILLS_LOAD_FAILED") from exc

    @classmethod
    def create_vendor(
        cls,
        user: UserResponse,
        request: FinancialVendorCreateRequest,
    ) -> FinancialVendorResponse:
        user_id, employer_id = FinancialService._employer_scope(user)
        try:
            row = _row(supabase.rpc(
                "create_financial_vendor",
                {
                    "p_user_id": user_id,
                    "p_employer_id": employer_id,
                    "p_vendor_name": request.vendor_name,
                    "p_contact_email": request.contact_email,
                    "p_contact_phone": request.contact_phone,
                    "p_address": request.address,
                    "p_tax_identifier": request.tax_identifier,
                },
            ).execute())
            if not row:
                raise ValueError("Financial vendor creation RPC returned no vendor")
            return cls._vendor_response(row, [], include_bills=True)
        except FinancialConflict:
            raise
        except Exception as exc:
            if getattr(exc, "code", None) == "23505" or "financial_vendors_employer_normalized_name_unique" in str(exc):
                raise FinancialConflict("FINANCIAL_VENDOR_DUPLICATE") from exc
            if "FINANCIAL_VENDOR_INPUT_INVALID" in str(exc):
                raise FinancialServiceError("FINANCIAL_VENDOR_INPUT_INVALID") from exc
            logger.error(
                "Financial vendor create failed: user_id=%s exception_type=%s",
                user_id,
                type(exc).__name__,
            )
            raise FinancialServiceError("FINANCIAL_VENDOR_CREATE_FAILED") from exc

    @classmethod
    def update_vendor(
        cls,
        user: UserResponse,
        vendor_id: UUID,
        request: FinancialVendorUpdateRequest,
    ) -> FinancialVendorResponse:
        user_id, employer_id = FinancialService._employer_scope(user)
        try:
            row = _row(supabase.rpc(
                "update_financial_vendor",
                {
                    "p_vendor_id": str(vendor_id),
                    "p_user_id": user_id,
                    "p_employer_id": employer_id,
                    "p_vendor_name": request.vendor_name,
                    "p_contact_email": request.contact_email,
                    "p_contact_phone": request.contact_phone,
                    "p_address": request.address,
                    "p_tax_identifier": request.tax_identifier,
                    "p_is_active": request.is_active,
                },
            ).execute())
            if not row:
                raise ValueError("Financial vendor update RPC returned no vendor")
            return cls._vendor_response(row, [], include_bills=True)
        except (FinancialConflict, FinancialNotFound):
            raise
        except Exception as exc:
            if getattr(exc, "code", None) == "23505" or "financial_vendors_employer_normalized_name_unique" in str(exc):
                raise FinancialConflict("FINANCIAL_VENDOR_DUPLICATE") from exc
            if "FINANCIAL_VENDOR_NOT_FOUND" in str(exc):
                raise FinancialNotFound("FINANCIAL_VENDOR_NOT_FOUND") from exc
            if "FINANCIAL_VENDOR_INPUT_INVALID" in str(exc):
                raise FinancialServiceError("FINANCIAL_VENDOR_INPUT_INVALID") from exc
            logger.error(
                "Financial vendor update failed: vendor_id=%s exception_type=%s",
                vendor_id,
                type(exc).__name__,
            )
            raise FinancialServiceError("FINANCIAL_VENDOR_UPDATE_FAILED") from exc

    @classmethod
    def link_bill(
        cls,
        user: UserResponse,
        bill_id: UUID,
        vendor_id: UUID,
    ) -> FinancialVendorBillResponse:
        user_id, employer_id = FinancialService._employer_scope(user)
        try:
            row = _row(supabase.rpc(
                "link_financial_vendor_bill",
                {
                    "p_bill_id": str(bill_id),
                    "p_user_id": user_id,
                    "p_employer_id": employer_id,
                    "p_vendor_id": str(vendor_id),
                },
            ).execute())
            if not row:
                raise ValueError("Financial vendor bill association returned no bill")
            return FinancialVendorBillResponse.model_validate({
                field: row[field]
                for field in FinancialVendorBillResponse.model_fields
                if field in row
            })
        except (FinancialConflict, FinancialNotFound):
            raise
        except Exception as exc:
            error_message = str(exc)
            if "FINANCIAL_VENDOR_BILL_NOT_FOUND" in error_message:
                raise FinancialNotFound("FINANCIAL_VENDOR_BILL_NOT_FOUND") from exc
            if "FINANCIAL_VENDOR_NOT_FOUND" in error_message:
                raise FinancialNotFound("FINANCIAL_VENDOR_NOT_FOUND") from exc
            if "FINANCIAL_VENDOR_BILL_ALREADY_LINKED" in error_message:
                raise FinancialConflict("FINANCIAL_VENDOR_BILL_ALREADY_LINKED") from exc
            logger.error(
                "Financial vendor bill association failed: bill_id=%s exception_type=%s",
                bill_id,
                type(exc).__name__,
            )
            raise FinancialServiceError("FINANCIAL_VENDOR_BILL_LINK_FAILED") from exc
