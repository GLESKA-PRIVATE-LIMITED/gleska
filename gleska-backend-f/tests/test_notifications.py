from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.routers import notifications


class Query:
    def __init__(self, data=None, count=None):
        self.data = data
        self.count = count
        self.filters = []
        self.payload = None
        self.update_mode = False

    def select(self, _fields, **_kwargs):
        return self

    def update(self, payload):
        self.payload = payload
        self.update_mode = True
        return self

    def eq(self, field, value):
        self.filters.append((field, value))
        return self

    def is_(self, field, value):
        self.filters.append((field, value))
        return self

    def order(self, *_args, **_kwargs):
        return self

    def limit(self, *_args):
        return self

    def maybe_single(self):
        return self

    def execute(self):
        return SimpleNamespace(data=self.data, count=self.count)


class FakeSupabase:
    def __init__(self, items=None, unread_count=0, update_result=None, existing=None):
        self.list_query = Query(items or [])
        self.unread_query = Query([], unread_count)
        self.update_query = Query(update_result or [])
        self.existing_query = Query(existing)
        self.query_count = {}
        self.mark_mode = False

    def table(self, name):
        assert name == "notifications"
        index = self.query_count.get(name, 0)
        self.query_count[name] = index + 1
        if self.mark_mode:
            return self.update_query if index == 0 else self.existing_query
        if index == 0:
            return self.list_query
        if index == 1:
            return self.unread_query
        if index == 2:
            return self.update_query
        return self.existing_query


def notification_row(notification_id=None, read_at=None):
    return {
        "id": str(notification_id or uuid4()),
        "category": "security",
        "title": "New sign-in",
        "message": "A new sign-in occurred.",
        "read_at": read_at,
        "entity_type": "security_activity",
        "entity_id": str(uuid4()),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


@pytest.mark.asyncio
async def test_notification_list_is_owner_scoped_and_returns_unread_count(monkeypatch):
    fake = FakeSupabase([notification_row()], unread_count=4)
    monkeypatch.setattr(notifications, "supabase", fake)

    result = await notifications.list_notifications(50, SimpleNamespace(id="worker-a", role="WORKER"))

    assert result.unread_count == 4
    assert len(result.notifications) == 1
    assert ("user_id", "worker-a") in fake.list_query.filters
    assert ("user_id", "worker-a") in fake.unread_query.filters
    assert ("read_at", "null") in fake.unread_query.filters


@pytest.mark.asyncio
async def test_mark_read_updates_only_owned_unread_notification(monkeypatch):
    row = notification_row()
    fake = FakeSupabase(update_result=[row])
    fake.mark_mode = True
    monkeypatch.setattr(notifications, "supabase", fake)

    result = await notifications.mark_notification_read(
        uuid4(),
        SimpleNamespace(id="employer-a", role="EMPLOYER"),
    )

    assert result.success is True
    assert ("user_id", "employer-a") in fake.update_query.filters
    assert ("read_at", "null") in fake.update_query.filters
    assert fake.update_query.payload["read_at"]


@pytest.mark.asyncio
async def test_notification_with_foreign_owner_is_not_found(monkeypatch):
    fake = FakeSupabase(update_result=[], existing=None)
    monkeypatch.setattr(notifications, "supabase", fake)

    with pytest.raises(HTTPException) as error:
        await notifications.mark_notification_read(
            uuid4(),
            SimpleNamespace(id="worker-a", role="WORKER"),
        )

    assert error.value.status_code == 404


def test_shared_notification_migration_uses_rls_preferences_and_idempotency():
    migration_path = (
        Path(__file__).resolve().parents[2]
        / "gleska-website"
        / "supabase"
        / "migrations"
        / "069_in_app_notifications.sql"
    )
    migration = migration_path.read_text(encoding="utf-8")

    assert "CREATE TABLE IF NOT EXISTS public.notifications" in migration
    assert "ENABLE ROW LEVEL SECURITY" in migration
    assert "auth.uid() = user_id" in migration
    assert "UNIQUE (user_id, event_key)" in migration
    assert "ON CONFLICT (user_id, event_key) DO NOTHING" in migration
    assert "CREATE OR REPLACE FUNCTION public.revoke_account_session" in migration
    assert "CREATE OR REPLACE FUNCTION public.logout_account_session" in migration
    assert "worker_preferences" in migration
    assert "employer_preferences" in migration
    assert "notify_job_match_event" in migration
    assert "notify_attendance_event" in migration
    assert "notify_employer_attendance_audit" in migration
    assert "notify_security_activity" in migration
