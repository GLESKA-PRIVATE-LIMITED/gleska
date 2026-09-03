"""Server-side reverse geocoding for trusted human-readable locations."""

import httpx
import re
from dataclasses import dataclass

from app.core.config import settings


class GeocodingError(Exception):
    """The configured geocoder could not resolve the coordinates."""


@dataclass(frozen=True)
class SearchContext:
    locality: str | None
    city: str | None
    state: str | None
    postcode: str | None


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
        context = GeocodingService._parse_search_context(normalized_query)

        query_candidates: list[str] = [normalized_query]
        without_punctuation = " ".join(normalized_query.replace(",", " ").split())
        if without_punctuation != normalized_query:
            query_candidates.append(without_punctuation)
        if context.locality and context.postcode:
            query_candidates.append(f"{context.locality} {context.postcode}")
        if context.locality and context.city:
            query_candidates.append(f"{context.locality} {context.city}")
        if context.city and context.postcode:
            query_candidates.append(f"{context.city} {context.postcode}")
        elif context.postcode:
            query_candidates.append(context.postcode)
        query_candidates = list(dict.fromkeys(query_candidates))

        try:
            async with httpx.AsyncClient(timeout=settings.NOMINATIM_TIMEOUT_SECONDS) as client:
                results: list[dict] = []
                for candidate in query_candidates:
                    response = await client.get(
                        f"{settings.NOMINATIM_BASE_URL.rstrip('/')}/search",
                        params={"q": candidate, "format": "jsonv2", "addressdetails": 1, "limit": 5, "countrycodes": "in"},
                        headers={"User-Agent": settings.NOMINATIM_USER_AGENT, "Accept": "application/json"},
                    )
                    response.raise_for_status()
                    results = response.json()
                    if not isinstance(results, list):
                        raise GeocodingError("GEOCODING_SEARCH_FAILED")
                    relevant_results = GeocodingService._rank_relevant_results(
                        results,
                        context,
                        require_locality=bool(context.locality),
                    )
                    if relevant_results:
                        results = relevant_results
                        break
                    results = []
        except GeocodingError:
            raise
        except (httpx.HTTPError, ValueError) as exc:
            raise GeocodingError("GEOCODING_SEARCH_FAILED") from exc

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
                "locality": address.get("neighbourhood") or address.get("suburb") or address.get("quarter") or address.get("hamlet") or address.get("residential"),
                "city": address.get("city") or address.get("town") or address.get("village") or address.get("municipality") or address.get("county"),
                "state": address.get("state"),
                "pincode": address.get("postcode"),
                "latitude": str(latitude),
                "longitude": str(longitude),
            })
        return locations

    @staticmethod
    def _parse_search_context(query: str) -> SearchContext:
        postcode_match = re.search(r"\b\d{6}\b", query)
        postcode = postcode_match.group(0) if postcode_match else None
        query_without_postcode = re.sub(r"\b\d{6}\b", " ", query)
        comma_parts = [part.strip() for part in query_without_postcode.split(",") if part.strip()]
        if len(comma_parts) >= 2:
            if len(comma_parts[0].split()) == 1:
                return SearchContext(None, comma_parts[0], comma_parts[1], postcode)
            return SearchContext(comma_parts[0], comma_parts[1], comma_parts[2] if len(comma_parts) >= 3 else None, postcode)
        words = query_without_postcode.split()
        if postcode:
            if len(words) == 1:
                return SearchContext(None, words[0], None, postcode)
            return SearchContext(" ".join(words), None, None, postcode)
        if len(words) < 3:
            return SearchContext(None, None, None, None)
        return SearchContext(" ".join(words[:-1]), words[-1], None, None)

    @staticmethod
    def _rank_relevant_results(results: list[dict], context: SearchContext, require_locality: bool = True) -> list[dict]:
        ranked: list[tuple[int, dict]] = []
        for result in results:
            address = result.get("address") or {}
            display_name = str(result.get("display_name") or "").casefold()
            locality_values = GeocodingService._values(address, ("neighbourhood", "suburb", "quarter", "hamlet", "residential", "road"))
            city_values = GeocodingService._values(address, ("city", "town", "municipality", "village", "county", "state_district"))
            state_values = GeocodingService._values(address, ("state",))
            postcode_value = GeocodingService._normalize(address.get("postcode"))

            score = 0
            if context.postcode:
                if postcode_value == context.postcode:
                    score += 100
                else:
                    continue
            locality_match = not context.locality or GeocodingService._matches(context.locality, locality_values, display_name)
            if require_locality and not locality_match:
                continue
            if context.locality and locality_match:
                score += 50
            if context.city:
                city_match = GeocodingService._matches(context.city, city_values, display_name)
                explicit_city_conflict = bool(city_values) and not any(
                    GeocodingService._normalize(context.city) == value for value in city_values
                )
                if explicit_city_conflict:
                    continue
                if city_match:
                    score += 40 if any(GeocodingService._normalize(context.city) == value for value in city_values) else 20
            if context.state and GeocodingService._matches(context.state, state_values, display_name):
                score += 20
            if not context.locality and not context.city and not context.postcode:
                score = 0
            score += int(float(result.get("importance") or 0) * 10)
            ranked.append((score, result))

        ranked.sort(key=lambda item: item[0], reverse=True)
        return [result for _, result in ranked]

    @staticmethod
    def _values(address: dict, keys: tuple[str, ...]) -> set[str]:
        return {GeocodingService._normalize(address.get(key)) for key in keys if GeocodingService._normalize(address.get(key))}

    @staticmethod
    def _normalize(value: object) -> str:
        return " ".join(str(value or "").casefold().split())

    @staticmethod
    def _matches(requested: str, structured_values: set[str], display_name: str) -> bool:
        normalized = GeocodingService._normalize(requested)
        return normalized in structured_values or bool(normalized and re.search(rf"(?<!\w){re.escape(normalized)}(?!\w)", display_name))
