"""Business logic services for application."""

from app.core.supabase import supabase
from app.schemas.auth import UserResponse
from typing import Literal
import re


class OnboardingService:
    """Service to manage user onboarding state and determine next steps."""

    @staticmethod
    def determine_next_step(user: UserResponse) -> Literal[
        "DASHBOARD",
        "EMPLOYER_TYPE_SELECTION",
        "REGISTERED_INDUSTRY_DETAILS",
        "REGISTERED_BUSINESS_DETAILS",
        "UNREGISTERED_BUSINESS_DETAILS",
        "INDIVIDUAL_DETAILS",
        "WORKER_PROFILE",
    ]:
        if user.role == "WORKER":
            try:
                response = (
                    supabase.table("worker_profiles")
                    .select("onboarding_status, profile_completed")
                    .eq("user_id", user.id)
                    .single()
                    .execute()
                )
                return "DASHBOARD" if response.data and response.data.get("onboarding_status") == "COMPLETED" else "WORKER_PROFILE"
            except Exception:
                return "WORKER_PROFILE"

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
                if onboarding_status == "NOT_STARTED":
                    return "EMPLOYER_TYPE_SELECTION"
                if employer_type == "REGISTERED_INDUSTRY":
                    return "REGISTERED_INDUSTRY_DETAILS"
                if employer_type == "REGISTERED_BUSINESS":
                    return "REGISTERED_BUSINESS_DETAILS"
                if employer_type == "UNREGISTERED_BUSINESS":
                    return "UNREGISTERED_BUSINESS_DETAILS"
                if employer_type == "INDIVIDUAL":
                    return "INDIVIDUAL_DETAILS"
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
        "INDIVIDUAL_DETAILS",
        "WORKER_PROFILE",
    ]:
        return OnboardingService.determine_next_step(user)

    @staticmethod
    def validate_onboarding_fields(
        employer_type: str,
        data: dict,
        require_registered_business_location: bool = True,
    ) -> tuple[bool, str]:
        """
        Validate onboarding data based on employer type.
        
        Returns:
            (is_valid, error_message)
        """
        if employer_type == "REGISTERED_INDUSTRY":
            required_fields = [
                "industry_type",
                "industry_category",
                "registered_address",
                "company_email",
                "company_phone",
                "city",
                "state",
                "pincode",
                "work_location",
            ]
            for field in required_fields:
                if OnboardingService._missing_required_value(data.get(field)):
                    return False, f"{field} is required for registered industry"

        elif employer_type == "REGISTERED_BUSINESS":
            required_fields = [
                "business_name",
                "business_type",
                "industry_category",
                "registered_address",
                "company_email",
                "company_phone",
            ]
            if require_registered_business_location:
                required_fields.extend(["city", "state", "pincode", "work_location"])
            for field in required_fields:
                if OnboardingService._missing_required_value(data.get(field)):
                    return False, f"{field} is required for registered business"

        elif employer_type == "UNREGISTERED_BUSINESS":
            required_fields = [
                "business_name",
                "business_type",
                "nature_of_business",
                "number_of_proprietors",
                "company_email",
                "company_phone",
                "proprietor_name",
                "proprietor_aadhaar",
                "industry_category",
                "address",
                "city",
                "state",
                "pincode",
                "work_location",
            ]
            for field in required_fields:
                if OnboardingService._missing_required_value(data.get(field)):
                    return False, f"{field} is required for unregistered business"

            num_proprietors = data.get("number_of_proprietors")
            if num_proprietors is not None:
                try:
                    if int(num_proprietors) < 1:
                        return False, "number_of_proprietors must be at least 1"
                except (ValueError, TypeError):
                    return False, "number_of_proprietors must be a valid number"

        elif employer_type == "INDIVIDUAL":
            required_fields = [
                "address",
                "company_email",
                "company_phone",
                "city",
                "state",
                "pincode",
                "work_location",
            ]
            for field in required_fields:
                if OnboardingService._missing_required_value(data.get(field)):
                    return False, f"{field} is required for individual employer"

        pincode = str(data.get("pincode", "")).strip()
        if pincode and not re.fullmatch(r"[0-9]{6}", pincode):
            return False, "pincode must be a valid 6-digit number"

        return True, ""

    @staticmethod
    def _missing_required_value(value: object) -> bool:
        return value is None or (isinstance(value, str) and not value.strip())
