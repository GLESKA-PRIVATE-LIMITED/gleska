"""Company-scoped supplier material offering operations."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, NoReturn
from uuid import UUID

from fastapi import HTTPException, status
from pydantic import ValidationError

from app.core.supabase import supabase
from app.schemas.supplier_offering import (
    SupplierMaterialOfferingCreateRequest,
    SupplierMaterialOfferingPatchRequest,
    SupplierMaterialOfferingResponse,
)

logger = logging.getLogger(__name__)


class SupplierOfferingService:
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
    def _response(row: dict[str, Any]) -> SupplierMaterialOfferingResponse:
        return SupplierMaterialOfferingResponse.model_validate(row)

    @staticmethod
    def _database_error(operation: str, company_id: UUID, exc: Exception) -> NoReturn:
        message = str(getattr(exc, "message", None) or exc)
        if "SUPPLIER_OFFERING_WRITE_NOT_ALLOWED" in message:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="SUPPLIER_OFFERING_WRITE_NOT_ALLOWED",
            ) from exc
        logger.exception(
            "Supplier offering %s failed: company_id=%s",
            operation,
            company_id,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"SUPPLIER_OFFERING_{operation.upper()}_FAILED",
        ) from exc

    @classmethod
    def list_offerings(
        cls,
        company_id: UUID,
        include_archived: bool,
    ) -> list[SupplierMaterialOfferingResponse]:
        try:
            query = (
                supabase.table("supplier_material_offerings")
                .select(
                    "id, company_id, name, specification, unit, indicative_price, "
                    "currency_code, minimum_order_quantity, is_available, "
                    "service_coverage, revision, archived_at, created_at, updated_at"
                )
                .eq("company_id", str(company_id))
            )
            if not include_archived:
                query = query.is_("archived_at", "null")
            rows = query.order("updated_at", desc=True).limit(200).execute()
            return [cls._response(row) for row in cls._rows(rows)]
        except Exception as exc:
            cls._database_error("list", company_id, exc)

    @classmethod
    def create_offering(
        cls,
        company_id: UUID,
        user_id: str,
        request: SupplierMaterialOfferingCreateRequest,
    ) -> SupplierMaterialOfferingResponse:
        try:
            response = (
                supabase.table("supplier_material_offerings")
                .insert({
                    **request.model_dump(mode="json"),
                    "company_id": str(company_id),
                    "created_by": str(user_id),
                    "updated_by": str(user_id),
                })
                .select(
                    "id, company_id, name, specification, unit, indicative_price, "
                    "currency_code, minimum_order_quantity, is_available, "
                    "service_coverage, revision, archived_at, created_at, updated_at"
                )
                .single()
                .execute()
            )
            row = cls._row(response)
            if not row:
                raise RuntimeError("Offering insert returned no record.")
            return cls._response(row)
        except Exception as exc:
            cls._database_error("create", company_id, exc)

    @classmethod
    def update_offering(
        cls,
        company_id: UUID,
        offering_id: UUID,
        user_id: str,
        request: SupplierMaterialOfferingPatchRequest,
    ) -> SupplierMaterialOfferingResponse:
        try:
            existing = cls._row(
                supabase.table("supplier_material_offerings")
                .select(
                    "id, company_id, name, specification, unit, indicative_price, "
                    "currency_code, minimum_order_quantity, is_available, "
                    "service_coverage, revision, archived_at, created_at, updated_at"
                )
                .eq("id", str(offering_id))
                .eq("company_id", str(company_id))
                .maybe_single()
                .execute()
            )
            if not existing:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="SUPPLIER_OFFERING_NOT_FOUND",
                )
            if existing.get("archived_at") is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="SUPPLIER_OFFERING_ARCHIVED",
                )
            if int(existing["revision"]) != request.expected_revision:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="SUPPLIER_OFFERING_STALE",
                )

            updates = request.model_dump(
                mode="json",
                exclude_unset=True,
                exclude={"expected_revision"},
            )
            candidate = {
                key: existing.get(key)
                for key in (
                    "name",
                    "specification",
                    "unit",
                    "indicative_price",
                    "currency_code",
                    "minimum_order_quantity",
                    "is_available",
                    "service_coverage",
                )
            }
            candidate.update(updates)
            try:
                validated = SupplierMaterialOfferingCreateRequest.model_validate(candidate)
            except ValidationError as exc:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="SUPPLIER_OFFERING_INVALID",
                ) from exc
            response = (
                supabase.table("supplier_material_offerings")
                .update({
                    **validated.model_dump(mode="json"),
                    "updated_by": str(user_id),
                    "revision": request.expected_revision + 1,
                })
                .eq("id", str(offering_id))
                .eq("company_id", str(company_id))
                .eq("revision", request.expected_revision)
                .is_("archived_at", "null")
                .select(
                    "id, company_id, name, specification, unit, indicative_price, "
                    "currency_code, minimum_order_quantity, is_available, "
                    "service_coverage, revision, archived_at, created_at, updated_at"
                )
                .execute()
            )
            row = cls._row(response)
            if not row:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="SUPPLIER_OFFERING_STALE",
                )
            return cls._response(row)
        except HTTPException:
            raise
        except Exception as exc:
            cls._database_error("update", company_id, exc)

    @classmethod
    def archive_offering(
        cls,
        company_id: UUID,
        offering_id: UUID,
        user_id: str,
        expected_revision: int,
    ) -> SupplierMaterialOfferingResponse:
        try:
            response = (
                supabase.table("supplier_material_offerings")
                .update({
                    "archived_at": datetime.now(timezone.utc).isoformat(),
                    "updated_by": str(user_id),
                    "revision": expected_revision + 1,
                })
                .eq("id", str(offering_id))
                .eq("company_id", str(company_id))
                .eq("revision", expected_revision)
                .is_("archived_at", "null")
                .select(
                    "id, company_id, name, specification, unit, indicative_price, "
                    "currency_code, minimum_order_quantity, is_available, "
                    "service_coverage, revision, archived_at, created_at, updated_at"
                )
                .execute()
            )
            row = cls._row(response)
            if not row:
                existing = cls._row(
                    supabase.table("supplier_material_offerings")
                    .select("id, archived_at")
                    .eq("id", str(offering_id))
                    .eq("company_id", str(company_id))
                    .maybe_single()
                    .execute()
                )
                if not existing:
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail="SUPPLIER_OFFERING_NOT_FOUND",
                    )
                detail = (
                    "SUPPLIER_OFFERING_ARCHIVED"
                    if existing.get("archived_at") is not None
                    else "SUPPLIER_OFFERING_STALE"
                )
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=detail,
                )
            return cls._response(row)
        except HTTPException:
            raise
        except Exception as exc:
            cls._database_error("archive", company_id, exc)
