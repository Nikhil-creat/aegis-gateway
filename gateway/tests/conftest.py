from __future__ import annotations

import asyncio
import random

import pytest

from app.cache import MemoryCache
from app.config import Settings
from app.db import RequestLog
from app.gateway import Gateway
from app.models import MOCK_MODELS, Registry
from app.providers import MockProvider, ProviderError, ProviderPool


def run(coro):
    return asyncio.run(coro)


async def _no_sleep(_):
    return None


class ScriptedProvider:
    """Records every prompt it receives; raises the scripted error for given model ids."""

    def __init__(self, fail: dict[str, str] | None = None):
        self.fail = fail or {}
        self.prompts: list[str] = []
        self.models: list[str] = []
        self._mock = MockProvider()

    async def complete(self, model, prompt):
        self.prompts.append(prompt)
        self.models.append(model.id)
        if model.id in self.fail:
            raise ProviderError(self.fail[model.id], 429 if self.fail[model.id] == "rate_limit" else 500)
        return await self._mock.complete(model, prompt)

    async def aclose(self):
        return None


@pytest.fixture
def make_gateway():
    def _make(provider=None, settings=None, cache_enabled=True, models=MOCK_MODELS):
        s = settings or Settings(mock_mode=True)
        p = provider or ScriptedProvider()
        pool = ProviderPool({"groq": p, "gemini": p, "local": p})
        gw = Gateway(
            s,
            Registry(models),
            pool,
            RequestLog(),
            MemoryCache(32, 60),
            sleep=_no_sleep,
            rng=random.Random(1),
            cache_enabled=cache_enabled,
        )
        return gw, p

    return _make
