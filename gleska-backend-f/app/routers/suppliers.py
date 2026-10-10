"""Authenticated supplier identity and membership endpoints."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status

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
)
from app.services.supplier_service import SupplierService

router = APIRouter(prefix="/suppliers", tags=["suppliers"])


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
