"""Health check endpoint."""

from fastapi import APIRouter
from app.schemas.auth import HealthCheckResponse

router = APIRouter()


@router.get("/health", response_model=HealthCheckResponse)
async def health_check():
    """Health check endpoint to verify API is running."""
    return {
        "status": "healthy",
        "message": "GO LESKA backend is running",
    }
