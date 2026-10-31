import asyncio
import re
from decimal import Decimal
from pathlib import Path

import httpx
import pytest

from app.ai_gateway import AIBillingError, billing_scope, current_billing_context, generate_content
from app.ai_gateway import backend as billing_backend
from app.ai_gateway.context import _current
from app.ai_gateway.pricing import (
    BillingSettings,
    FxRate,
    ModelPrice,
    Usage,
    charge_for,
    provider_cost,
    reservation_credits,
)
from app.ai_gateway.providers import gemini
from tests.conftest import InMemoryBillingBackend

APP_DIR = Path(__file__).resolve().parents[1] / "app"
SETTINGS = BillingSettings(id="s1", credit_value_inr=Decimal(20), markup_multiplier=Decimal("1.10"), default_max_output_tokens=8192)
USD_PRICE = ModelPrice(
    id="p1", provider="gemini", model="m", version=3, currency="USD",
    input_price=Decimal("0.30"), output_price=Decimal("2.50"), cached_input_price=Decimal("0.075"),
    audio_input_price=Decimal("1.00"),
)


# ---------------------------------------------------------------- architecture

def test_only_the_adapter_talks_to_gemini():
    offenders = []
    for path in APP_DIR.rglob("*.py"):
        rel = path.relative_to(APP_DIR).as_posix()
        if rel.startswith("ai_gateway/providers/") or rel == "core/config.py":
            continue
        text = path.read_text(encoding="utf-8")
        if "generativelanguage.googleapis.com" in text or re.search(r"\bGEMINI_API_KEY\b", text):
            offenders.append(rel)
    assert offenders == [], f"Direct Gemini access outside app/ai_gateway/providers: {offenders}"


# ---------------------------------------------------------------- pricing engine

def test_spec_example_twenty_rupees_costs_one_point_one_credits():
    charge = charge_for(Decimal(20), FxRate(id=None, rate=Decimal(1)), SETTINGS)
    assert (charge.customer_charge_inr, charge.credits) == (Decimal("22.0000"), Decimal("1.100000"))


def test_cached_audio_and_thinking_are_priced_once_each():
    usage = Usage(input_tokens=1_000_000, cached_input_tokens=200_000, audio_input_tokens=100_000,
                  output_tokens=100_000, thinking_tokens=50_000)
    # plain 700k * 0.30 + cached 200k * 0.075 + audio 100k * 1.00 + output 150k * 2.50 (thinking at output rate)
    assert provider_cost(usage, USD_PRICE) == Decimal("0.21") + Decimal("0.015") + Decimal("0.1") + Decimal("0.375")


def test_usd_cost_converts_to_inr_then_markup_then_credits_with_transaction_rounding():
    cost = provider_cost(Usage(input_tokens=1234, output_tokens=567), USD_PRICE)
    charge = charge_for(cost, FxRate(id="fx", rate=Decimal("83.25")), SETTINGS)
    exact_credits = cost * Decimal("83.25") * Decimal("1.10") / 20
    assert charge.credits == exact_credits.quantize(Decimal("0.000001"))
    assert charge.provider_cost_inr == (cost * Decimal("83.25")).quantize(Decimal("0.0001"))
    assert isinstance(charge.credits, Decimal)


def test_long_context_tier_uses_upper_prices():
    tiered = ModelPrice(
        id="p2", provider="gemini", model="m", version=1, currency="USD",
        input_price=Decimal("1"), output_price=Decimal("2"),
        tier_threshold_tokens=200_000, input_price_above=Decimal("3"), output_price_above=Decimal("4"),
    )
    assert provider_cost(Usage(input_tokens=200_000, output_tokens=0), tiered) == Decimal("0.2")
    assert provider_cost(Usage(input_tokens=200_001, output_tokens=1_000_000), tiered) == Decimal("0.600003") + Decimal(4)


def test_reservation_covers_max_output_and_is_never_zero():
    hold = reservation_credits(10, USD_PRICE, FxRate(id="fx", rate=Decimal(83)), SETTINGS)
    worst = charge_for(provider_cost(Usage(input_tokens=10, output_tokens=8192, thinking_tokens=8192), USD_PRICE),
                       FxRate(id="fx", rate=Decimal(83)), SETTINGS).credits
    assert hold >= worst > 0


# ---------------------------------------------------------------- Gemini adapter parsing

def test_parse_usage_follows_gemini_semantics():
    usage, raw, response_id = gemini.parse_usage({
        "responseId": "resp-1",
        "usageMetadata": {
            "promptTokenCount": 1000, "cachedContentTokenCount": 400, "toolUsePromptTokenCount": 50,
            "candidatesTokenCount": 200, "thoughtsTokenCount": 300, "totalTokenCount": 1550,
            "promptTokensDetails": [{"modality": "TEXT", "tokenCount": 900}, {"modality": "AUDIO", "tokenCount": 100}],
        },
    })
    assert usage == Usage(input_tokens=1050, cached_input_tokens=400, audio_input_tokens=100,
                          output_tokens=200, thinking_tokens=300)
    assert usage.total_tokens == 1550 and response_id == "resp-1" and raw["totalTokenCount"] == 1550


def test_missing_usage_is_reported_as_missing_not_zero():
    assert gemini.parse_usage({"candidates": []})[0] is None


# ---------------------------------------------------------------- gateway lifecycle

class FakeResponse:
    def __init__(self, status_code=200, body=None):
        self.status_code = status_code
        self._body = body

    def json(self):
        if self._body is None:
            raise ValueError("no json")
        return self._body


OK_BODY = {"responseId": "r1", "candidates": [{"content": {"parts": [{"text": "hi"}]}}],
           "usageMetadata": {"promptTokenCount": 1000, "candidatesTokenCount": 500}}


def run_gateway(monkeypatch, backend, outcome):
    calls = []

    async def fake_generate(model, payload, timeout):
        calls.append(payload)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    monkeypatch.setattr(gemini, "generate_content", fake_generate)
    billing_backend.set_backend(backend)
    token = _current.set(None)  # start outside the test suite's ambient scope
    try:
        with billing_scope(agent="logistics", user_id="user-1", parent_task_id="task-9"):
            with billing_scope(agent="general_work"):
                result = asyncio.run(generate_content({"contents": [{"parts": [{"text": "hello"}]}]},
                                                      operation="chat_reply", timeout=5))
    finally:
        _current.reset(token)
    return result, calls


def test_successful_call_charges_actual_usage_and_records_attribution(monkeypatch):
    backend = InMemoryBillingBackend(credits=Decimal(10))
    response, calls = run_gateway(monkeypatch, backend, FakeResponse(200, OK_BODY))
    event = backend.events["event-1"]
    # INR price 10/30 per 1M: 1000*10 + 500*30 = 25,000 / 1M = INR 0.025 -> *1.10 / 20
    assert event["credits_charged"] == Decimal("0.001375")
    assert backend.available == Decimal(10) - Decimal("0.001375")
    assert (event["initiating_agent"], event["executing_agent"], event["parent_task_id"]) == ("logistics", "general_work", "task-9")
    assert (event["status"], event["usage_status"], event["input_tokens"], event["output_tokens"]) == ("succeeded", "confirmed", 1000, 500)
    assert event["provider_request_id"] == "r1" and response.status_code == 200 and len(calls) == 1


def test_insufficient_credits_blocks_before_provider_call(monkeypatch):
    backend = InMemoryBillingBackend(credits=Decimal(0))
    with pytest.raises(AIBillingError) as exc:
        run_gateway(monkeypatch, backend, FakeResponse(200, OK_BODY))
    assert (exc.value.code, exc.value.status_code) == ("INSUFFICIENT_CREDITS", 402)
    assert backend.events["event-1"]["status"] == "rejected"


def test_missing_price_blocks_before_provider_call(monkeypatch):
    backend = InMemoryBillingBackend()
    backend.active_price = lambda provider, model: None
    with pytest.raises(AIBillingError) as exc:
        run_gateway(monkeypatch, backend, FakeResponse(200, OK_BODY))
    assert exc.value.code == "AI_PRICING_NOT_CONFIGURED" and backend.events == {}


def test_missing_fx_rate_blocks_usd_prices(monkeypatch):
    backend = InMemoryBillingBackend(price=USD_PRICE)
    backend.active_fx = lambda currency: None
    with pytest.raises(AIBillingError) as exc:
        run_gateway(monkeypatch, backend, FakeResponse(200, OK_BODY))
    assert exc.value.code == "AI_FX_RATE_NOT_CONFIGURED"


def test_billing_database_outage_fails_closed(monkeypatch):
    backend = InMemoryBillingBackend()

    def broken(user_id):
        raise RuntimeError("db down")

    backend.resolve_account = broken
    with pytest.raises(AIBillingError) as exc:
        run_gateway(monkeypatch, backend, FakeResponse(200, OK_BODY))
    assert exc.value.code == "BILLING_UNAVAILABLE"


def test_provider_error_and_timeout_release_the_reservation(monkeypatch):
    backend = InMemoryBillingBackend(credits=Decimal(10))
    response, _ = run_gateway(monkeypatch, backend, FakeResponse(503, {"error": {}}))
    assert response.status_code == 503 and backend.available == Decimal(10)
    assert backend.events["event-1"]["error_code"] == "PROVIDER_HTTP_503"

    with pytest.raises(httpx.TimeoutException):
        run_gateway(monkeypatch, backend, httpx.TimeoutException("slow"))
    assert backend.available == Decimal(10) and backend.events["event-2"]["status"] == "failed"


def test_response_without_usage_keeps_reservation_for_reconciliation(monkeypatch):
    backend = InMemoryBillingBackend(credits=Decimal(10))
    run_gateway(monkeypatch, backend, FakeResponse(200, {"candidates": []}))
    assert backend.events["event-1"]["status"] == "pending_reconciliation"
    assert "event-1" in backend.reserved and backend.available < Decimal(10)


def test_calls_without_billing_context_are_refused(monkeypatch):
    token = _current.set(None)
    try:
        assert current_billing_context() is None
        with pytest.raises(AIBillingError) as exc:
            asyncio.run(generate_content({}, operation="x", timeout=1))
        assert exc.value.code == "BILLING_CONTEXT_MISSING"
    finally:
        _current.reset(token)


def test_billing_error_reaches_api_clients_as_its_code(monkeypatch):
    from fastapi.testclient import TestClient

    from app.core.security import get_current_user
    from app.main import app
    from tests.test_general_work import USER_A

    from app.core.config import settings

    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(settings, "GEMINI_MODEL", "test-model")
    backend = InMemoryBillingBackend(credits=Decimal(0))
    billing_backend.set_backend(backend)
    app.dependency_overrides[get_current_user] = lambda: USER_A
    try:
        audio = TestClient(app).post(
            "/api/v1/general-work/transcribe", files={"audio": ("a.ogg", b"OggS", "audio/ogg")}
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    assert (audio.status_code, audio.json()["detail"]) == (402, "INSUFFICIENT_CREDITS")
