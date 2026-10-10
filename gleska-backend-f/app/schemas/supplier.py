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


class SupplierCompanyCreateRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=160)
    description: Optional[str] = Field(default=None, max_length=2000)
    website: Optional[HttpUrl] = None
    registered_name: Optional[str] = Field(default=None, max_length=200)
    registration_number: Optional[str] = Field(default=None, max_length=100)
    contact_email: Optional[EmailStr] = None
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


class SupplierCompanyResponse(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    website: Optional[str] = None
    operational_status: SupplierCompanyOperationalStatus
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
