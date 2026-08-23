"""User service for retrieving user information."""

from app.core.supabase import supabase
from app.schemas.auth import UserResponse


class UserService:
    """Service for user-related operations."""

    @staticmethod
    def get_user_profile(user_id: str) -> UserResponse:
        """Get full user profile."""
        response = (
            supabase.table("users")
            .select("*")
            .eq("id", user_id)
            .single()
            .execute()
        )
        return UserResponse(**response.data)
