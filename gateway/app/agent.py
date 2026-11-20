"""Bounded agent: planner -> security_check -> tool_executor -> reflection_verifier -> synthesizer.

All model calls go through the Gateway (routing, fallback, logging, cost). The planner is rule based
on purpose: deterministic, free, and easy to explain. Tools are sandboxed (AST calculator, in-memory
retrieval, read-only telemetry).
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from typing import Any

from app.config import MAX_AGENT_STEPS
from app.gateway import Gateway
from app.prompts import build_synthesis_prompt
from app.rag import HybridIndex, tokenize
from app.security import scan_injection
from app.tools import extract_math, fmt_number, safe_calculator

REFUSAL = "Insufficient grounded context"
_SPLIT = re.compile(r"\s*(?:;|\band then\b|\bthen\b|\band also\b|[.?!](?:\s+|$))\s*", re.I)
_TELEMETRY = re.compile(r"\b(?:telemetry|live metrics|p50|p95|request log)\b", re.I)


@dataclass(frozen=True)
class ToolCall:
    tool: str  # safe_calculator | hybrid_rag_search | gateway_telemetry_tool
    arg: str


def plan_steps(question: str) -> list[ToolCall]:
    calls: list[ToolCall] = []
    for clause in (c.strip(" ,") for c in _SPLIT.split(question)):
        if len(clause) < 3:
            continue
        expr = extract_math(clause)
        if expr is not None:
            call = ToolCall("safe_calculator", expr)
        elif _TELEMETRY.search(clause):
            call = ToolCall("gateway_telemetry_tool", clause)
        elif len(tokenize(clause)) >= 2:
            call = ToolCall("hybrid_rag_search", clause)
        else:
            continue
        if not calls or calls[-1] != call:
            calls.append(call)
    return calls


class Agent:
    def __init__(self, gateway: Gateway, index: HybridIndex, max_steps: int = MAX_AGENT_STEPS):
        self.gateway = gateway
        self.index = index
        self.max_steps = max_steps

    async def run(self, question: str, policy: str = "smart-router", chaos: str | None = None) -> dict[str, Any]:
        t0 = time.perf_counter()
        trace: list[dict[str, Any]] = []

        def mark(node: str, detail: str) -> None:
            trace.append({"node": node, "detail": detail, "ms": int((time.perf_counter() - t0) * 1000)})

        calls = plan_steps(question)
        truncated = len(calls) > self.max_steps
        calls = calls[: self.max_steps]
        mark("planner", " -> ".join(c.tool for c in calls) or "no tools needed (answer directly)")

        def finish(res: dict[str, Any], tools: list[str], citations: list[str]) -> dict[str, Any]:
            res["tools_used"] = tools
            res["steps"] = len(tools)
            res["citations"] = citations
            res["truncated"] = truncated
            res["trace"] = trace + res.get("trace", [])
            return res

        if scan_injection(question):
            mark("security_check", "injection detected; no tools executed")
            return finish(await self.gateway.chat(question, policy, chaos), [], [])
        mark("security_check", "clean")

        if not calls:
            return finish(await self.gateway.chat(question, policy, chaos), [], [])

        outputs: list[str] = []
        tools: list[str] = []
        citations: list[str] = []
        any_grounded = False
        rag_attempted = False
        for call in calls:
            tools.append(call.tool)
            if call.tool == "safe_calculator":
                value = fmt_number(safe_calculator(call.arg))
                outputs.append(f"{call.arg} = {value}")
                any_grounded = True
                mark("tool_executor", f"safe_calculator({call.arg}) = {value}")
            elif call.tool == "gateway_telemetry_tool":
                s = self.gateway.log.summary()
                outputs.append(
                    f"requests={s['requests']}, cache_hit_rate={s['cache_hit_rate']:.2f}, blocked={s['blocked']}, "
                    f"p50_ms={s['p50_ms']}, p95_ms={s['p95_ms']}, total_cost_usd={s['total_cost_usd']}"
                )
                any_grounded = True
                mark("tool_executor", "gateway_telemetry_tool -> live metrics")
            else:
                rag_attempted = True
                grounded, hits = self.index.search(call.arg, k=1)
                if grounded:
                    h = hits[0]
                    outputs.append(f"{h.chunk.text} {h.chunk.cite}")
                    citations.append(h.chunk.cite)
                    any_grounded = True
                    mark(
                        "tool_executor", f"hybrid_rag_search -> {h.chunk.cite} (bm25 {h.bm25:.2f}, cos {h.cosine:.2f})"
                    )
                else:
                    outputs.append(f"{REFUSAL} for: {call.arg}")
                    mark("tool_executor", f"hybrid_rag_search -> below threshold for '{call.arg}'")

        mark(
            "reflection_verifier",
            "grounded evidence present" if any_grounded else "no grounded evidence: refuse to guess",
        )
        if rag_attempted and not any_grounded:
            res = self.gateway.record_local(
                policy,
                question,
                "agent refused: retrieval below the relevance threshold",
                f"{REFUSAL}. Retrieval scores were below the threshold, so the agent declined to guess.",
            )
            return finish(res, tools, [])

        res = await self.gateway.chat(build_synthesis_prompt(question, outputs), policy, chaos, route_text=question)
        mark("final_synthesizer", f"{res['model']} composed the answer")
        return finish(res, tools, citations)
