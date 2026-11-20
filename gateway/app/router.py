"""Auto-router: score the prompt, pick a tier, then build an ordered chain of models.

Heuristics (all inspectable, all logged as `route_reason`):
  length, code, math notation, multi-step reasoning/sequencing cues, strict-JSON constraints.
Known weakness (by design, shown in the evals): a short prompt that hides a multi-hop task has no
cues, so it is routed to the cheap tier. A learned classifier trained on eval logs is the next step.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass

from app.learned_router import get_model
from app.models import LOCAL_MODEL, ModelInfo, Registry

_CODE = re.compile(r"```|\b(?:def|class|function|import)\b")
_MATH = re.compile(r"[∫∑√∂]|\\frac|\b(?:integral|derivative|theorem|prove)\b", re.I)
_CUES = re.compile(
    r"\b(?:step[- ]by[- ]step|compare|analy[sz]e|design|architecture|trade-?offs?|why|evaluate"
    r"|optimi[sz]e|then|after that|first|next|combine|both|derive|explain"
    r"|which is (?:larger|bigger|greater|higher|smaller))\b",
    re.I,
)
_JSON = re.compile(r"json schema|respond (?:only )?in json|strict json", re.I)

REASONING_THRESHOLD = 0.5


@dataclass(frozen=True)
class Analysis:
    difficulty: float
    tier: str
    signals: tuple[str, ...]


@dataclass(frozen=True)
class Route:
    chain: tuple[ModelInfo, ...]
    tier: str
    reason: str
    confidence: float
    analysis: Analysis


def analyze(prompt: str) -> Analysis:
    signals: list[str] = []
    score = 0.0
    tokens = (len(prompt) + 3) // 4
    if tokens > 400:
        score += 2
        signals.append(f"long input (~{tokens} tokens)")
    elif tokens > 120:
        score += 1
        signals.append(f"medium input (~{tokens} tokens)")
    if _CODE.search(prompt):
        score += 2
        signals.append("code content")
    if _MATH.search(prompt):
        score += 1.5
        signals.append("mathematical notation")
    cues = {c.lower() for c in _CUES.findall(prompt)}
    if cues:
        score += min(3.0, 1.5 * len(cues))
        signals.append(f"{len(cues)} multi-step cue(s): {', '.join(sorted(cues))}")
    if _JSON.search(prompt):
        score += 1
        signals.append("structured-output constraint")
    if not signals:
        signals.append("short, single-intent prompt")
    difficulty = min(1.0, score / 6.0)
    tier = "reasoning" if difficulty >= REASONING_THRESHOLD else "fast"
    return Analysis(round(difficulty, 2), tier, tuple(signals))


def _build_chain(models: list[ModelInfo], tier: str, key: Callable[[ModelInfo], float]) -> tuple[ModelInfo, ...]:
    in_tier = sorted((m for m in models if m.tier == tier), key=key)
    head = in_tier[0] if in_tier else (sorted(models, key=key)[0] if models else None)
    if head is None:
        return ()
    # Prefer a different provider for the first fallback so a provider-wide outage is survivable.
    same_tier = sorted(in_tier[1:], key=lambda m: m.provider == head.provider)
    rest = sorted((m for m in models if m is not head and m not in same_tier), key=key)
    return (head, *same_tier, *rest)


def plan_route(text: str, policy: str, registry: Registry) -> Route:
    a = analyze(text)
    if policy == "privacy-strict":
        return Route(
            (LOCAL_MODEL,),
            "fast",
            "privacy-strict: prompts never leave the gateway. Redaction is mandatory and the "
            "local deterministic provider answers instead of an external API.",
            1.0,
            a,
        )

    tier = a.tier
    cnn_p: float | None = None
    if policy == "learned-router":
        cnn = get_model()
        if cnn is not None:
            cnn_p = cnn.predict_proba(text)
            tier = "reasoning" if cnn_p >= 0.5 else "fast"
    if policy in ("always-cheap", "latency-optimized"):
        tier = "fast"
    elif policy == "always-strong":
        tier = "reasoning"

    def by_price(m: ModelInfo) -> float:
        return m.in_per_1m + m.out_per_1m

    def by_latency(m: ModelInfo) -> float:
        return m.avg_latency_ms

    chain = _build_chain(registry.candidates(), tier, by_latency if policy == "latency-optimized" else by_price)
    if not chain:
        chain = (LOCAL_MODEL,)

    why = "; ".join(a.signals)
    if policy == "smart-router":
        reason = f"smart-router: difficulty {a.difficulty:.2f} ({why}) -> {tier} tier, cheapest healthy model first."
        confidence = round(0.5 + abs(a.difficulty - 0.5), 2)
    elif policy == "learned-router":
        if cnn_p is None:
            reason = f"learned-router weights not found; fell back to the heuristic score ({a.difficulty:.2f}) -> {tier} tier."
            confidence = round(0.5 + abs(a.difficulty - 0.5), 2)
        else:
            reason = f"learned-router: char-CNN p(strong)={cnn_p:.2f} -> {tier} tier, cheapest healthy model first (heuristic score was {a.difficulty:.2f})."
            confidence = round(max(cnn_p, 1 - cnn_p), 2)
    elif policy == "always-cheap":
        reason = f"always-cheap pins the fast tier regardless of difficulty ({a.difficulty:.2f})."
        confidence = 1.0
    elif policy == "always-strong":
        reason = f"always-strong pins the reasoning tier regardless of difficulty ({a.difficulty:.2f})."
        confidence = 1.0
    else:
        reason = "latency-optimized: fast tier, lowest average latency first."
        confidence = 1.0
    return Route(chain, tier, reason, confidence, a)
