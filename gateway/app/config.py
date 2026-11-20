"""Runtime settings, read from environment variables (see .env.example)."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass

MAX_AGENT_STEPS = 5


def _flag(value: str | None, default: bool) -> bool:
    if value is None or value.strip() == "":
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    groq_api_key: str = ""
    gemini_api_key: str = ""
    # With no API keys the gateway runs against the deterministic mock provider (zero spend).
    mock_mode: bool = True
    db_path: str = "gateway.db"
    daily_budget_usd: float = 1.0
    gateway_api_key: str = ""  # when set, every request must send X-API-Key
    allow_chaos: bool = True  # honour the X-Chaos-Simulate header
    cache_ttl_s: int = 300
    cache_max: int = 512
    max_prompt_chars: int = 8000
    rate_limit_rpm: int = 60
    cooldown_s: int = 30
    max_attempts: int = 4
    redis_url: str = ""

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> Settings:
        e = os.environ if env is None else env
        has_keys = bool(e.get("GROQ_API_KEY") or e.get("GEMINI_API_KEY"))
        return cls(
            groq_api_key=e.get("GROQ_API_KEY", ""),
            gemini_api_key=e.get("GEMINI_API_KEY", ""),
            mock_mode=_flag(e.get("MOCK_MODE"), default=not has_keys),
            db_path=e.get("DB_PATH", "gateway.db"),
            daily_budget_usd=float(e.get("DAILY_BUDGET_USD", "1.0")),
            gateway_api_key=e.get("GATEWAY_API_KEY", ""),
            allow_chaos=_flag(e.get("ALLOW_CHAOS"), default=True),
            cache_ttl_s=int(e.get("CACHE_TTL_S", "300")),
            cache_max=int(e.get("CACHE_MAX", "512")),
            max_prompt_chars=int(e.get("MAX_PROMPT_CHARS", "8000")),
            rate_limit_rpm=int(e.get("RATE_LIMIT_RPM", "60")),
            cooldown_s=int(e.get("COOLDOWN_S", "30")),
            max_attempts=int(e.get("MAX_ATTEMPTS", "4")),
            redis_url=e.get("REDIS_URL", ""),
        )
