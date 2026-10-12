"""Schemas for supplier identity and company membership."""

from datetime import datetime
from enum import Enum
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, HttpUrl, field_validator


class SupplierCompanyRole(str, Enum):
    OWNER = "OWNER"
    ADMIN = "ADMIN"
    MEMBER = "MEMBER"


class SupplierMembershipStatus(str, Enum):
    ACTIVE = "ACTIVE"
    PENDING = "PENDING"
    REVOKED = "REVOKED"


class SupplierCompanyOperationalStatus(str, Enum):
    ACTIVE = "ACTIVE"
    SUSPENDED = "SUSPENDED"
    ARCHIVED = "ARCHIVED"


class SupplierVerificationStatus(str, Enum):
    NOT_SUBMITTED = "NOT_SUBMITTED"
    PENDING_REVIEW = "PENDING_REVIEW"
    VERIFIED = "VERIFIED"
    REJECTED = "REJECTED"
    SUSPENDED = "SUSPENDED"


class SupplierVerificationDocumentType(str, Enum):
    BUSINESS_REGISTRATION = "BUSINESS_REGISTRATION"
    TAX_REGISTRATION = "TAX_REGISTRATION"
    ADDRESS_PROOF = "ADDRESS_PROOF"
    OTHER = "OTHER"


class SupplierCompanyCreateRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=160)
    description: Optional[str] = Field(default=None, max_length=2000)
    website: Optional[HttpUrl] = None
    registered_name: Optional[str] = Field(default=None, max_length=200)
    registration_number: Optional[str] = Field(default=None, max_length=100)
    contact_email: Optional[EmailStr] = Field(default=None, max_length=254)
    contact_phone: Optional[str] = Field(default=None, max_length=32)
    registered_address: Optional[str] = Field(default=None, max_length=1000)

    @field_validator("name", mode="before")
    @classmethod
    def normalize_company_name(cls, value: str) -> str:
        if not isinstance(value, str):
            raise ValueError("Company name must be text.")
        normalized = value.strip()
        if len(normalized) < 2:
            raise ValueError("Company name must contain at least two non-space characters.")
        return normalized


class SupplierCompanyUpdateRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=160)
    description: Optional[str] = Field(default=None, max_length=2000)
    website: Optional[HttpUrl] = None

    @field_validator("name", mode="before")
    @classmethod
    def normalize_company_name(cls, value: str) -> str:
        if not isinstance(value, str):
            raise ValueError("Company name must be text.")
        normalized = value.strip()
        if len(normalized) < 2:
            raise ValueError("Company name must contain at least two non-space characters.")
        return normalized

    @field_validator("description", mode="before")
    @classmethod
    def normalize_company_description(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("Company description must be text.")
        return value.strip() or None


class SupplierCompanyPrivateProfileUpdateRequest(BaseModel):
    registered_name: Optional[str] = Field(default=None, max_length=200)
    registration_number: Optional[str] = Field(default=None, max_length=100)
    contact_email: Optional[EmailStr] = Field(default=None, max_length=254)
    contact_phone: Optional[str] = Field(default=None, max_length=32)
    registered_address: Optional[str] = Field(default=None, max_length=1000)

    @field_validator(
        "registered_name",
        "registration_number",
        "contact_phone",
        "registered_address",
        mode="before",
    )
    @classmethod
    def normalize_private_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("Company profile details must be text.")
        return value.strip() or None

    @field_validator("contact_email", mode="before")
    @classmethod
    def normalize_contact_email(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("Contact email must be text.")
        return value.strip().lower() or None

    def supplied_fields(self) -> dict[str, object]:
        return self.model_dump(mode="json", exclude_unset=True)


class SupplierCompanyResponse(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    website: Optional[str] = None
    operational_status: SupplierCompanyOperationalStatus
    verification_status: SupplierVerificationStatus = SupplierVerificationStatus.NOT_SUBMITTED
    verification_reason: Optional[str] = None
    verification_submitted_at: Optional[datetime] = None
    verification_reviewed_at: Optional[datetime] = None
    role: SupplierCompanyRole
    created_at: datetime
    updated_at: datetime
    registered_name: Optional[str] = None
    registration_number: Optional[str] = None
    contact_email: Optional[EmailStr] = None
    contact_phone: Optional[str] = None
    registered_address: Optional[str] = None


class SupplierCompanyMembershipResponse(BaseModel):
    id: str
    company_id: str
    company_name: str
    role: SupplierCompanyRole
    status: SupplierMembershipStatus
    created_at: datetime
    expires_at: Optional[datetime] = None
    operational_status: Optional[SupplierCompanyOperationalStatus] = None
    verification_status: Optional[SupplierVerificationStatus] = None


class SupplierVerificationDocumentResponse(BaseModel):
    id: str
    company_id: str
    document_type: SupplierVerificationDocumentType
    original_filename: str
    mime_type: str
    file_size_bytes: int
    uploaded_at: datetime


class SupplierVerificationDocumentUrlResponse(BaseModel):
    url: str
    expires_in: int


class SupplierMemberResponse(BaseModel):
    id: str
    name: Optional[str] = None
    invited_email: Optional[EmailStr] = None
    role: SupplierCompanyRole
    status: SupplierMembershipStatus
    created_at: datetime


class SupplierMemberInviteRequest(BaseModel):
    email: EmailStr
    role: SupplierCompanyRole = SupplierCompanyRole.MEMBER


class SupplierMemberRoleUpdateRequest(BaseModel):
    role: SupplierCompanyRole


class SupplierMemberInviteResponse(BaseModel):
    id: str
    role: SupplierCompanyRole
    status: SupplierMembershipStatus


class SupplierOwnershipTransferRequest(BaseModel):
    new_owner_membership_id: UUID
