"""Pydantic schemas for contact inquiry requests and responses."""

from pydantic import BaseModel, EmailStr, Field
from typing import Optional
from datetime import datetime


class ContactInquiryRequest(BaseModel):
    """Request to submit a business inquiry."""
    name: str = Field(..., min_length=2, max_length=120, description="Full name or contact person name")
    company: Optional[str] = Field(None, max_length=255, description="Business name (optional)")
    email: EmailStr = Field(..., description="Contact email address")
    message: str = Field(..., min_length=10, max_length=2000, description="Business inquiry message")

    class Config:
        str_strip_whitespace = True


class ContactInquiryResponse(BaseModel):
    """Response after successful contact inquiry submission."""
    success: bool = Field(..., description="Whether the submission was successful")
    message: str = Field(..., description="Response message")
    inquiry_id: Optional[str] = Field(None, description="Unique identifier for the inquiry")

    class Config:
        from_attributes = True


class ContactInquiryModel(BaseModel):
    """Database model for contact inquiry."""
    id: str
    name: str
    company: Optional[str] = None
    email: str
    message: str
    email_status: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
