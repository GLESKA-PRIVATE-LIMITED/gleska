"""Pydantic schemas for authentication requests and responses."""

from pydantic import BaseModel, EmailStr, Field, model_validator
from typing import Optional
from datetime import datetime


class OTPRequestSchema(BaseModel):
    """Request to initiate OTP verification."""
    mobile: str = Field(..., description="Mobile number with country code (e.g., +91XXXXXXXXXX)")


class OTPVerifySchema(BaseModel):
    """Request to verify OTP."""
    mobile: str = Field(..., description="Mobile number")
    otp: str = Field(..., description="6-digit OTP")
    name: str = Field(..., description="User's name")
    role: str = Field(..., description="User role: WORKER or EMPLOYER")


class WorkerRegistrationSchema(BaseModel):
    """Worker registration request."""
    name: str = Field(..., description="Worker's full name")
    mobile: str = Field(..., description="Mobile number")


class EmployerRegistrationSchema(BaseModel):
    """Employer registration request."""
    name: str = Field(..., description="Contact person's name")
    mobile: str = Field(..., description="Mobile number")


class UserResponse(BaseModel):
    """User response object - returned after successful authentication."""
    id: str
    name: str
    mobile: Optional[str] = None
    email: Optional[EmailStr] = None
    role: str  # WORKER, EMPLOYER, ADMIN
    is_mobile_verified: bool
    is_active: bool
    terms_accepted: Optional[bool] = None
    terms_accepted_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    onboarding_status: Optional[str] = None
    employer_type: Optional[str] = None
    profile_completed: Optional[bool] = None
    subscription_valid_until: Optional[datetime] = None

    class Config:
        from_attributes = True


class AuthResponse(BaseModel):
    """Authentication response after successful login."""
    success: bool
    user: UserResponse
    next_step: str  # DASHBOARD, EMPLOYER_TYPE_SELECTION, etc.
    message: Optional[str] = None


class ResendOTPSchema(BaseModel):
    """Request to resend OTP."""
    mobile: str = Field(..., min_length=10, max_length=32, description="Mobile number to send OTP to")
    channel: str = Field(..., pattern="^(SMS|EMAIL)$", description="Channel for OTP: SMS or EMAIL")


class ProvisionUserSchema(BaseModel):
    """Application profile data for an already authenticated Supabase identity."""
    name: str = Field(default="", max_length=120)
    mobile: Optional[str] = Field(default=None, max_length=32)
    role: str = Field(..., pattern="^(WORKER|EMPLOYER)$")
    msg91_access_token: Optional[str] = None


class SignupPreflightSchema(BaseModel):
    email: EmailStr
    mobile: str = Field(..., min_length=10, max_length=32)
    role: str = Field(..., pattern="^(WORKER|EMPLOYER)$")
    name: str = Field(..., min_length=2, max_length=120)
    password: str = Field(..., min_length=8, max_length=128)
    confirm_password: str = Field(..., min_length=8, max_length=128)
    terms_accepted: bool = Field(..., description="Must explicitly accept Terms & Conditions")

    @model_validator(mode="after")
    def validate_fields(self):
        if self.password != self.confirm_password:
            raise ValueError("Passwords do not match")
        if not self.terms_accepted:
            raise ValueError("Terms & Conditions must be accepted before creating an account.")
        return self


class MobileVerifiedSignupSchema(SignupPreflightSchema):
    msg91_access_token: str = Field(..., min_length=1)


class PasswordResetRequestSchema(BaseModel):
    phone: str = Field(..., min_length=10, max_length=32)


class PasswordResetVerifySchema(BaseModel):
    phone: str = Field(..., min_length=10, max_length=32)
    msg91_access_token: str = Field(..., min_length=1)


class PasswordResetCompleteSchema(BaseModel):
    reset_authorization: str = Field(..., min_length=32, max_length=256)
    password: str = Field(..., min_length=8, max_length=128)
    confirm_password: str = Field(..., min_length=8, max_length=128)

    @model_validator(mode="after")
    def passwords_match(self):
        if self.password != self.confirm_password:
            raise ValueError("Passwords do not match")
        return self


class ErrorResponse(BaseModel):
    """Error response."""
    success: bool = False
    error: dict


class HealthCheckResponse(BaseModel):
    """Health check response."""
    status: str
    message: str
