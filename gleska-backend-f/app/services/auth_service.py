"""Authentication service for user registration and verification."""

import re
import logging
from typing import Any

from app.core.supabase import supabase

logger = logging.getLogger(__name__)


class AuthService:
    """Service for handling authentication flows."""

    @staticmethod
    def normalize_mobile(mobile: str) -> str:
        if not mobile:
            raise ValueError("INVALID_MOBILE")

        digits = re.sub(r"\D", "", mobile)
        if len(digits) == 10:
            return "91" + digits
        if len(digits) == 12 and digits.startswith("91"):
            return digits
        if len(digits) == 11 and digits.startswith("0"):
            return "91" + digits[1:]
        raise ValueError("INVALID_MOBILE")

    @staticmethod
    def ensure_role_allowed(existing_user: dict[str, Any] | None, requested_role: str) -> None:
        if not existing_user:
            return
        current_role = existing_user.get("role")
        if current_role == requested_role:
            return
        if current_role in {"WORKER", "EMPLOYER"} and requested_role in {"WORKER", "EMPLOYER"}:
            raise ValueError("ROLE_CONFLICT")

    @staticmethod
    def create_or_update_user(
        user_id: str | None,
        name: str,
        mobile: str,
        role: str,
    ) -> dict:
        normalized_mobile = AuthService.normalize_mobile(mobile)
        existing = AuthService.get_user_by_mobile(normalized_mobile)
        if existing:
            AuthService.ensure_role_allowed(existing, role)
            user_id = existing["id"]

        if not user_id:
            logger.info("Creating Supabase Auth user for mobile_suffix=%s", normalized_mobile[-4:])
            try:
                auth_response = supabase.auth.admin.create_user({
                    "phone": f"+{normalized_mobile}",
                    "phone_confirm": True,
                    "user_metadata": {
                        "name": name,
                        "mobile": normalized_mobile,
                        "role": role,
                    },
                })
                user_id = auth_response.user.id
            except Exception:
                raced_user = AuthService.get_user_by_mobile(normalized_mobile)
                if not raced_user:
                    raise
                AuthService.ensure_role_allowed(raced_user, role)
                user_id = raced_user["id"]
                existing = raced_user

        logger.info("Upserting users row for mobile_suffix=%s role=%s", normalized_mobile[-4:], role)

        user_data = {
            "id": user_id,
            "name": name or existing.get("name") if existing else name,
            "mobile": normalized_mobile,
            "role": role,
            "is_mobile_verified": True,
            "is_active": True,
        }

        response = (
            supabase.table("users")
            .upsert(user_data, on_conflict="id")
            .execute()
        )

        if not response.data:
            raise Exception("Failed to create/update user")

        user = response.data[0]

        if role == "WORKER":
            logger.info("Checking worker profile for user_id_suffix=%s", user_id[-4:])
            worker_profile_response = (
                supabase.table("worker_profiles")
                .select("*")
                .eq("user_id", user_id)
                .execute()
            )

            if not worker_profile_response.data:
                logger.info("Creating worker profile for user_id_suffix=%s", user_id[-4:])
                supabase.table("worker_profiles").insert({
                    "user_id": user_id,
                    "availability_status": "OFFLINE",
                    "profile_completed": False,
                    "onboarding_status": "NOT_STARTED",
                }).execute()

        elif role == "EMPLOYER":
            logger.info("Checking employer profile for user_id_suffix=%s", user_id[-4:])
            employer_profile_response = (
                supabase.table("employer_profiles")
                .select("*")
                .eq("user_id", user_id)
                .execute()
            )

            if not employer_profile_response.data:
                logger.info("Creating employer profile for user_id_suffix=%s", user_id[-4:])
                supabase.table("employer_profiles").insert({
                    "user_id": user_id,
                    "contact_person_name": name,
                    "onboarding_status": "NOT_STARTED",
                    "verification_status": "PENDING",
                }).execute()

        return user

    @staticmethod
    def get_user_by_id(user_id: str) -> dict:
        """Get user by ID."""
        response = (
            supabase.table("users")
            .select("*")
            .eq("id", user_id)
            .execute()
        )
        return response.data[0] if response.data else None

    @staticmethod
    def get_user_by_mobile(mobile: str) -> dict:
        """Get user by mobile number."""
        response = (
            supabase.table("users")
            .select("*")
            .eq("mobile", mobile)
            .execute()
        )
        if not response.data:
            return None
        return response.data[0]

    @staticmethod
    def get_user_by_email(email: str) -> dict | None:
        response = supabase.table("users").select("*").ilike("email", email).execute()
        return response.data[0] if response.data else None

    @staticmethod
    def provision_supabase_user(
        user_id: str,
        name: str,
        role: str,
        email: str | None = None,
        mobile: str | None = None,
    ) -> dict:
        """Create or restore the application row for a Supabase Auth identity."""
        normalized_email = email.strip().lower() if email and email.strip() else None
        normalized_mobile = AuthService.normalize_mobile(mobile) if mobile else None
        existing = AuthService.get_user_by_id(user_id)
        email_user = AuthService.get_user_by_email(normalized_email) if normalized_email else None
        mobile_user = AuthService.get_user_by_mobile(normalized_mobile) if normalized_mobile else None

        for candidate in (email_user, mobile_user):
            if candidate and candidate["id"] != user_id:
                raise ValueError("ACCOUNT_IDENTIFIER_CONFLICT")
        if existing:
            AuthService.ensure_role_allowed(existing, role)
        elif email_user or mobile_user:
            raise ValueError("ACCOUNT_IDENTIFIER_CONFLICT")

        user_data = {
            "id": user_id,
            "name": name.strip() or (existing or {}).get("name") or "GO LESKA user",
            "email": normalized_email or (existing or {}).get("email"),
            "mobile": normalized_mobile or (existing or {}).get("mobile"),
            "role": role,
            "is_mobile_verified": bool(normalized_mobile) or (existing or {}).get("is_mobile_verified", False),
            "is_active": True,
        }
        response = supabase.table("users").upsert(user_data, on_conflict="id").execute()
        if not response.data:
            raise RuntimeError("Failed to provision application user")

        if role == "WORKER":
            profile = supabase.table("worker_profiles").select("id").eq("user_id", user_id).execute()
            if not profile.data:
                supabase.table("worker_profiles").insert({"user_id": user_id, "availability_status": "OFFLINE", "profile_completed": False, "onboarding_status": "NOT_STARTED"}).execute()
        else:
            profile = supabase.table("employer_profiles").select("id").eq("user_id", user_id).execute()
            if not profile.data:
                supabase.table("employer_profiles").insert({"user_id": user_id, "contact_person_name": user_data["name"], "onboarding_status": "NOT_STARTED", "verification_status": "PENDING"}).execute()

        return response.data[0]
