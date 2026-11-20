"""Request log (SQLite). One row per request: the LLMOps record of what happened and what it cost.

SQLite has a single writer lock, which is fine for one gateway process. Move to PostgreSQL
before running several replicas (the schema is plain SQL).
"""

from __future__ import annotations

import sqlite3
import threading
from datetime import UTC, datetime
from typing import Any

LOG_FIELDS = (
    "request_id",
    "ts",
    "provider",
    "model",
    "policy",
    "route_reason",
    "prompt_tokens",
    "completion_tokens",
    "latency_ms",
    "cost_usd",
    "cache_hit",
    "security_flags",
    "status",
)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS requests (
    request_id TEXT PRIMARY KEY,
    ts TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    policy TEXT NOT NULL,
    route_reason TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL,
    completion_tokens INTEGER NOT NULL,
    latency_ms INTEGER NOT NULL,
    cost_usd REAL NOT NULL,
    cache_hit INTEGER NOT NULL,
    security_flags TEXT NOT NULL,
    status TEXT NOT NULL
)
"""


class RequestLog:
    def __init__(self, path: str = ":memory:"):
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock:
            self._conn.execute(_SCHEMA)
            self._conn.commit()

    def insert(self, **row: Any) -> None:
        values = {k: row[k] for k in LOG_FIELDS if k != "ts"}
        values["ts"] = row.get("ts") or datetime.now(UTC).isoformat()
        values["cache_hit"] = int(bool(values["cache_hit"]))
        if isinstance(values["security_flags"], (list, tuple)):
            values["security_flags"] = ",".join(values["security_flags"])
        cols = ", ".join(LOG_FIELDS)
        marks = ", ".join("?" for _ in LOG_FIELDS)
        with self._lock:
            self._conn.execute(
                f"INSERT INTO requests ({cols}) VALUES ({marks})",  # noqa: S608 - fixed column names
                [values[k] for k in LOG_FIELDS],
            )
            self._conn.commit()

    def recent(self, limit: int = 50) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM requests ORDER BY ts DESC, rowid DESC LIMIT ?", (limit,)
            ).fetchall()
        return [dict(r) for r in rows]

    def spend_today(self) -> float:
        today = datetime.now(UTC).date().isoformat()
        with self._lock:
            row = self._conn.execute(
                "SELECT COALESCE(SUM(cost_usd), 0) FROM requests WHERE ts >= ?", (today,)
            ).fetchone()
        return float(row[0])

    def summary(self) -> dict[str, Any]:
        with self._lock:
            rows = self._conn.execute("SELECT model, latency_ms, cost_usd, cache_hit, status FROM requests").fetchall()
        n = len(rows)
        lat = sorted(r["latency_ms"] for r in rows)

        def pct(p: float) -> int:
            return lat[min(len(lat) - 1, int(p * len(lat)))] if lat else 0

        by_model: dict[str, int] = {}
        for r in rows:
            by_model[r["model"]] = by_model.get(r["model"], 0) + 1
        return {
            "requests": n,
            "cache_hit_rate": (sum(r["cache_hit"] for r in rows) / n) if n else 0.0,
            "blocked": sum(1 for r in rows if r["status"] == "blocked"),
            "errors": sum(1 for r in rows if r["status"] == "error"),
            "p50_ms": pct(0.5),
            "p95_ms": pct(0.95),
            "total_cost_usd": round(sum(r["cost_usd"] for r in rows), 8),
            "by_model": by_model,
        }

    def close(self) -> None:
        with self._lock:
            self._conn.close()
