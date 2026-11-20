"""Dynamic model discovery for Groq and Gemini. No model IDs are hard-coded for live use."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.config import Settings
from app.models import MOCK_MODELS, ModelInfo, make_model


@dataclass
class DiscoveryResult:
    models: list[ModelInfo]
    source: str  # live | mock
    errors: list[str] = field(default_factory=list)


def _size_b(model_id: str) -> float:
    m = re.search(r"(\d+(?:\.\d+)?)b", model_id.lower())
    return float(m.group(1)) if m else 0.0


def classify_groq(model_id: str) -> tuple[str, bool, bool]:
    """Return (tier, usable, vision). Audio, guard and embedding endpoints are not chat models."""
    low = model_id.lower()
    usable = not re.search(r"whisper|tts|playai|orpheus|guard|embed|moderation", low)
    reasoning = (
        bool(re.search(r"reason|r1|qwq|gpt-oss-120|maverick|kimi|deepseek|versatile|large", low)) or _size_b(low) >= 30
    )
    vision = bool(re.search(r"vision|scout|maverick", low))
    return ("reasoning" if reasoning else "fast"), usable, vision


def classify_gemini(name: str, methods: list[str]) -> tuple[str, bool, bool, str]:
    """Return (id, supports_chat, supports_embed, tier): flash/flash-lite are fast, pro/thinking reason."""
    model_id = name.removeprefix("models/")
    low = model_id.lower()
    excluded = re.search(r"tts|image|imagen|veo|live|robotics|audio|aqa|learnlm|gemma", low)
    chat = "generateContent" in methods and "gemini" in low and not excluded
    embed = "embedContent" in methods
    tier = "reasoning" if re.search(r"pro|thinking|ultra", low) else "fast"
    return model_id, chat, embed, tier


def _top(models: list[ModelInfo]) -> list[ModelInfo]:
    chat = [m for m in models if "chat" in m.capabilities]
    fast = sorted((m for m in chat if m.tier == "fast"), key=lambda m: m.id, reverse=True)[:3]
    strong = sorted((m for m in chat if m.tier == "reasoning"), key=lambda m: m.id, reverse=True)[:2]
    return fast + strong


async def _discover_groq(client, key: str) -> list[ModelInfo]:  # noqa: ANN001
    r = await client.get("https://api.groq.com/openai/v1/models", headers={"Authorization": f"Bearer {key}"})
    r.raise_for_status()
    out: list[ModelInfo] = []
    for m in r.json().get("data", []):
        if m.get("active") is False:
            continue
        tier, usable, vision = classify_groq(m["id"])
        if usable:
            caps = ("chat", "vision") if vision else ("chat",)
            out.append(make_model(m["id"], "groq", tier, int(m.get("context_window") or 8192), caps, "live"))
    return _top(out)


async def _discover_gemini(client, key: str) -> list[ModelInfo]:  # noqa: ANN001
    r = await client.get(
        "https://generativelanguage.googleapis.com/v1beta/models",
        params={"pageSize": 200},
        headers={"x-goog-api-key": key},
    )
    r.raise_for_status()
    out: list[ModelInfo] = []
    for m in r.json().get("models", []):
        model_id, chat, _embed, tier = classify_gemini(m["name"], m.get("supportedGenerationMethods", []))
        if chat:
            ctx = int(m.get("inputTokenLimit") or 32768)
            out.append(make_model(model_id, "gemini", tier, ctx, ("chat", "vision"), "live"))
    return _top(out)


async def discover(settings: Settings) -> DiscoveryResult:
    """Query live provider APIs when keys exist; otherwise serve the mock registry."""
    if settings.mock_mode or not (settings.groq_api_key or settings.gemini_api_key):
        return DiscoveryResult(list(MOCK_MODELS), "mock")
    import httpx  # imported lazily so mock mode needs no network stack

    errors: list[str] = []
    models: list[ModelInfo] = []
    async with httpx.AsyncClient(timeout=6.0) as client:
        for name, key, fn in (
            ("groq", settings.groq_api_key, _discover_groq),
            ("gemini", settings.gemini_api_key, _discover_gemini),
        ):
            if not key:
                continue
            try:
                models += await fn(client, key)
            except Exception as exc:  # noqa: BLE001 - one provider failing must not stop discovery
                errors.append(f"{name}: {exc}")
    if any("chat" in m.capabilities for m in models):
        return DiscoveryResult(models, "live", errors)
    return DiscoveryResult(list(MOCK_MODELS), "mock", errors)
