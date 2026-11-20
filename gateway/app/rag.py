"""Hybrid retrieval: BM25 (lexical) + hashed character-trigram vectors (dense), fused with RRF.

The dense side is a dependency-free stand-in for a learned embedding model: it adds character-level
overlap on top of BM25 but is weak on heavy misspellings (measured: "exponental backof" is refused).
Swap `embed()` for sentence-transformers or a Gemini embedding model without touching the fusion code.
Relevance thresholds were chosen from measured scores: out-of-scope queries score BM25 = 0 and
cosine <= 0.33, while the weakest in-scope query scores BM25 2.46, so MIN_BM25 = 1.2 has wide margin.
"""

from __future__ import annotations

import math
import re
import zlib
from dataclasses import dataclass

STOP = frozenset(
    "the a an and or of to in is are was for on with by from at as it this that be what which who "
    "how did does do his her you your about".split()
)
DIM = 256
RRF_K = 60
MIN_BM25 = 1.2  # relevance thresholds: refuse to answer when neither retriever is confident
MIN_COSINE = 0.45


@dataclass(frozen=True)
class Chunk:
    doc: str
    id: str
    text: str

    @property
    def cite(self) -> str:
        return f"[{self.doc}:{self.id}]"


@dataclass(frozen=True)
class Hit:
    chunk: Chunk
    bm25: float
    cosine: float
    rrf: float


def stem(word: str) -> str:
    """Minimal plural stemmer so 'retries' matches 'retry' and 'models' matches 'model'."""
    if len(word) > 4 and word.endswith("ies"):
        return word[:-3] + "y"
    if len(word) > 4 and word.endswith("sses"):
        return word[:-2]
    if len(word) > 3 and word.endswith("s") and not word.endswith(("ss", "us", "is")):
        return word[:-1]
    return word


def tokenize(text: str) -> list[str]:
    words = (w.strip(".") for w in re.findall(r"[a-z0-9+#.\-]+", text.lower()))
    return [stem(w) for w in words if len(w) > 1 and w not in STOP]


def embed(text: str) -> list[float]:
    v = [0.0] * DIM
    for w in tokenize(text):
        padded = f"^{w}$"
        for i in range(len(padded) - 2):
            v[zlib.crc32(padded[i : i + 3].encode()) % DIM] += 1.0
    norm = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / norm for x in v]


class HybridIndex:
    def __init__(self, chunks: list[Chunk] | None = None):
        self.chunks: list[Chunk] = []
        self._tokens: list[list[str]] = []
        self._vecs: list[list[float]] = []
        for c in chunks or []:
            self.add(c)

    def add(self, chunk: Chunk) -> None:
        self.chunks.append(chunk)
        self._tokens.append(tokenize(chunk.text))
        self._vecs.append(embed(chunk.text))

    def add_text(self, doc: str, text: str, max_chars: int = 600) -> int:
        """Chunk plain text on paragraph/sentence boundaries and index it. Returns chunks added."""
        n = 0
        buf = ""
        for para in re.split(r"\n\s*\n|(?<=[.!?])\s+", text.strip()):
            para = para.strip()
            if not para:
                continue
            if buf and len(buf) + len(para) + 1 > max_chars:
                n += self._flush(doc, buf)
                buf = ""
            buf = f"{buf} {para}".strip()
        if buf:
            n += self._flush(doc, buf)
        return n

    def _flush(self, doc: str, text: str) -> int:
        existing = sum(1 for c in self.chunks if c.doc == doc)
        self.add(Chunk(doc, f"c{existing + 1}", text))
        return 1

    def _bm25(self, query: str) -> list[float]:
        k1, b = 1.5, 0.75
        docs = self._tokens
        n_docs = len(docs)
        avg = (sum(len(d) for d in docs) / n_docs) if n_docs else 1.0
        df: dict[str, int] = {}
        for d in docs:
            for t in set(d):
                df[t] = df.get(t, 0) + 1
        scores = []
        for d in docs:
            tf: dict[str, int] = {}
            for t in d:
                tf[t] = tf.get(t, 0) + 1
            s = 0.0
            for t in tokenize(query):
                f = tf.get(t, 0)
                if not f:
                    continue
                n = df.get(t, 0)
                idf = math.log(1 + (n_docs - n + 0.5) / (n + 0.5))
                s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * len(d) / avg))
            scores.append(s)
        return scores

    def search(self, query: str, k: int = 1) -> tuple[bool, list[Hit]]:
        if not self.chunks:
            return False, []
        sparse = self._bm25(query)
        qv = embed(query)
        dense = [sum(a * b for a, b in zip(v, qv, strict=True)) for v in self._vecs]

        def ranks(scores: list[float]) -> list[int]:
            return sorted(range(len(scores)), key=lambda i: (-scores[i], i))

        rrf = [0.0] * len(self.chunks)
        for order in (ranks(sparse), ranks(dense)):
            for pos, idx in enumerate(order):
                rrf[idx] += 1.0 / (RRF_K + pos + 1)
        top = ranks(rrf)[:k]
        hits = [Hit(self.chunks[i], sparse[i], dense[i], rrf[i]) for i in top]
        grounded = bool(hits) and (hits[0].bm25 > MIN_BM25 or hits[0].cosine > MIN_COSINE)
        return grounded, hits
