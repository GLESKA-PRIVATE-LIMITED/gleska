"""Owner- and recipient-scoped persistence for Procurement RFQs."""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID

from fastapi import status

from app.core.supabase import supabase
from app.schemas.auth import UserResponse
from app.schemas.rfq import (
    ProcurementRFQCreateRequest,
    ProcurementRFQRecipient,
    ProcurementRFQResponse,
    SupplierQuotationRequest,
    SupplierQuotationResponse,
    SupplierQuotationResult,
    SupplierRFQResponse,
    SupplierRFQResponseRequest,
    SupplierRFQResponseResult,
)
from app.services.procurement_service import (
    ProcurementNotFound,
    ProcurementService,
    ProcurementServiceError,
)

logger = logging.getLogger(__name__)
RFQ_LIST_LIMIT = 100
RFQ_RECIPIENT_QUERY_BATCH_SIZE = 10
RFQ_COMPANY_QUERY_BATCH_SIZE = 100


class RFQServiceError(RuntimeError):
    def __init__(self, code: str, http_status: int = status.HTTP_500_INTERNAL_SERVER_ERROR):
        super().__init__(code)
        self.code = code
        self.http_status = http_status


class RFQService:
    @staticmethod
    def _employer_id(user: UserResponse) -> str:
        try:
            return ProcurementService._employer_id(user)
        except ProcurementNotFound as exc:
            raise RFQServiceError(str(exc), status.HTTP_404_NOT_FOUND) from exc
        except PermissionError as exc:
            raise RFQServiceError(str(exc), status.HTTP_403_FORBIDDEN) from exc
        except ProcurementServiceError as exc:
            raise RFQServiceError(str(exc)) from exc

    @staticmethod
    def _rows(response: Any) -> list[dict[str, Any]]:
        data = getattr(response, "data", None)
        return data if isinstance(data, list) else []

    @staticmethod
    def _row(response: Any) -> dict[str, Any]:
        data = getattr(response, "data", None)
        if isinstance(data, list):
            return data[0] if data else {}
        return data or {}

    @staticmethod
    def _visible_rfq(row: dict[str, Any]) -> dict[str, Any]:
        result = dict(row)
        deadline = datetime.fromisoformat(str(result["quotation_deadline"]).replace("Z", "+00:00"))
        if deadline <= datetime.now(timezone.utc):
            result["status"] = "CLOSED"
        return result

    @classmethod
    def _buyer_response(cls, row: dict[str, Any]) -> ProcurementRFQResponse:
        return cls._buyer_responses([row])[0]

    @classmethod
    def _buyer_responses(
        cls,
        rows: list[dict[str, Any]],
    ) -> list[ProcurementRFQResponse]:
        if not rows:
            return []
        rfq_ids = list(dict.fromkeys(str(row["id"]) for row in rows))
        recipient_rows: list[dict[str, Any]] = []
        for start in range(0, len(rfq_ids), RFQ_RECIPIENT_QUERY_BATCH_SIZE):
            recipient_rows.extend(cls._rows(
                supabase.table("procurement_rfq_recipients")
                .select("rfq_id, company_id, offering_id, status, response_note, responded_at")
                .in_("rfq_id", rfq_ids[start:start + RFQ_RECIPIENT_QUERY_BATCH_SIZE])
                .order("created_at")
                .execute()
            ))
        company_ids = list(dict.fromkeys(
            str(item["company_id"]) for item in recipient_rows if item.get("company_id")
        ))
        companies: dict[str, str] = {}
        for start in range(0, len(company_ids), RFQ_COMPANY_QUERY_BATCH_SIZE):
            companies.update({
                str(item["id"]): str(item["name"])
                for item in cls._rows(
                    supabase.table("supplier_companies")
                    .select("id, name")
                    .in_("id", company_ids[start:start + RFQ_COMPANY_QUERY_BATCH_SIZE])
                    .execute()
                )
            })
        recipients_by_rfq: dict[str, list[ProcurementRFQRecipient]] = {}
        quotation_rows = cls._rows(
            supabase.table("procurement_supplier_quotations")
            .select(
                "id, rfq_id, company_id, unit_price, currency, quantity_offered, unit, "
                "estimated_delivery_lead_time_days, quotation_valid_until, delivery_terms, "
                "notes, revision, submitted_at, updated_at"
            )
            .in_("rfq_id", rfq_ids)
            .execute()
        )
        quotations_by_recipient = {
            (str(item["rfq_id"]), str(item["company_id"])): SupplierQuotationResponse.model_validate(item)
            for item in quotation_rows
        }
        for item in recipient_rows:
            recipient = ProcurementRFQRecipient(
                company_id=item["company_id"],
                company_name=companies.get(str(item["company_id"]), "Supplier company"),
                offering_id=item["offering_id"],
                status=item["status"],
                response_note=item.get("response_note"),
                responded_at=item.get("responded_at"),
                quotation=quotations_by_recipient.get(
                    (str(item["rfq_id"]), str(item["company_id"]))
                ),
            )
            recipients_by_rfq.setdefault(str(item["rfq_id"]), []).append(recipient)
        return [
            ProcurementRFQResponse.model_validate({
                **cls._visible_rfq(row),
                "recipients": recipients_by_rfq.get(str(row["id"]), []),
            })
            for row in rows
        ]

    @classmethod
    def create(
        cls,
        user: UserResponse,
        request: ProcurementRFQCreateRequest,
    ) -> ProcurementRFQResponse:
        employer_id = cls._employer_id(user)
        try:
            material_request = ProcurementService._owned_request(
                request.material_request_id,
                user,
                employer_id,
            )
        except ProcurementNotFound as exc:
            raise RFQServiceError(str(exc), status.HTTP_404_NOT_FOUND) from exc
        delivery_location = (
            material_request.get("delivery_location")
            or request.delivery_location
            or ProcurementService._procurement_settings(user).default_delivery_location
        )
        if not delivery_location:
            raise RFQServiceError("RFQ_DELIVERY_LOCATION_REQUIRED", status.HTTP_422_UNPROCESSABLE_ENTITY)

        payload = {
            "material_request_id": str(request.material_request_id),
            "item_name": str(material_request["item_name"]),
            "specification": material_request.get("specification"),
            "quantity": str(Decimal(str(material_request["quantity"]))),
            "unit": str(material_request["unit"]),
            "delivery_location": delivery_location,
            "quotation_deadline": request.quotation_deadline.isoformat(),
            "buyer_notes": request.buyer_notes,
            "supplier_company_ids": sorted(str(company_id) for company_id in request.supplier_company_ids),
        }
        payload_hash = hashlib.sha256(
            json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        try:
            existing = cls._row(
                supabase.table("procurement_rfqs")
                .select(
                    "id, user_id, employer_id, material_request_id, idempotency_key, "
                    "payload_hash, item_name, specification, quantity, unit, "
                    "delivery_location, quotation_deadline, buyer_notes, status, created_at"
                )
                .eq("employer_id", employer_id)
                .eq("user_id", str(user.id))
                .eq("idempotency_key", str(request.idempotency_key))
                .maybe_single()
                .execute()
            )
        except Exception as exc:
            logger.exception("RFQ idempotency lookup failed: user_id=%s", user.id)
            raise RFQServiceError("RFQ_CREATE_FAILED") from exc
        if existing:
            if (
                existing.get("payload_hash") != payload_hash
                or str(existing.get("material_request_id")) != str(request.material_request_id)
            ):
                raise RFQServiceError("RFQ_IDEMPOTENCY_CONFLICT", status.HTTP_409_CONFLICT)
            return cls._buyer_response(existing)

        try:
            discovery = ProcurementService.discover_supplier_offerings(
                user,
                request.material_request_id,
                delivery_location_override=delivery_location,
            )
        except ProcurementServiceError as exc:
            raise RFQServiceError(str(exc), status.HTTP_503_SERVICE_UNAVAILABLE) from exc

        offering_by_company: dict[str, str] = {}
        for match in discovery.matches:
            offering_by_company.setdefault(
                str(match.supplier_company_id),
                str(match.offering_id),
            )
        missing_companies = [
            str(company_id)
            for company_id in request.supplier_company_ids
            if str(company_id) not in offering_by_company
        ]
        if missing_companies:
            raise RFQServiceError(
                "RFQ_SUPPLIER_INELIGIBLE",
                status.HTTP_409_CONFLICT,
            )

        recipients = [
            {
                "company_id": str(company_id),
                "offering_id": offering_by_company[str(company_id)],
            }
            for company_id in request.supplier_company_ids
        ]

        try:
            result = cls._row(
                supabase.rpc(
                    "create_procurement_rfq",
                    {
                        "p_user_id": str(user.id),
                        "p_employer_id": employer_id,
                        "p_material_request_id": str(request.material_request_id),
                        "p_idempotency_key": str(request.idempotency_key),
                        "p_payload_hash": payload_hash,
                        "p_item_name": payload["item_name"],
                        "p_specification": payload["specification"],
                        "p_quantity": payload["quantity"],
                        "p_unit": payload["unit"],
                        "p_delivery_location": payload["delivery_location"],
                        "p_quotation_deadline": payload["quotation_deadline"],
                        "p_buyer_notes": payload["buyer_notes"],
                        "p_recipients": recipients,
                    },
                ).execute()
            )
        except Exception as exc:
            logger.exception("RFQ create RPC failed: user_id=%s", user.id)
            error_message = str(getattr(exc, "message", None) or exc)
            if "RFQ_SUPPLIER_INELIGIBLE" in error_message:
                raise RFQServiceError(
                    "RFQ_SUPPLIER_INELIGIBLE",
                    status.HTTP_409_CONFLICT,
                ) from exc
            raise RFQServiceError("RFQ_CREATE_FAILED") from exc

        if result.get("ok") is not True:
            code = str(result.get("error_code") or "RFQ_CREATE_FAILED")
            errors = {
                "PROCUREMENT_FORBIDDEN": (code, status.HTTP_403_FORBIDDEN),
                "MATERIAL_REQUEST_NOT_FOUND": (code, status.HTTP_404_NOT_FOUND),
                "RFQ_SUPPLIER_INELIGIBLE": (code, status.HTTP_409_CONFLICT),
                "RFQ_DEADLINE_INVALID": (code, status.HTTP_422_UNPROCESSABLE_ENTITY),
                "RFQ_RECIPIENTS_INVALID": (code, status.HTTP_422_UNPROCESSABLE_ENTITY),
                "RFQ_IDEMPOTENCY_CONFLICT": (code, status.HTTP_409_CONFLICT),
            }
            error_code, http_status = errors.get(code, (code, status.HTTP_500_INTERNAL_SERVER_ERROR))
            raise RFQServiceError(error_code, http_status)

        rfq_id = result.get("rfq_id")
        if not rfq_id:
            raise RFQServiceError("RFQ_CREATE_FAILED")
        row = cls._row(
            supabase.table("procurement_rfqs")
            .select(
                "id, material_request_id, item_name, specification, quantity, unit, "
                "delivery_location, quotation_deadline, buyer_notes, status, created_at"
            )
            .eq("id", str(rfq_id))
            .eq("user_id", str(user.id))
            .eq("employer_id", employer_id)
            .single()
            .execute()
        )
        if not row:
            raise RFQServiceError("RFQ_CREATE_RESULT_NOT_FOUND")
        return cls._buyer_response(row)

    @classmethod
    def list_buyer(cls, user: UserResponse) -> list[ProcurementRFQResponse]:
        employer_id = cls._employer_id(user)
        rows = cls._rows(
            supabase.table("procurement_rfqs")
            .select(
                "id, material_request_id, item_name, specification, quantity, unit, "
                "delivery_location, quotation_deadline, buyer_notes, status, created_at"
            )
            .eq("user_id", str(user.id))
            .eq("employer_id", employer_id)
            .order("created_at", desc=True)
            .limit(RFQ_LIST_LIMIT)
            .execute()
        )
        return cls._buyer_responses(rows)

    @classmethod
    def get_buyer(cls, user: UserResponse, rfq_id: UUID) -> ProcurementRFQResponse:
        employer_id = cls._employer_id(user)
        row = cls._row(
            supabase.table("procurement_rfqs")
            .select(
                "id, material_request_id, item_name, specification, quantity, unit, "
                "delivery_location, quotation_deadline, buyer_notes, status, created_at"
            )
            .eq("id", str(rfq_id))
            .eq("user_id", str(user.id))
            .eq("employer_id", employer_id)
            .maybe_single()
            .execute()
        )
        if not row:
            raise RFQServiceError("RFQ_NOT_FOUND", status.HTTP_404_NOT_FOUND)
        return cls._buyer_response(row)

    @classmethod
    def list_supplier(
        cls,
        company_id: UUID,
    ) -> list[SupplierRFQResponse]:
        recipient_rows = cls._rows(
            supabase.table("procurement_rfq_recipients")
            .select("rfq_id, status, response_note, responded_at, created_at")
            .eq("company_id", str(company_id))
            .order("created_at", desc=True)
            .limit(RFQ_LIST_LIMIT)
            .execute()
        )
        if not recipient_rows:
            return []
        rfq_ids = list(dict.fromkeys(str(row["rfq_id"]) for row in recipient_rows))
        rfqs = {
            str(row["id"]): row
            for row in cls._rows(
                supabase.table("procurement_rfqs")
                .select(
                    "id, item_name, specification, quantity, unit, delivery_location, "
                    "quotation_deadline, buyer_notes, status, created_at"
                )
                .in_("id", rfq_ids)
                .order("created_at", desc=True)
                .execute()
            )
        }
        quotation_rows = cls._rows(
            supabase.table("procurement_supplier_quotations")
            .select(
                "id, rfq_id, company_id, unit_price, currency, quantity_offered, unit, "
                "estimated_delivery_lead_time_days, quotation_valid_until, delivery_terms, "
                "notes, revision, submitted_at, updated_at"
            )
            .eq("company_id", str(company_id))
            .in_("rfq_id", rfq_ids)
            .execute()
        )
        quotations = {
            str(row["rfq_id"]): SupplierQuotationResponse.model_validate(row)
            for row in quotation_rows
        }
        return [
            SupplierRFQResponse.model_validate({
                **cls._visible_rfq(rfqs[str(row["rfq_id"])]),
                "recipient_status": row["status"],
                "response_note": row.get("response_note"),
                "responded_at": row.get("responded_at"),
                "quotation": quotations.get(str(row["rfq_id"])),
            })
            for row in recipient_rows
            if str(row["rfq_id"]) in rfqs
        ]

    @classmethod
    def get_supplier(
        cls,
        company_id: UUID,
        rfq_id: UUID,
    ) -> SupplierRFQResponse:
        recipient = cls._row(
            supabase.table("procurement_rfq_recipients")
            .select("status, response_note, responded_at")
            .eq("rfq_id", str(rfq_id))
            .eq("company_id", str(company_id))
            .maybe_single()
            .execute()
        )
        if not recipient:
            raise RFQServiceError("RFQ_NOT_FOUND", status.HTTP_404_NOT_FOUND)
        row = cls._row(
            supabase.table("procurement_rfqs")
            .select(
                "id, item_name, specification, quantity, unit, delivery_location, "
                "quotation_deadline, buyer_notes, status, created_at"
            )
            .eq("id", str(rfq_id))
            .maybe_single()
            .execute()
        )
        if not row:
            raise RFQServiceError("RFQ_NOT_FOUND", status.HTTP_404_NOT_FOUND)
        quotation_row = cls._row(
            supabase.table("procurement_supplier_quotations")
            .select(
                "id, rfq_id, company_id, unit_price, currency, quantity_offered, unit, "
                "estimated_delivery_lead_time_days, quotation_valid_until, delivery_terms, "
                "notes, revision, submitted_at, updated_at"
            )
            .eq("rfq_id", str(rfq_id))
            .eq("company_id", str(company_id))
            .maybe_single()
            .execute()
        )
        return SupplierRFQResponse.model_validate({
            **cls._visible_rfq(row),
            "recipient_status": recipient["status"],
            "response_note": recipient.get("response_note"),
            "responded_at": recipient.get("responded_at"),
            "quotation": SupplierQuotationResponse.model_validate(quotation_row)
            if quotation_row else None,
        })

    @classmethod
    def submit_quotation(
        cls,
        user: UserResponse,
        company_id: UUID,
        rfq_id: UUID,
        request: SupplierQuotationRequest,
    ) -> SupplierQuotationResult:
        try:
            result = cls._row(
                supabase.rpc(
                    "submit_procurement_supplier_quotation",
                    {
                        "p_user_id": str(user.id),
                        "p_company_id": str(company_id),
                        "p_rfq_id": str(rfq_id),
                        "p_unit_price": str(request.unit_price),
                        "p_currency": request.currency,
                        "p_quantity_offered": str(request.quantity_offered),
                        "p_unit": request.unit,
                        "p_estimated_delivery_lead_time_days": request.estimated_delivery_lead_time_days,
                        "p_quotation_valid_until": request.quotation_valid_until.isoformat(),
                        "p_delivery_terms": request.delivery_terms,
                        "p_notes": request.notes,
                        "p_expected_revision": request.expected_revision,
                    },
                ).execute()
            )
        except Exception as exc:
            logger.exception(
                "Supplier quotation submission failed: user_id=%s company_id=%s rfq_id=%s",
                user.id,
                company_id,
                rfq_id,
            )
            raise RFQServiceError("QUOTATION_SUBMISSION_FAILED") from exc

        if result.get("ok") is not True:
            code = str(result.get("error_code") or "QUOTATION_SUBMISSION_FAILED")
            errors = {
                "SUPPLIER_COMPANY_MEMBERSHIP_NOT_FOUND": (code, status.HTTP_404_NOT_FOUND),
                "RFQ_NOT_FOUND": (code, status.HTTP_404_NOT_FOUND),
                "RFQ_CLOSED": (code, status.HTTP_409_CONFLICT),
                "RFQ_INVITATION_DECLINED": (code, status.HTTP_409_CONFLICT),
                "QUOTATION_STALE": (code, status.HTTP_409_CONFLICT),
                "QUOTATION_VALIDITY_INVALID": (code, status.HTTP_422_UNPROCESSABLE_ENTITY),
                "QUOTATION_INVALID": (code, status.HTTP_422_UNPROCESSABLE_ENTITY),
            }
            error_code, http_status = errors.get(
                code,
                (code, status.HTTP_500_INTERNAL_SERVER_ERROR),
            )
            raise RFQServiceError(error_code, http_status)

        quotation = result.get("quotation")
        if not isinstance(quotation, dict):
            raise RFQServiceError("QUOTATION_SUBMISSION_FAILED")
        return SupplierQuotationResult(
            rfq_id=rfq_id,
            **SupplierQuotationResponse.model_validate(quotation).model_dump(),
        )

    @classmethod
    def respond_supplier(
        cls,
        user: UserResponse,
        company_id: UUID,
        rfq_id: UUID,
        request: SupplierRFQResponseRequest,
    ) -> SupplierRFQResponseResult:
        try:
            result = cls._row(
                supabase.rpc(
                    "respond_to_procurement_rfq",
                    {
                        "p_user_id": str(user.id),
                        "p_company_id": str(company_id),
                        "p_rfq_id": str(rfq_id),
                        "p_status": request.status,
                        "p_response_note": request.response_note,
                    },
                ).execute()
            )
        except Exception as exc:
            logger.exception(
                "Supplier RFQ response RPC failed: user_id=%s company_id=%s rfq_id=%s",
                user.id,
                company_id,
                rfq_id,
            )
            raise RFQServiceError("RFQ_RESPONSE_FAILED") from exc

        if result.get("ok") is not True:
            code = str(result.get("error_code") or "RFQ_RESPONSE_FAILED")
            errors = {
                "SUPPLIER_COMPANY_MEMBERSHIP_NOT_FOUND": (code, status.HTTP_404_NOT_FOUND),
                "RFQ_NOT_FOUND": (code, status.HTTP_404_NOT_FOUND),
                "RFQ_CLOSED": (code, status.HTTP_409_CONFLICT),
                "RFQ_ALREADY_RESPONDED": (code, status.HTTP_409_CONFLICT),
                "RFQ_RESPONSE_INVALID": (code, status.HTTP_422_UNPROCESSABLE_ENTITY),
            }
            error_code, http_status = errors.get(code, (code, status.HTTP_500_INTERNAL_SERVER_ERROR))
            raise RFQServiceError(error_code, http_status)

        responded_at = result.get("responded_at")
        if not responded_at:
            raise RFQServiceError("RFQ_RESPONSE_FAILED")
        return SupplierRFQResponseResult(
            rfq_id=rfq_id,
            recipient_status=request.status,
            response_note=request.response_note,
            responded_at=responded_at,
        )
