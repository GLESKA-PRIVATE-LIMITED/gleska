"""Employer verification state, policy, and provider boundary."""

from typing import Any
import httpx
import logging
from datetime import datetime, timezone

from app.core.config import settings
from app.core.supabase import supabase
from app.schemas.verification import VERIFICATION_TYPES
import re

logger = logging.getLogger(__name__)


class VerificationProviderNotConfigured(Exception):
    """Raised when a real external verification provider is unavailable."""


class VerificationService:
    """Owns verification state and delegates real checks to provider adapters."""

    PROVIDER_NOT_CONFIGURED = "VERIFICATION_PROVIDER_NOT_CONFIGURED"

    @staticmethod
    def required_for(employer_type: str) -> list[str]:
        configured = settings.EMPLOYER_REQUIRED_VERIFICATIONS.strip()
        if not configured:
            return []

        required: list[str] = []
        for mapping in configured.split(";"):
            if not mapping.strip():
                continue
            mapped_type, separator, mapped_verifications = mapping.partition(":")
            if separator and mapped_type.strip().upper() == employer_type.upper():
                required.extend(
                    value.strip().upper()
                    for value in mapped_verifications.replace(",", "|").split("|")
                    if value.strip().upper() in VERIFICATION_TYPES
                )
        return list(dict.fromkeys(required))

    @staticmethod
    def list_for_employer(employer_id: str) -> list[dict[str, Any]]:
        response = (
            supabase.table("employer_verifications")
            .select("*")
            .eq("employer_id", employer_id)
            .execute()
        )
        return response.data or []

    @staticmethod
    def _save_state(
        employer_id: str,
        verification_type: str,
        status: str,
        reason: str,
        reference: str | None = None,
        provider: str | None = None,
        provider_metadata: dict[str, Any] | None = None,
        verified: bool = False,
    ) -> dict[str, Any]:
        response = (
            supabase.table("employer_verifications")
            .upsert(
                {
                    "employer_id": employer_id,
                    "verification_type": verification_type,
                    "status": status,
                    "provider_reference_id": reference,
                    "failure_reason": reason,
                    "verified_at": datetime.now(timezone.utc).isoformat() if verified else None,
                    "provider": provider,
                    "provider_metadata": provider_metadata,
                },
                on_conflict="employer_id,verification_type",
            )
            .execute()
        )
        if not response.data:
            raise RuntimeError("Failed to persist verification state")
        return response.data[0]

    @staticmethod
    def _cashfree_base_url() -> str:
        configured = VerificationService._clean_setting(settings.EMPLOYER_VERIFICATION_API_BASE_URL)
        production = VerificationService._cashfree_environment() == "production"
        expected = "https://api.cashfree.com/verification" if production else "https://sandbox.cashfree.com/verification"
        if configured:
            if configured.rstrip("/").lower() != expected:
                raise ValueError("Cashfree endpoint does not match configured environment")
            return configured.rstrip("/")
        return expected

    @staticmethod
    def _clean_setting(value: str) -> str:
        cleaned = value.strip()
        if len(cleaned) >= 2 and cleaned[0] == cleaned[-1] and cleaned[0] in {"\"", "'"}:
            cleaned = cleaned[1:-1].strip()
        return cleaned

    @staticmethod
    def _cashfree_environment() -> str:
        configured = VerificationService._clean_setting(settings.CASHFREE_ENV).lower()
        return "production" if configured == "production" else "sandbox"

    @staticmethod
    def _cashfree_configured() -> bool:
        return settings.EMPLOYER_VERIFICATION_PROVIDER.lower() == "cashfree" and bool(
            VerificationService._clean_setting(settings.CASHFREE_CLIENT_ID)
            and VerificationService._clean_setting(settings.CASHFREE_CLIENT_SECRET)
        )

    @staticmethod
    async def _verify_cashfree_gstin(gstin: str, business_name: str | None) -> tuple[str, str | None, dict[str, Any] | None, str | None]:
        if not VerificationService._cashfree_configured():
            return "NOT_CONFIGURED", VerificationService.PROVIDER_NOT_CONFIGURED, None, None
        payload: dict[str, str] = {"GSTIN": gstin}
        if business_name:
            payload["business_name"] = business_name[:200]
        client_id = VerificationService._clean_setting(settings.CASHFREE_CLIENT_ID)
        client_secret = VerificationService._clean_setting(settings.CASHFREE_CLIENT_SECRET)
        api_version = VerificationService._clean_setting(settings.CASHFREE_API_VERSION)
        try:
            endpoint = VerificationService._cashfree_base_url()
        except ValueError:
            logger.error(
                "Cashfree GSTIN configuration mismatch environment=%s client_id=%s client_secret=%s",
                VerificationService._cashfree_environment(),
                "present" if client_id else "missing",
                "present" if client_secret else "missing",
            )
            return "FAILED", "CASHFREE_CONFIGURATION_ERROR", None, None
        logger.warning(
            "Cashfree GSTIN request endpoint=%s environment=%s api_version=%s method=%s client_id=%s client_secret=%s",
            endpoint,
            VerificationService._cashfree_environment(),
            api_version,
            "POST",
            "present" if client_id else "missing",
            "present" if client_secret else "missing",
        )
        headers = {
            "x-client-id": client_id,
            "x-client-secret": client_secret,
            "x-api-version": api_version,
            "content-type": "application/json",
        }
        try:
            async with httpx.AsyncClient(timeout=settings.EMPLOYER_VERIFICATION_TIMEOUT_SECONDS) as client:
                response = await client.post(f"{endpoint}/gstin", json=payload, headers=headers)
            body = response.json() if response.content else {}
        except httpx.TimeoutException:
            return "FAILED", "CASHFREE_TIMEOUT", None, None
        except (httpx.HTTPError, ValueError):
            return "FAILED", "CASHFREE_UNAVAILABLE", None, None

        provider_code = str(body.get("code") or "")[:120] if isinstance(body, dict) else ""
        provider_message = str(body.get("message") or "")[:240] if isinstance(body, dict) else ""
        logger.warning(
            "Cashfree GSTIN response status=%s error_code=%s error_message=%s",
            response.status_code,
            provider_code or "none",
            provider_message or "none",
        )
        if response.status_code in {401, 403}:
            return "FAILED", "CASHFREE_AUTHENTICATION_FAILED", None, None
        if response.status_code == 429:
            return "FAILED", "CASHFREE_RATE_LIMITED", None, None
        if response.status_code >= 400:
            return "FAILED", provider_message or "CASHFREE_VERIFICATION_FAILED", None, None
        if not isinstance(body, dict):
            return "FAILED", "CASHFREE_MALFORMED_RESPONSE", None, None

        metadata = {
            key: body.get(key)
            for key in (
                "GSTIN", "legal_name_of_business", "trade_name_of_business", "date_of_registration",
                "taxpayer_type", "gst_in_status", "principal_place_address", "principal_place_split_address",
                "nature_of_business_activities", "last_update_date",
            ) if body.get(key) is not None
        }
        reference = str(body.get("reference_id")) if body.get("reference_id") is not None else None
        if body.get("valid") is True and str(body.get("gst_in_status", "")).lower() == "active":
            return "VERIFIED", None, metadata, reference
        return "FAILED", provider_message or "GSTIN is not valid or active", metadata, reference

    @staticmethod
    async def request_verification(
        employer_id: str,
        verification_type: str,
        employer_type: str,
        reference: str | None = None,
    ) -> dict[str, Any]:
        normalized_type = verification_type.upper()
        if normalized_type not in VERIFICATION_TYPES:
            raise ValueError("Unsupported verification type")

        if normalized_type not in VerificationService.required_for(employer_type):
            raise ValueError("Verification type is not configured for onboarding")

        if normalized_type == "GSTIN" and not re.fullmatch(r"[0-9A-Z]{15}", (reference or "").strip().upper()):
            raise ValueError("A valid 15-character GSTIN is required")
        if normalized_type == "REGISTRATION_NUMBER" and not (reference or "").strip():
            raise ValueError("Registration number is required")
        if normalized_type == "AADHAAR" and not re.fullmatch(r"[0-9]{12}", (reference or "").strip()):
            raise ValueError("A valid 12-digit Aadhaar number is required")

        if normalized_type == "GSTIN":
            status, reason, metadata, provider_reference = await VerificationService._verify_cashfree_gstin(reference.strip().upper(), None)
            return VerificationService._save_state(
                employer_id, normalized_type, status, reason or "", provider_reference,
                provider="cashfree", provider_metadata=metadata, verified=status == "VERIFIED",
            )

        if not VerificationService.provider_is_configured() or not VerificationService.provider_adapter_available():
            return VerificationService._save_state(
                employer_id,
                normalized_type,
                "NOT_CONFIGURED",
                VerificationService.PROVIDER_NOT_CONFIGURED,
                reference,
            )

        raise VerificationProviderNotConfigured(VerificationService.PROVIDER_NOT_CONFIGURED)

    @staticmethod
    def provider_is_configured() -> bool:
        """Return true only when an actual adapter configuration exists."""
        return bool(
            settings.EMPLOYER_VERIFICATION_PROVIDER.strip()
            and settings.EMPLOYER_VERIFICATION_API_BASE_URL.strip()
            and settings.EMPLOYER_VERIFICATION_API_KEY.strip()
        )

    @staticmethod
    def provider_adapter_available() -> bool:
        """Return true only when a provider adapter implementation is deployed."""
        # Credentials alone must never imply that a verification occurred.
        return False

    @staticmethod
    def required_for_for_any_employer_type() -> set[str]:
        """Return configured verification types without inventing business rules."""
        configured = settings.EMPLOYER_REQUIRED_VERIFICATIONS.strip()
        required: set[str] = set()
        for mapping in configured.split(";"):
            _, separator, mapped_verifications = mapping.partition(":")
            if separator:
                required.update(
                    value.strip().upper()
                    for value in mapped_verifications.replace(",", "|").split("|")
                    if value.strip().upper() in VERIFICATION_TYPES
                )
        return required

    @staticmethod
    def assert_required_complete(employer_id: str, employer_type: str) -> None:
        required = VerificationService.required_for(employer_type)
        if not required:
            return

        records = {
            record["verification_type"]: record
            for record in VerificationService.list_for_employer(employer_id)
        }
        incomplete = [
            verification_type
            for verification_type in required
            if records.get(verification_type, {}).get("status") != "VERIFIED"
        ]
        if incomplete:
            raise ValueError(
                "Required verification incomplete: " + ", ".join(incomplete)
            )
