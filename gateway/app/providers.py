"""Providers: a deterministic mock plus Groq and Gemini over HTTP.

The mock has an explicit, documented capability profile so evals are reproducible offline:
  * fast-tier models can report ONE tool result reliably;
  * reasoning-tier models (and the local model) can combine SEVERAL tool results.
This is a synthetic profile. It proves the harness and the router logic, not real model quality;
run the benchmark with API keys (`--live`) for numbers you can put on a resume.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from app.models import ModelInfo
from app.prompts import parse_tool_results


class ProviderError(Exception):
    """kind: rate_limit | timeout | server | client"""

    def __init__(self, kind: str, status: int = 0, message: str = ""):
        super().__init__(message or f"{kind} ({status})")
        self.kind = kind
        self.status = status


@dataclass
class Completion:
    text: str
    prompt_tokens: int
    completion_tokens: int
    simulated_latency_ms: int = 0


def estimate_tokens(text: str) -> int:
    return max(1, (len(text) + 3) // 4)


class Provider(Protocol):
    async def complete(self, model: ModelInfo, prompt: str) -> Completion: ...

    async def aclose(self) -> None: ...


class MockProvider:
    async def complete(self, model: ModelInfo, prompt: str) -> Completion:
        blocks = parse_tool_results(prompt)
        if blocks:
            if len(blocks) > 1 and model.tier == "fast" and model.provider != "local":
                text = "Unable to combine multiple tool results reliably."
            else:
                text = "\n".join(blocks)
        else:
            digest = prompt.strip().replace("\n", " ")[:110]
            text = (
                f"[mock:{model.id}] Deterministic simulated reply. Set GROQ_API_KEY or "
                f"GEMINI_API_KEY to use a live model. Prompt digest: {digest}"
            )
        return Completion(text, estimate_tokens(prompt), estimate_tokens(text), model.avg_latency_ms)

    async def aclose(self) -> None:
        return None


def _raise_for_status(code: int) -> None:
    if code == 429:
        raise ProviderError("rate_limit", code)
    if code >= 500:
        raise ProviderError("server", code)
    if code >= 400:
        raise ProviderError("client", code)


class _HttpProvider:
    def __init__(self, api_key: str, timeout: float = 15.0):
        self._key = api_key
        self._timeout = timeout
        self._client = None

    def _http(self):  # noqa: ANN202
        import httpx

        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self._timeout)
        return self._client

    async def _post(self, url: str, headers: dict[str, str], body: dict) -> dict:
        import httpx

        try:
            r = await self._http().post(url, headers=headers, json=body)
        except httpx.TimeoutException as exc:
            raise ProviderError("timeout", 0) from exc
        except httpx.HTTPError as exc:
            raise ProviderError("server", 0, str(exc)) from exc
        _raise_for_status(r.status_code)
        return r.json()

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None


class GroqProvider(_HttpProvider):
    async def complete(self, model: ModelInfo, prompt: str) -> Completion:
        j = await self._post(
            "https://api.groq.com/openai/v1/chat/completions",
            {"Authorization": f"Bearer {self._key}"},
            {
                "model": model.id,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 400,
                "temperature": 0.2,
            },
        )
        text = (j.get("choices") or [{}])[0].get("message", {}).get("content", "").strip()
        usage = j.get("usage", {})
        return Completion(
            text,
            int(usage.get("prompt_tokens") or estimate_tokens(prompt)),
            int(usage.get("completion_tokens") or estimate_tokens(text)),
        )


class GeminiProvider(_HttpProvider):
    async def complete(self, model: ModelInfo, prompt: str) -> Completion:
        j = await self._post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model.id}:generateContent",
            {"x-goog-api-key": self._key},
            {
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": {"maxOutputTokens": 400, "temperature": 0.2},
            },
        )
        parts = ((j.get("candidates") or [{}])[0].get("content") or {}).get("parts") or []
        text = "".join(p.get("text", "") for p in parts).strip()
        usage = j.get("usageMetadata", {})
        return Completion(
            text,
            int(usage.get("promptTokenCount") or estimate_tokens(prompt)),
            int(usage.get("candidatesTokenCount") or estimate_tokens(text)),
        )


class ProviderPool:
    def __init__(self, providers: dict[str, Provider]):
        self._providers = providers

    def get(self, model: ModelInfo) -> Provider:
        return self._providers[model.provider]

    async def aclose(self) -> None:
        for p in {id(p): p for p in self._providers.values()}.values():
            await p.aclose()


def build_pool(settings) -> ProviderPool:  # noqa: ANN001
    mock = MockProvider()
    providers: dict[str, Provider] = {"groq": mock, "gemini": mock, "local": mock}
    if not settings.mock_mode:
        if settings.groq_api_key:
            providers["groq"] = GroqProvider(settings.groq_api_key)
        if settings.gemini_api_key:
            providers["gemini"] = GeminiProvider(settings.gemini_api_key)
    return ProviderPool(providers)
