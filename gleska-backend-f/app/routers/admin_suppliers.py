"""Admin-only supplier verification review endpoints."""

from uuid import UUID

from fastapi import APIRouter, Depends

from app.core.security import require_admin
from app.schemas.auth import UserResponse
from app.schemas.supplier import SupplierVerificationStatus
from app.schemas.supplier_verification import (
    SupplierVerificationAdminDetail,
    SupplierVerificationDecisionRequest,
    SupplierVerificationQueueItem,
)
from app.services.admin_supplier_verification_service import (
    AdminSupplierVerificationService,
)
from app.services.supplier_verification_service import SIGNED_URL_TTL_SECONDS

router = APIRouter(prefix="/admin/suppliers", tags=["admin-suppliers"])


@router.get(
    "/verification",
    response_model=list[SupplierVerificationQueueItem],
)
async def list_supplier_verification_queue(
    verification_status: SupplierVerificationStatus = SupplierVerificationStatus.PENDING_REVIEW,
    admin: UserResponse = Depends(require_admin),
):
    del admin
    return AdminSupplierVerificationService.list_queue(verification_status)


@router.get(
    "/{company_id}/verification",
    response_model=SupplierVerificationAdminDetail,
)
async def get_supplier_verification_detail(
    company_id: UUID,
    admin: UserResponse = Depends(require_admin),
):
    del admin
    return AdminSupplierVerificationService.get_detail(company_id)


@router.get("/{company_id}/documents/{document_id}/url")
async def get_supplier_verification_document_url(
    company_id: UUID,
    document_id: UUID,
    admin: UserResponse = Depends(require_admin),
):
    del admin
    return {
        "url": AdminSupplierVerificationService.get_document_url(company_id, document_id),
        "expires_in": SIGNED_URL_TTL_SECONDS,
    }


async def _review_supplier(
    company_id: UUID,
    new_status: SupplierVerificationStatus,
    request: SupplierVerificationDecisionRequest,
    admin: UserResponse,
):
    company = AdminSupplierVerificationService.review(
        company_id,
        str(admin.id),
        new_status,
        request.reason,
    )
    return {
        "company_id": str(company["id"]),
        "verification_status": company["verification_status"],
        "verification_reviewed_at": company.get("verification_reviewed_at"),
        "verification_reviewed_by": company.get("verification_reviewed_by"),
        "verification_reason": company.get("verification_reason"),
    }


@router.post("/{company_id}/verification/approve")
async def approve_supplier_verification(
    company_id: UUID,
    request: SupplierVerificationDecisionRequest,
    admin: UserResponse = Depends(require_admin),
):
    return await _review_supplier(
        company_id,
        SupplierVerificationStatus.VERIFIED,
        request,
        admin,
    )


@router.post("/{company_id}/verification/reject")
async def reject_supplier_verification(
    company_id: UUID,
    request: SupplierVerificationDecisionRequest,
    admin: UserResponse = Depends(require_admin),
):
    return await _review_supplier(
        company_id,
        SupplierVerificationStatus.REJECTED,
        request,
        admin,
    )


@router.post("/{company_id}/verification/suspend")
async def suspend_supplier_verification(
    company_id: UUID,
    request: SupplierVerificationDecisionRequest,
    admin: UserResponse = Depends(require_admin),
):
    return await _review_supplier(
        company_id,
        SupplierVerificationStatus.SUSPENDED,
        request,
        admin,
    )


@router.post("/{company_id}/verification/reinstate")
async def reinstate_supplier_verification(
    company_id: UUID,
    request: SupplierVerificationDecisionRequest,
    admin: UserResponse = Depends(require_admin),
):
    return await _review_supplier(
        company_id,
        SupplierVerificationStatus.VERIFIED,
        request,
        admin,
    )
