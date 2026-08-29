"""Contact inquiry router for handling business inquiries."""

from fastapi import APIRouter, status, HTTPException
from app.schemas.contact import ContactInquiryRequest, ContactInquiryResponse
from app.services.contact_service import ContactService
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("", response_model=ContactInquiryResponse, status_code=status.HTTP_201_CREATED)
async def submit_contact_inquiry(request: ContactInquiryRequest):
    """
    Submit a business inquiry through the Contact Us form.
    
    This is a public endpoint that does not require authentication.
    
    Request body:
    - name: Full name (2-120 characters, required)
    - company: Business name (0-255 characters, optional)
    - email: Email address (required, must be valid)
    - message: Inquiry message (10-2000 characters, required)
    
    Response:
    - success: Boolean indicating if submission was successful
    - message: User-friendly response message
    - inquiry_id: Unique identifier for the inquiry (if successful)
    
    Status codes:
    - 201: Inquiry successfully created
    - 400: Invalid input data
    - 422: Validation error
    - 429: Too many requests (rate limit)
    - 500: Server error
    """
    try:
        logger.info("Contact inquiry received from email_suffix=%s", request.email[-4:])
        
        # Process inquiry and send email
        result = await ContactService.submit_inquiry(
            name=request.name,
            company=request.company,
            email=request.email,
            message=request.message,
        )
        
        return ContactInquiryResponse(
            success=result["success"],
            message=result["message"],
            inquiry_id=result.get("inquiry_id"),
        )
        
    except ValueError as exc:
        logger.warning("Contact inquiry validation error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to process your inquiry. Please try again.",
        ) from exc
        
    except Exception as exc:
        logger.error("Unexpected error processing contact inquiry: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred while processing your inquiry.",
        ) from exc
