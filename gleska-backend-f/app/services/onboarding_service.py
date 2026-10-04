"""Business logic services for application."""

from app.core.supabase import supabase
from app.schemas.auth import UserResponse
from typing import Literal
import re


class OnboardingService:
    """Service to manage user onboarding state and determine next steps."""

    COMMON_ONBOARDING_FIELDS = {
        "business_name", "business_category", "website_url", "annual_revenue", "description",
        "company_email", "company_phone", "work_location", "latitude", "longitude",
        "address", "city", "state", "pincode", "hiring_mode", "services_required",
        "bank_account_holder_name", "bank_ifsc", "bank_account_number", "business_document_url",
    }
    REGISTERED_ONBOARDING_FIELDS = {
        "business_type", "industry_category", "registered_address", "gstin", "registration_number", "cin_number",
        "pan_number", "udyam_number", "tan_number", "director_name", "director_phone",
        "director_email", "director_address", "director_aadhaar", "director_data",
    }
    INDUSTRY_ONBOARDING_FIELDS = {
        "industry_category", "industry_type", "nature_of_business", "services_required", "director_data",
    }
    UNREGISTERED_ONBOARDING_FIELDS = {
        "business_type", "industry_category", "address", "number_of_proprietors",
        "proprietor_names", "proprietor_name", "proprietor_aadhaar", "udyam_number",
        "nature_of_business",
    }
    INDIVIDUAL_PROFILE_FIELDS = {
        "address", "city", "state", "pincode", "work_location", "latitude", "longitude",
        "company_email", "company_phone", "website_url", "annual_revenue", "description",
    }
    DETAIL_METADATA_FIELDS = {"id", "employer_id", "created_at", "updated_at"}

    @classmethod
    def fields_for_type(cls, employer_type: str) -> set[str]:
        if employer_type == "INDIVIDUAL":
            return set(cls.INDIVIDUAL_PROFILE_FIELDS)

        fields = set(cls.COMMON_ONBOARDING_FIELDS)
        if employer_type in {"REGISTERED_BUSINESS", "REGISTERED_INDUSTRY"}:
            fields.update(cls.REGISTERED_ONBOARDING_FIELDS)
        if employer_type == "REGISTERED_INDUSTRY":
            fields.update(cls.INDUSTRY_ONBOARDING_FIELDS)
        if employer_type == "UNREGISTERED_BUSINESS":
            fields.update(cls.UNREGISTERED_ONBOARDING_FIELDS)
        return fields

    @classmethod
    def active_details_for_type(cls, employer_type: str, details: dict | None) -> dict:
        details = details or {}
        snapshots = details.get("directory_data")
        source = snapshots.get(employer_type) if isinstance(snapshots, dict) else None
        source = source if isinstance(source, dict) else details
        allowed_fields = cls.fields_for_type(employer_type)
        active_details = {
            key: value
            for key, value in source.items()
            if key in allowed_fields
        }
        active_details.update({
            key: value
            for key, value in details.items()
            if key in cls.DETAIL_METADATA_FIELDS
        })
        return active_details

    @classmethod
    def directory_snapshots(cls, employer_type: str, details: dict, existing: dict | None = None) -> dict:
        snapshots = dict(existing or {})
        snapshots[employer_type] = {
            key: value
            for key, value in details.items()
            if key in cls.fields_for_type(employer_type)
        }
        return snapshots

    @classmethod
    def active_details_payload(
        cls,
        employer_type: str,
        existing: dict | None,
        updates: dict,
    ) -> dict:
        allowed_fields = cls.fields_for_type(employer_type)
        active_details = cls.active_details_for_type(employer_type, existing)
        active_details.update({
            key: value for key, value in updates.items() if key in allowed_fields
        })
        active_details = {
            key: value for key, value in active_details.items() if key in allowed_fields
        }
        existing_snapshots = (existing or {}).get("directory_data")
        snapshots = cls.directory_snapshots(
            employer_type,
            active_details,
            existing_snapshots if isinstance(existing_snapshots, dict) else {},
        )
        return {"directory_data": snapshots, **active_details}

    @classmethod
    def switch_directory_details(
        cls,
        previous_type: str | None,
        next_type: str,
        existing: dict | None,
    ) -> tuple[dict, dict]:
        existing = existing or {}
        snapshots = existing.get("directory_data")
        snapshots = dict(snapshots) if isinstance(snapshots, dict) else {}
        previous_details = cls.active_details_for_type(previous_type or "", existing)
        if previous_type:
            snapshots = cls.directory_snapshots(previous_type, previous_details, snapshots)

        common_details = {
            key: existing[key]
            for key in cls.COMMON_ONBOARDING_FIELDS
            if key in existing and existing[key] is not None
        }
        target_details = {
            **(snapshots.get(next_type) if isinstance(snapshots.get(next_type), dict) else {}),
            **common_details,
        }
        snapshots = cls.directory_snapshots(next_type, target_details, snapshots)
        return target_details, snapshots

    @staticmethod
    def determine_next_step(user: UserResponse) -> Literal[
        "DASHBOARD",
        "EMPLOYER_TYPE_SELECTION",
        "REGISTERED_INDUSTRY_DETAILS",
        "REGISTERED_BUSINESS_DETAILS",
        "UNREGISTERED_BUSINESS_DETAILS",
    ]:
        if user.role == "WORKER":
            return "DASHBOARD"

        if user.role == "EMPLOYER":
            try:
                response = (
                    supabase.table("employer_profiles")
                    .select("*")
                    .eq("user_id", user.id)
                    .single()
                    .execute()
                )
                employer = response.data
                if not employer:
                    return "EMPLOYER_TYPE_SELECTION"

                onboarding_status = employer.get("onboarding_status", "NOT_STARTED")
                employer_type = employer.get("employer_type")

                if onboarding_status == "COMPLETED":
                    return "DASHBOARD"
                if employer_type == "INDIVIDUAL":
                    return "DASHBOARD"
                if onboarding_status == "NOT_STARTED":
                    return "EMPLOYER_TYPE_SELECTION"
                if employer_type == "REGISTERED_INDUSTRY":
                    return "REGISTERED_INDUSTRY_DETAILS"
                if employer_type == "REGISTERED_BUSINESS":
                    return "REGISTERED_BUSINESS_DETAILS"
                if employer_type == "UNREGISTERED_BUSINESS":
                    return "UNREGISTERED_BUSINESS_DETAILS"
                return "EMPLOYER_TYPE_SELECTION"
            except Exception:
                return "EMPLOYER_TYPE_SELECTION"

        return "DASHBOARD"

    @staticmethod
    def get_next_step(user: UserResponse) -> Literal[
        "DASHBOARD",
        "EMPLOYER_TYPE_SELECTION",
        "REGISTERED_INDUSTRY_DETAILS",
        "REGISTERED_BUSINESS_DETAILS",
        "UNREGISTERED_BUSINESS_DETAILS",
    ]:
        return OnboardingService.determine_next_step(user)

    @staticmethod
    def validate_onboarding_fields(
        employer_type: str,
        data: dict,
        require_registered_business_location: bool = True,
        require_all_fields: bool = True,
    ) -> tuple[bool, str]:
        """
        Validate onboarding data based on employer type.
        
        Returns:
            (is_valid, error_message)
        """
        if employer_type == "REGISTERED_INDUSTRY":
            required_fields = [
                "business_name",
                "business_type",
                "business_category",
                "industry_type",
                "industry_category",
                "registered_address",
                "company_email",
                "company_phone",
                "work_location",
                "director_name",
                "director_phone",
                "director_email",
                "director_address",
                "director_aadhaar",
            ]
            if require_all_fields:
                for field in required_fields:
                    if OnboardingService._missing_required_value(data.get(field)):
                        return False, f"{field} is required for registered industry"

        elif employer_type == "REGISTERED_BUSINESS":
            required_fields = [
                "business_name",
                "business_type",
                "business_category",
                "company_email",
                "company_phone",
                "director_name",
                "director_phone",
                "director_email",
                "director_address",
                "director_aadhaar",
            ]
            if require_registered_business_location:
                required_fields.extend(["registered_address", "work_location"])
            if require_all_fields:
                for field in required_fields:
                    if OnboardingService._missing_required_value(data.get(field)):
                        return False, f"{field} is required for registered business"

        elif employer_type == "UNREGISTERED_BUSINESS":
            required_fields = [
                "business_name",
                "business_category",
                "number_of_proprietors",
                "company_email",
                "company_phone",
                "proprietor_name",
                "proprietor_aadhaar",
                "address",
                "work_location",
            ]
            if require_all_fields:
                for field in required_fields:
                    if OnboardingService._missing_required_value(data.get(field)):
                        return False, f"{field} is required for unregistered business"

            num_proprietors = data.get("number_of_proprietors")
            if num_proprietors is not None:
                try:
                    normalized_count = int(num_proprietors)
                    if normalized_count < 1:
                        return False, "number_of_proprietors must be at least 1"
                except (ValueError, TypeError):
                    return False, "number_of_proprietors must be a valid number"

                proprietor_names = data.get("proprietor_names")
                if proprietor_names is None:
                    if require_all_fields and normalized_count > 1:
                        return False, "proprietor_names is required for each proprietor"
                elif len(proprietor_names) != normalized_count:
                    return False, "proprietor_names must match number_of_proprietors"
                elif any(not str(name).strip() for name in proprietor_names):
                    return False, "Every proprietor name is required"

        pincode = str(data.get("pincode", "")).strip()
        if pincode and not re.fullmatch(r"[0-9]{6}", pincode):
            return False, "pincode must be a valid 6-digit number"

        return True, ""

    @staticmethod
    def _missing_required_value(value: object) -> bool:
        return value is None or (isinstance(value, str) and not value.strip())
