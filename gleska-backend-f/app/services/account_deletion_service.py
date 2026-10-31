"""Service for handling permanent user account deletion across all domains."""

import hashlib
import logging
from typing import Optional

from fastapi import HTTPException, status

from app.core.supabase import supabase
from app.schemas.auth import UserResponse
from app.services.profile_photo_service import PROFILE_PHOTOS_BUCKET

logger = logging.getLogger(__name__)

VALID_CONFIRMATIONS = {"DELETE", "DELETE MY ACCOUNT", "DELETE-ADMIN"}


class AccountDeletionService:
    """Handles end-to-end user account deletion, data cleanup, and auth revocation."""

    @classmethod
    def validate_confirmation(cls, confirmation: str) -> None:
        """Ensure explicit confirmation was provided."""
        normalized = (confirmation or "").strip().upper()
        if normalized not in VALID_CONFIRMATIONS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="INVALID_CONFIRMATION: You must explicitly confirm deletion by typing DELETE.",
            )

    @classmethod
    def check_admin_policy(cls, user: UserResponse) -> None:
        """Prevent deletion of the sole active administrator."""
        if user.role != "ADMIN":
            return

        try:
            admins_res = (
                supabase.table("users")
                .select("id", count="exact")
                .eq("role", "ADMIN")
                .eq("is_active", True)
                .execute()
            )
            count = admins_res.count if admins_res.count is not None else len(admins_res.data or [])
            if count <= 1:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="CANNOT_DELETE_SOLE_ADMIN: This account is the only active system administrator. Another administrator must be created or assigned before deleting this account.",
                )
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Failed to check active admin count for user_id=%s", user.id)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="ADMIN_VALIDATION_FAILED: Unable to verify system administrator requirements.",
            ) from exc

    @classmethod
    def cleanup_storage_files(cls, user: UserResponse) -> None:
        """Remove user's uploaded files from Supabase Storage."""
        # 1. Worker documents & photos
        if user.role == "WORKER":
            try:
                worker_profile = (
                    supabase.table("worker_profiles")
                    .select("id")
                    .eq("user_id", user.id)
                    .maybe_single()
                    .execute()
                )
                if worker_profile and worker_profile.data:
                    worker_id = worker_profile.data.get("id")
                    if worker_id:
                        docs_res = (
                            supabase.table("worker_documents")
                            .select("storage_path")
                            .eq("worker_profile_id", worker_id)
                            .execute()
                        )
                        paths = [
                            row["storage_path"]
                            for row in (docs_res.data or [])
                            if row.get("storage_path")
                        ]
                        if paths:
                            supabase.storage.from_("worker-documents").remove(paths)
            except Exception as exc:
                logger.warning("Storage cleanup for worker documents encountered error: %s", exc)

        # 2. Profile photo
        try:
            user_row = (
                supabase.table("users")
                .select("profile_photo_path")
                .eq("id", user.id)
                .maybe_single()
                .execute()
            )
            if user_row and user_row.data and user_row.data.get("profile_photo_path"):
                photo_path = user_row.data.get("profile_photo_path")
                supabase.storage.from_(PROFILE_PHOTOS_BUCKET).remove([photo_path])
        except Exception as exc:
            logger.warning("Storage cleanup for profile photo encountered error: %s", exc)

        # 3. General Work library files (rows cascade with the user; storage objects do not)
        if user.role == "EMPLOYER":
            try:
                files_res = (
                    supabase.table("general_work_files")
                    .select("storage_bucket, storage_path")
                    .eq("user_id", user.id)
                    .execute()
                )
                paths_by_bucket: dict[str, list[str]] = {}
                for row in files_res.data or []:
                    if row.get("storage_bucket") and row.get("storage_path"):
                        paths_by_bucket.setdefault(row["storage_bucket"], []).append(row["storage_path"])
                for bucket, paths in paths_by_bucket.items():
                    supabase.storage.from_(bucket).remove(paths)
            except Exception as exc:
                logger.warning("Storage cleanup for General Work files encountered error: %s", exc)

    @classmethod
    def execute_database_deletion(cls, user_id: str) -> None:
        """Delete user records in database, trying the atomic RPC first with sequential fallback."""
        try:
            rpc_res = supabase.rpc("execute_user_account_deletion", {"p_user_id": user_id}).execute()
            if rpc_res and rpc_res.data and rpc_res.data.get("success"):
                logger.info("Executed database account deletion via RPC for user_id=%s", user_id[:8])
                return
        except Exception as rpc_err:
            error_msg = str(rpc_err)
            if "CANNOT_DELETE_SOLE_ADMIN" in error_msg:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="CANNOT_DELETE_SOLE_ADMIN: At least one other active system administrator must remain.",
                ) from rpc_err
            logger.warning("RPC execute_user_account_deletion failed (%s); performing sequential cleanup.", rpc_err)

        # Sequential Fallback Deletion
        try:
            # Clean up sessions and activities
            supabase.table("user_sessions").delete().eq("user_id", user_id).execute()
            supabase.table("security_activity").delete().eq("user_id", user_id).execute()
            supabase.table("in_app_notifications").delete().eq("user_id", user_id).execute()

            # Clean up assistant conversations
            try:
                supabase.table("assistant_conversations").delete().eq("user_id", user_id).execute()
            except Exception:
                pass

            # Worker profile cleanup
            worker_profile = (
                supabase.table("worker_profiles")
                .select("id")
                .eq("user_id", user_id)
                .maybe_single()
                .execute()
            )
            if worker_profile and worker_profile.data:
                worker_id = worker_profile.data.get("id")
                try:
                    supabase.table("worker_documents").delete().eq("worker_profile_id", worker_id).execute()
                except Exception:
                    pass
                try:
                    supabase.table("worker_preferences").delete().eq("worker_profile_id", worker_id).execute()
                except Exception:
                    pass
                try:
                    supabase.table("worker_subscriptions").delete().eq("worker_profile_id", worker_id).execute()
                except Exception:
                    pass
                try:
                    supabase.table("job_matches").delete().eq("worker_profile_id", worker_id).execute()
                except Exception:
                    pass
                try:
                    supabase.table("worker_current_locations").delete().eq("worker_profile_id", worker_id).execute()
                except Exception:
                    pass
                try:
                    supabase.table("worker_profile_locations").delete().eq("worker_profile_id", worker_id).execute()
                except Exception:
                    pass
                supabase.table("worker_profiles").delete().eq("id", worker_id).execute()

            # Employer profile cleanup
            employer_profile = (
                supabase.table("employer_profiles")
                .select("id")
                .eq("user_id", user_id)
                .maybe_single()
                .execute()
            )
            if employer_profile and employer_profile.data:
                employer_id = employer_profile.data.get("id")
                try:
                    supabase.table("employer_onboarding_details").delete().eq("employer_id", employer_id).execute()
                except Exception:
                    pass
                try:
                    supabase.table("employer_preferences").delete().eq("employer_id", employer_id).execute()
                except Exception:
                    pass
                try:
                    supabase.table("employer_verifications").delete().eq("employer_id", employer_id).execute()
                except Exception:
                    pass
                try:
                    jobs_res = supabase.table("jobs").select("id").eq("employer_id", employer_id).execute()
                    job_ids = [row["id"] for row in (jobs_res.data or []) if row.get("id")]
                    for j_id in job_ids:
                        supabase.table("job_matches").delete().eq("job_id", j_id).execute()
                    supabase.table("jobs").delete().eq("employer_id", employer_id).execute()
                    supabase.table("job_sites").delete().eq("employer_id", employer_id).execute()
                except Exception:
                    pass
                supabase.table("employer_profiles").delete().eq("id", employer_id).execute()

            # Procurement & Supplier cleanup
            try:
                supabase.table("supplier_company_memberships").delete().eq("user_id", user_id).execute()
            except Exception:
                pass
            try:
                supabase.table("procurement_workspace_preference").delete().eq("user_id", user_id).execute()
            except Exception:
                pass
            try:
                supabase.table("procurement_conversation_archive").delete().eq("user_id", user_id).execute()
            except Exception:
                pass

            # Audit reference decoupling (anonymize)
            try:
                supabase.table("attendance_audit").update({"actor_user_id": None}).eq("actor_user_id", user_id).execute()
            except Exception:
                pass

            # Delete public.users record
            supabase.table("users").delete().eq("id", user_id).execute()
        except Exception as exc:
            logger.exception("Sequential database account deletion error for user_id=%s: %s", user_id, exc)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="DATABASE_DELETION_FAILED: Failed to delete all user records from database.",
            ) from exc

    @classmethod
    def revoke_auth_identity(cls, user_id: str) -> None:
        """Permanently delete user from Supabase Auth admin API, revoking all credentials and sessions."""
        try:
            supabase.auth.admin.delete_user(user_id)
            logger.info("Deleted auth identity via Supabase admin for user_id=%s", user_id[:8])
        except Exception as exc:
            logger.warning(
                "Supabase admin delete_user failed (auth service key may be restricted or absent): %s",
                exc,
            )

    @classmethod
    def delete_account(
        cls,
        user: UserResponse,
        confirmation: str,
        reason: Optional[str] = None,
    ) -> None:
        """Perform verified, authorized account deletion for the current user."""
        cls.validate_confirmation(confirmation)
        cls.check_admin_policy(user)

        user_id = str(user.id)
        user_hash = hashlib.sha256(user_id.encode()).hexdigest()[:12]
        logger.info(
            "Account deletion requested: role=%s user_hash=%s reason_provided=%s",
            user.role,
            user_hash,
            bool(reason),
        )

        # 1. Clean up uploaded storage files
        cls.cleanup_storage_files(user)

        # 2. Clean up database records
        cls.execute_database_deletion(user_id)

        # 3. Permanently revoke Supabase Auth identity
        cls.revoke_auth_identity(user_id)

        logger.info("Account deletion completed successfully: user_hash=%s", user_hash)
