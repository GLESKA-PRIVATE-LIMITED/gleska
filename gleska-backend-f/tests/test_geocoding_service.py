from types import SimpleNamespace

import pytest

from app.services import geocoding_service
from app.services.geocoding_service import GeocodingService


class FakeClient:
    def __init__(self, response):
        self.response = response
        self.request = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def get(self, url, **kwargs):
        self.request = (url, kwargs)
        return self.response


class SequenceClient(FakeClient):
    def __init__(self, responses):
        super().__init__(responses[0])
        self.responses = iter(responses)
        self.requests = []

    async def get(self, url, **kwargs):
        self.requests.append((url, kwargs))
        return next(self.responses)


@pytest.mark.asyncio
async def test_nominatim_reverse_geocode_sends_policy_headers(monkeypatch):
    response = SimpleNamespace(
        json=lambda: {"display_name": "Nanded, Maharashtra, India"},
        raise_for_status=lambda: None,
    )
    client = FakeClient(response)
    monkeypatch.setattr(geocoding_service.httpx, "AsyncClient", lambda **_kwargs: client)

    result = await GeocodingService.reverse_geocode(19.123, 73.456)

    assert result == "Nanded, Maharashtra, India"
    url, kwargs = client.request
    assert url.endswith("/reverse")
    assert kwargs["params"] == {"lat": 19.123, "lon": 73.456, "format": "jsonv2", "addressdetails": 1}
    assert kwargs["headers"]["User-Agent"]


@pytest.mark.asyncio
async def test_nominatim_reverse_geocode_rejects_invalid_coordinates():
    with pytest.raises(geocoding_service.GeocodingError, match="INVALID_COORDINATES"):
        await GeocodingService.reverse_geocode(91, 73.456)


@pytest.mark.asyncio
async def test_search_retries_normalized_query_when_exact_query_has_no_results(monkeypatch):
    empty_response = SimpleNamespace(json=lambda: [], raise_for_status=lambda: None)
    result_response = SimpleNamespace(
        json=lambda: [{"lat": "19.15", "lon": "77.32", "display_name": "Anand Nagar, Nanded, Maharashtra, India", "address": {"city": "Nanded", "state": "Maharashtra", "postcode": "431745"}}],
        raise_for_status=lambda: None,
    )
    client = SequenceClient([empty_response, result_response])
    monkeypatch.setattr(geocoding_service.httpx, "AsyncClient", lambda **_kwargs: client)

    locations = await GeocodingService.search("Anand Nagar, Nanded")

    assert locations[0]["address"].startswith("Anand Nagar")
    assert [request[1]["params"]["q"] for request in client.requests] == ["Anand Nagar, Nanded", "Anand Nagar Nanded"]
    assert client.requests[1][1]["params"]["countrycodes"] == "in"


@pytest.mark.asyncio
async def test_search_rejects_textual_match_from_wrong_city(monkeypatch):
    response = SimpleNamespace(
        json=lambda: [{
            "lat": "18.4",
            "lon": "76.5",
            "display_name": "Nanded Ring Road, Anand Nagar, Latur, Maharashtra, India",
            "address": {"road": "Nanded Ring Road", "suburb": "Anand Nagar", "city": "Latur", "state": "Maharashtra", "country": "India"},
        }],
        raise_for_status=lambda: None,
    )
    client = SequenceClient([response, response, response])
    monkeypatch.setattr(geocoding_service.httpx, "AsyncClient", lambda **_kwargs: client)

    locations = await GeocodingService.search("Anand Nagar, Nanded")

    assert locations == []


@pytest.mark.asyncio
async def test_search_accepts_postcode_context_in_county(monkeypatch):
    response = SimpleNamespace(
        json=lambda: [{
            "lat": "19.16",
            "lon": "77.26",
            "importance": 0.12,
            "display_name": "431602, Nanded, Maharashtra, India",
            "address": {"postcode": "431602", "county": "Nanded", "state_district": "Nanded", "state": "Maharashtra", "country": "India"},
        }],
        raise_for_status=lambda: None,
    )
    client = SequenceClient([response] * 3)
    monkeypatch.setattr(geocoding_service.httpx, "AsyncClient", lambda **_kwargs: client)

    locations = await GeocodingService.search("Nanded 431602")

    assert locations[0]["city"] == "Nanded"
    assert locations[0]["pincode"] == "431602"


@pytest.mark.asyncio
async def test_search_rejects_locality_result_with_missing_postcode_context(monkeypatch):
    response = SimpleNamespace(
        json=lambda: [{
            "lat": "28.6742079",
            "lon": "77.1673303",
            "display_name": "Anand Nagar, Delhi, India",
            "address": {"suburb": "Anand Nagar", "city": "Delhi", "state": "Delhi"},
        }],
        raise_for_status=lambda: None,
    )
    client = SequenceClient([response] * 3)
    monkeypatch.setattr(geocoding_service.httpx, "AsyncClient", lambda **_kwargs: client)

    locations = await GeocodingService.search("Anand Nagar 431602")

    assert locations == []


@pytest.mark.asyncio
async def test_search_does_not_reject_context_when_city_is_in_county_or_display(monkeypatch):
    response = SimpleNamespace(
        json=lambda: [{
            "lat": "19.16",
            "lon": "77.26",
            "display_name": "Anand Nagar, Nanded, Maharashtra, India",
            "address": {"residential": "Anand Nagar", "county": "Nanded", "state_district": "Nanded", "state": "Maharashtra", "postcode": "431602"},
        }],
        raise_for_status=lambda: None,
    )
    client = SequenceClient([response])
    monkeypatch.setattr(geocoding_service.httpx, "AsyncClient", lambda **_kwargs: client)

    locations = await GeocodingService.search("Anand Nagar, Nanded")

    assert locations[0]["locality"] == "Anand Nagar"
    assert locations[0]["city"] == "Nanded"


@pytest.mark.asyncio
async def test_search_does_not_downgrade_locality_query_to_postcode_result(monkeypatch):
    response = SimpleNamespace(
        json=lambda: [{
            "lat": "19.16",
            "lon": "77.26",
            "display_name": "431602, Nanded, Maharashtra, India",
            "address": {"postcode": "431602", "county": "Nanded", "state_district": "Nanded", "state": "Maharashtra"},
        }],
        raise_for_status=lambda: None,
    )
    client = SequenceClient([response, response, response])
    monkeypatch.setattr(geocoding_service.httpx, "AsyncClient", lambda **_kwargs: client)

    locations = await GeocodingService.search("Anand Nagar Nanded 431602")

    assert locations == []


@pytest.mark.asyncio
async def test_space_separated_city_context_rejects_wrong_city(monkeypatch):
    nanded = SimpleNamespace(
        json=lambda: [{"lat": "19.15", "lon": "77.32", "display_name": "Nanded, Maharashtra, India", "address": {"city": "Nanded", "state": "Maharashtra"}}],
        raise_for_status=lambda: None,
    )
    latur = SimpleNamespace(
        json=lambda: [{"lat": "18.4", "lon": "76.5", "display_name": "Nanded Ring Road, Anand Nagar, Latur, Maharashtra, India", "address": {"suburb": "Anand Nagar", "city": "Latur", "state": "Maharashtra"}}],
        raise_for_status=lambda: None,
    )
    client = SequenceClient([nanded, latur, latur])
    monkeypatch.setattr(geocoding_service.httpx, "AsyncClient", lambda **_kwargs: client)

    locations = await GeocodingService.search("Anand Nagar Nanded")

    assert locations == []


@pytest.mark.asyncio
async def test_search_requires_all_structured_context_components(monkeypatch):
    response = SimpleNamespace(
        json=lambda: [{
            "lat": "19.15",
            "lon": "77.32",
            "display_name": "Anand Nagar, Nanded, Maharashtra, India",
            "address": {"suburb": "Anand Nagar", "city": "Nanded", "state": "Maharashtra", "postcode": "431745"},
        }],
        raise_for_status=lambda: None,
    )
    client = SequenceClient([response])
    monkeypatch.setattr(geocoding_service.httpx, "AsyncClient", lambda **_kwargs: client)

    locations = await GeocodingService.search("Anand Nagar, Nanded, Maharashtra")

    assert locations[0]["locality"] == "Anand Nagar"
    assert locations[0]["city"] == "Nanded"


@pytest.mark.asyncio
async def test_search_preserves_generic_locality_query(monkeypatch):
    response = SimpleNamespace(
        json=lambda: [{
            "lat": "18.52",
            "lon": "73.85",
            "display_name": "Anand Nagar, Pune, Maharashtra, India",
            "address": {"suburb": "Anand Nagar", "city": "Pune", "state": "Maharashtra"},
        }],
        raise_for_status=lambda: None,
    )
    client = SequenceClient([response])
    monkeypatch.setattr(geocoding_service.httpx, "AsyncClient", lambda **_kwargs: client)

    locations = await GeocodingService.search("Anand Nagar")

    assert locations[0]["city"] == "Pune"
