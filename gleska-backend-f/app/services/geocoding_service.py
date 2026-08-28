"""Server-side reverse geocoding for trusted human-readable locations."""

import httpx

from app.core.config import settings


class GeocodingError(Exception):
    """The configured geocoder could not resolve the coordinates."""


class GeocodingService:
    """Resolve GPS coordinates through the public Nominatim reverse API."""

    @staticmethod
    async def reverse_geocode(latitude: float, longitude: float) -> str:
        if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
            raise GeocodingError("INVALID_COORDINATES")

        try:
            async with httpx.AsyncClient(timeout=settings.NOMINATIM_TIMEOUT_SECONDS) as client:
                response = await client.get(
                    f"{settings.NOMINATIM_BASE_URL.rstrip('/')}/reverse",
                    params={
                        "lat": latitude,
                        "lon": longitude,
                        "format": "jsonv2",
                        "addressdetails": 1,
                    },
                    headers={"User-Agent": settings.NOMINATIM_USER_AGENT, "Accept": "application/json"},
                )
                response.raise_for_status()
                payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise GeocodingError("GEOCODING_FAILED") from exc

        address = payload.get("display_name")
        if not address or not address.strip():
            raise GeocodingError("ADDRESS_NOT_FOUND")
        return address.strip()
