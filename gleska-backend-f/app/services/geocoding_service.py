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

    @staticmethod
    async def search(query: str) -> list[dict[str, str | None]]:
        normalized_query = query.strip()
        if len(normalized_query) < 2:
            return []
        try:
            async with httpx.AsyncClient(timeout=settings.NOMINATIM_TIMEOUT_SECONDS) as client:
                response = await client.get(
                    f"{settings.NOMINATIM_BASE_URL.rstrip('/')}/search",
                    params={"q": normalized_query, "format": "jsonv2", "addressdetails": 1, "limit": 5, "countrycodes": "in"},
                    headers={"User-Agent": settings.NOMINATIM_USER_AGENT, "Accept": "application/json"},
                )
                response.raise_for_status()
                results = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise GeocodingError("GEOCODING_SEARCH_FAILED") from exc

        if not isinstance(results, list):
            raise GeocodingError("GEOCODING_SEARCH_FAILED")
        locations = []
        for result in results:
            try:
                latitude = float(result["lat"])
                longitude = float(result["lon"])
                if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
                    continue
            except (KeyError, TypeError, ValueError):
                continue
            address = result.get("address") or {}
            locations.append({
                "address": result.get("display_name"),
                "city": address.get("city") or address.get("town") or address.get("village") or address.get("municipality"),
                "state": address.get("state"),
                "pincode": address.get("postcode"),
                "latitude": str(latitude),
                "longitude": str(longitude),
            })
        return locations
