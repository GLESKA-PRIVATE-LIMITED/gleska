"""Phone OTP password reset state backed by Supabase and MSG91."""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from app.core.config import settings
from app.core.supabase import supabase
from app.services.auth_service import AuthService
from app.services.msg91_service import MSG91Service


class PasswordResetService:
    @staticmethod
    def _hash(value: str) -> str:
        return hashlib.sha256(value.encode("utf-8")).hexdigest()

    @staticmethod
    def _now() -> datetime:
        return datetime.now(timezone.utc)

    @classmethod
    async def request_otp(cls, phone: str) -> None:
        normalized_phone = AuthService.normalize_mobile(phone)
        now = cls._now()
        existing = supabase.table("password_reset_challenges").select("created_at").eq("phone", normalized_phone).is_("used_at", "null").order("created_at", desc=True).limit(1).execute()
        if existing.data:
            created_at = datetime.fromisoformat(existing.data[0]["created_at"].replace("Z", "+00:00"))
            if (now - created_at).total_seconds() < settings.PASSWORD_RESET_RESEND_COOLDOWN_SECONDS:
                return
        supabase.table("password_reset_challenges").update({"used_at": now.isoformat()}).eq("phone", normalized_phone).is_("used_at", "null").execute()
        if AuthService.get_user_by_mobile(normalized_phone):
            supabase.table("password_reset_challenges").insert({
                "phone": normalized_phone,
                "otp_expires_at": (now + timedelta(seconds=settings.PASSWORD_RESET_OTP_TTL_SECONDS)).isoformat(),
                "max_attempts": settings.PASSWORD_RESET_MAX_ATTEMPTS,
            }).execute()

    @classmethod
    async def verify_provider_token(cls, phone: str, access_token: str) -> str:
        normalized_phone = AuthService.normalize_mobile(phone)
        response = supabase.table("password_reset_challenges").select("*").eq("phone", normalized_phone).is_("used_at", "null").order("created_at", desc=True).limit(1).execute()
        if not response.data:
            raise ValueError("INVALID_OR_EXPIRED_OTP")
        challenge = response.data[0]
        if datetime.fromisoformat(challenge["otp_expires_at"].replace("Z", "+00:00")) <= cls._now():
            raise ValueError("INVALID_OR_EXPIRED_OTP")
        if int(challenge["attempts"]) >= int(challenge["max_attempts"]):
            raise ValueError("OTP_ATTEMPTS_EXCEEDED")
        try:
            provider_result = await MSG91Service().verify_access_token(access_token)
        except ValueError as exc:
            supabase.table("password_reset_challenges").update({"attempts": int(challenge["attempts"]) + 1}).eq("id", challenge["id"]).execute()
            raise exc
        provider_phone = AuthService.normalize_mobile(str(provider_result.get("message", "")))
        if provider_phone != normalized_phone:
            supabase.table("password_reset_challenges").update({"attempts": int(challenge["attempts"]) + 1}).eq("id", challenge["id"]).execute()
            raise ValueError("INVALID_OR_EXPIRED_OTP")
        authorization = secrets.token_urlsafe(32)
        supabase.table("password_reset_challenges").update({
            "verified_at": cls._now().isoformat(),
            "reset_authorization_hash": cls._hash(authorization),
            "reset_expires_at": (cls._now() + timedelta(seconds=settings.PASSWORD_RESET_AUTH_TTL_SECONDS)).isoformat(),
        }).eq("id", challenge["id"]).execute()
        return authorization

    @classmethod
    def complete(cls, authorization: str, password: str) -> None:
        response = supabase.table("password_reset_challenges").select("*").eq("reset_authorization_hash", cls._hash(authorization)).is_("used_at", "null").limit(1).execute()
        if not response.data:
            raise ValueError("INVALID_RESET_AUTHORIZATION")
        challenge = response.data[0]
        if not challenge.get("verified_at") or not challenge.get("reset_expires_at") or datetime.fromisoformat(challenge["reset_expires_at"].replace("Z", "+00:00")) <= cls._now():
            raise ValueError("INVALID_RESET_AUTHORIZATION")
        user = AuthService.get_user_by_mobile(challenge["phone"])
        if not user:
            raise ValueError("INVALID_RESET_AUTHORIZATION")
        supabase.auth.admin.update_user_by_id(user["id"], {"password": password})
        supabase.table("password_reset_challenges").update({"used_at": cls._now().isoformat()}).eq("phone", challenge["phone"]).is_("used_at", "null").execute()