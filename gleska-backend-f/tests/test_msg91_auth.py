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


@pytest.mark.asyncio
async def test_msg91_access_token_binds_matching_phone_using_shared_normalization(monkeypatch):
    async def verify_access_token(self, _token):
        return {"type": "success", "message": "09876543210"}

    monkeypatch.setattr(MSG91Service, "verify_access_token", verify_access_token)

    result = await MSG91Service().verify_access_token_for_mobile(
        "verified-token", "+91 98765 43210"
    )

    assert result["message"] == "09876543210"


@pytest.mark.asyncio
async def test_msg91_access_token_rejects_different_verified_phone(monkeypatch):
    async def verify_access_token(self, _token):
        return {"type": "success", "message": "919876543210"}

    monkeypatch.setattr(MSG91Service, "verify_access_token", verify_access_token)

    with pytest.raises(ValueError, match="MSG91_MOBILE_MISMATCH"):
        await MSG91Service().verify_access_token_for_mobile(
            "verified-token", "919999999999"
        )


@pytest.mark.asyncio
async def test_msg91_access_token_requires_verified_phone_identity(monkeypatch):
    async def verify_access_token(self, _token):
        return {"type": "success"}

    monkeypatch.setattr(MSG91Service, "verify_access_token", verify_access_token)

    with pytest.raises(ValueError, match="MSG91_VERIFIED_MOBILE_MISSING"):
        await MSG91Service().verify_access_token_for_mobile(
            "verified-token", "919999999999"
        )


@pytest.mark.asyncio
async def test_msg91_token_validation_distinguishes_missing_mobile_identity(monkeypatch):
    class DummyResponse:
        status_code = 200
        headers = {"content-type": "application/json"}
        text = '{"type":"success"}'

        def json(self):
            return {"type": "success"}

    async def fake_post(*_args, **_kwargs):
        return DummyResponse()

    monkeypatch.setattr("app.services.msg91_service.httpx.AsyncClient.post", fake_post)

    with pytest.raises(ValueError, match="MSG91_VERIFIED_MOBILE_MISSING"):
        await MSG91Service().verify_access_token("verified-token")


def test_normalize_mobile_handles_indian_numbers():
    assert AuthService.normalize_mobile("9876543210") == "919876543210"
    assert AuthService.normalize_mobile("+91 9876543210") == "919876543210"
    assert AuthService.normalize_mobile("919876543210") == "919876543210"


def test_role_conflict_is_detected():
    existing = {"role": "WORKER"}
    payload_role = "EMPLOYER"

    with pytest.raises(ValueError, match="ROLE_CONFLICT"):
        AuthService.ensure_role_allowed(existing, payload_role)


def test_provision_supabase_user_worker_inserts_trial_dates(monkeypatch):
    from datetime import datetime, timedelta, timezone

    calls = {}

    class FakeUsersTable:
        def select(self, *_args, **_kwargs):
            self._select_called = True
            return self

        def eq(self, *_args, **_kwargs):
            return self

        def ilike(self, *_args, **_kwargs):
            return self

        def upsert(self, data, on_conflict):
            calls["user_upsert"] = data
            return self

        def execute(self):
            if self.__dict__.get("_select_called"):
                return SimpleNamespace(data=[])
            return SimpleNamespace(data=[calls["user_upsert"]])

    class FakeWorkerProfilesTable:
        def select(self, *_args, **_kwargs):
            self._select_called = True
            return self

        def eq(self, *_args, **_kwargs):
            return self

        def execute(self):
            if "worker_insert" in calls:
                return SimpleNamespace(data=[{"id": "profile-id"}])
            return SimpleNamespace(data=[])

        def insert(self, data):
            calls["worker_insert"] = data
            return self

    class FakeSupabase:
        def table(self, table_name):
            if table_name == "users":
                return FakeUsersTable()
            if table_name == "worker_profiles":
                return FakeWorkerProfilesTable()
            raise AssertionError(f"Unexpected table: {table_name}")

    monkeypatch.setattr("app.services.auth_service.supabase", FakeSupabase())

    user = AuthService.provision_supabase_user(
        user_id="11111111-1111-1111-1111-111111111111",
        name="Worker User",
        role="WORKER",
        email="worker@example.com",
        mobile="9876543210",
    )

    assert user["role"] == "WORKER"
    assert "worker_insert" in calls
    assert "trial_started_at" in calls["worker_insert"]
    assert "trial_ends_at" in calls["worker_insert"]

    started = datetime.fromisoformat(calls["worker_insert"]["trial_started_at"].replace("Z", "+00:00"))
    ended = datetime.fromisoformat(calls["worker_insert"]["trial_ends_at"].replace("Z", "+00:00"))
    assert ended - started == timedelta(days=30)


def test_provision_supabase_user_business_employer_inserts_trial_dates(monkeypatch):
    from datetime import datetime, timedelta

    calls = {}

    class FakeUsersTable:
        def select(self, *_args, **_kwargs):
            return self

        def eq(self, *_args, **_kwargs):
            return self

        def ilike(self, *_args, **_kwargs):
            return self

        def upsert(self, data, on_conflict):
            calls["user_upsert"] = data
            return self

        def execute(self):
            if "user_upsert" in calls:
                return SimpleNamespace(data=[calls["user_upsert"]])
            return SimpleNamespace(data=[])

    class FakeEmployerProfilesTable:
        def select(self, *_args, **_kwargs):
            return self

        def eq(self, *_args, **_kwargs):
            return self

        def execute(self):
            if "employer_insert" in calls:
                return SimpleNamespace(data=[{"id": "profile-id"}])
            return SimpleNamespace(data=[])

        def insert(self, data):
            calls["employer_insert"] = data
            return self

    class FakeSupabase:
        def table(self, table_name):
            if table_name == "users":
                return FakeUsersTable()
            if table_name == "employer_profiles":
                return FakeEmployerProfilesTable()
            raise AssertionError(f"Unexpected table: {table_name}")

    monkeypatch.setattr("app.services.auth_service.supabase", FakeSupabase())

    user = AuthService.provision_supabase_user(
        user_id="11111111-1111-1111-1111-111111111111",
        name="Business User",
        role="EMPLOYER",
        email="business@example.com",
        mobile="9876543210",
    )

    assert user["role"] == "EMPLOYER"
    assert "employer_insert" in calls
    assert "trial_started_at" in calls["employer_insert"]
    assert "trial_ends_at" in calls["employer_insert"]

    started = datetime.fromisoformat(calls["employer_insert"]["trial_started_at"].replace("Z", "+00:00"))
    ended = datetime.fromisoformat(calls["employer_insert"]["trial_ends_at"].replace("Z", "+00:00"))
    assert ended - started == timedelta(days=30)


def test_msg91_resend_cooldown_blocks_duplicate_requests():
    from app.services import msg91_service
    from app.services.msg91_service import OTPResendCooldown

    MSG91Service.validate_otp_resend_request("919876543210", "SMS")

    with pytest.raises(OTPResendCooldown, match="OTP_RESEND_COOLDOWN") as error:
        MSG91Service.validate_otp_resend_request("919876543210", "SMS")

    assert 1 <= error.value.retry_after_seconds <= msg91_service.OTP_RESEND_COOLDOWN_SECONDS
    assert "919876543210" in msg91_service._otp_resend_history


def test_msg91_resend_cooldown_allows_after_timeout(monkeypatch):
    import app.services.msg91_service as msg91_service

    msg91_service._otp_resend_history.clear()
    now = __import__("datetime").datetime.utcnow()
    msg91_service._otp_resend_history["919876543211"] = [(now - msg91_service.timedelta(seconds=31), "SMS")]

    MSG91Service.validate_otp_resend_request("919876543211", "SMS")


def test_password_reset_service_replaces_existing_active_challenge(monkeypatch):
    from app.services import password_reset_service

    password_reset_service._password_reset_request_times.clear()
    challenge_rows = [{"id": "old-id", "phone": "919876543210", "created_at": "2024-01-01T00:00:00Z", "used_at": None}]

    class FakeTable:
        def __init__(self, rows):
            self.rows = rows
            self._filter = None
            self._update_values = None
            self._insert_values = None

        def select(self, *_args, **_kwargs):
            return self

        def eq(self, *args, **kwargs):
            self._filter = args
            return self

        def is_(self, *_args, **_kwargs):
            return self

        def order(self, *_args, **_kwargs):
            return self

        def limit(self, *_args, **_kwargs):
            return self

        def update(self, values):
            self._update_values = values
            return self

        def insert(self, values):
            self._insert_values = values
            return self

        def execute(self):
            if self._update_values is not None:
                for row in self.rows:
                    if row["phone"] == self._filter[1] and row.get("used_at") is None:
                        row["used_at"] = "2024-01-01T00:05:00Z"
                return SimpleNamespace(data=self.rows)
            if self._insert_values is not None:
                challenge_rows.append({**self._insert_values, "id": "new-id", "created_at": "2024-01-01T00:06:00Z", "used_at": None})
                return SimpleNamespace(data=[self._insert_values])
            return SimpleNamespace(data=self.rows)

    class FakeSupabase:
        def table(self, table_name):
            assert table_name == "password_reset_challenges"
            return FakeTable(challenge_rows)

    monkeypatch.setattr(password_reset_service, "supabase", FakeSupabase())
    monkeypatch.setattr(password_reset_service.AuthService, "get_user_by_mobile", lambda phone: {"id": "user-1", "mobile": phone})

    import asyncio
    asyncio.run(password_reset_service.PasswordResetService.request_otp("9876543210"))

    assert len(challenge_rows) == 2
    assert challenge_rows[0]["used_at"] == "2024-01-01T00:05:00Z"
    assert challenge_rows[1]["phone"] == "919876543210"


def test_password_reset_request_rejects_missing_account_without_side_effects(monkeypatch):
    from app.services import password_reset_service

    password_reset_service._password_reset_request_times.clear()

    class FakeSupabase:
        def table(self, _table_name):
            pytest.fail("A missing account must not mutate reset challenges")

    monkeypatch.setattr(password_reset_service, "supabase", FakeSupabase())
    monkeypatch.setattr(password_reset_service.AuthService, "get_user_by_mobile", lambda _phone: None)

    import asyncio

    with pytest.raises(ValueError, match="MOBILE_NOT_FOUND"):
        asyncio.run(password_reset_service.PasswordResetService.request_otp("9876543211"))

    assert "919876543211" not in password_reset_service._password_reset_request_times


def test_password_reset_request_preserves_cooldown_for_existing_account(monkeypatch):
    from datetime import timedelta
    from app.services import password_reset_service

    normalized_phone = "919876543212"
    password_reset_service._password_reset_request_times.clear()
    password_reset_service._password_reset_request_times[normalized_phone] = (
        password_reset_service.PasswordResetService._now()
        - timedelta(seconds=1)
    )
    monkeypatch.setattr(
        password_reset_service.AuthService,
        "get_user_by_mobile",
        lambda _phone: {"id": "existing-user"},
    )

    class FakeSupabase:
        def table(self, _table_name):
            pytest.fail("A cooldown response must not mutate reset challenges")

    monkeypatch.setattr(password_reset_service, "supabase", FakeSupabase())

    import asyncio

    retry_after = asyncio.run(
        password_reset_service.PasswordResetService.request_otp("9876543212")
    )

    assert retry_after is not None
    assert 1 <= retry_after <= password_reset_service.settings.PASSWORD_RESET_RESEND_COOLDOWN_SECONDS


@pytest.mark.asyncio
async def test_password_reset_challenge_can_issue_only_one_authorization(monkeypatch):
    from datetime import datetime, timedelta, timezone
    from app.services import password_reset_service

    challenge = {
        "id": "challenge-1",
        "phone": "919876543210",
        "otp_expires_at": (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat(),
        "attempts": 0,
        "max_attempts": 5,
        "verified_at": None,
        "used_at": None,
    }
    calls = {"provider_verify": 0}

    class FakeTable:
        def __init__(self):
            self.action = "select"
            self.filters = {}
            self.update_values = None
            self.selected_after_update = False

        def select(self, *_args, **_kwargs):
            if self.action == "update":
                self.selected_after_update = True
            return self

        def eq(self, field, value):
            self.filters[field] = value
            return self

        def is_(self, field, _value):
            self.filters[field] = None
            return self

        def order(self, *_args, **_kwargs):
            return self

        def limit(self, *_args, **_kwargs):
            return self

        def update(self, values):
            self.action = "update"
            self.update_values = values
            return self

        def execute(self):
            if self.action == "select":
                matches = self.filters.get("phone") == challenge["phone"] and challenge["used_at"] is None
                return SimpleNamespace(data=[challenge.copy()] if matches else [])
            if challenge["verified_at"] is not None or challenge["used_at"] is not None:
                return SimpleNamespace(data=[])
            challenge.update(self.update_values or {})
            return SimpleNamespace(data=[{"id": challenge["id"]}] if self.selected_after_update else [])

    class FakeSupabase:
        def table(self, table_name):
            assert table_name == "password_reset_challenges"
            return FakeTable()

    async def verify_token(_self, _token):
        calls["provider_verify"] += 1
        return {"type": "success", "message": challenge["phone"]}

    monkeypatch.setattr(password_reset_service, "supabase", FakeSupabase())
    monkeypatch.setattr(password_reset_service.MSG91Service, "verify_access_token", verify_token)

    authorization = await password_reset_service.PasswordResetService.verify_provider_token(
        challenge["phone"], "provider-token"
    )

    assert authorization
    with pytest.raises(ValueError, match="OTP_ALREADY_USED"):
        await password_reset_service.PasswordResetService.verify_provider_token(
            challenge["phone"], "provider-token"
        )
    assert calls["provider_verify"] == 1


@pytest.mark.asyncio
async def test_resend_endpoint_includes_retry_after_seconds(monkeypatch):
    from fastapi import HTTPException
    from app.routers import auth as auth_router
    from app.schemas.auth import ResendOTPSchema
    from app.services.msg91_service import OTPResendCooldown

    monkeypatch.setattr(
        MSG91Service,
        "validate_otp_resend_request",
        staticmethod(lambda *_args: (_ for _ in ()).throw(OTPResendCooldown(18))),
    )

    with pytest.raises(HTTPException) as response:
        await auth_router.resend_otp(ResendOTPSchema(mobile="919876543210", channel="SMS"))

    assert response.value.status_code == 429
    assert response.value.headers["Retry-After"] == "18"


@pytest.mark.asyncio
async def test_password_reset_request_returns_cooldown_without_new_challenge(monkeypatch):
    from app.routers import auth as auth_router
    from app.schemas.auth import PasswordResetRequestSchema

    async def request_otp(_phone):
        return 23

    monkeypatch.setattr(auth_router.PasswordResetService, "request_otp", request_otp)

    result = await auth_router.request_password_reset_otp(
        PasswordResetRequestSchema(phone="919876543210")
    )

    assert result["retry_after_seconds"] == 23


@pytest.mark.asyncio
async def test_password_reset_request_returns_safe_not_found_message(monkeypatch):
    from fastapi import HTTPException
    from app.routers import auth as auth_router
    from app.schemas.auth import PasswordResetRequestSchema

    async def request_otp(_phone):
        raise ValueError("MOBILE_NOT_FOUND")

    monkeypatch.setattr(auth_router.PasswordResetService, "request_otp", request_otp)

    with pytest.raises(HTTPException) as response:
        await auth_router.request_password_reset_otp(
            PasswordResetRequestSchema(phone="919876543210")
        )

    assert response.value.status_code == 404
    assert response.value.detail == "Mobile number not found. Please register first."


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

    monkeypatch.setattr(auth_router.settings, "ENVIRONMENT", "production")
    existing = application_user("WORKER")
    monkeypatch.setattr(AuthService, "normalize_mobile", staticmethod(lambda mobile: "919999999999"))
    monkeypatch.setattr(AuthService, "get_user_by_mobile", staticmethod(lambda mobile: existing))
    verified = {}

    async def verify_access_token_for_mobile(self, token, mobile):
        verified["args"] = (token, mobile)
        return {"type": "success", "message": mobile}

    monkeypatch.setattr(MSG91Service, "verify_access_token_for_mobile", verify_access_token_for_mobile)
    monkeypatch.setattr(auth_router.OnboardingService, "determine_next_step", staticmethod(lambda user: "WORKER_PROFILE"))
    monkeypatch.setattr(AuthService, "ensure_role_allowed", staticmethod(lambda existing_user, requested_role: (_ for _ in ()).throw(AssertionError("login must not validate an entry-point role"))))

    response = Response()
    result = await auth_router.login_msg91(
        {"mobile": "+91 9999999999", "msg91_access_token": "verified-token"},
        response,
    )

    assert result["user"].role == "WORKER"
    assert result["next_step"] == "WORKER_PROFILE"
    assert verified["args"] == ("verified-token", "919999999999")
    cookie = response.headers.get("set-cookie", "").lower()
    assert "goleska_session" in cookie
    assert "samesite=none" in cookie
    assert "secure" in cookie


@pytest.mark.asyncio
async def test_msg91_login_rejects_inactive_user_before_cookie(monkeypatch):
    from fastapi import HTTPException
    from app.routers import auth as auth_router

    existing = application_user("WORKER")
    existing["is_active"] = False
    monkeypatch.setattr(AuthService, "get_user_by_mobile", staticmethod(lambda _mobile: existing))

    async def verify_access_token_for_mobile(_self, _token, mobile):
        return {"type": "success", "message": mobile}

    monkeypatch.setattr(
        auth_router.MSG91Service,
        "verify_access_token_for_mobile",
        verify_access_token_for_mobile,
    )
    response = Response()

    with pytest.raises(HTTPException) as error:
        await auth_router.login_msg91(
            {"mobile": existing["mobile"], "msg91_access_token": "verified-token"},
            response,
        )

    assert error.value.status_code == 401
    assert error.value.detail == "User inactive"
    assert response.headers.get("set-cookie") is None
    assert existing["is_active"] is False


@pytest.mark.asyncio
async def test_complete_msg91_binds_verified_phone_before_provisioning(monkeypatch):
    from app.routers import auth as auth_router

    existing = application_user("WORKER")
    verified = {}
    monkeypatch.setattr(auth_router.settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(AuthService, "normalize_mobile", staticmethod(lambda _mobile: "919999999999"))
    monkeypatch.setattr(AuthService, "get_user_by_mobile", staticmethod(lambda _mobile: existing))
    monkeypatch.setattr(AuthService, "ensure_role_allowed", staticmethod(lambda *_args: None))

    async def verify_access_token_for_mobile(self, token, mobile):
        verified["args"] = (token, mobile)
        return {"type": "success", "message": mobile}

    monkeypatch.setattr(MSG91Service, "verify_access_token_for_mobile", verify_access_token_for_mobile)
    monkeypatch.setattr(AuthService, "create_or_update_user", staticmethod(lambda **_kwargs: existing))
    monkeypatch.setattr(auth_router.OnboardingService, "determine_next_step", staticmethod(lambda _user: "DASHBOARD"))

    response = Response()
    result = await auth_router.complete_msg91(
        {
            "mobile": "+91 9999999999",
            "name": "Test User",
            "role": "WORKER",
            "msg91_access_token": "verified-token",
        },
        response,
    )

    assert verified["args"] == ("verified-token", "919999999999")
    assert result["next_step"] == "DASHBOARD"


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
        intent="login",
    )

    assert calls["role"] == "EMPLOYER"
    assert result.role == "EMPLOYER"
    assert existing["is_active"] is True


@pytest.mark.asyncio
async def test_login_provisioning_rejects_inactive_user_without_reactivation(monkeypatch):
    from fastapi import HTTPException
    from app.routers import auth as auth_router
    from app.schemas.auth import ProvisionUserSchema

    existing = application_user("WORKER")
    existing["is_active"] = False
    fake_supabase = SimpleNamespace(
        auth=SimpleNamespace(
            get_user=lambda _token: SimpleNamespace(
                user=SimpleNamespace(
                    id=existing["id"],
                    email=existing["email"],
                    phone=existing["mobile"],
                    user_metadata={},
                )
            )
        )
    )
    monkeypatch.setattr(auth_router, "supabase", fake_supabase)
    monkeypatch.setattr(AuthService, "get_user_by_id", staticmethod(lambda _user_id: existing))
    monkeypatch.setattr(
        AuthService,
        "provision_supabase_user",
        staticmethod(lambda **_kwargs: pytest.fail("inactive login must not provision")),
    )

    with pytest.raises(HTTPException) as error:
        await auth_router.provision_authenticated_user(
            ProvisionUserSchema(name="", mobile=None, role=None),
            SimpleNamespace(credentials="supabase-token"),
            intent="login",
        )

    assert error.value.status_code == 401
    assert error.value.detail == "User inactive"
    assert existing["is_active"] is False
