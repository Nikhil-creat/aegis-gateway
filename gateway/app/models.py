"""Model catalogue and the health-aware registry."""

from __future__ import annotations

import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass


@dataclass(frozen=True)
class ModelInfo:
    id: str
    provider: str  # groq | gemini | local
    tier: str  # fast | reasoning
    context_window: int
    capabilities: tuple[str, ...]
    in_per_1m: float  # illustrative list price, USD per 1M input tokens
    out_per_1m: float
    avg_latency_ms: int
    source: str = "mock"  # live | mock

    def cost(self, prompt_tokens: int, completion_tokens: int) -> float:
        return (prompt_tokens * self.in_per_1m + completion_tokens * self.out_per_1m) / 1_000_000


# (input $/1M, output $/1M, typical latency ms). Illustrative: free-tier keys actually cost $0.
_PROFILE: dict[tuple[str, str], tuple[float, float, int]] = {
    ("groq", "fast"): (0.06, 0.08, 150),
    ("groq", "reasoning"): (0.59, 0.79, 450),
    ("gemini", "fast"): (0.10, 0.40, 260),
    ("gemini", "reasoning"): (1.25, 10.0, 900),
    ("local", "fast"): (0.0, 0.0, 40),
    ("local", "reasoning"): (0.0, 0.0, 40),
}


def make_model(
    model_id: str,
    provider: str,
    tier: str,
    context_window: int,
    capabilities: tuple[str, ...],
    source: str = "mock",
) -> ModelInfo:
    i, o, latency = _PROFILE[(provider, tier)]
    return ModelInfo(model_id, provider, tier, context_window, capabilities, i, o, latency, source)


MOCK_MODELS: tuple[ModelInfo, ...] = (
    make_model("mock-groq-fast-8b", "groq", "fast", 131_072, ("chat",)),
    make_model("mock-groq-reasoning-70b", "groq", "reasoning", 131_072, ("chat",)),
    make_model("mock-gemini-flash", "gemini", "fast", 1_048_576, ("chat", "vision")),
    make_model("mock-gemini-pro", "gemini", "reasoning", 1_048_576, ("chat", "vision")),
)

# Used by the privacy-strict policy: prompts never leave the gateway.
LOCAL_MODEL = make_model("local-deterministic", "local", "fast", 8192, ("chat",))


class Registry:
    """Tracks which models exist and which are cooling down after a 429 / 5xx."""

    def __init__(self, models: Iterable[ModelInfo], clock: Callable[[], float] = time.monotonic):
        self._models = list(models)
        self._cooldown: dict[str, float] = {}
        self._clock = clock

    def set_models(self, models: Iterable[ModelInfo]) -> None:
        self._models = list(models)

    @property
    def models(self) -> list[ModelInfo]:
        return list(self._models)

    def mark_degraded(self, model_id: str, seconds: float) -> None:
        self._cooldown[model_id] = self._clock() + seconds

    def cooldown_remaining(self, model_id: str) -> int:
        return max(0, int(self._cooldown.get(model_id, 0.0) - self._clock() + 0.999))

    def is_healthy(self, model_id: str) -> bool:
        return self.cooldown_remaining(model_id) == 0

    def candidates(self) -> list[ModelInfo]:
        """Healthy chat models; if every model is cooling down, fall back to all chat models."""
        chat = [m for m in self._models if "chat" in m.capabilities]
        healthy = [m for m in chat if self.is_healthy(m.id)]
        return healthy or chat

    def snapshot(self) -> list[dict[str, object]]:
        return [
            {
                "id": m.id,
                "provider": m.provider,
                "tier": m.tier,
                "context_window": m.context_window,
                "capabilities": list(m.capabilities),
                "in_per_1m": m.in_per_1m,
                "out_per_1m": m.out_per_1m,
                "source": m.source,
                "health": "healthy" if self.is_healthy(m.id) else "degraded",
                "cooldown_s": self.cooldown_remaining(m.id),
            }
            for m in self._models
        ]
