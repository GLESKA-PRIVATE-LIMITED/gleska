import pytest
from types import SimpleNamespace

from app.core.config import settings
from app.services.auth_service import AuthService
from app.services.msg91_service import MSG91Service


@pytest.mark.asyncio
async def test_msg91_service_verify_access_token_success(monkeypatch):
    class DummyResponse:
        status_code = 200

        headers = {"content-type": "application/json"}
        text = '{"type":"success","message":"919999999999"}'

        def json(self):
            return {"type": "success", "message": "919999999999"}

    async def fake_post(*args, **kwargs):
        return DummyResponse()

    monkeypatch.setattr("app.services.msg91_service.httpx.AsyncClient.post", fake_post)

    service = MSG91Service()
    result = await service.verify_access_token("token-123")

    assert result["type"] == "success"
    assert result["message"] == "919999999999"


@pytest.mark.asyncio
async def test_msg91_service_handles_invalid_token(monkeypatch):
    class DummyResponse:
        status_code = 401
        headers = {"content-type": "application/json"}
        text = '{"type":"error","message":"invalid token"}'

        def json(self):
            return {"status": "error", "message": "invalid token"}

    async def fake_post(*args, **kwargs):
        return DummyResponse()

    monkeypatch.setattr("app.services.msg91_service.httpx.AsyncClient.post", fake_post)

    service = MSG91Service()

    with pytest.raises(ValueError, match="(?i)invalid|expired|verification"):
        await service.verify_access_token("bad-token")


def test_normalize_mobile_handles_indian_numbers():
    assert AuthService.normalize_mobile("9876543210") == "919876543210"
    assert AuthService.normalize_mobile("+91 9876543210") == "919876543210"
    assert AuthService.normalize_mobile("919876543210") == "919876543210"


def test_role_conflict_is_detected():
    existing = {"role": "WORKER"}
    payload_role = "EMPLOYER"

    with pytest.raises(ValueError, match="ROLE_CONFLICT"):
        AuthService.ensure_role_allowed(existing, payload_role)


def test_create_user_uses_supabase_auth_parent_id(monkeypatch):
    auth_user_id = "11111111-1111-1111-1111-111111111111"
    calls = {}

    class FakeQuery:
        def __init__(self, table_name):
            self.table_name = table_name

        def upsert(self, data, on_conflict):
            calls["users_upsert"] = data
            return self

        def select(self, value):
            return self

        def eq(self, field, value):
            return self

        def insert(self, data):
            calls["profile_insert"] = data
            return self

        def execute(self):
            if self.table_name == "users":
                return SimpleNamespace(data=[calls["users_upsert"]])
            return SimpleNamespace(data=[])

    class FakeAdmin:
        def create_user(self, attributes):
            calls["auth_attributes"] = attributes
            return SimpleNamespace(user=SimpleNamespace(id=auth_user_id))

    class FakeSupabase:
        auth = SimpleNamespace(admin=FakeAdmin())

        def table(self, table_name):
            return FakeQuery(table_name)

    monkeypatch.setattr("app.services.auth_service.supabase", FakeSupabase())
    monkeypatch.setattr(AuthService, "get_user_by_mobile", staticmethod(lambda mobile: None))

    user = AuthService.create_or_update_user(None, "Test User", "9876543210", "EMPLOYER")

    assert calls["auth_attributes"]["phone"] == "+919876543210"
    assert calls["users_upsert"]["id"] == auth_user_id
    assert calls["profile_insert"]["user_id"] == auth_user_id
    assert user["id"] == auth_user_id
