"""Authentication endpoints."""

from fastapi import APIRouter, HTTPException, Response, status, Depends, Request
import logging

from app.core.config import settings
from app.core.security import create_access_token, get_current_user, security
from app.core.supabase import supabase
from app.services.auth_service import AuthService
from app.services.msg91_service import MSG91Service
from app.services.onboarding_service import OnboardingService
from app.schemas.auth import UserResponse, ProvisionUserSchema, SignupPreflightSchema, MobileVerifiedSignupSchema, PasswordResetRequestSchema, PasswordResetVerifySchema, PasswordResetCompleteSchema, ResendOTPSchema
from app.services.password_reset_service import PasswordResetService

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)


@router.post("/forgot-password/request-otp")
async def request_password_reset_otp(request: PasswordResetRequestSchema):
    try:
        await PasswordResetService.request_otp(request.phone)
    except ValueError:
        pass
    return {"message": "If an account exists for this phone number, we have sent a verification code."}


@router.post("/forgot-password/verify-otp")
async def verify_password_reset_otp(request: PasswordResetVerifySchema):
    try:
        authorization = await PasswordResetService.verify_provider_token(request.phone, request.msg91_access_token)
    except ValueError as exc:
        code = str(exc)
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS if code == "OTP_ATTEMPTS_EXCEEDED" else status.HTTP_400_BAD_REQUEST, detail=code) from exc
    return {"reset_authorization": authorization}


@router.post("/forgot-password/reset")
def reset_password(request: PasswordResetCompleteSchema):
    try:
        PasswordResetService.complete(request.reset_authorization, request.password)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return {"success": True, "message": "Password reset successfully. Please log in with your new password."}


@router.post("/signup-preflight")
async def signup_preflight(request: SignupPreflightSchema):
    """Check application identity conflicts before sending a signup OTP."""
    if not request.terms_accepted:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Terms & Conditions must be accepted before creating an account.",
        )
    try:
        normalized_mobile = AuthService.normalize_mobile(request.mobile)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Enter a valid Indian mobile number") from exc

    existing_email = AuthService.get_user_by_email(str(request.email).lower())
    existing_mobile = AuthService.get_user_by_mobile(normalized_mobile)
    if existing_email or existing_mobile:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account already exists with this email or mobile number. Please login instead.",
        )
    return {"available": True}


@router.post("/provision", response_model=UserResponse)
async def provision_authenticated_user(
    request: ProvisionUserSchema,
    credentials=Depends(security),
):
    """Reconcile a Supabase Auth session with the application profile tables."""
    if not credentials or not credentials.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Supabase session required")
    try:
        auth_user = supabase.auth.get_user(credentials.credentials).user
        if request.msg91_access_token:
            await MSG91Service().verify_access_token(request.msg91_access_token)
        user = AuthService.provision_supabase_user(
            user_id=str(auth_user.id),
            name=request.name or (auth_user.user_metadata or {}).get("name", ""),
            email=auth_user.email,
            mobile=request.mobile or auth_user.phone,
            role=request.role,
        )
        return UserResponse(**user)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Supabase identity provisioning failed")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="USER_PROVISIONING_FAILED") from exc


@router.post("/signup-mobile-verified", response_model=UserResponse)
async def signup_mobile_verified(request: MobileVerifiedSignupSchema):
    """Create a confirmed Supabase email identity only after MSG91 verification and Terms acceptance."""
    if not request.terms_accepted:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Terms & Conditions must be accepted before creating an account.",
        )

    try:
        normalized_mobile = AuthService.normalize_mobile(request.mobile)
        await MSG91Service().verify_access_token(request.msg91_access_token)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    if AuthService.get_user_by_email(str(request.email).lower()) or AuthService.get_user_by_mobile(normalized_mobile):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An account already exists with this email or mobile number. Please login instead.")

    auth_user_id = None
    try:
        from datetime import datetime, timezone
        now_iso = datetime.now(timezone.utc).isoformat()
        auth_response = supabase.auth.admin.create_user({
            "email": str(request.email).lower(),
            "password": request.password,
            "email_confirm": True,
            "user_metadata": {
                "name": request.name.strip(),
                "role": request.role,
                "mobile": normalized_mobile,
                "terms_accepted": True,
                "terms_accepted_at": now_iso,
            },
        })
        auth_user_id = str(auth_response.user.id)
        user = AuthService.provision_supabase_user(
            user_id=auth_user_id,
            name=request.name,
            role=request.role,
            email=str(request.email).lower(),
            mobile=normalized_mobile,
            terms_accepted=True,
            terms_accepted_at=now_iso,
        )
        return UserResponse(**user)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An account already exists with this email or mobile number. Please login instead.") from exc
    except Exception as exc:
        if auth_user_id:
            try:
                supabase.auth.admin.delete_user(auth_user_id)
            except Exception:
                logger.exception("Failed to clean up Supabase identity after provisioning failure")
        logger.exception("Mobile-verified signup failed")
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Unable to create this account. The email or mobile may already be registered.") from exc


@router.post("/complete-msg91")
async def complete_msg91(request: dict, response: Response):
    """Complete MSG91 OTP verification and create the GO LESKA user session."""
    mobile = str(request.get("mobile", "")).strip()
    name = str(request.get("name", "")).strip()
    role = str(request.get("role", "")).upper()
    access_token = str(request.get("msg91_access_token", "")).strip()

    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="INVALID_NAME")
    if role not in {"WORKER", "EMPLOYER"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="INVALID_ROLE")

    try:
        normalized_mobile = AuthService.normalize_mobile(mobile)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="INVALID_MOBILE") from exc

    try:
        await MSG91Service().verify_access_token(access_token)
    except ValueError as exc:
        code = str(exc)
        status_map = {
            "INVALID_MSG91_TOKEN": status.HTTP_400_BAD_REQUEST,
            "INVALID_MSG91_VERIFICATION": status.HTTP_401_UNAUTHORIZED,
            "EXPIRED_MSG91_TOKEN": status.HTTP_401_UNAUTHORIZED,
            "MSG91_CONFIGURATION_ERROR": status.HTTP_500_INTERNAL_SERVER_ERROR,
            "MSG91_SERVICE_UNAVAILABLE": status.HTTP_503_SERVICE_UNAVAILABLE,
        }
        raise HTTPException(
            status_code=status_map.get(code, status.HTTP_401_UNAUTHORIZED),
            detail=code,
        ) from exc

    logger.info("MSG91 verification succeeded for mobile_suffix=%s role=%s", normalized_mobile[-4:], role)
    try:
        logger.info("Looking up user by mobile_suffix=%s", normalized_mobile[-4:])
        existing = AuthService.get_user_by_mobile(normalized_mobile)
        if existing:
            AuthService.ensure_role_allowed(existing, role)
            user_id = existing["id"]
            if existing.get("name") and not name:
                name = existing["name"]
        else:
            user_id = None

        user = AuthService.create_or_update_user(
            user_id=user_id,
            name=name,
            mobile=normalized_mobile,
            role=role,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - service layer
        logger.error(
            "User creation failed: type=%s code=%s message=%s",
            type(exc).__name__,
            getattr(exc, "code", None) or getattr(exc, "status_code", None),
            str(exc),
            exc_info=True,
        )
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="USER_CREATION_FAILED") from exc

    user_response = UserResponse(**user)
    session_token = create_access_token(user_response.id)
    response.set_cookie(
        key="goleska_session",
        value=session_token,
        httponly=True,
        secure=settings.ENVIRONMENT == "production",
        samesite="lax",
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        path="/",
    )

    return {
        "success": True,
        "user": {
            "id": user_response.id,
            "name": user_response.name,
            "mobile": user_response.mobile,
            "role": user_response.role,
            "is_mobile_verified": user_response.is_mobile_verified,
            "is_active": user_response.is_active,
            "created_at": user_response.created_at,
            "updated_at": user_response.updated_at,
        },
        "next_step": OnboardingService.determine_next_step(user_response),
    }


@router.post("/login-msg91")
async def login_msg91(request: dict, response: Response):
    """Authenticate an existing mobile account without creating a profile."""
    mobile = str(request.get("mobile", "")).strip()
    role = str(request.get("role", "")).upper()
    access_token = str(request.get("msg91_access_token", "")).strip()
    if role not in {"WORKER", "EMPLOYER"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="INVALID_ROLE")
    try:
        normalized_mobile = AuthService.normalize_mobile(mobile)
        await MSG91Service().verify_access_token(access_token)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    existing = AuthService.get_user_by_mobile(normalized_mobile)
    if not existing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No account exists with this mobile number. Please sign up first.")
    try:
        AuthService.ensure_role_allowed(existing, role)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This account belongs to a different role.") from exc

    response.set_cookie(
        key="goleska_session",
        value=create_access_token(existing["id"]),
        httponly=True,
        secure=settings.ENVIRONMENT == "production",
        samesite="lax",
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        path="/",
    )
    user_response = UserResponse(**existing)
    return {"success": True, "user": user_response, "next_step": OnboardingService.determine_next_step(user_response)}


@router.get("/me")
async def get_current_user_info(user: UserResponse = Depends(get_current_user)):
    next_step = OnboardingService.determine_next_step(user)
    application_user = user.model_dump(mode="json")
    if user.role == "WORKER":
        profile_response = supabase.table("worker_profiles").select("onboarding_status, profile_completed").eq("user_id", user.id).single().execute()
        profile = profile_response.data or {}
        application_user.update({
            "onboarding_status": profile.get("onboarding_status", "NOT_STARTED"),
            "profile_completed": profile.get("profile_completed", False),
        })
    elif user.role == "EMPLOYER":
        profile_response = supabase.table("employer_profiles").select("employer_type, onboarding_status, subscription_valid_until").eq("user_id", user.id).single().execute()
        profile = profile_response.data or {}
        application_user.update({
            "employer_type": profile.get("employer_type"),
            "onboarding_status": profile.get("onboarding_status", "NOT_STARTED"),
            "subscription_valid_until": profile.get("subscription_valid_until"),
        })
    return {
        "success": True,
        "user": application_user,
        "next_step": next_step,
    }


@router.post("/resend-otp")
async def resend_otp(request: ResendOTPSchema):
    """Request to resend OTP for signup or login.
    
    This endpoint enforces rate limiting to prevent abuse.
    The frontend MSG91 SDK will handle the actual OTP send.
    """
    try:
        normalized_mobile = AuthService.normalize_mobile(request.mobile)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Enter a valid Indian mobile number") from exc

    try:
        MSG91Service.validate_otp_resend_request(normalized_mobile, request.channel)
    except ValueError as exc:
        code = str(exc)
        if code == "OTP_RESEND_COOLDOWN":
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Please wait before requesting another OTP",
            ) from exc
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=code) from exc

    logger.info(
        "OTP resend validated for mobile_suffix=%s channel=%s",
        normalized_mobile[-4:],
        request.channel,
    )
    return {"success": True, "message": "OTP resend request accepted. Please check your device."}


@router.post("/logout")
async def logout(response: Response, user: UserResponse = Depends(get_current_user)):
    response.delete_cookie(key="goleska_session", path="/")
    return {"success": True, "message": "Logged out successfully"}
