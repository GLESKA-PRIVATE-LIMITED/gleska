from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.services import auth_service, password_reset_service


class Query:
    def __init__(self, data=None):
        self.data = data
        self.payload = None
        self.filters = []

    def select(self, *_args, **_kwargs):
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

    def is_(self, *_args):
        return self

    def limit(self, *_args):
        return self

    def execute(self):
        return SimpleNamespace(data=self.data)


class FakeSupabase:
    def __init__(self):
        self.challenge = Query([{
            "id": "challenge-123",
            "phone": "919876543210",
            "verified_at": datetime.now(timezone.utc).isoformat(),
            "reset_expires_at": (datetime.now(timezone.utc) + timedelta(minutes=2)).isoformat(),
        }])
        self.challenge_update = Query([])
        self.security_activity = Query([])
        self.updated_user_id = None
        self.auth = SimpleNamespace(
            admin=SimpleNamespace(
                update_user_by_id=lambda user_id, _payload: setattr(self, "updated_user_id", user_id)
            )
        )
        self.challenge_calls = 0

    def table(self, name):
        if name == "password_reset_challenges":
            self.challenge_calls += 1
            return self.challenge if self.challenge_calls == 1 else self.challenge_update
        if name == "security_activity":
            return self.security_activity
        raise AssertionError(name)


def test_completed_password_reset_records_idempotent_security_activity(monkeypatch):
    fake = FakeSupabase()
    monkeypatch.setattr(password_reset_service, "supabase", fake)
    monkeypatch.setattr(
        auth_service.AuthService,
        "get_user_by_mobile",
        staticmethod(lambda _phone: {"id": "user-a"}),
    )

    password_reset_service.PasswordResetService.complete("verified-authorization", "a-secure-password")

    assert fake.updated_user_id == "user-a"
    assert fake.security_activity.payload["user_id"] == "user-a"
    assert fake.security_activity.payload["event_type"] == "password_changed"
    assert fake.security_activity.payload["event_key"] == "password_changed:challenge-123"
    assert fake.challenge_update.payload["used_at"]
