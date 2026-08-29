"""User-facing location search endpoints."""

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.security import get_current_user
from app.schemas.auth import UserResponse
from app.services.geocoding_service import GeocodingError, GeocodingService

router = APIRouter(prefix="/locations", tags=["locations"])


@router.get("/search")
async def search_locations(
    q: str = Query(..., min_length=2, max_length=200),
    user: UserResponse = Depends(get_current_user),
):
    del user
    try:
        return {"locations": await GeocodingService.search(q)}
    except GeocodingError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="LOCATION_SEARCH_FAILED") from exc


@router.get("/reverse")
async def reverse_location(
    latitude: float = Query(..., ge=-90, le=90),
    longitude: float = Query(..., ge=-180, le=180),
    user: UserResponse = Depends(get_current_user),
):
    """Preview a browser location without persisting it."""
    del user
    try:
        address = await GeocodingService.reverse_geocode(latitude, longitude)
    except GeocodingError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="LOCATION_REVERSE_FAILED") from exc
    return {"address": address, "latitude": latitude, "longitude": longitude}