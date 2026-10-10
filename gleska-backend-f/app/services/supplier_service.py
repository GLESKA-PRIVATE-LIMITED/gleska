"""Supplier identity and company membership operations."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from fastapi import HTTPException, status

from app.core.supabase import supabase
from app.schemas.auth import UserResponse
from app.schemas.supplier import (
    SupplierCompanyCreateRequest,
    SupplierCompanyMembershipResponse,
    SupplierCompanyResponse,
    SupplierMemberInviteRequest,
    SupplierMemberResponse,
    SupplierMemberRoleUpdateRequest,
)

logger = logging.getLogger(__name__)
SUPPLIER_INVITATION_TTL = timedelta(days=7)


class SupplierService:
    """Persistence boundary for supplier identities and memberships."""

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
    def _raise_storage_error(operation: str, exc: Exception) -> None:
        if getattr(exc, "code", None) == "23505":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="SUPPLIER_MEMBERSHIP_CONFLICT",
            ) from exc
        logger.exception("Supplier %s failed", operation)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"SUPPLIER_{operation.upper()}_FAILED",
        ) from exc

    @staticmethod
    def _company_response(
        company: dict[str, Any],
        role: str,
        private_profile: dict[str, Any] | None = None,
    ) -> SupplierCompanyResponse:
        private = private_profile or {}
        return SupplierCompanyResponse(
            id=str(company["id"]),
            name=company["name"],
            description=company.get("description"),
            website=company.get("website"),
            operational_status=company["operational_status"],
            role=role,
            created_at=company["created_at"],
            updated_at=company["updated_at"],
            registered_name=private.get("registered_name"),
            registration_number=private.get("registration_number"),
            contact_email=private.get("contact_email"),
            contact_phone=private.get("contact_phone"),
            registered_address=private.get("registered_address"),
        )

    @staticmethod
    def create_company(
        user: UserResponse,
        request: SupplierCompanyCreateRequest,
    ) -> SupplierCompanyResponse:
        try:
            result = supabase.rpc(
                "create_supplier_company_with_owner",
                {
                    "p_user_id": str(user.id),
                    "p_name": request.name.strip(),
                    "p_description": request.description,
                    "p_website": str(request.website) if request.website else None,
                    "p_registered_name": request.registered_name,
                    "p_registration_number": request.registration_number,
                    "p_contact_email": str(request.contact_email).lower() if request.contact_email else None,
                    "p_contact_phone": request.contact_phone,
                    "p_registered_address": request.registered_address,
                },
            ).execute()
            company = SupplierService._row(result)
            if not company:
                raise RuntimeError("Supplier company creation returned no record")
            return SupplierService._company_response(company, "OWNER")
        except Exception as exc:
            SupplierService._raise_storage_error("company_create", exc)

    @staticmethod
    def list_companies(user: UserResponse) -> list[SupplierCompanyMembershipResponse]:
        try:
            memberships = SupplierService._rows(
                supabase.table("supplier_company_memberships")
                .select("id, company_id, role, status, created_at")
                .eq("user_id", str(user.id))
                .eq("status", "ACTIVE")
                .order("created_at", desc=True)
                .execute()
            )
            company_ids = [membership["company_id"] for membership in memberships]
            if not company_ids:
                return []
            companies = SupplierService._rows(
                supabase.table("supplier_companies")
                .select("id, name")
                .in_("id", company_ids)
                .execute()
            )
            names = {str(company["id"]): company["name"] for company in companies}
            return [
                SupplierCompanyMembershipResponse(
                    id=str(membership["id"]),
                    company_id=str(membership["company_id"]),
                    company_name=names[str(membership["company_id"])],
                    role=membership["role"],
                    status=membership["status"],
                    created_at=membership["created_at"],
                )
                for membership in memberships
                if str(membership["company_id"]) in names
            ]
        except Exception as exc:
            SupplierService._raise_storage_error("company_list", exc)

    @staticmethod
    def get_company(
        company_id: UUID,
        membership: dict[str, Any],
    ) -> SupplierCompanyResponse:
        try:
            response = (
                supabase.table("supplier_companies")
                .select("*")
                .eq("id", str(company_id))
                .single()
                .execute()
            )
            company = SupplierService._row(response)
            private_profile = None
            if membership["role"] in {"OWNER", "ADMIN"}:
                private_response = (
                    supabase.table("supplier_company_private_profiles")
                    .select("registered_name, registration_number, contact_email, contact_phone, registered_address")
                    .eq("company_id", str(company_id))
                    .maybe_single()
                    .execute()
                )
                private_profile = private_response.data if private_response else None
            return SupplierService._company_response(company, membership["role"], private_profile)
        except Exception as exc:
            SupplierService._raise_storage_error("company_read", exc)

    @staticmethod
    def list_invitations(user: UserResponse) -> list[SupplierCompanyMembershipResponse]:
        try:
            email = SupplierService._verified_identity_email(user)
            if not email:
                return []
            invitations = SupplierService._rows(
                supabase.table("supplier_company_memberships")
                .select("id, company_id, role, status, created_at, expires_at")
                .eq("invited_email", email)
                .eq("status", "PENDING")
                .gt("expires_at", datetime.now(timezone.utc).isoformat())
                .execute()
            )
            company_ids = list(dict.fromkeys(invite["company_id"] for invite in invitations))
            if not company_ids:
                return []
            companies = SupplierService._rows(
                supabase.table("supplier_companies")
                .select("id, name")
                .in_("id", company_ids)
                .execute()
            )
            names = {str(company["id"]): company["name"] for company in companies}
            return [
                SupplierCompanyMembershipResponse(
                    id=str(invite["id"]),
                    company_id=str(invite["company_id"]),
                    company_name=names[str(invite["company_id"])],
                    role=invite["role"],
                    status=invite["status"],
                    created_at=invite["created_at"],
                    expires_at=invite["expires_at"],
                )
                for invite in invitations
                if str(invite["company_id"]) in names
            ]
        except HTTPException:
            raise
        except Exception as exc:
            SupplierService._raise_storage_error("invitation_list", exc)

    @staticmethod
    def _verified_identity_email(user: UserResponse) -> str | None:
        try:
            auth_user = supabase.auth.admin.get_user_by_id(str(user.id)).user
        except Exception as exc:
            logger.exception("Supplier invitation identity lookup failed: user_id=%s", user.id)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="SUPPLIER_IDENTITY_LOOKUP_UNAVAILABLE",
            ) from exc
        email = (getattr(auth_user, "email", None) or "").strip().lower()
        if not email or not getattr(auth_user, "email_confirmed_at", None):
            return None
        return email

    @staticmethod
    def accept_invitation(membership_id: UUID, user: UserResponse) -> SupplierCompanyMembershipResponse:
        email = SupplierService._verified_identity_email(user)
        if not email:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="VERIFIED_EMAIL_REQUIRED_TO_ACCEPT_SUPPLIER_INVITATION",
            )
        try:
            pending = SupplierService._row(
                supabase.table("supplier_company_memberships")
                .select("id, company_id, user_id, invited_email, role, status, created_at, expires_at")
                .eq("id", str(membership_id))
                .eq("status", "PENDING")
                .eq("invited_email", email)
                .gt("expires_at", datetime.now(timezone.utc).isoformat())
                .maybe_single()
                .execute()
            )
            if not pending or (pending.get("user_id") and pending["user_id"] != str(user.id)):
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SUPPLIER_INVITATION_NOT_FOUND")
            company = SupplierService._row(
                supabase.table("supplier_companies")
                .select("id, name, operational_status")
                .eq("id", pending["company_id"])
                .single()
                .execute()
            )
            if company.get("operational_status") != "ACTIVE":
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="SUPPLIER_COMPANY_NOT_OPERATIONAL",
                )
            acceptance_time = datetime.now(timezone.utc).isoformat()
            accepted = SupplierService._row(
                supabase.table("supplier_company_memberships")
                .update({
                    "user_id": str(user.id),
                    "invited_email": None,
                    "status": "ACTIVE",
                    "accepted_at": acceptance_time,
                    "updated_by": str(user.id),
                })
                .eq("id", str(membership_id))
                .eq("status", "PENDING")
                .eq("invited_email", email)
                .gt("expires_at", acceptance_time)
                .select("*")
                .execute()
            )
            if not accepted:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="SUPPLIER_INVITATION_ALREADY_USED")
            return SupplierCompanyMembershipResponse(
                id=str(accepted["id"]),
                company_id=str(accepted["company_id"]),
                company_name=company["name"],
                role=accepted["role"],
                status=accepted["status"],
                created_at=accepted["created_at"],
                expires_at=accepted["expires_at"],
            )
        except HTTPException:
            raise
        except Exception as exc:
            SupplierService._raise_storage_error("invitation_accept", exc)

    @staticmethod
    def invite_member(
        company_id: UUID,
        actor: UserResponse,
        membership: dict[str, Any],
        request: SupplierMemberInviteRequest,
    ) -> dict[str, Any]:
        email = str(request.email).strip().lower()
        actor_role = membership["role"]
        if actor_role not in {"OWNER", "ADMIN"}:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="SUPPLIER_MEMBER_MANAGEMENT_FORBIDDEN")
        if request.role.value == "OWNER" or (actor_role == "ADMIN" and request.role.value != "MEMBER"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="SUPPLIER_ROLE_ASSIGNMENT_FORBIDDEN")
        try:
            user_response = (
                supabase.table("users")
                .select("id")
                .eq("email", email)
                .maybe_single()
                .execute()
            )
            target = user_response.data if user_response else None
            existing_query = (
                supabase.table("supplier_company_memberships")
                .select("id, user_id, status, role, expires_at")
                .eq("company_id", str(company_id))
            )
            if target:
                existing_query = existing_query.eq("user_id", str(target["id"]))
            else:
                existing_query = existing_query.eq("invited_email", email)
            existing = SupplierService._row(existing_query.maybe_single().execute())
            if existing and existing.get("status") == "ACTIVE":
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="SUPPLIER_USER_ALREADY_MEMBER")
            if existing and existing.get("status") == "PENDING":
                existing_expiry = datetime.fromisoformat(existing["expires_at"].replace("Z", "+00:00"))
                if existing_expiry > datetime.now(timezone.utc):
                    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="SUPPLIER_INVITATION_ALREADY_PENDING")
            if existing and existing.get("role") == "OWNER":
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="SUPPLIER_OWNER_CANNOT_BE_REINVITED")

            if existing:
                update_query = (
                    supabase.table("supplier_company_memberships")
                    .update({
                        "user_id": str(target["id"]) if target else None,
                        "invited_email": email,
                        "role": request.role.value,
                        "status": "PENDING",
                        "expires_at": (datetime.now(timezone.utc) + SUPPLIER_INVITATION_TTL).isoformat(),
                        "updated_by": str(actor.id),
                        "revoked_by": None,
                        "revoked_at": None,
                        "accepted_at": None,
                    })
                    .eq("id", existing["id"])
                )
                update_query = update_query.eq("status", existing["status"])
                if existing["status"] == "PENDING":
                    update_query = update_query.lte("expires_at", datetime.now(timezone.utc).isoformat())
                result = update_query.select("*").execute()
            else:
                result = (
                    supabase.table("supplier_company_memberships")
                    .insert({
                        "company_id": str(company_id),
                        "user_id": str(target["id"]) if target else None,
                        "invited_email": email,
                        "role": request.role.value,
                        "status": "PENDING",
                        "created_by": str(actor.id),
                        "expires_at": (datetime.now(timezone.utc) + SUPPLIER_INVITATION_TTL).isoformat(),
                    })
                    .select("*")
                    .execute()
                )
            row = SupplierService._row(result)
            if not row:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="SUPPLIER_INVITATION_CHANGED")
            return {"id": str(row["id"]), "role": row["role"], "status": row["status"]}
        except HTTPException:
            raise
        except Exception as exc:
            SupplierService._raise_storage_error("member_invite", exc)

    @staticmethod
    def list_members(
        company_id: UUID,
        membership: dict[str, Any],
    ) -> list[SupplierMemberResponse]:
        try:
            response = (
                supabase.table("supplier_company_memberships")
                .select("id, user_id, invited_email, role, status, created_at")
                .eq("company_id", str(company_id))
                .neq("status", "REVOKED")
                .order("created_at")
                .execute()
            )
            memberships = SupplierService._rows(response)
            user_ids = list(dict.fromkeys(item["user_id"] for item in memberships if item.get("user_id")))
            user_names: dict[str, str] = {}
            if user_ids:
                users = SupplierService._rows(
                    supabase.table("users").select("id, name").in_("id", user_ids).execute()
                )
                user_names = {str(item["id"]): item.get("name") for item in users}
            return [
                SupplierMemberResponse(
                    id=str(item["id"]),
                    name=user_names.get(str(item["user_id"])) if item.get("user_id") else None,
                    invited_email=(
                        item.get("invited_email")
                        if membership["role"] in {"OWNER", "ADMIN"}
                        else None
                    ),
                    role=item["role"],
                    status=item["status"],
                    created_at=item["created_at"],
                )
                for item in memberships
            ]
        except Exception as exc:
            SupplierService._raise_storage_error("member_list", exc)

    @staticmethod
    def update_member_role(
        company_id: UUID,
        member_id: UUID,
        actor: UserResponse,
        actor_membership: dict[str, Any],
        request: SupplierMemberRoleUpdateRequest,
    ) -> dict[str, Any]:
        actor_role = actor_membership["role"]
        if actor_role not in {"OWNER", "ADMIN"}:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="SUPPLIER_MEMBER_MANAGEMENT_FORBIDDEN")
        if request.role.value == "OWNER" or (actor_role == "ADMIN" and request.role.value != "MEMBER"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="SUPPLIER_ROLE_ASSIGNMENT_FORBIDDEN")
        try:
            target = SupplierService._row(
                supabase.table("supplier_company_memberships")
                .select("id, user_id, role, status")
                .eq("id", str(member_id))
                .eq("company_id", str(company_id))
                .eq("status", "ACTIVE")
                .maybe_single()
                .execute()
            )
            if not target:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SUPPLIER_MEMBER_NOT_FOUND")
            if target["role"] == "OWNER" or (actor_role == "ADMIN" and target["role"] != "MEMBER"):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="SUPPLIER_ROLE_CHANGE_FORBIDDEN")
            changed = SupplierService._row(
                supabase.table("supplier_company_memberships")
                .update({"role": request.role.value, "updated_by": str(actor.id)})
                .eq("id", str(member_id))
                .eq("company_id", str(company_id))
                .eq("status", "ACTIVE")
                .eq("role", target["role"])
                .select("*")
                .execute()
            )
            if not changed:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="SUPPLIER_MEMBER_CHANGED")
            return {"id": str(changed["id"]), "role": changed["role"], "status": changed["status"]}
        except HTTPException:
            raise
        except Exception as exc:
            SupplierService._raise_storage_error("member_role_update", exc)

    @staticmethod
    def revoke_member(
        company_id: UUID,
        member_id: UUID,
        actor: UserResponse,
        actor_membership: dict[str, Any],
    ) -> dict[str, Any]:
        actor_role = actor_membership["role"]
        if actor_role not in {"OWNER", "ADMIN"}:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="SUPPLIER_MEMBER_MANAGEMENT_FORBIDDEN")
        try:
            target = SupplierService._row(
                supabase.table("supplier_company_memberships")
                .select("id, role, status")
                .eq("id", str(member_id))
                .eq("company_id", str(company_id))
                .in_("status", ["ACTIVE", "PENDING"])
                .maybe_single()
                .execute()
            )
            if not target:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SUPPLIER_MEMBER_NOT_FOUND")
            if target["role"] == "OWNER" or (actor_role == "ADMIN" and target["role"] != "MEMBER"):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="SUPPLIER_MEMBER_REVOCATION_FORBIDDEN")
            changed = SupplierService._row(
                supabase.table("supplier_company_memberships")
                .update({
                    "status": "REVOKED",
                    "invited_email": None,
                    "updated_by": str(actor.id),
                    "revoked_by": str(actor.id),
                    "revoked_at": datetime.now(timezone.utc).isoformat(),
                })
                .eq("id", str(member_id))
                .eq("company_id", str(company_id))
                .eq("role", target["role"])
                .in_("status", ["ACTIVE", "PENDING"])
                .select("*")
                .execute()
            )
            if not changed:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="SUPPLIER_MEMBER_CHANGED")
            return {"id": str(changed["id"]), "role": changed["role"], "status": changed["status"]}
        except HTTPException:
            raise
        except Exception as exc:
            SupplierService._raise_storage_error("member_revoke", exc)

    @staticmethod
    def transfer_ownership(
        company_id: UUID,
        new_owner_membership_id: UUID,
        actor: UserResponse,
    ) -> None:
        try:
            target = SupplierService._row(
                supabase.table("supplier_company_memberships")
                .select("id, user_id, role, status")
                .eq("id", str(new_owner_membership_id))
                .eq("company_id", str(company_id))
                .eq("status", "ACTIVE")
                .maybe_single()
                .execute()
            )
            if not target or target["role"] not in {"ADMIN", "MEMBER"} or not target.get("user_id"):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="SUPPLIER_OWNER_TRANSFER_TARGET_INVALID")
            result = supabase.rpc(
                "transfer_supplier_company_ownership",
                {
                    "p_company_id": str(company_id),
                    "p_current_owner_id": str(actor.id),
                    "p_new_owner_id": str(target["user_id"]),
                },
            ).execute()
            if not result.data:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="SUPPLIER_OWNER_TRANSFER_FAILED")
        except HTTPException:
            raise
        except Exception as exc:
            SupplierService._raise_storage_error("owner_transfer", exc)
