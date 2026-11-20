"""Learned router: a small character-level 1-D CNN that predicts whether a prompt needs the strong tier.

Architecture: char embedding (16-d) -> Conv1D (width 5, 32 filters, ReLU) -> global max pool -> dense -> sigmoid.
About 4.3k parameters, implemented in NumPy (no ML framework), trained by `python -m evals.train_router`, weights
shipped as JSON next to this file. It is a prototype trained on synthetic labelled prompts; see evals/router_data.py
for what the labels mean and why its benchmark score is optimistic.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

MAX_LEN = 160
EMB = 16
WIDTH = 5
FILTERS = 32
VOCAB = [chr(i) for i in range(32, 127)]  # printable ASCII; index 0 is padding / unknown
_INDEX = {c: i + 1 for i, c in enumerate(VOCAB)}
WEIGHTS_PATH = Path(__file__).with_name("router_cnn.json")


def encode(texts: list[str]) -> np.ndarray:
    out = np.zeros((len(texts), MAX_LEN), dtype=np.int64)
    for i, t in enumerate(texts):
        for j, ch in enumerate(t.lower()[:MAX_LEN]):
            out[i, j] = _INDEX.get(ch, 0)
    return out


def _windows(x: np.ndarray) -> np.ndarray:
    """(B, L, E) -> (B, L-WIDTH+1, WIDTH*E) sliding windows."""
    b, length, e = x.shape
    n = length - WIDTH + 1
    idx = np.arange(n)[:, None] + np.arange(WIDTH)[None, :]
    return x[:, idx, :].reshape(b, n, WIDTH * e)


class CharCNN:
    def __init__(self, params: dict[str, np.ndarray] | None = None, seed: int = 7):
        if params is None:
            rng = np.random.default_rng(seed)
            params = {
                "emb": rng.normal(0, 0.3, (len(VOCAB) + 1, EMB)),
                "conv_w": rng.normal(0, np.sqrt(2 / (WIDTH * EMB)), (WIDTH * EMB, FILTERS)),
                "conv_b": np.zeros(FILTERS),
                "out_w": rng.normal(0, 0.3, (FILTERS,)),
                "out_b": np.zeros(()),
            }
            params["emb"][0] = 0
        self.p = params

    def forward(self, ids: np.ndarray, cache: bool = False):
        x = self.p["emb"][ids]  # (B, L, E)
        win = _windows(x)  # (B, N, W*E)
        pre = win @ self.p["conv_w"] + self.p["conv_b"]  # (B, N, F)
        act = np.maximum(pre, 0)
        arg = act.argmax(axis=1)  # (B, F)
        pooled = np.take_along_axis(act, arg[:, None, :], axis=1)[:, 0, :]  # (B, F)
        logit = pooled @ self.p["out_w"] + self.p["out_b"]
        prob = 1 / (1 + np.exp(-np.clip(logit, -30, 30)))
        return (prob, (ids, win, pre, arg, pooled)) if cache else prob

    def predict_proba(self, text: str) -> float:
        return float(self.forward(encode([text]))[0])

    def n_params(self) -> int:
        return int(sum(v.size for v in self.p.values()))

    def save(self, path: Path = WEIGHTS_PATH) -> None:
        blob = {k: np.round(v, 5).tolist() for k, v in self.p.items()}
        path.write_text(json.dumps({"max_len": MAX_LEN, "width": WIDTH, "weights": blob}, separators=(",", ":")))

    @classmethod
    def load(cls, path: Path = WEIGHTS_PATH) -> CharCNN:
        raw = json.loads(path.read_text())["weights"]
        return cls({k: np.array(v, dtype=np.float64) for k, v in raw.items()})


_MODEL: CharCNN | None = None


def get_model() -> CharCNN | None:
    """Lazily load the shipped weights; None if the file is absent (callers fall back to the heuristic router)."""
    global _MODEL
    if _MODEL is None and WEIGHTS_PATH.exists():
        _MODEL = CharCNN.load()
    return _MODEL
