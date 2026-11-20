"""Run the 30-task exam under always-cheap, always-strong and smart-router; report; gate CI.

    python -m evals.benchmark                 # offline mock provider (default, zero spend)
    python -m evals.benchmark --live          # real Groq/Gemini models (needs API keys)
    python -m evals.benchmark --max-drop 0.10 --min-savings 0.30

Mock-mode numbers come from a synthetic capability profile (see app/providers.py): they prove the
harness, the router and the failover logic, NOT real model quality or real prices. Quote only
`--live` results on a resume.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import random
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.agent import Agent
from app.cache import MemoryCache
from app.config import Settings
from app.db import RequestLog
from app.discovery import discover
from app.gateway import Gateway
from app.kb import default_index
from app.models import MOCK_MODELS, ModelInfo, Registry
from app.providers import build_pool
from evals.dataset import TASKS
from evals.scorers import score

POLICIES = ("always-cheap", "always-strong", "smart-router")
ARTIFACTS = Path(__file__).resolve().parent.parent / "artifacts"


async def _no_sleep(_: float) -> None:
    return None


def _pct(values: list[float], p: float) -> float:
    s = sorted(values)
    return s[min(len(s) - 1, int(p * len(s)))] if s else 0.0


async def run_policy(policy: str, settings: Settings, models: list[ModelInfo], live: bool) -> dict[str, Any]:
    pool = build_pool(settings)
    log = RequestLog()
    gw = Gateway(
        settings,
        Registry(models),
        pool,
        log,
        MemoryCache(1, 1),
        sleep=asyncio.sleep if live else _no_sleep,
        rng=random.Random(7),
        cache_enabled=False,
    )
    agent = Agent(gw, default_index())
    rows: list[dict[str, Any]] = []
    for task in TASKS:
        gw.registry = Registry(models)  # fresh health state per task so chaos tasks cannot leak
        t0 = time.perf_counter()
        if task.mode == "agent":
            res = await agent.run(task.prompt, policy, task.chaos)
        else:
            res = await gw.chat(task.prompt, policy, task.chaos)
        wall = (time.perf_counter() - t0) * 1000
        s = score(task, res)
        rows.append(
            {
                "id": task.id,
                "category": task.category,
                "passed": s.passed,
                "correctness": s.correctness,
                "trajectory": s.trajectory,
                "compliance": s.compliance,
                "model": res["model"],
                "tier": res["tier"],
                "cost_usd": res["cost_usd"],
                "latency_ms": res["latency_ms"] if not live else round(wall),
                "tools": res.get("tools_used", []),
            }
        )
    await pool.aclose()
    log.close()
    n = len(rows)
    lat = [r["latency_ms"] for r in rows]
    cats: dict[str, list[bool]] = {}
    for r in rows:
        cats.setdefault(r["category"], []).append(r["passed"])
    return {
        "policy": policy,
        "pass_rate": sum(r["passed"] for r in rows) / n,
        "correctness": sum(r["correctness"] for r in rows) / n,
        "trajectory": sum(r["trajectory"] for r in rows) / n,
        "compliance": sum(r["compliance"] for r in rows) / n,
        "cost_usd": sum(r["cost_usd"] for r in rows),
        "latency_p50_ms": _pct(lat, 0.5),
        "latency_p95_ms": _pct(lat, 0.95),
        "by_category": {k: f"{sum(v)}/{len(v)}" for k, v in cats.items()},
        "failed": [r["id"] for r in rows if not r["passed"]],
        "rows": rows,
    }


def gate(results: dict[str, dict[str, Any]], max_drop: float, min_savings: float) -> tuple[bool, dict[str, float]]:
    smart, strong = results["smart-router"], results["always-strong"]
    drop = strong["pass_rate"] - smart["pass_rate"]
    savings = 1 - (smart["cost_usd"] / strong["cost_usd"]) if strong["cost_usd"] else 0.0
    return (drop <= max_drop and savings >= min_savings), {"pass_rate_drop": drop, "cost_savings": savings}


def markdown(results: dict[str, dict[str, Any]], g: dict[str, float], ok: bool, live: bool) -> str:
    mode = "LIVE providers" if live else "MOCK provider (synthetic capability profile; not real model quality)"
    lines = [
        "# Benchmark report",
        "",
        f"Generated {datetime.now(UTC).strftime('%Y-%m-%d %H:%M UTC')} - {len(TASKS)} tasks - **{mode}**",
        "",
        "| Policy | Pass rate | Correctness | Trajectory | Compliance | Cost (USD) | p50 ms | p95 ms |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for p in POLICIES:
        r = results[p]
        lines.append(
            f"| {p} | {r['pass_rate']:.1%} | {r['correctness']:.2f} | {r['trajectory']:.2f} | {r['compliance']:.2f} "
            f"| {r['cost_usd']:.6f} | {r['latency_p50_ms']:.0f} | {r['latency_p95_ms']:.0f} |"
        )
    lines += [
        "",
        f"smart-router vs always-strong: pass-rate drop **{g['pass_rate_drop'] * 100:.1f} points**, cost savings **{g['cost_savings']:.1%}**. CI gate: **{'PASS' if ok else 'FAIL'}**.",
        "",
        "## Pass by category",
        "",
        "| Policy | " + " | ".join(results["smart-router"]["by_category"]) + " |",
        "|---|" + "---|" * len(results["smart-router"]["by_category"]),
    ]
    for p in POLICIES:
        lines.append(f"| {p} | " + " | ".join(results[p]["by_category"].values()) + " |")
    lines += ["", "## Failed tasks", ""]
    for p in POLICIES:
        lines.append(f"- **{p}**: {', '.join(results[p]['failed']) or 'none'}")
    lines += [
        "",
        "Cost uses illustrative list prices per 1M tokens; free-tier keys cost $0. In mock mode latency is simulated from model profiles.",
    ]
    return "\n".join(lines) + "\n"


def chart(results: dict[str, dict[str, Any]], path: Path, live: bool) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    surface, ink, ink2, grid = "#fcfcfb", "#0b0b0b", "#52514e", "#e7e6e2"
    colors = {"always-cheap": "#2a78d6", "always-strong": "#eb6834", "smart-router": "#1baf7a"}
    panels = [
        ("Pass rate", "pass_rate", lambda v: f"{v:.1%}", 1.18),
        ("Cost for 30 tasks (USD)", "cost_usd", lambda v: f"${v:.5f}", None),
        ("p95 latency (ms)", "latency_p95_ms", lambda v: f"{v:.0f}", None),
    ]
    fig, axes = plt.subplots(1, 3, figsize=(13, 5.2), dpi=200, facecolor=surface)
    for ax, (title, key, fmt, ymax) in zip(axes, panels, strict=True):
        vals = [results[p][key] for p in POLICIES]
        top = ymax if ymax else max(vals) * 1.22 or 1
        ax.set_facecolor(surface)
        bars = ax.bar(range(3), vals, width=0.5, color=[colors[p] for p in POLICIES], edgecolor=surface, linewidth=2)
        for b, v in zip(bars, vals, strict=True):
            ax.text(
                b.get_x() + b.get_width() / 2,
                v + top * 0.02,
                fmt(v),
                ha="center",
                va="bottom",
                fontsize=10.5,
                color=ink,
                fontweight="normal",
            )
        ax.set_ylim(0, top)
        ax.set_xticks(
            range(3),
            [p.replace("always-", "always-\n") if p != "smart-router" else "smart-\nrouter" for p in POLICIES],
            fontsize=10,
            color=ink2,
        )
        ax.tick_params(axis="x", length=0)
        ax.tick_params(axis="y", labelsize=9, colors=ink2, length=0)
        ax.yaxis.grid(True, color=grid, linewidth=0.8)
        ax.set_axisbelow(True)
        for side in ("top", "right", "left"):
            ax.spines[side].set_visible(False)
        ax.spines["bottom"].set_color(grid)
        ax.set_title(title, fontsize=12, color=ink, loc="left", pad=12, fontweight="normal")
        if key == "pass_rate":
            ax.set_yticks([0, 0.25, 0.5, 0.75, 1.0], ["0%", "25%", "50%", "75%", "100%"])
    handles = [plt.Rectangle((0, 0), 1, 1, color=colors[p]) for p in POLICIES]
    fig.legend(
        handles,
        POLICIES,
        loc="upper right",
        ncol=3,
        frameon=False,
        fontsize=10,
        labelcolor=ink2,
        bbox_to_anchor=(0.985, 0.985),
    )
    mode = "live providers" if live else "mock provider, synthetic capability profile"
    fig.suptitle(
        "Auto-routing: cost vs pass rate and latency",
        x=0.012,
        y=0.985,
        ha="left",
        fontsize=15,
        color=ink,
        fontweight="normal",
    )
    fig.text(
        0.012, 0.915, f"Same 30-task exam under three routing policies ({mode})", fontsize=10.5, color=ink2, ha="left"
    )
    fig.tight_layout(rect=(0, 0, 1, 0.89))
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, facecolor=surface)
    plt.close(fig)


async def main_async(args: argparse.Namespace) -> int:
    base = Settings.from_env()
    if args.live:
        if not (base.groq_api_key or base.gemini_api_key):
            print("--live needs GROQ_API_KEY and/or GEMINI_API_KEY", file=sys.stderr)
            return 2
        settings = Settings.from_env({**__import__("os").environ, "MOCK_MODE": "false"})
        found = await discover(settings)
        if found.source != "live":
            print(f"live discovery failed: {found.errors}", file=sys.stderr)
            return 2
        models = found.models
    else:
        settings = Settings.from_env({"MOCK_MODE": "true"})
        models = list(MOCK_MODELS)

    results = {p: await run_policy(p, settings, models, args.live) for p in POLICIES}
    ok, g = gate(results, args.max_drop, args.min_savings)

    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    (ARTIFACTS / "benchmark_report.json").write_text(
        json.dumps(
            {
                "live": args.live,
                "gate": {"ok": ok, **g, "max_drop": args.max_drop, "min_savings": args.min_savings},
                "results": results,
            },
            indent=2,
        )
    )
    (ARTIFACTS / "benchmark_report.md").write_text(markdown(results, g, ok, args.live))
    if not args.no_chart:
        chart(results, ARTIFACTS / "benchmark_report.png", args.live)

    print(f"{'policy':<14}{'pass':>8}{'corr':>7}{'traj':>7}{'comp':>7}{'cost $':>12}{'p50':>7}{'p95':>7}")
    for p in POLICIES:
        r = results[p]
        print(
            f"{p:<14}{r['pass_rate']:>8.1%}{r['correctness']:>7.2f}{r['trajectory']:>7.2f}{r['compliance']:>7.2f}{r['cost_usd']:>12.6f}{r['latency_p50_ms']:>7.0f}{r['latency_p95_ms']:>7.0f}"
        )
    print(f"\nsmart-router vs always-strong: drop {g['pass_rate_drop'] * 100:.1f} pts, savings {g['cost_savings']:.1%}")
    print(
        f"gate (max drop {args.max_drop * 100:.0f} pts, min savings {args.min_savings:.0%}): {'PASS' if ok else 'FAIL'}"
    )
    return 0 if ok else 1


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--live", action="store_true", help="use real providers instead of the mock")
    ap.add_argument(
        "--max-drop", type=float, default=0.10, help="allowed pass-rate drop vs always-strong (default 0.10)"
    )
    ap.add_argument(
        "--min-savings", type=float, default=0.30, help="required cost savings vs always-strong (default 0.30)"
    )
    ap.add_argument("--no-chart", action="store_true")
    sys.exit(asyncio.run(main_async(ap.parse_args())))


if __name__ == "__main__":
    main()
