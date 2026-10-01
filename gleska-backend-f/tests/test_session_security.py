from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import Response
from fastapi.security import HTTPAuthorizationCredentials
from starlette.requests import Request

from app.core import security
from app.routers import auth, security as worker_security
from app.schemas.auth import UserResponse


USER = {
    "id": "user-a",
    "name": "Worker A",
    "mobile": "919876543210",
    "email": "worker-a@example.com",
    "role": "WORKER",
    "is_mobile_verified": True,
    "is_active": True,
    "created_at": datetime.now(timezone.utc),
    "updated_at": datetime.now(timezone.utc),
}


class Query:
    def __init__(self, data=None):
        self.data = data
        self.filters = []
        self.update_payload = None

    def select(self, *_args, **_kwargs):
        return self

    def update(self, payload):
        self.update_payload = payload
        return self

    def eq(self, field, value):
        self.filters.append((field, value))
        return self

    def maybe_single(self):
        return self

    def single(self):
        return self

    def execute(self):
        return SimpleNamespace(data=self.data)


class FakeSupabase:
    def __init__(self, session_row=None):
        self.session_query = Query(session_row)
        self.user_query = Query(USER)
        self.auth = SimpleNamespace(
            get_user=lambda _token: SimpleNamespace(user=SimpleNamespace(id="user-a")),
        )

    def table(self, name):
        if name == "user_sessions":
            return self.session_query
        if name == "users":
            return self.user_query
        raise AssertionError(name)


@pytest.mark.asyncio
async def test_revoked_matching_session_is_rejected(monkeypatch):
    fake = FakeSupabase({"id": "session-a", "is_revoked": True})
    monkeypatch.setattr(security, "supabase", fake)
    req = Request({"type": "http", "method": "GET", "path": "/auth/me", "headers": [(b"x-goleska-session-key", b"key-a")]})

    with pytest.raises(Exception) as error:
        await security.get_current_user(req, HTTPAuthorizationCredentials(scheme="Bearer", credentials="token"))

    assert getattr(error.value, "status_code", None) == 401
    assert getattr(error.value, "detail", None) == "SESSION_REVOKED"


@pytest.mark.asyncio
async def test_active_bearer_authenticates_without_session_key(monkeypatch):
    fake = FakeSupabase({"id": "session-a", "is_revoked": False})
    monkeypatch.setattr(security, "supabase", fake)
    req = Request({"type": "http", "method": "GET", "path": "/auth/me", "headers": []})

    result = await security.get_current_user(
        req,
        HTTPAuthorizationCredentials(scheme="Bearer", credentials="token"),
    )

    assert result.id == "user-a"


@pytest.mark.asyncio
async def test_missing_session_row_does_not_return_500(monkeypatch):
    fake = FakeSupabase(None)
    monkeypatch.setattr(security, "supabase", fake)
    req = Request({"type": "http", "method": "GET", "path": "/auth/me", "headers": [(b"x-goleska-session-key", b"stale-key")]})

    result = await security.get_current_user(
        req,
        HTTPAuthorizationCredentials(scheme="Bearer", credentials="token"),
    )

    assert result.id == "user-a"


@pytest.mark.asyncio
async def test_invalid_key_cannot_authenticate_as_another_user(monkeypatch):
    fake = FakeSupabase(None)
    monkeypatch.setattr(security, "supabase", fake)
    req = Request({"type": "http", "method": "GET", "path": "/auth/me", "headers": [(b"x-goleska-session-key", b"user-b-key")]})

    result = await security.get_current_user(
        req,
        HTTPAuthorizationCredentials(scheme="Bearer", credentials="token"),
    )

    assert result.id == "user-a"
    assert ("user_id", "user-a") in fake.session_query.filters
    assert ("session_key", "user-b-key") in fake.session_query.filters


@pytest.mark.asyncio
async def test_logout_revokes_only_authenticated_matching_session(monkeypatch):
    fake = FakeSupabase()
    monkeypatch.setattr(auth, "supabase", fake)
    user = UserResponse(**USER)

    result = await auth.logout(Response(), user=user, session_key="key-a")

    assert result["success"] is True
    assert fake.session_query.update_payload == {"is_revoked": True, "revoked_at": fake.session_query.update_payload["revoked_at"]}
    assert ("user_id", "user-a") in fake.session_query.filters
    assert ("session_key", "key-a") in fake.session_query.filters
    assert ("is_revoked", False) in fake.session_query.filters


@pytest.mark.asyncio
async def test_logout_without_session_key_does_not_revoke_sessions(monkeypatch):
    fake = FakeSupabase()
    monkeypatch.setattr(auth, "supabase", fake)

    result = await auth.logout(Response(), user=UserResponse(**USER), session_key=None)

    assert result["success"] is True
    assert fake.session_query.update_payload is None


@pytest.mark.asyncio
async def test_logout_clears_goleska_cookie_without_session_row():
    response = Response()

    result = await auth.logout(response, user=None, session_key=None)

    assert result["success"] is True
    cookie = response.headers.get("set-cookie", "").lower()
    assert "goleska_session" in cookie
    assert "max-age=0" in cookie


def test_session_timestamp_migration_preserves_order_and_database_time():
    from pathlib import Path

    migration = (
        Path(__file__).resolve().parents[2]
        / "gleska-website"
        / "supabase"
        / "migrations"
        / "064_user_session_timestamp_order.sql"
    ).read_text(encoding="utf-8")

    assert "WHERE last_active < first_seen" in migration
    assert "NEW.first_seen := OLD.first_seen" in migration
    assert "NEW.last_active := GREATEST(" in migration
    assert "NEW.first_seen," in migration
    assert "NOW()" in migration
    assert "BEFORE INSERT OR UPDATE ON public.user_sessions" in migration


@pytest.mark.asyncio
async def test_worker_security_marks_current_session_by_exact_session_key(monkeypatch):
    class ReadQuery:
        def __init__(self, rows):
            self.rows = rows
            self.selected_fields = None

        def select(self, fields):
            self.selected_fields = fields
            return self

        def eq(self, *_args):
            return self

        def order(self, *_args, **_kwargs):
            return self

        def limit(self, *_args):
            return self

        def execute(self):
            return SimpleNamespace(data=self.rows)

    sessions = ReadQuery([
        {
            "id": "session-current",
            "session_key": "key-current",
            "device_name": "Chrome on Windows",
            "first_seen": "2026-09-29T10:00:00+00:00",
            "last_active": "2026-09-29T10:01:00+00:00",
        },
        {
            "id": "session-other",
            "session_key": "key-other",
            "device_name": "Chrome on Windows",
            "first_seen": "2026-09-28T10:00:00+00:00",
            "last_active": "2026-09-28T10:01:00+00:00",
        },
    ])
    activities = ReadQuery([])

    class FakeSupabase:
        def table(self, name):
            return sessions if name == "user_sessions" else activities

    monkeypatch.setattr(worker_security, "supabase", FakeSupabase())

    response = await worker_security.get_worker_security(UserResponse(**USER), session_key="key-current")

    assert [item.is_current for item in response.sessions] == [True, False]
    assert "ip_address" not in sessions.selected_fields