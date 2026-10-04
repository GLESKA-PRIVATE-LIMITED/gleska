from typing import Any
import re
from fastapi import APIRouter, HTTPException, status, Depends
import logging
from app.core.security import get_current_user, require_employer
from app.core.supabase import supabase
from app.schemas.auth import UserResponse
from app.schemas.employer import (
    EmployerProfileResponse,
    EmployerMeResponse,
    EmployerProfileUpdateResponse,
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
    EmployerPreferencesResponse,
    EmployerPreferencesUpdate,
)
from app.schemas.worker import ProfilePhotoUploadRequest
from app.services.onboarding_service import OnboardingService
from app.services.entitlements import employer_state
from app.services.job_match_service import JobMatchService
from app.services.profile_photo_service import (
    delete_profile_photo,
    get_profile_photo_path,
    get_signed_profile_photo_url,
    now_iso,
    validate_profile_photo,
)
from app.services.verification_service import VerificationService
from app.schemas.verification import (
    VerificationRecordResponse,
    VerificationOTPRequestSchema,
    VerificationRequestSchema,
    VerificationRequirementsResponse,
)

router = APIRouter(prefix="/employers", tags=["employers"])
logger = logging.getLogger(__name__)


@router.get("/me/preferences", response_model=EmployerPreferencesResponse)
async def get_employer_preferences(user: UserResponse = Depends(require_employer)):
    response = (
        supabase.table("employer_preferences")
        .select("job_matching_notifications, attendance_notifications, security_alerts, language, updated_at")
        .eq("user_id", user.id)
        .maybe_single()
        .execute()
    )
    data = response.data if response else {}
    if not data:
        return EmployerPreferencesResponse()

    return EmployerPreferencesResponse(
        job_matching_notifications=bool(data.get("job_matching_notifications", True)),
        attendance_notifications=bool(data.get("attendance_notifications", True)),
        security_alerts=bool(data.get("security_alerts", True)),
        language=data.get("language") or "EN",
        updated_at=data.get("updated_at"),
    )


@router.put("/me/preferences", response_model=EmployerPreferencesResponse)
async def update_employer_preferences(
    preferences: EmployerPreferencesUpdate,
    user: UserResponse = Depends(require_employer),
):
    update_payload = preferences.model_dump(exclude_none=True)
    if update_payload:
        supabase.table("employer_preferences").upsert(
            {"user_id": user.id, **update_payload},
            on_conflict="user_id",
        ).execute()

    return await get_employer_preferences(user)


@router.get("/me", response_model=EmployerMeResponse)
async def get_employer_profile(user: UserResponse = Depends(require_employer)):
    """Get the authenticated employer's consolidated, type-aware profile."""
    try:
        return _load_employer_profile_contract(user)

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to load employer profile: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to load employer onboarding",
        )


@router.post("/me/profile-photo/upload-start")
async def start_employer_profile_photo_upload(
    request: ProfilePhotoUploadRequest,
    user: UserResponse = Depends(require_employer),
):
    try:
        validate_profile_photo(request)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    return {"storage_path": get_profile_photo_path(user.id, request.original_filename)}


@router.post("/me/profile-photo/upload-complete")
async def complete_employer_profile_photo_upload(
    request: ProfilePhotoUploadRequest,
    user: UserResponse = Depends(require_employer),
):
    try:
        validate_profile_photo(request)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    expected_prefix = f"users/{user.id}/"
    storage_path = request.storage_path
    if (
        not storage_path
        or not storage_path.startswith(expected_prefix)
        or any(part in {"", ".", ".."} for part in storage_path.split("/"))
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid profile photo path",
        )

    profile_photo_url = get_signed_profile_photo_url(storage_path)
    if not profile_photo_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded profile photo was not found",
        )

    current_response = (
        supabase.table("users")
        .select("profile_photo_path")
        .eq("id", user.id)
        .single()
        .execute()
    )
    if not current_response.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employer account not found")
    old_path = current_response.data.get("profile_photo_path")

    update_response = (
        supabase.table("users")
        .update({"profile_photo_path": storage_path, "updated_at": now_iso()})
        .eq("id", user.id)
        .execute()
    )
    if not update_response.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save employer profile photo",
        )

    if old_path and old_path != storage_path:
        try:
            delete_profile_photo(old_path)
        except Exception:
            logger.exception("Failed to remove replaced employer profile photo for user_id=%s", user.id)

    return {"profile_photo_url": profile_photo_url}


@router.delete("/me/profile-photo")
async def delete_employer_profile_photo(user: UserResponse = Depends(require_employer)):
    current_response = (
        supabase.table("users")
        .select("profile_photo_path")
        .eq("id", user.id)
        .single()
        .execute()
    )
    if not current_response.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employer account not found")

    old_path = current_response.data.get("profile_photo_path")
    update_response = (
        supabase.table("users")
        .update({"profile_photo_path": None, "updated_at": now_iso()})
        .eq("id", user.id)
        .execute()
    )
    if not update_response.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to remove employer profile photo",
        )
    if old_path:
        try:
            delete_profile_photo(old_path)
        except Exception:
            logger.exception("Failed to remove employer profile photo storage object for user_id=%s", user.id)
    return {"profile_photo_url": None}


@router.get("/me/available-worker-count")
async def get_available_worker_count(user: UserResponse = Depends(require_employer)):
    """Return distinct currently eligible worker matches across this employer's jobs."""
    try:
        return {
            "count": JobMatchService.available_worker_count_for_user(user),
            "active_count": JobMatchService.active_worker_count_for_user(user),
        }
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
                active_details = OnboardingService.active_details_for_type(
                    employer.get("employer_type") or "", details_response.data[0]
                )
                details = EmployerOnboardingDetailsResponse(**active_details)

        required_verifications = VerificationService.required_for(
            employer.get("employer_type") or "", details.model_dump() if details else {}
        )

        return {
            "employer": EmployerProfileResponse(**employer),
            "details": details,
            "verification": VerificationRequirementsResponse(
                employer_type=employer.get("employer_type") or "",
                required=required_verifications,
                records=[
                    VerificationRecordResponse(**_public_verification_record(record))
                    for record in VerificationService.list_for_employer(employer["id"])
                    if record.get("verification_type") in required_verifications
                ],
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
    """Set the employer directory and start onboarding when applicable."""
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
        previous_type = current_employer.get("employer_type")
        if previous_type == request.employer_type:
            if (
                request.employer_type == "INDIVIDUAL"
                and current_employer.get("onboarding_status") != "COMPLETED"
            ):
                response = (
                    supabase.table("employer_profiles")
                    .update({"onboarding_status": "COMPLETED"})
                    .eq("user_id", user.id)
                    .execute()
                )
                if not response.data:
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail="Employer profile not found",
                    )
                return EmployerProfileResponse(**response.data[0])
            return EmployerProfileResponse(**current_employer)

        if request.employer_type != "INDIVIDUAL" or previous_type:
            details_response = (
                supabase.table("employer_onboarding_details")
                .select("*")
                .eq("employer_id", current_employer["id"])
                .execute()
            )
            existing_details = details_response.data[0] if details_response.data else {}
            target_details, directory_data = OnboardingService.switch_directory_details(
                previous_type, request.employer_type, existing_details
            )
            upsert_data = {
                "employer_id": current_employer["id"],
                "directory_data": directory_data,
                **target_details,
            }
            details_upsert = supabase.table("employer_onboarding_details").upsert(
                upsert_data, on_conflict="employer_id"
            ).execute()
            if not details_upsert.data:
                raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to switch employer directory")

        profile_updates = {"employer_type": request.employer_type}
        profile_updates["onboarding_status"] = (
            "COMPLETED" if request.employer_type == "INDIVIDUAL" else "IN_PROGRESS"
        )

        if previous_type != request.employer_type:
            profile_updates["verification_status"] = "PENDING"

        # Update employer profile with the selected type and its routing state.
        response = (
            supabase.table("employer_profiles")
            .update(profile_updates)
            .eq("user_id", user.id)
            .execute()
        )

        if not response.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Employer profile not found",
            )

        if previous_type and previous_type != request.employer_type:
            supabase.table("employer_verifications").update({
                "status": "FAILED",
                "failure_reason": "Employer directory changed; verification required again",
                "verified_at": None,
            }).eq("employer_id", current_employer["id"]).execute()

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
    data = {
        key: value
        for key, value in data.items()
        if key in OnboardingService.fields_for_type(employer.get("employer_type") or "")
    }
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
    previous = OnboardingService.active_details_for_type(
        employer.get("employer_type") or "",
        existing_response.data[0] if existing_response.data else {},
    )
    merged_identity = {**previous, **data}
    identity_changed = VerificationService.identity_changed(previous, merged_identity)
    if employer.get("onboarding_status") == "COMPLETED" and identity_changed:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Completed employer identity cannot be changed")
    verified_identity_changed = VerificationService.previously_set_identity_changed(previous, merged_identity)

    update_payload = OnboardingService.active_details_payload(
        employer.get("employer_type") or "",
        existing_response.data[0] if existing_response.data else {},
        data,
    )
    update_payload["employer_id"] = employer["id"]
    response = (
        supabase.table("employer_onboarding_details")
        .upsert(update_payload, on_conflict="employer_id")
        .execute()
    )
    if not response.data:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to save legal identity")
    if verified_identity_changed:
        VerificationService.invalidate_for_identity_change(employer["id"])
    return EmployerOnboardingDetailsResponse(**OnboardingService.active_details_for_type(
        employer.get("employer_type") or "", response.data[0]
    ))


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
    details = OnboardingService.active_details_for_type(
        employer_type,
        details_response.data[0] if details_response.data else {},
    )
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


def _public_verification_record(record: dict[str, Any]) -> dict[str, Any]:
    """Expose verification state without provider references or raw metadata."""
    public_record = {**record, "provider_metadata": None}
    metadata = record.get("provider_metadata")
    if isinstance(metadata, dict):
        safe_name_keys = {
            "company_name",
            "companyName",
            "registered_name",
            "legal_name_of_business",
            "trade_name_of_business",
            "name",
            "name_on_aadhaar",
        }
        safe_names = {
            key: value
            for key, value in metadata.items()
            if key in safe_name_keys and isinstance(value, str) and value.strip()
        }
        if safe_names:
            public_record["provider_metadata"] = safe_names
    return public_record


def _verification_details_for_user(
    employer_type: str,
    details: dict[str, Any],
    user: UserResponse,
) -> dict[str, Any]:
    if employer_type != "UNREGISTERED_BUSINESS":
        return details
    registrant_name = user.name.strip()
    if not registrant_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Authenticated registrant name is required for Aadhaar verification",
        )
    return {**details, "proprietor_name": registrant_name}


def _load_employer_profile_contract(user: UserResponse) -> EmployerMeResponse:
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

    details_response = (
        supabase.table("employer_onboarding_details")
        .select("*")
        .eq("employer_id", employer["id"])
        .execute()
    )
    details = details_response.data[0] if details_response.data else {}
    employer_type = employer.get("employer_type") or ""
    active_details = OnboardingService.active_details_for_type(employer_type, details)

    calculated_status = VerificationService.calculate_overall_status(
        employer_type, employer["id"], active_details
    )
    persisted_status = "REJECTED" if calculated_status == "FAILED" else calculated_status
    if persisted_status != employer.get("verification_status"):
        update_res = (
            supabase.table("employer_profiles")
            .update({"verification_status": persisted_status})
            .eq("id", employer["id"])
            .eq("user_id", user.id)
            .execute()
        )
        if update_res.data:
            employer["verification_status"] = persisted_status

    account_response = (
        supabase.table("users")
        .select("name, email, mobile, profile_photo_path")
        .eq("id", user.id)
        .single()
        .execute()
    )
    account = account_response.data
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employer account not found")

    verification_records = [
        _public_verification_record(record)
        for record in VerificationService.list_for_employer(employer["id"])
    ]
    profile_fields = OnboardingService.fields_for_type(employer_type)
    profile_data = {
        key: value for key, value in active_details.items()
        if key in profile_fields
    }
    employer_summary = {
        key: employer.get(key)
        for key in (
            "id", "employer_type", "onboarding_status", "verification_status",
            "contact_person_name", "created_at",
        )
    }
    return EmployerMeResponse(
        **{**employer, **employer_state(employer)},
        profile_photo_url=get_signed_profile_photo_url(account.get("profile_photo_path")),
        employer=employer_summary,
        account=account,
        profile=profile_data,
        verification=verification_records,
    )


def _updated_employer_profile_response(
    user: UserResponse,
    details: dict[str, Any],
) -> EmployerProfileUpdateResponse:
    contract = _load_employer_profile_contract(user)
    return EmployerProfileUpdateResponse(
        **{**contract.model_dump(), **details}
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
    details = OnboardingService.active_details_for_type(
        employer_type,
        details_response.data or {},
    )
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
        identifier = (
            details.get("director_aadhaar")
            if employer_type in {"REGISTERED_INDUSTRY", "REGISTERED_BUSINESS"}
            else details.get("proprietor_aadhaar")
        )
        if not identifier or not str(identifier).strip():
            field_name = "Director Aadhaar" if employer_type in {"REGISTERED_INDUSTRY", "REGISTERED_BUSINESS"} else "Proprietor Aadhaar"
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"{field_name} is required")

    verification_details = (
        _verification_details_for_user(employer_type, details, user)
        if normalized_verification_type == "AADHAAR"
        else details
    )

    try:
        record = await VerificationService.request_verification(
            profile_response.data["id"],
            verification_type,
            employer_type,
            identifier,
            expected_details=verification_details,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except Exception as exc:
        logger.warning("Employer verification request failed: type=%s error=%s", verification_type, type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": VerificationService.PROVIDER_NOT_CONFIGURED},
        ) from exc

    record_response = VerificationRecordResponse(**_public_verification_record(record))
    if record_response.status == "VERIFIED":
        calculated_status = VerificationService.calculate_overall_status(
            employer_type,
            profile_response.data["id"],
            details,
        )
        if calculated_status == "VERIFIED":
            supabase.table("employer_profiles").update({"verification_status": "VERIFIED"}).eq("id", profile_response.data["id"]).execute()
        return record_response
    if record_response.status == "PENDING" and record_response.failure_reason == "OTP_SENT":
        return record_response
    if record_response.status == "NOT_CONFIGURED":
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": VerificationService.PROVIDER_NOT_CONFIGURED, "verification": record_response.model_dump(mode="json")},
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


@router.post("/onboarding/verifications/AADHAAR/otp", response_model=VerificationRecordResponse)
async def verify_onboarding_aadhaar_otp(
    request: VerificationOTPRequestSchema,
    user: UserResponse = Depends(require_employer),
):
    """Complete the Cashfree Aadhaar OTP challenge for the current employer."""
    profile_response = supabase.table("employer_profiles").select("*").eq("user_id", user.id).single().execute()
    employer = profile_response.data
    if not employer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employer profile not found")
    details_response = supabase.table("employer_onboarding_details").select("*").eq("employer_id", employer["id"]).single().execute()
    details = OnboardingService.active_details_for_type(
        employer.get("employer_type") or "",
        details_response.data or {},
    )
    try:
        verification_details = _verification_details_for_user(
            employer.get("employer_type") or "",
            details,
            user,
        )
        record = await VerificationService.verify_aadhaar_otp(
            employer["id"], request.otp, verification_details
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return VerificationRecordResponse(**_public_verification_record(record))


@router.put(
    "/company-profile",
    response_model=EmployerProfileUpdateResponse,
    response_model_exclude_none=True,
)
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
        previous_active_details = OnboardingService.active_details_for_type(
            employer.get("employer_type") or "", previous_details
        )

        data = request.model_dump(exclude_unset=True)
        if not data:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="At least one field is required to update")

        allowed_fields = OnboardingService.fields_for_type(
            employer.get("employer_type") or ""
        ).intersection(CompanyProfileUpdateSchema.model_fields)
        if employer.get("employer_type") == "INDIVIDUAL":
            allowed_fields.add("contact_person_name")
        unsupported_fields = sorted(set(data) - allowed_fields)
        if unsupported_fields:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Fields are not applicable to {employer.get('employer_type')}: {', '.join(unsupported_fields)}",
            )

        for key, value in list(data.items()):
            if isinstance(value, str):
                normalized = value.strip()
                data[key] = normalized or None
        contact_person_name = data.pop("contact_person_name", None)
        if "contact_person_name" in request.model_fields_set and not contact_person_name:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="contact_person_name cannot be cleared",
            )
        if data.get("pincode") and not re.fullmatch(r"[0-9]{6}", data["pincode"]):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="pincode must be a valid 6-digit number")
        if "company_email" in data and data["company_email"] is not None:
            data["company_email"] = data["company_email"].lower()

        sanitized_data = data

        merged_details = {**previous_active_details, **sanitized_data, "employer_id": employer["id"]}
        identity_changed = VerificationService.identity_changed(previous_active_details, merged_details)
        if employer.get("onboarding_status") == "COMPLETED" and identity_changed:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Completed employer identity cannot be changed",
            )
        verified_identity_changed = VerificationService.previously_set_identity_changed(
            previous_active_details, merged_details
        )

        is_completed = employer.get("onboarding_status") == "COMPLETED"
        valid, validation_error = OnboardingService.validate_onboarding_fields(
            employer.get("employer_type") or "",
            merged_details,
            require_all_fields=is_completed,
        )
        if not valid:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=validation_error,
            )
        active_details = previous_active_details
        if sanitized_data:
            update_payload = OnboardingService.active_details_payload(
                employer.get("employer_type") or "", previous_details, sanitized_data
            )
            update_payload["employer_id"] = employer["id"]
            details_response = (
                supabase.table("employer_onboarding_details")
                .upsert(update_payload, on_conflict="employer_id")
                .execute()
            )
            if not details_response.data:
                raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to update company details")
            active_details = OnboardingService.active_details_for_type(
                employer.get("employer_type") or "", details_response.data[0]
            )

        if contact_person_name is not None:
            profile_update = (
                supabase.table("employer_profiles")
                .update({"contact_person_name": contact_person_name})
                .eq("id", employer["id"])
                .eq("user_id", user.id)
                .execute()
            )
            if not profile_update.data:
                raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to update employer name")

        if verified_identity_changed:
            VerificationService.invalidate_for_identity_change(employer["id"])

        return _updated_employer_profile_response(user, active_details)

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to update company profile: %s", exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Unable to update company profile")


@router.put(
    "/director-profile",
    response_model=EmployerProfileUpdateResponse,
    response_model_exclude_none=True,
)
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
        if employer.get("employer_type") == "INDIVIDUAL":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Director profile is not applicable to individual employers",
            )
        existing_details_response = (
            supabase.table("employer_onboarding_details")
            .select("*")
            .eq("employer_id", employer["id"])
            .execute()
        )
        previous_details = existing_details_response.data[0] if existing_details_response.data else {}
        previous_active_details = OnboardingService.active_details_for_type(
            employer.get("employer_type") or "", previous_details
        )

        data = request.model_dump(exclude_unset=True)
        if not data:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="At least one field is required to update")

        allowed_fields = {
            "REGISTERED_BUSINESS": {
                "director_name", "director_phone", "director_email", "director_address",
                "director_aadhaar", "director_pan",
            },
            "REGISTERED_INDUSTRY": {
                "director_name", "director_phone", "director_email", "director_address",
                "director_aadhaar", "director_pan", "director_din", "director_blood_group",
            },
            "UNREGISTERED_BUSINESS": {"director_name", "director_aadhaar"},
        }.get(employer.get("employer_type"), set())
        unsupported_fields = sorted(set(data) - allowed_fields)
        if unsupported_fields:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Fields are not applicable to {employer.get('employer_type')}: {', '.join(unsupported_fields)}",
            )
        if (
            employer.get("employer_type") != "UNREGISTERED_BUSINESS"
            and "director_name" in data
            and (data["director_name"] is None or not str(data["director_name"]).strip())
        ):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="director_name cannot be cleared",
            )
        for key, value in list(data.items()):
            if isinstance(value, str):
                normalized = value.strip()
                data[key] = normalized or None
        if data.get("director_email"):
            data["director_email"] = data["director_email"].lower()
        if data.get("director_pan"):
            data["director_pan"] = data["director_pan"].upper()

        update_dict: dict[str, Any] = {}
        if "director_name" in data:
            name_val = data["director_name"]
            name_field = "proprietor_name" if employer.get("employer_type") == "UNREGISTERED_BUSINESS" else "director_name"
            update_dict[name_field] = name_val
        if "director_phone" in data:
            update_dict["director_phone"] = data["director_phone"]
        if "director_email" in data:
            update_dict["director_email"] = data["director_email"]
        if "director_address" in data:
            update_dict["director_address"] = data["director_address"]
        if "director_aadhaar" in data:
            aadhaar_val = data["director_aadhaar"]
            aadhaar_field = "proprietor_aadhaar" if employer.get("employer_type") == "UNREGISTERED_BUSINESS" else "director_aadhaar"
            update_dict[aadhaar_field] = aadhaar_val
        if "director_pan" in data:
            update_dict["pan_number"] = data["director_pan"]

        extra_director_data = previous_active_details.get("director_data") or []
        if not isinstance(extra_director_data, list):
            extra_director_data = []

        director_meta: dict[str, Any] = dict(extra_director_data[0]) if extra_director_data and isinstance(extra_director_data[0], dict) else {}
        if "director_din" in data:
            director_meta["din"] = data["director_din"]
        if "director_blood_group" in data:
            director_meta["blood_group"] = data["director_blood_group"]
        if "director_name" in data:
            director_meta["name"] = data["director_name"]
        if director_meta:
            update_dict["director_data"] = [director_meta]

        update_dict = {
            key: value for key, value in update_dict.items()
            if key in OnboardingService.fields_for_type(employer.get("employer_type") or "")
        }
        merged_details = {**previous_active_details, **update_dict, "employer_id": employer["id"]}
        identity_changed = VerificationService.identity_changed(previous_active_details, merged_details)
        if employer.get("onboarding_status") == "COMPLETED" and identity_changed:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Completed employer identity cannot be changed",
            )

        is_completed = employer.get("onboarding_status") == "COMPLETED"
        valid, validation_error = OnboardingService.validate_onboarding_fields(
            employer.get("employer_type") or "",
            merged_details,
            require_all_fields=is_completed,
        )
        if not valid:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=validation_error,
            )
        update_payload = OnboardingService.active_details_payload(
            employer.get("employer_type") or "", previous_details, update_dict
        )
        update_payload["employer_id"] = employer["id"]
        details_response = (
            supabase.table("employer_onboarding_details")
            .upsert(update_payload, on_conflict="employer_id")
            .execute()
        )
        if not details_response.data:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to update director profile")

        verified_identity_changed = VerificationService.previously_set_identity_changed(
            previous_active_details, merged_details
        )
        if verified_identity_changed:
            VerificationService.invalidate_for_identity_change(employer["id"])

        if update_dict.get("director_name"):
            supabase.table("employer_profiles").update(
                {"contact_person_name": update_dict["director_name"]}
            ).eq("id", employer["id"]).eq("user_id", user.id).execute()

        active_details = OnboardingService.active_details_for_type(
            employer.get("employer_type") or "", details_response.data[0]
        )
        return _updated_employer_profile_response(user, active_details)

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
        data = {
            key: value
            for key, value in data.items()
            if value is not None
            and key in OnboardingService.fields_for_type(employer_type)
        }
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

        if employer_type != "INDIVIDUAL" and (not effective_email or not effective_phone):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Employer email and phone number are required before onboarding can continue",
            )

        if effective_email:
            data["company_email"] = effective_email
        if effective_phone:
            data["company_phone"] = effective_phone

        existing_details_response = (
            supabase.table("employer_onboarding_details")
            .select("*")
            .eq("employer_id", employer["id"])
            .execute()
        )
        previous_details = existing_details_response.data[0] if existing_details_response.data else {}
        previous_active_details = OnboardingService.active_details_for_type(employer_type, previous_details)
        merged_details = {**previous_active_details, **data}
        if employer_type == "REGISTERED_INDUSTRY":
            director_fields = {"director_name", "director_phone", "director_email", "director_address"}
            if director_fields.intersection(data):
                try:
                    VerificationService.assert_verified_types(employer["id"], ["CIN"])
                except ValueError as exc:
                    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
            if "work_location" in data:
                try:
                    VerificationService.assert_verified_types(employer["id"], ["CIN", "AADHAAR"])
                except ValueError as exc:
                    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
        identity_changed = VerificationService.identity_changed(previous_active_details, merged_details)
        if employer.get("onboarding_status") == "COMPLETED" and identity_changed:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Completed employer identity cannot be changed",
            )
        verified_identity_changed = VerificationService.previously_set_identity_changed(
            previous_active_details, merged_details
        )
        # Validate required fields for this type
        is_valid, error_msg = OnboardingService.validate_onboarding_fields(
            employer_type,
            data,
            require_registered_business_location=True,
            require_all_fields=employer_type not in {
                "REGISTERED_INDUSTRY",
                "REGISTERED_BUSINESS",
                "UNREGISTERED_BUSINESS",
                "INDIVIDUAL",
            },
        )
        if not is_valid:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=error_msg,
            )

        # Upsert onboarding details
        update_payload = OnboardingService.active_details_payload(
            employer_type, previous_details, merged_details
        )
        update_payload["employer_id"] = employer["id"]
        details_response = (
            supabase.table("employer_onboarding_details")
            .upsert(update_payload, on_conflict="employer_id")
            .execute()
        )

        if not details_response.data:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to save onboarding details",
            )

        if verified_identity_changed:
            VerificationService.invalidate_for_identity_change(employer["id"])

        return EmployerOnboardingDetailsResponse(**OnboardingService.active_details_for_type(
            employer_type, details_response.data[0]
        ))

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

        if employer.get("employer_type") == "INDIVIDUAL":
            calculated_status = VerificationService.calculate_overall_status(
                "INDIVIDUAL", employer["id"], {}
            )
            individual_updates = {}
            if employer.get("onboarding_status") != "COMPLETED":
                individual_updates["onboarding_status"] = "COMPLETED"
            persisted_status = "REJECTED" if calculated_status == "FAILED" else calculated_status
            if employer.get("verification_status") != persisted_status:
                individual_updates["verification_status"] = persisted_status
            if individual_updates:
                individual_response = (
                    supabase.table("employer_profiles")
                    .update(individual_updates)
                    .eq("user_id", user.id)
                    .execute()
                )
                if not individual_response.data:
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail="Failed to complete individual profile",
                    )
                employer = individual_response.data[0]
            return EmployerProfileResponse(**employer)

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

        active_details = OnboardingService.active_details_for_type(
            employer_type, details_response.data[0]
        )
        is_valid, error_msg = OnboardingService.validate_onboarding_fields(
            employer_type,
            active_details,
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
                active_details,
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(exc),
            ) from exc

        calculated_status = VerificationService.calculate_overall_status(
            employer_type,
            employer["id"],
            active_details,
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
