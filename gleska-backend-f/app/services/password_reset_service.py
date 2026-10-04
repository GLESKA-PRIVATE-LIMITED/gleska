"""Phone OTP password reset state backed by Supabase and MSG91."""

import hashlib
import math
import secrets
from datetime import datetime, timedelta, timezone

from app.core.config import settings
from app.core.supabase import supabase
from app.services.auth_service import AuthService
from app.services.msg91_service import MSG91Service


_password_reset_request_times: dict[str, datetime] = {}


class PasswordResetService:
    @staticmethod
    def _hash(value: str) -> str:
        return hashlib.sha256(value.encode("utf-8")).hexdigest()

    @staticmethod
    def _now() -> datetime:
        return datetime.now(timezone.utc)

    @classmethod
    async def request_otp(cls, phone: str) -> int | None:
        normalized_phone = AuthService.normalize_mobile(phone)
        if not AuthService.get_user_by_mobile(normalized_phone):
            raise ValueError("MOBILE_NOT_FOUND")

        now = cls._now()
        last_request = _password_reset_request_times.get(normalized_phone)
        if last_request:
            elapsed = (now - last_request).total_seconds()
            if elapsed < settings.PASSWORD_RESET_RESEND_COOLDOWN_SECONDS:
                return max(1, math.ceil(settings.PASSWORD_RESET_RESEND_COOLDOWN_SECONDS - elapsed))
        _password_reset_request_times[normalized_phone] = now

        expired_before = now - timedelta(seconds=settings.PASSWORD_RESET_RESEND_COOLDOWN_SECONDS)
        for requested_phone, requested_at in list(_password_reset_request_times.items()):
            if requested_at <= expired_before:
                del _password_reset_request_times[requested_phone]

        supabase.table("password_reset_challenges").update({"used_at": now.isoformat()}).eq("phone", normalized_phone).is_("used_at", "null").execute()
        supabase.table("password_reset_challenges").insert({
            "phone": normalized_phone,
            "otp_expires_at": (now + timedelta(seconds=settings.PASSWORD_RESET_OTP_TTL_SECONDS)).isoformat(),
            "max_attempts": settings.PASSWORD_RESET_MAX_ATTEMPTS,
        }).execute()
        return None

    @classmethod
    async def verify_provider_token(cls, phone: str, access_token: str) -> str:
        normalized_phone = AuthService.normalize_mobile(phone)
        response = supabase.table("password_reset_challenges").select("*").eq("phone", normalized_phone).is_("used_at", "null").order("created_at", desc=True).limit(1).execute()
        if not response.data:
            raise ValueError("INVALID_OR_EXPIRED_OTP")
        challenge = response.data[0]
        if datetime.fromisoformat(challenge["otp_expires_at"].replace("Z", "+00:00")) <= cls._now():
            raise ValueError("INVALID_OR_EXPIRED_OTP")
        if challenge.get("verified_at"):
            raise ValueError("OTP_ALREADY_USED")
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
        claim = supabase.table("password_reset_challenges").update({
            "verified_at": cls._now().isoformat(),
            "reset_authorization_hash": cls._hash(authorization),
            "reset_expires_at": (cls._now() + timedelta(seconds=settings.PASSWORD_RESET_AUTH_TTL_SECONDS)).isoformat(),
        }).eq("id", challenge["id"]).is_("verified_at", "null").is_("used_at", "null").select("id").execute()
        if not claim.data:
            raise ValueError("OTP_ALREADY_USED")
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
        supabase.table("security_activity").upsert(
            {
                "user_id": user["id"],
                "event_type": "password_changed",
                "event_key": f"password_changed:{challenge['id']}",
                "description": "Password changed after phone OTP verification",
            },
            on_conflict="user_id,event_key",
            ignore_duplicates=True,
        ).execute()
        supabase.table("password_reset_challenges").update({"used_at": cls._now().isoformat()}).eq("phone", challenge["phone"]).is_("used_at", "null").execute()