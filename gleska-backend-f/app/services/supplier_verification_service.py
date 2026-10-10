"""Supplier verification document storage and submission operations."""

from __future__ import annotations

import logging
import os
import uuid
from typing import Any
from uuid import UUID

from fastapi import HTTPException, status

from app.core.supabase import supabase
from app.schemas.supplier import (
    SupplierVerificationDocumentResponse,
    SupplierVerificationDocumentType,
)

logger = logging.getLogger(__name__)

SUPPLIER_VERIFICATION_BUCKET = "supplier-verification-documents"
MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024
ALLOWED_MIME_TYPES = {"application/pdf", "image/jpeg", "image/png"}
ALLOWED_EXTENSIONS = {
    "application/pdf": {".pdf"},
    "image/jpeg": {".jpg", ".jpeg"},
    "image/png": {".png"},
}
SIGNED_URL_TTL_SECONDS = 900


class SupplierVerificationService:
    """Persistence boundary for private supplier verification documents."""

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
    def _document_response(row: dict[str, Any]) -> SupplierVerificationDocumentResponse:
        return SupplierVerificationDocumentResponse(
            id=str(row["id"]),
            company_id=str(row["company_id"]),
            document_type=row["document_type"],
            original_filename=row["original_filename"],
            mime_type=row["mime_type"],
            file_size_bytes=row["file_size_bytes"],
            uploaded_at=row["uploaded_at"],
        )

    @staticmethod
    def validate_document(
        filename: str | None,
        mime_type: str | None,
        content: bytes,
    ) -> tuple[str, str]:
        safe_filename = (filename or "").replace("\\", "/").rsplit("/", 1)[-1].strip()
        if (
            not safe_filename
            or len(safe_filename) > 255
            or any(ord(character) < 32 for character in safe_filename)
        ):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="SUPPLIER_DOCUMENT_FILENAME_INVALID")
        if not content or len(content) > MAX_DOCUMENT_SIZE_BYTES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="SUPPLIER_DOCUMENT_SIZE_INVALID")
        normalized_mime = (mime_type or "").split(";", 1)[0].strip().lower()
        extension = os.path.splitext(safe_filename.lower())[1]
        if normalized_mime not in ALLOWED_MIME_TYPES or extension not in ALLOWED_EXTENSIONS[normalized_mime]:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="SUPPLIER_DOCUMENT_TYPE_INVALID")

        valid_signature = (
            normalized_mime == "application/pdf" and content.startswith(b"%PDF-")
        ) or (
            normalized_mime == "image/jpeg" and content.startswith(b"\xff\xd8\xff")
        ) or (
            normalized_mime == "image/png"
            and content.startswith(b"\x89PNG\r\n\x1a\n")
        )
        if not valid_signature:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="SUPPLIER_DOCUMENT_CONTENT_INVALID")
        return safe_filename, normalized_mime

    @staticmethod
    def upload_document(
        company_id: UUID,
        user_id: str,
        document_type: SupplierVerificationDocumentType,
        filename: str | None,
        mime_type: str | None,
        content: bytes,
    ) -> SupplierVerificationDocumentResponse:
        safe_filename, normalized_mime = SupplierVerificationService.validate_document(
            filename, mime_type, content
        )
        try:
            company = SupplierVerificationService._row(
                supabase.table("supplier_companies")
                .select("verification_status")
                .eq("id", str(company_id))
                .maybe_single()
                .execute()
            )
            if not company:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SUPPLIER_COMPANY_NOT_FOUND")
            if company["verification_status"] not in {"NOT_SUBMITTED", "REJECTED"}:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="SUPPLIER_DOCUMENT_UPLOAD_NOT_ALLOWED",
                )

            extension = os.path.splitext(safe_filename.lower())[1]
            storage_path = (
                f"companies/{company_id}/verification/{uuid.uuid4().hex}{extension}"
            )
            supabase.storage.from_(SUPPLIER_VERIFICATION_BUCKET).upload(
                storage_path,
                content,
                file_options={
                    "content-type": normalized_mime,
                    "cache-control": "3600",
                    "upsert": "false",
                },
            )
            try:
                response = (
                    supabase.table("supplier_verification_documents")
                    .insert({
                        "company_id": str(company_id),
                        "document_type": document_type.value,
                        "storage_path": storage_path,
                        "original_filename": safe_filename,
                        "mime_type": normalized_mime,
                        "file_size_bytes": len(content),
                        "uploaded_by": user_id,
                    })
                    .select("id, company_id, document_type, original_filename, mime_type, file_size_bytes, uploaded_at")
                    .single()
                    .execute()
                )
                row = SupplierVerificationService._row(response)
                if not row:
                    raise RuntimeError("Supplier document metadata insert returned no record")
                return SupplierVerificationService._document_response(row)
            except Exception:
                supabase.storage.from_(SUPPLIER_VERIFICATION_BUCKET).remove([storage_path])
                raise
        except HTTPException:
            raise
        except Exception as exc:
            message = str(getattr(exc, "message", None) or exc)
            if "SUPPLIER_DOCUMENT_UPLOAD_NOT_ALLOWED" in message:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="SUPPLIER_DOCUMENT_UPLOAD_NOT_ALLOWED",
                ) from exc
            logger.exception(
                "Supplier verification document upload failed: company_id=%s user_id=%s",
                company_id,
                user_id,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="SUPPLIER_DOCUMENT_UPLOAD_FAILED",
            ) from exc

    @staticmethod
    def list_documents(company_id: UUID) -> list[SupplierVerificationDocumentResponse]:
        try:
            response = (
                supabase.table("supplier_verification_documents")
                .select("id, company_id, document_type, original_filename, mime_type, file_size_bytes, uploaded_at")
                .eq("company_id", str(company_id))
                .order("uploaded_at", desc=True)
                .execute()
            )
            return [
                SupplierVerificationService._document_response(row)
                for row in SupplierVerificationService._rows(response)
            ]
        except Exception as exc:
            logger.exception("Supplier verification documents could not be listed: company_id=%s", company_id)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="SUPPLIER_DOCUMENT_LIST_FAILED",
            ) from exc

    @staticmethod
    def get_document_url(company_id: UUID, document_id: UUID) -> str:
        try:
            row = SupplierVerificationService._row(
                supabase.table("supplier_verification_documents")
                .select("storage_path")
                .eq("company_id", str(company_id))
                .eq("id", str(document_id))
                .maybe_single()
                .execute()
            )
            if not row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SUPPLIER_DOCUMENT_NOT_FOUND")
            signed = supabase.storage.from_(SUPPLIER_VERIFICATION_BUCKET).create_signed_url(
                row["storage_path"],
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
                "Supplier verification document URL could not be created: company_id=%s document_id=%s",
                company_id,
                document_id,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="SUPPLIER_DOCUMENT_URL_FAILED",
            ) from exc

    @staticmethod
    def submit(company_id: UUID, user_id: str) -> dict[str, Any]:
        try:
            response = supabase.rpc(
                "submit_supplier_verification",
                {"p_company_id": str(company_id), "p_user_id": user_id},
            ).execute()
            row = SupplierVerificationService._row(response)
            if not row:
                raise RuntimeError("Supplier verification submission returned no company")
            return row
        except Exception as exc:
            message = str(getattr(exc, "message", None) or exc)
            for code, http_status in {
                "SUPPLIER_VERIFICATION_SUBMISSION_FORBIDDEN": status.HTTP_403_FORBIDDEN,
                "SUPPLIER_COMPANY_NOT_FOUND": status.HTTP_404_NOT_FOUND,
                "SUPPLIER_COMPANY_NOT_OPERATIONAL": status.HTTP_409_CONFLICT,
                "SUPPLIER_VERIFICATION_SUBMISSION_NOT_ALLOWED": status.HTTP_409_CONFLICT,
                "SUPPLIER_VERIFICATION_DOCUMENT_REQUIRED": status.HTTP_400_BAD_REQUEST,
            }.items():
                if code in message:
                    raise HTTPException(status_code=http_status, detail=code) from exc
            logger.exception("Supplier verification submission failed: company_id=%s", company_id)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="SUPPLIER_VERIFICATION_SUBMISSION_FAILED",
            ) from exc
