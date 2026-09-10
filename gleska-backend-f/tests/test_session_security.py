from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import Response
from fastapi.security import HTTPAuthorizationCredentials
from starlette.requests import Request

from app.core import security
from app.routers import auth
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