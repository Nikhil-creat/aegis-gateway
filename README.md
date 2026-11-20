# Aegis AI Gateway

**Auto-routing, LLMOps and agent evals in one gateway.** A FastAPI service that sends each LLM request to the cheapest model that can answer it, fails over when a provider breaks, logs model, tokens, latency and cost for every call, and grades its own agent on a fixed 30-task exam that gates CI.

Repo layout: `gateway/` is the Python service and eval harness. `web/` is the website with a live playground, deployed on Vercel.

## What it does

```
client ──► Guard ──► Router ──► Cache ──► Provider (Groq / Gemini)
           │ inject    │ difficulty │ SHA-256     │ 429/5xx/timeout
           │ PII       │ score      │ exact       ▼
           │ rate/$    ▼            ▼          cooldown + next model
           └────────► SQLite request log (every outcome, incl. blocked)
```

| Area | What is implemented |
|---|---|
| Routing | Heuristic difficulty score (length, code, math, multi-step cues, JSON constraint) → fast or reasoning tier. Five policies: smart-router, always-cheap, always-strong, latency-optimized, privacy-strict. |
| Model discovery | Reads Groq and Gemini model lists at startup and every 10 min, classifies into tiers by name and capability. Falls back to a mock registry with no keys. |
| Reliability | 429 → 60 s cooldown, 5xx/timeout → 30 s. Full-jitter backoff, max 4 attempts, first fallback prefers another provider. |
| LLMOps | SQLite log of model, tokens, latency, cost, status and trace. Exact-match cache (memory or Redis). Daily spend breaker. `/v1/metrics` with p50/p95. |
| Security | Injection firewall, PII redaction before routing/cache/logging, sliding-window rate limit, optional API key (constant-time compare), AST-allow-listed calculator (no `eval`). |
| Agent | Planner → security check → tools (calculator, hybrid RAG, telemetry) → verifier → synthesizer. Max 5 steps; refuses with "Insufficient grounded context" below the retrieval threshold. |
| Retrieval | BM25 + hashed char-trigram vectors, fused with reciprocal rank fusion. |
| Evals | 30 tasks, three deterministic scorers (correctness, trajectory, compliance), CI gate on pass-rate drop and cost savings. |
| Chaos | `X-Chaos-Simulate: rate_limit \| timeout \| provider_500` fails the first model on demand. |

## Results (mock provider: synthetic)

| Policy | Pass rate | Cost (30 tasks) | p95 latency |
|---|---|---|---|
| always-cheap | 76.7% | $0.000142 | 260 ms |
| smart-router | 93.3% | $0.000542 | 450 ms |
| always-strong | 100% | $0.001815 | 900 ms |

Smart routing is 70.2% cheaper than always-strong and gives up 6.7 points of pass rate. It fails two multi-hop tasks that carry no wording cues (`hop-06`, `hop-07`). That weakness is left in on purpose.

> **These numbers come from a deterministic mock provider** whose fast-tier models can only combine one tool result. They make runs repeatable, not realistic. Do not put them on a resume. Run `--live` and use those.

## Run it

```bash
cd gateway
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
pytest -q                                  # 76 tests
python -m evals.benchmark                  # mock run + CI gate
cp .env.example .env                       # add GROQ_API_KEY / GEMINI_API_KEY (never commit .env)
python -m evals.benchmark --live           # real numbers for your resume
uvicorn app.main:app --reload              # http://localhost:8000/docs
docker compose up --build                  # gateway + redis
```

```bash
cd web
npm install
npm run dev          # build + serve at http://localhost:4173
npm test             # typecheck, Python/TS parity, build, SEO and bundle audit
```

## Resume bullet (fill X and Y from your own `--live` run)

> Built an LLM gateway (FastAPI, async, Groq + Gemini) that auto-routes requests between cheap and strong models and fails over on 429/5xx; on a 30-task agent eval, smart routing cut cost by **X%** versus always-strong while keeping pass rate within **Y** points, enforced as a CI gate.

Never type X or Y from a guess. They are in `gateway/artifacts/benchmark_report.md` after a live run.

## Interview questions this project answers

- **How does the router decide?** Difficulty = score/6 from six signals; ≥ 0.5 selects the reasoning tier; reasons are returned with every response.
- **How do you evaluate an agent?** Correctness, trajectory and compliance scorers; a task passes only if all three are 1.0; no LLM judge.
- **How is cost calculated? What about timeouts?** `tokens/1M × price` from the provider's usage field; provider calls time out at 15 s and count as a failover trigger.
- **Why not LiteLLM?** Use it in production. Here the point is to build and explain the mechanics.

## Honest scope

Implemented and tested: everything above except the items below. `gateway/tests/test_api.py` covers the FastAPI layer and skips itself when `fastapi`/`httpx` are not installed, so run `pytest` in a full environment before relying on it.

Not implemented: learned (CNN) router, human-in-the-loop approval, SSE streaming, idempotency keys, LangGraph runtime, PostgreSQL (SQLite is the store), shared rate limiter across replicas. The website playground runs a TypeScript port of the engine, verified against Python for identical model, tier, tools and cost on 90 task runs (`npm run parity`).

## Deploy

1. Push this repo to GitHub as `aegis-gateway`.
2. Vercel → Add New Project → import it → **Root Directory: `web`**. Build settings come from `web/vercel.json`.
3. Set `SITE_URL` (your final domain) and optional `GROQ_API_KEY`, `GEMINI_API_KEY`, `RESEND_API_KEY`, `CONTACT_TO_EMAIL`.
4. Deploy the Python gateway separately (Render, Fly.io or Railway) from `gateway/Dockerfile`.

MIT licensed.
