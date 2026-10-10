"""Supplier company membership authorization."""

import logging
from uuid import UUID

from fastapi import Depends, HTTPException, status

from app.core.security import get_current_user
from app.core.supabase import supabase
from app.schemas.auth import UserResponse

logger = logging.getLogger(__name__)


async def require_supplier_company_membership(
    company_id: UUID,
    user: UserResponse = Depends(get_current_user),
) -> dict:
    """Require an active membership in the requested operational supplier company."""
    try:
        membership_response = (
            supabase.table("supplier_company_memberships")
            .select("id, company_id, user_id, role, status")
            .eq("company_id", str(company_id))
            .eq("user_id", str(user.id))
            .eq("status", "ACTIVE")
            .maybe_single()
            .execute()
        )
        membership = membership_response.data if membership_response else None
        if not membership:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="SUPPLIER_COMPANY_MEMBERSHIP_NOT_FOUND",
            )

        company_response = (
            supabase.table("supplier_companies")
            .select("id, operational_status")
            .eq("id", str(company_id))
            .maybe_single()
            .execute()
        )
        company = company_response.data if company_response else None
        if not company or company.get("operational_status") != "ACTIVE":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="SUPPLIER_COMPANY_NOT_OPERATIONAL",
            )
        return membership
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(
            "Supplier membership authorization lookup failed: user_id=%s company_id=%s",
            user.id,
            company_id,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="SUPPLIER_MEMBERSHIP_AUTHORIZATION_FAILED",
        ) from exc
