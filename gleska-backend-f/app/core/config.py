from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=True,
    )

    # Environment
    ENVIRONMENT: str = Field(default="development", validation_alias=AliasChoices("ENVIRONMENT", "environment"))

    # Supabase
    SUPABASE_URL: str = Field(default="", validation_alias=AliasChoices("SUPABASE_URL", "supabase_url"))
    SUPABASE_SERVICE_ROLE_KEY: str = Field(default="", validation_alias=AliasChoices("SUPABASE_SERVICE_ROLE_KEY", "supabase_service_role_key"))
    SUPABASE_ANON_KEY: str = Field(
        default="",
        validation_alias=AliasChoices(
            "SUPABASE_ANON_KEY",
            "SUPABASE_KEY",
            "supabase_anon_key",
            "supabase_key",
        ),
    )
    DATABASE_URL: str = Field(default="", validation_alias=AliasChoices("DATABASE_URL", "database_url"))

    # Frontend
    FRONTEND_URL: str = Field(default="http://localhost:3000", validation_alias=AliasChoices("FRONTEND_URL", "frontend_url"))
    SITE_URL: str = Field(default="http://localhost:3000", validation_alias=AliasChoices("SITE_URL", "site_url"))
    CORS_ORIGINS: str = Field(
        default="http://localhost:3000,https://goleska.in,https://www.goleska.in",
        validation_alias=AliasChoices("CORS_ORIGINS", "cors_origins"),
    )

    # API
    API_V1_PREFIX: str = Field(default="/api/v1", validation_alias=AliasChoices("API_V1_PREFIX", "api_v1_prefix"))

    # JWT / auth
    JWT_SECRET_KEY: str = Field(default="change-me-in-production", validation_alias=AliasChoices("JWT_SECRET_KEY", "jwt_secret_key"))
    JWT_ALGORITHM: str = Field(default="HS256", validation_alias=AliasChoices("JWT_ALGORITHM", "jwt_algorithm"))
    ACCESS_TOKEN_EXPIRE_MINUTES: int = Field(default=60, validation_alias=AliasChoices("ACCESS_TOKEN_EXPIRE_MINUTES", "access_token_expire_minutes"))

    # Verification provider configuration. Credentials are server-side only.
    EMPLOYER_VERIFICATION_PROVIDER: str = Field(
        default="",
        validation_alias=AliasChoices(
            "EMPLOYER_VERIFICATION_PROVIDER",
            "employer_verification_provider",
        ),
    )
    EMPLOYER_VERIFICATION_API_BASE_URL: str = Field(
        default="",
        validation_alias=AliasChoices(
            "EMPLOYER_VERIFICATION_API_BASE_URL",
            "employer_verification_api_base_url",
        ),
    )
    EMPLOYER_VERIFICATION_API_KEY: str = Field(
        default="",
        validation_alias=AliasChoices(
            "EMPLOYER_VERIFICATION_API_KEY",
            "employer_verification_api_key",
        ),
    )
    EMPLOYER_VERIFICATION_API_SECRET: str = Field(
        default="",
        validation_alias=AliasChoices(
            "EMPLOYER_VERIFICATION_API_SECRET",
            "employer_verification_api_secret",
        ),
    )
    EMPLOYER_VERIFICATION_ENVIRONMENT: str = Field(
        default="sandbox",
        validation_alias=AliasChoices(
            "EMPLOYER_VERIFICATION_ENVIRONMENT",
            "employer_verification_environment",
        ),
    )
    EMPLOYER_VERIFICATION_TIMEOUT_SECONDS: int = Field(
        default=15,
        validation_alias=AliasChoices(
            "EMPLOYER_VERIFICATION_TIMEOUT_SECONDS",
            "employer_verification_timeout_seconds",
        ),
    )
    CASHFREE_CLIENT_ID: str = Field(default="", validation_alias=AliasChoices("CASHFREE_CLIENT_ID", "cashfree_client_id"))
    CASHFREE_CLIENT_SECRET: str = Field(default="", validation_alias=AliasChoices("CASHFREE_CLIENT_SECRET", "cashfree_client_secret"))
    CASHFREE_ENV: str = Field(default="SANDBOX", validation_alias=AliasChoices("CASHFREE_ENV", "cashfree_env"))
    CASHFREE_API_VERSION: str = Field(default="2022-09-01", validation_alias=AliasChoices("CASHFREE_API_VERSION", "cashfree_api_version"))

    # Semicolon-separated type mappings using pipe-separated verification types,
    # for example: REGISTERED_BUSINESS:PAN|BANK;INDIVIDUAL:PAN
    EMPLOYER_REQUIRED_VERIFICATIONS: str = Field(
        default="",
        validation_alias=AliasChoices(
            "EMPLOYER_REQUIRED_VERIFICATIONS",
            "employer_required_verifications",
        ),
    )

    # MSG91 OTP Widget
    MSG91_WIDGET_ID: str = Field(default="", validation_alias=AliasChoices("MSG91_WIDGET_ID", "msg91_widget_id"))
    MSG91_WIDGET_TOKEN: str = Field(default="", validation_alias=AliasChoices("MSG91_WIDGET_TOKEN", "msg91_widget_token"))
    MSG91_AUTH_KEY: str = Field(
        default="",
        validation_alias=AliasChoices(
            "MSG91_AUTH_KEY",
            "MSG91_AUTHKEY",
            "msg91_auth_key",
            "msg91_authkey",
            "MSG91_API_KEY",
            "msg91_api_key",
        ),
    )
    MSG91_ACCESS_TOKEN_VERIFY_URL: str = Field(
        default="https://api.msg91.com/api/v5/widget/verifyAccessToken",
        validation_alias=AliasChoices("MSG91_ACCESS_TOKEN_VERIFY_URL", "msg91_access_token_verify_url"),
    )
    MSG91_TIMEOUT_SECONDS: int = Field(default=15, validation_alias=AliasChoices("MSG91_TIMEOUT_SECONDS", "msg91_timeout_seconds"))
    MSG91_OTP_LENGTH: int = Field(default=6, validation_alias=AliasChoices("MSG91_OTP_LENGTH", "msg91_otp_length"))
    PASSWORD_RESET_OTP_TTL_SECONDS: int = Field(default=600, validation_alias=AliasChoices("PASSWORD_RESET_OTP_TTL_SECONDS", "password_reset_otp_ttl_seconds"))
    PASSWORD_RESET_MAX_ATTEMPTS: int = Field(default=5, validation_alias=AliasChoices("PASSWORD_RESET_MAX_ATTEMPTS", "password_reset_max_attempts"))
    PASSWORD_RESET_RESEND_COOLDOWN_SECONDS: int = Field(default=30, validation_alias=AliasChoices("PASSWORD_RESET_RESEND_COOLDOWN_SECONDS", "password_reset_resend_cooldown_seconds"))
    PASSWORD_RESET_AUTH_TTL_SECONDS: int = Field(default=600, validation_alias=AliasChoices("PASSWORD_RESET_AUTH_TTL_SECONDS", "password_reset_auth_ttl_seconds"))

    # Gemini extraction provider
    GEMINI_API_KEY: str = Field(default="", validation_alias=AliasChoices("GEMINI_API_KEY", "gemini_api_key"))
    GEMINI_MODEL: str = Field(default="gemini-2.0-flash", validation_alias=AliasChoices("GEMINI_MODEL", "gemini_model"))
    GEMINI_TIMEOUT_SECONDS: int = Field(default=30, validation_alias=AliasChoices("GEMINI_TIMEOUT_SECONDS", "gemini_timeout_seconds"))


settings = Settings()
