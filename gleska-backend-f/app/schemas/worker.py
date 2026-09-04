"""Pydantic schemas for worker profiles and related data."""

from pydantic import BaseModel, Field, field_validator, model_validator
from typing import Optional
from datetime import datetime


class WorkerProfileResponse(BaseModel):
    """Worker profile response."""
    id: str
    user_id: str
    account_type: str = "EMPLOYEE"
    trade_id: Optional[str] = None
    experience_years: Optional[int] = None
    expected_daily_wage: Optional[float] = None
    availability_status: str = "OFFLINE"  # AVAILABLE, ON_JOB, OFFLINE
    city: Optional[str] = None
    state: Optional[str] = None
    address: Optional[str] = None
    pincode: Optional[str] = None
    location_source: Optional[str] = None
    location_updated_at: Optional[datetime] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    marital_status: Optional[str] = None
    blood_group: Optional[str] = None
    skills: Optional[list[str]] = None
    profile_completed: bool = False
    onboarding_status: str = "NOT_STARTED"
    created_at: datetime
    updated_at: datetime
    subscription_valid_until: Optional[datetime] = None

    class Config:
        from_attributes = True


class UpdateWorkerProfileSchema(BaseModel):
    """Schema for updating worker profile."""
    trade_id: Optional[str] = Field(default=None, min_length=1, max_length=120)
    experience_years: Optional[int] = Field(default=None, ge=0)
    expected_daily_wage: Optional[float] = Field(default=None, ge=0)
    availability_status: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    address: Optional[str] = Field(default=None, max_length=500)
    pincode: Optional[str] = Field(default=None, min_length=6, max_length=6)
    latitude: Optional[float] = Field(default=None, ge=-90, le=90)
    longitude: Optional[float] = Field(default=None, ge=-180, le=180)
    location_source: Optional[str] = None
    marital_status: Optional[str] = Field(default=None)
    blood_group: Optional[str] = Field(default=None)
    skills: Optional[list[str]] = Field(default=None)

    @field_validator("trade_id")
    @classmethod
    def validate_trade_id(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("trade_id must not be blank")
        return normalized

    @field_validator("marital_status")
    @classmethod
    def validate_marital_status(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        valid_values = {"Unmarried", "Married", "Divorced", "Widowed", "Separated"}
        if value not in valid_values:
            raise ValueError(f"marital_status must be one of {valid_values}")
        return value

    @field_validator("blood_group")
    @classmethod
    def validate_blood_group(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        valid_values = {"A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"}
        if value not in valid_values:
            raise ValueError(f"blood_group must be one of {valid_values}")
        return value

    @field_validator("skills")
    @classmethod
    def validate_skills(cls, value: Optional[list[str]]) -> Optional[list[str]]:
        if value is None:
            return None
        if not isinstance(value, list):
            raise ValueError("skills must be a list of strings")
        return [skill.strip() for skill in value if isinstance(skill, str) and skill.strip()]


class WorkerLocationUpdate(BaseModel):
    """A real browser-provided location for the authenticated worker."""

    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    accuracy_m: float = Field(..., gt=0, le=1000)

    @model_validator(mode="after")
    def coordinates_must_not_be_null_island(self) -> "WorkerLocationUpdate":
        if self.latitude == 0 and self.longitude == 0:
            raise ValueError("latitude and longitude cannot both be zero")
        return self


class WorkerCurrentLocationResponse(BaseModel):
    """The latest GPS location saved for a worker."""

    latitude: float
    longitude: float
    accuracy_m: float
    address: Optional[str] = None
    updated_at: datetime


class WorkerRouteOrigin(BaseModel):
    latitude: float
    longitude: float


class WorkerRouteDestination(BaseModel):
    latitude: float
    longitude: float
    name: str


class WorkerRouteSummary(BaseModel):
    distance_meters: int
    distance_km: float
    duration_seconds: int
    duration_minutes: int
    encoded_polyline: str


class WorkerJobRouteResponse(BaseModel):
    job_id: str
    origin: WorkerRouteOrigin
    destination: WorkerRouteDestination
    route: WorkerRouteSummary


class WorkerDocumentResponse(BaseModel):
    """Metadata for a worker document stored in Supabase Storage."""
    
    id: str
    worker_profile_id: str
    document_type: str  # EXPERIENCE_CERTIFICATE or POLICE_VERIFICATION
    original_filename: str
    mime_type: str
    file_size_bytes: int
    uploaded_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class WorkerDocumentListResponse(BaseModel):
    """List of documents for a worker."""
    documents: list[WorkerDocumentResponse]
    total_count: int


class ProfilePhotoUploadRequest(BaseModel):
    original_filename: str = Field(..., min_length=1, max_length=255)
    mime_type: str
    file_size_bytes: int = Field(..., gt=0, le=5242880)
    storage_path: Optional[str] = None

    @field_validator("mime_type")
    @classmethod
    def validate_mime_type(cls, value: str) -> str:
        if value not in {"image/jpeg", "image/png", "image/webp"}:
            raise ValueError("Only JPEG, PNG, and WEBP images are allowed")
        return value

    @field_validator("original_filename")
    @classmethod
    def validate_filename(cls, value: str) -> str:
        if "/" in value or "\\" in value or ".." in value:
            raise ValueError("Filename cannot contain path separators or parent directory references")
        return value.strip()


class DocumentUploadRequest(BaseModel):
    """Metadata about a document being uploaded (sent by frontend)."""
    document_type: str = Field(..., description="EXPERIENCE_CERTIFICATE or POLICE_VERIFICATION")
    original_filename: str = Field(..., min_length=1, max_length=255)
    mime_type: str = Field(..., description="application/pdf, image/jpeg, or image/png")
    file_size_bytes: int = Field(..., gt=0, le=5242880, description="File size in bytes, max 5 MB")
    
    @field_validator("document_type")
    @classmethod
    def validate_document_type(cls, value: str) -> str:
        valid_types = {"EXPERIENCE_CERTIFICATE", "POLICE_VERIFICATION"}
        if value not in valid_types:
            raise ValueError(f"document_type must be one of {valid_types}")
        return value
    
    @field_validator("mime_type")
    @classmethod
    def validate_mime_type(cls, value: str) -> str:
        valid_types = {"application/pdf", "image/jpeg", "image/png"}
        if value not in valid_types:
            raise ValueError(f"mime_type must be one of {valid_types}")
        return value
    
    @field_validator("original_filename")
    @classmethod
    def validate_filename(cls, value: str) -> str:
        # Prevent path traversal
        if "/" in value or "\\" in value or ".." in value:
            raise ValueError("Filename cannot contain path separators or parent directory references")
        return value.strip()
