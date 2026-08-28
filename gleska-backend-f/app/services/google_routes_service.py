"""Google Routes API integration for worker route calculations."""

from __future__ import annotations

import json
from typing import Any

import httpx

from app.core.config import settings


class GoogleRoutesError(RuntimeError):
    """Raised when the Google route provider cannot compute a valid route."""


class GoogleRoutesService:
    """Compute road routes from worker coordinates to a job site's coordinates."""

    API_URL = "https://routes.googleapis.com/directions/v2:computeRoutes"
    FIELD_MASK = "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline"

    @staticmethod
    def _parse_duration_seconds(value: Any) -> int:
        if isinstance(value, (int, float)):
            return int(value)
        if isinstance(value, str):
            text = value.strip()
            if text.endswith("s"):
                text = text[:-1]
            try:
                return int(float(text))
            except ValueError:
                return 0
        return 0

    @staticmethod
    async def compute_route(origin_lat: float, origin_lng: float, destination_lat: float, destination_lng: float) -> dict[str, Any]:
        api_key = settings.GOOGLE_ROUTES_API_KEY.strip()
        if not api_key:
            raise GoogleRoutesError("GOOGLE_ROUTES_API_KEY_MISSING")

        payload = {
            "origin": {
                "location": {
                    "latLng": {
                        "latitude": float(origin_lat),
                        "longitude": float(origin_lng),
                    }
                }
            },
            "destination": {
                "location": {
                    "latLng": {
                        "latitude": float(destination_lat),
                        "longitude": float(destination_lng),
                    }
                }
            },
            "travelMode": "DRIVE",
        }

        headers = {
            "X-Goog-Api-Key": api_key,
            "X-Goog-FieldMask": GoogleRoutesService.FIELD_MASK,
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=settings.GOOGLE_ROUTES_TIMEOUT_SECONDS) as client:
                response = await client.post(GoogleRoutesService.API_URL, headers=headers, content=json.dumps(payload))
        except httpx.HTTPError as exc:
            raise GoogleRoutesError("ROUTE_CALCULATION_FAILED") from exc

        if response.status_code != 200:
            raise GoogleRoutesError("ROUTE_CALCULATION_FAILED")

        try:
            data = response.json()
        except ValueError as exc:
            raise GoogleRoutesError("ROUTE_CALCULATION_FAILED") from exc

        routes = data.get("routes") or []
        if not routes:
            raise GoogleRoutesError("NO_ROUTE_FOUND")

        route = routes[0]
        polyline = (route.get("polyline") or {}).get("encodedPolyline")
        if not polyline:
            raise GoogleRoutesError("NO_ROUTE_FOUND")

        distance_meters = int(route.get("distanceMeters") or 0)
        duration_seconds = GoogleRoutesService._parse_duration_seconds(route.get("duration"))

        return {
            "distance_meters": distance_meters,
            "duration_seconds": duration_seconds,
            "encoded_polyline": polyline,
        }
