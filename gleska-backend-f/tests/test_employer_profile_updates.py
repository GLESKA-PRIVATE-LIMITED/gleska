import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from app.main import app
from app.core.security import require_employer
from app.schemas.auth import UserResponse

client = TestClient(app)

from datetime import datetime

mock_employer_user = UserResponse(
    id="user-123",
    email="employer@example.com",
    mobile="+919876543210",
    name="Test Employer",
    role="EMPLOYER",
    is_mobile_verified=True,
    is_active=True,
    created_at=datetime(2026, 1, 1),
    updated_at=datetime(2026, 1, 1),
)


@pytest.fixture(autouse=True)
def override_auth():
    app.dependency_overrides[require_employer] = lambda: mock_employer_user
    yield
    app.dependency_overrides.clear()


def test_update_company_profile():
    with patch("app.routers.employers.supabase") as mock_supabase:
        mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
            "id": "emp-123",
            "user_id": "user-123",
            "employer_type": "REGISTERED_BUSINESS",
            "onboarding_status": "COMPLETED",
            "verification_status": "VERIFIED",
            "contact_person_name": "Test Employer",
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
        }

        mock_supabase.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [{
            "id": "det-123",
            "employer_id": "emp-123",
            "business_name": "Old Business",
            "company_email": "old@example.com",
            "company_phone": "+919876543210",
            "address": "Old Address",
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
        }]

        mock_supabase.table.return_value.upsert.return_value.execute.return_value.data = [{
            "id": "det-123",
            "employer_id": "emp-123",
            "business_name": "Updated Business Pvt Ltd",
            "company_email": "updated@example.com",
            "company_phone": "+919876543210",
            "address": "New Address 123",
            "gstin": "27AAAAA0000A1Z5",
            "cin_number": "U72200MH2024PTC123456",
            "pan_number": "ABCDE1234F",
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
        }]

        response = client.put(
            "/api/v1/employers/company-profile",
            json={
                "business_name": "Updated Business Pvt Ltd",
                "company_email": "updated@example.com",
                "address": "New Address 123",
                "gstin": "27AAAAA0000A1Z5",
                "cin_number": "U72200MH2024PTC123456",
                "pan_number": "ABCDE1234F",
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["business_name"] == "Updated Business Pvt Ltd"
        assert data["company_email"] == "updated@example.com"
        assert data["address"] == "New Address 123"


def test_update_director_profile():
    with patch("app.routers.employers.supabase") as mock_supabase:
        mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
            "id": "emp-123",
            "user_id": "user-123",
            "employer_type": "REGISTERED_BUSINESS",
            "onboarding_status": "COMPLETED",
            "verification_status": "VERIFIED",
            "contact_person_name": "Old Director",
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
        }

        mock_supabase.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [{
            "id": "det-123",
            "employer_id": "emp-123",
            "director_name": "Old Director",
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
        }]

        mock_supabase.table.return_value.upsert.return_value.execute.return_value.data = [{
            "id": "det-123",
            "employer_id": "emp-123",
            "director_name": "Jane Doe",
            "director_email": "jane@example.com",
            "director_phone": "+919876543210",
            "director_address": "456 Director St",
            "director_aadhaar": "123456789012",
            "pan_number": "ABCDE1234F",
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
        }]

        mock_supabase.table.return_value.update.return_value.eq.return_value.execute.return_value.data = [{
            "id": "emp-123",
            "contact_person_name": "Jane Doe",
        }]

        response = client.put(
            "/api/v1/employers/director-profile",
            json={
                "director_name": "Jane Doe",
                "director_email": "jane@example.com",
                "director_phone": "+919876543210",
                "director_address": "456 Director St",
                "director_aadhaar": "123456789012",
                "director_pan": "ABCDE1234F",
                "director_din": "01234567",
                "director_blood_group": "O+",
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["director_name"] == "Jane Doe"
        assert data["director_email"] == "jane@example.com"


def test_get_employer_profile_verification_status_alignment():
    with patch("app.routers.employers.supabase") as mock_supabase, \
         patch("app.routers.employers.VerificationService.calculate_overall_status") as mock_calc:
        
        mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
            "id": "emp-123",
            "user_id": "user-123",
            "employer_type": "REGISTERED_BUSINESS",
            "onboarding_status": "COMPLETED",
            "verification_status": "PENDING",  # In DB it was pending
            "contact_person_name": "Test Employer",
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
        }

        mock_supabase.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [{
            "id": "det-123",
            "employer_id": "emp-123",
            "business_name": "Test Business",
        }]

        mock_calc.return_value = "VERIFIED"

        mock_supabase.table.return_value.update.return_value.eq.return_value.execute.return_value.data = [{
            "id": "emp-123",
            "verification_status": "VERIFIED",
        }]

        response = client.get("/api/v1/employers/me")
        assert response.status_code == 200
        data = response.json()
        assert data["verification_status"] == "VERIFIED"
