"""Built-in knowledge base: facts about this gateway's own behaviour.

Every statement here is true of the code in this repository (the tests assert it), so evaluation
answers are checkable without trusting an LLM judge.
"""

from __future__ import annotations

from app.rag import Chunk, HybridIndex

DEFAULT_CHUNKS: tuple[Chunk, ...] = (
    Chunk(
        "gateway-config",
        "c1",
        "The gateway response cache uses an exact SHA-256 match with a default TTL of 300 seconds and holds at most 512 entries.",
    ),
    Chunk(
        "gateway-config",
        "c2",
        "The default rate limit is 60 requests per minute per client. Requests over the limit receive HTTP 429.",
    ),
    Chunk(
        "gateway-config",
        "c3",
        "The daily spend circuit breaker defaults to 1.00 USD. When it trips the gateway returns HTTP 503.",
    ),
    Chunk("gateway-config", "c4", "The agent is bounded to 5 steps. Tool calls beyond the limit are dropped."),
    Chunk(
        "routing",
        "c1",
        "The smart-router scores prompt difficulty from length, code, math notation, multi-step cues and JSON constraints. A difficulty of 0.5 or higher selects the reasoning tier.",
    ),
    Chunk(
        "routing",
        "c2",
        "Routing policies are smart-router, always-cheap, always-strong, latency-optimized and privacy-strict.",
    ),
    Chunk(
        "routing",
        "c3",
        "privacy-strict never leaves the gateway: the local deterministic model answers after mandatory redaction.",
    ),
    Chunk(
        "reliability",
        "c1",
        "When a provider returns HTTP 429 the model is put in a 60 second cooldown. For 5xx errors and timeouts the cooldown is 30 seconds.",
    ),
    Chunk(
        "reliability",
        "c2",
        "Retries use exponential backoff with full jitter, and the first fallback prefers a different provider.",
    ),
    Chunk("reliability", "c3", "The gateway tries at most 4 models per request."),
    Chunk(
        "security",
        "c1",
        "The injection firewall blocks instruction overrides, system prompt extraction, role overrides, policy bypass and delimiter smuggling before any provider is called.",
    ),
    Chunk(
        "security",
        "c2",
        "PII redaction masks emails, phone numbers, Aadhaar, PAN, SSN and API keys beginning gsk_ or AIza before provider calls and before logging.",
    ),
    Chunk(
        "models",
        "c1",
        "Groq models are discovered from the models endpoint; audio, guard and embedding models are filtered out.",
    ),
    Chunk(
        "models",
        "c2",
        "Gemini models are discovered from the v1beta models endpoint and kept only if they support generateContent.",
    ),
)


def default_index() -> HybridIndex:
    return HybridIndex(list(DEFAULT_CHUNKS))
