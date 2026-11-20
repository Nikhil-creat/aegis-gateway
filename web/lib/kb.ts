// GENERATED from gateway/app/kb.py by scripts/gen-fixtures.py. Do not edit by hand.
export interface KBChunk { doc: string; id: string; text: string }
export const DEFAULT_CHUNKS: KBChunk[] = [
  {
    "doc": "gateway-config",
    "id": "c1",
    "text": "The gateway response cache uses an exact SHA-256 match with a default TTL of 300 seconds and holds at most 512 entries."
  },
  {
    "doc": "gateway-config",
    "id": "c2",
    "text": "The default rate limit is 60 requests per minute per client. Requests over the limit receive HTTP 429."
  },
  {
    "doc": "gateway-config",
    "id": "c3",
    "text": "The daily spend circuit breaker defaults to 1.00 USD. When it trips the gateway returns HTTP 503."
  },
  {
    "doc": "gateway-config",
    "id": "c4",
    "text": "The agent is bounded to 5 steps. Tool calls beyond the limit are dropped."
  },
  {
    "doc": "routing",
    "id": "c1",
    "text": "The smart-router scores prompt difficulty from length, code, math notation, multi-step cues and JSON constraints. A difficulty of 0.5 or higher selects the reasoning tier."
  },
  {
    "doc": "routing",
    "id": "c2",
    "text": "Routing policies are smart-router, always-cheap, always-strong, latency-optimized and privacy-strict."
  },
  {
    "doc": "routing",
    "id": "c3",
    "text": "privacy-strict never leaves the gateway: the local deterministic model answers after mandatory redaction."
  },
  {
    "doc": "reliability",
    "id": "c1",
    "text": "When a provider returns HTTP 429 the model is put in a 60 second cooldown. For 5xx errors and timeouts the cooldown is 30 seconds."
  },
  {
    "doc": "reliability",
    "id": "c2",
    "text": "Retries use exponential backoff with full jitter, and the first fallback prefers a different provider."
  },
  {
    "doc": "reliability",
    "id": "c3",
    "text": "The gateway tries at most 4 models per request."
  },
  {
    "doc": "security",
    "id": "c1",
    "text": "The injection firewall blocks instruction overrides, system prompt extraction, role overrides, policy bypass and delimiter smuggling before any provider is called."
  },
  {
    "doc": "security",
    "id": "c2",
    "text": "PII redaction masks emails, phone numbers, Aadhaar, PAN, SSN and API keys beginning gsk_ or AIza before provider calls and before logging."
  },
  {
    "doc": "models",
    "id": "c1",
    "text": "Groq models are discovered from the models endpoint; audio, guard and embedding models are filtered out."
  },
  {
    "doc": "models",
    "id": "c2",
    "text": "Gemini models are discovered from the v1beta models endpoint and kept only if they support generateContent."
  }
];
