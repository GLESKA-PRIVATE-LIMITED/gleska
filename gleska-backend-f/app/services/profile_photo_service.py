"""Private profile photo storage helpers."""

import os
import uuid
from datetime import datetime, timezone

from app.core.supabase import supabase
from app.schemas.worker import ProfilePhotoUploadRequest

PROFILE_PHOTOS_BUCKET = "profile-photos"
ALLOWED_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


def validate_profile_photo(request: ProfilePhotoUploadRequest) -> None:
    extension = os.path.splitext(request.original_filename.lower())[1]
    if extension not in ALLOWED_EXTENSIONS:
        raise ValueError("Profile photo extension is not allowed")
    if request.mime_type not in ALLOWED_MIME_TYPES:
        raise ValueError("Profile photo type is not allowed")
    expected = {"image/jpeg": {".jpg", ".jpeg"}, "image/png": {".png"}, "image/webp": {".webp"}}
    if extension not in expected[request.mime_type]:
        raise ValueError("Profile photo extension does not match its MIME type")


def get_profile_photo_path(user_id: str, filename: str) -> str:
    safe_filename = filename.split("/")[-1].split("\\")[-1]
    return f"users/{user_id}/{uuid.uuid4().hex[:8]}_{safe_filename}"


def get_signed_profile_photo_url(storage_path: str | None) -> str | None:
    if not storage_path:
        return None
    result = supabase.storage.from_(PROFILE_PHOTOS_BUCKET).create_signed_url(storage_path, 3600)
    return result.get("signedURL") or result.get("signedUrl")


def delete_profile_photo(storage_path: str | None) -> None:
    if storage_path:
        supabase.storage.from_(PROFILE_PHOTOS_BUCKET).remove([storage_path])


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
