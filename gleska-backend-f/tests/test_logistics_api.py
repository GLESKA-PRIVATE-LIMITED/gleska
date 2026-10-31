"""Logistics persistence API (migration 107): validation, organisation isolation, one-time import."""

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.core.security import get_current_user
from app.main import app
from app.routers import logistics
from app.schemas.auth import UserResponse
from tests.company_brain_fixtures import ORG_A, USER_A, USER_B, FakeDB


def user(uid, role="EMPLOYER"):
    now = datetime.now(timezone.utc)
    return UserResponse(id=uid, name="O", mobile="910000000000", role=role, is_mobile_verified=True, is_active=True,
                        created_at=now, updated_at=now)


@pytest.fixture
def db(monkeypatch):
    fake = FakeDB()
    fake.tables["logistics_vehicle_listings"] = []
    fake.tables["logistics_rental_requests"] = []
    monkeypatch.setattr(logistics, "supabase", fake)
    return fake


@pytest.fixture
def client():
    def make(u):
        app.dependency_overrides[get_current_user] = lambda: u
        return TestClient(app)

    yield make
    app.dependency_overrides.pop(get_current_user, None)


VEHICLE = {"category": "Truck", "vehicle_type": "Open body", "registration_number": "mh12ab1234",
           "price_amount": "2500.50", "price_unit": "per day", "available_from": "", "documents": {"rcAttached": True, "x": True}}


def test_create_and_list_are_scoped_to_the_caller(db, client):
    a = client(user(USER_A))
    created = a.post("/api/v1/logistics/vehicles", json=VEHICLE)
    assert created.status_code == 201
    v = created.json()["vehicle"]
    assert (v["employer_id"], v["registration_number"], v["price_amount"], v["documents"]) == (
        ORG_A, "MH12AB1234", "2500.50", {"rcAttached": True})
    assert len(a.get("/api/v1/logistics/vehicles").json()["vehicles"]) == 1
    b = client(user(USER_B))
    assert b.get("/api/v1/logistics/vehicles").json()["vehicles"] == []
    assert b.patch(f"/api/v1/logistics/vehicles/{v['id']}", json={"status": "ARCHIVED"}).status_code == 404


def test_validation_rejects_bad_values(db, client):
    a = client(user(USER_A))
    assert a.post("/api/v1/logistics/vehicles", json={**VEHICLE, "price_amount": "-1"}).status_code == 422
    assert a.post("/api/v1/logistics/vehicles", json={**VEHICLE, "price_unit": "per hour"}).status_code == 422
    assert a.post("/api/v1/logistics/rental-requests", json={"source_location": "", "destination_location": "X"}).status_code == 422
    assert client(user("w", "WORKER")).get("/api/v1/logistics/vehicles").status_code == 403


def test_import_moves_browser_records_once(db, client):
    a = client(user(USER_A))
    payload = {"listings": [VEHICLE], "requests": [{"source_location": "Pune", "destination_location": "Jaipur",
                                                    "offered_price": 3000, "price_unit": "per day"}]}
    assert a.post("/api/v1/logistics/import", json=payload).json() == {"imported_listings": 1, "imported_requests": 1}
    again = a.post("/api/v1/logistics/import", json={"listings": [VEHICLE]}).json()
    assert again["imported_listings"] == 0  # same registration not duplicated
    assert len(db.tables["logistics_vehicle_listings"]) == 1


def test_status_updates(db, client):
    a = client(user(USER_A))
    req = a.post("/api/v1/logistics/rental-requests", json={"source_location": "Pune", "destination_location": "Goa"}).json()["request"]
    assert a.patch(f"/api/v1/logistics/rental-requests/{req['id']}", json={"status": "IN_TRANSIT"}).json()["request"]["status"] == "IN_TRANSIT"
    assert a.patch(f"/api/v1/logistics/rental-requests/{req['id']}", json={"status": "LOST"}).status_code == 422
