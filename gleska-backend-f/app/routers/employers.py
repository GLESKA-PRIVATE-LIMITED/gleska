"""Employer-specific endpoints."""

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
    """Get current employer's profile."""
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

        return EmployerProfileResponse(**response.data)

    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to load employer onboarding",
        )


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
                required=VerificationService.required_for(employer.get("employer_type") or ""),
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
    required = VerificationService.required_for(employer_type)
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
    required = VerificationService.required_for(employer_type)
    if verification_type.upper() not in required:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Verification is not configured for this employer type")
    if employer_type not in {"REGISTERED_INDUSTRY", "UNREGISTERED_BUSINESS"}:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Verification is not available for this employer type")

    details_response = (
        supabase.table("employer_onboarding_details")
        .select("*")
        .eq("employer_id", profile_response.data["id"])
        .single()
        .execute()
    )
    details = details_response.data or {}
    normalized_verification_type = verification_type.upper()
    identifier = request.reference
    if normalized_verification_type == "GSTIN":
        identifier = details.get("gstin")
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
        return record_response
    if record_response.status == "NOT_CONFIGURED":
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": VerificationService.PROVIDER_NOT_CONFIGURED, "verification": record_response.model_dump(mode="json")},
        )
    failure_code = (
        "CASHFREE_AUTHENTICATION_FAILED"
        if record_response.failure_reason == "CASHFREE_AUTHENTICATION_FAILED"
        else "CASHFREE_VERIFICATION_FAILED"
    )
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={"code": failure_code, "verification": record_response.model_dump(mode="json")},
    )


async def _update_onboarding(
    user: UserResponse,
    employer_type: str,
    data: dict,
):
    """Helper to update onboarding details."""
    try:
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
        if not primary_email or not primary_phone:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Account profile must contain email and mobile before employer onboarding can continue",
            )

        # Account identity is authoritative; client contact values are ignored.
        data["company_email"] = primary_email
        data["company_phone"] = primary_phone

        # Validate required fields for this type
        is_valid, error_msg = OnboardingService.validate_onboarding_fields(
            employer_type, data
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
                **data,
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
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(exc),
            ) from exc

        # Update to completed
        response = (
            supabase.table("employer_profiles")
            .update({"onboarding_status": "COMPLETED"})
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
