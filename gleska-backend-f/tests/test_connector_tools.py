"""Connector credentials and Hiring-agent connector tools.

Covers the failures found on 2026-11-03: tokens never refreshed, Google grants looked up per
service, email/Teams ignoring the employer's connection, wrong WhatsApp sender, Facebook posting
with a user token, and any tool error ending the agent turn.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs
from uuid import uuid4

import httpx
import pytest
from cryptography.fernet import Fernet

import app.ai_gateway as ai_gateway
from app.agents.hiring.connector_tools import SEND_TEAMS_MESSAGE_TOOL
from app.core.config import settings
from app.routers import connectors as connectors_router
from app.schemas.auth import UserResponse
from app.schemas.hiring_agent import HiringAgentMessageRequest
from app.services import hiring_agent_service
from app.services.connectors import token_store
from app.services.connectors.email_connector_service import EmailConnectorService
from app.services.connectors.gmail_service import GmailService
from app.services.connectors.messaging_service import TeamsService, is_allowed_teams_webhook
from app.services.connectors.oauth_service import credential_group
from app.services.connectors.social_service import SocialMediaService
from app.services.connectors.whatsapp_service import WhatsAppService
from app.services.job_service import JobService

EMPLOYER_ID = "employer-1"


# ── Fakes ──────────────────────────────────────────────────────────────────

class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, db, table):
        self.db, self.table, self.filters, self.op, self.payload = db, table, [], "select", None

    def select(self, *_a, **_k):
        return self

    def eq(self, field, value):
        self.filters.append(lambda row: str(row.get(field)) == str(value))
        return self

    def in_(self, field, values):
        allowed = {str(v) for v in values}
        self.filters.append(lambda row: str(row.get(field)) in allowed)
        return self

    def insert(self, payload):
        self.op, self.payload = "insert", payload
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def upsert(self, payload, on_conflict=None):
        self.op, self.payload = "upsert", payload
        return self

    def execute(self):
        rows = self.db.tables.setdefault(self.table, [])
        if self.op == "insert":
            rows.append(dict(self.payload))
            return _Result([dict(self.payload)])
        if self.op == "upsert":
            for row in rows:
                if row["employer_id"] == self.payload["employer_id"] and row["provider"] == self.payload["provider"]:
                    row.update(self.payload)
                    return _Result([dict(row)])
            rows.append(dict(self.payload))
            return _Result([dict(self.payload)])
        matched = [row for row in rows if all(f(row) for f in self.filters)]
        if self.op == "update":
            for row in matched:
                row.update(self.payload)
        return _Result([dict(row) for row in matched])


class FakeSupabase:
    def __init__(self):
        self.tables: dict[str, list[dict]] = {"connector_tokens": []}

    def table(self, name):
        return _Query(self, name)

    def add_token(self, provider, access_token="tok", **fields):
        row = {
            "employer_id": EMPLOYER_ID,
            "provider": provider,
            "access_token": access_token,
            "refresh_token": None,
            "expires_at": None,
            "status": "active",
            "connected_at": datetime.now(timezone.utc).isoformat(),
            **fields,
        }
        self.tables["connector_tokens"].append(row)
        return row

    def token(self, provider):
        return next(r for r in self.tables["connector_tokens"] if r["provider"] == provider)


@pytest.fixture
def db(monkeypatch):
    fake = FakeSupabase()
    monkeypatch.setattr(token_store, "supabase", fake)
    monkeypatch.setattr(hiring_agent_service, "supabase", fake)
    monkeypatch.setattr(settings, "CONNECTOR_TOKEN_ENCRYPTION_KEY", "")
    return fake


class HttpRecorder:
    """Replaces httpx.AsyncClient so every outbound request is recorded and answered locally."""

    def __init__(self):
        self.requests: list[httpx.Request] = []
        self.routes: dict[tuple[str, str], httpx.Response] = {}

    def route(self, method, url, response):
        self.routes[(method, url)] = response

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        url = f"{request.url.scheme}://{request.url.host}{request.url.path}"
        response = self.routes.get((request.method, url))
        if response is None:
            raise AssertionError(f"unexpected request {request.method} {url}")
        return response

    def hosts(self):
        return [r.url.host for r in self.requests]


@pytest.fixture
def http(monkeypatch):
    recorder = HttpRecorder()
    real_client = httpx.AsyncClient

    class RecordingClient(real_client):
        def __init__(self, *args, **kwargs):
            kwargs["transport"] = httpx.MockTransport(recorder.handler)
            super().__init__(*args, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", RecordingClient)
    return recorder


def _past(hours=2):
    return (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()


def _future(hours=1):
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()


GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
ZOOM_TOKEN_URL = "https://zoom.us/oauth/token"


# ── Shared grants ──────────────────────────────────────────────────────────

def test_google_connectors_share_one_grant():
    group = set(credential_group("gmail"))
    assert group == {"gmail", "google_calendar", "google_drive", "google_docs", "google_sheets", "google_forms"}
    assert credential_group("zoom") == ("zoom",)
    assert credential_group("microsoft_teams") == ("microsoft_teams",)


@pytest.mark.asyncio
async def test_calendar_uses_token_from_gmail_connect(db):
    db.add_token("gmail", "google-token", expires_at=_future())
    credential = await token_store.get_credential(EMPLOYER_ID, "google_calendar")
    assert credential.token == "google-token"
    assert credential.status == "ok"


def test_listing_marks_shared_google_connectors_connected(db):
    db.add_token("gmail", "google-token", refresh_token="r", expires_at=_future())
    statuses = token_store.connection_statuses(EMPLOYER_ID)
    for provider in ("gmail", "google_calendar", "google_drive", "google_forms"):
        assert statuses[provider]["status"] == "active"
    assert "zoom" not in statuses


def test_disconnect_revokes_whole_google_grant(db):
    db.add_token("gmail")
    db.add_token("google_calendar")
    db.add_token("zoom")
    token_store.disconnect(EMPLOYER_ID, "google_calendar")
    assert db.token("gmail")["status"] == "disconnected"
    assert db.token("google_calendar")["status"] == "disconnected"
    assert db.token("zoom")["status"] == "active"


@pytest.mark.asyncio
async def test_other_employers_tokens_are_never_returned(db):
    db.add_token("gmail", "someone-else", employer_id="employer-2")
    credential = await token_store.get_credential(EMPLOYER_ID, "gmail")
    assert credential.token is None
    assert credential.status == "not_connected"


# ── Refresh ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_expired_google_token_is_refreshed_and_persisted(db, http, monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_ID", "cid")
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_SECRET", "csecret")
    db.add_token("gmail", "stale", refresh_token="refresh-1", expires_at=_past())
    http.route("POST", GOOGLE_TOKEN_URL, httpx.Response(200, json={"access_token": "fresh", "expires_in": 3599}))

    credential = await token_store.get_credential(EMPLOYER_ID, "gmail")

    assert credential.token == "fresh"
    body = parse_qs(http.requests[0].content.decode())
    assert body["grant_type"] == ["refresh_token"]
    assert body["refresh_token"] == ["refresh-1"]
    row = db.token("gmail")
    assert row["access_token"] == "fresh"
    assert row["refresh_token"] == "refresh-1"  # Google keeps the original refresh token
    assert datetime.fromisoformat(row["expires_at"]) > datetime.now(timezone.utc)


@pytest.mark.asyncio
async def test_token_about_to_expire_is_refreshed_early(db, http, monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_ID", "cid")
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_SECRET", "csecret")
    soon = (datetime.now(timezone.utc) + timedelta(seconds=30)).isoformat()
    db.add_token("gmail", "almost-stale", refresh_token="r", expires_at=soon)
    http.route("POST", GOOGLE_TOKEN_URL, httpx.Response(200, json={"access_token": "fresh", "expires_in": 3599}))
    assert (await token_store.get_credential(EMPLOYER_ID, "gmail")).token == "fresh"


@pytest.mark.asyncio
async def test_valid_token_is_not_refreshed(db, http):
    db.add_token("gmail", "good", refresh_token="r", expires_at=_future())
    assert (await token_store.get_credential(EMPLOYER_ID, "gmail")).token == "good"
    assert http.requests == []


@pytest.mark.asyncio
async def test_zoom_refresh_uses_basic_auth_and_stores_rotated_refresh_token(db, http, monkeypatch):
    monkeypatch.setattr(settings, "ZOOM_OAUTH_CLIENT_ID", "zid")
    monkeypatch.setattr(settings, "ZOOM_OAUTH_CLIENT_SECRET", "zsecret")
    db.add_token("zoom", "stale", refresh_token="zoom-r1", expires_at=_past())
    http.route("POST", ZOOM_TOKEN_URL, httpx.Response(
        200, json={"access_token": "zoom-fresh", "refresh_token": "zoom-r2", "expires_in": 3599},
    ))

    credential = await token_store.get_credential(EMPLOYER_ID, "zoom")

    assert credential.token == "zoom-fresh"
    assert http.requests[0].headers["authorization"].startswith("Basic ")
    assert "client_secret" not in http.requests[0].content.decode()
    assert db.token("zoom")["refresh_token"] == "zoom-r2"


@pytest.mark.asyncio
async def test_failed_refresh_marks_connection_expired(db, http, monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_ID", "cid")
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_SECRET", "csecret")
    db.add_token("gmail", "stale", refresh_token="revoked", expires_at=_past())
    http.route("POST", GOOGLE_TOKEN_URL, httpx.Response(400, json={"error": "invalid_grant"}))

    credential = await token_store.get_credential(EMPLOYER_ID, "gmail")

    assert credential.token is None
    assert credential.status == "expired"
    assert "reconnect" in credential.error_message("Gmail").lower()
    assert db.token("gmail")["status"] == "expired"
    # The next lookup reports expired without calling the provider again.
    again = await token_store.get_credential(EMPLOYER_ID, "gmail")
    assert again.status == "expired"
    assert len(http.requests) == 1


@pytest.mark.asyncio
async def test_expired_token_without_refresh_token_is_marked_expired(db, http):
    db.add_token("facebook", "old", expires_at=_past())
    credential = await token_store.get_credential(EMPLOYER_ID, "facebook")
    assert credential.status == "expired"
    assert http.requests == []


# ── Encryption at rest ─────────────────────────────────────────────────────

def test_tokens_are_encrypted_at_rest_when_key_is_set(db, monkeypatch):
    monkeypatch.setattr(settings, "CONNECTOR_TOKEN_ENCRYPTION_KEY", Fernet.generate_key().decode())
    token_store.store_token(EMPLOYER_ID, "zoom", "secret-access", refresh_token="secret-refresh", expires_in=3600)
    row = db.token("zoom")
    assert "secret-access" not in row["access_token"]
    assert "secret-refresh" not in row["refresh_token"]
    assert token_store.decrypt_token(row["access_token"]) == "secret-access"


@pytest.mark.asyncio
async def test_legacy_plaintext_tokens_still_work_after_enabling_encryption(db, monkeypatch):
    db.add_token("zoom", "legacy-plain")
    monkeypatch.setattr(settings, "CONNECTOR_TOKEN_ENCRYPTION_KEY", Fernet.generate_key().decode())
    assert (await token_store.get_credential(EMPLOYER_ID, "zoom")).token == "legacy-plain"


@pytest.mark.asyncio
async def test_undecryptable_token_is_reported_as_expired(db, monkeypatch):
    monkeypatch.setattr(settings, "CONNECTOR_TOKEN_ENCRYPTION_KEY", Fernet.generate_key().decode())
    token_store.store_token(EMPLOYER_ID, "zoom", "secret")
    monkeypatch.setattr(settings, "CONNECTOR_TOKEN_ENCRYPTION_KEY", Fernet.generate_key().decode())
    assert (await token_store.get_credential(EMPLOYER_ID, "zoom")).status == "expired"


# ── Email from the employer's own mailbox ──────────────────────────────────

GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"


@pytest.mark.asyncio
async def test_send_email_uses_connected_gmail(db, http):
    db.add_token("gmail", "gmail-token", expires_at=_future())
    http.route("POST", GMAIL_SEND_URL, httpx.Response(200, json={"id": "m-1"}))

    result = await EmailConnectorService.send_email(
        to="cand@example.com", subject="Offer", body="Hello", purpose="job_offer", employer_id=EMPLOYER_ID,
    )

    assert result == {"sent": True, "email_id": "m-1", "recipient": "cand@example.com", "sent_via": "gmail"}
    request = http.requests[0]
    assert request.headers["authorization"] == "Bearer gmail-token"
    import base64
    raw = base64.urlsafe_b64decode(json.loads(request.content)["raw"]).decode()
    assert "To: cand@example.com" in raw and "Subject: Offer" in raw


@pytest.mark.asyncio
async def test_send_email_uses_outlook_when_gmail_absent(db, http):
    db.add_token("outlook", "ms-token", expires_at=_future())
    http.route("POST", "https://graph.microsoft.com/v1.0/me/sendMail", httpx.Response(202))
    result = await EmailConnectorService.send_email(
        to="c@example.com", subject="s", body="b", purpose="notification", employer_id=EMPLOYER_ID,
    )
    assert result["sent"] is True and result["sent_via"] == "outlook"
    assert http.requests[0].headers["authorization"] == "Bearer ms-token"


@pytest.mark.asyncio
async def test_send_email_falls_back_to_platform_sender_when_nothing_connected(db, http, monkeypatch):
    monkeypatch.setattr(settings, "RESEND_API_KEY", "re_test")
    monkeypatch.setattr(settings, "EMAIL_FROM_ADDRESS", "noreply@example.com")
    http.route("POST", "https://api.resend.com/emails", httpx.Response(200, json={"id": "r-1"}))
    result = await EmailConnectorService.send_email(
        to="c@example.com", subject="s", body="b", purpose="notification", employer_id=EMPLOYER_ID,
    )
    assert result["sent"] is True and result["sent_via"] == "goleska"


@pytest.mark.asyncio
async def test_send_email_with_expired_gmail_asks_to_reconnect_instead_of_platform_send(db, http):
    db.add_token("gmail", "x", status="expired")
    result = await EmailConnectorService.send_email(
        to="c@example.com", subject="s", body="b", purpose="notification", employer_id=EMPLOYER_ID,
    )
    assert result["sent"] is False and "reconnect" in result["error"].lower()
    assert http.requests == []


@pytest.mark.asyncio
async def test_gmail_send_rejects_header_injection(http):
    result = await GmailService.send_email("t", "a@example.com\nBcc: evil@example.com", "s", "b")
    assert result["sent"] is False
    assert http.requests == []


@pytest.mark.asyncio
async def test_read_email_rejects_path_like_message_ids(db, http):
    db.add_token("gmail", "t", expires_at=_future())
    result = await GmailService.read_email(EMPLOYER_ID, "../../profile")
    assert result == {"error": "Invalid email message ID."}
    assert http.requests == []


# ── WhatsApp ───────────────────────────────────────────────────────────────

WA_SESSION_URL = "https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/"
WA_TEMPLATE_URL = "https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/"


@pytest.mark.asyncio
async def test_whatsapp_text_uses_business_number_not_otp_widget(http, monkeypatch):
    monkeypatch.setattr(settings, "MSG91_AUTH_KEY", "auth")
    monkeypatch.setattr(settings, "MSG91_WIDGET_ID", "otp-widget-id")
    monkeypatch.setattr(settings, "MSG91_WHATSAPP_NUMBER", "+919800000000")
    http.route("POST", WA_SESSION_URL, httpx.Response(200, json={"request_id": "wa-1"}))

    result = await WhatsAppService.send_message(phone="9876543210", message="Interview at 10")

    assert result["sent"] is True
    payload = json.loads(http.requests[0].content)
    assert payload == {
        "integrated_number": "919800000000",
        "recipient_number": "919876543210",
        "content_type": "text",
        "text": "Interview at 10",
    }


@pytest.mark.asyncio
async def test_whatsapp_without_sender_number_is_not_configured(http, monkeypatch):
    monkeypatch.setattr(settings, "MSG91_AUTH_KEY", "auth")
    monkeypatch.setattr(settings, "MSG91_WHATSAPP_NUMBER", "")
    result = await WhatsAppService.send_message(phone="919876543210", message="hi")
    assert result["sent"] is False and "MSG91_WHATSAPP_NUMBER" in result["error"]
    assert http.requests == []


@pytest.mark.asyncio
async def test_whatsapp_template_sends_positional_variables(http, monkeypatch):
    monkeypatch.setattr(settings, "MSG91_AUTH_KEY", "auth")
    monkeypatch.setattr(settings, "MSG91_WHATSAPP_NUMBER", "919800000000")
    http.route("POST", WA_TEMPLATE_URL, httpx.Response(200, json={"request_id": "wa-t1"}))

    result = await WhatsAppService.send_message(
        phone="9876543210", message="invite", template_name="interview_invite_message",
        template_variables=["Asha", "Mason", "tomorrow", "3 PM"],
    )

    assert result["sent"] is True
    payload = json.loads(http.requests[0].content)
    template = payload["payload"]["template"]
    assert template["name"] == "interview_invite_message"
    assert template["language"]["code"] == "en"
    to_entry = template["to_and_components"][0]
    assert to_entry["to"] == ["919876543210"]
    assert to_entry["components"] == {
        "body_1": {"type": "text", "value": "Asha"},
        "body_2": {"type": "text", "value": "Mason"},
        "body_3": {"type": "text", "value": "tomorrow"},
        "body_4": {"type": "text", "value": "3 PM"},
    }


@pytest.mark.asyncio
async def test_whatsapp_http_200_with_failure_body_is_not_success(http, monkeypatch):
    monkeypatch.setattr(settings, "MSG91_AUTH_KEY", "auth")
    monkeypatch.setattr(settings, "MSG91_WHATSAPP_NUMBER", "919800000000")
    http.route("POST", WA_SESSION_URL, httpx.Response(200, json={"hasError": True, "errors": "window closed"}))
    result = await WhatsAppService.send_message(phone="919876543210", message="hi")
    assert result["sent"] is False and "24 hours" in result["error"]


# ── Teams ──────────────────────────────────────────────────────────────────

def test_teams_tool_no_longer_accepts_a_model_supplied_webhook():
    assert "webhook_url" not in SEND_TEAMS_MESSAGE_TOOL.input_schema["properties"]


@pytest.mark.parametrize("url,allowed", [
    ("https://contoso.webhook.office.com/webhookb2/abc", True),
    ("https://prod-12.westus.logic.azure.com/workflows/abc", True),
    ("http://contoso.webhook.office.com/webhookb2/abc", False),
    ("https://example.com/webhook", False),
    ("https://webhook.office.com.evil.example/x", False),
    ("https://user:pw@contoso.webhook.office.com/x", False),
    ("https://169.254.169.254/latest/meta-data", False),
])
def test_teams_webhook_allow_list(url, allowed):
    assert is_allowed_teams_webhook(url) is allowed


@pytest.mark.asyncio
async def test_teams_posts_to_stored_webhook(db, http):
    hook = "https://contoso.webhook.office.com/webhookb2/abc"
    db.add_token("microsoft_teams", hook)
    http.route("POST", hook, httpx.Response(200, text="1"))
    result = await TeamsService.send_message(title="t", message="m", employer_id=EMPLOYER_ID)
    assert result == {"sent": True}
    assert str(http.requests[0].url) == hook


@pytest.mark.asyncio
async def test_teams_refuses_stored_non_microsoft_url(db, http):
    db.add_token("microsoft_teams", "https://internal.example/admin")
    result = await TeamsService.send_message(title="t", message="m", employer_id=EMPLOYER_ID)
    assert result["sent"] is False
    assert http.requests == []


@pytest.mark.asyncio
async def test_connect_endpoint_rejects_invalid_teams_webhook(db, monkeypatch):
    monkeypatch.setattr(JobService, "_employer_profile", staticmethod(lambda user: {"id": EMPLOYER_ID}))
    from fastapi import HTTPException

    payload = connectors_router.ConnectorToken(provider="microsoft_teams", access_token="https://example.com/x")
    with pytest.raises(HTTPException) as exc:
        await connectors_router.connect_provider(payload, user=object())
    assert exc.value.detail == "INVALID_TEAMS_WEBHOOK_URL"
    assert db.tables["connector_tokens"] == []


# ── Facebook ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_facebook_posts_with_page_token_not_user_token(db, http):
    db.add_token("facebook", "user-token", expires_at=_future(24 * 50))
    http.route("GET", "https://graph.facebook.com/v18.0/me/accounts", httpx.Response(
        200, json={"data": [{"id": "page-1", "name": "Acme Builders", "access_token": "page-token"}]},
    ))
    http.route("POST", "https://graph.facebook.com/v18.0/page-1/feed", httpx.Response(200, json={"id": "page-1_99"}))

    result = await SocialMediaService.post_to_platform(
        platform="facebook", caption="Hiring masons", job_title="Mason", employer_id=EMPLOYER_ID,
    )

    assert result["posted"] is True and result["post_id"] == "page-1_99"
    accounts_req, post_req = http.requests
    assert accounts_req.headers["authorization"] == "Bearer user-token"
    assert post_req.headers["authorization"] == "Bearer page-token"
    for request in (accounts_req, post_req):
        assert "user-token" not in str(request.url) and "page-token" not in str(request.url)


@pytest.mark.asyncio
async def test_facebook_connect_stores_long_lived_token(http, monkeypatch):
    from app.services.connectors import oauth_service

    monkeypatch.setattr(settings, "FACEBOOK_OAUTH_CLIENT_ID", "fid")
    monkeypatch.setattr(settings, "FACEBOOK_OAUTH_CLIENT_SECRET", "fsecret")
    responses = iter([
        httpx.Response(200, json={"access_token": "short", "expires_in": 5000}),
        httpx.Response(200, json={"access_token": "long", "expires_in": 5_184_000}),
    ])
    http.route = lambda *a: None  # both calls hit the same URL; answer in order
    http.handler = lambda request: (http.requests.append(request), next(responses))[1]

    state = oauth_service._encode_state(EMPLOYER_ID, "facebook")
    result = await oauth_service.exchange_code_for_token("facebook", "code-1", state)

    assert result["access_token"] == "long"
    assert result["expires_in"] == 5_184_000
    exchange = parse_qs(http.requests[1].content.decode())
    assert exchange["grant_type"] == ["fb_exchange_token"] and exchange["fb_exchange_token"] == ["short"]
    assert "fsecret" not in str(http.requests[1].url)


# ── Google Drive search by name ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_drive_search_finds_files_by_name(db, http):
    from app.services.connectors.drive_service import DriveService

    db.add_token("gmail", "google-token", expires_at=_future())
    http.route("GET", "https://www.googleapis.com/drive/v3/files", httpx.Response(
        200, json={"files": [
            {"id": "file-abc", "name": "full-stack-developer (6).pdf",
             "mimeType": "application/pdf", "webViewLink": "https://drive.google.com/file/d/file-abc/view"},
        ]},
    ))

    result = await DriveService.search_files("full-stack-developer", EMPLOYER_ID)

    assert result["files"][0]["file_id"] == "file-abc"
    assert result["files"][0]["file_name"] == "full-stack-developer (6).pdf"
    # Uses the shared Google grant and sends a name-contains query.
    request = http.requests[0]
    assert request.headers["authorization"] == "Bearer google-token"
    assert "name contains" in request.url.params["q"]


@pytest.mark.asyncio
async def test_drive_search_without_connection_returns_error(db):
    from app.services.connectors.drive_service import DriveService

    result = await DriveService.search_files("anything", EMPLOYER_ID)
    assert result["files"] == []
    assert result["error"]


@pytest.mark.asyncio
async def test_drive_pdf_is_read_via_ocr_not_raw_bytes(monkeypatch):
    from app.services.connectors.drive_service import DriveService
    from app.services.connectors import ocr_service

    raw_pdf = b"%PDF-1.4\x00\x01\x02 binary noise \xff\xfe"

    async def fake_extract(file_bytes, mime_type, analysis_intent="general"):
        assert file_bytes == raw_pdf and mime_type == "application/pdf"
        return {"extracted_text": "John Doe — Full-Stack Developer", "structured_data": {"name": "John Doe"},
                "document_type": "resume", "confidence": 0.9}

    monkeypatch.setattr(ocr_service.OCRService, "extract_from_bytes", staticmethod(fake_extract))

    out = await DriveService._extract_content(raw_pdf, "application/pdf")

    # Real extracted text, never the raw binary.
    assert out["content"] == "John Doe — Full-Stack Developer"
    assert out["structured_data"] == {"name": "John Doe"}
    assert "%PDF" not in out["content"]


@pytest.mark.asyncio
async def test_drive_text_file_decodes_directly_without_ocr(monkeypatch):
    from app.services.connectors.drive_service import DriveService
    from app.services.connectors import ocr_service

    async def fail(*a, **k):
        raise AssertionError("OCR must not run on textual files")

    monkeypatch.setattr(ocr_service.OCRService, "extract_from_bytes", staticmethod(fail))

    out = await DriveService._extract_content(b"plain hiring notes", "text/plain")
    assert out["content"] == "plain hiring notes"


# ── Agent turn: connector failures go back to the model ─────────────────────

class _GeminiReply:
    status_code = 200

    def __init__(self, obj):
        self._obj = obj

    def json(self):
        return {"candidates": [{"content": {"parts": [{"text": json.dumps(self._obj)}]}}]}


@pytest.fixture
def agent(db, monkeypatch):
    replies: list[dict] = []
    prompts: list[dict] = []

    async def fake_generate_content(payload, **_kwargs):
        prompts.append(payload)
        return _GeminiReply(replies.pop(0))

    monkeypatch.setattr(ai_gateway, "generate_content", fake_generate_content)
    monkeypatch.setattr(JobService, "_employer_profile", staticmethod(lambda user: {"id": EMPLOYER_ID}))
    monkeypatch.setattr(
        hiring_agent_service.HiringAgentService, "_owned_site", classmethod(lambda cls, e, s: (None, None)),
    )
    user = UserResponse.model_construct(id=str(uuid4()), role="EMPLOYER", email="e@example.com")

    async def send(message):
        request = HiringAgentMessageRequest(message=message)
        return await hiring_agent_service.HiringAgentService.process_message(user, request)

    return send, replies, prompts


def _tool_call(name, arguments):
    return {
        "assistant_message": "Working on it.", "task_state": None, "completed": False,
        "tool_calls": [{"call_id": "c1", "tool_name": name, "arguments": arguments}],
    }


def _final(message):
    return {"assistant_message": message, "task_state": None, "completed": False, "tool_calls": []}


@pytest.mark.asyncio
async def test_rejected_tool_arguments_are_returned_to_model_which_retries(agent, db, http):
    send, replies, prompts = agent
    db.add_token("zoom", "zoom-token", expires_at=_future())
    http.route("POST", "https://api.zoom.us/v2/users/me/meetings", httpx.Response(
        201, json={"id": 1, "join_url": "https://zoom.us/j/1", "password": "p"},
    ))
    replies[:] = [
        _tool_call("hiring.create_zoom_meeting", {"topic": "Interview", "start_time": "2026-11-05T10:00:00", "duration_minutes": 10}),
        _tool_call("hiring.create_zoom_meeting", {"topic": "Interview", "start_time": "2026-11-05T10:00:00", "duration_minutes": 15}),
        _final("Zoom meeting created (15 minutes is the minimum): https://zoom.us/j/1"),
    ]

    response = await send("create a 10 minute zoom")

    assert response.assistant_message.startswith("Zoom meeting created")
    assert "ARGUMENT_VALIDATION_FAILED" in json.dumps(prompts[1])
    assert http.hosts() == ["api.zoom.us"]


@pytest.mark.asyncio
async def test_not_connected_result_is_explained_by_model_not_replaced(agent, db, http):
    send, replies, prompts = agent
    replies[:] = [
        _tool_call("hiring.schedule_event", {"title": "Interview", "start_time": "2026-11-05T10:00:00+05:30", "duration_minutes": 30}),
        _final("Google Calendar isn't connected yet — connect Google in Settings > Connectors."),
    ]
    response = await send("schedule an interview")
    assert "Settings > Connectors" in response.assistant_message
    assert "couldn't retrieve candidates" not in response.assistant_message
    assert response.candidate_result_status == "NOT_RETRIEVED"


@pytest.mark.asyncio
async def test_agent_schedules_event_with_google_grant_from_gmail_connect(agent, db, http):
    send, replies, prompts = agent
    db.add_token("gmail", "google-token", expires_at=_future())
    http.route("POST", "https://www.googleapis.com/calendar/v3/calendars/primary/events", httpx.Response(
        200, json={"id": "ev-1", "htmlLink": "https://calendar.google.com/ev-1"},
    ))
    replies[:] = [
        _tool_call("hiring.schedule_event", {"title": "Interview", "start_time": "2026-11-05T10:00:00+05:30", "duration_minutes": 30}),
        _final("Scheduled."),
    ]
    response = await send("schedule an interview tomorrow at 10")
    assert response.assistant_message == "Scheduled."
    assert http.requests[0].headers["authorization"] == "Bearer google-token"
