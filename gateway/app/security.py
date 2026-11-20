"""Security: prompt-injection firewall, PII / secret redaction, sliding-window rate limiter.

Redaction is regex based, so it has false positives (a 12-digit number looks like an Aadhaar number)
and false negatives (free-text names are not detected). It is a defence-in-depth layer, not a DLP product.
"""

from __future__ import annotations

import re
import time
from collections import defaultdict, deque
from collections.abc import Callable
from dataclasses import dataclass

INJECTION: tuple[tuple[re.Pattern[str], str], ...] = (
    (
        re.compile(
            r"ignore (?:all |any |the )?(?:previous|prior|above|earlier) (?:instructions?|prompts?|rules)",
            re.I,
        ),
        "instruction-override",
    ),
    (
        re.compile(
            r"(?:reveal|show|print|repeat|leak|output).{0,40}"
            r"(?:system prompt|hidden (?:instructions|prompt)|initial instructions)",
            re.I,
        ),
        "system-prompt-extraction",
    ),
    (
        re.compile(
            r"you are now (?:in )?(?:dan|an? (?:unrestricted|unfiltered))|developer mode enabled"
            r"|\bjailbreak(?:ed)?\b",
            re.I,
        ),
        "role-override",
    ),
    (
        re.compile(r"disregard (?:your|the|all) (?:rules|guidelines|polic(?:y|ies)|safety)", re.I),
        "policy-bypass",
    ),
    (re.compile(r"<\s*/?\s*(?:system|assistant)\s*>|\[\s*INST\s*\]", re.I), "delimiter-smuggling"),
)

# (pattern, label, replacement token). Order matters: long digit runs are claimed before phones.
PII: tuple[tuple[re.Pattern[str], str, str], ...] = (
    (re.compile(r"\bgsk_[A-Za-z0-9]{20,}\b"), "api_key", "[REDACTED_KEY]"),
    (re.compile(r"\bAIza[0-9A-Za-z_\-]{30,}\b"), "api_key", "[REDACTED_KEY]"),
    (re.compile(r"\b\d{4}\s?\d{4}\s?\d{4}\b"), "aadhaar", "[AADHAAR]"),
    (re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b"), "pan", "[PAN]"),
    (re.compile(r"\b\d{3}-\d{2}-\d{4}\b"), "ssn", "[SSN]"),
    (re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}"), "email", "[EMAIL]"),
    (re.compile(r"(?:\+91[\s-]?|91[\s-]?)?\b[6-9]\d{9}\b"), "phone", "[PHONE]"),
)


@dataclass(frozen=True)
class Redaction:
    text: str
    flags: tuple[str, ...]
    count: int


def scan_injection(text: str) -> list[str]:
    return [label for pattern, label in INJECTION if pattern.search(text)]


def redact(text: str) -> Redaction:
    out = text
    count = 0
    flags: list[str] = []
    for pattern, label, token in PII:
        out, n = pattern.subn(token, out)
        if n:
            count += n
            if label not in flags:
                flags.append(label)
    return Redaction(out, tuple(flags), count)


class SlidingWindowLimiter:
    """Allow at most `limit` events per key inside any `window_s` seconds (in-memory, per process)."""

    def __init__(self, limit: int, window_s: float = 60.0, clock: Callable[[], float] = time.monotonic):
        self.limit = limit
        self.window_s = window_s
        self._clock = clock
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str) -> bool:
        now = self._clock()
        q = self._hits[key]
        while q and now - q[0] >= self.window_s:
            q.popleft()
        if len(q) >= self.limit:
            return False
        q.append(now)
        return True
