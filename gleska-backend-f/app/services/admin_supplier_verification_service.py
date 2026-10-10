"""Admin queue and decisions for supplier verification."""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from fastapi import HTTPException, status

from app.core.supabase import supabase
from app.schemas.supplier import SupplierVerificationStatus
from app.schemas.supplier_verification import (
    SupplierVerificationAdminDetail,
    SupplierVerificationAdminDocument,
    SupplierVerificationAdminEvent,
    SupplierVerificationQueueItem,
)
from app.services.supplier_verification_service import (
    SIGNED_URL_TTL_SECONDS,
    SUPPLIER_VERIFICATION_BUCKET,
)

logger = logging.getLogger(__name__)


class AdminSupplierVerificationService:
    """Persistence boundary for admin supplier verification review."""

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
    def list_queue(
        verification_status: SupplierVerificationStatus = SupplierVerificationStatus.PENDING_REVIEW,
    ) -> list[SupplierVerificationQueueItem]:
        try:
            response = (
                supabase.table("supplier_companies")
                .select("id, name, verification_status, verification_submitted_at, created_at")
                .eq("verification_status", verification_status.value)
                .order("verification_submitted_at", desc=True)
                .limit(100)
                .execute()
            )
            return [
                SupplierVerificationQueueItem(
                    id=str(row["id"]),
                    name=row["name"],
                    verification_status=row["verification_status"],
                    verification_submitted_at=row.get("verification_submitted_at"),
                    created_at=row["created_at"],
                )
                for row in AdminSupplierVerificationService._rows(response)
            ]
        except Exception as exc:
            logger.exception("Admin supplier verification queue failed")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="ADMIN_SUPPLIER_VERIFICATION_QUEUE_FAILED",
            ) from exc

    @staticmethod
    def get_detail(company_id: UUID) -> SupplierVerificationAdminDetail:
        try:
            company = AdminSupplierVerificationService._row(
                supabase.table("supplier_companies")
                .select(
                    "id, name, description, website, operational_status, verification_status, "
                    "verification_submitted_at, verification_reviewed_at, verification_reviewed_by, "
                    "verification_reason, created_at"
                )
                .eq("id", str(company_id))
                .maybe_single()
                .execute()
            )
            if not company:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SUPPLIER_COMPANY_NOT_FOUND")
            private_profile = AdminSupplierVerificationService._row(
                supabase.table("supplier_company_private_profiles")
                .select("registered_name, registration_number, contact_email, contact_phone, registered_address")
                .eq("company_id", str(company_id))
                .maybe_single()
                .execute()
            )
            documents = AdminSupplierVerificationService._rows(
                supabase.table("supplier_verification_documents")
                .select("id, document_type, original_filename, mime_type, file_size_bytes, uploaded_at")
                .eq("company_id", str(company_id))
                .order("uploaded_at", desc=True)
                .execute()
            )
            events = AdminSupplierVerificationService._rows(
                supabase.table("supplier_verification_events")
                .select("id, actor_user_id, previous_status, new_status, reason, created_at")
                .eq("company_id", str(company_id))
                .order("created_at", desc=True)
                .limit(100)
                .execute()
            )
            actor_ids = list(dict.fromkeys(
                event["actor_user_id"] for event in events if event.get("actor_user_id")
            ))
            actors = (
                AdminSupplierVerificationService._rows(
                    supabase.table("users").select("id, name").in_("id", actor_ids).execute()
                )
                if actor_ids
                else []
            )
            actor_names = {str(actor["id"]): actor.get("name") for actor in actors}
            return SupplierVerificationAdminDetail(
                **company,
                **private_profile,
                documents=[
                    SupplierVerificationAdminDocument(**document)
                    for document in documents
                ],
                events=[
                    SupplierVerificationAdminEvent(
                        id=str(event["id"]),
                        actor_user_id=(
                            str(event["actor_user_id"])
                            if event.get("actor_user_id")
                            else None
                        ),
                        actor_name=(
                            actor_names.get(str(event["actor_user_id"]))
                            if event.get("actor_user_id")
                            else None
                        ),
                        previous_status=event.get("previous_status"),
                        new_status=event["new_status"],
                        reason=event.get("reason"),
                        created_at=event["created_at"],
                    )
                    for event in events
                ],
            )
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception(
                "Admin supplier verification detail failed: company_id=%s",
                company_id,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="ADMIN_SUPPLIER_VERIFICATION_DETAIL_FAILED",
            ) from exc

    @staticmethod
    def get_document_url(company_id: UUID, document_id: UUID) -> str:
        try:
            document = AdminSupplierVerificationService._row(
                supabase.table("supplier_verification_documents")
                .select("storage_path")
                .eq("company_id", str(company_id))
                .eq("id", str(document_id))
                .maybe_single()
                .execute()
            )
            if not document:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SUPPLIER_DOCUMENT_NOT_FOUND")
            signed = supabase.storage.from_(SUPPLIER_VERIFICATION_BUCKET).create_signed_url(
                document["storage_path"],
                SIGNED_URL_TTL_SECONDS,
            )
            url = signed.get("signedURL") or signed.get("signedUrl")
            if not url:
                raise RuntimeError("Supplier document signed URL response was empty")
            return url
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception(
                "Admin supplier document URL failed: company_id=%s document_id=%s",
                company_id,
                document_id,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="ADMIN_SUPPLIER_DOCUMENT_URL_FAILED",
            ) from exc

    @staticmethod
    def review(
        company_id: UUID,
        reviewer_id: str,
        new_status: SupplierVerificationStatus,
        reason: str | None,
    ) -> dict[str, Any]:
        normalized_reason = reason.strip() if reason and reason.strip() else None
        if new_status in {
            SupplierVerificationStatus.REJECTED,
            SupplierVerificationStatus.SUSPENDED,
        } and normalized_reason is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="SUPPLIER_VERIFICATION_REASON_REQUIRED",
            )
        try:
            response = supabase.rpc(
                "review_supplier_verification",
                {
                    "p_company_id": str(company_id),
                    "p_reviewer_id": reviewer_id,
                    "p_new_status": new_status.value,
                    "p_reason": normalized_reason,
                },
            ).execute()
            row = AdminSupplierVerificationService._row(response)
            if not row:
                raise RuntimeError("Supplier review returned no company")
            return row
        except Exception as exc:
            message = str(getattr(exc, "message", None) or exc)
            error_codes = {
                "SUPPLIER_VERIFICATION_ADMIN_REQUIRED": status.HTTP_403_FORBIDDEN,
                "SUPPLIER_COMPANY_NOT_FOUND": status.HTTP_404_NOT_FOUND,
                "SUPPLIER_VERIFICATION_STATUS_INVALID": status.HTTP_400_BAD_REQUEST,
                "SUPPLIER_VERIFICATION_REASON_REQUIRED": status.HTTP_422_UNPROCESSABLE_ENTITY,
                "SUPPLIER_VERIFICATION_TRANSITION_NOT_ALLOWED": status.HTTP_409_CONFLICT,
            }
            for code, http_status in error_codes.items():
                if code in message:
                    raise HTTPException(status_code=http_status, detail=code) from exc
            logger.exception(
                "Admin supplier verification review failed: company_id=%s status=%s",
                company_id,
                new_status.value,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="ADMIN_SUPPLIER_VERIFICATION_REVIEW_FAILED",
            ) from exc
