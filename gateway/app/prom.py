"""Prometheus text exposition (format 0.0.4) for the gateway. Pure functions so they are unit-testable."""

from __future__ import annotations

from typing import Any


def _esc(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def _labels(**kv: str) -> str:
    return "{" + ",".join(f'{k}="{_esc(str(v))}"' for k, v in kv.items()) + "}" if kv else ""


def render(summary: dict[str, Any], models: list[dict[str, Any]]) -> str:
    out: list[str] = []

    def metric(name: str, kind: str, help_: str, samples: list[tuple[str, float]]) -> None:
        out.append(f"# HELP {name} {help_}")
        out.append(f"# TYPE {name} {kind}")
        for labels, value in samples:
            out.append(f"{name}{labels} {value:g}")

    metric("aegis_requests_total", "counter", "Requests handled, including blocked ones.", [("", summary["requests"])])
    metric(
        "aegis_requests_blocked_total", "counter", "Requests blocked by the security guard.", [("", summary["blocked"])]
    )
    metric(
        "aegis_request_errors_total",
        "counter",
        "Requests where every candidate model failed.",
        [("", summary["errors"])],
    )
    metric("aegis_cache_hit_ratio", "gauge", "Share of requests served from cache.", [("", summary["cache_hit_rate"])])
    metric(
        "aegis_request_latency_ms",
        "gauge",
        "Request latency percentiles in milliseconds.",
        [(_labels(quantile="0.5"), summary["p50_ms"]), (_labels(quantile="0.95"), summary["p95_ms"])],
    )
    metric("aegis_cost_usd_total", "counter", "Cumulative estimated cost in USD.", [("", summary["total_cost_usd"])])
    metric(
        "aegis_requests_by_model_total",
        "counter",
        "Requests per model.",
        [(_labels(model=m), n) for m, n in sorted(summary.get("by_model", {}).items())],
    )
    metric(
        "aegis_model_up",
        "gauge",
        "1 if the model is healthy, 0 while it is in cooldown.",
        [
            (_labels(model=m["id"], provider=m["provider"], tier=m["tier"]), 1 if m["health"] == "healthy" else 0)
            for m in models
        ],
    )
    return "\n".join(out) + "\n"
