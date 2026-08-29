"""Tests for Contact Us inquiry submission and Resend email integration."""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from httpx import AsyncClient, ASGITransport, Response, TimeoutException, RequestError

from app.main import app
from app.core.config import settings
from app.services.email_service import EmailService, RESEND_API_URL
from app.services.contact_service import ContactService


# =====================================================================
# EmailService Unit Tests
# =====================================================================

@pytest.mark.asyncio
async def test_email_service_success():
    """Test EmailService correctly formats payload and sends via Resend."""
    mock_response = Response(
        status_code=200,
        json={"id": "email_resend_999"},
        request=MagicMock(),
    )

    mock_client = AsyncMock()
    mock_client.post.return_value = mock_response
    mock_client.__aenter__.return_value = mock_client
    mock_client.__aexit__.return_value = None

    with patch("app.services.email_service.httpx.AsyncClient", return_value=mock_client):
        result = await EmailService.send_contact_inquiry(
            name="John Doe",
            company="Acme Corp",
            sender_email="john@example.com",
            message="We need 10 industrial welders.",
        )

    assert result["success"] is True
    assert result["id"] == "email_resend_999"
    assert result["recipient"] == settings.CONTACT_RECIPIENT_EMAIL

    # Check payload sent to Resend
    mock_client.post.assert_called_once()
    call_args = mock_client.post.call_args
    assert call_args[0][0] == RESEND_API_URL
    payload = call_args[1]["json"]
    headers = call_args[1]["headers"]

    assert payload["to"] == [settings.CONTACT_RECIPIENT_EMAIL]
    assert payload["reply_to"] == "john@example.com"
    assert "New Business Inquiry — John Doe" in payload["subject"]
    assert f"<{settings.EMAIL_FROM_ADDRESS}>" in payload["from"]
    assert "Name: John Doe" in payload["text"]
    assert "Company: Acme Corp" in payload["text"]
    assert "Email: john@example.com" in payload["text"]
    assert "We need 10 industrial welders." in payload["text"]

    assert headers["Authorization"] == f"Bearer {settings.RESEND_API_KEY}"
    assert headers["Content-Type"] == "application/json"


@pytest.mark.asyncio
async def test_email_service_provider_error_raises():
    """Test EmailService raises RuntimeError on Resend 4xx/5xx errors."""
    mock_response = Response(
        status_code=403,
        json={"statusCode": 403, "name": "validation_error", "message": "Domain not verified"},
        request=MagicMock(),
    )

    mock_client = AsyncMock()
    mock_client.post.return_value = mock_response
    mock_client.__aenter__.return_value = mock_client
    mock_client.__aexit__.return_value = None

    with patch("app.services.email_service.httpx.AsyncClient", return_value=mock_client):
        with pytest.raises(RuntimeError, match="Resend email sending failed.*Domain not verified"):
            await EmailService.send_contact_inquiry(
                name="John Doe",
                company=None,
                sender_email="john@example.com",
                message="We need workers.",
            )


@pytest.mark.asyncio
async def test_email_service_timeout_raises():
    """Test EmailService raises RuntimeError on request timeout."""
    mock_client = AsyncMock()
    mock_client.post.side_effect = TimeoutException("Connection timed out")
    mock_client.__aenter__.return_value = mock_client
    mock_client.__aexit__.return_value = None

    with patch("app.services.email_service.httpx.AsyncClient", return_value=mock_client):
        with pytest.raises(RuntimeError, match="Resend API request timed out"):
            await EmailService.send_contact_inquiry(
                name="John Doe",
                company=None,
                sender_email="john@example.com",
                message="We need workers.",
            )


@pytest.mark.asyncio
async def test_email_service_missing_config():
    """Test EmailService raises ValueError when configuration is missing."""
    with patch.object(settings, "RESEND_API_KEY", ""):
        with pytest.raises(ValueError, match="RESEND_API_KEY_NOT_CONFIGURED"):
            await EmailService.send_contact_inquiry(
                name="Test",
                company=None,
                sender_email="test@example.com",
                message="Valid inquiry message",
            )

    with patch.object(settings, "CONTACT_RECIPIENT_EMAIL", ""):
        with pytest.raises(ValueError, match="CONTACT_RECIPIENT_EMAIL_NOT_CONFIGURED"):
            await EmailService.send_contact_inquiry(
                name="Test",
                company=None,
                sender_email="test@example.com",
                message="Valid inquiry message",
            )

    with patch.object(settings, "EMAIL_FROM_ADDRESS", ""):
        with pytest.raises(ValueError, match="EMAIL_FROM_ADDRESS_NOT_CONFIGURED"):
            await EmailService.send_contact_inquiry(
                name="Test",
                company=None,
                sender_email="test@example.com",
                message="Valid inquiry message",
            )


# =====================================================================
# ContactService Unit Tests
# =====================================================================

@pytest.mark.asyncio
async def test_contact_service_success_updates_status_sent():
    """Test ContactService persists inquiry and updates status to SENT on email success."""
    mock_db_insert = MagicMock()
    mock_db_insert.data = [{"id": "11111111-2222-3333-4444-555555555555"}]

    mock_supabase_table = MagicMock()
    mock_supabase_table.insert.return_value.execute.return_value = mock_db_insert
    mock_supabase_table.update.return_value.eq.return_value.execute.return_value = MagicMock()

    with patch("app.services.contact_service.supabase.table", return_value=mock_supabase_table), \
         patch("app.services.contact_service.EmailService.send_contact_inquiry", new_callable=AsyncMock) as mock_send:
        
        mock_send.return_value = {"success": True, "id": "resend_123"}

        result = await ContactService.submit_inquiry(
            name="Samiksha",
            company="Test Company",
            email="test@example.com",
            message="We need workers for our business.",
        )

    assert result["success"] is True
    assert result["inquiry_id"] == "11111111-2222-3333-4444-555555555555"
    assert "Your inquiry has been received" in result["message"]

    # Verify initial insert has PENDING
    insert_call = mock_supabase_table.insert.call_args[0][0]
    assert insert_call["email_status"] == "PENDING"
    assert insert_call["name"] == "Samiksha"
    assert insert_call["company"] == "Test Company"
    assert insert_call["email"] == "test@example.com"

    # Verify status updated to SENT
    mock_supabase_table.update.assert_called_with({"email_status": "SENT"})


@pytest.mark.asyncio
async def test_contact_service_email_failure_updates_status_failed():
    """Test ContactService updates status to FAILED when email fails, preserving inquiry."""
    mock_db_insert = MagicMock()
    mock_db_insert.data = [{"id": "22222222-3333-4444-5555-666666666666"}]

    mock_supabase_table = MagicMock()
    mock_supabase_table.insert.return_value.execute.return_value = mock_db_insert
    mock_supabase_table.update.return_value.eq.return_value.execute.return_value = MagicMock()

    with patch("app.services.contact_service.supabase.table", return_value=mock_supabase_table), \
         patch("app.services.contact_service.EmailService.send_contact_inquiry", new_callable=AsyncMock) as mock_send:
        
        mock_send.side_effect = RuntimeError("Resend API rejected: 403 Forbidden")

        result = await ContactService.submit_inquiry(
            name="Samiksha",
            company=None,
            email="test@example.com",
            message="We need workers for our business.",
        )

    # Response is still successful because inquiry was stored
    assert result["success"] is True
    assert result["inquiry_id"] == "22222222-3333-4444-5555-666666666666"

    # Verify status updated to FAILED
    mock_supabase_table.update.assert_called_with({"email_status": "FAILED"})


# =====================================================================
# Router / API Endpoint Integration Tests
# =====================================================================

@pytest.mark.asyncio
async def test_api_contact_endpoint_success():
    """Test POST /api/v1/contact endpoint successfully returns 201."""
    with patch("app.routers.contact.ContactService.submit_inquiry", new_callable=AsyncMock) as mock_submit:
        mock_submit.return_value = {
            "success": True,
            "message": "Your inquiry has been received. We will respond within 4 hours.",
            "inquiry_id": "test-uuid-12345",
        }

        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as ac:
            response = await ac.post("/api/v1/contact", json={
                "name": "Samiksha",
                "company": "Gleska Test",
                "email": "samiksha@example.com",
                "message": "We need workers for our business.",
            })

    assert response.status_code == 201
    data = response.json()
    assert data["success"] is True
    assert data["inquiry_id"] == "test-uuid-12345"
    assert "Your inquiry has been received" in data["message"]


@pytest.mark.asyncio
async def test_api_contact_endpoint_validations():
    """Test POST /api/v1/contact endpoint validation errors."""
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        # Invalid email format
        res1 = await ac.post("/api/v1/contact", json={
            "name": "Samiksha",
            "email": "not-an-email",
            "message": "We need workers for our business.",
        })
        assert res1.status_code == 422

        # Missing name
        res2 = await ac.post("/api/v1/contact", json={
            "email": "valid@example.com",
            "message": "We need workers for our business.",
        })
        assert res2.status_code == 422

        # Missing message
        res3 = await ac.post("/api/v1/contact", json={
            "name": "Samiksha",
            "email": "valid@example.com",
        })
        assert res3.status_code == 422

        # Message too short (< 10 chars)
        res4 = await ac.post("/api/v1/contact", json={
            "name": "Samiksha",
            "email": "valid@example.com",
            "message": "Too short",
        })
        assert res4.status_code == 422

