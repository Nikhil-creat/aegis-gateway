"""Idempotency-Key support for POST /v1/chat.

Same key + same request body returns the stored response (no second provider call, no second charge).
Same key + a different body is a client bug and is reported as a conflict. In-memory, per process, bounded and
time-limited; use a shared store (Redis) if you run several replicas. Concurrent duplicates that arrive before the
first one finishes are not coalesced.
"""

from __future__ import annotations

import hashlib
import json
import time
from collections import OrderedDict
from collections.abc import Callable
from typing import Any


class IdempotencyConflict(Exception):
    pass


def fingerprint(body: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


class IdempotencyStore:
    def __init__(self, ttl_s: float = 86400.0, max_entries: int = 1024, clock: Callable[[], float] = time.monotonic):
        self.ttl_s, self.max_entries, self._clock = ttl_s, max_entries, clock
        self._items: OrderedDict[str, tuple[float, str, dict[str, Any]]] = OrderedDict()

    def get(self, key: str, body: dict[str, Any]) -> dict[str, Any] | None:
        entry = self._items.get(key)
        if entry is None:
            return None
        stored_at, fp, response = entry
        if self._clock() - stored_at > self.ttl_s:
            del self._items[key]
            return None
        if fp != fingerprint(body):
            raise IdempotencyConflict("Idempotency-Key was already used with a different request body")
        self._items.move_to_end(key)
        return response

    def put(self, key: str, body: dict[str, Any], response: dict[str, Any]) -> None:
        self._items[key] = (self._clock(), fingerprint(body), response)
        self._items.move_to_end(key)
        while len(self._items) > self.max_entries:
            self._items.popitem(last=False)
