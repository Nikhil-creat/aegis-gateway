from app.config import Settings
from app.discovery import _top, classify_gemini, classify_groq, discover
from app.models import MOCK_MODELS, make_model
from tests.conftest import run


def test_groq_audio_guard_and_embedding_models_are_filtered():
    for mid in ("whisper-large-v3", "playai-tts", "llama-guard-4-12b", "text-embedding-x"):
        assert classify_groq(mid)[1] is False, mid
    assert classify_groq("llama-3.1-8b-instant")[:2] == ("fast", True)
    assert classify_groq("llama-3.3-70b-versatile")[:2] == ("reasoning", True)


def test_gemini_tiers_and_capabilities():
    assert classify_gemini("models/gemini-2.5-flash", ["generateContent"]) == ("gemini-2.5-flash", True, False, "fast")
    assert classify_gemini("models/gemini-2.5-pro", ["generateContent"])[3] == "reasoning"
    assert classify_gemini("models/gemini-embedding-001", ["embedContent"])[1:3] == (False, True)
    assert classify_gemini("models/gemini-2.5-flash-image", ["generateContent"])[1] is False
    assert classify_gemini("models/gemma-3-27b", ["generateContent"])[1] is False


def test_top_keeps_a_bounded_mix_of_tiers():
    ms = [make_model(f"m{i}b", "groq", "fast", 8192, ("chat",), "live") for i in range(6)]
    ms += [make_model(f"big{i}", "groq", "reasoning", 8192, ("chat",), "live") for i in range(4)]
    out = _top(ms)
    assert sum(m.tier == "fast" for m in out) == 3 and sum(m.tier == "reasoning" for m in out) == 2


def test_without_keys_or_in_mock_mode_the_mock_registry_is_served():
    assert run(discover(Settings(mock_mode=True))).models == list(MOCK_MODELS)
    r = run(discover(Settings(mock_mode=False)))
    assert r.source == "mock" and r.models == list(MOCK_MODELS)
