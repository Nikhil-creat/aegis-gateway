"""FastAPI application: auth, rate limiting, discovery refresh, and the /v1 endpoints."""

from __future__ import annotations

import asyncio
import contextlib
import hmac
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

from app import __version__
from app.agent import Agent
from app.cache import CacheBackend, MemoryCache, RedisCache
from app.config import MAX_AGENT_STEPS, Settings
from app.db import RequestLog
from app.discovery import discover
from app.gateway import CHAOS_MODES, POLICIES, BudgetExceeded, Gateway, InvalidRequest
from app.idempotency import IdempotencyConflict, IdempotencyStore
from app.kb import default_index
from app.models import MOCK_MODELS, Registry
from app.prom import render as render_prometheus
from app.providers import build_pool
from app.security import SlidingWindowLimiter

LIMITS = [
    {
        "area": "Free-tier quotas",
        "limit": "Groq and Gemini free keys enforce per-minute request/token ceilings and daily caps that can change without notice.",
        "mitigation": "429 cooldowns, cross-provider failover, per-client rate limit, daily spend circuit breaker.",
    },
    {
        "area": "Cache and limiter state",
        "limit": "The default in-memory cache and rate limiter are per process; replicas do not share them.",
        "mitigation": "Set REDIS_URL for a shared cache; move the limiter to Redis before scaling out.",
    },
    {
        "area": "SQLite",
        "limit": "A single writer lock: fine for one gateway process, not for concurrent replicas.",
        "mitigation": "The schema is plain SQL; migrate to PostgreSQL before horizontal scaling.",
    },
    {
        "area": "Mock provider",
        "limit": "Mock latency, tokens and capability profile are synthetic; list prices are illustrative.",
        "mitigation": "Run the benchmark with --live for real numbers.",
    },
    {
        "area": "Redaction",
        "limit": "Regex based: no free-text name detection, and some false positives on long digit runs.",
        "mitigation": "Layer a NER model or a managed DLP service for regulated data.",
    },
]


class ChatRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=20000)
    policy: str = "smart-router"


class AgentRequest(BaseModel):
    question: str = Field(min_length=1, max_length=20000)
    policy: str = "smart-router"


class IngestRequest(BaseModel):
    doc_id: str = Field(min_length=1, max_length=64, pattern=r"^[\w\-]+$")
    text: str = Field(min_length=1, max_length=200_000)


def create_app(settings: Settings | None = None, cache: CacheBackend | None = None) -> FastAPI:
    cfg = settings or Settings.from_env()

    async def refresh_models(app: FastAPI) -> None:
        found = await discover(cfg)
        app.state.registry.set_models(found.models)
        app.state.discovery = {"source": found.source, "errors": found.errors}

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        await refresh_models(app)  # updates the same Registry object the gateway already holds

        async def loop() -> None:
            while True:
                await asyncio.sleep(600)
                with contextlib.suppress(Exception):
                    await refresh_models(app)

        task = asyncio.create_task(loop())
        yield
        task.cancel()
        await app.state.pool.aclose()
        app.state.log.close()

    app = FastAPI(title="Aegis AI Gateway", version=__version__, lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=[], allow_methods=["GET", "POST"], allow_headers=["*"])

    backend = cache or (
        RedisCache(cfg.redis_url, cfg.cache_ttl_s) if cfg.redis_url else MemoryCache(cfg.cache_max, cfg.cache_ttl_s)
    )
    registry = Registry(MOCK_MODELS)
    app.state.registry = registry
    app.state.discovery = {"source": "mock", "errors": []}
    app.state.pool = build_pool(cfg)
    app.state.log = RequestLog(cfg.db_path)
    app.state.index = default_index()
    app.state.gateway = Gateway(cfg, registry, app.state.pool, app.state.log, backend)
    app.state.agent = Agent(app.state.gateway, app.state.index)
    app.state.limiter = SlidingWindowLimiter(cfg.rate_limit_rpm)
    app.state.idem = IdempotencyStore()

    async def guard(request: Request, x_api_key: str | None = Header(default=None)) -> str:
        """API-key auth (when configured) then a per-client sliding-window rate limit."""
        if cfg.gateway_api_key and not hmac.compare_digest(x_api_key or "", cfg.gateway_api_key):
            raise HTTPException(401, "invalid or missing X-API-Key")
        client = x_api_key or (request.client.host if request.client else "anon")
        if not app.state.limiter.allow(client):
            raise HTTPException(429, "rate limit exceeded", headers={"Retry-After": "60"})
        return client

    def chaos_header(value: str | None) -> str | None:
        if value and value not in CHAOS_MODES:
            raise HTTPException(422, f"X-Chaos-Simulate must be one of {', '.join(CHAOS_MODES)}")
        return value or None

    def run_errors(exc: Exception) -> HTTPException:
        if isinstance(exc, BudgetExceeded):
            return HTTPException(503, str(exc))
        return HTTPException(422, str(exc))

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    @app.get("/v1/models", dependencies=[Depends(guard)])
    async def models() -> dict[str, Any]:
        return {**app.state.discovery, "models": registry.snapshot()}

    @app.post("/v1/chat")
    async def chat(
        body: ChatRequest,
        _c: str = Depends(guard),
        x_chaos_simulate: str | None = Header(default=None),
        idempotency_key: str | None = Header(default=None),
    ) -> dict[str, Any]:
        payload = {"prompt": body.prompt, "policy": body.policy, "chaos": x_chaos_simulate}
        if idempotency_key:
            try:
                stored = app.state.idem.get(idempotency_key, payload)
            except IdempotencyConflict as exc:
                raise HTTPException(409, str(exc)) from exc
            if stored is not None:
                return {**stored, "idempotent_replay": True}
        try:
            res = await app.state.gateway.chat(body.prompt, body.policy, chaos_header(x_chaos_simulate))
        except (InvalidRequest, BudgetExceeded) as exc:
            raise run_errors(exc) from exc
        if res["status"] == "error":
            raise HTTPException(502, res["answer"])
        if idempotency_key:
            app.state.idem.put(idempotency_key, payload, res)
        return res

    @app.post("/v1/agent/run")
    async def agent_run(
        body: AgentRequest, _c: str = Depends(guard), x_chaos_simulate: str | None = Header(default=None)
    ) -> dict[str, Any]:
        try:
            res = await app.state.agent.run(body.question, body.policy, chaos_header(x_chaos_simulate))
        except (InvalidRequest, BudgetExceeded) as exc:
            raise run_errors(exc) from exc
        if res["status"] == "error":
            raise HTTPException(502, res["answer"])
        return res

    @app.post("/v1/rag/ingest", dependencies=[Depends(guard)])
    async def ingest(body: IngestRequest) -> dict[str, Any]:
        added = app.state.index.add_text(body.doc_id, body.text)
        return {"doc_id": body.doc_id, "chunks_added": added, "total_chunks": len(app.state.index.chunks)}

    @app.get("/metrics", dependencies=[Depends(guard)], response_class=PlainTextResponse)
    async def prometheus() -> str:
        return render_prometheus(app.state.log.summary(), app.state.registry.snapshot())

    @app.get("/v1/metrics", dependencies=[Depends(guard)])
    async def metrics() -> dict[str, Any]:
        return {
            **app.state.log.summary(),
            "spend_today_usd": app.state.log.spend_today(),
            "daily_budget_usd": cfg.daily_budget_usd,
        }

    @app.get("/v1/logs", dependencies=[Depends(guard)])
    async def logs(limit: int = 50) -> list[dict[str, Any]]:
        return app.state.log.recent(max(1, min(limit, 200)))

    @app.get("/v1/system/limits")
    async def limits() -> dict[str, Any]:
        return {"policies": list(POLICIES), "max_agent_steps": MAX_AGENT_STEPS, "limitations": LIMITS}

    return app


app = create_app()
