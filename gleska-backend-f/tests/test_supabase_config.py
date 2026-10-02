import pytest

from app.core import supabase as supabase_module


@pytest.fixture
def supabase_manager(monkeypatch):
    monkeypatch.setattr(supabase_module.SupabaseManager, "_client", None)
    monkeypatch.setattr(supabase_module.settings, "ENVIRONMENT", "development")
    monkeypatch.setattr(supabase_module.settings, "SUPABASE_URL", "https://supabase.example")
    monkeypatch.setattr(supabase_module.settings, "SUPABASE_SERVICE_ROLE_KEY", "")
    monkeypatch.setattr(supabase_module.settings, "SUPABASE_ANON_KEY", "test-anon-key")
    return supabase_module.SupabaseManager


def test_production_supabase_client_uses_service_role_key(monkeypatch, supabase_manager):
    monkeypatch.setattr(supabase_module.settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(supabase_module.settings, "SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")
    calls = []
    expected_client = object()

    def create_client(url, key):
        calls.append((url, key))
        return expected_client

    monkeypatch.setattr(supabase_module, "create_client", create_client)

    assert supabase_manager.get_client() is expected_client
    assert calls == [("https://supabase.example", "test-service-role-key")]


def test_production_supabase_client_does_not_fall_back_to_anon(monkeypatch, supabase_manager):
    monkeypatch.setattr(supabase_module.settings, "ENVIRONMENT", "production")
    create_client = lambda *_args: pytest.fail("Supabase client must not be created without the service-role key")
    monkeypatch.setattr(supabase_module, "create_client", create_client)

    with pytest.raises(ValueError, match="SUPABASE_SERVICE_ROLE_KEY is required in production"):
        supabase_manager.get_client()


def test_development_supabase_client_keeps_anon_key_fallback(monkeypatch, supabase_manager):
    calls = []
    expected_client = object()

    def create_client(url, key):
        calls.append((url, key))
        return expected_client

    monkeypatch.setattr(supabase_module, "create_client", create_client)

    assert supabase_manager.get_client() is expected_client
    assert calls == [("https://supabase.example", "test-anon-key")]
