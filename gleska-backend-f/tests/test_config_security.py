import pytest

from app.core.config import Settings


def test_production_jwt_secret_must_not_be_placeholder():
    with pytest.raises(ValueError, match="JWT_SECRET_KEY"):
        Settings(ENVIRONMENT="production", JWT_SECRET_KEY="")

    with pytest.raises(ValueError, match="JWT_SECRET_KEY"):
        Settings(ENVIRONMENT="production", JWT_SECRET_KEY="change-me-in-production")

    settings = Settings(ENVIRONMENT="production", JWT_SECRET_KEY="strong-production-secret")
    assert settings.JWT_SECRET_KEY == "strong-production-secret"


def test_development_environment_allows_placeholder_secret():
    settings = Settings(ENVIRONMENT="development", JWT_SECRET_KEY="change-me-in-production")
    assert settings.ENVIRONMENT == "development"
    assert settings.JWT_SECRET_KEY == "change-me-in-production"
