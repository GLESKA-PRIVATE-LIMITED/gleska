"""Pydantic schemas for employer profiles and onboarding."""

from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class EmployerProfileResponse(BaseModel):
    """Employer profile response."""
    id: str
    user_id: str
    employer_type: Optional[str] = None
    onboarding_status: str = "NOT_STARTED"  # NOT_STARTED, IN_PROGRESS, COMPLETED
    verification_status: str = "PENDING"  # PENDING, VERIFIED, REJECTED
    contact_person_name: str
    created_at: datetime
    updated_at: datetime
    subscription_valid_until: datetime | None = None
    has_availed_free_dispatch: bool = False

    class Config:
        from_attributes = True


class SelectEmployerTypeSchema(BaseModel):
    """Request to select employer type."""
    employer_type: str = Field(
        ...,
        description="Type of employer: REGISTERED_INDUSTRY, REGISTERED_BUSINESS, UNREGISTERED_BUSINESS, INDIVIDUAL"
    )


class LegalIdentityOnboardingSchema(BaseModel):
    """Identity fields saved before the rest of employer onboarding unlocks."""
    business_name: Optional[str] = None
    gstin: Optional[str] = None
    cin_number: Optional[str] = None
    pan_number: Optional[str] = None
    registration_number: Optional[str] = None
    udyam_number: Optional[str] = None
    proprietor_name: Optional[str] = None
    proprietor_aadhaar: Optional[str] = None
    director_name: Optional[str] = None
    director_aadhaar: Optional[str] = None


class EmployerOnboardingDetailsResponse(BaseModel):
    """Employer onboarding details response."""
    id: str
    employer_id: str
    business_name: Optional[str] = None
    business_type: Optional[str] = None
    business_category: Optional[str] = None
    website_url: Optional[str] = None
    annual_revenue: Optional[str] = None
    description: Optional[str] = None
    services_required: Optional[list] = None
    industry_category: Optional[str] = None
    industry_type: Optional[str] = None
    registered_address: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    pincode: Optional[str] = None
    gstin: Optional[str] = None
    registration_number: Optional[str] = None
    cin_number: Optional[str] = None
    udyam_number: Optional[str] = None
    director_data: Optional[list] = None
    nature_of_business: Optional[str] = None
    number_of_proprietors: Optional[int] = Field(default=None, ge=1)
    company_email: Optional[str] = None
    company_phone: Optional[str] = None
    proprietor_name: Optional[str] = None
    director_name: Optional[str] = None
    director_phone: Optional[str] = None
    director_email: Optional[str] = None
    director_address: Optional[str] = None
    director_aadhaar: Optional[str] = None
    work_location: Optional[str] = None
    bank_ifsc: Optional[str] = None
    bank_account_holder_name: Optional[str] = None
    hiring_mode: str = "MANUAL"
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class RegisteredIndustryOnboardingSchema(BaseModel):
    """Onboarding schema for registered industry."""
    industry_type: Optional[str] = None
    industry_category: Optional[str] = None
    business_name: Optional[str] = None
    business_category: Optional[str] = None
    registered_address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    pincode: Optional[str] = None
    gstin: Optional[str] = None
    registration_number: Optional[str] = None
    cin_number: Optional[str] = None
    pan_number: Optional[str] = None
    website_url: Optional[str] = None
    annual_revenue: Optional[str] = None
    description: Optional[str] = None
    services_required: Optional[list] = None
    director_data: Optional[list] = None
    hiring_mode: Optional[str] = None
    work_location: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    company_email: Optional[str] = None
    company_phone: Optional[str] = None
    director_name: Optional[str] = None
    director_phone: Optional[str] = None
    director_email: Optional[str] = None
    director_address: Optional[str] = None
    director_aadhaar: Optional[str] = None


class RegisteredBusinessOnboardingSchema(BaseModel):
    """Onboarding schema for registered business."""
    business_name: str
    business_type: str
    industry_category: Optional[str] = None
    business_category: Optional[str] = None
    registered_address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    pincode: Optional[str] = None
    gstin: Optional[str] = None
    registration_number: Optional[str] = None
    cin_number: Optional[str] = None
    pan_number: Optional[str] = None
    website_url: Optional[str] = None
    annual_revenue: Optional[str] = None
    description: Optional[str] = None
    services_required: Optional[list] = None
    director_data: Optional[list] = None
    hiring_mode: Optional[str] = None
    work_location: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    company_email: Optional[str] = None
    company_phone: Optional[str] = None
    director_name: Optional[str] = None
    director_phone: Optional[str] = None
    director_email: Optional[str] = None
    director_address: Optional[str] = None
    director_aadhaar: Optional[str] = None


class UnregisteredBusinessOnboardingSchema(BaseModel):
    """Onboarding schema for unregistered business."""
    business_name: str
    business_type: str
    business_category: Optional[str] = None
    industry_category: str
    address: str
    city: str
    state: str
    pincode: str
    work_location: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    nature_of_business: Optional[str] = None
    number_of_proprietors: Optional[int] = Field(default=None, ge=1)
    company_email: Optional[str] = None
    company_phone: Optional[str] = None
    proprietor_name: Optional[str] = None
    proprietor_aadhaar: Optional[str] = None
    udyam_number: Optional[str] = None
    website_url: Optional[str] = None
    description: Optional[str] = None
    services_required: Optional[list] = None
    hiring_mode: Optional[str] = None


class IndividualOnboardingSchema(BaseModel):
    """Onboarding schema for individual employer."""
    address: str
    city: str
    state: str
    pincode: str
    work_location: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    company_email: Optional[str] = None
    company_phone: Optional[str] = None


class CompanyProfileUpdateSchema(BaseModel):
    """Schema for updating company profile from dashboard."""
    business_name: Optional[str] = None
    company_phone: Optional[str] = None
    company_email: Optional[str] = None
    address: Optional[str] = None
    registered_address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    pincode: Optional[str] = None
    website_url: Optional[str] = None
    description: Optional[str] = None
    gstin: Optional[str] = None
    cin_number: Optional[str] = None
    pan_number: Optional[str] = None
    tan_number: Optional[str] = None
    business_category: Optional[str] = None
    industry_type: Optional[str] = None
    industry_category: Optional[str] = None
    work_location: Optional[str] = None


class DirectorProfileUpdateSchema(BaseModel):
    """Schema for updating director profile from dashboard."""
    director_name: Optional[str] = None
    director_phone: Optional[str] = None
    director_email: Optional[str] = None
    director_address: Optional[str] = None
    director_aadhaar: Optional[str] = None
    director_pan: Optional[str] = None
    director_din: Optional[str] = None
    director_blood_group: Optional[str] = None


class CompleteOnboardingSchema(BaseModel):
    """Request to complete onboarding."""
    pass  # Just a marker - all details should already be saved
