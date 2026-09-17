import pytest
from types import SimpleNamespace
from fastapi import Response

from app.core.config import settings
from app.services.auth_service import AuthService
from app.services.msg91_service import MSG91Service


def application_user(role="WORKER"):
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    return {
        "id": "11111111-1111-1111-1111-111111111111",
        "name": "Test User",
        "mobile": "919999999999",
        "email": "test@example.com",
        "role": role,
        "is_mobile_verified": True,
        "is_active": True,
        "created_at": now,
        "updated_at": now,
    }


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


@pytest.mark.asyncio
async def test_msg91_login_uses_existing_role_without_request_role(monkeypatch):
    from app.routers import auth as auth_router

    existing = application_user("WORKER")
    monkeypatch.setattr(AuthService, "normalize_mobile", staticmethod(lambda mobile: "919999999999"))
    monkeypatch.setattr(AuthService, "get_user_by_mobile", staticmethod(lambda mobile: existing))
    async def verify_access_token(self, token):
        return {"type": "success"}

    monkeypatch.setattr(MSG91Service, "verify_access_token", verify_access_token)
    monkeypatch.setattr(auth_router.OnboardingService, "determine_next_step", staticmethod(lambda user: "WORKER_PROFILE"))
    monkeypatch.setattr(AuthService, "ensure_role_allowed", staticmethod(lambda existing_user, requested_role: (_ for _ in ()).throw(AssertionError("login must not validate an entry-point role"))))

    response = Response()
    result = await auth_router.login_msg91(
        {"mobile": "+91 9999999999", "msg91_access_token": "verified-token"},
        response,
    )

    assert result["user"].role == "WORKER"
    assert result["next_step"] == "WORKER_PROFILE"
    assert "goleska_session" in response.headers.get("set-cookie", "")


@pytest.mark.asyncio
async def test_existing_supabase_identity_provisioning_uses_database_role(monkeypatch):
    from app.routers import auth as auth_router
    from app.schemas.auth import ProvisionUserSchema

    existing = application_user("EMPLOYER")
    calls = {}

    class FakeSupabase:
        auth = SimpleNamespace(get_user=lambda token: SimpleNamespace(user=SimpleNamespace(
            id=existing["id"], email=existing["email"], phone=existing["mobile"], user_metadata={}
        )))

    monkeypatch.setattr(auth_router, "supabase", FakeSupabase())
    monkeypatch.setattr(AuthService, "get_user_by_id", staticmethod(lambda user_id: existing))

    def fake_provision(**kwargs):
        calls["role"] = kwargs["role"]
        return existing

    monkeypatch.setattr(AuthService, "provision_supabase_user", staticmethod(fake_provision))

    result = await auth_router.provision_authenticated_user(
        ProvisionUserSchema(name="", mobile=None, role=None),
        SimpleNamespace(credentials="supabase-token"),
    )

    assert calls["role"] == "EMPLOYER"
    assert result.role == "EMPLOYER"
