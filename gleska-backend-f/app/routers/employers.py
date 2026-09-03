from typing import Any
import re
from fastapi import APIRouter, HTTPException, status, Depends
import logging
from app.core.security import get_current_user, require_employer
from app.core.supabase import supabase
from app.schemas.auth import UserResponse
from app.schemas.employer import (
    EmployerProfileResponse,
    EmployerOnboardingDetailsResponse,
    SelectEmployerTypeSchema,
    RegisteredIndustryOnboardingSchema,
    RegisteredBusinessOnboardingSchema,
    UnregisteredBusinessOnboardingSchema,
    IndividualOnboardingSchema,
    CompleteOnboardingSchema,
    LegalIdentityOnboardingSchema,
    CompanyProfileUpdateSchema,
    DirectorProfileUpdateSchema,
)
from app.services.onboarding_service import OnboardingService
from app.services.verification_service import VerificationService
from app.schemas.verification import (
    VerificationRecordResponse,
    VerificationRequestSchema,
    VerificationRequirementsResponse,
)

router = APIRouter(prefix="/employers", tags=["employers"])
logger = logging.getLogger(__name__)


@router.get("/me", response_model=EmployerProfileResponse)
async def get_employer_profile(user: UserResponse = Depends(require_employer)):
    """Get current employer's profile with real-time verification status alignment."""
    try:
        response = (
            supabase.table("employer_profiles")
            .select("*")
            .eq("user_id", user.id)
            .single()
            .execute()
        )

        if not response.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Employer profile not found",
            )

        employer = response.data
        if employer.get("id"):
            details_response = (
                supabase.table("employer_onboarding_details")
                .select("*")
                .eq("employer_id", employer["id"])
                .execute()
            )
            details = details_response.data[0] if details_response.data else {}
            calculated_status = VerificationService.calculate_overall_status(
                employer.get("employer_type") or "",
                employer["id"],
                details,
            )
            if calculated_status != employer.get("verification_status"):
                update_res = (
                    supabase.table("employer_profiles")
                    .update({"verification_status": calculated_status})
                    .eq("id", employer["id"])
                    .execute()
                )
                if update_res.data:
                    employer["verification_status"] = calculated_status

        return EmployerProfileResponse(**employer)

    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to load employer onboarding",
        )


@router.get("/me/available-worker-count")
async def get_available_worker_count(user: UserResponse = Depends(require_employer)):
    """Return workers currently available for matching."""
    del user
    try:
        response = (
            supabase.table("worker_profiles")
            .select("id", count="exact", head=True)
            .eq("availability_status", "AVAILABLE")
            .eq("profile_completed", True)
            .execute()
        )
        return {"count": response.count or 0}
    except Exception as exc:
        logger.exception("Available worker count request failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to load available worker count",
        ) from exc


@router.get("/onboarding")
async def get_onboarding_status(user: UserResponse = Depends(require_employer)):
    """Get employer's onboarding status and details."""
    try:
        # Get employer profile
        profile_response = (
            supabase.table("employer_profiles")
            .select("*")
            .eq("user_id", user.id)
            .single()
            .execute()
        )

        if not profile_response.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Employer profile not found",
            )

        employer = profile_response.data

        # Get onboarding details if they exist
        details = None
        if employer.get("id"):
            details_response = (
                supabase.table("employer_onboarding_details")
                .select("*")
                .eq("employer_id", employer["id"])
                .execute()
            )
            if details_response.data:
                details = EmployerOnboardingDetailsResponse(**details_response.data[0])

        return {
            "employer": EmployerProfileResponse(**employer),
            "details": details,
            "verification": VerificationRequirementsResponse(
                employer_type=employer.get("employer_type") or "",
                required=VerificationService.required_for(
                    employer.get("employer_type") or "",
                    details.model_dump() if details else {},
                ),
                records=[VerificationRecordResponse(**record) for record in VerificationService.list_for_employer(employer["id"])],
            ),
        }

    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to select employer type",
        )


@router.post("/onboarding/type", response_model=EmployerProfileResponse)
async def select_employer_type(
    request: SelectEmployerTypeSchema,
    user: UserResponse = Depends(require_employer),
):
    """Select employer type and start onboarding."""
    valid_types = [
        "REGISTERED_INDUSTRY",
        "REGISTERED_BUSINESS",
        "UNREGISTERED_BUSINESS",
        "INDIVIDUAL",
    ]

    if request.employer_type not in valid_types:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid employer type. Must be one of: {', '.join(valid_types)}",
        )

    try:
        current_response = (
            supabase.table("employer_profiles")
            .select("*")
            .eq("user_id", user.id)
            .single()
            .execute()
        )
        current_employer = current_response.data
        if not current_employer:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employer profile not found")
        if current_employer.get("onboarding_status") == "COMPLETED":
            if current_employer.get("employer_type") == request.employer_type:
                return EmployerProfileResponse(**current_employer)
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Completed employer onboarding cannot be changed",
            )

        # Update employer profile with type and mark as in progress
        response = (
            supabase.table("employer_profiles")
            .update({
                "employer_type": request.employer_type,
                "onboarding_status": "IN_PROGRESS",
            })
            .eq("user_id", user.id)
            .execute()
        )

        if not response.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Employer profile not found",
            )

        return EmployerProfileResponse(**response.data[0])

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )


@router.put("/onboarding/registered-industry", response_model=EmployerOnboardingDetailsResponse)
async def update_registered_industry_onboarding(
    request: RegisteredIndustryOnboardingSchema,
    user: UserResponse = Depends(require_employer),
):
    """Update registered industry onboarding details."""
    return await _update_onboarding(user, "REGISTERED_INDUSTRY", request.dict())


@router.put("/onboarding/registered-business", response_model=EmployerOnboardingDetailsResponse)
async def update_registered_business_onboarding(
    request: RegisteredBusinessOnboardingSchema,
    user: UserResponse = Depends(require_employer),
):
    """Update registered business onboarding details."""
    return await _update_onboarding(user, "REGISTERED_BUSINESS", request.dict())


@router.put("/onboarding/unregistered-business", response_model=EmployerOnboardingDetailsResponse)
async def update_unregistered_business_onboarding(
    request: UnregisteredBusinessOnboardingSchema,
    user: UserResponse = Depends(require_employer),
):
    """Update unregistered business onboarding details."""
    return await _update_onboarding(user, "UNREGISTERED_BUSINESS", request.dict())


@router.put("/onboarding/individual", response_model=EmployerOnboardingDetailsResponse)
async def update_individual_onboarding(
    request: IndividualOnboardingSchema,
    user: UserResponse = Depends(require_employer),
):
    """Update individual employer onboarding details."""
    return await _update_onboarding(user, "INDIVIDUAL", request.dict())


@router.put("/onboarding/legal-identity", response_model=EmployerOnboardingDetailsResponse)
async def update_legal_identity(
    request: LegalIdentityOnboardingSchema,
    user: UserResponse = Depends(require_employer),
):
    """Save legal identity fields before verification-gated details onboarding."""
    profile_response = (
        supabase.table("employer_profiles")
        .select("*")
        .eq("user_id", user.id)
        .single()
        .execute()
    )
    employer = profile_response.data
    if not employer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employer profile not found")
    if employer.get("employer_type") not in {"REGISTERED_INDUSTRY", "REGISTERED_BUSINESS", "UNREGISTERED_BUSINESS"}:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Legal identity verification is not configured for this employer type")

    data = {key: value for key, value in request.dict().items() if value is not None}
    if not data:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="At least one legal identity field is required")
    if employer.get("employer_type") in {"REGISTERED_INDUSTRY", "REGISTERED_BUSINESS"}:
        if not str(data.get("business_name") or "").strip():
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Legal / company name is required")
        if not str(data.get("cin_number") or "").strip():
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="CIN is required")
    existing_response = (
        supabase.table("employer_onboarding_details")
        .select("*")
        .eq("employer_id", employer["id"])
        .execute()
    )
    previous = existing_response.data[0] if existing_response.data else {}
    merged_identity = {**previous, **data}
    if employer.get("onboarding_status") == "COMPLETED" and VerificationService.identity_changed(previous, merged_identity):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Completed employer identity cannot be changed")
    if VerificationService.identity_changed(previous, merged_identity):
        VerificationService.invalidate_for_identity_change(employer["id"])

    response = (
        supabase.table("employer_onboarding_details")
        .upsert({"employer_id": employer["id"], **merged_identity}, on_conflict="employer_id")
        .execute()
    )
    if not response.data:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to save legal identity")
    return EmployerOnboardingDetailsResponse(**response.data[0])


@router.get("/onboarding/verifications", response_model=VerificationRequirementsResponse)
async def get_onboarding_verifications(user: UserResponse = Depends(require_employer)):
    """Return configured requirements and persisted verification state."""
    profile_response = (
        supabase.table("employer_profiles")
        .select("*")
        .eq("user_id", user.id)
        .single()
        .execute()
    )
    if not profile_response.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employer profile not found")

    employer = profile_response.data
    employer_type = employer.get("employer_type") or ""
    details_response = (
        supabase.table("employer_onboarding_details")
        .select("*")
        .eq("employer_id", employer["id"])
        .execute()
    )
    details = details_response.data[0] if details_response.data else {}
    required = VerificationService.required_for(employer_type, details)
    return VerificationRequirementsResponse(
        employer_type=employer_type,
        required=required,
        records=[
            VerificationRecordResponse(**record)
            for record in VerificationService.list_for_employer(employer["id"])
            if record.get("verification_type") in required
        ],
    )


@router.post(
    "/onboarding/verifications/{verification_type}",
    response_model=VerificationRecordResponse,
)
async def request_onboarding_verification(
    verification_type: str,
    request: VerificationRequestSchema,
    user: UserResponse = Depends(require_employer),
):
    """Request provider-backed verification without exposing provider details."""
    profile_response = (
        supabase.table("employer_profiles")
        .select("*")
        .eq("user_id", user.id)
        .single()
        .execute()
    )
    if not profile_response.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employer profile not found")

    employer_type = profile_response.data.get("employer_type") or ""
    details_response = (
        supabase.table("employer_onboarding_details")
        .select("*")
        .eq("employer_id", profile_response.data["id"])
        .single()
        .execute()
    )
    details = details_response.data or {}
    required = VerificationService.required_for(employer_type, details)
    if verification_type.upper() not in required:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=VerificationService.VERIFICATION_NOT_CONFIGURED)
    normalized_verification_type = verification_type.upper()
    if normalized_verification_type == "CIN" and not str(details.get("business_name") or "").strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=VerificationService.BUSINESS_NAME_MISSING)
    identifier = request.reference
    if normalized_verification_type == "GSTIN":
        identifier = details.get("gstin")
    elif normalized_verification_type == "PAN":
        identifier = details.get("pan_number")
    elif normalized_verification_type == "CIN":
        identifier = details.get("cin_number")
    elif normalized_verification_type == "UDYAM":
        identifier = details.get("udyam_number")
    elif normalized_verification_type == "REGISTRATION_NUMBER":
        identifier = details.get("registration_number")
    elif normalized_verification_type == "AADHAAR":
        identifier = details.get("proprietor_aadhaar")
        if not identifier or not str(identifier).strip():
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Proprietor Aadhaar is required")

    try:
        record = await VerificationService.request_verification(
            profile_response.data["id"],
            verification_type,
            employer_type,
            identifier,
            expected_details=details,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except Exception as exc:
        logger.warning("Employer verification request failed: type=%s error=%s", verification_type, type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": VerificationService.PROVIDER_NOT_CONFIGURED},
        ) from exc

    record_response = VerificationRecordResponse(**record)
    if record_response.status == "VERIFIED":
        calculated_status = VerificationService.calculate_overall_status(
            employer_type,
            profile_response.data["id"],
            details,
        )
        if calculated_status == "VERIFIED":
            supabase.table("employer_profiles").update({"verification_status": "VERIFIED"}).eq("id", profile_response.data["id"]).execute()
        return record_response
    if record_response.status == "NOT_CONFIGURED":
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": VerificationService.VERIFICATION_NOT_CONFIGURED, "verification": record_response.model_dump(mode="json")},
        )
    if record_response.status == "PENDING":
        pending_status = (
            status.HTTP_429_TOO_MANY_REQUESTS
            if record_response.failure_reason == VerificationService.CASHFREE_RATE_LIMITED
            else status.HTTP_504_GATEWAY_TIMEOUT
            if record_response.failure_reason == VerificationService.CASHFREE_TIMEOUT
            else status.HTTP_503_SERVICE_UNAVAILABLE
        )
        raise HTTPException(
            status_code=pending_status,
            detail={"code": record_response.failure_reason, "verification": record_response.model_dump(mode="json")},
        )
    failure_code = (
        record_response.failure_reason
        if record_response.failure_reason in {
            VerificationService.CASHFREE_INSUFFICIENT_BALANCE,
            VerificationService.CASHFREE_AUTHENTICATION_FAILED,
            VerificationService.CASHFREE_VERIFICATION_FAILED,
            VerificationService.CASHFREE_UNAVAILABLE,
            VerificationService.CASHFREE_MALFORMED_RESPONSE,
        }
        else VerificationService.CASHFREE_VERIFICATION_FAILED
    )
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={"code": failure_code, "verification": record_response.model_dump(mode="json")},
    )


@router.put("/company-profile", response_model=EmployerOnboardingDetailsResponse)
async def update_company_profile(
    request: CompanyProfileUpdateSchema,
    user: UserResponse = Depends(require_employer),
):
    """Update company profile details from employer dashboard."""
    try:
        profile_response = (
            supabase.table("employer_profiles")
            .select("*")
            .eq("user_id", user.id)
            .single()
            .execute()
        )
        if not profile_response.data:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employer profile not found")

        employer = profile_response.data
        existing_details_response = (
            supabase.table("employer_onboarding_details")
            .select("*")
            .eq("employer_id", employer["id"])
            .execute()
        )
        previous_details = existing_details_response.data[0] if existing_details_response.data else {}

        raw_data = request.model_dump()
        data = {key: value for key, value in raw_data.items() if value is not None}
        if not data:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="At least one field is required to update")

        pincode = str(data.get("pincode", "")).strip()
        if pincode and not re.fullmatch(r"[0-9]{6}", pincode):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="pincode must be a valid 6-digit number")

        if "company_phone" in data:
            data["company_phone"] = str(data["company_phone"]).strip()
        if "company_email" in data:
            data["company_email"] = str(data["company_email"]).strip().lower()

        # Discard fields that do not belong to the database schema
        sanitized_data = {k: v for k, v in data.items() if k != "tan_number"}

        merged_details = {**previous_details, **sanitized_data, "employer_id": employer["id"]}

        details_response = (
            supabase.table("employer_onboarding_details")
            .upsert(merged_details, on_conflict="employer_id")
            .execute()
        )
        if not details_response.data:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to update company details")

        return EmployerOnboardingDetailsResponse(**details_response.data[0])

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to update company profile: %s", exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Unable to update company profile")


@router.put("/director-profile", response_model=EmployerOnboardingDetailsResponse)
async def update_director_profile(
    request: DirectorProfileUpdateSchema,
    user: UserResponse = Depends(require_employer),
):
    """Update director / proprietor profile details from employer dashboard."""
    try:
        profile_response = (
            supabase.table("employer_profiles")
            .select("*")
            .eq("user_id", user.id)
            .single()
            .execute()
        )
        if not profile_response.data:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employer profile not found")

        employer = profile_response.data
        existing_details_response = (
            supabase.table("employer_onboarding_details")
            .select("*")
            .eq("employer_id", employer["id"])
            .execute()
        )
        previous_details = existing_details_response.data[0] if existing_details_response.data else {}

        raw_data = request.model_dump()
        data = {key: value for key, value in raw_data.items() if value is not None}
        if not data:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="At least one field is required to update")

        update_dict: dict[str, Any] = {}
        if "director_name" in data and str(data["director_name"]).strip():
            name_val = str(data["director_name"]).strip()
            update_dict["director_name"] = name_val
            update_dict["proprietor_name"] = name_val
        if "director_phone" in data and str(data["director_phone"]).strip():
            update_dict["director_phone"] = str(data["director_phone"]).strip()
        if "director_email" in data and str(data["director_email"]).strip():
            update_dict["director_email"] = str(data["director_email"]).strip().lower()
        if "director_address" in data and str(data["director_address"]).strip():
            update_dict["director_address"] = str(data["director_address"]).strip()
        if "director_aadhaar" in data and str(data["director_aadhaar"]).strip():
            aadhaar_val = str(data["director_aadhaar"]).strip()
            update_dict["director_aadhaar"] = aadhaar_val
            update_dict["proprietor_aadhaar"] = aadhaar_val
        if "director_pan" in data and str(data["director_pan"]).strip():
            update_dict["pan_number"] = str(data["director_pan"]).strip().upper()

        extra_director_data = previous_details.get("director_data") or []
        if not isinstance(extra_director_data, list):
            extra_director_data = []

        director_meta: dict[str, Any] = dict(extra_director_data[0]) if extra_director_data and isinstance(extra_director_data[0], dict) else {}
        if "director_din" in data:
            director_meta["din"] = str(data["director_din"]).strip()
        if "director_blood_group" in data:
            director_meta["blood_group"] = str(data["director_blood_group"]).strip()
        if "director_name" in data:
            director_meta["name"] = str(data["director_name"]).strip()
        if director_meta:
            update_dict["director_data"] = [director_meta]

        merged_details = {**previous_details, **update_dict, "employer_id": employer["id"]}

        details_response = (
            supabase.table("employer_onboarding_details")
            .upsert(merged_details, on_conflict="employer_id")
            .execute()
        )
        if not details_response.data:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to update director profile")

        if update_dict.get("director_name"):
            supabase.table("employer_profiles").update({"contact_person_name": update_dict["director_name"]}).eq("id", employer["id"]).execute()

        return EmployerOnboardingDetailsResponse(**details_response.data[0])

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to update director profile: %s", exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Unable to update director profile")


async def _update_onboarding(
    user: UserResponse,
    employer_type: str,
    data: dict,
):
    """Helper to update onboarding details."""
    try:
        data = {key: value for key, value in data.items() if value is not None}
        # Validate type matches
        profile_response = (
            supabase.table("employer_profiles")
            .select("*")
            .eq("user_id", user.id)
            .single()
            .execute()
        )

        if not profile_response.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Employer profile not found",
            )

        employer = profile_response.data

        if employer.get("employer_type") != employer_type:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Employer type mismatch. Expected {employer.get('employer_type')}",
            )

        account_response = (
            supabase.table("users")
            .select("email, mobile")
            .eq("id", user.id)
            .single()
            .execute()
        )
        account = account_response.data or {}
        primary_email = str(account.get("email") or "").strip().lower()
        primary_phone = str(account.get("mobile") or "").strip()

        # Prefer user-provided company email/phone; fall back to account profile defaults
        provided_email = str(data.get("company_email") or "").strip().lower()
        provided_phone = str(data.get("company_phone") or "").strip()

        effective_email = provided_email or primary_email
        effective_phone = provided_phone or primary_phone

        if not effective_email or not effective_phone:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Employer email and phone number are required before onboarding can continue",
            )

        data["company_email"] = effective_email
        data["company_phone"] = effective_phone

        existing_details_response = (
            supabase.table("employer_onboarding_details")
            .select("*")
            .eq("employer_id", employer["id"])
            .execute()
        )
        previous_details = existing_details_response.data[0] if existing_details_response.data else {}
        merged_details = {**previous_details, **data}
        identity_for_comparison = merged_details
        if employer_type in {"REGISTERED_INDUSTRY", "REGISTERED_BUSINESS"}:
            identity_for_comparison = {
                **previous_details,
                **{
                    field: merged_details.get(field)
                    for field in VerificationService.IDENTITY_FIELDS
                    if str(previous_details.get(field) or "").strip()
                },
            }
        identity_changed = VerificationService.identity_changed(previous_details, identity_for_comparison)
        if employer.get("onboarding_status") == "COMPLETED" and identity_changed:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Completed employer identity cannot be changed",
            )
        if identity_changed:
            VerificationService.invalidate_for_identity_change(employer["id"])

        # Legal verification is required for final completion, not for saving
        # onboarding details. This keeps the step order aligned with the frontend:
        # details -> review -> verification -> complete.

        # Validate required fields for this type
        is_valid, error_msg = OnboardingService.validate_onboarding_fields(
            employer_type,
            data,
            require_registered_business_location=employer_type != "REGISTERED_BUSINESS",
        )
        if not is_valid:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=error_msg,
            )

        # Upsert onboarding details
        details_response = (
            supabase.table("employer_onboarding_details")
            .upsert({
                "employer_id": employer["id"],
                **merged_details,
            }, on_conflict="employer_id")
            .execute()
        )

        if not details_response.data:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to save onboarding details",
            )

        return EmployerOnboardingDetailsResponse(**details_response.data[0])

    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to save onboarding details",
        )


@router.post("/onboarding/complete", response_model=EmployerProfileResponse)
async def complete_onboarding(
    request: CompleteOnboardingSchema,
    user: UserResponse = Depends(require_employer),
):
    """Mark onboarding as complete."""
    try:
        # Get employer profile
        profile_response = (
            supabase.table("employer_profiles")
            .select("*")
            .eq("user_id", user.id)
            .single()
            .execute()
        )

        if not profile_response.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Employer profile not found",
            )

        employer = profile_response.data

        if employer.get("onboarding_status") != "IN_PROGRESS":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Can only complete onboarding that is in progress",
            )

        employer_type = employer.get("employer_type")
        if not employer_type:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Employer type must be selected before completing onboarding",
            )

        details_response = (
            supabase.table("employer_onboarding_details")
            .select("*")
            .eq("employer_id", employer["id"])
            .execute()
        )
        if not details_response.data:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Onboarding details must be saved before completion",
            )

        is_valid, error_msg = OnboardingService.validate_onboarding_fields(
            employer_type,
            details_response.data[0],
        )
        if not is_valid:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=error_msg,
            )

        try:
            VerificationService.assert_required_complete(
                employer["id"],
                employer_type,
                details_response.data[0],
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(exc),
            ) from exc

        calculated_status = VerificationService.calculate_overall_status(
            employer_type,
            employer["id"],
            details_response.data[0],
        )

        completion_update = {
            "onboarding_status": "COMPLETED",
            "verification_status": calculated_status,
        }

        # Update to completed
        response = (
            supabase.table("employer_profiles")
            .update(completion_update)
            .eq("user_id", user.id)
            .execute()
        )

        if not response.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Failed to complete onboarding",
            )

        return EmployerProfileResponse(**response.data[0])

    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to complete onboarding",
        )
