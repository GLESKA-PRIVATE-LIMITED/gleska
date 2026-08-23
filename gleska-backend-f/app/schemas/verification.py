"""Schemas for employer verification state and provider requests."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


VERIFICATION_TYPES = {"PAN", "UDYAM", "BANK", "GSTIN", "REGISTRATION_NUMBER", "AADHAAR", "ONBOARDING_PIN"}
VERIFICATION_STATUSES = {"PENDING", "VERIFIED", "FAILED", "NOT_CONFIGURED"}


class VerificationRequestSchema(BaseModel):
    """Provider-neutral verification request.

    Provider-specific sensitive values must be handled by the provider adapter,
    not persisted in this request or in the verification record.
    """

    reference: Optional[str] = Field(default=None, max_length=128)


class VerificationRecordResponse(BaseModel):
    id: str
    employer_id: str
    verification_type: str
    status: str
    provider_reference_id: Optional[str] = None
    failure_reason: Optional[str] = None
    verified_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    provider: Optional[str] = None
    provider_metadata: Optional[dict] = None


class VerificationRequirementsResponse(BaseModel):
    employer_type: str
    required: list[str]
    records: list[VerificationRecordResponse]
