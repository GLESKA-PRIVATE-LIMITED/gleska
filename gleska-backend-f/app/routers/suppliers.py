"""Authenticated supplier identity and membership endpoints."""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile, status

from app.core.security import get_current_user
from app.core.supplier_access import require_supplier_company_membership
from app.schemas.auth import UserResponse
from app.schemas.supplier import (
    SupplierCompanyCreateRequest,
    SupplierCompanyMembershipResponse,
    SupplierCompanyResponse,
    SupplierMemberInviteRequest,
    SupplierMemberInviteResponse,
    SupplierMemberResponse,
    SupplierMemberRoleUpdateRequest,
    SupplierOwnershipTransferRequest,
    SupplierVerificationDocumentResponse,
    SupplierVerificationDocumentType,
    SupplierVerificationDocumentUrlResponse,
)
from app.schemas.supplier_offering import (
    SupplierMaterialOfferingCreateRequest,
    SupplierMaterialOfferingPatchRequest,
    SupplierMaterialOfferingResponse,
)
from app.schemas.rfq import (
    SupplierQuotationRequest,
    SupplierQuotationResult,
    SupplierRFQResponse,
    SupplierRFQResponseRequest,
    SupplierRFQResponseResult,
)
from app.services.rfq_service import RFQService, RFQServiceError
from app.services.supplier_service import SupplierService
from app.services.supplier_offering_service import SupplierOfferingService
from app.services.supplier_verification_service import (
    MAX_DOCUMENT_SIZE_BYTES,
    SIGNED_URL_TTL_SECONDS,
    SupplierVerificationService,
)

router = APIRouter(prefix="/suppliers", tags=["suppliers"])
logger = logging.getLogger(__name__)


def _raise_rfq_error(exc: RFQServiceError) -> None:
    raise HTTPException(status_code=exc.http_status, detail=exc.code) from exc


def _require_supplier_manager(membership: dict) -> None:
    if membership["role"] not in {"OWNER", "ADMIN"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="SUPPLIER_VERIFICATION_MANAGEMENT_FORBIDDEN",
        )


def _require_supplier_offering_manager(membership: dict) -> None:
    if membership["role"] not in {"OWNER", "ADMIN"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="SUPPLIER_OFFERING_MANAGEMENT_FORBIDDEN",
        )


@router.post(
    "/companies",
    response_model=SupplierCompanyResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_supplier_company(
    request: SupplierCompanyCreateRequest,
    user: UserResponse = Depends(get_current_user),
):
    return SupplierService.create_company(user, request)


@router.get("/companies", response_model=list[SupplierCompanyMembershipResponse])
async def list_supplier_companies(user: UserResponse = Depends(get_current_user)):
    return SupplierService.list_companies(user)


@router.get(
    "/invitations",
    response_model=list[SupplierCompanyMembershipResponse],
)
async def list_supplier_invitations(user: UserResponse = Depends(get_current_user)):
    return SupplierService.list_invitations(user)


@router.post(
    "/invitations/{membership_id}/accept",
    response_model=SupplierCompanyMembershipResponse,
)
async def accept_supplier_invitation(
    membership_id: UUID,
    user: UserResponse = Depends(get_current_user),
):
    return SupplierService.accept_invitation(membership_id, user)


@router.get("/companies/{company_id}", response_model=SupplierCompanyResponse)
async def get_supplier_company(
    company_id: UUID,
    membership: dict = Depends(require_supplier_company_membership),
):
    return SupplierService.get_company(company_id, membership)


@router.get(
    "/companies/{company_id}/members",
    response_model=list[SupplierMemberResponse],
)
async def list_supplier_members(
    company_id: UUID,
    membership: dict = Depends(require_supplier_company_membership),
):
    return SupplierService.list_members(company_id, membership)


@router.post(
    "/companies/{company_id}/members",
    response_model=SupplierMemberInviteResponse,
    status_code=status.HTTP_201_CREATED,
)
async def invite_supplier_member(
    company_id: UUID,
    request: SupplierMemberInviteRequest,
    user: UserResponse = Depends(get_current_user),
    membership: dict = Depends(require_supplier_company_membership),
):
    return SupplierService.invite_member(company_id, user, membership, request)


@router.patch(
    "/companies/{company_id}/members/{member_id}",
    response_model=SupplierMemberInviteResponse,
)
async def update_supplier_member_role(
    company_id: UUID,
    member_id: UUID,
    request: SupplierMemberRoleUpdateRequest,
    user: UserResponse = Depends(get_current_user),
    membership: dict = Depends(require_supplier_company_membership),
):
    return SupplierService.update_member_role(company_id, member_id, user, membership, request)


@router.delete(
    "/companies/{company_id}/members/{member_id}",
    response_model=SupplierMemberInviteResponse,
)
async def revoke_supplier_member(
    company_id: UUID,
    member_id: UUID,
    user: UserResponse = Depends(get_current_user),
    membership: dict = Depends(require_supplier_company_membership),
):
    return SupplierService.revoke_member(company_id, member_id, user, membership)


@router.post("/companies/{company_id}/transfer-ownership", status_code=status.HTTP_204_NO_CONTENT)
async def transfer_supplier_company_ownership(
    company_id: UUID,
    request: SupplierOwnershipTransferRequest,
    user: UserResponse = Depends(get_current_user),
    membership: dict = Depends(require_supplier_company_membership),
):
    if membership["role"] != "OWNER":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="SUPPLIER_OWNER_REQUIRED",
        )
    SupplierService.transfer_ownership(
        company_id,
        request.new_owner_membership_id,
        user,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/companies/{company_id}/offerings",
    response_model=list[SupplierMaterialOfferingResponse],
)
async def list_supplier_material_offerings(
    company_id: UUID,
    include_archived: bool = Query(default=False),
    membership: dict = Depends(require_supplier_company_membership),
):
    return SupplierOfferingService.list_offerings(
        company_id,
        include_archived and membership["role"] in {"OWNER", "ADMIN"},
    )


@router.post(
    "/companies/{company_id}/offerings",
    response_model=SupplierMaterialOfferingResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_supplier_material_offering(
    company_id: UUID,
    request: SupplierMaterialOfferingCreateRequest,
    user: UserResponse = Depends(get_current_user),
    membership: dict = Depends(require_supplier_company_membership),
):
    _require_supplier_offering_manager(membership)
    return SupplierOfferingService.create_offering(company_id, user.id, request)


@router.patch(
    "/companies/{company_id}/offerings/{offering_id}",
    response_model=SupplierMaterialOfferingResponse,
)
async def update_supplier_material_offering(
    company_id: UUID,
    offering_id: UUID,
    request: SupplierMaterialOfferingPatchRequest,
    user: UserResponse = Depends(get_current_user),
    membership: dict = Depends(require_supplier_company_membership),
):
    _require_supplier_offering_manager(membership)
    return SupplierOfferingService.update_offering(
        company_id,
        offering_id,
        user.id,
        request,
    )


@router.delete(
    "/companies/{company_id}/offerings/{offering_id}",
    response_model=SupplierMaterialOfferingResponse,
)
async def archive_supplier_material_offering(
    company_id: UUID,
    offering_id: UUID,
    expected_revision: int = Query(ge=0),
    user: UserResponse = Depends(get_current_user),
    membership: dict = Depends(require_supplier_company_membership),
):
    _require_supplier_offering_manager(membership)
    return SupplierOfferingService.archive_offering(
        company_id,
        offering_id,
        user.id,
        expected_revision,
    )


@router.get(
    "/companies/{company_id}/rfqs",
    response_model=list[SupplierRFQResponse],
)
async def list_supplier_rfqs(
    company_id: UUID,
    membership: dict = Depends(require_supplier_company_membership),
):
    try:
        return RFQService.list_supplier(company_id)
    except RFQServiceError as exc:
        _raise_rfq_error(exc)
    except Exception as exc:
        logger.exception("Supplier RFQ inbox load failed: company_id=%s", company_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="RFQ_LIST_FAILED",
        ) from exc


@router.get(
    "/companies/{company_id}/rfqs/{rfq_id}",
    response_model=SupplierRFQResponse,
)
async def get_supplier_rfq(
    company_id: UUID,
    rfq_id: UUID,
    membership: dict = Depends(require_supplier_company_membership),
):
    try:
        return RFQService.get_supplier(company_id, rfq_id)
    except RFQServiceError as exc:
        _raise_rfq_error(exc)
    except Exception as exc:
        logger.exception(
            "Supplier RFQ load failed: company_id=%s rfq_id=%s",
            company_id,
            rfq_id,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="RFQ_LOAD_FAILED",
        ) from exc


@router.post(
    "/companies/{company_id}/rfqs/{rfq_id}/response",
    response_model=SupplierRFQResponseResult,
)
async def respond_to_supplier_rfq(
    company_id: UUID,
    rfq_id: UUID,
    request: SupplierRFQResponseRequest,
    user: UserResponse = Depends(get_current_user),
    membership: dict = Depends(require_supplier_company_membership),
):
    try:
        return RFQService.respond_supplier(user, company_id, rfq_id, request)
    except RFQServiceError as exc:
        _raise_rfq_error(exc)
    except Exception as exc:
        logger.exception(
            "Supplier RFQ response failed: user_id=%s company_id=%s rfq_id=%s",
            user.id,
            company_id,
            rfq_id,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="RFQ_RESPONSE_FAILED",
        ) from exc


@router.put(
    "/companies/{company_id}/rfqs/{rfq_id}/quotation",
    response_model=SupplierQuotationResult,
)
async def submit_supplier_quotation(
    company_id: UUID,
    rfq_id: UUID,
    request: SupplierQuotationRequest,
    user: UserResponse = Depends(get_current_user),
    membership: dict = Depends(require_supplier_company_membership),
):
    try:
        return RFQService.submit_quotation(user, company_id, rfq_id, request)
    except RFQServiceError as exc:
        _raise_rfq_error(exc)
    except Exception as exc:
        logger.exception(
            "Supplier quotation submission failed: user_id=%s company_id=%s rfq_id=%s",
            user.id,
            company_id,
            rfq_id,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="QUOTATION_SUBMISSION_FAILED",
        ) from exc


@router.post(
    "/companies/{company_id}/verification/documents",
    response_model=SupplierVerificationDocumentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_supplier_verification_document(
    company_id: UUID,
    document_type: SupplierVerificationDocumentType = Form(...),
    file: UploadFile = File(...),
    user: UserResponse = Depends(get_current_user),
    membership: dict = Depends(require_supplier_company_membership),
):
    _require_supplier_manager(membership)
    content = await file.read(MAX_DOCUMENT_SIZE_BYTES + 1)
    return SupplierVerificationService.upload_document(
        company_id,
        str(user.id),
        document_type,
        file.filename,
        file.content_type,
        content,
    )


@router.get(
    "/companies/{company_id}/verification/documents",
    response_model=list[SupplierVerificationDocumentResponse],
)
async def list_supplier_verification_documents(
    company_id: UUID,
    membership: dict = Depends(require_supplier_company_membership),
):
    _require_supplier_manager(membership)
    return SupplierVerificationService.list_documents(company_id)


@router.get(
    "/companies/{company_id}/verification/documents/{document_id}/url",
    response_model=SupplierVerificationDocumentUrlResponse,
)
async def get_supplier_verification_document_url(
    company_id: UUID,
    document_id: UUID,
    membership: dict = Depends(require_supplier_company_membership),
):
    _require_supplier_manager(membership)
    return {
        "url": SupplierVerificationService.get_document_url(company_id, document_id),
        "expires_in": SIGNED_URL_TTL_SECONDS,
    }


@router.post(
    "/companies/{company_id}/verification/submit",
    response_model=SupplierCompanyResponse,
)
async def submit_supplier_verification(
    company_id: UUID,
    user: UserResponse = Depends(get_current_user),
    membership: dict = Depends(require_supplier_company_membership),
):
    _require_supplier_manager(membership)
    company = SupplierVerificationService.submit(company_id, str(user.id))
    return SupplierService._company_response(company, membership["role"])
