from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.core.security import require_employer
from app.main import app
from app.routers import employer_security


class Query:
    def __init__(self, data=None):
        self.data = data
        self.filters = []
        self.payload = None
        self.selected = None

    def select(self, fields, **_kwargs):
        self.selected = fields
        return self

    def update(self, payload):
        self.payload = payload
        return self

    def upsert(self, payload, **_kwargs):
        self.payload = payload
        return self

    def eq(self, field, value):
        self.filters.append((field, value))
        return self

    def order(self, *_args, **_kwargs):
        return self

    def limit(self, *_args):
        return self

    def execute(self):
        return SimpleNamespace(data=self.data)


class FakeSupabase:
    def __init__(self):
        self.sessions = Query([{
            "id": str(uuid4()),
            "device_name": "Browser",
            "first_seen": datetime.now(timezone.utc).isoformat(),
            "last_active": datetime.now(timezone.utc).isoformat(),
            "session_key": "employer-current-key",
            "is_revoked": False,
        }])
        self.activities = Query([])
        self.activity_write = Query([])
        self.write_activity = False
        self.rpc_call = None

    def table(self, name):
        if name == "user_sessions":
            return self.sessions
        if name == "security_activity":
            return self.activity_write if self.write_activity else self.activities
        raise AssertionError(name)

    def rpc(self, name, params):
        self.rpc_call = (name, params)
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=self.sessions.data))


@pytest.mark.asyncio
async def test_employer_security_is_owner_scoped_and_marks_exact_current_session(monkeypatch):
    fake = FakeSupabase()
    monkeypatch.setattr(employer_security, "supabase", fake)
    user = SimpleNamespace(id="employer-a", role="EMPLOYER")

    result = await employer_security.get_employer_security(user, "employer-current-key")

    assert result.sessions[0].is_current is True
    assert ("user_id", "employer-a") in fake.sessions.filters
    assert ("user_id", "employer-a") in fake.activities.filters
    assert ("session_key", "employer-current-key") in fake.sessions.filters


@pytest.mark.asyncio
async def test_employer_revoke_scopes_session_and_records_idempotent_activity(monkeypatch):
    session_id = uuid4()
    fake = FakeSupabase()
    fake.sessions.data = [{"id": str(session_id), "device_name": "Browser"}]
    monkeypatch.setattr(employer_security, "supabase", fake)
    user = SimpleNamespace(id="employer-a", role="EMPLOYER")

    result = await employer_security.revoke_employer_security_session(session_id, user)

    assert result.success is True
    assert fake.rpc_call == (
        "revoke_account_session",
        {"p_user_id": "employer-a", "p_session_id": str(session_id)},
    )


def test_employer_security_routes_require_authentication():
    app.dependency_overrides.pop(require_employer, None)
    response = TestClient(app).get("/api/v1/employers/me/security")
    assert response.status_code == 401
