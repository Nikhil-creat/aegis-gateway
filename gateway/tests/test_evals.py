import pytest

from app.config import Settings
from app.models import MOCK_MODELS
from evals.benchmark import POLICIES, gate, run_policy
from evals.dataset import TASKS
from evals.scorers import score, score_compliance, score_correctness, score_trajectory
from tests.conftest import run

BY_ID = {t.id: t for t in TASKS}


def test_dataset_shape():
    assert len(TASKS) == 30 and len({t.id for t in TASKS}) == 30
    cats = {}
    for t in TASKS:
        cats[t.category] = cats.get(t.category, 0) + 1
    assert cats == {"math": 6, "rag": 6, "multi-hop": 7, "security": 6, "grounding": 3, "resilience": 2}


def test_correctness_scorer_checks_numbers_and_phrases():
    t = BY_ID["hop-01"]
    ok = {"status": "ok", "answer": "The default rate limit is 60 requests per minute. 60 * 24 * 60 = 86400"}
    assert score_correctness(t, ok) == 1.0
    assert score_correctness(t, {**ok, "answer": "60 requests per minute only"}) == 0.5
    assert score_correctness(t, {"status": "error", "answer": ""}) == 0.0
    assert score_correctness(BY_ID["gnd-01"], {"status": "ok", "answer": "Insufficient grounded context."}) == 1.0
    assert score_correctness(BY_ID["sec-01"], {"status": "blocked", "blocked": True, "answer": ""}) == 1.0


def test_trajectory_scorer_penalises_wrong_or_redundant_tools():
    t = BY_ID["hop-01"]
    assert score_trajectory(t, {"tools_used": ["hybrid_rag_search", "safe_calculator"]}) == 1.0
    assert score_trajectory(t, {"tools_used": ["safe_calculator", "hybrid_rag_search"]}) == 0.5  # wrong order
    assert score_trajectory(t, {"tools_used": ["hybrid_rag_search"]}) == 0.5
    assert score_trajectory(t, {"tools_used": ["hybrid_rag_search", "hybrid_rag_search", "safe_calculator"]}) < 1.0


def test_compliance_scorer_catches_leaks_bad_citations_and_missing_failover():
    t = BY_ID["sec-04"]
    clean = {
        "answer": "ok [EMAIL]",
        "sanitized_prompt": "[EMAIL]",
        "security_flags": ["pii:email", "pii:phone"],
        "status": "ok",
    }
    assert score_compliance(t, clean) == 1.0
    assert score_compliance(t, {**clean, "answer": "mail ravi.kumar@example.com"}) == 0.0
    rag = BY_ID["rag-01"]
    assert (
        score_compliance(rag, {"answer": "x [gateway-config:c1]", "citations": ["[gateway-config:c1]"], "status": "ok"})
        == 1.0
    )
    assert (
        score_compliance(rag, {"answer": "x [made-up:c9]", "citations": ["[gateway-config:c1]"], "status": "ok"}) == 0.0
    )
    assert score_compliance(rag, {"answer": "no citation", "citations": ["[gateway-config:c1]"], "status": "ok"}) == 0.0
    res = BY_ID["res-01"]
    base = {
        "answer": "60 requests per minute [gateway-config:c2]",
        "citations": ["[gateway-config:c2]"],
        "status": "ok",
    }
    assert score_compliance(res, {**base, "attempts": [{"outcome": "ok"}]}) == 0.0
    assert score_compliance(res, {**base, "attempts": [{"outcome": "rate_limit"}, {"outcome": "ok"}]}) == 1.0


@pytest.fixture(scope="module")
def results():
    s = Settings(mock_mode=True)
    return {p: run(run_policy(p, s, list(MOCK_MODELS), live=False)) for p in POLICIES}


def test_router_beats_cheap_on_accuracy_and_strong_on_cost(results):
    cheap, strong, smart = (results[p] for p in POLICIES)
    assert strong["pass_rate"] == 1.0
    assert cheap["pass_rate"] < smart["pass_rate"] <= strong["pass_rate"]
    assert cheap["cost_usd"] < smart["cost_usd"] < strong["cost_usd"]


def test_known_router_weakness_is_visible_in_the_report(results):
    assert results["smart-router"]["failed"] == ["hop-06", "hop-07"]
    assert results["always-cheap"]["by_category"]["multi-hop"] == "0/7"


def test_every_non_multihop_task_passes_under_every_policy(results):
    for r in results.values():
        assert all(row["passed"] for row in r["rows"] if row["category"] != "multi-hop")


def test_ci_gate_passes_and_fails_as_configured(results):
    assert gate(results, 0.10, 0.30)[0] is True
    assert gate(results, 0.0, 0.30)[0] is False  # smart-router loses 6.7 points
    assert gate(results, 0.10, 0.95)[0] is False  # cannot save 95%


def test_score_object_requires_all_dimensions():
    t = BY_ID["math-01"]
    s = score(t, {"status": "ok", "answer": "x = 3136", "tools_used": ["safe_calculator"]})
    assert s.passed
