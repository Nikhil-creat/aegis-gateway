from app.models import LOCAL_MODEL, MOCK_MODELS, Registry
from app.router import analyze, plan_route


def reg():
    return Registry(MOCK_MODELS)


def test_easy_prompt_goes_to_fast_tier_and_cheapest_model():
    r = plan_route("hello there", "smart-router", reg())
    assert r.tier == "fast" and r.chain[0].id == "mock-groq-fast-8b"


def test_hard_prompt_goes_to_reasoning_tier():
    r = plan_route(
        "Design a fault-tolerant architecture and compare the trade-offs step by step.", "smart-router", reg()
    )
    assert r.tier == "reasoning" and r.chain[0].tier == "reasoning"
    assert "multi-step" in r.reason


def test_code_and_json_signals_raise_difficulty():
    assert analyze("```python\ndef f(): pass\n``` explain why").difficulty >= 0.5
    assert "structured-output constraint" in analyze("Respond only in JSON.").signals


def test_policies_pin_tiers():
    assert plan_route("hi", "always-strong", reg()).chain[0].tier == "reasoning"
    assert (
        plan_route("Design a fault-tolerant architecture step by step and compare it", "always-cheap", reg())
        .chain[0]
        .tier
        == "fast"
    )


def test_latency_optimized_prefers_lowest_latency():
    r = plan_route("hi", "latency-optimized", reg())
    assert r.chain[0].avg_latency_ms == min(m.avg_latency_ms for m in MOCK_MODELS)


def test_privacy_strict_never_selects_an_external_model():
    r = plan_route("anything", "privacy-strict", reg())
    assert r.chain == (LOCAL_MODEL,)


def test_first_fallback_prefers_a_different_provider():
    r = plan_route("hi", "smart-router", reg())
    assert r.chain[1].provider != r.chain[0].provider


def test_degraded_models_are_skipped_until_cooldown_ends():
    now = [0.0]
    registry = Registry(MOCK_MODELS, clock=lambda: now[0])
    registry.mark_degraded("mock-groq-fast-8b", 30)
    assert plan_route("hi", "smart-router", registry).chain[0].id != "mock-groq-fast-8b"
    assert registry.cooldown_remaining("mock-groq-fast-8b") == 30
    now[0] = 31
    assert plan_route("hi", "smart-router", registry).chain[0].id == "mock-groq-fast-8b"
