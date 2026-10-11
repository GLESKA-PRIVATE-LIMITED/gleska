"""Resolve existing Procurement identities without merging their records."""

from __future__ import annotations

from typing import Any

from app.core.supabase import supabase
from app.schemas.auth import UserResponse
from app.schemas.procurement import (
    ProcurementWorkspaceOption,
    ProcurementWorkspacePreferenceUpdate,
    ProcurementWorkspacesResponse,
)
from app.services.supplier_service import SupplierService


class ProcurementWorkspaceService:
    @staticmethod
    def _row(response: Any) -> dict[str, Any]:
        data = getattr(response, "data", None)
        if isinstance(data, list):
            return data[0] if data else {}
        return data or {}

    @classmethod
    def get_workspaces(cls, user: UserResponse) -> ProcurementWorkspacesResponse:
        workspaces: list[ProcurementWorkspaceOption] = []

        if user.role == "EMPLOYER":
            employer = cls._row(
                supabase.table("employer_profiles")
                .select("id, employer_type, onboarding_status")
                .eq("user_id", str(user.id))
                .maybe_single()
                .execute()
            )
            if employer.get("id") and employer.get("onboarding_status") == "COMPLETED":
                employer_type = employer.get("employer_type")
                buyer_name = (
                    "Individual Buyer"
                    if employer_type == "INDIVIDUAL"
                    else "Buyer Workspace"
                )
                workspaces.append(
                    ProcurementWorkspaceOption(
                        id="buyer",
                        kind="BUYER",
                        name=buyer_name,
                    )
                )

        supplier_memberships = SupplierService.list_companies(user)
        supplier_company_ids = [membership.company_id for membership in supplier_memberships]
        operational_companies: set[str] = set()
        if supplier_company_ids:
            companies_response = (
                supabase.table("supplier_companies")
                .select("id")
                .in_("id", supplier_company_ids)
                .eq("operational_status", "ACTIVE")
                .execute()
            )
            companies = getattr(companies_response, "data", None)
            operational_companies = {
                str(company["id"])
                for company in companies or []
                if isinstance(company, dict) and company.get("id")
            }

        if any(
            membership.company_id in operational_companies
            for membership in supplier_memberships
        ):
            workspaces.append(
                ProcurementWorkspaceOption(
                    id="supplier",
                    kind="SUPPLIER",
                    name="Supplier Workspace",
                )
            )

        preference = cls._row(
            supabase.table("procurement_workspace_preferences")
            .select("preferred_workspace")
            .eq("user_id", str(user.id))
            .maybe_single()
            .execute()
        )
        preferred = preference.get("preferred_workspace")
        available_kinds = {workspace.kind for workspace in workspaces}
        if preferred not in available_kinds:
            preferred = None

        return ProcurementWorkspacesResponse(
            available_workspaces=workspaces,
            preferred_workspace=preferred,
        )

    @classmethod
    def update_preference(
        cls,
        user: UserResponse,
        request: ProcurementWorkspacePreferenceUpdate,
    ) -> ProcurementWorkspacesResponse:
        current = cls.get_workspaces(user)
        if request.preferred_workspace not in {
            workspace.kind for workspace in current.available_workspaces
        }:
            raise PermissionError("PROCUREMENT_WORKSPACE_NOT_AVAILABLE")

        supabase.table("procurement_workspace_preferences").upsert(
            {
                "user_id": str(user.id),
                "preferred_workspace": request.preferred_workspace,
            },
            on_conflict="user_id",
        ).execute()
        return cls.get_workspaces(user)


__all__ = ["ProcurementWorkspaceService"]
