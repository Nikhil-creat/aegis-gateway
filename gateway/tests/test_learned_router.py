import numpy as np

import app.router as router_mod
from app.learned_router import CharCNN, encode, get_model
from app.models import MOCK_MODELS, Registry
from app.router import analyze, plan_route
from evals.dataset import TASKS
from evals.router_data import make_split
from evals.train_router import _train


def test_shipped_weights_beat_the_heuristic_on_heldout_prompts():
    model = get_model()
    assert model is not None, "run `python -m evals.train_router` to create app/router_cnn.json"
    test = make_split("test", 300, seed=99)
    y = np.array([label for _, label in test])
    cnn = (model.forward(encode([t for t, _ in test])) >= 0.5).astype(int)
    heur = np.array([1 if analyze(t).tier == "reasoning" else 0 for t, _ in test])
    assert (cnn == y).mean() >= 0.85
    assert (cnn == y).mean() > (heur == y).mean() + 0.15


def test_hidden_multihop_prompts_go_to_the_strong_tier():
    model = get_model()
    hidden = [t.prompt for t in TASKS if t.notes.startswith("hidden multi-hop")]
    assert len(hidden) == 2
    assert all(model.predict_proba(p) > 0.5 for p in hidden)
    assert all(analyze(p).tier == "fast" for p in hidden)  # the heuristic's known blind spot


def test_no_benchmark_prompt_is_in_the_training_or_test_data():
    bench = {t.prompt for t in TASKS}
    for split in ("train", "test"):
        assert not bench & {t for t, _ in make_split(split, 400, seed=3)}
    assert not {t for t, _ in make_split("train", 400, seed=3)} & {t for t, _ in make_split("test", 400, seed=3)}


def test_training_reduces_loss_and_is_deterministic():
    data = make_split("train", 120, seed=5)
    ids, y = encode([t for t, _ in data]), np.array([label for _, label in data], dtype=float)
    losses_a = _train(CharCNN(seed=1), ids, y, epochs=6)
    losses_b = _train(CharCNN(seed=1), ids, y, epochs=6)
    assert losses_a[-1] < losses_a[0] * 0.5
    assert losses_a == losses_b


def test_plan_route_uses_the_cnn_and_explains_itself():
    route = plan_route("Default rate limit? Max agent steps?", "learned-router", Registry(list(MOCK_MODELS)))
    assert route.tier == "reasoning"
    assert "char-CNN" in route.reason and "p(strong)" in route.reason


def test_plan_route_falls_back_to_heuristics_without_weights(monkeypatch):
    monkeypatch.setattr(router_mod, "get_model", lambda: None)
    route = plan_route(
        "Compare these designs step by step and explain the trade-offs", "learned-router", Registry(list(MOCK_MODELS))
    )
    assert route.tier == "reasoning"
    assert "fell back" in route.reason
