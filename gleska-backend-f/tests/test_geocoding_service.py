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
