from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.routers import workers

USER = SimpleNamespace(id="user-id", role="WORKER")


def _profile_row(**overrides):
    row = {
        "id": "profile-id",
        "user_id": "user-id",
        "latitude": 18.5514,
        "longitude": 73.8219,
        "availability_status": "AVAILABLE",
        "profile_completed": True,
    }
    row.update(overrides)
    return row


class FakeQuery:
    def __init__(self, rows):
        self.rows = rows
        self._table = None

    def select(self, _fields):
        return self

    def eq(self, _field, _value):
        self._field = _field
        self._value = _value
        return self

    def single(self):
        return self

    def maybe_single(self):
        return self

    def limit(self, _count):
        return self

    def upsert(self, payload, on_conflict=None):
        self.payload = payload
        return self

    def execute(self):
        if getattr(self, "payload", None) is not None:
            row = {"id": "location-id", **self.payload, "updated_at": datetime.now(timezone.utc)}
            self.rows[:] = [row]
            return SimpleNamespace(data=[row])
        if self.rows is None:
            return SimpleNamespace(data=[])
        if isinstance(self.rows, list):
            filtered = [row for row in self.rows if row.get(self._field) == self._value]
            return SimpleNamespace(data=filtered)
        return SimpleNamespace(data=self.rows)


class FakeSupabase:
    def __init__(self, rows_by_table):
        self.rows_by_table = rows_by_table

    def table(self, name):
        return FakeQuery(self.rows_by_table.get(name, []))


@pytest.mark.asyncio
async def test_worker_route_returns_google_road_data(monkeypatch):
    fake_supabase = FakeSupabase({
        "worker_profiles": [_profile_row()],
        "worker_current_locations": [{"worker_profile_id": "profile-id", "latitude": 18.5514, "longitude": 73.8219, "updated_at": datetime.now(timezone.utc)}],
        "jobs": [{
            "id": "job-123",
            "title": "Hotel Cook",
            "job_site_id": "site-456",
            "status": "SEARCHING",
        }],
        "job_sites": [{
            "id": "site-456",
            "name": "Nanded Test Site",
            "location": {"coordinates": [73.8527, 18.5245]},
        }],
    })
    monkeypatch.setattr(workers, "supabase", fake_supabase)
    monkeypatch.setattr(
        workers,
        "MatchingService",
        SimpleNamespace(available_jobs=lambda *args, **kwargs: [{"job_id": "job-123"}]),
    )
    route_origin = {}

    async def fake_compute_route(origin_lat, origin_lng, *_args, **kwargs):
        route_origin.update(latitude=origin_lat, longitude=origin_lng)
        return {
            "distance_meters": 5100,
            "duration_seconds": 840,
            "encoded_polyline": "_p~iF~ps|U_ulLnnqC_mqNvxq`@",
        }
    monkeypatch.setattr(workers.GoogleRoutesService, "compute_route", staticmethod(fake_compute_route))

    result = await workers.get_worker_job_route("job-123", USER)

    assert result["job_id"] == "job-123"
    assert result["route"]["distance_meters"] == 5100
    assert result["route"]["duration_seconds"] == 840
    assert result["route"]["encoded_polyline"]
    assert route_origin == {"latitude": 18.5514, "longitude": 73.8219}


@pytest.mark.asyncio
async def test_worker_location_upserts_gps_and_provider_address(monkeypatch):
    fake_supabase = FakeSupabase({
        "worker_profiles": [_profile_row()],
        "worker_current_locations": [],
    })
    monkeypatch.setattr(workers, "supabase", fake_supabase)

    async def save_address(*_args):
        return "Nanded, Maharashtra, India"

    monkeypatch.setattr(workers.GeocodingService, "reverse_geocode", staticmethod(save_address))
    result = await workers.update_worker_location(
        workers.WorkerLocationUpdate(latitude=19.1383, longitude=77.3210, accuracy_m=15.2),
        USER,
    )

    assert result.latitude == 19.1383
    assert result.longitude == 77.321
    assert result.accuracy_m == 15.2
    assert result.address == "Nanded, Maharashtra, India"


@pytest.mark.asyncio
async def test_worker_location_saves_gps_when_geocoding_fails(monkeypatch):
    fake_supabase = FakeSupabase({
        "worker_profiles": [_profile_row()],
        "worker_current_locations": [],
    })
    monkeypatch.setattr(workers, "supabase", fake_supabase)

    async def fail_geocoding(*_args):
        raise workers.GeocodingError("ADDRESS_NOT_FOUND")

    monkeypatch.setattr(workers.GeocodingService, "reverse_geocode", staticmethod(fail_geocoding))
    result = await workers.update_worker_location(
        workers.WorkerLocationUpdate(latitude=19.1383, longitude=77.3210, accuracy_m=15.2),
        USER,
    )

    assert result.latitude == 19.1383
    assert result.longitude == 77.321
    assert result.accuracy_m == 15.2
    assert result.address is None


def test_worker_location_rejects_zero_coordinates():
    with pytest.raises(ValueError, match="cannot both be zero"):
        workers.WorkerLocationUpdate(latitude=0, longitude=0, accuracy_m=10)


@pytest.mark.asyncio
async def test_worker_route_requires_location(monkeypatch):
    fake_supabase = FakeSupabase({
        "worker_profiles": [_profile_row(latitude=None, longitude=None)],
    })
    monkeypatch.setattr(workers, "supabase", fake_supabase)

    with pytest.raises(workers.HTTPException) as exc:
        await workers.get_worker_job_route("job-123", USER)

    assert exc.value.status_code == 400
    assert exc.value.detail == "CURRENT_LOCATION_REQUIRED"


@pytest.mark.asyncio
async def test_worker_route_rejects_missing_job(monkeypatch):
    fake_supabase = FakeSupabase({
        "worker_profiles": [_profile_row()],
        "worker_current_locations": [{"worker_profile_id": "profile-id", "latitude": 18.5514, "longitude": 73.8219, "updated_at": datetime.now(timezone.utc)}],
        "jobs": [],
    })
    monkeypatch.setattr(workers, "supabase", fake_supabase)
    monkeypatch.setattr(
        workers,
        "MatchingService",
        SimpleNamespace(available_jobs=lambda *args, **kwargs: []),
    )

    with pytest.raises(workers.HTTPException) as exc:
        await workers.get_worker_job_route("job-123", USER)

    assert exc.value.status_code == 403
