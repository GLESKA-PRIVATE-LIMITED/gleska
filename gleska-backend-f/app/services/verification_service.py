"""Employer verification state, policy, and provider boundary."""

from typing import Any
import httpx
import logging
from datetime import datetime, timezone
from uuid import uuid4

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
    IDENTITY_FIELDS = {
        "business_name",
        "cin_number",
        "gstin",
        "pan_number",
        "udyam_number",
        "registration_number",
        "proprietor_name",
        "director_name",
    }

    @staticmethod
    def identity_changed(previous: dict[str, Any], current: dict[str, Any]) -> bool:
        return any(
            str(previous.get(field) or "").strip().casefold()
            != str(current.get(field) or "").strip().casefold()
            for field in VerificationService.IDENTITY_FIELDS
        )

    @staticmethod
    def invalidate_for_identity_change(employer_id: str) -> None:
        for verification_type in VERIFICATION_TYPES:
            response = (
                supabase.table("employer_verifications")
                .update({
                    "status": "FAILED",
                    "failure_reason": "Onboarding identity changed; verification required again",
                    "verified_at": None,
                })
                .eq("employer_id", employer_id)
                .eq("verification_type", verification_type)
                .eq("status", "VERIFIED")
                .execute()
            )
            if response.data:
                logger.info("Invalidated employer verification after identity change: type=%s", verification_type)

    @staticmethod
    def required_for(employer_type: str, details: dict[str, Any] | None = None) -> list[str]:
        configured = settings.EMPLOYER_REQUIRED_VERIFICATIONS.strip()
        required: list[str] = []
        if employer_type.upper() == "REGISTERED_INDUSTRY":
            required.append("CIN")
            if details and str(details.get("gstin") or "").strip():
                for mapping in configured.split(";"):
                    mapped_type, separator, mapped_verifications = mapping.partition(":")
                    if separator and mapped_type.strip().upper() == employer_type.upper():
                        configured_types = {
                            value.strip().upper()
                            for value in mapped_verifications.replace(",", "|").split("|")
                        }
                        if "GSTIN" in configured_types:
                            required.append("GSTIN")
            return list(dict.fromkeys(required))

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
        expected_details: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        normalized_type = verification_type.upper()
        if normalized_type not in VERIFICATION_TYPES:
            raise ValueError("Unsupported verification type")

        if normalized_type not in VerificationService.required_for(employer_type, expected_details):
            raise ValueError("Verification type is not configured for onboarding")

        if normalized_type == "GSTIN" and not re.fullmatch(r"[0-9A-Z]{15}", (reference or "").strip().upper()):
            raise ValueError("A valid 15-character GSTIN is required")
        if normalized_type == "PAN" and not re.fullmatch(r"[A-Z]{5}[0-9]{4}[A-Z]", (reference or "").strip().upper()):
            raise ValueError("A valid 10-character PAN is required")
        if normalized_type == "CIN" and not re.fullmatch(r"[A-Z][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}", (reference or "").strip().upper()):
            raise ValueError("A valid 21-character CIN is required")
        if normalized_type == "UDYAM" and not re.fullmatch(r"UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}", (reference or "").strip().upper()):
            raise ValueError("A valid Udyam registration number is required")
        if normalized_type == "REGISTRATION_NUMBER" and not (reference or "").strip():
            raise ValueError("Registration number is required")
        if normalized_type == "AADHAAR" and not re.fullmatch(r"[0-9]{12}", (reference or "").strip()):
            raise ValueError("A valid 12-digit Aadhaar number is required")

        if normalized_type == "GSTIN":
            status, reason, metadata, provider_reference = await VerificationService._verify_cashfree_gstin(
                reference.strip().upper(), (expected_details or {}).get("business_name")
            )
            return VerificationService._save_state(
                employer_id, normalized_type, status, reason or "", provider_reference,
                provider="cashfree", provider_metadata=metadata, verified=status == "VERIFIED",
            )

        if not VerificationService.provider_is_configured() or not VerificationService.provider_adapter_available(normalized_type):
            return VerificationService._save_state(
                employer_id,
                normalized_type,
                "NOT_CONFIGURED",
                VerificationService.PROVIDER_NOT_CONFIGURED,
                None,
            )

        status, reason, metadata, provider_reference = await VerificationService._verify_cashfree_identifier(
            normalized_type, reference.strip(), expected_details or {}
        )
        return VerificationService._save_state(
            employer_id,
            normalized_type,
            status,
            reason or "",
            provider_reference,
            provider="cashfree",
            provider_metadata=metadata,
            verified=status == "VERIFIED",
        )

    @staticmethod
    def provider_is_configured() -> bool:
        """Return true only when an actual adapter configuration exists."""
        if settings.EMPLOYER_VERIFICATION_PROVIDER.strip().lower() == "cashfree":
            return VerificationService._cashfree_configured()
        return bool(
            settings.EMPLOYER_VERIFICATION_PROVIDER.strip()
            and settings.EMPLOYER_VERIFICATION_API_BASE_URL.strip()
            and settings.EMPLOYER_VERIFICATION_API_KEY.strip()
        )

    @staticmethod
    def provider_adapter_available(verification_type: str | None = None) -> bool:
        """Return true only when a provider adapter implementation is deployed."""
        return verification_type in {"PAN", "CIN", "UDYAM", "AADHAAR", "BANK"}

    @staticmethod
    async def _verify_cashfree_identifier(
        verification_type: str,
        reference: str,
        expected_details: dict[str, Any],
    ) -> tuple[str, str | None, dict[str, Any] | None, str | None]:
        if not VerificationService._cashfree_configured():
            return "NOT_CONFIGURED", VerificationService.PROVIDER_NOT_CONFIGURED, None, None

        endpoint_by_type = {
            "PAN": "pan/advance",
            "CIN": "cin",
            "UDYAM": "udyam",
            "AADHAAR": "offline-aadhaar/otp",
        }
        payload_by_type = {
            "PAN": {"pan": reference},
            "CIN": {"cin": reference},
            "UDYAM": {"udyam": reference},
            "AADHAAR": {"aadhaar_number": reference},
        }
        endpoint = endpoint_by_type.get(verification_type)
        payload = payload_by_type.get(verification_type)
        if not endpoint or payload is None:
            return "NOT_CONFIGURED", VerificationService.PROVIDER_NOT_CONFIGURED, None, None

        payload["verification_id"] = f"{verification_type.lower()}_{uuid4().hex[:12]}"
        try:
            base_url = VerificationService._cashfree_base_url()
            headers = {
                "x-client-id": VerificationService._clean_setting(settings.CASHFREE_CLIENT_ID),
                "x-client-secret": VerificationService._clean_setting(settings.CASHFREE_CLIENT_SECRET),
                "content-type": "application/json",
                "accept": "application/json",
            }
            if verification_type != "CIN":
                headers["x-api-version"] = VerificationService._clean_setting(settings.CASHFREE_API_VERSION)
            logger.info(
                "Cashfree verification request: endpoint=%s method=POST environment=%s client_id_present=%s client_secret_present=%s request_body_keys=%s",
                f"{base_url}/{endpoint}",
                VerificationService._cashfree_environment(),
                bool(headers["x-client-id"]),
                bool(headers["x-client-secret"]),
                sorted(payload.keys()),
            )
            async with httpx.AsyncClient(timeout=settings.EMPLOYER_VERIFICATION_TIMEOUT_SECONDS) as client:
                response = await client.post(f"{base_url}/{endpoint}", json=payload, headers=headers)
            body = response.json() if response.content else {}
        except httpx.TimeoutException:
            return "PENDING", "CASHFREE_TIMEOUT", None, None
        except (httpx.HTTPError, ValueError):
            return "FAILED", "CASHFREE_UNAVAILABLE", None, None

        if response.status_code in {401, 403}:
            logger.error(
                "Cashfree verification authentication failure: type=%s endpoint=%s status=%s code=%s message=%s",
                verification_type,
                endpoint,
                response.status_code,
                str(body.get("code") or "")[:120] if isinstance(body, dict) else "",
                str(body.get("message") or "")[:240] if isinstance(body, dict) else "",
            )
            return "FAILED", "CASHFREE_AUTHENTICATION_FAILED", None, None
        if response.status_code == 429:
            return "PENDING", "CASHFREE_RATE_LIMITED", None, None
        if response.status_code >= 400 or not isinstance(body, dict):
            provider_message = str(body.get("message") or "")[:240] if isinstance(body, dict) else "malformed JSON response"
            logger.error(
                "Cashfree verification failed: type=%s endpoint=%s status=%s code=%s message=%s",
                verification_type,
                endpoint,
                response.status_code,
                str(body.get("code") or "")[:120] if isinstance(body, dict) else "",
                provider_message,
            )
            return "FAILED", provider_message or "CASHFREE_VERIFICATION_FAILED", None, None

        logger.info(
            "Cashfree verification response: type=%s endpoint=%s status=%s code=%s message=%s",
            verification_type,
            endpoint,
            response.status_code,
            str(body.get("code") or "")[:120],
            str(body.get("message") or "")[:240],
        )

        metadata = VerificationService._safe_provider_metadata(body)
        provider_reference = str(body.get("reference_id")) if body.get("reference_id") is not None else None
        if body.get("valid") is False or str(body.get("status", "")).upper() in {"INVALID", "FAILED"}:
            return "FAILED", str(body.get("message") or "Provider rejected the identifier")[:240], metadata, provider_reference
        if verification_type == "CIN":
            company_status = str(body.get("company_status") or body.get("companyStatus") or body.get("status") or "").upper()
            if company_status in {"INACTIVE", "DISSOLVED", "STRUCK_OFF", "CLOSED", "INVALID", "FAILED"}:
                return "FAILED", "Provider reports the company is not active", metadata, provider_reference
        if body.get("valid") is not True and str(body.get("status", "")).upper() not in {"VALID", "VERIFIED", "SUCCESS", "COMPLETED"}:
            return "PENDING", "Provider returned no definitive verification result", metadata, provider_reference

        comparison_error = VerificationService._comparison_error(verification_type, reference, body, expected_details)
        if comparison_error:
            return "FAILED", comparison_error, metadata, provider_reference
        return "VERIFIED", None, metadata, provider_reference

    @staticmethod
    def _safe_provider_metadata(body: dict[str, Any]) -> dict[str, Any]:
        sensitive_keys = {"aadhaar", "aadhaar_number", "pan", "pan_number", "raw_details"}
        return {
            str(key): value
            for key, value in body.items()
            if str(key).lower() not in sensitive_keys and isinstance(value, (str, int, float, bool, list, dict, type(None)))
        }

    @staticmethod
    def _comparison_error(verification_type: str, reference: str, body: dict[str, Any], expected: dict[str, Any]) -> str | None:
        returned_identifier = (
            body.get("GSTIN") or body.get("gstin") if verification_type == "GSTIN" else
            body.get("PAN") or body.get("pan") if verification_type == "PAN" else
            body.get("CIN") or body.get("cin") or body.get("cin_number") if verification_type == "CIN" else
            body.get("udyam") or body.get("udyam_number") if verification_type == "UDYAM" else
            None
        )
        if returned_identifier and str(returned_identifier).strip().upper() != reference.strip().upper():
            return "Provider identifier does not match the submitted identifier"
        if verification_type == "CIN" and not returned_identifier:
            return "Provider response did not include the verified CIN"
        if verification_type in {"PAN", "CIN", "UDYAM"}:
            entered_name = expected.get("business_name") or expected.get("company_name")
            returned_name = body.get("company_name") or body.get("companyName") or body.get("registered_name") or body.get("enterpriseName") or body.get("name")
            if verification_type == "CIN" and not returned_name:
                return "Provider response did not include the verified company name"
            if entered_name and returned_name and VerificationService._normalize_name(entered_name) != VerificationService._normalize_name(returned_name):
                return "Provider business name does not match onboarding business name"
        if verification_type == "AADHAAR":
            entered_name = expected.get("proprietor_name") or expected.get("director_name")
            returned_name = body.get("name") or body.get("name_on_aadhaar")
            if entered_name and returned_name and VerificationService._normalize_name(entered_name) != VerificationService._normalize_name(returned_name):
                return "Provider identity name does not match onboarding person"
        return None

    @staticmethod
    def _normalize_name(value: object) -> str:
        return re.sub(r"[^a-z0-9]", "", str(value).lower())

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
    def assert_required_complete(employer_id: str, employer_type: str, details: dict[str, Any] | None = None) -> None:
        required = VerificationService.required_for(employer_type, details)
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
