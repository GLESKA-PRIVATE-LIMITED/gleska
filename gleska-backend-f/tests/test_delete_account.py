"""Unit tests for the Delete Account feature and AccountDeletionService."""

import os

# Set mock Supabase environment variables before importing app modules
os.environ.setdefault("SUPABASE_URL", "https://mock.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "mock-anon-key-123")
os.environ.setdefault("JWT_SECRET_KEY", "mock-jwt-secret-key-for-tests-12345")

from datetime import datetime, timezone
from types import SimpleNamespace
import unittest
from fastapi import HTTPException

from app.schemas.auth import UserResponse
from app.services.account_deletion_service import AccountDeletionService


def make_user(role="WORKER", user_id="user-123"):
    return UserResponse(
        id=user_id,
        name="Test User",
        mobile="919876543210",
        email="test@example.com",
        role=role,
        is_mobile_verified=True,
        is_active=True,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )


class QueryMock:
    def __init__(self, data=None, count=None):
        self._data = data
        self._count = count
        self.deleted_filters = []
        self.updated_payload = None

    def select(self, *_args, **_kwargs):
        return self

    def delete(self):
        return self

    def update(self, payload):
        self.updated_payload = payload
        return self

    def eq(self, field, value):
        self.deleted_filters.append((field, value))
        return self

    def maybe_single(self):
        return self

    def execute(self):
        return SimpleNamespace(data=self._data, count=self._count)


class StorageBucketMock:
    def __init__(self):
        self.removed_paths = []

    def remove(self, paths):
        self.removed_paths.extend(paths)
        return {"data": paths}


class FakeSupabaseForDeletion:
    def __init__(self, admin_count=1):
        self.admin_count = admin_count
        self.deleted_auth_users = []
        self.rpc_calls = []
        self.auth = SimpleNamespace(
            admin=SimpleNamespace(
                delete_user=lambda uid: self.deleted_auth_users.append(uid)
            )
        )
        self.storage_buckets = {
            "worker-documents": StorageBucketMock(),
            "worker-profile-photos": StorageBucketMock(),
        }
        self.storage = SimpleNamespace(from_=self.from_)

    def table(self, name):
        if name == "users":
            return QueryMock(data={"id": "user-123", "profile_photo_path": "photos/user-123.jpg"}, count=self.admin_count)
        if name == "worker_profiles":
            return QueryMock(data={"id": "worker-prof-123"})
        if name == "worker_documents":
            return QueryMock(data=[{"storage_path": "workers/worker-prof-123/doc1.pdf"}])
        return QueryMock(data=[])

    def from_(self, bucket_name):
        return self.storage_buckets.get(bucket_name, StorageBucketMock())

    def rpc(self, name, params):
        self.rpc_calls.append((name, params))
        return SimpleNamespace(execute=lambda: SimpleNamespace(data={"success": True}))


class TestAccountDeletion(unittest.TestCase):
    def test_invalid_confirmation_raises_400(self):
        with self.assertRaises(HTTPException) as ctx:
            AccountDeletionService.validate_confirmation("yes")
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("INVALID_CONFIRMATION", ctx.exception.detail)

    def test_sole_admin_deletion_raises_403(self):
        user = make_user(role="ADMIN", user_id="admin-sole")
        fake = FakeSupabaseForDeletion(admin_count=1)
        from app.services import account_deletion_service
        original_supabase = account_deletion_service.supabase
        try:
            account_deletion_service.supabase = fake
            with self.assertRaises(HTTPException) as ctx:
                AccountDeletionService.check_admin_policy(user)
            self.assertEqual(ctx.exception.status_code, 403)
            self.assertIn("CANNOT_DELETE_SOLE_ADMIN", ctx.exception.detail)
        finally:
            account_deletion_service.supabase = original_supabase

    def test_admin_with_multiple_admins_allowed(self):
        user = make_user(role="ADMIN", user_id="admin-1")
        fake = FakeSupabaseForDeletion(admin_count=2)
        from app.services import account_deletion_service
        original_supabase = account_deletion_service.supabase
        try:
            account_deletion_service.supabase = fake
            # Should not raise exception
            AccountDeletionService.check_admin_policy(user)
        finally:
            account_deletion_service.supabase = original_supabase

    def test_successful_worker_deletion_flow(self):
        user = make_user(role="WORKER", user_id="worker-abc")
        fake = FakeSupabaseForDeletion()
        from app.services import account_deletion_service
        original_supabase = account_deletion_service.supabase
        try:
            account_deletion_service.supabase = fake
            AccountDeletionService.delete_account(user=user, confirmation="DELETE")

            # Storage cleanup verified
            self.assertIn("workers/worker-prof-123/doc1.pdf", fake.storage_buckets["worker-documents"].removed_paths)
            # RPC called
            self.assertIn(("execute_user_account_deletion", {"p_user_id": "worker-abc"}), fake.rpc_calls)
            # Auth user deleted
            self.assertIn("worker-abc", fake.deleted_auth_users)
        finally:
            account_deletion_service.supabase = original_supabase


if __name__ == "__main__":
    unittest.main()
