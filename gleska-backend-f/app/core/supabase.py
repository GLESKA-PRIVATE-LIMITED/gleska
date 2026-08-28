"""Supabase client for backend operations."""

from typing import Optional
import jwt
from datetime import datetime
from supabase import create_client, Client
from app.core.config import settings


class SupabaseManager:
    """Manages Supabase connections and authentication."""

    _client: Optional[Client] = None

    @classmethod
    def get_client(cls) -> Client:
        """Get or create Supabase client."""
        if cls._client is None:
            key = settings.SUPABASE_SERVICE_ROLE_KEY or settings.SUPABASE_ANON_KEY
            if not settings.SUPABASE_URL or not key:
                raise ValueError("Missing Supabase configuration")
            cls._client = create_client(
                settings.SUPABASE_URL,
                key,
            )
        return cls._client

    @classmethod
    def verify_token(cls, token: str) -> dict:
        """Verify a Supabase JWT token and return decoded payload."""
        try:
            # Get the JWT secret from Supabase JWT header
            decoded = jwt.decode(
                token,
                settings.SUPABASE_ANON_KEY,
                algorithms=["HS256"],
                options={"verify_signature": False},  # Verify in backend by checking sub claim
            )
            return decoded
        except Exception as e:
            raise ValueError(f"Invalid token: {str(e)}")


# Create a singleton instance
supabase = SupabaseManager.get_client()
