"""Interview-invite relay + hire-gated contact reveal."""

import pytest

from app.services import interview_invite_service as invite_mod
from app.services.interview_invite_service import InterviewInviteService, InterviewInviteError


class _Resp:
    def __init__(self, data):
        self.data = data


class _Rpc:
    def __init__(self, data):
        self._data = data

    def execute(self):
        return _Resp(self._data)


class _FakeSupabase:
    def __init__(self, contact_rows):
        self._rows = contact_rows
        self.calls = []

    def rpc(self, name, params):
        self.calls.append((name, params))
        return _Rpc(self._rows)


async def _ok_wa(phone=None, message=None, template_name=None, template_variables=None, template_language="en"):
    _ok_wa.seen = {"phone": phone, "template_name": template_name, "template_variables": template_variables}
    return {"sent": True, "message_id": "wa1"}


async def _ok_email(to=None, subject=None, body=None, purpose=None, employer_id=None, employer_name=None):
    _ok_email.seen = {"to": to, "purpose": purpose}
    return {"sent": True, "email_id": "em1", "recipient": to}


@pytest.mark.asyncio
async def test_invite_resolves_contact_and_sends_both_channels(monkeypatch):
    fake = _FakeSupabase([{"name": "Suresh", "mobile": "9999900002", "email": "s@demo.test"}])
    monkeypatch.setattr(invite_mod, "supabase", fake)
    monkeypatch.setattr(invite_mod.WhatsAppService, "send_message", _ok_wa)
    monkeypatch.setattr(invite_mod.EmailConnectorService, "send_email", _ok_email)

    result = await InterviewInviteService.send_invite(
        employer_id="emp1",
        worker_profile_id="wp1",
        job_title="Electrician",
        template_name="interview_invite",
        template_variables=["Suresh", "Electrician"],
    )

    # Contact was resolved server-side via the secure RPC using the worker id.
    assert fake.calls[0][0] == "get_worker_contact_secure"
    assert fake.calls[0][1] == {"p_worker_profile_id": "wp1"}
    # Sent to the resolved phone/email — the caller never supplied them.
    assert _ok_wa.seen["phone"] == "9999900002"
    assert _ok_wa.seen["template_name"] == "interview_invite"
    assert _ok_email.seen["to"] == "s@demo.test"
    assert _ok_email.seen["purpose"] == "interview_invite"
    assert result["sent_any"] is True
    assert set(result["channels_delivered"]) == {"whatsapp", "email"}
    # Raw contact is NOT leaked at the top level of the tool result.
    assert "mobile" not in result and "email_address" not in result


@pytest.mark.asyncio
async def test_invite_skips_email_when_worker_has_none(monkeypatch):
    fake = _FakeSupabase([{"name": "Phone Only", "mobile": "9999900099", "email": None}])
    monkeypatch.setattr(invite_mod, "supabase", fake)
    monkeypatch.setattr(invite_mod.WhatsAppService, "send_message", _ok_wa)
    monkeypatch.setattr(invite_mod.EmailConnectorService, "send_email", _ok_email)

    result = await InterviewInviteService.send_invite(employer_id="emp1", worker_profile_id="wp2", channel="both")

    assert result["whatsapp"]["attempted"] is True
    assert result["email"]["attempted"] is False
    assert result["email"]["reason"] == "NO_EMAIL_ON_FILE"


@pytest.mark.asyncio
async def test_invite_whatsapp_only_does_not_touch_email(monkeypatch):
    fake = _FakeSupabase([{"name": "Suresh", "mobile": "9999900002", "email": "s@demo.test"}])
    monkeypatch.setattr(invite_mod, "supabase", fake)
    monkeypatch.setattr(invite_mod.WhatsAppService, "send_message", _ok_wa)

    async def _boom(**kwargs):
        raise AssertionError("email must not be sent when channel=whatsapp")

    monkeypatch.setattr(invite_mod.EmailConnectorService, "send_email", _boom)

    result = await InterviewInviteService.send_invite(employer_id="emp1", worker_profile_id="wp1", channel="whatsapp")
    assert "email" not in result
    assert result["whatsapp"]["sent"] is True


@pytest.mark.asyncio
async def test_invite_raises_when_worker_not_found(monkeypatch):
    monkeypatch.setattr(invite_mod, "supabase", _FakeSupabase([]))
    with pytest.raises(InterviewInviteError):
        await InterviewInviteService.send_invite(employer_id="emp1", worker_profile_id="missing")


# ── Hire-gated contact reveal ────────────────────────────────────────────────

from types import SimpleNamespace

from app.services import job_match_service as jm_mod
from app.services.job_match_service import JobMatchService


class _Query:
    """Chainable PostgREST-style stub returning preset data at execute()."""
    def __init__(self, data):
        self._data = data

    def select(self, *a, **k):
        return self

    def eq(self, *a, **k):
        return self

    def in_(self, *a, **k):
        return self

    def limit(self, *a, **k):
        return self

    def execute(self):
        return _Resp(self._data)


class _FakeDb:
    def __init__(self, accepted_rows, contact_rows):
        self._accepted = accepted_rows
        self._contact = contact_rows

    def table(self, name):
        assert name == "job_matches"
        return _Query(self._accepted)

    def rpc(self, name, params):
        assert name == "get_worker_contact_secure"
        return _Rpc(self._contact)


def test_reveal_returns_contact_for_hired_worker(monkeypatch):
    monkeypatch.setattr(jm_mod.JobService, "get_for_user", lambda user, job_id: SimpleNamespace(employer_id="emp1"))
    monkeypatch.setattr(jm_mod, "supabase", _FakeDb(
        accepted_rows=[{"id": "m1", "status": "ACCEPTED"}],
        contact_rows=[{"name": "Suresh", "mobile": "9999900002", "email": "s@demo.test"}],
    ))
    contact = JobMatchService.get_worker_contact_for_user(user=None, job_id="job1", worker_profile_id="wp1")
    assert contact == {"name": "Suresh", "mobile": "9999900002", "email": "s@demo.test"}


def test_reveal_denied_when_worker_not_hired(monkeypatch):
    monkeypatch.setattr(jm_mod.JobService, "get_for_user", lambda user, job_id: SimpleNamespace(employer_id="emp1"))
    monkeypatch.setattr(jm_mod, "supabase", _FakeDb(accepted_rows=[], contact_rows=[{"name": "x"}]))
    with pytest.raises(ValueError) as exc:
        JobMatchService.get_worker_contact_for_user(user=None, job_id="job1", worker_profile_id="wp1")
    assert str(exc.value) == "WORKER_NOT_HIRED"
