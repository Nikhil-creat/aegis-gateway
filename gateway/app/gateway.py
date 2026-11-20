"""Gateway service: security -> route -> cache -> provider call with failover -> log.

Every request, including blocked ones, produces exactly one row in the request log.
"""

from __future__ import annotations

import asyncio
import random
import time
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from app.cache import CacheBackend, cache_key
from app.config import Settings
from app.db import RequestLog
from app.models import Registry
from app.providers import ProviderError, ProviderPool
from app.router import plan_route
from app.security import redact, scan_injection

POLICIES = ("smart-router", "always-cheap", "always-strong", "latency-optimized", "privacy-strict")
CHAOS_MODES = ("rate_limit", "timeout", "provider_500")
BACKOFF_BASE_S = 0.25
BACKOFF_CAP_S = 8.0
CALL_TIMEOUT_S = 20.0
RATE_LIMIT_COOLDOWN_S = 60


class BudgetExceeded(Exception):
    pass


class InvalidRequest(ValueError):
    pass


_KIND = {"rate_limit": "rate_limit", "timeout": "timeout", "provider_500": "server"}


class Gateway:
    def __init__(
        self,
        settings: Settings,
        registry: Registry,
        pool: ProviderPool,
        log: RequestLog,
        cache: CacheBackend,
        *,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        rng: random.Random | None = None,
        cache_enabled: bool = True,
    ):
        self.settings = settings
        self.registry = registry
        self.pool = pool
        self.log = log
        self.cache = cache
        self._sleep = sleep
        self._rng = rng or random.Random()
        self.cache_enabled = cache_enabled

    # ------------------------------------------------------------------ helpers
    def _backoff(self, attempt: int) -> float:
        """Full jitter: uniform(0, min(cap, base * 2^attempt))."""
        return self._rng.uniform(0.0, min(BACKOFF_CAP_S, BACKOFF_BASE_S * (2**attempt)))

    def _base(self, policy: str, redaction, flags: list[str]) -> dict[str, Any]:  # noqa: ANN001
        return {
            "request_id": uuid.uuid4().hex,
            "policy": policy,
            "provider": "none",
            "model": "-",
            "tier": "fast",
            "route_reason": "",
            "confidence": 0.0,
            "difficulty": 0.0,
            "signals": [],
            "security_flags": flags,
            "redactions": redaction.count,
            "sanitized_prompt": redaction.text,
            "blocked": False,
            "status": "ok",
            "answer": "",
            "cache_hit": False,
            "latency_ms": 0,
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "cost_usd": 0.0,
            "baseline_cost_usd": 0.0,
            "saved_usd": 0.0,
            "attempts": [],
            "trace": [],
        }

    def _write_log(self, res: dict[str, Any]) -> None:
        self.log.insert(
            request_id=res["request_id"],
            provider=res["provider"],
            model=res["model"],
            policy=res["policy"],
            route_reason=res["route_reason"],
            prompt_tokens=res["prompt_tokens"],
            completion_tokens=res["completion_tokens"],
            latency_ms=res["latency_ms"],
            cost_usd=res["cost_usd"],
            cache_hit=res["cache_hit"],
            security_flags=res["security_flags"],
            status=res["status"],
        )

    def record_local(self, policy: str, prompt: str, reason: str, answer: str) -> dict[str, Any]:
        """Log a request answered without any provider call (e.g. the agent refusing to guess)."""
        red = redact(prompt)
        res = self._base(policy, red, [f"pii:{f}" for f in red.flags])
        res.update(route_reason=reason, answer=answer, model="gateway-local")
        self._write_log(res)
        return res

    # --------------------------------------------------------------------- chat
    async def chat(
        self,
        prompt: str,
        policy: str = "smart-router",
        chaos: str | None = None,
        route_text: str | None = None,
    ) -> dict[str, Any]:
        t0 = time.perf_counter()
        trace: list[dict[str, Any]] = []

        def ms() -> int:
            return int((time.perf_counter() - t0) * 1000)

        def mark(node: str, detail: str) -> None:
            trace.append({"node": node, "detail": detail, "ms": ms()})

        if policy not in POLICIES:
            raise InvalidRequest(f"unknown policy '{policy}'")
        if not prompt.strip():
            raise InvalidRequest("prompt is empty")
        if len(prompt) > self.settings.max_prompt_chars:
            raise InvalidRequest("prompt too large")
        if chaos is not None and chaos not in CHAOS_MODES:
            raise InvalidRequest(f"unknown chaos mode '{chaos}'")
        if chaos and not self.settings.allow_chaos:
            chaos = None
        if self.log.spend_today() >= self.settings.daily_budget_usd:
            raise BudgetExceeded("daily budget circuit breaker is open")

        injection = scan_injection(prompt)
        red = redact(prompt)
        flags = [f"injection:{f}" for f in injection] + [f"pii:{f}" for f in red.flags]
        res = self._base(policy, red, flags)
        res["trace"] = trace
        mark("security_check", ", ".join(flags) if flags else "clean: no injection or PII patterns")

        if injection:
            res.update(
                blocked=True,
                status="blocked",
                route_reason="Blocked pre-inference by the prompt-injection firewall. "
                "No provider was called, so no tokens were spent.",
                answer=f"Request blocked: {', '.join(injection)}.",
                latency_ms=ms(),
            )
            self._write_log(res)
            return res

        routed = redact(route_text).text if route_text else red.text
        route = plan_route(routed, policy, self.registry)
        res.update(
            tier=route.tier,
            route_reason=route.reason,
            confidence=route.confidence,
            difficulty=route.analysis.difficulty,
            signals=list(route.analysis.signals),
        )
        mark("router", f"{policy} -> {route.chain[0].id} ({route.tier})")

        key = cache_key(policy, red.text)
        if self.cache_enabled and chaos is None:
            hit = self.cache.get(key)
            if hit is not None:
                res.update(
                    {
                        k: hit[k]
                        for k in (
                            "provider",
                            "model",
                            "tier",
                            "answer",
                            "prompt_tokens",
                            "completion_tokens",
                            "baseline_cost_usd",
                        )
                    }
                )
                res.update(
                    cache_hit=True,
                    cost_usd=0.0,
                    saved_usd=hit["baseline_cost_usd"],
                    latency_ms=ms(),
                )
                mark("cache", "exact SHA-256 hit, provider skipped")
                self._write_log(res)
                return res

        chosen = None
        completion = None
        for model in route.chain[: self.settings.max_attempts]:
            n = len(res["attempts"])
            if chaos and n == 0 and model.provider != "local":
                outcome, backoff = chaos, self._backoff(0)
                res["attempts"].append(
                    {
                        "model": model.id,
                        "provider": model.provider,
                        "outcome": outcome,
                        "backoff_ms": int(backoff * 1000),
                    }
                )
                self.registry.mark_degraded(
                    model.id, RATE_LIMIT_COOLDOWN_S if chaos == "rate_limit" else self.settings.cooldown_s
                )
                mark("failover", f"{model.id}: simulated {outcome}; backoff {int(backoff * 1000)}ms")
                await self._sleep(backoff)
                continue
            try:
                completion = await asyncio.wait_for(
                    self.pool.get(model).complete(model, red.text),  # always the redacted text
                    CALL_TIMEOUT_S,
                )
                res["attempts"].append(
                    {"model": model.id, "provider": model.provider, "outcome": "ok", "backoff_ms": 0}
                )
                chosen = model
                break
            except (ProviderError, TimeoutError) as exc:
                kind = exc.kind if isinstance(exc, ProviderError) else "timeout"
                backoff = self._backoff(n)
                res["attempts"].append(
                    {"model": model.id, "provider": model.provider, "outcome": kind, "backoff_ms": int(backoff * 1000)}
                )
                self.registry.mark_degraded(
                    model.id, RATE_LIMIT_COOLDOWN_S if kind == "rate_limit" else self.settings.cooldown_s
                )
                mark("failover", f"{model.id}: {kind}; backoff {int(backoff * 1000)}ms")
                await self._sleep(backoff)

        if chosen is None or completion is None:
            res.update(
                status="error",
                answer="All candidate models are cooling down or failing. Try again shortly.",
                latency_ms=ms(),
            )
            self._write_log(res)
            return res

        strongest = max(self.registry.candidates() or [chosen], key=lambda m: m.in_per_1m + m.out_per_1m)
        cost = chosen.cost(completion.prompt_tokens, completion.completion_tokens)
        baseline = strongest.cost(completion.prompt_tokens, completion.completion_tokens)
        res.update(
            provider=chosen.provider,
            model=chosen.id,
            tier=chosen.tier,
            answer=completion.text,
            prompt_tokens=completion.prompt_tokens,
            completion_tokens=completion.completion_tokens,
            cost_usd=cost,
            baseline_cost_usd=baseline,
            saved_usd=max(0.0, baseline - cost),
            latency_ms=ms() + completion.simulated_latency_ms,
        )
        mark("provider", f"{chosen.id} answered")
        if self.cache_enabled and chaos is None:
            self.cache.set(
                key,
                {
                    k: res[k]
                    for k in (
                        "provider",
                        "model",
                        "tier",
                        "answer",
                        "prompt_tokens",
                        "completion_tokens",
                        "baseline_cost_usd",
                    )
                },
            )
        self._write_log(res)
        return res
