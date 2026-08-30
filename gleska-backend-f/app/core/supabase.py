"""Supabase client for backend operations."""

from typing import Optional
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


# Create a singleton instance
supabase = SupabaseManager.get_client()
