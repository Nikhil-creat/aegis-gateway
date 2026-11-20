"""Train the CNN router and write a held-out report.  Usage: python -m evals.train_router

Backprop is written by hand (NumPy only). Outputs: app/router_cnn.json and artifacts/router_study.{json,md}.
"""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

from app.config import Settings
from app.learned_router import EMB, FILTERS, VOCAB, WIDTH, CharCNN, encode
from app.models import MOCK_MODELS
from app.router import analyze
from evals.benchmark import run_policy
from evals.dataset import TASKS
from evals.router_data import make_split

ART = Path(__file__).resolve().parent.parent / "artifacts"


def _train(
    model: CharCNN, ids: np.ndarray, y: np.ndarray, epochs: int = 30, batch: int = 64, lr: float = 0.01, seed: int = 1
) -> list[float]:
    rng = np.random.default_rng(seed)
    m = {k: np.zeros_like(v) for k, v in model.p.items()}
    v2 = {k: np.zeros_like(v) for k, v in model.p.items()}
    step, losses = 0, []
    for _ in range(epochs):
        order = rng.permutation(len(ids))
        total = 0.0
        for s in range(0, len(ids), batch):
            bi = order[s : s + batch]
            prob, (xi, win, pre, arg, pooled) = model.forward(ids[bi], cache=True)
            yb = y[bi]
            n = len(bi)
            total += float(-(yb * np.log(prob + 1e-9) + (1 - yb) * np.log(1 - prob + 1e-9)).sum())
            dlogit = (prob - yb) / n  # (B,)
            g: dict[str, np.ndarray] = {"out_w": pooled.T @ dlogit, "out_b": np.array(dlogit.sum())}
            dpool = dlogit[:, None] * model.p["out_w"][None, :]  # (B, F)
            dact = np.zeros_like(pre)
            np.put_along_axis(dact, arg[:, None, :], dpool[:, None, :], axis=1)
            dpre = dact * (pre > 0)
            g["conv_b"] = dpre.sum(axis=(0, 1))
            g["conv_w"] = np.einsum("bnk,bnf->kf", win, dpre)
            dwin = dpre @ model.p["conv_w"].T  # (B, N, W*E)
            demb_pos = np.zeros((n, xi.shape[1], EMB))
            nwin = dwin.shape[1]
            dwin = dwin.reshape(n, nwin, WIDTH, EMB)
            for k in range(WIDTH):
                demb_pos[:, k : k + nwin, :] += dwin[:, :, k, :]
            g["emb"] = np.zeros_like(model.p["emb"])
            np.add.at(g["emb"], xi, demb_pos)
            g["emb"][0] = 0
            step += 1
            for k in model.p:
                m[k] = 0.9 * m[k] + 0.1 * g[k]
                v2[k] = 0.999 * v2[k] + 0.001 * g[k] ** 2
                mh, vh = m[k] / (1 - 0.9**step), v2[k] / (1 - 0.999**step)
                model.p[k] = model.p[k] - lr * mh / (np.sqrt(vh) + 1e-8)
        losses.append(total / len(ids))
    return losses


def _metrics(pred: np.ndarray, y: np.ndarray) -> dict[str, float]:
    tp = int(((pred == 1) & (y == 1)).sum())
    fp = int(((pred == 1) & (y == 0)).sum())
    fn = int(((pred == 0) & (y == 1)).sum())
    tn = int(((pred == 0) & (y == 0)).sum())
    return {
        "accuracy": (tp + tn) / len(y),
        "precision_strong": tp / (tp + fp) if tp + fp else 0.0,
        "recall_strong": tp / (tp + fn) if tp + fn else 0.0,
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "tn": tn,
    }


def main() -> None:
    train = make_split("train", 1500, seed=11)
    test = make_split("test", 500, seed=23)
    assert not {t for t, _ in train} & {t.prompt for t in TASKS}, "benchmark prompt leaked into training data"
    assert not {t for t, _ in train} & {t for t, _ in test}, "train/test overlap"
    xt, yt = encode([t for t, _ in train]), np.array([y for _, y in train], dtype=float)
    xe, ye = encode([t for t, _ in test]), np.array([y for _, y in test])
    model = CharCNN()
    losses = _train(model, xt, yt)
    model.save()

    cnn = _metrics((model.forward(xe) >= 0.5).astype(int), ye)
    heur = _metrics(np.array([1 if analyze(t).tier == "reasoning" else 0 for t, _ in test]), ye)
    task_cnn = {t.id: model.predict_proba(t.prompt) for t in TASKS}
    hidden = {k: round(v, 3) for k, v in task_cnn.items() if k in ("hop-06", "hop-07")}
    bench = asyncio.run(run_policy("learned-router", Settings(mock_mode=True), list(MOCK_MODELS), live=False))
    bench_slim = {k: bench[k] for k in ("pass_rate", "cost_usd", "latency_p95_ms", "failed")}
    report = {
        "generated": datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC"),
        "params": model.n_params(),
        "vocab": len(VOCAB) + 1,
        "filters": FILTERS,
        "width": WIDTH,
        "train_n": len(train),
        "test_n": len(test),
        "final_train_loss": round(losses[-1], 4),
        "heldout": {"cnn": cnn, "heuristic": heur},
        "hidden_multihop_p_strong": hidden,
        "benchmark_learned_router_mock": bench_slim,
    }
    ART.mkdir(exist_ok=True)
    (ART / "router_study.json").write_text(json.dumps(report, indent=1) + "\n")
    f = lambda d: f"{d['accuracy']:.1%} | {d['precision_strong']:.1%} | {d['recall_strong']:.1%}"  # noqa: E731
    (ART / "router_study.md").write_text(
        f"# Learned router study\n\nCNN: {model.n_params()} parameters, NumPy, trained on {len(train)} synthetic prompts; "
        f"evaluated on {len(test)} held-out prompts built from disjoint phrase pools.\n\n"
        "| Router | Accuracy | Precision (strong) | Recall (strong) |\n|---|---|---|---|\n"
        f"| heuristic | {f(heur)} |\n| char-CNN | {f(cnn)} |\n\n"
        f"p(strong) on the two hidden multi-hop benchmark prompts: {hidden}\n\n"
        f"30-task benchmark with policy learned-router (mock provider): pass {bench_slim['pass_rate']:.1%}, cost ${bench_slim['cost_usd']:.6f}, failed {bench_slim['failed']}.\n"
        "Caveat: the router was designed after the benchmark exposed the hidden multi-hop weakness, so this run is optimistic, not a held-out result.\n\n"
        "Labels are defined by construction (see evals/router_data.py); this is a synthetic distribution, not production traffic.\n"
    )
    print(f"CNN: {model.n_params()} params, final train loss {losses[-1]:.4f}")
    print(f"held-out accuracy  heuristic {heur['accuracy']:.1%} | CNN {cnn['accuracy']:.1%}")
    print(f"strong-recall      heuristic {heur['recall_strong']:.1%} | CNN {cnn['recall_strong']:.1%}")
    print("hidden multi-hop p(strong):", hidden)
    print("benchmark (mock) learned-router:", bench_slim)


if __name__ == "__main__":
    main()
