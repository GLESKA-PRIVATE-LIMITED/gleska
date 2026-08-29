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
         patch("app.routers.auth.MSG91Service.verify_access_token", new_callable=AsyncMock, return_value={"type": "success"}), \
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

            # Verify admin.create_user called with user_metadata containing terms
            admin_call = mock_admin.create_user.call_args[0][0]
            assert admin_call["user_metadata"]["terms_accepted"] is True
            assert "terms_accepted_at" in admin_call["user_metadata"]

            # Verify AuthService.provision_supabase_user called with terms_accepted=True
            provision_kwargs = mock_provision.call_args[1]
            assert provision_kwargs["terms_accepted"] is True
            assert "terms_accepted_at" in provision_kwargs
