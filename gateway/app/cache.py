"""Response cache: exact-match (SHA-256 of policy + redacted prompt) behind a swappable backend."""

from __future__ import annotations

import hashlib
import json
import time
from abc import ABC, abstractmethod
from collections import OrderedDict
from collections.abc import Callable
from typing import Any


def cache_key(policy: str, prompt: str) -> str:
    return hashlib.sha256(f"{policy}|{prompt}".encode()).hexdigest()


class CacheBackend(ABC):
    @abstractmethod
    def get(self, key: str) -> dict[str, Any] | None: ...

    @abstractmethod
    def set(self, key: str, value: dict[str, Any]) -> None: ...

    @abstractmethod
    def clear(self) -> None: ...


class MemoryCache(CacheBackend):
    """LRU + TTL, per process. Use RedisCache when running more than one replica."""

    def __init__(self, max_entries: int, ttl_s: float, clock: Callable[[], float] = time.monotonic):
        self._max = max_entries
        self._ttl = ttl_s
        self._clock = clock
        self._data: OrderedDict[str, tuple[float, dict[str, Any]]] = OrderedDict()

    def get(self, key: str) -> dict[str, Any] | None:
        item = self._data.get(key)
        if item is None:
            return None
        expires, value = item
        if self._clock() >= expires:
            del self._data[key]
            return None
        self._data.move_to_end(key)
        return value

    def set(self, key: str, value: dict[str, Any]) -> None:
        self._data[key] = (self._clock() + self._ttl, value)
        self._data.move_to_end(key)
        while len(self._data) > self._max:
            self._data.popitem(last=False)

    def clear(self) -> None:
        self._data.clear()

    def __len__(self) -> int:
        return len(self._data)


class RedisCache(CacheBackend):
    """Drop-in shared cache. Requires `pip install redis`; uses the synchronous client."""

    def __init__(self, url: str, ttl_s: int, prefix: str = "aegis:"):
        import redis

        self._r = redis.Redis.from_url(url, decode_responses=True)
        self._ttl = ttl_s
        self._prefix = prefix

    def get(self, key: str) -> dict[str, Any] | None:
        raw = self._r.get(self._prefix + key)
        return json.loads(raw) if raw else None

    def set(self, key: str, value: dict[str, Any]) -> None:
        self._r.set(self._prefix + key, json.dumps(value), ex=self._ttl)

    def clear(self) -> None:
        for k in self._r.scan_iter(self._prefix + "*"):
            self._r.delete(k)
