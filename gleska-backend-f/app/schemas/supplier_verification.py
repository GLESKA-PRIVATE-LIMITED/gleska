"""Admin review schemas for supplier verification."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from app.schemas.supplier import SupplierVerificationStatus


class SupplierVerificationQueueItem(BaseModel):
    id: str
    name: str
    verification_status: SupplierVerificationStatus
    verification_submitted_at: Optional[datetime] = None
    created_at: datetime


class SupplierVerificationAdminDocument(BaseModel):
    id: str
    document_type: str
    original_filename: str
    mime_type: str
    file_size_bytes: int
    uploaded_at: datetime


class SupplierVerificationAdminEvent(BaseModel):
    id: str
    actor_user_id: Optional[str] = None
    actor_name: Optional[str] = None
    previous_status: Optional[SupplierVerificationStatus] = None
    new_status: SupplierVerificationStatus
    reason: Optional[str] = None
    created_at: datetime


class SupplierVerificationAdminDetail(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    website: Optional[str] = None
    operational_status: str
    verification_status: SupplierVerificationStatus
    verification_submitted_at: Optional[datetime] = None
    verification_reviewed_at: Optional[datetime] = None
    verification_reviewed_by: Optional[str] = None
    verification_reason: Optional[str] = None
    created_at: datetime
    registered_name: Optional[str] = None
    registration_number: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    registered_address: Optional[str] = None
    documents: list[SupplierVerificationAdminDocument]
    events: list[SupplierVerificationAdminEvent]


class SupplierVerificationDecisionRequest(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=2000)
