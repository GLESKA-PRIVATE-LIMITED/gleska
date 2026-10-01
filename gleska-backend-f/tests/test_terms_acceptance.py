"""Tests for mandatory Terms & Conditions acceptance during signup."""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from httpx import AsyncClient, ASGITransport
from datetime import datetime

from app.main import app
from app.services.auth_service import AuthService
from app.schemas.auth import SignupPreflightSchema, MobileVerifiedSignupSchema, UserResponse


# =====================================================================
# Schema & Backend Validation Tests
# =====================================================================

def test_signup_preflight_schema_requires_terms_accepted():
    """Verify schema rejects missing, False, or None terms_accepted."""
    # terms_accepted = True -> Valid
    valid_data = {
        "email": "user@example.com",
        "mobile": "9876543210",
        "role": "WORKER",
        "name": "Test User",
        "password": "Password123!",
        "confirm_password": "Password123!",
        "terms_accepted": True,
    }
    schema = SignupPreflightSchema(**valid_data)
    assert schema.terms_accepted is True

    # terms_accepted = False -> Rejects with ValueError
    with pytest.raises(ValueError, match="Terms & Conditions must be accepted"):
        SignupPreflightSchema(**{**valid_data, "terms_accepted": False})

    # terms_accepted missing -> Rejects with Pydantic validation error
    invalid_missing = {k: v for k, v in valid_data.items() if k != "terms_accepted"}
    with pytest.raises(ValueError):
        SignupPreflightSchema(**invalid_missing)

    # terms_accepted = None -> Rejects with Pydantic validation error
    with pytest.raises(ValueError):
        SignupPreflightSchema(**{**valid_data, "terms_accepted": None})


def test_mobile_verified_signup_schema_requires_terms_accepted():
    """Verify MobileVerifiedSignupSchema enforces terms_accepted."""
    valid_data = {
        "email": "employer@example.com",
        "mobile": "9876543210",
        "role": "EMPLOYER",
        "name": "Employer User",
        "password": "Password123!",
        "confirm_password": "Password123!",
        "msg91_access_token": "valid_token_xyz",
        "terms_accepted": True,
    }
    schema = MobileVerifiedSignupSchema(**valid_data)
    assert schema.terms_accepted is True

    with pytest.raises(ValueError, match="Terms & Conditions must be accepted"):
        MobileVerifiedSignupSchema(**{**valid_data, "terms_accepted": False})

    invalid_missing = {k: v for k, v in valid_data.items() if k != "terms_accepted"}
    with pytest.raises(ValueError):
        MobileVerifiedSignupSchema(**invalid_missing)


# =====================================================================
# Router / API Endpoint Tests
# =====================================================================

@pytest.mark.asyncio
async def test_signup_preflight_endpoint_rejects_without_terms():
    """POST /api/v1/auth/signup-preflight must reject missing or false terms_accepted."""
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        # Case 1: terms_accepted missing
        res_missing = await ac.post("/api/v1/auth/signup-preflight", json={
            "name": "Test User",
            "email": "test@example.com",
            "mobile": "9876543210",
            "password": "Password123!",
            "confirm_password": "Password123!",
            "role": "WORKER",
        })
        assert res_missing.status_code == 422

        # Case 2: terms_accepted is False
        res_false = await ac.post("/api/v1/auth/signup-preflight", json={
            "name": "Test User",
            "email": "test@example.com",
            "mobile": "9876543210",
            "password": "Password123!",
            "confirm_password": "Password123!",
            "role": "WORKER",
            "terms_accepted": False,
        })
        assert res_false.status_code == 422

        # Case 3: terms_accepted is None
        res_null = await ac.post("/api/v1/auth/signup-preflight", json={
            "name": "Test User",
            "email": "test@example.com",
            "mobile": "9876543210",
            "password": "Password123!",
            "confirm_password": "Password123!",
            "role": "WORKER",
            "terms_accepted": None,
        })
        assert res_null.status_code == 422


@pytest.mark.asyncio
async def test_signup_preflight_endpoint_accepts_valid_terms():
    """POST /api/v1/auth/signup-preflight succeeds when terms_accepted is True."""
    with patch.object(AuthService, "get_user_by_email", return_value=None), \
         patch.object(AuthService, "get_user_by_mobile", return_value=None):
        
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as ac:
            res = await ac.post("/api/v1/auth/signup-preflight", json={
                "name": "Test User",
                "email": "brandnewuser@example.com",
                "mobile": "9876543210",
                "password": "Password123!",
                "confirm_password": "Password123!",
                "role": "WORKER",
                "terms_accepted": True,
            })
            assert res.status_code == 200
            assert res.json()["available"] is True


@pytest.mark.asyncio
async def test_signup_preflight_rejects_complete_existing_account(monkeypatch):
    from app.routers import auth as auth_router
    from types import SimpleNamespace

    existing_user = {"id": "complete-user-id", "role": "WORKER"}
    profile_query = MagicMock()
    profile_query.select.return_value = profile_query
    profile_query.eq.return_value = profile_query
    profile_query.limit.return_value = profile_query
    profile_query.execute.return_value = SimpleNamespace(data=[{"id": "profile-id"}])
    monkeypatch.setattr(AuthService, "get_user_by_email", staticmethod(lambda _email: existing_user))
    monkeypatch.setattr(AuthService, "get_user_by_mobile", staticmethod(lambda _mobile: existing_user))
    monkeypatch.setattr(auth_router.supabase, "table", lambda _table_name: profile_query)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/v1/auth/signup-preflight", json={
            "name": "Existing User",
            "email": "existing@example.com",
            "mobile": "9876543210",
            "password": "Password123!",
            "confirm_password": "Password123!",
            "role": "WORKER",
            "terms_accepted": True,
        })

    assert response.status_code == 409
    assert response.json()["detail"] == "An account already exists with this email or mobile number. Please login instead."


@pytest.mark.asyncio
async def test_signup_mobile_verified_endpoint_rejects_without_terms():
    """POST /api/v1/auth/signup-mobile-verified must reject missing or false terms_accepted."""
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        # Case 1: Missing terms_accepted
        res_missing = await ac.post("/api/v1/auth/signup-mobile-verified", json={
            "name": "Test User",
            "email": "test@example.com",
            "mobile": "9876543210",
            "password": "Password123!",
            "confirm_password": "Password123!",
            "role": "EMPLOYER",
            "msg91_access_token": "valid_token",
        })
        assert res_missing.status_code == 422

        # Case 2: terms_accepted is False
        res_false = await ac.post("/api/v1/auth/signup-mobile-verified", json={
            "name": "Test User",
            "email": "test@example.com",
            "mobile": "9876543210",
            "password": "Password123!",
            "confirm_password": "Password123!",
            "role": "EMPLOYER",
            "msg91_access_token": "valid_token",
            "terms_accepted": False,
        })
        assert res_false.status_code == 422


@pytest.mark.asyncio
async def test_signup_mobile_verified_endpoint_stores_terms_server_side():
    """POST /api/v1/auth/signup-mobile-verified stores terms_accepted and server-side timestamp."""
    mock_auth_user = MagicMock()
    mock_auth_user.id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    
    mock_admin = MagicMock()
    mock_admin.create_user.return_value = MagicMock(user=mock_auth_user)

    mock_provisioned_user = {
        "id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        "name": "New Employer",
        "email": "newemp@example.com",
        "mobile": "919876543210",
        "role": "EMPLOYER",
        "is_mobile_verified": True,
        "is_active": True,
        "terms_accepted": True,
        "terms_accepted_at": "2026-08-29T13:00:00+00:00",
        "created_at": "2026-08-29T13:00:00+00:00",
        "updated_at": "2026-08-29T13:00:00+00:00",
    }

    with patch.object(AuthService, "get_user_by_email", return_value=None), \
         patch.object(AuthService, "get_user_by_mobile", return_value=None), \
         patch("app.routers.auth.MSG91Service.verify_access_token_for_mobile", new_callable=AsyncMock, return_value={"type": "success", "message": "919876543210"}) as verify_mobile, \
         patch("app.routers.auth.supabase.auth.admin", mock_admin), \
         patch.object(AuthService, "provision_supabase_user", return_value=mock_provisioned_user) as mock_provision:
        
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as ac:
            res = await ac.post("/api/v1/auth/signup-mobile-verified", json={
                "name": "New Employer",
                "email": "newemp@example.com",
                "mobile": "9876543210",
                "password": "Password123!",
                "confirm_password": "Password123!",
                "role": "EMPLOYER",
                "msg91_access_token": "valid_token",
                "terms_accepted": True,
            })

            assert res.status_code == 200
            data = res.json()
            assert data["id"] == "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
            assert data["terms_accepted"] is True
            verify_mobile.assert_awaited_once_with("valid_token", "919876543210")

            # Verify admin.create_user called with user_metadata containing terms
            admin_call = mock_admin.create_user.call_args[0][0]
            assert admin_call["user_metadata"]["terms_accepted"] is True
            assert "terms_accepted_at" in admin_call["user_metadata"]

            # Verify AuthService.provision_supabase_user called with terms_accepted=True
            provision_kwargs = mock_provision.call_args[1]
            assert provision_kwargs["terms_accepted"] is True
            assert "terms_accepted_at" in provision_kwargs


@pytest.mark.asyncio
async def test_signup_rejects_msg91_phone_mismatch_before_user_creation(monkeypatch):
    from app.routers import auth as auth_router

    monkeypatch.setattr(
        auth_router.MSG91Service,
        "verify_access_token_for_mobile",
        AsyncMock(side_effect=ValueError("MSG91_MOBILE_MISMATCH")),
    )
    monkeypatch.setattr(
        AuthService,
        "get_user_by_email",
        staticmethod(lambda _email: (_ for _ in ()).throw(AssertionError("duplicate lookup must not run"))),
    )
    monkeypatch.setattr(
        auth_router.supabase.auth.admin,
        "create_user",
        MagicMock(side_effect=AssertionError("Auth identity must not be created")),
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/v1/auth/signup-mobile-verified", json={
            "name": "Phone Mismatch",
            "email": "phone-mismatch@example.com",
            "mobile": "9876543210",
            "password": "Password123!",
            "confirm_password": "Password123!",
            "role": "WORKER",
            "msg91_access_token": "verified-token",
            "terms_accepted": True,
        })

    assert response.status_code == 401
    assert response.json()["detail"] == "MSG91_MOBILE_MISMATCH"


@pytest.mark.asyncio
@pytest.mark.parametrize("duplicate_field", ["email", "mobile"])
async def test_signup_mobile_verified_reports_public_user_duplicates(monkeypatch, duplicate_field):
    from app.routers import auth as auth_router

    monkeypatch.setattr(
        auth_router.MSG91Service,
        "verify_access_token_for_mobile",
        AsyncMock(return_value={"type": "success", "message": "919876543210"}),
    )
    monkeypatch.setattr(
        AuthService,
        "get_user_by_email",
        staticmethod(lambda _email: {"id": "existing-id"} if duplicate_field == "email" else None),
    )
    monkeypatch.setattr(
        AuthService,
        "get_user_by_mobile",
        staticmethod(lambda _mobile: {"id": "existing-id"} if duplicate_field == "mobile" else None),
    )
    monkeypatch.setattr(auth_router.supabase.auth.admin, "create_user", MagicMock(side_effect=AssertionError("must not create Auth user")))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/v1/auth/signup-mobile-verified", json={
            "name": "Existing User",
            "email": "existing@example.com",
            "mobile": "9876543210",
            "password": "Password123!",
            "confirm_password": "Password123!",
            "role": "WORKER",
            "msg91_access_token": "verified-token",
            "terms_accepted": True,
        })

    assert response.status_code == 409
    assert response.json()["detail"] == "An account already exists with this email or mobile number. Please login instead."


@pytest.mark.asyncio
async def test_signup_auth_existing_email_returns_controlled_auth_conflict(monkeypatch):
    from app.routers import auth as auth_router

    monkeypatch.setattr(
        auth_router.MSG91Service,
        "verify_access_token_for_mobile",
        AsyncMock(return_value={"type": "success", "message": "919876543210"}),
    )
    monkeypatch.setattr(AuthService, "get_user_by_email", staticmethod(lambda _email: None))
    monkeypatch.setattr(AuthService, "get_user_by_mobile", staticmethod(lambda _mobile: None))
    create_user = MagicMock(
        side_effect=RuntimeError("A user with this email address has already been registered")
    )
    monkeypatch.setattr(auth_router.supabase.auth.admin, "create_user", create_user)
    delete_user = MagicMock()
    monkeypatch.setattr(auth_router.supabase.auth.admin, "delete_user", delete_user)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/v1/auth/signup-mobile-verified", json={
            "name": "Auth Only User",
            "email": "auth-only@example.com",
            "mobile": "9876543210",
            "password": "Password123!",
            "confirm_password": "Password123!",
            "role": "WORKER",
            "msg91_access_token": "verified-token",
            "terms_accepted": True,
        })

    assert response.status_code == 409
    assert response.json()["detail"] == "An authentication account already exists for this email. Sign in to restore your GLESKA profile."
    delete_user.assert_not_called()


@pytest.mark.asyncio
async def test_signup_reuses_matching_auth_identity_before_create(monkeypatch):
    from app.routers import auth as auth_router

    auth_identity = MagicMock(
        id="auth-only-id",
        email="auth-only@example.com",
        phone=None,
        user_metadata={"mobile": "919876543210"},
    )
    admin = MagicMock()
    admin.list_users.return_value = [auth_identity]
    monkeypatch.setattr(auth_router.supabase.auth, "admin", admin)
    monkeypatch.setattr(
        auth_router.MSG91Service,
        "verify_access_token_for_mobile",
        AsyncMock(return_value={"type": "success", "message": "919876543210"}),
    )
    monkeypatch.setattr(AuthService, "get_user_by_email", staticmethod(lambda _email: None))
    monkeypatch.setattr(AuthService, "get_user_by_mobile", staticmethod(lambda _mobile: None))
    monkeypatch.setattr(AuthService, "provision_supabase_user", staticmethod(lambda **_kwargs: {
        "id": "auth-only-id",
        "name": "Recovered User",
        "email": "auth-only@example.com",
        "mobile": "919876543210",
        "role": "WORKER",
        "is_mobile_verified": True,
        "is_active": True,
        "created_at": "2026-08-29T13:00:00+00:00",
        "updated_at": "2026-08-29T13:00:00+00:00",
    }))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/v1/auth/signup-mobile-verified", json={
            "name": "Recovered User",
            "email": "auth-only@example.com",
            "mobile": "9876543210",
            "password": "Password123!",
            "confirm_password": "Password123!",
            "role": "WORKER",
            "msg91_access_token": "verified-token",
            "terms_accepted": True,
        })

    assert response.status_code == 200
    assert response.json()["id"] == "auth-only-id"
    admin.create_user.assert_not_called()
    admin.update_user_by_id.assert_called_once_with("auth-only-id", {"password": "Password123!"})
    admin.delete_user.assert_not_called()


@pytest.mark.asyncio
async def test_signup_recovers_incomplete_application_user_without_creating_auth(monkeypatch):
    from app.routers import auth as auth_router
    from types import SimpleNamespace

    existing_user = {
        "id": "partial-user-id",
        "role": "WORKER",
        "email": "partial@example.com",
        "mobile": "919876543210",
    }
    auth_identity = MagicMock(id="partial-user-id", email="partial@example.com")
    admin = MagicMock()
    admin.get_user_by_id.return_value = auth_identity
    monkeypatch.setattr(auth_router.supabase.auth, "admin", admin)
    profile_query = MagicMock()
    profile_query.select.return_value = profile_query
    profile_query.eq.return_value = profile_query
    profile_query.limit.return_value = profile_query
    profile_query.execute.return_value = SimpleNamespace(data=[])
    monkeypatch.setattr(auth_router.supabase, "table", lambda _table_name: profile_query)
    monkeypatch.setattr(
        auth_router.MSG91Service,
        "verify_access_token_for_mobile",
        AsyncMock(return_value={"type": "success", "message": "919876543210"}),
    )
    monkeypatch.setattr(AuthService, "get_user_by_email", staticmethod(lambda _email: existing_user))
    monkeypatch.setattr(AuthService, "get_user_by_mobile", staticmethod(lambda _mobile: existing_user))
    monkeypatch.setattr(AuthService, "provision_supabase_user", staticmethod(lambda **_kwargs: {
        "id": "partial-user-id",
        "name": "Recovered User",
        "email": "partial@example.com",
        "mobile": "919876543210",
        "role": "WORKER",
        "is_mobile_verified": True,
        "is_active": True,
        "created_at": "2026-08-29T13:00:00+00:00",
        "updated_at": "2026-08-29T13:00:00+00:00",
    }))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/v1/auth/signup-mobile-verified", json={
            "name": "Recovered User",
            "email": "partial@example.com",
            "mobile": "9876543210",
            "password": "Password123!",
            "confirm_password": "Password123!",
            "role": "WORKER",
            "msg91_access_token": "verified-token",
            "terms_accepted": True,
        })

    assert response.status_code == 200
    admin.create_user.assert_not_called()
    admin.update_user_by_id.assert_called_once_with("partial-user-id", {"password": "Password123!"})
    admin.delete_user.assert_not_called()


@pytest.mark.asyncio
async def test_signup_database_provisioning_failure_is_not_reported_as_duplicate(monkeypatch):
    from app.routers import auth as auth_router

    auth_user = MagicMock(id="auth-user-id")
    admin = MagicMock()
    admin.create_user.return_value = MagicMock(user=auth_user)
    monkeypatch.setattr(auth_router.supabase.auth, "admin", admin)
    monkeypatch.setattr(
        auth_router.MSG91Service,
        "verify_access_token_for_mobile",
        AsyncMock(return_value={"type": "success", "message": "919876543210"}),
    )
    monkeypatch.setattr(AuthService, "get_user_by_email", staticmethod(lambda _email: None))
    monkeypatch.setattr(AuthService, "get_user_by_mobile", staticmethod(lambda _mobile: None))
    monkeypatch.setattr(
        AuthService,
        "provision_supabase_user",
        staticmethod(lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("database write failed"))),
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/v1/auth/signup-mobile-verified", json={
            "name": "Provision Failure",
            "email": "provision-failure@example.com",
            "mobile": "9876543210",
            "password": "Password123!",
            "confirm_password": "Password123!",
            "role": "WORKER",
            "msg91_access_token": "verified-token",
            "terms_accepted": True,
        })

    assert response.status_code == 500
    assert response.json()["detail"] == "USER_PROVISIONING_FAILED"
    admin.delete_user.assert_not_called()


@pytest.mark.asyncio
async def test_signup_retry_reuses_auth_identity_after_provisioning_failure(monkeypatch):
    from app.routers import auth as auth_router

    auth_identity = MagicMock(
        id="retry-auth-id",
        email="retry@example.com",
        phone=None,
        user_metadata={"mobile": "919876543210"},
    )
    admin = MagicMock()
    admin.create_user.return_value = MagicMock(user=auth_identity)
    admin.list_users.side_effect = [[], [auth_identity]]
    monkeypatch.setattr(auth_router.supabase.auth, "admin", admin)
    monkeypatch.setattr(
        auth_router.MSG91Service,
        "verify_access_token_for_mobile",
        AsyncMock(return_value={"type": "success", "message": "919876543210"}),
    )
    monkeypatch.setattr(AuthService, "get_user_by_email", staticmethod(lambda _email: None))
    monkeypatch.setattr(AuthService, "get_user_by_mobile", staticmethod(lambda _mobile: None))
    provision = MagicMock(side_effect=[
        RuntimeError("temporary database write failure"),
        {
            "id": "retry-auth-id",
            "name": "Retry User",
            "email": "retry@example.com",
            "mobile": "919876543210",
            "role": "WORKER",
            "is_mobile_verified": True,
            "is_active": True,
            "created_at": "2026-08-29T13:00:00+00:00",
            "updated_at": "2026-08-29T13:00:00+00:00",
        },
    ])
    monkeypatch.setattr(AuthService, "provision_supabase_user", provision)
    payload = {
        "name": "Retry User",
        "email": "retry@example.com",
        "mobile": "9876543210",
        "password": "Password123!",
        "confirm_password": "Password123!",
        "role": "WORKER",
        "msg91_access_token": "verified-token",
        "terms_accepted": True,
    }

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        first_response = await client.post("/api/v1/auth/signup-mobile-verified", json=payload)
        retry_response = await client.post("/api/v1/auth/signup-mobile-verified", json=payload)

    assert first_response.status_code == 500
    assert first_response.json()["detail"] == "USER_PROVISIONING_FAILED"
    assert retry_response.status_code == 200
    assert retry_response.json()["id"] == "retry-auth-id"
    admin.create_user.assert_called_once()
    admin.update_user_by_id.assert_called_once_with("retry-auth-id", {"password": "Password123!"})
    admin.delete_user.assert_not_called()


@pytest.mark.asyncio
async def test_signup_public_identity_unique_race_returns_duplicate_conflict(monkeypatch):
    from app.routers import auth as auth_router

    class PublicEmailUniqueViolation(RuntimeError):
        code = "23505"
        message = 'duplicate key violates constraint "users_email_lower_unique"'

    auth_user = MagicMock(id="auth-user-id")
    admin = MagicMock()
    admin.create_user.return_value = MagicMock(user=auth_user)
    monkeypatch.setattr(auth_router.supabase.auth, "admin", admin)
    monkeypatch.setattr(
        auth_router.MSG91Service,
        "verify_access_token_for_mobile",
        AsyncMock(return_value={"type": "success", "message": "919876543210"}),
    )
    monkeypatch.setattr(AuthService, "get_user_by_email", staticmethod(lambda _email: None))
    monkeypatch.setattr(AuthService, "get_user_by_mobile", staticmethod(lambda _mobile: None))
    monkeypatch.setattr(
        AuthService,
        "provision_supabase_user",
        staticmethod(lambda **_kwargs: (_ for _ in ()).throw(PublicEmailUniqueViolation())),
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/v1/auth/signup-mobile-verified", json={
            "name": "Concurrent Duplicate",
            "email": "raced-email@example.com",
            "mobile": "9876543210",
            "password": "Password123!",
            "confirm_password": "Password123!",
            "role": "WORKER",
            "msg91_access_token": "verified-token",
            "terms_accepted": True,
        })

    assert response.status_code == 409
    assert response.json()["detail"] == "An account already exists with this email or mobile number. Please login instead."
    admin.delete_user.assert_called_once_with("auth-user-id")


@pytest.mark.asyncio
async def test_signup_unexpected_provisioning_value_error_is_not_reported_as_duplicate(monkeypatch):
    from app.routers import auth as auth_router

    auth_user = MagicMock(id="auth-user-id")
    admin = MagicMock()
    admin.create_user.return_value = MagicMock(user=auth_user)
    monkeypatch.setattr(auth_router.supabase.auth, "admin", admin)
    monkeypatch.setattr(
        auth_router.MSG91Service,
        "verify_access_token_for_mobile",
        AsyncMock(return_value={"type": "success", "message": "919876543210"}),
    )
    monkeypatch.setattr(AuthService, "get_user_by_email", staticmethod(lambda _email: None))
    monkeypatch.setattr(AuthService, "get_user_by_mobile", staticmethod(lambda _mobile: None))
    monkeypatch.setattr(
        AuthService,
        "provision_supabase_user",
        staticmethod(lambda **_kwargs: (_ for _ in ()).throw(ValueError("UNEXPECTED_RECONCILIATION_FAILURE"))),
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/v1/auth/signup-mobile-verified", json={
            "name": "Unexpected Provisioning Failure",
            "email": "unexpected-provisioning@example.com",
            "mobile": "9876543210",
            "password": "Password123!",
            "confirm_password": "Password123!",
            "role": "WORKER",
            "msg91_access_token": "verified-token",
            "terms_accepted": True,
        })

    assert response.status_code == 500
    assert response.json()["detail"] == "USER_PROVISIONING_FAILED"
    admin.delete_user.assert_called_once_with("auth-user-id")


@pytest.mark.asyncio
async def test_signup_unexpected_auth_failure_is_not_reported_as_duplicate(monkeypatch):
    from app.routers import auth as auth_router

    admin = MagicMock()
    admin.create_user.side_effect = RuntimeError("auth provider unavailable")
    monkeypatch.setattr(auth_router.supabase.auth, "admin", admin)
    monkeypatch.setattr(
        auth_router.MSG91Service,
        "verify_access_token_for_mobile",
        AsyncMock(return_value={"type": "success", "message": "919876543210"}),
    )
    monkeypatch.setattr(AuthService, "get_user_by_email", staticmethod(lambda _email: None))
    monkeypatch.setattr(AuthService, "get_user_by_mobile", staticmethod(lambda _mobile: None))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/v1/auth/signup-mobile-verified", json={
            "name": "Unexpected Failure",
            "email": "unexpected-failure@example.com",
            "mobile": "9876543210",
            "password": "Password123!",
            "confirm_password": "Password123!",
            "role": "WORKER",
            "msg91_access_token": "verified-token",
            "terms_accepted": True,
        })

    assert response.status_code == 500
    assert response.json()["detail"] == "AUTH_USER_CREATION_FAILED"
